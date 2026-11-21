import { describe, it, expect } from 'vitest';
import type { CompactServant, Effect } from '../data/types';
import { initBattle, useSkill, useMc, endTurn, nextWave, mods, type BattleState, type Enemy } from './state';
import { castoria, altria, siegfried, kaleidoscope, mcCombat, prisonRuins, member } from './test-helpers';

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

function team(): BattleState {
  return initBattle([
    member(castoria, 'cas', { append2Lv: 10, ce: kaleidoscope, ceLv: 100, ceMlb: true }),
    member(altria, 'alt', { npLv: 5 }),
    member(siegfried, 'sieg'),
    member(shortener, 'short'),
  ], mcCombat, 10, prisonRuins);
}
const unit = (s: BattleState, key: string) => [...s.front, ...s.back].find((u) => u?.key === key)!;
const enemy = (over: Partial<Enemy> = {}): Enemy =>
  ({ hp: 100000, className: 'assassin', attribute: 'human', traits: [], tdRate: 900, ...over });

describe('questFromAtlas', () => {
  it('Prison Ruins: 3 waves, 3 assassins in wave 1, Chimera in wave 3', () => {
    expect(prisonRuins.waves).toHaveLength(3);
    expect(prisonRuins.waves[0]).toHaveLength(3);
    expect(prisonRuins.waves[0].every((e) => e.className === 'assassin')).toBe(true);
    expect(prisonRuins.waves[0].map((e) => e.hp)).toEqual([10358, 10358, 13074]);
    expect(prisonRuins.waves[0][0]).toMatchObject({ attribute: 'human', tdRate: 900 });
    expect(prisonRuins.waves[0][0].traits).toContain(2001);
    const chimera = prisonRuins.waves[2].find((e) => e.className === 'berserker')!;
    expect(chimera).toMatchObject({ hp: 208863, attribute: 'earth', tdRate: 800 });
  });
});

