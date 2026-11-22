import { describe, it, expect } from 'vitest';
import type { CompactServant, Constants, Effect } from '../data/types';
import {
  initBattle, useSkill, useMc, endTurn, nextWave, mods, gaugeCap,
  type BattleState, type Enemy, type Unit, type TeamMember,
} from './state';
import { castoria, altria, siegfried, kaleidoscope, mcCombat, prisonRuins, constants, member } from './test-helpers';

const lv = (value: number, turns = -1, count = -1) => ({ value, turns, count });
const fill = (value: number, turns = -1, count = -1) => Array.from({ length: 10 }, () => lv(value, turns, count));

// Synthetic support: S1 shortenSkill 2 on ptOne, S2 a 0-valued (not guaranteed) gainNp, S3 ptOther atkUp.
const shortener: CompactServant = {
  ...castoria, id: 1, name: 'Shortener', passives: [],
  skills: [
    { num: 1, cooldown: Array(10).fill(5), effects: [{ kind: 'shortenSkill', target: 'ptOne', lv: fill(2) }] },
    { num: 2, cooldown: Array(10).fill(5), effects: [{ kind: 'gainNp', target: 'self', lv: fill(0) }] },
    { num: 3, cooldown: Array(10).fill(5), effects: [{ kind: 'atkUp', target: 'ptOther', lv: fill(100, 3) }] },
  ],
};

const cas = () => member(castoria, 'cas', { npLv: 5, append2Lv: 10, ce: kaleidoscope, ceLv: 100, ceMlb: true });
const start = (members: TeamMember[]) => initBattle(members, mcCombat, 10, prisonRuins, constants);
// cas, alt, sieg in front; short in the back.
const team = () => start([cas(), member(altria, 'alt', { npLv: 5 }), member(siegfried, 'sieg'), member(shortener, 'short')]);
// cas, short, alt in front; sieg in the back.
const team2 = () => start([cas(), member(shortener, 'short'), member(altria, 'alt', { npLv: 5 }), member(siegfried, 'sieg')]);
const unit = (s: BattleState, key: string): Unit => [...s.front, ...s.back].find((u) => u?.key === key)!;
const enemy = (over: Partial<Enemy> = {}): Enemy =>
  ({ hp: 100000, className: 'assassin', attribute: 'human', traits: [], tdRate: 900, ...over });
// endTurn requires a cleared wave.
const clear = (s: BattleState): BattleState => ({ ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 0 })) });
const end = (s: BattleState): BattleState => endTurn(clear(s));
const setGauge = (s: BattleState, key: string, gauge: number): BattleState =>
  ({ ...s, front: s.front.map((u) => (u && u.key === key ? { ...u, gauge } : u)) });

