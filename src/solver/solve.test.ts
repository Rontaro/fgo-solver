import { describe, it, expect } from 'vitest';
import type { CompactMC, CompactServant, Effect, EffectKind, TargetKind } from '../data/types';
import type { Enemy, Quest, TeamMember } from '../engine/state';
import { altria, castoria, siegfried, kaleidoscope, mcCombat, prisonRuins, constants, member } from '../engine/test-helpers';
import { solve, replay, simulate, type Solution, type SolveOptions } from './solve';

const fill = (value: number, turns = -1, count = -1) => Array.from({ length: 10 }, () => ({ value, turns, count }));
const eff = (kind: EffectKind, target: TargetKind, value: number, turns = -1): Effect => ({ kind, target, lv: fill(value, turns) });
const skill = (num: 1 | 2 | 3, cd: number, ...effects: Effect[]) => ({ num, cooldown: Array(10).fill(cd), effects });
const enemy = (hp: number, traits: number[] = []): Enemy => ({ hp, className: 'assassin', attribute: 'human', traits, tdRate: 900 });
const quest = (...hps: number[][]): Quest => ({ waves: hps.map((w) => w.map((hp) => enemy(hp))) });
// Trait 1172 makes Castoria S3 (powerUp vs 1172) relevant for Altria.
const humanoidQuest = (...hps: number[][]): Quest => ({ waves: hps.map((w) => w.map((hp) => enemy(hp, [1172]))) });

// Synthetic gauge battery: S1 ptOne 50%, S2 ptAll 30%, S3 ptOne 30%. No damaging NP.
const battery: CompactServant = {
  ...castoria, id: 9001, name: 'Battery', passives: [], np: null,
  skills: [
    skill(1, 7, eff('gainNp', 'ptOne', 5000)),
    skill(2, 7, eff('gainNp', 'ptAll', 3000)),
    skill(3, 7, eff('gainNp', 'ptOne', 3000)),
  ],
};
// Synthetic MC with three useful skills: party atk up, ptOne 20% charge, order change.
const mc3: CompactMC = {
  id: 9002, name: 'Test MC', unsupported: [],
  skills: [
    { num: 1, cooldown: Array(10).fill(10), effects: [eff('atkUp', 'ptAll', 300, 1)] },
    { num: 2, cooldown: Array(10).fill(10), effects: [eff('gainNp', 'ptOne', 2000)] },
    { num: 3, cooldown: Array(10).fill(10), effects: [{ kind: 'orderChange', target: 'orderChange', lv: fill(1) }] },
  ],
};

const altK = (key = 'alt') => member(altria, key, { npLv: 5, ce: kaleidoscope, ceLv: 100, ceMlb: true });
const cas = (key: string) => member(castoria, key, { npLv: 1 });

/** Every solution must replay to a clear, and no single skill/MC step may be removable. */
function checkSolutions(team: TeamMember[], mc: CompactMC, q: Quest, sols: Solution[]) {
  for (const sol of sols) {
    const margins = replay(team, mc, 10, q, constants, sol);
    expect(margins).toEqual(sol.margins);
    margins.forEach((m) => expect(m).toBeGreaterThanOrEqual(1));
    expect(sol.turns).toHaveLength(q.waves.length);
    expect(sol.actions).toBe(sol.turns.flat().filter((s) => s.kind !== 'np').length);
    sol.turns.forEach((turn, t) => turn.forEach((st, i) => {
      if (st.kind === 'np') return;
      const cut = sol.turns.map((x, j) => (j === t ? x.filter((_, k) => k !== i) : x));
      expect(simulate(team, mc, 10, q, constants, cut).ok, `step ${t}:${i} is removable`).toBe(false);
    }));
  }
  for (let i = 1; i < sols.length; i++) expect(sols[i - 1].actions).toBeLessThanOrEqual(sols[i].actions);
}

const run = (team: TeamMember[], mc: CompactMC, q: Quest, opts: Partial<SolveOptions> = {}) =>
  solve(team, mc, 10, q, constants, { maxMs: 10_000, ...opts });

