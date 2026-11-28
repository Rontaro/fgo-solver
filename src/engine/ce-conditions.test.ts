// CE effects with conditions the engine evaluates: a buff that grows at each
// turn end (Purely Bloom) and a damage up against enemies having all of
// several traits (Jokanaan's Head).
import { describe, it, expect } from 'vitest';
import type { CompactCE, Effect } from '../data/types';
import { altria, constants, mcCombat, member } from './test-helpers';
import { endTurn, initBattle, mods, nextWave, useSkill, type Enemy, type Quest } from './state';
import { fireNp } from './np';
import { solve } from '../solver/solve';

const foe = (hp: number, traits: number[] = []): Enemy => ({ hp, className: 'saber', attribute: 'earth', traits, tdRate: 1000 } as Enemy);
const ceOf = (e: Effect): CompactCE => ({ id: 1, collectionNo: 1, name: 'x', face: '', atkGrowth: [0], effects: [e], effectsMlb: [e], unsupported: [] });
const perm = (value: number) => [{ value, turns: -1, count: -1 }];

describe('CE conditions in the engine', () => {
  it('grow: 0 on turn 1, +5% at each turn end, capped', () => {
    const bloom = ceOf({ kind: 'npDmgUp', target: 'self', lv: perm(0), grow: { add: 50, max: 100 } });
    const q: Quest = { waves: [[foe(1)], [foe(1)], [foe(1)]] };
    let s = initBattle([member(altria, 'a', { ce: bloom })], mcCombat, 10, q, constants);
    const npDmg = () => mods(s.front[0]!, s.enemies[0], 'buster').npDmgMod;
    const kill = () => ({ ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 0 })) });
    expect(npDmg()).toBe(0);
    s = nextWave(endTurn(kill()), q, constants);
    expect(npDmg()).toBe(50);
    s = nextWave(endTurn(kill()), q, constants);
    expect(npDmg()).toBe(100);
    s = endTurn(kill());
    expect(s.front[0]!.buffs.find((b) => b.grow)!.value).toBe(100); // capped
  });

  it('entry: party buff at battle start from a front-line holder only, removable', () => {
    const king = ceOf({ kind: 'atkUp', target: 'ptAll', lv: [{ value: 150, turns: 3, count: -1 }], entry: true });
    const q: Quest = { waves: [[foe(1)]] };
    const team = (i: number) => ['a', 'b', 'c', 'd'].map((k, j) => member(altria, k, j === i ? { ce: king } : {}));
    const atk = (s: ReturnType<typeof initBattle>) => s.front.map((u) => mods(u!, s.enemies[0], 'buster').atkMod);
    const front = initBattle(team(1), mcCombat, 10, q, constants);
    expect(atk(front)).toEqual([150, 150, 150]);
    expect(front.front[0]!.buffs.find((b) => b.kind === 'atkUp')).toMatchObject({ turns: 3 });
    expect(front.front[0]!.buffs.find((b) => b.kind === 'atkUp')!.passive).toBeUndefined();
    expect(atk(initBattle(team(3), mcCombat, 10, q, constants))).toEqual([0, 0, 0]);
  });

  it('status: a curse from a skill makes "damage vs Cursed" count', () => {
    const stars = ceOf({ kind: 'powerUp', target: 'self', lv: perm(200), opTraits: [3026] });
    const curse: Effect = { kind: 'enemyStatus', target: 'enemy', lv: Array(10).fill({ value: 1, turns: 3, count: -1 }), buffTraits: [3026] };
    const cursing = { ...altria, skills: altria.skills.map((k) => (k.num === 1 ? { ...k, effects: [curse] } : k)) };
    const q: Quest = { waves: [[foe(1)]] };
    let s = initBattle([member(cursing, 'a', { ce: stars })], mcCombat, 10, q, constants);
    const pow = () => mods(s.front[0]!, s.enemies[0], 'buster').powerMod;
    expect(pow()).toBe(0);
    s = useSkill(s, 'a', 1);
    expect(s.enemies[0].status).toEqual([3026]);
    expect(pow()).toBe(200);
    // An enemy immune to debuffs gets no status.
    const q2: Quest = { waves: [[{ ...foe(1), noDebuff: true }]] };
    expect(useSkill(initBattle([member(cursing, 'a', { ce: stars })], mcCombat, 10, q2, constants), 'a', 1).enemies[0].status).toBeUndefined();
  });

  it('status: the solver curses first when the bonus is needed', () => {
    const stars = ceOf({ kind: 'powerUp', target: 'self', lv: perm(1000), opTraits: [3026] });
    const curse: Effect = { kind: 'enemyStatus', target: 'enemy', lv: Array(10).fill({ value: 1, turns: 3, count: -1 }), buffTraits: [3026] };
    // Only the curse: her other skills could reach the HP alone.
    const cursing = { ...altria, skills: altria.skills.map((k) => ({ ...k, effects: k.num === 1 ? [curse] : [] })) };
    const full = { ce: stars, ceMlb: true };
    const team = [member(cursing, 'a', full)];
    // HP between her NP without and with the bonus.
    const at = (cast: boolean) => {
      let s = initBattle(team, mcCombat, 10, { waves: [[foe(10_000_000)]] }, constants);
      s = { ...s, front: [{ ...s.front[0]!, gauge: 10000 }] };
      if (cast) s = useSkill(s, 'a', 1);
      return 10_000_000 - fireNp(s, 'a').state.enemies[0].hp;
    };
    const lo = at(false), hi = at(true);
    expect(hi).toBeGreaterThan(lo * 1.5);
    const q: Quest = { waves: [[foe(Math.floor((lo + hi) / 2))]] };
    const charged = [member(cursing, 'a', { ...full, append2Lv: 0 })];
    const r = solve(charged.map((m) => ({ ...m, svt: { ...m.svt, append2: [10000], } })).map((m) => ({ ...m, append2Lv: 1 })), mcCombat, 10, q, constants, { maxMs: 20_000 });
    expect(r.solutions.length, JSON.stringify(r.stats)).toBeGreaterThan(0);
    expect(r.solutions[0].turns[0]).toContainEqual(expect.objectContaining({ kind: 'skill', unit: 'a', num: 1 }));
  });

  it('opAll: counts only against an enemy with every trait', () => {
    const head = ceOf({ kind: 'powerUp', target: 'self', lv: perm(200), opTraits: [300, 303], opAll: true });
    const q: Quest = { waves: [[foe(1, [300]), foe(1, [300, 303])]] };
    const s = initBattle([member(altria, 'a', { ce: head })], mcCombat, 10, q, constants);
    expect(mods(s.front[0]!, s.enemies[0], 'buster').powerMod).toBe(0);
    expect(mods(s.front[0]!, s.enemies[1], 'buster').powerMod).toBe(200);
  });
});
