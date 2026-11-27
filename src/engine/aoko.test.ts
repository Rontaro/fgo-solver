// Aozaki Aoko (NA #413): her base NP deals no damage and transforms her into
// another servant id (2501500: more ATK, attribute Star, new skills, an AoE
// NP). Magic Bullets (buffs with trait 2885) raise that NP's damage by 10%
// each, up to 10, and the NP then expends 10 of them.
import { describe, it, expect } from 'vitest';
import aokoRaw from '../../test/fixtures/aoko.json';
import arashRaw from '../../test/fixtures/arash.json';
import { compactServant } from '../data/compact';
import { inForm } from '../data/forms';
import { constants, kaleidoscope, mcCombat, member } from './test-helpers';
import { initBattle, useSkill, type BattleState, type Enemy, type Quest } from './state';
import { fireNp } from './np';
import { solve, replay } from '../solver/solve';

const raw = aokoRaw as any;
const others = new Map<number, any>([[raw.svt.id, raw.svt], [raw.target.id, raw.target]]);
const triggers = new Map<number, any>(raw.triggers.map((s: any) => [s.id, s]));
const aoko = compactServant(raw.svt, triggers, undefined, others);
const arash = compactServant(arashRaw as any);
const foe = (hp: number): Enemy => ({ hp, className: 'saber', attribute: 'earth', traits: [], tdRate: 1000 } as Enemy);
const full = { ce: kaleidoscope, ceMlb: true, ceLv: 1 }; // 100% at battle start
const bullets = (s: BattleState, key = 'aoko') => s.front.find((u) => u?.key === key)!.buffs.filter((b) => b.kind === 'traitBuff').length;
const lv = 90;

describe('Aoko', () => {
  it('compacts both servants: base kit on top, the transformed one as the high form', () => {
    expect(aoko.unsupported).toEqual([]);
    expect(aoko).toMatchObject({ form: 'low', formLocked: true });
    expect(aoko.np).toMatchObject({ noDamage: true, card: 'arts' });
    expect(aoko.np!.extra[0]).toMatchObject({ kind: 'transform', toForm: 'high' });
    const high = aoko.forms!.high;
    expect(high.atkGrowth).toBe(raw.target.atkGrowth);
    expect(high.attribute).toBe('star');
    expect(high.np).toMatchObject({ aoe: true, sum: { onEnemy: false, traits: [2885], max: 10, buffs: true } });
    expect(high.np!.extra).toContainEqual(expect.objectContaining({ kind: 'removeTraitBuffs', buffTraits: [2885] }));
    expect(high.skills[0].effects.filter((e) => e.kind === 'traitBuff')).toHaveLength(6);
    expect(inForm(aoko, 'low')).toBe(aoko);
  });

  it('base NP: no damage, transforms her (new ATK and kit), bullets stay, counts for the chain', () => {
    const q: Quest = { waves: [[foe(100_000)]] };
    let s = initBattle([member(aoko, 'aoko', { lv, ...full })], mcCombat, 10, q, constants);
    s = useSkill(s, 'aoko', 1); // base S1: 3 bullets
    expect(bullets(s)).toBe(3);
    const atk0 = s.front[0]!.atk;
    const r = fireNp(s, 'aoko');
    const u = r.state.front[0]!;
    expect(r.state.enemies[0].hp).toBe(100_000);
    expect(r.killedAll).toBe(false);
    expect(r.state.npsFired).toBe(1);
    expect(u.gauge).toBe(0);
    expect(u.svt.form).toBe('high');
    expect(u.svt.np!.noDamage).toBeUndefined();
    expect(u.atk - atk0).toBe(raw.target.atkGrowth[lv - 1] - raw.svt.atkGrowth[lv - 1]);
    expect(bullets(r.state)).toBe(3);
    expect(u.cd[0]).toBeGreaterThan(0); // cooldowns kept
  });

  it('bullets: at most 20; the NP counts up to 10 (+10% each), then expends 10', () => {
    const q: Quest = { waves: [[foe(10_000_000)]] };
    const start = (n: number) => {
      let s = initBattle([member(aoko, 'aoko', { lv, ...full })], mcCombat, 10, q, constants);
      s = fireNp(s, 'aoko').state; // transformed, gauge 0
      const u = s.front[0]!;
      const b = { kind: 'traitBuff' as const, value: 1, turns: -1, count: -1, buffTraits: [2885] };
      return { ...s, npsFired: 0, front: [{ ...u, gauge: 10000, buffs: [...u.buffs, ...Array(n).fill(b)] }] };
    };
    // Six more from S1 on top of 18: capped at 20.
    expect(bullets(useSkill(start(18), 'aoko', 1))).toBe(20);
    const dmg = (n: number) => { const s = start(n); const r = fireNp(s, 'aoko'); return { d: s.enemies[0].hp - r.state.enemies[0].hp, left: bullets(r.state) }; };
    const d0 = dmg(0), d5 = dmg(5), d12 = dmg(12);
    expect(d5.d / d0.d).toBeCloseTo(1.5, 2);
    expect(d12.d / d0.d).toBeCloseTo(2, 2); // capped at 10
    expect([d0.left, d5.left, d12.left]).toEqual([0, 0, 2]);
  });

  it('solver: Arash clears wave 1 while Aoko transforms, then her bullets clear wave 2', () => {
    // Wave 2 needs the bullet bonus: find her damage with and without bullets first.
    const team = [member(aoko, 'aoko', { lv, ...full }), member(arash, 'arash', { ...full })];
    let s = fireNp(initBattle(team, mcCombat, 10, { waves: [[foe(10_000_000)]] }, constants), 'aoko').state;
    s = useSkill(useSkill({ ...s, npsFired: 0 }, 'aoko', 2), 'aoko', 1); // transformed S2 (100%) and S1 (6 bullets, Arts up)
    const u = s.front[0]!;
    const noBullets = { ...s, front: [{ ...u, buffs: u.buffs.filter((b) => b.kind !== 'traitBuff') }, ...s.front.slice(1)] };
    const dmgOf = (x: BattleState) => 10_000_000 - fireNp(x, 'aoko').state.enemies[0].hp;
    const without = dmgOf(noBullets), six = dmgOf(s);
    expect(six / without).toBeCloseTo(1.6, 2);
    // 1.45x: only with her transformed S1 bullets (base S1 + S3 Arts up reach 1.3x).
    const hp = Math.floor(without * 0.25 + six * 0.75);
    const q: Quest = { waves: [[foe(1)], [foe(hp), foe(hp)]] };
    const r = solve(team, mcCombat, 10, q, constants, { maxMs: 30_000 });
    expect(r.solutions.length, JSON.stringify(r.best) + JSON.stringify(r.stats)).toBeGreaterThan(0);
    const sol = r.solutions[0];
    expect(sol.turns[0]).toContainEqual({ kind: 'np', unit: 'aoko' });
    expect(sol.turns[1]).toContainEqual(expect.objectContaining({ kind: 'skill', unit: 'aoko', num: 1 }));
    expect(replay(team, mcCombat, 10, q, constants, sol)).toHaveLength(2);
  });
});
