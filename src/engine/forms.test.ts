// Servants with forms (data/forms.ts): Melusine starts in her first form
// (Arts single-target NP); S3 charges 100% and turns her into her final form
// (Buster AoE NP, new S3), as in Chaldea's transformAlly.
import { describe, it, expect } from 'vitest';
import melusineRaw from '../../test/fixtures/melusine.json';
import { compactServant } from '../data/compact';
import { inForm } from '../data/forms';
import type { CompactServant } from '../data/types';
import { constants, mcCombat } from './test-helpers';
import { initBattle, useSkill, type Enemy, type Quest } from './state';
import { ownedToMember } from '../solverui/members';
import { solve, replay } from '../solver/solve';

const mel = compactServant(melusineRaw as any);
const foe = (hp: number): Enemy => ({ hp, className: 'saber', attribute: 'earth', traits: [], tdRate: 1000 } as Enemy);
const own = (svt: CompactServant, form?: 'low' | 'high') =>
  ownedToMember({ collectionNo: svt.collectionNo, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 1000 }, svt, 'mel', undefined, form);

describe('forms', () => {
  it('Melusine: both kits, the first one transforms with S3', () => {
    expect(mel.unsupported).toEqual([]);
    expect(mel.forms).toBeDefined();
    expect(mel.forms!.low.np).toMatchObject({ card: 'arts', aoe: false });
    expect(mel.forms!.high.np).toMatchObject({ card: 'buster', aoe: true });
    const s3 = mel.forms!.low.skills.find((k) => k.num === 3)!;
    expect(s3.effects).toContainEqual(expect.objectContaining({ kind: 'transform', toForm: 'high' }));
    expect(mel.forms!.high.skills.find((k) => k.num === 3)!.effects.some((e) => e.kind === 'transform')).toBe(false);
  });
  it('starts in the chosen form (first by default)', () => {
    expect(own(mel).svt.np?.card).toBe('arts');
    expect(own(mel, 'high').svt.np?.card).toBe('buster');
    expect(inForm(own(mel).svt, 'high')).toBe(mel);
  });
  it('S3 in the first form: 100% charge, final-form kit, S3 on cooldown', () => {
    const q: Quest = { waves: [[foe(1000)]] };
    let s = initBattle([own(mel)], mcCombat, 10, q, constants);
    s = useSkill(s, 'mel', 3);
    const u = s.front[0]!;
    expect(u.svt.np).toMatchObject({ card: 'buster', aoe: true });
    expect(u.gauge).toBeGreaterThanOrEqual(10000);
    expect(u.cd[2]).toBeGreaterThan(0);
  });
  it('solver: transforms on turn 1 to clear three enemies with the AoE NP', () => {
    // Three enemies per wave: her single-target first NP cannot clear wave 1.
    const q: Quest = { waves: [[foe(5000), foe(5000), foe(5000)]] };
    const team = [own(mel)];
    const r = solve(team, mcCombat, 10, q, constants, { maxMs: 20_000 });
    expect(r.solutions.length, JSON.stringify(r.best) + JSON.stringify(r.stats)).toBeGreaterThan(0);
    const sol = r.solutions[0];
    expect(sol.turns[0]).toContainEqual({ kind: 'skill', unit: 'mel', num: 3 });
    expect(replay(team, mcCombat, 10, q, constants, sol)).toHaveLength(1);
  });
});
