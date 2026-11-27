import type { CompactCE, CompactMC, Constants, EffectKind } from '../data/types';
import type { Quest, TeamMember } from '../engine/state';
import { solve as realSolve, type Solution, type SolveResult } from './solve';

/*
 * Team autocomplete: fill the free slots from the roster and the support slots
 * from the support pool, then run the solver on each combination, best-scored
 * combination first.
 *
 * Candidates: no unsupported effects, not one of the locked members, at least
 * one helpful skill effect (see helpfulValues). A member is identified by
 * svt.collectionNo + key, so one member is never used twice.
 *
 * Score: total battery (gainNp, 0.01% units) plus buff values (permille), both
 * at the member's skill levels, counting only the effects that can help the
 * team. A damaging-NP holder gets DPS_BONUS when no locked member has one.
 *
 * Combinations: every subset of the top maxCandidates of each pool (at most
 * C(12, 5) x 12 = 9504 combinations), sorted by total score with a stable
 * tie order (lexicographic candidate rank). Enumerated eagerly: the bound
 * keeps it small. Within a combination, the picks go to the free slots in
 * descending score order, and the slots keep their order (front = the first 3
 * filled slots): placements are not permuted. With fewer candidates than free
 * slots, the surplus slots stay empty.
 *
 * Time: each solve gets min(maxPerTeam, remaining total). solve is
 * synchronous; autocomplete yields (deps.yieldNow) between combinations, which
 * is when a cancel posted to a worker can land. Within one solve, the flag is
 * only seen if it was set before the solve started (or from onSolution), so
 * maxPerTeam is the bound there.
 *
 * Event CEs (req.ceFill, event nodes): an auto-picked member without a CE is
 * equipped before its solve. Supports get ceFill.support (any friend can bring
 * it); roster picks take ceFill.roster in order, each owned copy once per team.
 * An equipped member's key gets a suffix (@s, or @<roster index>) so a key
 * still names one exact member: equippedMember rebuilds it from the base key.
 */

/** A CE to equip on auto-picked members (event nodes). */
export interface CeFillChoice { ce: CompactCE; lv: number; mlb: boolean }
export interface CeFill { roster: readonly CeFillChoice[]; support: CeFillChoice | null }

const withCe = (m: TeamMember, c: CeFillChoice, tag: string): TeamMember =>
  ({ ...m, ce: c.ce, ceLv: Math.min(c.lv, c.ce.atkGrowth.length), ceMlb: c.mlb, key: `${m.key}@${tag}` });

/**
 * The member a key names when autocomplete equipped it (key "<base>@s" or
 * "<base>@<i>"), from its base member and the same ceFill; null when the key
 * has no suffix or the suffix does not resolve.
 */
export function equippedMember(key: string, base: (k: string) => TeamMember | undefined, fill: CeFill): TeamMember | null {
  const at = key.lastIndexOf('@');
  if (at < 0) return null;
  const m = base(key.slice(0, at));
  const tag = key.slice(at + 1);
  const c = tag === 's' ? fill.support : /^\d+$/.test(tag) ? fill.roster[Number(tag)] : undefined;
  return m && c ? withCe(m, c, tag) : null;
}

/** pool: the user's own short list for this slot, each tried in turn (in list order). */
export type Slot = { locked: TeamMember } | { free: true } | { support: true } | { pool: readonly TeamMember[] };

/** Every way to pick one member per pool slot (no member twice), in list order. */
function poolPicks(pools: readonly (readonly TeamMember[])[]): TeamMember[][] {
  let out: TeamMember[][] = [[]];
  for (const pool of pools) {
    out = out.flatMap((pick) => pool.filter((m) => !pick.some((x) => sameMember(x, m))).map((m) => [...pick, m]));
  }
  return out;
}

export interface AutocompleteOptions {
  maxMs: number;
  maxPerTeam: number;
  onSolution?: (s: Solution, team: readonly TeamMember[]) => void;
  cancel?: { cancelled: boolean };
}

export interface AutocompleteRequest {
  slots: readonly Slot[];
  roster: readonly TeamMember[];
  supportPool: readonly TeamMember[];
  mc: CompactMC; mcLv: number; quest: Quest; constants: Constants;
  opts: AutocompleteOptions;
  maxCandidates?: number;
  /** Event CEs for the auto-picked members (absent: they stay without a CE). */
  ceFill?: CeFill;
}

export interface AutocompleteResult {
  results: { team: TeamMember[]; solutions: Solution[] }[];
  triedTeams: number;
  /** Every combination was tried and every solve exhausted its search. */
  exhausted: boolean;
}

export interface AutocompleteDeps {
  solve?: typeof realSolve;
  now?: () => number;
  yieldNow?: () => Promise<void>;
}

export const DPS_BONUS = 10_000;
const BUFFS: readonly EffectKind[] = ['atkUp', 'cardUp', 'npDmgUp', 'powerUp'];

const isDps = (m: TeamMember) => m.svt.np !== null;
const sameMember = (a: TeamMember, b: TeamMember) => a.key === b.key && a.svt.collectionNo === b.svt.collectionNo;

/** Values of the helpful skill effects at the member's skill levels: [battery, buffs]. */
function helpfulValues(m: TeamMember): [number, number] {
  let battery = 0, buffs = 0;
  for (const sk of m.svt.skills) {
    const lv = m.skillLv[sk.num - 1] ?? 1;
    for (const e of sk.effects) {
      const party = e.target === 'ptOne' || e.target === 'ptAll' || e.target === 'ptOther';
      if (!party && !(e.target === 'self' && isDps(m))) continue;
      const v = e.lv[Math.min(lv, e.lv.length) - 1]?.value ?? 0;
      if (v <= 0) continue;
      if (e.kind === 'gainNp') battery += v;
      else if (BUFFS.includes(e.kind)) buffs += v;
    }
  }
  return [battery, buffs];
}

