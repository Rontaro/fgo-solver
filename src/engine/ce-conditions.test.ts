// CE effects with conditions the engine evaluates: a buff that grows at each
// turn end (Purely Bloom) and a damage up against enemies having all of
// several traits (Jokanaan's Head).
import { describe, it, expect } from 'vitest';
import type { CompactCE, Effect } from '../data/types';
import { altria, constants, mcCombat, member } from './test-helpers';
import { endTurn, initBattle, mods, nextWave, type Enemy, type Quest } from './state';

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

  it('opAll: counts only against an enemy with every trait', () => {
    const head = ceOf({ kind: 'powerUp', target: 'self', lv: perm(200), opTraits: [300, 303], opAll: true });
    const q: Quest = { waves: [[foe(1, [300]), foe(1, [300, 303])]] };
    const s = initBattle([member(altria, 'a', { ce: head })], mcCombat, 10, q, constants);
    expect(mods(s.front[0]!, s.enemies[0], 'buster').powerMod).toBe(0);
    expect(mods(s.front[0]!, s.enemies[1], 'buster').powerMod).toBe(200);
  });
});
