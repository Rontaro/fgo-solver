import { describe, it, expect } from 'vitest';
import type { CompactServant, NoblePhantasm } from '../data/types';
import { initBattle, useSkill, affinity, type BattleState, type Enemy, type Buff, type Unit } from './state';
import { fireNp } from './np';
import { npDamage } from './damage';
import { altria, siegfried, castoria, mcCombat, prisonRuins, constants, member } from './test-helpers';

const lvs = (value: number, turns = -1, count = -1) => Array.from({ length: 5 }, () => ({ value, turns, count }));
const grid = (v: number) => Array.from({ length: 5 }, () => Array(5).fill(v));
const enemy = (over: Partial<Enemy> = {}): Enemy =>
  ({ hp: 10_000_000, className: 'assassin', attribute: 'human', traits: [], tdRate: 900, ...over });

const battle = (svt: CompactServant, over: Parameters<typeof member>[2] = {}): BattleState =>
  initBattle([member(svt, 'u', over), member(castoria, 'cas')], mcCombat, 10, prisonRuins, constants);
const u = (s: BattleState, key = 'u') => s.front.find((x) => x?.key === key)!;
const edit = (s: BattleState, f: (x: Unit) => Unit, key = 'u'): BattleState =>
  ({ ...s, front: s.front.map((y) => (y && y.key === key ? f(y) : y)) });
const withGauge = (s: BattleState, gauge: number) => edit(s, (x) => ({ ...x, gauge }));
const withBuffs = (s: BattleState, ...buffs: Buff[]) => edit(s, (x) => ({ ...x, buffs: [...x.buffs, ...buffs] }));
// Replaces the wave and recomputes the affinity table, as nextWave does.
const withEnemies = (s: BattleState, ...enemies: Enemy[]): BattleState => {
  const units = [...s.front, ...s.back].filter((x): x is Unit => x !== null);
  const field = enemies.map((_, i) => i);
  return { ...s, enemies, field, reserve: [], refill: field, retarget: field, aff: Object.fromEntries(units.map((x) => [x.key, enemies.map((e) => affinity(constants, x.svt, e))])) };
};

// Altria-like base input for npDamage (lv90 atk 11221, buster AoE).
const dmgBase = { atk: 11221, mult: 6000, card: 'buster' as const, cardMod: 0, classAtk: 1000, triangle: 1000,
  attribute: 1100, atkMod: 0, defMod: 0, npDmgMod: 0, powerMod: 0, seMult: 1000, dmgPlus: 0 };

// Synthetic arts AoE caster: npRate 54, 3 hits.
const artsNp: NoblePhantasm = {
  card: 'arts', aoe: true, mult: grid(4500), hits: [16, 33, 51], npRate: Array(5).fill(54), extra: [],
};
const artsCaster: CompactServant = {
  ...castoria, id: 2, name: 'Arts Caster', passives: [], atkGrowth: Array(120).fill(10000), np: artsNp,
};

describe('fireNp: Altria NP5 on Prison Ruins wave 1', () => {
  const s0 = withGauge(battle(altria, { npLv: 5 }), 10000);
  const r = fireNp(s0, 'u');

  it('damage = floor(11221*6*1.5*1.1*0.23*0.9) = 22995 on every assassin', () => {
    expect(npDamage(dmgBase)).toBe(22995);
    expect(r.state.enemies.map((e) => e.hp)).toEqual([10358 - 22995, 10358 - 22995, 13074 - 22995]);
  });
  it('kills all, minMargin = 22995 / 13074', () => {
    expect(r.killedAll).toBe(true);
    expect(r.minMargin).toBeCloseTo(22995 / 13074, 10);
    expect(r.minMargin).toBeCloseTo(1.7588, 4);
  });
  it('gauge goes to 0, buster refund is 0, then the post extra gainNp OC1 (+2000)', () => {
    expect(u(r.state).gauge).toBe(2000);
  });
  it('does not mutate the input state', () => {
    expect(s0.enemies.map((e) => e.hp)).toEqual([10358, 10358, 13074]);
    expect(u(s0).gauge).toBe(10000);
  });
  it('throws below 100% gauge', () => {
    expect(() => fireNp(withGauge(s0, 9999), 'u')).toThrow();
  });
  it('a surviving enemy means killedAll false and margin < 1', () => {
    const s = withEnemies(s0, enemy({ hp: 1000 }), enemy({ hp: 45990 }));
    const res = fireNp(s, 'u');
    expect(res.killedAll).toBe(false);
    expect(res.minMargin).toBeCloseTo(22995 / 45990, 10);
  });
});