/** Candidate score, or null when the member has no helpful effect. */
export function candidateScore(m: TeamMember, lockedHasDps: boolean): number | null {
  const [battery, buffs] = helpfulValues(m);
  const helpful = battery > 0 || buffs > 0;
  if (!helpful) return null;
  return battery + buffs + (!lockedHasDps && isDps(m) ? DPS_BONUS : 0);
}

interface Cand { m: TeamMember; score: number }

export function candidates(pool: readonly TeamMember[], locked: readonly TeamMember[], max: number): Cand[] {
  const lockedHasDps = locked.some(isDps);
  const out: Cand[] = [];
  pool.forEach((m) => {
    if (m.svt.unsupported.length) return;
    if (locked.some((l) => sameMember(l, m))) return;
    if (out.some((c) => sameMember(c.m, m))) return;
    const score = candidateScore(m, lockedHasDps);
    if (score !== null) out.push({ m, score });
  });
  // Array.prototype.sort is stable: equal scores keep pool order.
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** Index subsets of size k of 0..n-1, lexicographic. */
function subsets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i <= n - (k - cur.length); i++) { cur.push(i); rec(i + 1); cur.pop(); }
  };
  rec(0);
  return out;
}

interface Combo { free: Cand[]; support: Cand[]; score: number; rank: number[] }

/** All combinations, best total score first; ties by candidate rank (roster, then support). */
export function combinations(free: Cand[], nFree: number, support: Cand[], nSupport: number): Combo[] {
  const fs = subsets(free.length, Math.min(nFree, free.length));
  const ss = subsets(support.length, Math.min(nSupport, support.length));
  const out: Combo[] = [];
  for (const f of fs) for (const s of ss) {
    const fc = f.map((i) => free[i]), sc = s.map((i) => support[i]);
    const all = [...fc, ...sc];
    // A support can be the same servant as a roster pick, but not the same member or key.
    if (new Set(all.map((c) => c.m.key)).size !== all.length) continue;
    out.push({ free: fc, support: sc, score: all.reduce((a, c) => a + c.score, 0), rank: [...f, ...s] });
  }
  return out.sort((a, b) => b.score - a.score || cmpRank(a.rank, b.rank));
}
const cmpRank = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export async function autocomplete(req: AutocompleteRequest, deps: AutocompleteDeps = {}): Promise<AutocompleteResult> {
  const solve = deps.solve ?? realSolve;
  const now = deps.now ?? (() => performance.now());
  const yieldNow = deps.yieldNow ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const { slots, opts } = req;
  const max = req.maxCandidates ?? 12;
  const t0 = now();

  const locked = slots.flatMap((s) => ('locked' in s ? [s.locked] : []));
  const nFree = slots.filter((s) => 'free' in s).length;
  const nSupport = slots.filter((s) => 'support' in s).length;
  const pools = slots.flatMap((s) => ('pool' in s ? [s.pool] : []));
  const picks = poolPicks(pools);
  // Free / support picks never repeat a member of a pool slot's list (candidates exclude it).
  const listed = pools.flat();
  const base = combinations(candidates(req.roster, [...locked, ...listed], max), nFree, candidates(req.supportPool, [...locked, ...listed], max), nSupport);
  const combos = picks.filter((pick) => !pick.some((m) => locked.some((l) => sameMember(l, m))))
    .flatMap((pick) => base.map((c) => ({ ...c, pool: pick })));

  const results: AutocompleteResult['results'] = [];
  let triedTeams = 0;
  let allExhausted = true;
  for (let c = 0; c < combos.length; c++) {
    if (c > 0) await yieldNow();
    const remaining = opts.maxMs - (now() - t0);
    if (opts.cancel?.cancelled || remaining <= 0) return { results, triedTeams, exhausted: false };

    const combo = combos[c];
    // Picks are already in descending score order (candidate lists are sorted, subsets lexicographic).
    const freePicks = [...combo.free], supportPicks = [...combo.support], listPicks = [...combo.pool];
    const team: TeamMember[] = [];
    let nextCe = 0;
    for (const s of slots) {
      let m = 'locked' in s ? s.locked : 'pool' in s ? listPicks.shift()
        : ('free' in s ? freePicks.shift() : supportPicks.shift())?.m;
      if (m && req.ceFill && !m.ce && ('free' in s || 'support' in s)) {
        if ('support' in s) { if (req.ceFill.support) m = withCe(m, req.ceFill.support, 's'); }
        else if (nextCe < req.ceFill.roster.length) { m = withCe(m, req.ceFill.roster[nextCe], String(nextCe)); nextCe++; }
      }
      if (m) team.push(m);
    }

    const r: SolveResult = solve(team, req.mc, req.mcLv, req.quest, req.constants, {
      maxMs: Math.min(opts.maxPerTeam, remaining),
      cancel: opts.cancel,
      onSolution: opts.onSolution && ((s) => opts.onSolution!(s, team)),
    });
    triedTeams++;
    if (!r.exhausted) allExhausted = false;
    results.push({ team, solutions: r.solutions });
  }
  return { results, triedTeams, exhausted: allExhausted };
}