describe('initBattle', () => {
  it('Castoria NP5 + Kaleidoscope MLB + append 2 lv10 starts at 12000', () => {
    expect(unit(team(), 'cas').gauge).toBe(12000);
  });
  it('atk = atkGrowth[lv-1] + fou + CE atk', () => {
    const s = team();
    expect(unit(s, 'alt').atk).toBe(11221);
    expect(unit(s, 'cas').atk).toBe(10546 + 2000);
    expect(unit(start([member(altria, 'a', { lv: 80, fou: 1000 })]), 'a').atk).toBe(10148 + 1000);
  });
  it('starting gauge is capped by NP level and 0 without append/CE', () => {
    const huge = { ...kaleidoscope, effectsMlb: [{ ...kaleidoscope.effectsMlb[0], lv: [lv(40000)] }] };
    const g = (npLv: number) => unit(start([member(castoria, 'c', { npLv, ce: huge, ceMlb: true })]), 'c').gauge;
    expect([g(1), g(2), g(4), g(5)]).toEqual([10000, 20000, 20000, 30000]);
    expect(unit(team(), 'alt').gauge).toBe(0);
  });
  it('NP1 Castoria with the same setup is capped at 100%', () => {
    expect(unit(start([{ ...cas(), npLv: 1 }]), 'cas').gauge).toBe(10000);
  });
  it('non-MLB CE uses the base effects', () => {
    expect(unit(start([member(castoria, 'c', { ce: kaleidoscope })]), 'c').gauge).toBe(8000);
  });
  it('permanent passives and CE buffs become buffs', () => {
    const ceBuff: Effect = { kind: 'npDmgUp', target: 'self', lv: [lv(150, -1)] };
    const ce = { ...kaleidoscope, effects: [ceBuff, { kind: 'atkUp' as const, target: 'self' as const, lv: [lv(100, 3)] }] };
    expect(unit(start([member(altria, 'a', { ce })]), 'a').buffs).toEqual([
      { kind: 'cardUp', value: 80, turns: -1, count: -1, cards: ['quick'] },
      { kind: 'npDmgUp', value: 150, turns: -1, count: -1 },
      { kind: 'atkUp', value: 100, turns: 3, count: -1 },
    ]);
  });
  it('first 3 members on the front line, the rest in the back; wave 1 loaded', () => {
    const s = team();
    expect(s.front.map((u) => u?.key)).toEqual(['cas', 'alt', 'sieg']);
    expect(s.back.map((u) => u.key)).toEqual(['short']);
    expect(s).toMatchObject({ turn: 1, wave: 0, swapped: false, mcCd: [0, 0, 0] });
    expect(s.enemies.map((e) => e.hp)).toEqual([10358, 10358, 13074]);
    expect(unit(s, 'alt').cd).toEqual([0, 0, 0]);
  });
  it('resolves affinity per unit and enemy, back line included', () => {
    const s = team();
    expect(s.aff.alt).toEqual(Array(3).fill({ classAtk: 1000, triangle: 1000, attribute: 1100 }));
    expect(s.aff.short[0]).toEqual({ classAtk: 900, triangle: 2000, attribute: 1000 }); // caster star vs assassin human
  });
  it('throws on duplicate keys, an empty quest and a bad fou', () => {
    expect(() => start([member(altria, 'a'), member(siegfried, 'a')])).toThrow(/duplicate/);
    expect(() => initBattle([member(altria, 'a')], mcCombat, 10, { waves: [] }, constants)).toThrow(/no waves/);
    expect(() => start([member(altria, 'a', { fou: -1 })])).toThrow(/fou/);
    expect(() => start([member(altria, 'a', { fou: Number.NaN })])).toThrow(/fou/);
    expect(() => start([member(altria, 'a', { fou: Infinity })])).toThrow(/fou/);
  });
  it('throws on out-of-range levels', () => {
    expect(() => start([member(altria, 'a', { lv: 0 })])).toThrow(/lv/);
    expect(() => start([member(altria, 'a', { lv: 121 })])).toThrow(/lv/);
    expect(() => start([member(altria, 'a', { ce: kaleidoscope, ceLv: 101 })])).toThrow(/ceLv/);
    expect(() => start([member(altria, 'a', { ce: kaleidoscope, ceLv: 0 })])).toThrow(/ceLv/);
    expect(() => start([member(altria, 'a', { npLv: 6 })])).toThrow(/npLv/);
    expect(() => start([member(altria, 'a', { skillLv: [10, 11, 10] })])).toThrow(/skillLv/);
    expect(() => start([member(altria, 'a', { append2Lv: 11 })])).toThrow(/append2Lv/);
    expect(() => initBattle([member(altria, 'a')], mcCombat, 11, prisonRuins, constants)).toThrow(/mcLv/);
  });
  it('throws on missing classAtk / classRel / attrRel keys', () => {
    const drop = (c: Constants, path: string[]): Constants => {
      const copy = structuredClone(c) as unknown as Record<string, Record<string, unknown>>;
      if (path.length === 2) delete copy[path[0]][path[1]];
      else delete (copy[path[0]][path[1]] as Record<string, unknown>)[path[2]];
      return copy as unknown as Constants;
    };
    const go = (c: Constants) => initBattle([member(altria, 'a')], mcCombat, 10, prisonRuins, c);
    expect(() => go(drop(constants, ['classAtk', 'saber']))).toThrow(/classAtk\[saber\]/);
    expect(() => go(drop(constants, ['classRel', 'saber', 'assassin']))).toThrow(/classRel\[saber\]\[assassin\]/);
    expect(() => go(drop(constants, ['attrRel', 'earth', 'human']))).toThrow(/attrRel\[earth\]\[human\]/);
    const noBerserker = drop(constants, ['classRel', 'saber', 'berserker']);
    const s = go(noBerserker);
    expect(() => nextWave(nextWave(s, prisonRuins, noBerserker), prisonRuins, noBerserker)).toThrow(/berserker/);
  });
});