describe('solve: trivial quest', () => {
  const team = [altK(), cas('cas'), member(battery, 'bat')];
  const q = quest([5000], [5000], [5000]);
  const r = run(team, mcCombat, q);

  it('finds solutions and exhausts the search', () => {
    expect(r.solutions.length).toBeGreaterThan(0);
    expect(r.exhausted).toBe(true);
    expect(r.best).toBeNull();
  });
  it('solutions replay, are minimal and sorted', () => checkSolutions(team, mcCombat, q, r.solutions));
  it('the best solution fires Altria every turn and uses exactly the needed charge', () => {
    const best = r.solutions[0];
    for (const turn of best.turns) expect(turn.filter((s) => s.kind === 'np')).toEqual([{ kind: 'np', unit: 'alt' }]);
    expect(best.turns[0]).toEqual([{ kind: 'np', unit: 'alt' }]); // Kaleidoscope alone fires turn 1
    // 20% left after each NP: 80% needed on turns 2 and 3; the cheapest covers it with 2 + 3 skills at most.
    expect(best.actions).toBeLessThanOrEqual(5);
    expect(best.usesSwap).toBe(false);
  });
  it('onSolution sees every solution and maxSolutions stops early', () => {
    const got: Solution[] = [];
    const r1 = run(team, mcCombat, q, { onSolution: (s) => got.push(s), maxSolutions: 1 });
    expect(got).toHaveLength(1);
    expect(r1.solutions).toEqual(got);
    expect(r1.exhausted).toBe(false);
  });
});

describe('solve: impossible quest', () => {
  const team = [altK(), cas('cas'), member(battery, 'bat')];
  const q = quest([5000], [5000], [10_000_000]);
  const r = run(team, mcCombat, q);
  it('no solution, exhausted, best partial on wave 3 short of damage', () => {
    expect(r.solutions).toEqual([]);
    expect(r.exhausted).toBe(true);
    // The damage bound already rules wave 3 out at the start.
    expect(r.best).toMatchObject({ wave: 3, turn: 3, reason: 'out of reach even with every remaining buff' });
    expect(r.best!.missingDamagePct).toBeGreaterThan(0.9);
    expect(r.best!.missingDamagePct).toBeLessThan(1);
  });
  it('without prunes the search fires on wave 3 and reports the shortfall of the best attempt', () => {
    const r2 = run(team, mcCombat, q, { prune: false });
    expect(r2.solutions).toEqual([]);
    expect(r2.exhausted).toBe(true);
    expect(r2.best).toMatchObject({ wave: 3, turn: 3, reason: 'not enough damage' });
    // The bound is optimistic: it never claims less missing damage than a real attempt.
    expect(r.best!.missingDamagePct!).toBeLessThanOrEqual(r2.best!.missingDamagePct!);
  });
  it('no charge at all: gaugeShort on wave 1', () => {
    const r2 = run([member(altria, 'alt'), cas('cas')], mcCombat, quest([5000], [5000], [5000]));
    expect(r2.solutions).toEqual([]);
    // Altria S3 + Castoria S1 + S2 give 80%; the MC gives nothing: 20% short.
    expect(r2.best).toMatchObject({ wave: 1, turn: 1, reason: 'no NP charged', gaugeShort: 2000 });
  });
});

describe('solve: Prison Ruins (real data)', () => {
  // Altria NP5 + Kaleidoscope MLB, own Castoria + support Castoria (both NP1, skills 10).
  const team = [altK(), cas('cas'), cas('cas-sup')];
  const r = run(team, mcCombat, prisonRuins);
  it('results are consistent with replay', () => {
    console.log('Prison Ruins:', JSON.stringify({
      solutions: r.solutions.length, exhausted: r.exhausted, best: r.best, stats: r.stats,
      first: r.solutions[0] && { turns: r.solutions[0].turns, margins: r.solutions[0].margins },
    }));
    expect(r.exhausted).toBe(true);
    checkSolutions(team, mcCombat, prisonRuins, r.solutions);
    if (r.solutions.length === 0) expect(r.best!.wave).toBeGreaterThanOrEqual(1);
  });
  it('the full search without prunes agrees', () => {
    const off = run(team, mcCombat, prisonRuins, { prune: false });
    console.log('Prison Ruins, no prunes:', JSON.stringify({ solutions: off.solutions.length, best: off.best, stats: off.stats }));
    expect(off.exhausted).toBe(true);
    expect(off.solutions.length > 0).toBe(r.solutions.length > 0);
    checkSolutions(team, mcCombat, prisonRuins, off.solutions);
  });
});

