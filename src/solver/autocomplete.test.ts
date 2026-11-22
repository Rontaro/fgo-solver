import { describe, it, expect } from 'vitest';
import type { CompactServant, Effect } from '../data/types';
import type { Quest, TeamMember } from '../engine/state';
import { altria, castoria, kaleidoscope, mcCombat, constants, member } from '../engine/test-helpers';
import type { RawQuest } from '../engine/quest';
import { solve } from './solve';
import { autocomplete, candidateScore, type AutocompleteRequest, type Slot } from './autocomplete';
import { handleMessage, type OutMsg, type SolvePayload, type AutocompletePayload } from './worker-handler';

const fill = (value: number) => Array.from({ length: 10 }, () => ({ value, turns: -1, count: -1 }));
const gain = (value: number): Effect => ({ kind: 'gainNp', target: 'ptAll', lv: fill(value) });
const svt = (no: number, skills: CompactServant['skills'], extra: Partial<CompactServant> = {}): CompactServant =>
  ({ ...castoria, id: 90000 + no, collectionNo: 9000 + no, name: `S${no}`, passives: [], np: null, skills, unsupported: [], ...extra });
const bat = (no: number, value: number, extra: Partial<CompactServant> = {}) =>
  member(svt(no, [{ num: 1, cooldown: Array(10).fill(7), effects: [gain(value)] }], extra), `m${no}`);

// One wave, one weak enemy: Altria with an MLB Kaleidoscope clears it on turn 1, so each solve takes milliseconds.
const quest: Quest = { waves: [[{ hp: 1000, className: 'assassin', attribute: 'human', traits: [], tdRate: 900 }]] };
const alt = member(altria, 'alt', { npLv: 5, ce: kaleidoscope, ceLv: 100, ceMlb: true });
const filler = (no: number): Slot => ({ locked: member(svt(no, []), `f${no}`) });
// Scores with ties: 100 x (1..7).
const roster = Array.from({ length: 20 }, (_, i) => bat(i, 100 * ((i % 7) + 1)));

function req(slots: Slot[], over: Partial<AutocompleteRequest> = {}): AutocompleteRequest {
  return { slots, roster, supportPool: [], mc: mcCombat, mcLv: 10, quest, constants, opts: { maxMs: 10_000, maxPerTeam: 1000 }, ...over };
}
function spy() {
  const teams: TeamMember[][] = [];
  const s: typeof solve = (team, ...rest) => { teams.push([...team]); return solve(team, ...rest); };
  return { teams, solve: s };
}
const yieldNow = () => Promise.resolve();
const twoFree: Slot[] = [{ locked: alt }, { free: true }, { free: true }, filler(101), filler(102), filler(103)];

