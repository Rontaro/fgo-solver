// Our debuffs on enemies (Enemy.debuffs): where they land, when they are
// skipped, how they are consumed. Okuni / sky caster scenario of
// chaldea-golden.test.ts (her NP puts Quick resist down -20% on its target).
import { describe, it, expect } from 'vitest';
import okuniRaw from '../../test/fixtures/jp-okuni.json';
import questRaw from '../../test/fixtures/jp-quest-sky-caster.json';
import { compactServant } from '../data/compact';
import type { CompactServant, Effect } from '../data/types';
import { questFromAtlas, type RawQuest } from './quest';
import { initBattle, useSkill, type BattleState, type Quest } from './state';
import { fireNp } from './np';
import { constants, kaleidoscope, member, mcCombat } from './test-helpers';

const okuni = compactServant({ ...(okuniRaw as any), skills: (okuniRaw as any).skills.filter((s: any) => s.id !== 954451) });
const quest = questFromAtlas(questRaw as unknown as RawQuest);
const SKY = 1;
const lv10 = (value: number, count = -1) => Array.from({ length: 10 }, () => ({ value, turns: 3, count }));
/** Okuni with her S2 replaced by a single effect. */
const withS2 = (e: Effect): CompactServant => ({ ...okuni, skills: okuni.skills.map((k) => (k.num === 2 ? { ...k, effects: [e], unsupported: undefined, lastTurnOnly: undefined } : k)) });
const start = (svt: CompactServant, q: Quest = quest) =>
  initBattle([member(svt, 'o', { lv: 90, npLv: 5, fou: 1000, ce: kaleidoscope, ceLv: 100, ceMlb: true })], mcCombat, 10, q, constants);
const onSky = (s: BattleState) => ({ ...s, target: s.field[SKY] });
const dmg = (s: BattleState) => s.enemies[SKY].hp - fireNp(onSky(s), 'o').state.enemies[SKY].hp;
const onlySkyAlive = (s: BattleState): BattleState => ({ ...s, enemies: s.enemies.map((e, i) => (i === SKY ? e : { ...e, hp: 0 })) });

describe('enemy debuffs', () => {
  it('the NP\'s pre-damage debuff lands on its target (56,556, as Chaldea)', () => {
    expect(dmg(start(okuni))).toBe(56556);
  });
  it('an enemy with debuff immunity / resistance (noDebuff) is never debuffed', () => {
    const q: Quest = { ...quest, waves: quest.waves.map((w, i) => (i ? w : w.map((e, j) => (j === SKY ? { ...e, noDebuff: true as const } : e)))) };
    expect(dmg(start(okuni, q))).toBe(47130);
  });
  it('a single-target skill debuff is skipped while the target is ambiguous, applied on the only living enemy', () => {
    const svt = withS2({ kind: 'defDown', target: 'enemy', lv: lv10(300) });
    const s = start(svt);
    expect(useSkill(s, 'o', 2).enemies.some((e) => e.debuffs?.length)).toBe(false);
    const alone = useSkill(onlySkyAlive(s), 'o', 2);
    expect(alone.enemies[SKY].debuffs).toEqual([{ kind: 'defDown', value: 300, count: -1 }]);
    expect(dmg(alone)).toBeGreaterThan(dmg(onlySkyAlive(s)));
  });
  it('an AoE debuff hits every living enemy on the field; a count-limited one is used up by the NP', () => {
    const svt = withS2({ kind: 'defDown', target: 'enemyAll', lv: lv10(300, 1) });
    const s = useSkill(start(svt), 'o', 2);
    expect(s.enemies.filter((e) => e.debuffs?.length)).toHaveLength(3);
    const after = fireNp(onSky(s), 'o').state;
    expect(after.enemies[SKY].debuffs?.some((d) => d.kind === 'defDown')).toBe(false);
  });
  it('a card resist down only counts for its cards', () => {
    const arts = withS2({ kind: 'cardResDown', target: 'enemyAll', lv: lv10(500), cards: ['arts'] });
    const s = start(arts);
    expect(dmg(useSkill(s, 'o', 2))).toBe(dmg(s)); // Okuni's NP is Quick
  });
});
