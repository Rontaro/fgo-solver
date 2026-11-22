import { describe, it, expect } from 'vitest';
import type { CompactMC, CompactServant, Effect, EffectKind, TargetKind } from '../data/types';
import type { Enemy, Quest, TeamMember } from '../engine/state';
import { altria, castoria, siegfried, kaleidoscope, mcCombat, prisonRuins, constants, member } from '../engine/test-helpers';
import { solve, replay, simulate, type Solution, type SolveOptions } from './solve';
import { bruteMinActions } from './brute-reference';
import { initBattle } from '../engine/state';
import { fireNp } from '../engine/np';

// Stats output only with SOLVER_LOG=1 (like the engine benchmark's BENCH=1).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const log: (...a: unknown[]) => void = env.SOLVER_LOG ? console.log : () => {};

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
    log('Prison Ruins:', JSON.stringify({
      solutions: r.solutions.length, exhausted: r.exhausted, best: r.best, stats: r.stats,
      first: r.solutions[0] && { turns: r.solutions[0].turns, margins: r.solutions[0].margins },
    }));
    expect(r.exhausted).toBe(true);
    checkSolutions(team, mcCombat, prisonRuins, r.solutions);
    if (r.solutions.length === 0) expect(r.best!.wave).toBeGreaterThanOrEqual(1);
  });
  it('the full search without prunes agrees', () => {
    const off = run(team, mcCombat, prisonRuins, { prune: false });
    log('Prison Ruins, no prunes:', JSON.stringify({ solutions: off.solutions.length, best: off.best, stats: off.stats }));
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
      log(`prune check ${name}:`, JSON.stringify({ on: on.stats, off: off.stats, nOn: on.solutions.length, nOff: off.solutions.length }));
      expect(on.exhausted && off.exhausted).toBe(true);
      // The prunes under test did fire.
      expect(on.stats.delayPrunes).toBeGreaterThan(0);
      expect(on.stats.boundPrunes).toBeGreaterThan(0);
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
    log('perf (impossible):', JSON.stringify(r.stats), JSON.stringify(r.best));
    expect(r.exhausted).toBe(true);
    expect(r.solutions).toEqual([]);
    expect(r.best!.wave).toBe(3);
    expect(r.stats.ms).toBeLessThan(5000);
  });
  it('finds solutions on a feasible version in under 5 s', () => {
    const q = humanoidQuest([30000, 30000, 30000], [60000, 60000, 60000], [150000]);
    const r = run(team, mc3, q, { maxMs: 5000, maxSolutions: 20 });
    log('perf (feasible):', JSON.stringify(r.stats), r.solutions.length, 'solutions; best', JSON.stringify(r.solutions[0]));
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

// --- brute-force reference -------------------------------------------------

// MC for the reference comparisons: party atk up, ptOne 20%, order change.
const mcB: CompactMC = {
  id: 9003, name: 'Brute MC', unsupported: [],
  skills: [
    { num: 1, cooldown: Array(10).fill(5), effects: [eff('atkUp', 'ptAll', 200, 1)] },
    { num: 2, cooldown: Array(10).fill(5), effects: [eff('gainNp', 'ptOne', 2000)] },
    { num: 3, cooldown: Array(10).fill(10), effects: [{ kind: 'orderChange', target: 'orderChange', lv: fill(1) }] },
  ],
};
const supp = (id: number, ...skills: ReturnType<typeof skill>[]): CompactServant =>
  ({ ...castoria, id, name: 'S' + id, passives: [], np: null, skills });

/** Solver (prunes on) vs brute force: same feasibility and minimum action count. */
function againstBrute(team: TeamMember[], q: Quest, mc: CompactMC = mcB): number {
  const t0 = performance.now();
  const b = bruteMinActions(team, mc, 10, q, constants);
  const t1 = performance.now();
  const r = run(team, mc, q, { maxMs: 20_000 });
  log('brute', b, Math.round(t1 - t0), 'ms; solver', r.solutions[0]?.actions, Math.round(r.stats.ms), 'ms', JSON.stringify(r.stats));
  expect(r.exhausted).toBe(true);
  expect(r.stats.replayFailures).toBe(0);
  expect(r.solutions[0]?.actions ?? Infinity).toBe(b);
  checkSolutions(team, mc, q, r.solutions);
  return b;
}

describe('solve: regressions', () => {
  it('fewest actions is exact on the forced last turn (one full charge beats two halves)', () => {
    const bat = supp(9101, skill(1, 7, eff('gainNp', 'ptOne', 10000)), skill(2, 7, eff('gainNp', 'ptAll', 5000)),
      skill(3, 7, eff('gainNp', 'ptOne', 5000)));
    const team = [member({ ...altria, skills: [] }, 'alt', { npLv: 5 }), member(bat, 'bat')];
    const q = quest([1000]);
    for (const prune of [true, false]) {
      const r = run(team, mcCombat, q, { prune });
      expect(r.solutions[0].actions).toBe(1);
      expect(r.solutions[0].turns[0][0]).toMatchObject({ kind: 'skill', unit: 'bat', num: 1, target: 'alt' });
    }
    expect(againstBrute(team, q, mcCombat)).toBe(1);
  });
  it('a skill with a demerit is never forced on the last turn (party ATK up + NP seal)', () => {
    const bat = supp(9111, skill(1, 7, eff('gainNp', 'ptOne', 10000)), skill(2, 7, eff('atkUp', 'ptAll', 100, 1), eff('sealNp', 'ptAll', 1, 1)));
    const team = [member({ ...altria, skills: [] }, 'alt', { npLv: 5 }), member(bat, 'bat')];
    const q = quest([1000]);
    const r = run(team, mcCombat, q);
    expect(r.solutions[0].actions).toBe(1);
    expect(r.solutions[0].turns[0]).not.toContainEqual(expect.objectContaining({ unit: 'bat', num: 2 }));
    expect(againstBrute(team, q, mcCombat)).toBe(1);
  });
  it('a self NP loss demerit is paid: the charge must cover it', () => {
    // S1: 100% charge then -50% (demerit): useless alone; S2 adds the missing 50%.
    const bat = supp(9112, skill(1, 7, eff('gainNp', 'ptOne', 10000), eff('lossNp', 'ptOne', 5000)), skill(2, 7, eff('gainNp', 'ptOne', 5000)));
    const team = [member({ ...altria, skills: [] }, 'alt', { npLv: 5 }), member(bat, 'bat')];
    expect(againstBrute(team, quest([1000]), mcCombat)).toBe(2);
  });
  it('shortenSkill moves come last whatever the slot order', () => {
    const C = supp(9201, skill(1, 3, eff('gainNp', 'ptOne', 5000)));
    const H = supp(9202, skill(1, 9, eff('gainNp', 'ptAll', 5000), eff('shortenSkill', 'ptAll', 2)));
    const alt: CompactServant = { ...altria, skills: [altria.skills[2]] }; // S3: self 30%
    const q = quest([1000], [1000]);
    for (const order of [['C', 'H'], ['H', 'C']]) {
      const team = [...order.map((k) => member(k === 'C' ? C : H, k)), member(alt, 'alt', { npLv: 5 })];
      const r = run(team, mcCombat, q);
      expect(r.solutions.length, order.join(',')).toBeGreaterThan(0);
      // Turn 2 needs C again: H's shorten must come after C's use on turn 1.
      expect(r.solutions[0].turns[1]).toContainEqual({ kind: 'skill', unit: 'C', num: 1, target: 'alt' });
    }
  });
});

describe('solve: targeted cases against brute force', () => {
  it('npGainUp on an arts NP carries charge to the next turn', () => {
    // Arts AoE with 3 hits on 2 enemies: ~21% refund, ~84% under +300% NP gain;
    // with S2's 30% only the buffed refund refills the bar for turn 2.
    const arts: CompactServant = { ...altria, id: 9301, skills: [], np: { ...altria.np!, card: 'arts', hits: [33, 33, 34], extra: [] } };
    const s = supp(9302, skill(1, 7, eff('npGainUp', 'ptAll', 3000, 3)), skill(2, 7, eff('gainNp', 'ptOne', 3000)));
    const team = [member(arts, 'arts', { npLv: 5, ce: kaleidoscope, ceLv: 100, ceMlb: true }), member(s, 's')];
    const q = quest([3000, 3000], [3000, 3000]);
    expect(againstBrute(team, q)).toBeLessThan(Infinity);
    // Without the NP gain buff the refund is too small.
    const noGain = supp(9303, skill(2, 7, eff('gainNp', 'ptOne', 3000)));
    expect(againstBrute([team[0], member(noGain, 's')], q)).toBe(Infinity);
  });
  it('a vs-trait buff that only matters on wave 3', () => {
    // Altria starts at 100% and refills 20% per NP: S1 and S2 give the next two bars.
    const s = supp(9311, skill(1, 7, eff('gainNp', 'ptOne', 8000)), skill(2, 7, eff('gainNp', 'ptOne', 8000)),
      skill(3, 7, { ...eff('powerUp', 'ptOne', 1000, 3), opTraits: [77] }));
    const team = [member({ ...altria, skills: [] }, 'alt', { npLv: 5, ce: kaleidoscope, ceLv: 100, ceMlb: true }), member(s, 's')];
    const q: Quest = { waves: [[enemy(10000)], [enemy(10000)], [enemy(35000, [77])]] };
    expect(againstBrute(team, q)).toBeLessThan(Infinity);
    // Without the trait the same wave 3 is out of reach.
    expect(againstBrute(team, { waves: [[enemy(10000)], [enemy(10000)], [enemy(35000)]] })).toBe(Infinity);
  });
  it('a cooldown-2 skill is used on turns 1 and 3', () => {
    // Altria starts empty: S1 (100%, cooldown 2) on turns 1 and 3, S2 (80%) on turn 2.
    const s = supp(9321, skill(1, 2, eff('gainNp', 'ptOne', 10000)), skill(2, 7, eff('gainNp', 'ptOne', 8000)));
    const team = [member({ ...altria, skills: [] }, 'alt', { npLv: 5 }), member(s, 's')];
    expect(againstBrute(team, quest([5000], [5000], [5000]))).toBe(3);
  });
  it('an NP that charges its allies', () => {
    const charger: CompactServant = { ...altria, id: 9331, skills: [],
      np: { ...altria.np!, extra: [eff('gainNp', 'ptOther', 5000)] } };
    const s = supp(9332, skill(1, 7, eff('gainNp', 'ptOne', 10000)));
    const team = [
      member(charger, 'ch', { npLv: 5, ce: kaleidoscope, ceLv: 100, ceMlb: true }),
      member({ ...altria, id: 9333, skills: [] }, 'alt', { npLv: 5 }), member(s, 's'),
    ];
    // Wave 2 needs both NPs: S1 refills the charger, whose extra then tops
    // Altria up from 50% to 100% in the same turn.
    expect(againstBrute(team, quest([5000], [5000, 5000, 40000]))).toBe(1);
  });
  it('NP chain: the 2nd NP of a turn fires at OC2, the 3rd at OC3, and both are needed', () => {
    // NP1 shooters at 100% (OC1 by gauge); damage multiplier 1x / 2x / 3x at OC1 / OC2 / OC3.
    const ocNp = { ...altria.np!, extra: [], mult: [2000, 4000, 6000, 6000, 6000].map((v) => Array(5).fill(v)) };
    const sh = (id: number, key: string) => member({ ...altria, id, skills: [], np: ocNp }, key, { npLv: 1, ce: kaleidoscope, ceLv: 100, ceMlb: true });
    const d1 = fireNp(initBattle([sh(9351, 'a')], mcCombat, 10, quest([1e9]), constants), 'a').minMargin * 1e9;
    // Two NPs: 1x + 2x = 3x clears 2.5x (2x without the chain bonus would not).
    const two = [sh(9351, 'a'), sh(9352, 'b')];
    const q2 = quest([Math.floor(2.5 * d1)]);
    expect(againstBrute(two, q2)).toBe(0);
    expect(run(two, mcB, q2).solutions[0].turns[0].filter((x) => x.kind === 'np')).toHaveLength(2);
    // Three NPs: 1x + 2x + 3x = 6x clears 5.5x; two NPs (3x) do not.
    const three = [...two, sh(9353, 'c')];
    expect(againstBrute(three, quest([Math.floor(5.5 * d1)]))).toBe(0);
    expect(againstBrute(two, quest([Math.floor(5.5 * d1)]))).toBe(Infinity);
  });
  it('a timed CE buff on a back unit and a late swap', () => {
    // The back unit holds a 3-turn atk up from its CE (frozen in the back) and a full bar.
    const ce = { ...kaleidoscope, effectsMlb: [...kaleidoscope.effectsMlb, eff('atkUp', 'self', 1000, 3)] };
    const s = supp(9341, skill(1, 7, eff('gainNp', 'ptOne', 5000)), skill(2, 7, eff('gainNp', 'ptAll', 3000)));
    // Front: alt, s, a skill-less pad; back: late.
    const team = [
      member({ ...altria, skills: [altria.skills[2]] }, 'alt', { npLv: 5, ce: kaleidoscope, ceLv: 100, ceMlb: true }),
      member(s, 's'), member(supp(9343), 'pad'),
      member({ ...altria, id: 9342, skills: [] }, 'late', { npLv: 5, ce, ceLv: 100, ceMlb: true }),
    ];
    const q = quest([10000], [10000], [45000]);
    expect(againstBrute(team, q)).toBeLessThan(Infinity);
    expect(run(team, mcB, q).solutions[0].usesSwap).toBe(true);
  });
});

describe('solve: random instances against brute force', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const mk = (kind: EffectKind, target: TargetKind, value: number, turns = -1, count = -1, extra: Partial<Effect> = {}): Effect =>
    ({ kind, target, lv: fill(value, turns, count), ...extra });
  const randEff = (): Effect => {
    const kind = pick(['atkUp', 'gainNp', 'gainNp', 'npDmgUp', 'powerUp', 'cardUp', 'npGainUp', 'ocUp', 'dmgPlus'] as EffectKind[]);
    const target = pick(['self', 'ptOne', 'ptAll', 'ptOther'] as TargetKind[]);
    const v = kind === 'gainNp' ? pick([1000, 2000, 3000, 5000]) : kind === 'ocUp' ? 1 : kind === 'dmgPlus' ? pick([500, 2000])
      : pick([100, 200, 300, 500]);
    const extra: Partial<Effect> = {};
    if (kind === 'cardUp') extra.cards = [pick(['arts', 'buster'] as const)];
    if (kind === 'powerUp' && rnd() < 0.7) extra.opTraits = [pick([1, 2])];
    return mk(kind, target, v, pick([1, 1, 3, -1]), pick([-1, -1, 1]), extra);
  };
  const randSkills = () => ([1, 2] as const).map((num) => ({
    num, cooldown: Array(10).fill(pick([2, 3, 4, 5, 7])),
    effects: num === 1 ? [mk('gainNp', pick(['ptAll', 'ptOne', 'self'] as TargetKind[]), pick([3000, 5000])), randEff()]
      : [randEff(), ...(rnd() < 0.4 ? [randEff()] : [])],
  }));
  const randSvt = (id: number, shooter: boolean): CompactServant => {
    const base = { ...castoria, id, name: 'R' + id, passives: [], skills: randSkills() };
    if (!shooter) return { ...base, np: null };
    const np = { ...altria.np!, card: pick(['arts', 'buster'] as const),
      extra: rnd() < 0.3 ? [mk('gainNp', pick(['self', 'ptOther'] as TargetKind[]), 2000)] : [] };
    return { ...altria, ...base, np };
  };
  const randEnemy = (hp: number, traits: number[]): Enemy => ({ hp, className: 'assassin', attribute: 'human', traits, tdRate: 1000 });

  // MC without the ptOne charge: fewer branches for the brute force.
  const mcR: CompactMC = { ...mcB, skills: [mcB.skills[0], mcB.skills[2]] };
  // Instances are drawn up front (fixed seed), one test each.
  const cases = Array.from({ length: 20 }, (_, c) => {
    // 3 members: with a back unit the brute force takes seconds to minutes per
    // case; the order change is covered by the targeted and prune on/off tests.
    const team = Array.from({ length: 3 }, (_, i) => member(randSvt(9500 + c * 10 + i, i === 0 || rnd() < 0.4), 'u' + i,
      { npLv: pick([1, 3, 5]), ...(i === 0 && { ce: kaleidoscope, ceLv: 100, ceMlb: rnd() < 0.5 }) }));
    const hp = pick([3000, 6000, 10000, 16000]);
    const q: Quest = { waves: [0, 1, 2].map((w) => Array.from({ length: 1 + Math.floor(rnd() * 2) },
      () => randEnemy(Math.floor(hp * (0.5 + rnd()) * (1 + w * 0.5)), rnd() < 0.5 ? [1] : [2]))) };
    return { team, q };
  });
  const results: number[] = [];
  cases.forEach(({ team, q }, c) => {
    it(`case ${c}: same feasibility and minimum action count`, () => { results.push(againstBrute(team, q, mcR)); }, 30_000);
  });
  it('the mix has feasible and infeasible cases', () => {
    log('random minimum actions:', results.join(' '));
    if (results.length < cases.length) return; // filtered run
    expect(results.filter((b) => b < Infinity).length).toBeGreaterThanOrEqual(5);
    expect(results.filter((b) => b === Infinity).length).toBeGreaterThanOrEqual(3);
  });
});

describe('solve: reinforcements', () => {
  const lay = (field: number[], reserve: number[], refill: number[]) => ({ field, reserve, refill });
  const waves = (...hps: number[][]) => hps.map((w) => w.map((hp) => enemy(hp)));
  const st = (key: string) => member({ ...altria, np: { ...altria.np!, aoe: false } }, key, { npLv: 5, ce: kaleidoscope, ceLv: 100, ceMlb: true });

  it('a 4-enemy wave on 3 slots needs 2 AoE NPs in one turn', () => {
    const q: Quest = { waves: waves([3000, 3000, 3000, 3000]), layouts: [lay([0, 1, 2], [3], [0, 1, 2])] };
    const two = [altK('a'), altK('b')];
    expect(againstBrute(two, q, mcCombat)).toBe(0);
    const sol = run(two, mcCombat, q).solutions[0];
    expect(sol.turns[0].map((x) => x.kind)).toEqual(['np', 'np']);
    // One shooter only clears the field: the reserve is still alive.
    expect(againstBrute([altK('a')], q, mcCombat)).toBe(Infinity);
    // Same HP with no reserve: one NP is enough.
    expect(againstBrute([altK('a')], { waves: waves([3000, 3000, 3000]) }, mcCombat)).toBe(0);
  });
  it('charge for a second shooter on a later wave with a reserve', () => {
    // Wave 2: 5 enemies on 3 slots (slot 0 empty until the first refill).
    const q: Quest = {
      waves: waves([3000], [3000, 3000, 3000, 3000]),
      layouts: [undefined, lay([-1, 0, 1], [2, 3], [0, 1, 2])],
    };
    const s = supp(9401, skill(1, 7, eff('gainNp', 'ptOne', 10000)), skill(2, 7, eff('gainNp', 'ptOne', 8000)));
    const team = [altK('a'), member({ ...altria, id: 9402, skills: [] }, 'b', { npLv: 5 }), member(s, 's')];
    expect(againstBrute(team, q, mcCombat)).toBeLessThan(Infinity);
  });
  it('single-target NPs aim at field slots, one per refill', () => {
    // One slot, two in reserve: three ST NPs, slot 0 every time.
    const q: Quest = { waves: waves([3000, 3000, 3000]), layouts: [lay([0], [1, 2], [0])] };
    const team = [st('a'), st('b'), st('c')];
    expect(againstBrute(team, q, mcCombat)).toBe(0);
    const r = run(team, mcCombat, q);
    expect(r.solutions[0].turns[0]).toHaveLength(3);
    // A fourth enemy needs a fourth NP: out of reach, cut by the damage bound.
    const q4: Quest = { waves: waves([3000, 3000, 3000, 3000]), layouts: [lay([0], [1, 2, 3], [0])] };
    expect(againstBrute(team, q4, mcCombat)).toBe(Infinity);
    const r4 = run(team, mcCombat, q4);
    expect(r4.exhausted).toBe(true);
    expect(r4.stats.boundPrunes).toBeGreaterThan(0);
    expect(r4.stats.npFires).toBe(0);
  });
  it('two ST shooters on two slots with a reserve of one, prunes on and off agree', () => {
    const q: Quest = { waves: waves([3000, 3000, 3000]), layouts: [lay([0, 1], [2], [0, 1])] };
    const team = [st('a'), st('b'), st('c')];
    expect(againstBrute(team, q, mcCombat)).toBe(0);
    for (const prune of [true, false]) {
      const r = run(team, mcCombat, q, { prune });
      expect(r.solutions[0].actions).toBe(0);
      checkSolutions(team, mcCombat, q, r.solutions);
    }
  });
});

describe('solve: enemy defence', () => {
  it('defUp and dmgCut can make a wave need a buff; the bound agrees with brute force', () => {
    const s = supp(9501, skill(1, 7, eff('atkUp', 'ptAll', 500, 3)));
    const team = [altK('a'), member(s, 's')];
    const hp = 20000;
    const plain = run(team, mcCombat, { waves: [[enemy(hp)]] }).solutions[0].actions;
    expect(plain).toBe(0);
    const def: Quest = { waves: [[{ ...enemy(hp), defUp: 500, dmgCut: 3000 }]] };
    const b = againstBrute(team, def, mcCombat);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(Infinity);
    const tough: Quest = { waves: [[{ ...enemy(hp), defUp: 1000, dmgCut: 100_000 }]] };
    expect(againstBrute(team, tough, mcCombat)).toBe(Infinity);
    expect(run(team, mcCombat, tough).stats.npFires).toBe(0);
  });
});

describe('solve: fuzz regressions against brute force', () => {
  // Generator of the Task 20 review fuzz (same draws, same order), replayed up
  // to the failing case. Before the memo kept the best action count per key
  // (and the turn start inside the last turn), these found one action more.
  function fuzzCase(seed0: number, target: number, maxE: number, layoutsOn: boolean) {
    let seed = seed0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const randLayout = (n: number, first: boolean) => {
      const slots = 1 + Math.floor(rnd() * 3);
      const field: number[] = Array(slots).fill(-1);
      let i = 0;
      for (let s = 0; s < slots && i < n; s++) { if (!first && rnd() < 0.25 && s > 0) continue; field[s] = i++; }
      const reserve: number[] = []; for (; i < n; i++) reserve.push(i);
      let refill = Array.from({ length: slots }, (_, s) => s);
      for (let k = refill.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [refill[k], refill[j]] = [refill[j], refill[k]]; }
      if (refill.length > 1 && rnd() < 0.4) refill = refill.slice(0, 1 + Math.floor(rnd() * (refill.length - 1)));
      if (first) for (const s of refill) if (field[s] < 0 && reserve.length) field[s] = reserve.splice(0, 1)[0];
      return { field, reserve, refill };
    };
    const svt = (id: number, aoe: boolean, g: number): CompactServant => ({
      ...altria, id, name: 'R' + id, passives: [],
      np: { ...altria.np!, aoe, extra: rnd() < 0.3 ? [eff('gainNp', 'ptOther', 2000)] : [] },
      skills: [skill(1, pick([3, 5, 7]), eff('gainNp', pick(['self', 'ptOne', 'ptAll'] as TargetKind[]), g)),
        skill(2, 5, eff(pick(['atkUp', 'npDmgUp'] as EffectKind[]), 'ptAll', pick([200, 500]), 3))],
    });
    for (let c = 0; ; c++) {
      const team = Array.from({ length: 3 }, (_, i) => member(svt(9700 + c * 10 + i, rnd() < 0.5, pick([5000, 10000])), 'u' + i,
        { npLv: pick([1, 5]), ...(i === 0 && { ce: kaleidoscope, ceLv: 100, ceMlb: true }) }));
      const nw = 1 + Math.floor(rnd() * 2);
      const hpBase = pick([3000, 8000, 15000, 25000]);
      const waves = Array.from({ length: nw }, () => Array.from({ length: 1 + Math.floor(rnd() * maxE) },
        () => ({ ...enemy(Math.floor(hpBase * (0.3 + rnd()))), tdRate: 1000 })));
      const layouts = waves.map((w, wi) => randLayout(w.length, wi === 0));
      if (c === target) return { team, q: (layoutsOn ? { waves, layouts } : { waves }) as Quest };
    }
  }
  const mcF: CompactMC = { id: 9, name: 'm', unsupported: [], skills: [{ num: 1, cooldown: Array(10).fill(5), effects: [eff('atkUp', 'ptAll', 200, 1)] }] };
  for (const [seed, c, maxE, lay] of [[777, 28, 5, false], [57, 81, 6, true], [5678, 94, 6, true], [3, 97, 7, true]] as const) {
    it(`seed ${seed} case ${c}`, () => {
      const { team, q } = fuzzCase(seed, c, maxE, lay);
      const b = againstBrute(team, q, mcF);
      expect(run(team, mcF, q, { prune: false }).solutions[0]?.actions ?? Infinity).toBe(b);
    });
  }
});

describe('solve: random instances with per-part marks against brute force', () => {
  // Skills that are unsupported (must never be used: they carry a big charge
  // that would make an otherwise impossible case feasible), last-turn-only,
  // or with deferred effects (a delayed buff next turn, an NP drain at the
  // turn end), plus buff effectiveness up. Same checks as the random instances.
  // PERPART_SEED / PERPART_N: wider offline runs (default: the committed 16 cases).
  let seed = Number(env.PERPART_SEED ?? 4242);
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const mk = (kind: EffectKind, target: TargetKind, value: number, turns = -1, extra: Partial<Effect> = {}): Effect =>
    ({ kind, target, lv: fill(value, turns), ...extra });
  const randEff = (): Effect => {
    const r = rnd();
    if (r < 0.2) return mk(pick(['atkUp', 'npDmgUp'] as EffectKind[]), pick(['self', 'ptOne'] as TargetKind[]), pick([300, 500]), 1,
      { deferred: { at: 'delay', turns: pick([1, 1, 2]) }, buffTraits: [3030] });
    if (r < 0.35) return mk('lossNp', pick(['self', 'ptOne'] as TargetKind[]), pick([2000, 5000]), -1, { deferred: { at: 'turnEnd', turns: pick([1, 2]) } });
    if (r < 0.45) return mk('buffRate', pick(['self', 'ptOne', 'ptAll'] as TargetKind[]), pick([500, 1000]), pick([1, 3]), { rateOf: [3030] });
    const kind = pick(['atkUp', 'gainNp', 'npDmgUp', 'powerUp'] as EffectKind[]);
    const v = kind === 'gainNp' ? pick([2000, 3000, 5000]) : pick([200, 300, 500]);
    return mk(kind, pick(['self', 'ptOne', 'ptAll'] as TargetKind[]), v, pick([1, 3, -1]), kind === 'npDmgUp' ? { buffTraits: [3030] } : {});
  };
  const randSkills = () => ([1, 2, 3] as const).map((num) => {
    const sk: CompactServant['skills'][number] = {
      num, cooldown: Array(10).fill(pick([2, 3, 5, 7])),
      effects: num === 1 ? [mk('gainNp', pick(['ptAll', 'ptOne', 'self'] as TargetKind[]), pick([5000, 10000])), randEff()] : [randEff(), randEff()],
    };
    const m = rnd();
    if (m < 0.15) return { ...sk, effects: [...sk.effects, mk('gainNp', 'ptAll', 10000), mk('atkUp', 'ptAll', 1000, 3)], unsupported: ['test:unsupported'] };
    if (m < 0.3) return { ...sk, lastTurnOnly: ['test:turnEnd'] };
    return sk;
  });
  const randSvt = (id: number, shooter: boolean): CompactServant => {
    const base = { ...castoria, id, name: 'P' + id, passives: [], skills: randSkills() };
    if (!shooter) return { ...base, np: null };
    const np = { ...altria.np!, card: pick(['arts', 'buster'] as const), extra: [],
      // An unsupported NP never fires: a unit with one is not a shooter.
      ...(rnd() < 0.15 && { unsupported: ['test:np'] }) };
    return { ...altria, ...base, np };
  };
  const mcR: CompactMC = { ...mcB, skills: [mcB.skills[0], mcB.skills[2]] };
  const cases = Array.from({ length: Number(env.PERPART_N ?? 16) }, (_, c) => {
    const team = Array.from({ length: 3 }, (_, i) => member(randSvt(9800 + c * 10 + i, i === 0 || rnd() < 0.4), 'u' + i,
      { npLv: pick([1, 3]), ...(i === 0 && { ce: kaleidoscope, ceLv: 100, ceMlb: rnd() < 0.5 }) }));
    const hp = pick([1500, 3000, 5000, 8000]);
    const q: Quest = { waves: [0, 1, 2].map((w) => Array.from({ length: 1 + Math.floor(rnd() * 2) },
      () => ({ hp: Math.floor(hp * (0.5 + rnd()) * (1 + w * 0.5)), className: 'assassin', attribute: 'human', traits: [], tdRate: 1000 }))) };
    return { team, q };
  });
  const results: number[] = [];
  cases.forEach(({ team, q }, c) => {
    it(`case ${c}: same feasibility and minimum action count`, () => {
      results.push(againstBrute(team, q, mcR));
      // Never an unsupported part, never a last-turn-only skill before the last turn.
      const r = run(team, mcR, q, { maxMs: 20_000 });
      for (const sol of r.solutions) sol.turns.forEach((turn, t) => turn.forEach((st) => {
        const svt = team.find((m) => m.key === st.unit)?.svt;
        if (!svt) return;
        if (st.kind === 'np') { expect(svt.np?.unsupported).toBeUndefined(); return; }
        const sk = svt.skills.find((k) => k.num === st.num)!;
        expect(sk.unsupported).toBeUndefined();
        if (sk.lastTurnOnly) expect(t).toBe(q.waves.length - 1);
      }));
    }, 60_000);
  });
  it('the mix has feasible and infeasible cases', () => {
    log('per-part random minimum actions:', results.join(' '));
    if (results.length < cases.length) return; // filtered run
    expect(results.filter((b) => b < Infinity).length).toBeGreaterThanOrEqual(4);
    expect(results.filter((b) => b === Infinity).length).toBeGreaterThanOrEqual(2);
  });
});