describe('useSkill', () => {
  it('Castoria S1: +3000 to the whole front line and atkUp 200 for 3 turns', () => {
    const s0 = team();
    const s = useSkill(s0, 'cas', 1);
    expect(unit(s, 'cas').gauge).toBe(15000);
    expect(unit(s, 'alt').gauge).toBe(3000);
    expect(unit(s, 'sieg').gauge).toBe(3000);
    expect(unit(s, 'short').gauge).toBe(0); // back line untouched
    for (const k of ['cas', 'alt', 'sieg']) {
      expect(unit(s, k).buffs).toContainEqual({ kind: 'atkUp', value: 200, turns: 3, count: -1 });
    }
    expect(unit(s, 'cas').cd).toEqual([6, 0, 0]);
    // immutability
    expect(unit(s0, 'cas').gauge).toBe(12000);
    expect(unit(s0, 'alt').buffs).toHaveLength(1);
    expect(unit(s0, 'cas').cd).toEqual([0, 0, 0]);
    // copy-on-write: back line and enemies are shared
    expect(s.back).toBe(s0.back);
    expect(s.enemies).toBe(s0.enemies);
  });
  it('only changed units are copied', () => {
    const s0 = team();
    const s = useSkill(s0, 'cas', 3, 'cas');
    expect(s.front[1]).toBe(s0.front[1]);
    expect(s.front[0]).not.toBe(s0.front[0]);
  });
  it('cooldown depends on skill level', () => {
    const s = start([member(castoria, 'c', { skillLv: [1, 6, 10] })]);
    expect(unit(useSkill(s, 'c', 1), 'c').cd[0]).toBe(8);
    expect(unit(useSkill(s, 'c', 2, 'c'), 'c').cd[1]).toBe(6);
  });
  it('uses the values at the skill level', () => {
    const after = useSkill(start([member(castoria, 'c', { skillLv: [1, 1, 1] })]), 'c', 1);
    expect(unit(after, 'c').gauge).toBe(2000);
    expect(unit(after, 'c').buffs).toContainEqual({ kind: 'atkUp', value: 100, turns: 3, count: -1 });
  });
  it('ptOne goes to the target only; cardUp keeps its cards and powerUp its opTraits', () => {
    const s = useSkill(useSkill(team(), 'cas', 2, 'alt'), 'cas', 3, 'alt');
    expect(unit(s, 'alt').gauge).toBe(2000);
    expect(unit(s, 'sieg').gauge).toBe(0);
    expect(unit(s, 'alt').buffs).toContainEqual({ kind: 'cardUp', value: 500, turns: 3, count: -1, cards: ['arts'] });
    expect(unit(s, 'alt').buffs).toContainEqual({ kind: 'powerUp', value: 500, turns: 3, count: -1, opTraits: [1172] });
    expect(unit(s, 'sieg').buffs.some((b) => b.kind === 'powerUp')).toBe(false);
    expect(unit(s, 'sieg').buffs).toContainEqual({ kind: 'npGainUp', value: 300, turns: 3, count: -1 });
  });
  it('ptOne without a target throws', () => {
    expect(() => useSkill(team(), 'cas', 2)).toThrow();
  });
  it('gainNp is capped by NP level', () => {
    expect(unit(useSkill(useSkill(team(), 'cas', 1), 'cas', 2, 'cas'), 'cas').gauge).toBe(17000);
    expect(unit(useSkill(setGauge(team(), 'cas', 29000), 'cas', 1), 'cas').gauge).toBe(30000);
    expect(unit(useSkill(setGauge(team(), 'sieg', 9000), 'cas', 1), 'sieg').gauge).toBe(10000); // NP1: 100%
    expect(unit(useSkill(setGauge(team(), 'alt', 29000), 'cas', 1), 'alt').gauge).toBe(30000); // NP5: 300%
    expect(gaugeCap(3)).toBe(20000);
  });
  it('throws on cooldown, for a unit not on the front line, and for a bad skill number', () => {
    const s = useSkill(team(), 'cas', 1);
    expect(() => useSkill(s, 'cas', 1)).toThrow(/cooldown/);
    expect(() => useSkill(team(), 'short', 1, 'cas')).toThrow(/front line/);
    expect(() => useSkill({ ...team(), front: [] }, 'cas', 1)).toThrow();
  });
  it('ptOther excludes the user', () => {
    const s = useSkill(team2(), 'short', 3);
    expect(unit(s, 'short').buffs.some((b) => b.kind === 'atkUp')).toBe(false);
    expect(unit(s, 'alt').buffs).toContainEqual({ kind: 'atkUp', value: 100, turns: 3, count: -1 });
    expect(unit(s, 'sieg').buffs.some((b) => b.kind === 'atkUp')).toBe(false); // back line
  });
  it('shortenSkill reduces the target cooldowns, minimum 0', () => {
    let s = team2();
    s = useSkill(s, 'cas', 1); // cd 6
    s = useSkill(s, 'cas', 2, 'cas'); // cd 5
    s = useSkill(s, 'short', 1, 'cas');
    expect(unit(s, 'cas').cd).toEqual([4, 3, 0]);
  });
  it('a 0-valued (not guaranteed) effect does nothing', () => {
    const s = useSkill(team2(), 'short', 2);
    expect(unit(s, 'short').gauge).toBe(0);
    expect(unit(s, 'short').cd[1]).toBe(5);
  });
});