describe('fireNp: arts refund', () => {
  const s0 = withGauge(battle(artsCaster), 10000);
  // caster vs assassin 2000, caster classAtk 900, star vs human 1000
  const D = npDamage({ ...dmgBase, atk: 10000, mult: 4500, card: 'arts', classAtk: 900, triangle: 2000, attribute: 1000 });

  it('no overkill: 3 hits x floor(54*3*0.9) = 3 x 145', () => {
    const r = fireNp(withEnemies(s0, enemy()), 'u');
    expect(r.state.enemies[0].hp).toBe(10_000_000 - D);
    expect(u(r.state).gauge).toBe(3 * 145);
  });
  it('enemy dies on hit 2: 145 + 218 + 218', () => {
    const r = fireNp(withEnemies(s0, enemy({ hp: Math.floor(D * 0.3) })), 'u');
    expect(u(r.state).gauge).toBe(145 + 218 + 218);
  });
  it('AoE refund sums over targets', () => {
    const r = fireNp(withEnemies(s0, enemy(), enemy({ hp: 1 })), 'u');
    expect(u(r.state).gauge).toBe(3 * 145 + 3 * 218);
  });
  it('npGainUp and arts cardUp raise the refund', () => {
    const s = withBuffs(s0, { kind: 'npGainUp', value: 300, turns: 3, count: -1 },
      { kind: 'cardUp', value: 500, turns: 3, count: -1, cards: ['arts'] });
    const r = fireNp(withEnemies(s, enemy()), 'u');
    // floor(54*3*1.5*0.9*1.3) = 284
    expect(u(r.state).gauge).toBe(3 * 284);
  });
});

describe('fireNp: overcharge', () => {
  const s0 = battle(altria, { npLv: 5 });
  it('gauge 20000 = OC2: post extra gainNp uses oc[1] = 2750', () => {
    expect(u(fireNp(withGauge(s0, 20000), 'u').state).gauge).toBe(2750);
  });
  it('gauge 30000 = OC3: 3500', () => {
    expect(u(fireNp(withGauge(s0, 30000), 'u').state).gauge).toBe(3500);
  });
  it('ocUp adds whole levels, capped at OC5, and a count-1 ocUp is consumed', () => {
    const s = withBuffs(withGauge(s0, 20000), { kind: 'ocUp', value: 2, turns: 1, count: 1 });
    const r = fireNp(s, 'u');
    expect(u(r.state).gauge).toBe(4250); // 2 + 2 = OC4
    expect(u(r.state).buffs.some((b) => b.kind === 'ocUp')).toBe(false);
  });
  it('ocUp beyond 5 is capped', () => {
    const s = withBuffs(withGauge(s0, 30000), { kind: 'ocUp', value: 9, turns: 1, count: -1 });
    expect(u(fireNp(s, 'u').state).gauge).toBe(5000);
  });
});

describe('fireNp: supereffective', () => {
  const s0 = withGauge(battle(siegfried), 10000);
  const base = { ...dmgBase, atk: 9040, mult: 4000 };
  it('Siegfried vs trait 2002: seMult 1500 at OC1, 1000 otherwise', () => {
    const r = fireNp(withEnemies(s0, enemy({ traits: [2002] }), enemy({ traits: [1] })), 'u');
    expect(10_000_000 - r.state.enemies[0].hp).toBe(npDamage({ ...base, seMult: 1500 }));
    expect(10_000_000 - r.state.enemies[1].hp).toBe(npDamage({ ...base, seMult: 1000 }));
  });
  it('seMult follows OC: 1625 at OC2 (NP2, 200% gauge)', () => {
    const s = withGauge(battle(siegfried, { npLv: 2 }), 20000);
    const r = fireNp(withEnemies(s, enemy({ traits: [2002] })), 'u');
    expect(10_000_000 - r.state.enemies[0].hp).toBe(npDamage({ ...base, mult: 5000, seMult: 1625 }));
  });
  it('end to end: Siegfried NP1 lv90, S1 + S3 at lv10, vs a dragon assassin (human)', () => {
    // S1: gainNp 3000, atkUp 300. S3: powerUp 800 vs 2002, buster cardUp 500.
    // 9040 * 4.0 * 1.5 (buster) * 1.5 (card) * 1.0 (saber) * 1.0 (vs assassin) * 1.1 (earth vs human)
    //   * 0.9 * 0.23 * (1 + 0.3) * (1 + 0.8) * 1.5 (SE OC1) = 65025.1087...
    let s = withEnemies(battle(siegfried), enemy({ hp: 1_000_000, traits: [2002] }));
    s = useSkill(useSkill(withGauge(s, 7000), 'u', 1), 'u', 3);
    expect(u(s).gauge).toBe(10000);
    const r = fireNp(s, 'u');
    expect(1_000_000 - r.state.enemies[0].hp).toBe(65025);
    expect(u(r.state).gauge).toBe(0); // buster refund 0, post extra is npGainUp
    expect(u(r.state).buffs).toContainEqual({ kind: 'npGainUp', value: 200, turns: 3, count: -1 });
  });
});