describe('solve: prunes keep the best solutions', () => {
  // Small enough to search without the bounds and dominance prunes, with an order change.
  const team = [altK(), cas('cas'), member(battery, 'bat'), member(siegfried, 'sieg'), cas('cas-sup')];
  const cases: [string, Quest][] = [
    ['feasible', quest([20000, 20000], [30000, 30000], [60000])],
    ['tight', quest([25000, 25000], [35000, 35000], [75000])],
  ];
  for (const [name, q] of cases) {
    it(name, () => {
      const on = run(team, mcCombat, q);
      const off = run(team, mcCombat, q, { prune: false, maxMs: 60_000 });
      console.log(`prune check ${name}:`, JSON.stringify({ on: on.stats, off: off.stats, nOn: on.solutions.length, nOff: off.solutions.length }));
      expect(on.exhausted && off.exhausted).toBe(true);
      expect(on.solutions.length > 0).toBe(off.solutions.length > 0);
      if (off.solutions.length) {
        expect(on.solutions[0].actions).toBe(off.solutions[0].actions);
        expect(Math.min(...on.solutions[0].margins)).toBeGreaterThanOrEqual(1);
      }
      checkSolutions(team, mcCombat, q, on.solutions);
      checkSolutions(team, mcCombat, q, off.solutions);
    }, 120_000);
  }
});

describe('solve: performance and cancellation', () => {
  // 6 members: Altria + 2 Castoria in front (9 relevant skills: trait 1172 makes
  // Castoria S3 count), 3 MC skills (atk, charge, order change), 3 in the back.
  const team = [
    altK(), cas('cas'), cas('cas-sup'),
    member(siegfried, 'sieg'), member(altria, 'alt2', { npLv: 5 }), member(battery, 'bat'),
  ];
  // Wave 3 just out of reach: the damage bound passes at the start (only a
  // full search shows it), so this is close to the worst case.
  const hard = humanoidQuest([30000, 30000, 30000], [60000, 60000, 60000], [200000]);

  it('exhausts a near-threshold impossible quest in under 5 s', () => {
    const r = run(team, mc3, hard, { maxMs: 5000 });
    console.log('perf (impossible):', JSON.stringify(r.stats), JSON.stringify(r.best));
    expect(r.exhausted).toBe(true);
    expect(r.solutions).toEqual([]);
    expect(r.best!.wave).toBe(3);
    expect(r.stats.ms).toBeLessThan(5000);
  });
  it('finds solutions on a feasible version in under 5 s', () => {
    const q = humanoidQuest([30000, 30000, 30000], [60000, 60000, 60000], [150000]);
    const r = run(team, mc3, q, { maxMs: 5000, maxSolutions: 20 });
    console.log('perf (feasible):', JSON.stringify(r.stats), r.solutions.length, 'solutions; best', JSON.stringify(r.solutions[0]));
    expect(r.solutions.length).toBeGreaterThan(0);
    expect(r.stats.ms).toBeLessThan(5000);
    checkSolutions(team, mc3, q, r.solutions);
  });
  it('cancel.cancelled stops the search quickly', () => {
    const t0 = performance.now();
    const r = run(team, mc3, hard, { cancel: { cancelled: true } });
    expect(r.exhausted).toBe(false);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.stats.nodes).toBeLessThan(1000);
  });
  it('cancelling from onSolution stops at once', () => {
    const cancel = { cancelled: false };
    const q = humanoidQuest([30000, 30000, 30000], [60000, 60000, 60000], [150000]);
    const r = run(team, mc3, q, { cancel, onSolution: () => { cancel.cancelled = true; } });
    expect(r.exhausted).toBe(false);
    expect(r.solutions.length).toBeLessThanOrEqual(2);
  });
  it('maxMs bounds the run time', () => {
    const t0 = performance.now();
    const r = run(team, mc3, hard, { maxMs: 30 });
    expect(r.exhausted).toBe(false);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