describe('quest-conditioned effects (field traits, event)', () => {
  const F = 94000160, EV = 80494;
  const cond: Effect[] = [
    { kind: 'atkUp', target: 'self', lv: fill(100, 3), fieldTraits: [1, F] },
    { kind: 'gainNp', target: 'self', lv: fill(2000), eventId: EV },
  ];
  const svt: CompactServant = {
    ...shortener, id: 2, name: 'Cond',
    skills: [{ num: 1, cooldown: Array(10).fill(5), effects: cond }],
    passives: [{ kind: 'powerUp', target: 'self', lv: [lv(50)], fieldTraits: [F] }],
    eventPassives: [
      { eventIds: [EV], effects: [{ kind: 'gainNp', target: 'self', lv: [lv(3000)] }, { kind: 'npDmgUp', target: 'self', lv: [lv(70)], fieldTraits: [F] }] },
      { eventIds: [1], effects: [{ kind: 'gainNp', target: 'self', lv: [lv(5000)] }] },
    ],
  };
  const ce = { ...kaleidoscope, effects: [{ kind: 'powerUp' as const, target: 'self' as const, lv: [lv(2000)], fieldTraits: [F] }] };
  const run = (q: { fieldTraits?: number[]; eventId?: number }) => {
    const s = initBattle([member(svt, 'c', { npLv: 5, ce, ceLv: 1 })], mcCombat, 10, { ...prisonRuins, ...q }, constants);
    return { start: unit(s, 'c'), after: unit(useSkill(s, 'c', 1), 'c') };
  };
  it('apply only when a field trait matches (any-of) / its event is the quest event', () => {
    const on = run({ fieldTraits: [7, F], eventId: EV });
    expect(on.start.gauge).toBe(3000);
    expect(on.start.buffs.map((b) => [b.kind, b.value])).toEqual([['powerUp', 50], ['npDmgUp', 70], ['powerUp', 2000]]);
    expect(on.after.gauge).toBe(5000);
    expect(on.after.buffs.map((b) => b.kind)).toContain('atkUp');
    const off = run({});
    expect(off.start.gauge).toBe(0);
    expect(off.start.buffs).toEqual([]);
    expect(off.after.gauge).toBe(0);
    expect(off.after.buffs).toEqual([]);
    // Field without event: the event passive (and the EventId skill effect) stay off.
    const field = run({ fieldTraits: [F] });
    expect(field.start.buffs.map((b) => b.value)).toEqual([50, 2000]);
    expect(field.after.gauge).toBe(0);
  });
});