describe('fireNp: buffs', () => {
  const s0 = withGauge(battle(altria, { npLv: 5 }), 10000);
  it('powerUp with opTraits counts only vs enemies with the trait (Castoria S3)', () => {
    const s = withEnemies(useSkill(s0, 'cas', 3, 'u'), enemy({ traits: [1172] }), enemy());
    const r = fireNp(s, 'u');
    expect(10_000_000 - r.state.enemies[0].hp).toBe(npDamage({ ...dmgBase, powerMod: 500 }));
    expect(10_000_000 - r.state.enemies[1].hp).toBe(npDamage(dmgBase));
  });
  it('count buffs that applied lose one count and are removed at 0; others are kept', () => {
    const s = withEnemies(withBuffs(s0,
      { kind: 'npDmgUp', value: 300, turns: -1, count: 1 },
      { kind: 'cardUp', value: 200, turns: -1, count: 2, cards: ['buster'] },
      { kind: 'cardUp', value: 100, turns: -1, count: 1, cards: ['arts'] },
      { kind: 'powerUp', value: 400, turns: -1, count: 1, opTraits: [999] },
      { kind: 'atkUp', value: 100, turns: 3, count: -1 },
    ), enemy());
    const r = fireNp(s, 'u');
    expect(10_000_000 - r.state.enemies[0].hp).toBe(npDamage({ ...dmgBase, npDmgMod: 300, cardMod: 200, atkMod: 100 }));
    const left = u(r.state).buffs;
    expect(left.some((b) => b.kind === 'npDmgUp')).toBe(false);
    expect(left).toContainEqual({ kind: 'cardUp', value: 200, turns: -1, count: 1, cards: ['buster'] });
    expect(left).toContainEqual({ kind: 'cardUp', value: 100, turns: -1, count: 1, cards: ['arts'] });
    expect(left).toContainEqual({ kind: 'powerUp', value: 400, turns: -1, count: 1, opTraits: [999] });
    expect(left).toContainEqual({ kind: 'atkUp', value: 100, turns: 3, count: -1 });
    // the input state keeps its buffs
    expect(u(s).buffs.find((b) => b.kind === 'npDmgUp')!.count).toBe(1);
  });
  it('dmgPlus adds flat damage', () => {
    const s = withEnemies(withBuffs(s0, { kind: 'dmgPlus', value: 500, turns: -1, count: 1 }), enemy());
    const r = fireNp(s, 'u');
    expect(10_000_000 - r.state.enemies[0].hp).toBe(npDamage(dmgBase) + 500);
    expect(u(r.state).buffs.some((b) => b.kind === 'dmgPlus')).toBe(false);
  });
  it('pre extras apply before the damage, with OC values', () => {
    const np = { ...altria.np!, extra: [{
      kind: 'npDmgUp' as const, target: 'self' as const, pre: true, lv: lvs(100, 1),
      oc: [lvs(100, 1), lvs(200, 1), lvs(300, 1), lvs(400, 1), lvs(500, 1)],
    }] };
    const s = withEnemies(withGauge(battle({ ...altria, np }, { npLv: 5 }), 20000), enemy());
    const r = fireNp(s, 'u');
    expect(10_000_000 - r.state.enemies[0].hp).toBe(npDamage({ ...dmgBase, npDmgMod: 200 }));
    expect(u(r.state).buffs).toContainEqual({ kind: 'npDmgUp', value: 200, turns: 1, count: -1 });
  });
});

