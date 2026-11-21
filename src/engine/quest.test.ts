import { describe, it, expect } from 'vitest';
import { questFromAtlas, UnsupportedQuestError, type RawEnemy, type RawQuest, type RawStage } from './quest';
import { prisonRuins, prisonRuinsRaw } from './test-helpers';

const base = prisonRuinsRaw.stages[0].enemies[0];
const mk = (over: Partial<RawEnemy> = {}): RawEnemy => ({ ...base, ...over });
const passive = (type: string | string[], funcTargetType = 'self') => ({
  classPassive: [{ name: 'P', functions: [type].flat().map((t) =>
    ({ funcType: 'addState', funcTargetType, funcTargetTeam: 'playerAndEnemy', buffs: [{ type: t }] })) }],
  addPassive: [],
});
const quest = (...stages: Partial<RawStage>[]): RawQuest =>
  ({ stages: stages.map((s, i) => ({ wave: i + 1, enemies: [mk()], ...s })) });
const reasons = (q: RawQuest): readonly string[] => {
  try { questFromAtlas(q); } catch (e) { if (e instanceof UnsupportedQuestError) return e.reasons; throw e; }
  return [];
};

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
  it('the assassins "Mental Debuff Immune" passive (avoidState) is allowed', () => {
    expect(base.classPassive?.addPassive?.[0].name).toBe('Mental Debuff Immune');
    expect(base.classPassive?.addPassive?.[0].functions[0].buffs?.[0].type).toBe('avoidState');
    expect(reasons(prisonRuinsRaw)).toEqual([]);
  });
  it('sorts by deckId', () => {
    const q = questFromAtlas(quest({ enemies: [mk({ deckId: 2, hp: 2 }), mk({ deckId: 1, hp: 1 })] }));
    expect(q.waves[0].map((e) => e.hp)).toEqual([1, 2]);
  });
  it('rejects reinforcements beyond enemyFieldPosCount (default 3)', () => {
    const four = [1, 2, 3, 4].map((deckId) => mk({ deckId }));
    expect(reasons(quest({ enemies: four }))).toEqual([expect.stringMatching(/wave 1: reinforcements/)]);
    expect(reasons(quest({ enemies: [mk({ deckId: 4 })] }))[0]).toMatch(/reinforcements/);
    expect(reasons(quest({ enemies: four, enemyFieldPosCount: 6 }))).toEqual([]);
  });
  it('rejects shift / call / change decks and stage calls', () => {
    const r = reasons(quest(
      { enemies: [mk(), mk({ deck: 'shift', deckId: 1 })] },
      { enemies: [mk(), mk({ deck: 'call', deckId: 1 })] },
      { enemies: [mk(), mk({ deck: 'change', deckId: 1 })], call: [5] },
    ));
    expect(r).toEqual([
      expect.stringMatching(/wave 1: shift deck/),
      expect.stringMatching(/wave 2: call deck/),
      'wave 3: call deck',
      expect.stringMatching(/wave 3: change deck/),
    ]);
  });
  it('rejects enemy self-buffs that reduce our damage or keep it alive, and lists every reason', () => {
    const bad = ['upDefence', 'subSelfdamage', 'specialdefence', 'invincible', 'avoidance', 'guts', 'addMaxhp', 'mysteryBuff'];
    const q = quest({ enemies: [mk({ classPassive: passive(bad) })] });
    const r = reasons(q);
    for (const t of bad) expect(r).toContainEqual(expect.stringContaining(`buff ${t}`));
    expect(() => questFromAtlas(q)).toThrow(UnsupportedQuestError);
  });
  it('ignores active skills entirely: enemies never act', () => {
    // Shape of a real NA Valentine wave 3: defence / invincible and trigger buffs on skills.
    const fn = (funcTargetType: string, type: string) => ({ funcType: 'addStateShort', funcTargetType, buffs: [{ type }] });
    const skills = {
      skill1: { name: 'Natural Body (Figure) C', functions: [fn('self', 'upDefence'), fn('self', 'invincible')] },
      skill2: { name: 'Dance of the Seven Veils A', functions: [fn('ptAll', 'selfturnendFunction'), fn('self', 'delayFunction')] },
      skill3: { name: 'X', functions: [{ funcType: 'addFieldChangeToField', funcTargetType: 'self' }, fn('enemyAll', 'downAtk')] },
    };
    expect(reasons(quest({}, {}, { enemies: [mk({ skills }), mk({ deckId: 2, skills })] }))).toEqual([]);
  });
  it('rejects a passive aimed at our side or with a trigger buff', () => {
    expect(reasons(quest({ enemies: [mk({ classPassive: passive('downAtk', 'enemyAll') })] }))[0]).toMatch(/on our side/);
    expect(reasons(quest({ enemies: [mk({ classPassive: passive('entryFunction') })] }))[0]).toMatch(/buff entryFunction/);
  });
  it('allows harmless enemy self-buffs (attack, crit, debuff resist, regen)', () => {
    const ok = ['upAtk', 'upCriticaldamage', 'upTolerance', 'regainHp', 'upHate'];
    expect(reasons(quest({ enemies: [mk({ classPassive: passive(ok) })] }))).toEqual([]);
  });
  it('rejects unknown non-buff functions in a passive', () => {
    const classPassive = { classPassive: [{ name: 'X', functions: [{ funcType: 'addFieldChangeToField', funcTargetType: 'self' }] }], addPassive: [] };
    expect(reasons(quest({ enemies: [mk({ classPassive })] }))[0]).toMatch(/addFieldChangeToField/);
  });
});