describe('useMc', () => {
  it('Combat Uniform S1: atkUp 300 for 1 turn to the front line, MC cooldown set', () => {
    const s = useMc(team(), 0, mcCombat, 10);
    for (const k of ['cas', 'alt', 'sieg']) {
      expect(unit(s, k).buffs).toContainEqual({ kind: 'atkUp', value: 300, turns: 1, count: -1 });
    }
    expect(s.mcCd).toEqual([10, 0, 0]);
    expect(() => useMc(s, 0, mcCombat, 10)).toThrow(/cooldown/);
  });
  it('MC cooldown depends on MC level', () => {
    expect(useMc(team(), 0, mcCombat, 1).mcCd[0]).toBe(12);
  });
  it('order change swaps front[a] with back[b], once per battle', () => {
    const s0 = team();
    const s = useMc(s0, 2, mcCombat, 10, undefined, [1, 0]);
    expect(s.front.map((u) => u?.key)).toEqual(['cas', 'short', 'sieg']);
    expect(s.back.map((u) => u.key)).toEqual(['alt']);
    expect(s0.back.map((u) => u.key)).toEqual(['short']);
    expect(s.swapped).toBe(true);
    expect(s.mcCd[2]).toBe(13);
    const again = { ...s, mcCd: [0, 0, 0] };
    expect(() => useMc(again, 2, mcCombat, 10, undefined, [0, 0])).toThrow();
  });
  it('order change without a swap argument throws', () => {
    expect(() => useMc(team(), 2, mcCombat, 10)).toThrow();
  });
});

describe('endTurn', () => {
  it('a 3-turn buff from turn 1 is active in turns 1-3 and gone after 3 endTurn; cd 6 -> 3', () => {
    let s = useSkill(team(), 'cas', 1);
    const hasAtk = (st: BattleState) => unit(st, 'alt').buffs.some((b) => b.kind === 'atkUp');
    expect(hasAtk(s)).toBe(true); // turn 1
    s = end(s);
    expect(s.turn).toBe(2);
    expect(hasAtk(s)).toBe(true); // turn 2
    s = end(s);
    expect(hasAtk(s)).toBe(true); // turn 3
    expect(unit(s, 'alt').buffs.find((b) => b.kind === 'atkUp')!.turns).toBe(1);
    s = end(s);
    expect(hasAtk(s)).toBe(false); // turn 4
    expect(unit(s, 'cas').cd).toEqual([3, 0, 0]);
    expect(s.turn).toBe(4);
    expect(unit(s, 'alt').buffs).toEqual([{ kind: 'cardUp', value: 80, turns: -1, count: -1, cards: ['quick'] }]);
  });
  it('back-line buffs and cooldowns stay frozen', () => {
    // Altria uses S1 (cd 5, atkUp 3 turns) and is swapped out.
    let s = useSkill(team(), 'alt', 1);
    s = useMc(s, 2, mcCombat, 10, undefined, [1, 0]);
    const frozen = unit(s, 'alt');
    s = end(end(s));
    expect(s.back[0]).toBe(frozen);
    expect(unit(s, 'alt').cd).toEqual([5, 0, 0]);
    expect(unit(s, 'alt').buffs).toContainEqual({ kind: 'atkUp', value: 180, turns: 3, count: -1 });
    // the front line did tick
    expect(unit(s, 'cas').buffs.find((b) => b.kind === 'atkUp')!.turns).toBe(1);
  });
  it('MC cooldowns tick down too, minimum 0; state is not mutated', () => {
    const s0 = useMc(team(), 0, mcCombat, 10);
    const s = end(s0);
    expect(s.mcCd).toEqual([9, 0, 0]);
    expect(s0.mcCd).toEqual([10, 0, 0]);
    expect(s0.turn).toBe(1);
  });
  it('throws while any enemy is alive', () => {
    expect(() => endTurn(team())).toThrow('endTurn with living enemies');
    const s = team();
    expect(() => endTurn({ ...s, enemies: [...clear(s).enemies.slice(1), s.enemies[0]] })).toThrow('endTurn with living enemies');
    expect(endTurn(clear(s)).turn).toBe(2);
  });
  it('units with nothing to tick are shared', () => {
    const s0 = team();
    expect(end(s0).front[1]).toBe(s0.front[1]);
  });
});