describe('fireNp: targeting', () => {
  it('single-target NP hits the first living enemy only', () => {
    const st = { ...altria, np: { ...altria.np!, aoe: false } };
    const s = withEnemies(withGauge(battle(st, { npLv: 5 }), 10000), enemy({ hp: 0 }), enemy(), enemy());
    const r = fireNp(s, 'u');
    expect(r.state.enemies.map((e) => e.hp)).toEqual([0, 10_000_000 - npDamage(dmgBase), 10_000_000]);
    expect(r.killedAll).toBe(false);
    expect(r.minMargin).toBeCloseTo(npDamage(dmgBase) / 10_000_000, 12);
  });
  it('AoE skips dead enemies', () => {
    const s = withEnemies(withGauge(battle(altria, { npLv: 5 }), 10000), enemy({ hp: -5 }), enemy({ hp: 100 }));
    const r = fireNp(s, 'u');
    expect(r.state.enemies[0].hp).toBe(-5);
    expect(r.killedAll).toBe(true);
    expect(r.minMargin).toBeCloseTo(npDamage(dmgBase) / 100, 8);
  });
});

describe('fireNp: extras and targets', () => {
  const party = (extra: NoblePhantasm['extra']) =>
    withEnemies(withGauge(battle({ ...altria, np: { ...altria.np!, extra } }, { npLv: 5 }), 10000), enemy());

  it('a pre gainNp extra lands after the gauge reset', () => {
    const r = fireNp(party([{ kind: 'gainNp', target: 'self', pre: true, lv: lvs(5000) }]), 'u');
    expect(u(r.state).gauge).toBe(5000); // reset to 0, +5000, buster refund 0
  });
  it('ptAll extras go to the alive front line; ptOne extras are skipped', () => {
    const r = fireNp(party([
      { kind: 'atkUp', target: 'ptAll', lv: lvs(100, 3) },
      { kind: 'gainNp', target: 'ptOne', lv: lvs(5000) },
    ]), 'u');
    for (const k of ['u', 'cas']) expect(u(r.state, k).buffs).toContainEqual({ kind: 'atkUp', value: 100, turns: 3, count: -1 });
    expect(u(r.state, 'cas').gauge).toBe(0);
    expect(u(r.state).gauge).toBe(0);
  });
  it('the refund is capped by NP level', () => {
    const s = withEnemies(withGauge(battle(artsCaster), 10000), enemy({ hp: 1 }));
    const big = withBuffs(s, { kind: 'npGainUp', value: 50000, turns: 3, count: -1 });
    expect(u(fireNp(big, 'u').state).gauge).toBe(10000); // NP1 cap: 100%
  });
  it('targetIndex picks the single target', () => {
    const st = { ...altria, np: { ...altria.np!, aoe: false } };
    const s = withEnemies(withGauge(battle(st, { npLv: 5 }), 10000), enemy(), enemy(), enemy({ hp: 0 }));
    const r = fireNp(s, 'u', 1);
    expect(r.state.enemies.map((e) => e.hp)).toEqual([10_000_000, 10_000_000 - npDamage(dmgBase), 0]);
    expect(() => fireNp(s, 'u', 2)).toThrow(/not alive/);
    expect(() => fireNp(s, 'u', 7)).toThrow(/not alive/);
  });
  it('shares the back line and does not mutate enemies', () => {
    const s = withGauge(battle(altria, { npLv: 5 }), 10000);
    const r = fireNp(s, 'u');
    expect(r.state.back).toBe(s.back);
    expect(s.enemies.map((e) => e.hp)).toEqual([10358, 10358, 13074]);
    expect(prisonRuins.waves[0].map((e) => e.hp)).toEqual([10358, 10358, 13074]);
  });
});