describe('initBattle', () => {
  it('Castoria + Kaleidoscope MLB + append 2 lv10 starts at 12000', () => {
    expect(unit(team(), 'cas').gauge).toBe(12000);
  });
  it('atk = atkGrowth[lv-1] + fou + CE atk', () => {
    const s = team();
    expect(unit(s, 'alt').atk).toBe(11221);
    expect(unit(s, 'cas').atk).toBe(10546 + 2000);
    const f = initBattle([member(altria, 'a', { lv: 80, fou: 1000 })], mcCombat, 10, prisonRuins);
    expect(unit(f, 'a').atk).toBe(10148 + 1000);
  });
  it('starting gauge is capped at 30000 and 0 without append/CE', () => {
    const huge = { ...kaleidoscope, effectsMlb: [{ ...kaleidoscope.effectsMlb[0], lv: [lv(40000)] }] };
    const s = initBattle([member(castoria, 'c', { append2Lv: 10, ce: huge, ceMlb: true })], mcCombat, 10, prisonRuins);
    expect(unit(s, 'c').gauge).toBe(30000);
    expect(unit(team(), 'alt').gauge).toBe(0);
  });
  it('non-MLB CE uses the base effects', () => {
    const s = initBattle([member(castoria, 'c', { ce: kaleidoscope, ceMlb: false })], mcCombat, 10, prisonRuins);
    expect(unit(s, 'c').gauge).toBe(8000);
  });
  it('permanent passives and CE buffs become buffs', () => {
    const ceBuff: Effect = { kind: 'npDmgUp', target: 'self', lv: [lv(150, -1)] };
    const ce = { ...kaleidoscope, effects: [ceBuff, { kind: 'atkUp' as const, target: 'self' as const, lv: [lv(100, 3)] }] };
    const s = initBattle([member(altria, 'a', { ce })], mcCombat, 10, prisonRuins);
    expect(unit(s, 'a').buffs).toEqual([
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
  });
  it('cooldown depends on skill level', () => {
    const s = initBattle([member(castoria, 'c', { skillLv: [1, 6, 10] })], mcCombat, 10, prisonRuins);
    expect(unit(useSkill(s, 'c', 1), 'c').cd[0]).toBe(8);
    expect(unit(useSkill(s, 'c', 2, 'c'), 'c').cd[1]).toBe(6);
  });
  it('uses the values at the skill level', () => {
    const s = initBattle([member(castoria, 'c', { skillLv: [1, 1, 1] })], mcCombat, 10, prisonRuins);
    const after = useSkill(s, 'c', 1);
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
    // S2 npGainUp is ptAll
    expect(unit(s, 'sieg').buffs).toContainEqual({ kind: 'npGainUp', value: 300, turns: 3, count: -1 });
  });
  it('ptOne without a target throws', () => {
    expect(() => useSkill(team(), 'cas', 2)).toThrow();
  });
  it('gainNp is capped at 30000', () => {
    expect(unit(useSkill(useSkill(team(), 'cas', 1), 'cas', 2, 'cas'), 'cas').gauge).toBe(17000);
    const full = { ...team() };
    full.front = full.front.map((u) => (u && u.key === 'cas' ? { ...u, gauge: 29000 } : u));
    expect(unit(useSkill(full, 'cas', 1), 'cas').gauge).toBe(30000);
  });
  it('throws on cooldown, for a unit not on the front line, and for a bad skill number', () => {
    const s = useSkill(team(), 'cas', 1);
    expect(() => useSkill(s, 'cas', 1)).toThrow(/cooldown/);
    expect(() => useSkill(team(), 'short', 1, 'cas')).toThrow();
    expect(() => useSkill(team(), 'cas', 4)).toThrow();
  });
  it('ptOther excludes the user', () => {
    const s0 = team();
    s0.front = [s0.back[0], s0.front[1], s0.front[2]];
    const s = useSkill(s0, 'short', 3);
    expect(unit(s, 'short').buffs.some((b) => b.kind === 'atkUp')).toBe(false);
    expect(unit(s, 'alt').buffs).toContainEqual({ kind: 'atkUp', value: 100, turns: 3, count: -1 });
  });
  it('shortenSkill reduces the target cooldowns, minimum 0', () => {
    let s = team();
    s = useSkill(s, 'cas', 1); // cd 6
    s = useSkill(s, 'cas', 2, 'cas'); // cd 5
    s.front = [s.front[0], s.back[0], s.front[2]];
    s = useSkill(s, 'short', 1, 'cas');
    expect(unit(s, 'cas').cd).toEqual([4, 3, 0]);
  });
  it('a 0-valued (not guaranteed) effect does nothing', () => {
    const s0 = team();
    s0.front = [s0.back[0], s0.front[1], s0.front[2]];
    const s = useSkill(s0, 'short', 2);
    expect(unit(s, 'short').gauge).toBe(0);
    expect(unit(s, 'short').cd[1]).toBe(5);
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
    const s = useMc(team(), 2, mcCombat, 10, undefined, [1, 0]);
    expect(s.front.map((u) => u?.key)).toEqual(['cas', 'short', 'sieg']);
    expect(s.back.map((u) => u.key)).toEqual(['alt']);
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
    s = endTurn(s);
    expect(s.turn).toBe(2);
    expect(hasAtk(s)).toBe(true); // turn 2
    s = endTurn(s);
    expect(hasAtk(s)).toBe(true); // turn 3
    expect(unit(s, 'alt').buffs.find((b) => b.kind === 'atkUp')!.turns).toBe(1);
    s = endTurn(s);
    expect(hasAtk(s)).toBe(false); // turn 4
    expect(unit(s, 'cas').cd).toEqual([3, 0, 0]);
    expect(s.turn).toBe(4);
    // permanent passive is kept
    expect(unit(s, 'alt').buffs).toEqual([{ kind: 'cardUp', value: 80, turns: -1, count: -1, cards: ['quick'] }]);
  });
  it('MC cooldowns tick down too, minimum 0; state is not mutated', () => {
    const s0 = useMc(team(), 0, mcCombat, 10);
    const s = endTurn(s0);
    expect(s.mcCd).toEqual([9, 0, 0]);
    expect(s0.mcCd).toEqual([10, 0, 0]);
    expect(s0.turn).toBe(1);
  });
});

describe('nextWave', () => {
  it('loads the next wave enemies', () => {
    const s = nextWave(nextWave(team(), prisonRuins), prisonRuins);
    expect(s.wave).toBe(2);
    expect(s.enemies.map((e) => e.hp)).toEqual([208863, 71964]);
    expect(() => nextWave(s, prisonRuins)).toThrow();
  });
  it('enemies are copies: editing the state does not touch the quest', () => {
    const s = nextWave(team(), prisonRuins);
    s.enemies[0].hp = 1;
    expect(prisonRuins.waves[1][0].hp).toBe(27974);
  });
});

describe('mods', () => {
  it('sums active buffs by kind', () => {
    const s = useMc(useSkill(team(), 'cas', 1), 0, mcCombat, 10);
    expect(mods(unit(s, 'alt'), enemy(), 'buster')).toEqual(
      { atkMod: 500, cardMod: 0, npDmgMod: 0, powerMod: 0, npGainMod: 0, ocUp: 0, dmgPlus: 0 });
  });
  it('cardUp counts only for its cards', () => {
    const s = useSkill(team(), 'cas', 3, 'cas');
    const cas = unit(s, 'cas');
    expect(mods(cas, enemy(), 'arts').cardMod).toBe(120 + 500);
    expect(mods(cas, enemy(), 'buster').cardMod).toBe(0);
  });
  it('powerUp / npDmgUp with opTraits count only vs matching enemies', () => {
    const u = { ...unit(team(), 'alt') };
    u.buffs = [
      { kind: 'powerUp', value: 500, turns: 3, count: -1, opTraits: [1172] },
      { kind: 'npDmgUp', value: 200, turns: 3, count: -1, opTraits: [2002, 9] },
      { kind: 'npDmgUp', value: 100, turns: 3, count: -1 },
      { kind: 'npGainUp', value: 300, turns: 3, count: -1 },
      { kind: 'ocUp', value: 1, turns: 1, count: 1 },
      { kind: 'dmgPlus', value: 250, turns: 3, count: -1 },
    ];
    expect(mods(u, enemy(), 'buster')).toMatchObject({ powerMod: 0, npDmgMod: 100, npGainMod: 300, ocUp: 1, dmgPlus: 250 });
    expect(mods(u, enemy({ traits: [1172, 9] }), 'buster')).toMatchObject({ powerMod: 500, npDmgMod: 300 });
  });
});