describe('nextWave', () => {
  it('loads the next wave enemies and their affinity', () => {
    const s = nextWave(nextWave(team(), prisonRuins, constants), prisonRuins, constants);
    expect(s.wave).toBe(2);
    expect(s.enemies.map((e) => e.hp)).toEqual([208863, 71964]);
    // saber vs berserker 2000, earth vs earth 1000
    expect(s.aff.alt[0]).toEqual({ classAtk: 1000, triangle: 2000, attribute: 1000 });
    expect(() => nextWave(s, prisonRuins, constants)).toThrow();
  });
  it('places each wave by its layout (default: all on the field, no reserve)', () => {
    expect(team()).toMatchObject({ field: [0, 1, 2], reserve: [], refill: [0, 1, 2] });
    const w = [enemy(), enemy(), enemy(), enemy()];
    const quest = { waves: [w, w], layouts: [undefined, { field: [-1, 0, 1], reserve: [2, 3], refill: [0, 1, 2] }] };
    const s0 = initBattle([cas()], mcCombat, 10, quest, constants);
    expect(s0).toMatchObject({ field: [0, 1, 2, 3], reserve: [] });
    const s1 = nextWave(endTurn(clear(s0)), quest, constants);
    expect(s1).toMatchObject({ field: [-1, 0, 1], reserve: [2, 3], refill: [0, 1, 2] });
    // The reserve has full HP: endTurn refuses a wave whose reserve is alive.
    const fieldDead = { ...s1, enemies: s1.enemies.map((e, i) => (i < 2 ? { ...e, hp: 0 } : e)) };
    expect(() => endTurn(fieldDead)).toThrow('endTurn with living enemies');
  });
});

describe('mods', () => {
  it('sums active buffs by kind', () => {
    const s = useMc(useSkill(team(), 'cas', 1), 0, mcCombat, 10);
    expect(mods(unit(s, 'alt'), enemy(), 'buster')).toEqual(
      { atkMod: 500, cardMod: 0, npDmgMod: 0, powerMod: 0, npGainMod: 0, ocUp: 0, dmgPlus: 0 });
  });
  it('cardUp counts only for its cards', () => {
    const c = unit(useSkill(team(), 'cas', 3, 'cas'), 'cas');
    expect(mods(c, enemy(), 'arts').cardMod).toBe(120 + 500);
    expect(mods(c, enemy(), 'buster').cardMod).toBe(0);
  });
  it('powerUp / npDmgUp with opTraits count only vs matching enemies', () => {
    const u: Unit = { ...unit(team(), 'alt'), buffs: [
      { kind: 'powerUp', value: 500, turns: 3, count: -1, opTraits: [1172] },
      { kind: 'npDmgUp', value: 200, turns: 3, count: -1, opTraits: [2002, 9] },
      { kind: 'npDmgUp', value: 100, turns: 3, count: -1 },
      { kind: 'npGainUp', value: 300, turns: 3, count: -1 },
      { kind: 'ocUp', value: 1, turns: 1, count: 1 },
      { kind: 'dmgPlus', value: 250, turns: 3, count: -1 },
    ] };
    expect(mods(u, enemy(), 'buster')).toMatchObject({ powerMod: 0, npDmgMod: 100, npGainMod: 300, ocUp: 1, dmgPlus: 250 });
    expect(mods(u, enemy({ traits: [1172, 9] }), 'buster')).toMatchObject({ powerMod: 500, npDmgMod: 300 });
  });
});

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('benchmark', () => {
  it.skipIf(!env.BENCH)('100k useSkill + endTurn cycles (BENCH=1)', () => {
    const s0 = clear(team());
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 100_000; i++) {
      const s = endTurn(useSkill(s0, 'cas', 1));
      n += s.turn;
    }
    const ms = performance.now() - t0;
    console.log(`100k useSkill+endTurn: ${ms.toFixed(0)} ms (${(ms * 10).toFixed(1)} ns/cycle)`);
    expect(n).toBe(200_000);
  });
});
