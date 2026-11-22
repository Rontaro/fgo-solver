// Class relation overwrite (EffectKind classRel): Kama's S3 makes her
// (Assassin) attacks on Alter Egos x2.
import { describe, it, expect } from 'vitest';
import kamaRaw from '../../test/fixtures/kama.json';
import { compactServant } from '../data/compact';
import { constants, member, mcCombat } from './test-helpers';
import { initBattle, useSkill, type BattleState, type Enemy, type Quest } from './state';
import { fireNp } from './np';

const kama = compactServant(kamaRaw as any);
const foe = (className: string): Enemy => ({ hp: 10_000_000, className, attribute: 'human', traits: [], tdRate: 1000 });
const q = (className: string): Quest => ({ waves: [[foe(className)]] });
const start = (className: string): BattleState => {
  const s = initBattle([member(kama, 'k', { npLv: 5 })], mcCombat, 10, q(className), constants);
  return { ...s, front: s.front.map((u) => (u ? { ...u, gauge: 10000 } : u)) };
};
const dmg = (s: BattleState) => s.enemies[0].hp - fireNp(s, 'k').state.enemies[0].hp;

describe('class relation overwrite', () => {
  it('Kama S3 is a classRel effect: assassin vs alterEgo 2000', () => {
    const s3 = kama.skills.find((k) => k.num === 3)!;
    expect(s3.unsupported).toBeUndefined();
    expect(s3.effects).toContainEqual(expect.objectContaining({ kind: 'classRel', classRel: { assassin: { alterEgo: 2000 } } }));
  });
  it('doubles her NP on an Alter Ego, changes nothing on a Saber', () => {
    const ae = start('alterEgo');
    const ratio = dmg(useSkill(ae, 'k', 3)) / dmg(ae);
    // x2 on the class relation; her passive's flat damage (addDamage) is not doubled.
    expect(ratio).toBeGreaterThan(1.99);
    expect(ratio).toBeLessThan(2);
    const saber = start('saber');
    expect(dmg(useSkill(saber, 'k', 3))).toBe(dmg(saber));
  });
});
