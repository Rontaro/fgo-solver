// Demerits on our side: NP / skill seals, stun (cooldowns stop), ATK down.
import { describe, it, expect } from 'vitest';
import type { CompactServant, Effect } from '../data/types';
import { altria, constants, member, mcCombat, prisonRuins } from './test-helpers';
import { endTurn, initBattle, useSkill, type BattleState } from './state';
import { fireNp } from './np';

const lv = (value: number, turns: number) => Array.from({ length: 10 }, () => ({ value, turns, count: -1 }));
const withS1 = (...effects: Effect[]): CompactServant =>
  ({ ...altria, skills: [{ num: 1, cooldown: Array(10).fill(3), effects }, ...altria.skills.filter((k) => k.num !== 1)] });
const start = (svt: CompactServant): BattleState => {
  const s = initBattle([member(svt, 'a', { npLv: 5 })], mcCombat, 10, prisonRuins, constants);
  return { ...s, front: s.front.map((u) => (u ? { ...u, gauge: 10000 } : u)) };
};
const unit = (s: BattleState) => s.front[0]!;

describe('demerits', () => {
  it('an NP seal blocks the NP for its turns', () => {
    const s = useSkill(start(withS1({ kind: 'sealNp', target: 'self', lv: lv(1, 1) })), 'a', 1);
    expect(() => fireNp(s, 'a')).toThrow(/seal/);
  });
  it('a stun blocks skills and the NP, and the cooldowns stop while it lasts', () => {
    let s = useSkill(start(withS1({ kind: 'stun', target: 'self', lv: lv(1, 2) })), 'a', 1);
    expect(() => useSkill(s, 'a', 3)).toThrow(/seal \/ stun/);
    expect(() => fireNp(s, 'a')).toThrow(/seal \/ stun/);
    const cd0 = unit(s).cd[0];
    // endTurn needs a dead wave: kill the enemies by hand.
    const dead = (x: BattleState): BattleState => ({ ...x, enemies: x.enemies.map((e) => ({ ...e, hp: 0 })) });
    s = endTurn(dead(s));
    expect(unit(s).cd[0]).toBe(cd0); // stunned during that turn: no tick
    s = endTurn(dead(s));
    expect(unit(s).cd[0]).toBe(cd0); // the 2-turn stun was still on at the start of that turn end
    s = endTurn(dead(s));
    expect(unit(s).cd[0]).toBe(cd0 - 1);
  });
  it('a self ATK down lowers the NP damage', () => {
    const base = start(altria);
    const down = useSkill(start(withS1({ kind: 'atkUp', target: 'self', lv: lv(-200, 3) })), 'a', 1);
    const dmg = (s: BattleState) => s.enemies[0].hp - fireNp(s, 'a').state.enemies[0].hp;
    expect(dmg(down)).toBeLessThan(dmg(base));
  });
  it('a self HP loss is counted against the HP: a move the servant would die of is refused', () => {
    const svt: CompactServant = {
      ...altria, hp: Array(120).fill(1500),
      np: { ...altria.np!, extra: [...altria.np!.extra, { kind: 'lossHp', target: 'self', lv: lv(1000, -1) }] },
    };
    let s = start(svt);
    expect(unit(s).hp).toBe(1500);
    s = fireNp(s, 'a').state;
    expect(unit(s).hp).toBe(500);
    const fresh = start(svt); // the same wave again, at full HP
    s = { ...s, enemies: fresh.enemies, field: fresh.field, reserve: fresh.reserve, npsFired: 0, front: s.front.map((u) => (u ? { ...u, gauge: 10000 } : u)) };
    expect(() => fireNp(s, 'a')).toThrow(/would die/);
  });
});
