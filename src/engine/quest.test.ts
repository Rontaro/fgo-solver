import { describe, it, expect } from 'vitest';
import { questFromAtlas, fieldTraitsOf, UnsupportedQuestError, type RawEnemy, type RawQuest, type RawStage } from './quest';
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
  it('field traits as Chaldea questIndividuality, and the caller-set event id', () => {
    const t = (...ids: number[]) => ids.map((id) => ({ id }));
    expect(fieldTraitsOf({ stages: [], individuality: t(1, 2) })).toEqual([1, 2]);
    // phaseIndividuality: battleBg traits + its positive ids, minus its negative ones.
    expect(fieldTraitsOf({ stages: [], individuality: t(9), battleBg: { individuality: t(3, 4) }, phaseIndividuality: t(5, -4) }))
      .toEqual([3, 5]);
    expect(fieldTraitsOf({ stages: [], individuality: t(9), phaseIndividuality: null })).toEqual([9]);
    const q = questFromAtlas({ ...quest({}), individuality: t(94000160), eventId: 80494 });
    expect(q).toMatchObject({ fieldTraits: [94000160], eventId: 80494 });
    expect(questFromAtlas(quest({}))).not.toHaveProperty('fieldTraits');
    expect(questFromAtlas(quest({}))).not.toHaveProperty('eventId');
  });
  it('sorts by deckId', () => {
    const q = questFromAtlas(quest({ enemies: [mk({ deckId: 2, hp: 2 }), mk({ deckId: 1, hp: 1 })] }));
    expect(q.waves[0].map((e) => e.hp)).toEqual([1, 2]);
  });
  it('rejects reinforcements that enter next turn (no enemyImmediateAppear)', () => {
    const four = [1, 2, 3, 4].map((deckId) => mk({ deckId }));
    expect(reasons(quest({ enemies: four }))).toEqual([expect.stringMatching(/wave 1: reinforcements enter next turn/)]);
    expect(reasons(quest({ enemies: four, enemyFieldPosCount: 6 }))).toEqual([]);
    // Later wave, slot 1 empty: deckId 4 only enters at the next turn start.
    expect(reasons(quest({}, { enemies: [mk({ deckId: 2 }), mk({ deckId: 4 })] }))[0]).toMatch(/wave 2: reinforcements/);
  });
  it('wave 1 fills its empty slots at the turn start, even without the flag', () => {
    const q = questFromAtlas(quest({ enemies: [mk({ deckId: 1, hp: 1 }), mk({ deckId: 3, hp: 3 }), mk({ deckId: 5, hp: 5 })] }));
    expect(q.waves[0].map((e) => e.hp)).toEqual([1, 3, 5]);
    // Without the flag the auto target is the first living slot.
    expect(q.layouts?.[0]).toEqual({ field: [0, 2, 1], reserve: [], refill: [0, 1, 2], retarget: [0, 2, 1] });
  });
  it('models reinforcements on enemyImmediateAppear quests: field, reserve in deckId order, refill slots', () => {
    const hp = (deckId: number) => mk({ deckId, hp: deckId * 100 });
    const q = questFromAtlas({ ...quest(
      { enemies: [hp(5), hp(1), hp(4), hp(2), hp(3)] },
      { enemies: [hp(2), hp(6)], enemyFieldPosCount: 3, NoEntryIds: [3] },
      { enemies: [hp(1), hp(2), hp(3), hp(4)], originalScript: { enemyEntryOrder: [3, 1, 2] } },
    ), flags: ['enemyImmediateAppear'] });
    expect(q.waves[0].map((e) => e.hp)).toEqual([100, 200, 300, 400, 500]);
    // Auto target on these quests: lowest uniqueId = order of stage.enemies.
    expect(q.layouts?.[0]).toEqual({ field: [0, 1, 2], reserve: [3, 4], refill: [0, 1, 2], retarget: [4, 0, 3, 1, 2] });
    // Later wave: slot 0 stays empty until the first refill; slot 3 never refills.
    expect(q.layouts?.[1]).toEqual({ field: [-1, 0, -1], reserve: [1], refill: [0, 1] });
    expect(q.layouts?.[2]).toEqual({ field: [0, 1, 2], reserve: [3], refill: [1, 2, 0] });
  });
  it('builds refill from enemyEntryOrder as Chaldea does; rejects bad lengths and unreachable reserves', () => {
    const flags = ['enemyImmediateAppear'];
    const four = [1, 2, 3, 4].map((deckId) => mk({ deckId }));
    const short = questFromAtlas({ ...quest({ enemies: four, originalScript: { enemyEntryOrder: [2, 1] } }), flags });
    expect(short.layouts?.[0]?.refill).toEqual([1, 0]);
    expect(reasons({ ...quest({ enemies: four, originalScript: { enemyEntryOrder: [1, 2, 3, 4] } }), flags })[0])
      .toMatch(/enemyEntryOrder longer/);
    expect(reasons(quest({ enemies: [mk()], originalScript: { enemyAutoTargetOrder: [1, 2] } }))[0]).toMatch(/enemyAutoTargetOrder/);
    // 1 refill slot, 3 in reserve: the 3rd enters after the 3rd NP at best.
    const five = [1, 2, 3, 4, 5, 6].map((deckId) => mk({ deckId }));
    expect(reasons({ ...quest({ enemies: five, NoEntryIds: [2, 3] }), flags })[0]).toMatch(/need more than 3 NPs/);
    expect(reasons({ ...quest({ enemies: five.slice(0, 5), NoEntryIds: [2, 3] }), flags })).toEqual([]);
  });
  it('rejects reinforcements with every slot in NoEntryIds and duplicate deckIds', () => {
    const flags = ['enemyImmediateAppear'];
    const four = [1, 2, 3, 4].map((deckId) => mk({ deckId }));
    expect(reasons({ ...quest({ enemies: four, NoEntryIds: [1, 2, 3] }), flags })[0]).toMatch(/no slot to enter/);
    expect(reasons(quest({ enemies: [mk({ deckId: 1 }), mk({ deckId: 1 })] }))[0]).toMatch(/deckId 1 is not a free slot/);
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
    const bad = ['specialdefence', 'invincible', 'avoidance', 'guts', 'addMaxhp', 'overwriteClassRelation',
      'deadFunction', 'damageFunction', 'entryFunction', 'wavestartFunction', 'mysteryBuff'];
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
  it('models passive defence up and damage cut: max over levels, side-wide ones on every enemy', () => {
    const fn = (type: string, values: number[], funcTargetType = 'self') =>
      ({ funcType: 'addState', funcTargetType, buffs: [{ type }], svals: values.map((Value) => ({ Value })) });
    const cp = (...functions: ReturnType<typeof fn>[]) => ({ classPassive: [{ name: 'P', functions }], addPassive: [] });
    const q = questFromAtlas(quest({ enemies: [
      mk({ deckId: 1, classPassive: cp(fn('upDefence', [100, 200]), fn('subSelfdamage', [500])) }),
      mk({ deckId: 2, classPassive: cp(fn('upDefence', [0])) }),
      mk({ deckId: 3, classPassive: cp(fn('upDefence', [50], 'ptOtherFull')) }),
    ] }));
    expect(q.waves[0].map((e) => [e.defUp, e.dmgCut])).toEqual([[250, 500], [50, undefined], [50, undefined]]);
    expect(reasons(quest({ enemies: [mk({ classPassive: cp(fn('upDefence', [-100])) })] }))[0]).toMatch(/negative value/);
  });
  it('allows harmless enemy self-buffs (attack, crit, debuff resist, regen, own-attack triggers)', () => {
    const ok = ['upAtk', 'upCriticaldamage', 'upTolerance', 'regainHp', 'upHate', 'addDamage', 'addIndividuality',
      'downCommandall', 'commandattackAfterFunction', 'selfturnendFunction', 'delayFunction'];
    expect(reasons(quest({ enemies: [mk({ classPassive: passive(ok) })] }))).toEqual([]);
  });
  it('rejects unknown non-buff functions in a passive', () => {
    const classPassive = { classPassive: [{ name: 'X', functions: [{ funcType: 'addFieldChangeToField', funcTargetType: 'self' }] }], addPassive: [] };
    expect(reasons(quest({ enemies: [mk({ classPassive })] }))[0]).toMatch(/addFieldChangeToField/);
  });
});
