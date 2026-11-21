import type { CompactMC, Constants } from '../data/types';
import type { Quest, TeamMember } from '../engine/state';
import { questFromAtlas, UnsupportedQuestError, type RawQuest } from '../engine/quest';
import { solve, type Solution, type SolveResult, type SolveStats } from './solve';
import { autocomplete, type AutocompleteDeps, type AutocompleteResult, type Slot } from './autocomplete';

/*
 * Worker message protocol, as a pure function so it runs without a Worker.
 *
 * Cancel: solve is synchronous, and a worker only receives a message between
 * tasks. A cancel therefore reaches a single-team solve only before it starts;
 * during it, maxMs is the bound. Autocomplete yields between combinations, so
 * a cancel takes effect before the next combination (and the current solve's
 * maxPerTeam bounds the wait).
 */

/** The quest, either engine-ready or raw Atlas (converted here, so UnsupportedQuestError reasons reach the UI). */
type QuestInput = { quest: Quest } | { rawQuest: RawQuest };
interface Common { mc: CompactMC; mcLv: number; constants: Constants }

export type SolvePayload = Common & QuestInput & { kind: 'team'; team: TeamMember[]; maxMs: number; maxSolutions?: number };
export type AutocompletePayload = Common & QuestInput & {
  kind: 'autocomplete'; slots: Slot[]; roster: TeamMember[]; supportPool: TeamMember[];
  maxMs: number; maxPerTeam: number; maxCandidates?: number;
};

export type InMsg =
  | { type: 'solve'; id: number; payload: SolvePayload | AutocompletePayload }
  | { type: 'cancel'; id: number };

export interface Progress { triedTeams: number; solutions: number; ms: number }
export type OutMsg =
  | { type: 'solution'; id: number; solution: Solution; team?: string[] }
  | { type: 'progress'; id: number; stats: Progress | SolveStats }
  | { type: 'done'; id: number; result: SolveResult | AutocompleteResult }
  | { type: 'error'; id: number; message: string; reasons?: readonly string[] };

export const PROGRESS_EVERY_MS = 250;
const jobs = new Map<number, { cancelled: boolean }>();

export async function handleMessage(msg: InMsg, post: (m: OutMsg) => void, deps: AutocompleteDeps = {}): Promise<void> {
  if (msg.type === 'cancel') {
    const job = jobs.get(msg.id);
    if (job) job.cancelled = true;
    return;
  }
  const { id, payload: p } = msg;
  const cancel = { cancelled: false };
  jobs.set(id, cancel);
  try {
    const quest = 'quest' in p ? p.quest : questFromAtlas(p.rawQuest);
    if (p.kind === 'team') {
      const result = (deps.solve ?? solve)(p.team, p.mc, p.mcLv, quest, p.constants, {
        maxMs: p.maxMs, maxSolutions: p.maxSolutions, cancel,
        onSolution: (solution) => post({ type: 'solution', id, solution }),
      });
      post({ type: 'done', id, result });
      return;
    }
    const now = deps.now ?? (() => performance.now());
    const t0 = now();
    let last = t0, triedTeams = 0, solutions = 0;
    const result = await autocomplete({
      slots: p.slots, roster: p.roster, supportPool: p.supportPool,
      mc: p.mc, mcLv: p.mcLv, quest, constants: p.constants, maxCandidates: p.maxCandidates,
      opts: {
        maxMs: p.maxMs, maxPerTeam: p.maxPerTeam, cancel,
        onSolution: (solution, team) => { solutions++; post({ type: 'solution', id, solution, team: team.map((m) => m.key) }); },
      },
    }, {
      ...deps,
      solve: (...args) => {
        const r = (deps.solve ?? solve)(...args);
        triedTeams++;
        const t = now();
        if (t - last >= PROGRESS_EVERY_MS) { last = t; post({ type: 'progress', id, stats: { triedTeams, solutions, ms: t - t0 } }); }
        return r;
      },
    });
    post({ type: 'done', id, result });
  } catch (e) {
    post({
      type: 'error', id, message: e instanceof Error ? e.message : String(e),
      ...(e instanceof UnsupportedQuestError ? { reasons: e.reasons } : {}),
    });
  } finally {
    jobs.delete(id);
  }
}