describe('autocomplete', () => {
  it('tries combinations in descending score order, no member twice', async () => {
    const sp = spy();
    const r = await autocomplete(req(twoFree), { solve: sp.solve, yieldNow });
    expect(r.triedTeams).toBe(66); // C(12, 2)
    expect(r.exhausted).toBe(true);
    const scores = sp.teams.map((t) => candidateScore(t[1], true)! + candidateScore(t[2], true)!);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    const seen = new Set<string>();
    for (const t of sp.teams) {
      expect(new Set(t.map((m) => m.key)).size).toBe(6);
      const pair = [t[1].key, t[2].key].sort().join('+');
      expect(seen.has(pair)).toBe(false);
      seen.add(pair);
    }
    expect(r.results[0].solutions.length).toBeGreaterThan(0);
    // Stable ties: the two 700s come first, in roster order.
    expect([sp.teams[0][1].key, sp.teams[0][2].key]).toEqual(['m6', 'm13']);
  });

  it('excludes unsupported members', async () => {
    const bad = bat(50, 99_999, { unsupported: ['foo'] });
    const sp = spy();
    await autocomplete(req(twoFree, { roster: [bad, ...roster.slice(0, 4)] }), { solve: sp.solve, yieldNow });
    expect(sp.teams.length).toBe(6);
    expect(sp.teams.flat().some((m) => m.key === bad.key)).toBe(false);
  });

  it('a locked-only request equals a single solve', async () => {
    const slots: Slot[] = [{ locked: alt }, filler(101), filler(102), filler(103), filler(104), filler(105)];
    const sp = spy();
    const r = await autocomplete(req(slots), { solve: sp.solve, yieldNow });
    expect(sp.teams.length).toBe(1);
    const direct = solve(sp.teams[0], mcCombat, 10, quest, constants, { maxMs: 1000 });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].solutions).toEqual(direct.solutions);
  });

  it('the support slot draws only from supportPool', async () => {
    const pool = [bat(200, 5000), bat(201, 50)];
    const slots: Slot[] = [{ locked: alt }, { free: true }, { support: true }, filler(101), filler(102), filler(103)];
    const sp = spy();
    await autocomplete(req(slots, { roster: roster.slice(0, 3), supportPool: pool }), { solve: sp.solve, yieldNow });
    expect(sp.teams.length).toBe(6);
    for (const t of sp.teams) {
      expect(pool).toContain(t[2]);
      expect(pool).not.toContain(t[1]);
    }
    expect(sp.teams[0][2].key).toBe('m200');
  });

  it('list slots try each listed member in turn, never one twice', async () => {
    const a = bat(300, 100), b = bat(301, 100), c = bat(302, 100);
    const slots: Slot[] = [{ locked: alt }, { pool: [a, b] }, { pool: [b, c] }, filler(101), filler(102), filler(103)];
    const sp = spy();
    const r = await autocomplete(req(slots, { roster: [] }), { solve: sp.solve, yieldNow });
    expect(sp.teams.map((t) => [t[1].key, t[2].key])).toEqual([['m300', 'm301'], ['m300', 'm302'], ['m301', 'm302']]);
    expect(r.triedTeams).toBe(3);
  });

  it('cancel stops early', async () => {
    const cancel = { cancelled: false };
    const r = await autocomplete(req(twoFree, { opts: { maxMs: 10_000, maxPerTeam: 1000, cancel, onSolution: () => { cancel.cancelled = true; } } }), { yieldNow });
    expect(r.triedTeams).toBe(1);
    expect(r.exhausted).toBe(false);
  });

  it('stops at the total maxMs', async () => {
    let t = 0;
    const r = await autocomplete(req(twoFree, { opts: { maxMs: 30, maxPerTeam: 1000 } }), { now: () => (t += 10), yieldNow });
    expect(r.triedTeams).toBeLessThan(66);
    expect(r.exhausted).toBe(false);
  });
});

describe('worker handleMessage', () => {
  const common = { mc: mcCombat, mcLv: 10, constants };
  const run = async (payload: SolvePayload | AutocompletePayload) => {
    const out: OutMsg[] = [];
    await handleMessage({ type: 'solve', id: 7, payload }, (m) => out.push(m), { yieldNow });
    return out;
  };

  it('single team: streams solutions then done', async () => {
    const out = await run({ kind: 'team', team: [alt], quest, maxMs: 1000, ...common });
    expect(out.at(-1)?.type).toBe('done');
    expect(out.filter((m) => m.type === 'solution').length).toBeGreaterThan(0);
    expect(out.every((m) => m.id === 7)).toBe(true);
  });

  it('autocomplete: solutions carry the team keys', async () => {
    const out = await run({ kind: 'autocomplete', slots: twoFree, roster: roster.slice(0, 3), supportPool: [], quest, maxMs: 1000, maxPerTeam: 200, ...common });
    const done = out.at(-1)!;
    expect(done.type === 'done' && 'triedTeams' in done.result && done.result.triedTeams).toBe(3);
    const sol = out.find((m) => m.type === 'solution');
    expect(sol?.type === 'solution' && sol.team?.length).toBe(6);
  });

  it('cancel between combinations', async () => {
    const out: OutMsg[] = [];
    const p = handleMessage({ type: 'solve', id: 8, payload: { kind: 'autocomplete', slots: twoFree, roster, supportPool: [], quest, maxMs: 10_000, maxPerTeam: 200, ...common } },
      (m) => out.push(m), { yieldNow: () => new Promise((r) => setTimeout(r, 0)) });
    await handleMessage({ type: 'cancel', id: 8 }, () => {});
    await p;
    const done = out.at(-1)!;
    expect(done.type === 'done' && 'triedTeams' in done.result && done.result.triedTeams).toBe(1);
  });

  it('unsupported quest: error with reasons', async () => {
    const rawQuest = { stages: [{ wave: 1, call: [{}], enemies: [] }] } as unknown as RawQuest;
    const out = await run({ kind: 'team', team: [alt], rawQuest, maxMs: 100, ...common });
    expect(out).toHaveLength(1);
    expect(out[0].type === 'error' && out[0].reasons).toEqual(['wave 1: call deck']);
  });
});