describe('fireNp: reinforcements', () => {
  // Wave of 5 on 3 slots: field [0, 1, 2], reserve [3, 4] (see quest.ts layout).
  const D = npDamage(dmgBase);
  const reinforced = (st: CompactServant, hps: number[], refill = [0, 1, 2]) => {
    const enemies = hps.map((hp) => enemy({ hp }));
    const s = battle(st, { npLv: 5 });
    const units = [...s.front, ...s.back].filter((x): x is Unit => x !== null);
    return withGauge({
      ...s, enemies, field: [0, 1, 2], reserve: hps.slice(3).map((_, i) => i + 3), refill, retarget: hps.map((_, i) => i),
      aff: Object.fromEntries(units.map((x) => [x.key, enemies.map((e) => affinity(constants, x.svt, e))])),
    }, 10000);
  };
  it('after an AoE NP the dead slots take the reserve in order; killedAll waits for the reserve', () => {
    const s = reinforced(altria, [1, 10_000_000, 1, 1, 1]);
    const r = fireNp(s, 'u');
    expect(r.killedAll).toBe(false);
    expect(r.state.field).toEqual([3, 1, 4]);
    expect(r.state.reserve).toEqual([]);
    expect(r.state.enemies.map((e) => e.hp)).toEqual([1 - D, 10_000_000 - D, 1 - D, 1, 1]);
    // The next NP hits the enemies that just entered.
    const r2 = fireNp({ ...withGauge(r.state, 10000) }, 'u');
    expect(r2.state.enemies.map((e) => e.hp)).toEqual([1 - D, 10_000_000 - 2 * D, 1 - D, 1 - D, 1 - D]);
  });
  it('kills the whole wave with two AoE NPs, not one', () => {
    const s = reinforced(altria, [1, 1, 1, 1]);
    const r = fireNp(s, 'u');
    expect(r.killedAll).toBe(false);
    expect(r.state.field).toEqual([3, 1, 2]);
    expect(r.state.reserve).toEqual([]);
    expect(fireNp(withGauge(r.state, 10000), 'u').killedAll).toBe(true);
  });
  it('single-target targetIndex is a field slot; the refill order follows refill', () => {
    const st = { ...altria, np: { ...altria.np!, aoe: false } };
    const s = reinforced(st, [10_000_000, 1, 10_000_000, 7, 8], [2, 1, 0]);
    const r = fireNp(s, 'u', 1);
    expect(r.state.field).toEqual([0, 3, 2]);
    expect(r.state.reserve).toEqual([4]);
    // One target per turn, chosen before the NPs.
    expect(() => fireNp(withGauge(r.state, 10000), 'u', 1)).toThrow(/before the NPs/);
  });
  it('one target per turn: after it dies, the next ST NP hits the first living field enemy, not the newcomer', () => {
    // Field A, B, C, reserve D. NP1 on A kills it, D enters slot 0; NP2 hits B.
    const st = { ...altria, np: { ...altria.np!, aoe: false } };
    const s = reinforced(st, [1, 10_000_000, 10_000_000, 10_000_000]);
    const r = fireNp(s, 'u', 0);
    expect(r.state.field).toEqual([3, 1, 2]);
    const r2 = fireNp(withGauge(r.state, 10000), 'u');
    expect(r2.state.enemies.map((e) => e.hp)).toEqual([1 - D, 10_000_000 - D, 10_000_000, 10_000_000]);
    // The target stays while it lives: chosen C, both NPs hit C.
    const c = fireNp(withGauge(fireNp(s, 'u', 2).state, 10000), 'u');
    expect(c.state.enemies[2].hp).toBe(10_000_000 - 2 * D);
  });
  it('the retarget order decides the auto target', () => {
    const st = { ...altria, np: { ...altria.np!, aoe: false } };
    const s = { ...reinforced(st, [10_000_000, 10_000_000, 10_000_000]), retarget: [2, 0, 1] };
    expect(fireNp(s, 'u').state.enemies[2].hp).toBe(10_000_000 - D);
  });
});

describe('fireNp: enemy defence', () => {
  it('defUp lowers the attack term and dmgCut is taken off the total, never below 0', () => {
    const s = withEnemies(withGauge(battle(altria, { npLv: 5 }), 10000),
      enemy({ defUp: 200 }), enemy({ dmgCut: 1000 }), enemy({ dmgCut: 10_000_000 }));
    const r = fireNp(s, 'u');
    expect(10_000_000 - r.state.enemies[0].hp).toBe(npDamage({ ...dmgBase, defMod: 200 }));
    expect(10_000_000 - r.state.enemies[1].hp).toBe(npDamage(dmgBase) - 1000);
    expect(r.state.enemies[2].hp).toBe(10_000_000);
  });
});
