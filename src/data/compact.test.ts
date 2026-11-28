import { describe, it, expect } from 'vitest';
import castoria from '../../test/fixtures/castoria.json';
import altria from '../../test/fixtures/altria.json';
import kscope from '../../test/fixtures/kaleidoscope.json';
import mcCombat from '../../test/fixtures/mc-combat.json';
import siegfried from '../../test/fixtures/siegfried.json';
import vritra from '../../test/fixtures/vritra.json';
import ibuki from '../../test/fixtures/ibuki.json';
import skadi from '../../test/fixtures/skadi.json';
import koyanskaya from '../../test/fixtures/koyanskaya-light.json';
import superOrion from '../../test/fixtures/super-orion.json';
import skill966533 from '../../test/fixtures/skill-966533.json';
import skill964095 from '../../test/fixtures/skill-964095.json';
import oni from '../../test/fixtures/pioneering-oni.json';
import eresh from '../../test/fixtures/ereshkigal.json';
import ishtar from '../../test/fixtures/ishtar.json';
import oberon from '../../test/fixtures/oberon.json';
import blackGrail from '../../test/fixtures/black-grail.json';
import aerialDrive from '../../test/fixtures/aerial-drive.json';
import skill960408 from '../../test/fixtures/skill-960408.json';
import skill966456 from '../../test/fixtures/skill-966456.json';
import skill966458 from '../../test/fixtures/skill-966458.json';
import { compactServant, compactCE, compactMC, convertFunctions, faceOf, partUnsupported, type PartDrops } from './compact';

describe('compactServant', () => {
  it('Castoria: S1 atkUp ptAll 20% 3 turns at lv10, gainNp 30%', () => {
    const s = compactServant(castoria as any);
    const s1 = s.skills.find((k) => k.num === 1)!;
    const atk = s1.effects.find((e) => e.kind === 'atkUp')!;
    expect(atk.target).toBe('ptAll');
    expect(atk.lv[9]).toEqual({ value: 200, turns: 3, count: -1 });
    expect(s1.effects.find((e) => e.kind === 'gainNp')!.lv[9].value).toBe(3000);
    expect(s1.cooldown[9]).toBe(6);
  });
  it('Castoria: S3 cardUp arts only, powerUp only vs trait 1172', () => {
    const s3 = compactServant(castoria as any).skills.find((k) => k.num === 3)!;
    expect(s3.effects.find((e) => e.kind === 'cardUp')!.cards).toEqual(['arts']);
    expect(s3.effects.find((e) => e.kind === 'powerUp')!.opTraits).toEqual([1172]);
  });
  it('keeps the Atlas rarity', () => {
    expect(compactServant(castoria as any).rarity).toBe(5);
    expect(compactServant({ ...(altria as any), rarity: 3 }).rarity).toBe(3);
  });
  it('Castoria: append 2 (Load Magical Energy) is 20% at level 10', () => {
    const s = compactServant(castoria as any);
    expect(s.append2).toHaveLength(10);
    expect(s.append2[9]).toBe(2000);
  });
  it('Castoria: simulable, support NP gives np null', () => {
    const s = compactServant(castoria as any);
    expect(s.unsupported).toEqual([]);
    expect(s.np).toBeNull();
    expect(s.passives.find((e) => e.kind === 'cardUp')!.cards).toEqual(['arts']);
  });
  it('Altria: buster AoE NP, 600% at NP5 OC1, 1 hit, npRate, simulable', () => {
    const s = compactServant(altria as any);
    expect(s.np!.card).toBe('buster');
    expect(s.np!.aoe).toBe(true);
    expect(s.np!.mult[0][4]).toBe(6000);
    expect(s.np!.hits).toEqual([100]);
    expect(s.np!.npRate).toEqual([86, 86, 86, 86, 86]);
    expect(s.unsupported).toEqual([]);
  });
  it('Altria: NP self gainNp scales with OC (20% -> 50%), lv = OC1', () => {
    const g = compactServant(altria as any).np!.extra.find((e) => e.kind === 'gainNp')!;
    expect(g.target).toBe('self');
    expect(g.pre).toBeUndefined();
    expect(g.oc![0][4].value).toBe(2000);
    expect(g.oc![4][4].value).toBe(5000);
    expect(g.oc!.map((o) => o[0].value)).toEqual([2000, 2750, 3500, 4250, 5000]);
    expect(g.lv).toEqual(g.oc![0]);
  });
  it('Altria: upgraded skills win, Riding passive is cardUp quick', () => {
    const s = compactServant(altria as any);
    expect(s.skills.map((k) => k.num)).toEqual([1, 2, 3]);
    expect(s.skills[1].effects.some((e) => e.kind === 'npDmgUp')).toBe(true);
    expect(s.passives).toHaveLength(1);
    expect(s.passives[0]).toMatchObject({ kind: 'cardUp', target: 'self', cards: ['quick'] });
    expect(s.np!.extra.map((e) => e.kind)).toEqual(['gainNp']);
  });
});

describe('convertFunctions', () => {
  const DROPPED = { out: [], unsupported: [] };
  const cardUpFn = (ckSelfIndv: { id: number }[]) => ({
    funcType: 'addStateShort', funcTargetType: 'self',
    buffs: [{ type: 'upCommandall', ckSelfIndv, ckOpIndv: [] }],
    svals: [{ Rate: 1000, Turn: 3, Count: -1, Value: 200 }],
  });
  it('upCommandall with empty ckSelfIndv applies to all cards', () => {
    const unsupported: string[] = [];
    const [e] = convertFunctions([cardUpFn([])], unsupported);
    expect(e).toMatchObject({ kind: 'cardUp', target: 'self', cards: ['arts', 'buster', 'quick'] });
    expect(unsupported).toEqual([]);
  });
  it('upCommandall conditioned on a non-card trait is dropped (helpful, condition unknown)', () => {
    const unsupported: string[] = [];
    expect(convertFunctions([cardUpFn([{ id: 4001 }, { id: 9999 }])], unsupported)).toEqual([]);
    expect(unsupported).toEqual([]);
  });

  const buff = (type: string, target = 'self', sv: Record<string, number> = {}, extra: any = {}) => ({
    funcType: 'addStateShort', funcTargetType: target, funcTargetTeam: 'playerAndEnemy',
    functvals: [], buffs: [{ type, ckSelfIndv: [], ckOpIndv: [], script: {} }],
    svals: [{ Rate: 1000, Turn: 3, Count: -1, Value: 200, ...sv }], ...extra,
  });
  const func = (funcType: string, target = 'self', sv: Record<string, number> = {}, extra: any = {}) => ({
    funcType, funcTargetType: target, funcTargetTeam: 'playerAndEnemy', functvals: [], buffs: [],
    svals: [{ Rate: 1000, Value: 1000, ...sv }], ...extra,
  });
  const run = (funcs: any[], opts?: any) => {
    const unsupported: string[] = [];
    return { out: convertFunctions(funcs, unsupported, opts), unsupported };
  };

  it('funcTargetTeam enemy is skipped (only runs when an enemy casts it)', () => {
    expect(run([buff('upAtk', 'self', {}, { funcTargetTeam: 'enemy' })])).toEqual({ out: [], unsupported: [] });
    expect(run([func('lossNp', 'self', {}, { funcTargetTeam: 'enemy' })])).toEqual({ out: [], unsupported: [] });
  });
  it('ignore lists depend on the target side', () => {
    expect(run([buff('invincible', 'enemy')]).unsupported).toEqual(['buff:invincible@enemy']);
    expect(run([buff('upDefence', 'enemyAll')]).unsupported).toEqual(['buff:upDefence@enemy']);
    // DEF down / card resist down on enemies are modelled (Enemy.debuffs).
    expect(run([buff('downDefence', 'enemy')]).out).toEqual([{ kind: 'defDown', target: 'enemy', lv: [{ value: 200, turns: 3, count: -1 }] }]);
    // A self stun is a modelled demerit (EffectKind stun), certain, value 1.
    expect(run([buff('donotAct', 'self')]).out).toEqual([{ kind: 'stun', target: 'self', lv: [{ value: 1, turns: 3, count: -1 }] }]);
    expect(run([buff('specialInvincible', 'enemy')]).unsupported).toEqual(['buff:specialInvincible@enemy']);
    // Enemy ATK up only matters when it attacks: never in the model.
    expect(run([buff('upAtk', 'enemy')])).toEqual({ out: [], unsupported: [] });
  });
  const ignored = (f: any) => expect(run([f])).toEqual({ out: [], unsupported: [] });
  it('enemy debuffs: card conditions kept, any other condition drops them', () => {
    const quickRes = buff('downDefencecommandall', 'enemyAll');
    quickRes.buffs[0].ckOpIndv = [{ id: 4003 }];
    expect(run([quickRes]).out).toEqual([expect.objectContaining({ kind: 'cardResDown', target: 'enemyAll', cards: ['quick'] })]);
    const vsHuman = buff('downDefence', 'enemy');
    vsHuman.buffs[0].ckOpIndv = [{ id: 1001 }];
    expect(run([vsHuman])).toEqual({ out: [], unsupported: [] });
    const onlyDragons = buff('downDefence', 'enemy');
    onlyDragons.buffs[0].ckSelfIndv = [{ id: 2002 }];
    expect(run([onlyDragons])).toEqual({ out: [], unsupported: [] });
  });
  it('buffConvert between ignored ally buffs (Kukulcan / Aoko: Invincible -> Anti-Enforcement DEF) is ignored; others are not', () => {
    const conv = (from: string, to: string, convertType = 'buff') => ({
      funcType: 'addState', funcTargetType: 'self',
      buffs: [{ type: 'buffConvert', script: { convert: { convertType, targetBuffs: [{ type: from }], convertBuffs: [{ type: to }] } } }],
      svals: [{ Rate: 1000, Turn: -1, Count: -1 }],
    });
    ignored(conv('invincible', 'specialInvincible'));
    for (const f of [conv('upAtk', 'specialInvincible'), conv('invincible', 'upAtk'), conv('invincible', 'specialInvincible', 'individuality')]) {
      const unsupported: string[] = [];
      expect(convertFunctions([f], unsupported)).toEqual([]);
      expect(unsupported).toEqual(['buff:buffConvert']);
    }
  });
  it("Jekyll's transformation into Hyde (600710) is dropped; another servant's is not", () => {
    const tr = (Value: number) => ({ funcType: 'transformServant', funcTargetType: 'self', buffs: [], svals: [{ Rate: 5000, Value, Target: 0 }] });
    ignored(tr(600710));
    const unsupported: string[] = [];
    convertFunctions([tr(2501500)], unsupported);
    expect(unsupported).toContain('func:transformServant');
  });
  it('effects of skill option 1+ (ActSelectIndex >= 1: Prelati, Flora) are dropped, even unsupported ones', () => {
    const unsupported: string[] = [];
    const opt = { funcType: 'addStateShort', funcTargetType: 'self', buffs: [{ type: 'tdTypeChangeArts', vals: [] }], svals: [{ Rate: 5000, Turn: 5, Count: -1, ActSelectIndex: 1 }] };
    expect(convertFunctions([opt], unsupported)).toEqual([]);
    expect(unsupported).toEqual([]);
  });
  it('a transformation the player opts into (ActSelectIndex >= 1: Prelati, Flora) is dropped; option 0 or no choice is not', () => {
    const tr = (extra: object) => ({ funcType: 'transformServant', funcTargetType: 'self', buffs: [], svals: [{ Rate: 5000, Value: 505700, Target: 0, ...extra }] });
    ignored(tr({ ActSelectIndex: 1, CancelTransform: 1 }));
    for (const f of [tr({}), tr({ ActSelectIndex: 0 })]) {
      const unsupported: string[] = [];
      convertFunctions([f], unsupported);
      expect(unsupported).toContain('func:transformServant');
    }
  });
  it('only-helpful effects on allies are ignored', () => {
    for (const t of ['pierceInvincible', 'breakAvoidance', 'subSelfdamage', 'downDefence',
      'downDefencecommandall', 'addIndividuality']) ignored(buff(t, 'self'));
    ignored(func('lossHpSafe', 'self'));
  });
  it('only-helpful effects on enemies are ignored', () => {
    for (const t of ['reduceHp', 'donotSkill', 'donotNoble', 'addIndividuality']) ignored(buff(t, 'enemy'));
    ignored(func('lossNp', 'enemyAll'));
    // ...but the same effects on our side still block: they can hurt.
    // (reduceHp on our side is ignored too: a turn-end DoT cannot kill, see compact.ts.)
    ignored(buff('reduceHp', 'self'));
    expect(run([buff('donotNoble', 'self')]).out).toEqual([{ kind: 'sealNp', target: 'self', lv: [{ value: 1, turns: 3, count: -1 }] }]);
  });
  it('more only-helpful effects are ignored on their side only', () => {
    for (const t of ['pierceDefence', 'downCriticalRateDamageTaken', 'downStarweight', 'upGrantInstantdeath',
      'avoidInstantdeath', 'downTolerance', 'fieldIndividuality']) ignored(buff(t, 'self'));
    for (const f of ['lossStar', 'displayBuffstring', 'cardReset', 'gainNpBuffIndividualSum', 'addFieldChangeToField']) {
      ignored(func(f, 'self'));
    }
    for (const t of ['upFuncHpReduce', 'upNonresistInstantdeath', 'avoidState', 'downGainHp']) ignored(buff(t, 'enemy'));
    ignored(func('displayBuffstring', 'enemy'));
    ignored(buff('upFuncHpReduce', 'self')); // DoT received: cannot kill at a cleared turn end
    for (const t of ['downCriticaldamage', 'downCriticalpoint']) ignored(buff(t, 'self')); // crit demerits
    expect(run([buff('downTolerance', 'enemy')])).toEqual({ out: [], unsupported: [] });
  });
  it('without a lookup, skill-triggering buffs stay unsupported (old behaviour)', () => {
    for (const t of ['attackAfterFunction', 'skillBeforeFunction', 'selfturnendFunction', 'delayFunction']) {
      expect(run([buff(t, 'self', { Value: 900001 })]).unsupported).toEqual(['buff:' + t]);
    }
  });
  it('triggers an NP never sets off (command-card attacks, Extra-only attacks) are ignored on allies, no lookup needed', () => {
    for (const t of ['commandattackBeforeFunction', 'commandattackAfterFunction', 'commandattackAfterFunctionMainOnly']) ignored(buff(t, 'self', { Value: 900001 }));
    const onCard = (card: number) => ({ ...buff('attackBeforeFunction', 'self', { Value: 900001 }), buffs: [{ type: 'attackBeforeFunction', ckSelfIndv: [{ id: card }], ckOpIndv: [], script: {} }] });
    ignored(onCard(4004)); // Extra attacks only
    expect(run([onCard(4001)]).unsupported).toEqual(['buff:attackBeforeFunction']);
  });
  it('on-hit triggers (damage, guts, death) never fire on allies: ignored, no lookup needed', () => {
    for (const t of ['damageFunction', 'gutsFunction', 'deadFunction']) ignored(buff(t, 'self', { Value: 900001 }));
    // On an enemy holder they fire when we hit it: still need the lookup.
    expect(run([buff('damageFunction', 'enemy', { Value: 900001 })]).unsupported).toEqual(['buff:damageFunction@enemy']);
  });
  describe('with a trigger lookup', () => {
    const skill = (id: number, functions: any[]) => [id, { id, functions }] as [number, any];
    const lookup = new Map<number, any>([
      skill(1, [func('gainNp', 'self'), buff('upAtk', 'self'), func('gainStar', 'self')]), // helpful
      skill(2, [func('lossNp', 'self')]),                                                   // harmful
      skill(3, [buff('downDefence', 'enemy'), func('damageNp', 'enemy')]),                  // helps us
      skill(4, [buff('attackAfterFunction', 'self', { Value: 1 })]),                         // nested, helpful
      skill(5, [buff('attackAfterFunction', 'self', { Value: 4 })]),                         // too deep
      skill(6, [func('replaceMember', 'ptselectOneSub')]),                                   // not helpful
      skill(7, [func('lossNp', 'self'), func('gainNp', 'self', {}, { funcTargetTeam: 'enemy' })]),
      skill(8, [func('lossNp', 'enemy')]),          // held by an enemy: "enemy" = our side
    ]);
    const trig = (t: string, id: number, target = 'self') => run([buff(t, target, { Value: id })], { triggers: lookup });
    it('a helpful (or only-helps-us) triggered skill: the trigger is ignored', () => {
      expect(trig('attackAfterFunction', 1)).toEqual({ out: [], unsupported: [] });
      expect(trig('commandattackAfterFunction', 3)).toEqual({ out: [], unsupported: [] });
      expect(trig('selfturnendFunction', 4)).toEqual({ out: [], unsupported: [] });
    });
    it('a harmful, missing, too deep or non-helpful triggered skill: unsupported', () => {
      expect(trig('attackAfterFunction', 2).unsupported).toEqual(['trigger:attackAfterFunction:func:lossNp']);
      expect(trig('attackAfterFunction', 99).unsupported).toEqual(['trigger:attackAfterFunction:missing:99']);
      expect(trig('attackAfterFunction', 5).unsupported)
        .toEqual(['trigger:attackAfterFunction:trigger:attackAfterFunction:trigger:attackAfterFunction:depth']);
      expect(trig('attackAfterFunction', 6).unsupported).toEqual(['trigger:attackAfterFunction:orderChange']);
      expect(trig('delayFunction', 7).unsupported).toEqual(['trigger:delayFunction:func:lossNp']);
    });
    it('on an enemy holder, sides inside the triggered skill are flipped', () => {
      // lossNp "on enemy" from an enemy-held buff hits our side: harmful.
      expect(trig('selfturnendFunction', 8, 'enemy').unsupported)
        .toEqual(['trigger:selfturnendFunction@enemy:func:lossNp']);
      // ...while a self-buff of the enemy (upAtk on itself) is an enemy buff: unsupported too.
      expect(trig('selfturnendFunction', 1, 'enemy').unsupported[0]).toMatch(/^trigger:selfturnendFunction@enemy:/);
    });
  });
  it('a non-helpful kind (orderChange) with an unknown condition stays unsupported', () => {
    expect(run([func('replaceMember', 'ptselectOneSub', { EventId: 1 })]).unsupported).toEqual(['cond:replaceMember']);
  });
  it('subState removing only debuff families (poison/burn/curse) is ignored', () => {
    ignored(func('subState', 'ptAll', {}, { traitVals: [{ id: 3011 }, { id: 3026 }, { id: 3015 }] }));
    // Defence ups (not modelled on our side) and mental debuffs: nothing we model is removed.
    ignored(func('subState', 'self', {}, { traitVals: [{ id: 3007 }] }));
    // Removing every positive buff (Hassan of the Hundred S3): the clearBuffs demerit.
    expect(run([func('subState', 'self', {}, { traitVals: [{ id: 3004 }] })]).out).toEqual([{ kind: 'clearBuffs', target: 'self', lv: [{ value: 1, turns: -1, count: -1 }] }]);
    // Removing buffs of some other kind (a trait we do not track) stays unsupported.
    expect(run([func('subState', 'self', {}, { traitVals: [{ id: 2386 }] })]).unsupported).toEqual(['func:subState']);
  });
  it('ptOtherFull maps to ptOther (backline buff dropped: conservative)', () => {
    expect(run([buff('upAtk', 'ptOtherFull')]).out[0].target).toBe('ptOther');
  });
  it('display-only sval keys are accepted', () => {
    expect(run([buff('upAtk', 'self', { ShowQuestNoEffect: 1, HideMiss: 1, HideNoEffect: 1 })]).out).toHaveLength(1);
    expect(run([buff('upAtk', 'self', { DisplayLastFuncInvalidType: 1 })])).toEqual(DROPPED);
  });
  it('random or player-chosen options (ActSet, ActSelectIndex) are not guaranteed', () => {
    expect(run([buff('upAtk', 'self', { ActSet: 1, ActSetWeight: 20 })])).toEqual({ out: [], unsupported: [] });
    expect(run([buff('upAtk', 'self', { ActSelectIndex: 0 })])).toEqual({ out: [], unsupported: [] });
    // ...and a follow-up after them is not unconditional either.
    expect(run([buff('upAtk', 'self', { ActSet: 1 }), func('gainNp', 'self', { Rate: -1000 })]).out).toEqual([]);
  });
  it('checkIndvType: one trait per list, or several ckOpIndv traits that must all match (opAll)', () => {
    const one = buff('upDamage');
    one.buffs[0].script = { checkIndvType: 1 } as any;
    one.buffs[0].ckOpIndv = [{ id: 1 }] as any;
    expect(run([one]).out[0].opTraits).toEqual([1]);
    const two = (checkIndvType: number) => {
      const f = buff('upDamage');
      f.buffs[0].script = { checkIndvType } as any;
      f.buffs[0].ckOpIndv = [{ id: 1 }, { id: 2 }] as any;
      return f;
    };
    expect(run([two(1)]).out[0]).toMatchObject({ opTraits: [1, 2], opAll: true });
    expect(run([two(2)])).toEqual(DROPPED);
  });
  it('self functvals are accepted only when the servant always has the traits', () => {
    const f = buff('upAtk', 'self', {}, { functvals: [{ id: 300 }] });
    const traits = new Set([300, 1000]);
    expect(run([f], { selfTraits: traits }).out).toHaveLength(1);
    expect(run([f], { selfTraits: new Set([301]) })).toEqual(DROPPED);
    const ally = buff('upAtk', 'ptOther', {}, { functvals: [{ id: 300 }] });
    expect(run([ally], { selfTraits: traits })).toEqual(DROPPED);
  });
  it('addDamage on an ally is modelled as dmgPlus, with its trait condition', () => {
    const f = buff('addDamage', 'ptAll', { Value: 500 });
    f.buffs[0].ckOpIndv = [{ id: 2002 }] as any;
    expect(run([f]).out).toEqual([
      { kind: 'dmgPlus', target: 'ptAll', lv: [{ value: 500, turns: 3, count: -1 }], opTraits: [2002] },
    ]);
    expect(run([buff('addDamage', 'enemy')]).unsupported).toEqual(['buff:addDamage@enemy']);
  });
  it('harmful functions on allies are unsupported, demerits modelled', () => {
    expect(run([func('lossNp')]).out).toEqual([{ kind: 'lossNp', target: 'self', lv: [{ value: 1000, turns: -1, count: -1 }] }]);
    expect(run([buff('multiattack', 'self')])).toEqual({ out: [], unsupported: [] });
    expect(run([buff('downAtk', 'self')]).out).toEqual([{ kind: 'atkUp', target: 'self', lv: [{ value: -200, turns: 3, count: -1 }] }]);
    expect(run([func('instantDeath', 'ptOne')]).unsupported).toEqual(['func:instantDeath']);
    // Removing every positive buff (Hassan of the Hundred S3): the clearBuffs demerit.
    expect(run([func('subState', 'self', {}, { traitVals: [{ id: 3004 }] })]).out).toEqual([{ kind: 'clearBuffs', target: 'self', lv: [{ value: 1, turns: -1, count: -1 }] }]);
    // Removing buffs of some other kind (a trait we do not track) stays unsupported.
    expect(run([func('subState', 'self', {}, { traitVals: [{ id: 2386 }] })]).unsupported).toEqual(['func:subState']);
    expect(run([func('subState', 'self')]).unsupported).toEqual(['func:subState']);
    // Removing debuffs only (traitVals = buffNegativeEffect) can only help.
    expect(run([func('subState', 'self', {}, { traitVals: [{ id: 3005 }] })])).toEqual({ out: [], unsupported: [] });
  });
  it('Rate < 1000: helpful skipped, a demerit counted as certain', () => {
    expect(run([func('gainNp', 'self', { Rate: 500 })])).toEqual({ out: [], unsupported: [] });
    expect(run([func('lossNp', 'self', { Rate: 500 })]).out).toEqual([{ kind: 'lossNp', target: 'self', lv: [{ value: 1000, turns: -1, count: -1 }] }]);
  });
  it('Rate varying by level: unguaranteed levels get value 0', () => {
    const f = func('gainNp');
    f.svals = [{ Rate: 500, Value: 1000 }, { Rate: 1000, Value: 2000 }];
    expect(run([f]).out[0].lv.map((l) => l.value)).toEqual([0, 2000]);
  });
  it('negative Rate follow-up: kept only after an unconditional function', () => {
    const follow = func('gainNp', 'self', { Rate: -1000, Value: 500 });
    expect(run([buff('upAtk'), follow]).out.map((e) => e.kind)).toEqual(['atkUp', 'gainNp']);
    expect(run([buff('upAtk', 'self', { Rate: 500 }), follow]).out).toEqual([]);
    expect(run([func('gainNp', 'self', { Rate: -500 })]).out).toEqual([]);
    expect(run([follow]).out).toEqual([]); // nothing before it
    // |Rate| < 1000 follow-up after a guaranteed function: still a chance, dropped.
    expect(run([buff('upAtk'), func('gainNp', 'self', { Rate: -500 })]).out.map((e) => e.kind)).toEqual(['atkUp']);
  });
  it('extra conditions on a helpful modelled effect: dropped', () => {
    expect(run([buff('upAtk', 'self', {}, { functvals: [{ id: 1 }] })])).toEqual(DROPPED);
    const scripted = buff('upAtk');
    scripted.buffs[0].script = { INDIVIDUALITIE: 1 } as any;
    expect(run([scripted])).toEqual(DROPPED);
    const ok = buff('upAtk');
    ok.buffs[0].script = { ProgressSelfTurn: 1 } as any;
    expect(run([ok]).unsupported).toEqual([]);
    // Conditions on an ignored effect do not matter.
    expect(run([buff('invincible', 'self', { EventId: 1 })]).unsupported).toEqual([]);
  });
  it('quest conditions: field traits (any-of) and EventId kept on the effect', () => {
    const fq = (ids: number[], sv = {}) => buff('upDamage', 'self', sv, { funcquestTvals: ids.map((id) => ({ id })) });
    expect(run([fq([94000160, 94000161])]).out[0]).toMatchObject({ kind: 'powerUp', fieldTraits: [94000160, 94000161] });
    expect(run([fq([94000160])]).out[0].eventId).toBeUndefined();
    expect(run([buff('upAtk', 'self', { EventId: 80001 })]).out[0]).toMatchObject({ kind: 'atkUp', eventId: 80001 });
    expect(run([fq([94000160], { EventId: 80001 })]).out[0]).toMatchObject({ fieldTraits: [94000160], eventId: 80001 });
    expect(run([buff('upAtk', 'self', { EventId: 0 })]).out[0]).not.toHaveProperty('eventId');
    // A negative (none-of) trait could be wrongly met (field traits added at runtime are ignored): dropped.
    expect(run([fq([-94000160])])).toEqual(DROPPED);
    expect(run([fq([94000160, -5])])).toEqual(DROPPED);
    // Other conditions alongside still drop it.
    expect(run([buff('upAtk', 'self', {}, { funcquestTvals: [{ id: 1 }], functvals: [{ id: 2 }] })])).toEqual(DROPPED);
    // A quest-conditioned function is not unconditional: its follow-up is a failed chance.
    expect(run([fq([1]), func('gainNp', 'self', { Rate: -1000, Value: 500 })]).out.map((e) => e.kind)).toEqual(['powerUp']);
    // Non-helpful kinds stay unsupported under a quest condition.
    expect(run([func('replaceMember', 'ptselectOneSub', {}, { funcquestTvals: [{ id: 1 }] })]).unsupported).toEqual(['cond:replaceMember']);
  });
  it('NP extras: pre flag, OC-dependent extras, stray damage functions', () => {
    const dmg = func('damageNp', 'enemyAll');
    const before = func('gainNp');
    const after = buff('upAtk');
    const { out } = run([before, dmg, after], { npDamage: dmg, npExtras: true });
    expect(out.map((e) => e.pre)).toEqual([true, undefined]);
    expect(out.every((e) => e.oc === undefined)).toBe(true); // no OC variants
    const sv = (Value: number, Rate = 1000) => [{ Rate, Value }];
    const oc = func('gainNp', 'self', {}, {
      svals2: sv(2000), svals3: sv(3000, 500), svals4: sv(4000), svals5: sv(5000),
    });
    const r = run([dmg, oc], { npDamage: dmg, npExtras: true });
    expect(r.unsupported).toEqual([]);
    // Per-level Rate rule applies to each OC variant: OC3 at Rate 500 -> 0.
    expect(r.out[0].oc!.map((o) => o[0].value)).toEqual([1000, 2000, 0, 4000, 5000]);
    expect(r.out[0].lv[0].value).toBe(1000);
    // Unknown keys in an OC variant are a condition too.
    const condOc = func('gainNp', 'self', {}, {
      svals2: [{ Rate: 1000, Value: 2000, EventId: 1 }], svals3: sv(3000), svals4: sv(4000), svals5: sv(5000),
    });
    expect(run([dmg, condOc], { npDamage: dmg, npExtras: true })).toEqual(DROPPED);
    // Equal OC variants: no oc field.
    const flat = func('gainNp', 'self', {}, { svals2: sv(1000), svals3: sv(1000), svals4: sv(1000), svals5: sv(1000) });
    expect(run([dmg, flat], { npDamage: dmg, npExtras: true }).out[0].oc).toBeUndefined();
    expect(run([func('damageNp', 'enemy')]).unsupported).toEqual(['func:damageNp@enemy']);
  });
});

describe('compactServant NP selection', () => {
  it('picks the highest priority NP regardless of order, flags unknown cards', () => {
    const swapped = { ...(altria as any), noblePhantasms: [...(altria as any).noblePhantasms].reverse() };
    expect(compactServant(swapped).np!.mult[0][0]).toBe(4000);
    const nps = (altria as any).noblePhantasms.map((n: any) => ({ ...n, card: '9' }));
    const bad = compactServant({ ...(altria as any), noblePhantasms: nps });
    expect(bad.np).toBeNull();
    expect(bad.unsupported).toContain('np:card:9');
  });
  it('damageNpPierce computes like damageNp', () => {
    const nps = (altria as any).noblePhantasms.map((n: any) => ({
      ...n, functions: n.functions.map((f: any) => (f.funcType === 'damageNp' ? { ...f, funcType: 'damageNpPierce' } : f)),
    }));
    const s = compactServant({ ...(altria as any), noblePhantasms: nps });
    expect(s.unsupported).toEqual([]);
    expect(s.np!.mult[0][4]).toBe(6000);
    expect(s.np!.seMult).toBeUndefined();
  });
  it('Siegfried: supereffective NP vs Dragon (2002), simulable', () => {
    const s = compactServant(siegfried as any);
    expect(s.np!.seTraits).toEqual([2002]);
    expect(s.np!.seMult![0][0]).toBe(1500);
    expect(s.np!.seMult![1][0]).toBe(1625);
    expect(s.np!.mult[0][0]).toBe(4000);
    expect(s.unsupported).toEqual([]);
  });
});

describe('popular farming servants (real fixtures)', () => {
  it('Vritra: arts AoE, simulable', () => {
    const s = compactServant(vritra as any);
    expect(s.unsupported).toEqual([]);
    expect(s.np).toMatchObject({ card: 'arts', aoe: true });
    expect(s.skills[1].effects.map((e) => e.kind)).toEqual(['powerUp', 'gainNp']);
  });
  it('Ibuki-Douji: damageNpPierce AoE buster, addDamage passive as dmgPlus, simulable', () => {
    const s = compactServant(ibuki as any);
    expect(s.unsupported).toEqual([]);
    expect(s.np).toMatchObject({ card: 'buster', aoe: true });
    const plus = s.passives.find((e) => e.kind === 'dmgPlus')!;
    expect(plus.target).toBe('self');
    expect(plus.lv[0].value).toBeGreaterThan(0);
  });
  it('Scathach-Skadi: support NP (null), arts up / NP battery, simulable', () => {
    const s = compactServant(skadi as any);
    expect(s.unsupported).toEqual([]);
    expect(s.np).toBeNull();
    expect(s.skills[0].effects[0]).toMatchObject({ kind: 'cardUp', target: 'ptOne', cards: ['quick'] });
    expect(s.skills[2].effects[0]).toMatchObject({ kind: 'gainNp', target: 'ptOne' });
  });
  // Lookup built from saved /nice/NA/skill/{id} fixtures, like build-data does.
  const lookup = new Map<number, any>([skill966533, skill964095].map((k: any) => [k.id, k]));
  it('Koyanskaya of Light: NP-gain trigger resolved and ignored, simulable', () => {
    // A command-card trigger (S2): never set off by an NP, so even without a lookup.
    const bare = compactServant(koyanskaya as any);
    expect(bare.unsupported).toEqual([]);
    expect(bare.skills[1].unsupported).toBeUndefined();
    const s = compactServant(koyanskaya as any, lookup);
    expect(s.unsupported).toEqual([]);
    expect(s.np).toMatchObject({ card: 'buster', aoe: true });
  });
  it('Super Orion: crit trigger resolved, poison demerit ignored, simulable (self-buff NP: np null)', () => {
    const s = compactServant(superOrion as any, lookup);
    expect(s.unsupported).toEqual([]);
    expect(s.np).toBeNull();
  });
  it('a form change anywhere in the kit marks the servant unsupported', () => {
    const tf = { funcType: 'transformServant', funcTargetType: 'self', funcTargetTeam: 'playerAndEnemy', functvals: [], buffs: [], svals: [{ Rate: 5000, Value: 1 }] };
    const skills = (altria as any).skills.map((k: any) => (k.num === 3 && k.priority === 1 ? { ...k, functions: [...k.functions, tf] } : k));
    expect(compactServant({ ...(altria as any), skills }).unsupported).toContain('func:transformServant');
  });
});

describe('compactServant event passives', () => {
  const ep = (eventId: number, priority: number, functions: any[], cond: any = {}) => ({
    id: eventId * 10 + priority, name: 'ep', functions,
    extraPassive: [{ eventId, priority, condFriendshipRank: 0, condLimitCount: 0, condLv: 0, condQuestId: 0, releaseConditions: [], ...cond }],
  });
  const dmg = (Value: number) => ({
    funcType: 'addStateShort', funcTargetType: 'self', funcTargetTeam: 'playerAndEnemy', functvals: [],
    funcquestTvals: [{ id: 94000999 }], buffs: [{ type: 'upDamage', ckSelfIndv: [], ckOpIndv: [], script: {} }],
    svals: [{ Rate: 1000, Turn: -1, Count: -1, Value }],
  });
  const friend = { funcType: 'servantFriendshipUp', funcTargetType: 'self', funcTargetTeam: 'playerAndEnemy', functvals: [], buffs: [], svals: [{ EventId: 1 }] };
  const with_ = (extraPassive: any[]) => compactServant({ ...(altria as any), extraPassive });
  it('one per event (highest priority), with its field-conditioned effects', () => {
    const s = with_([ep(80001, 1, [dmg(300)]), ep(80001, 2, [dmg(500), friend]), ep(80002, 1, [dmg(100)])]);
    expect(s.eventPassives).toEqual([
      { eventIds: [80001], effects: [{ kind: 'powerUp', target: 'self', lv: [{ value: 500, turns: -1, count: -1 }], fieldTraits: [94000999] }] },
      { eventIds: [80002], effects: [expect.objectContaining({ kind: 'powerUp' })] },
    ]);
    expect(s.unsupported).toEqual([]);
  });
  it('an event with a release condition (bond, ascension, quest) is dropped whole; no event = ignored', () => {
    expect(with_([ep(80001, 1, [dmg(300)]), ep(80001, 2, [dmg(500)], { condFriendshipRank: 5 })]).eventPassives).toBeUndefined();
    expect(with_([ep(80001, 1, [dmg(300)], { condQuestId: 1 })]).eventPassives).toBeUndefined();
    expect(with_([ep(0, 1, [dmg(300)])]).eventPassives).toBeUndefined();
    expect(with_([ep(80001, 1, [friend])]).eventPassives).toBeUndefined();
  });
  it('Ereshkigal: event bonuses without release conditions only', () => {
    const s = compactServant(eresh as any);
    const ids = s.eventPassives!.flatMap((p) => p.eventIds);
    expect(ids).toEqual([80364, 80424, 80476]);
    // Not 80038 (Power of Bonds: bond rank) nor 80414 (gainNp 300%, needs a shop purchase: releaseConditions).
    expect(s.eventPassives!.find((p) => p.eventIds.includes(80424))!.effects).toEqual([
      { kind: 'powerUp', target: 'self', lv: [{ value: 300, turns: -1, count: -1 }], fieldTraits: [94000142] },
    ]);
  });
});

describe('compactCE', () => {
  it('falls back to non-MLB effects when the CE has no MLB skill', () => {
    const ce = compactCE({
      id: 1, collectionNo: 1, name: 'x', atkGrowth: [],
      skills: [{ num: 1, condLimitCount: 0, functions: [{
        funcType: 'gainNp', funcTargetType: 'self', funcTargetTeam: 'player', functvals: [], buffs: [],
        svals: [{ Rate: 1000, Value: 3000 }],
      }] }],
    });
    expect(ce.effectsMlb).toEqual(ce.effects);
    expect(ce.effects[0].lv[0].value).toBe(3000);
  });
  const fn = (Value: number, fq: number[] = []) => ({
    funcType: 'addStateShort', funcTargetType: 'self', funcTargetTeam: 'playerAndEnemy', functvals: [],
    funcquestTvals: fq.map((id) => ({ id })), buffs: [{ type: 'upDamage', ckSelfIndv: [], ckOpIndv: [], script: {} }],
    svals: [{ Rate: 1000, Turn: -1, Count: -1, Value }],
  });
  const sk = (num: number, condLimitCount: number, ...functions: any[]) => ({ num, condLimitCount, priority: 1, functions });
  const vals = (es: { lv: { value: number }[] }[]) => es.map((e) => e.lv[0].value);
  it('Pioneering Oni: the event ATK bonus is kept with its field trait (200% MLB)', () => {
    const ce = compactCE(oni as any);
    expect(ce.unsupported).toEqual([]);
    expect(ce.effectsMlb.find((e) => e.kind === 'powerUp')).toEqual({
      kind: 'powerUp', target: 'self', lv: [{ value: 2000, turns: -1, count: -1 }], fieldTraits: [94000160],
    });
    expect(ce.effects.find((e) => e.kind === 'powerUp')!.lv[0].value).toBe(1000);
    expect(ce.effectsMlb.find((e) => e.kind === 'gainNp')!.lv[0].value).toBe(5000);
  });
  it('MLB variants are chosen per skill num (a num without one keeps its base skill)', () => {
    const ce = compactCE({ id: 1, collectionNo: 1, name: 'x', atkGrowth: [], skills: [sk(1, 0, fn(100)), sk(1, 4, fn(200)), sk(2, 0, fn(50))] });
    expect(vals(ce.effects)).toEqual([100, 50]);
    expect(vals(ce.effectsMlb)).toEqual([200, 50]);
  });
  it('several skills of one num: reruns on other fields kept, same-field levels dropped', () => {
    const rerun = compactCE({ id: 1, collectionNo: 1, name: 'x', atkGrowth: [], skills: [sk(2, 0, fn(100, [1])), sk(2, 0, fn(200, [2]))] });
    expect(rerun.effects.map((e) => e.fieldTraits)).toEqual([[1], [2]]);
    const levels = compactCE({ id: 1, collectionNo: 1, name: 'x', atkGrowth: [], skills: [sk(2, 0, fn(100, [1])), sk(2, 0, fn(200, [1])), sk(3, 0, fn(5))] });
    expect(vals(levels.effects)).toEqual([5]);
  });
  describe('conditions (synthetic, shaped like the Atlas CEs named)', () => {
    const buffFn = (type: string, b: object = {}, sv: object = {}, target = 'self') => ({
      funcType: 'addStateShort', funcTargetType: target, funcTargetTeam: 'playerAndEnemy', functvals: [], funcquestTvals: [],
      buffs: [{ type, ckSelfIndv: [], ckOpIndv: [], script: {}, vals: [], ...b }],
      svals: [{ Rate: 1000, Turn: -1, Count: -1, Value: 200, ...sv }],
    });
    const one = (...functions: any[]) => {
      const report: PartDrops[] = [];
      const ce = compactCE({ id: 1, collectionNo: 1, name: 'x', atkGrowth: [], skills: [sk(1, 0, ...functions)] }, undefined, report);
      return { es: ce.effects, report };
    };
    it('card conditions on any buff (Atlas Institute: Arts NP damage up); Extra-only ones lost nothing', () => {
      const ids = (...xs: number[]) => xs.map((id) => ({ id }));
      expect(one(buffFn('upNpdamage', { ckSelfIndv: ids(4001) })).es[0]).toMatchObject({ kind: 'npDmgUp', cards: ['arts'] });
      expect(one(buffFn('upDropnp', { ckSelfIndv: ids(4001) })).es[0]).toMatchObject({ kind: 'npGainUp', cards: ['arts'] });
      expect(one(buffFn('upCommandall', { ckSelfIndv: ids(4004) }))).toEqual({ es: [], report: [] });
      expect(one(buffFn('upNpdamage', { ckSelfIndv: ids(2) })).report[0].drops).toEqual(['holderTrait:npDmgUp']);
    });
    it('SetPassiveFrame is display only', () => {
      expect(one(buffFn('upNpdamage', {}, { SetPassiveFrame: 1 })).es).toHaveLength(1);
    });
    it('INDIVIDUALITIE_OR: a holder with any of the traits (Hometown: female or unknown)', () => {
      const f = buffFn('upCommandall', { ckSelfIndv: [{ id: 4001 }], script: { INDIVIDUALITIE_OR: [{ id: 2 }, { id: 3 }] } });
      expect(one(f).es[0]).toMatchObject({ kind: 'cardUp', cards: ['arts'], holderTraits: [2, 3] });
    });
    it('several ckOpIndv traits that must all match (Jokanaan: checkIndvType 1) -> opAll; another mode is dropped', () => {
      const f = (checkIndvType: number) => buffFn('upDamage', { ckOpIndv: [{ id: 300 }, { id: 303 }], script: { checkIndvType } });
      expect(one(f(1)).es[0]).toMatchObject({ kind: 'powerUp', opTraits: [300, 303], opAll: true });
      expect(one(f(2)).es).toEqual([]);
    });
    it('a buff growing every turn (Purely Bloom: 0 +5% per turn up to 40%) -> grow', () => {
      const bloom = buffFn('upNpdamage', {}, { Value: 0, ParamAdd: 50, ParamMax: 400 });
      expect(one(bloom).es[0]).toMatchObject({ kind: 'npDmgUp', lv: [{ value: 0 }], grow: { add: 50, max: 400 } });
      // Not permanent: not modelled.
      expect(one(buffFn('upNpdamage', {}, { Value: 0, Turn: 3, ParamAdd: 50, ParamMax: 400 })).es).toEqual([]);
    });
    it('entryFunction (King of Tsukumihara Academy): the skill it runs, marked entry; stars only lose nothing', () => {
      const entry = (skill: number) => ({ ...buffFn('entryFunction', {}, { Count: 1, Value: skill, Value2: 1 }), funcType: 'addState' });
      const atk = { ...buffFn('upAtk', {}, { Turn: 3, Value: 150 }, 'ptAll') };
      const star = { funcType: 'gainStar', funcTargetType: 'self', funcTargetTeam: 'playerAndEnemy', functvals: [], funcquestTvals: [], buffs: [], svals: [{ Rate: 1000, Value: 15 }] };
      const triggers = new Map<number, any>([[1, { id: 1, functions: [atk] }], [2, { id: 2, functions: [star] }]]);
      const run = (f: any) => {
        const report: PartDrops[] = [];
        return { es: compactCE({ id: 1, collectionNo: 1, name: 'x', atkGrowth: [], skills: [sk(1, 0, f)] }, triggers, report).effects, report };
      };
      expect(run(entry(1)).es).toEqual([{ kind: 'atkUp', target: 'ptAll', lv: [{ value: 150, turns: 3, count: -1 }], entry: true }]);
      expect(run(entry(2))).toEqual({ es: [], report: [] });
    });
  });
  it('Kaleidoscope: gainNp self 80% non-MLB, 100% MLB', () => {
    const ce = compactCE(kscope as any);
    expect(ce.effects[0]).toMatchObject({ kind: 'gainNp', target: 'self' });
    expect(ce.effects[0].lv[0].value).toBe(8000);
    expect(ce.effectsMlb[0].lv[0].value).toBe(10000);
    expect(ce.unsupported).toEqual([]);
  });
});

describe('compactMC', () => {
  it('Combat Uniform: 3 skills, atkUp at Rate 5000 kept, orderChange on S3', () => {
    const mc = compactMC(mcCombat as any);
    expect(mc.skills.map((k) => k.num)).toEqual([1, 2, 3]);
    const atk = mc.skills[0].effects.find((e) => e.kind === 'atkUp')!;
    expect(atk.target).toBe('ptAll');
    expect(atk.lv[0].value).toBe(200);
    expect(mc.skills[2].effects.find((e) => e.kind === 'orderChange')!.target).toBe('orderChange');
    expect(mc.skills[1].effects).toEqual([]);
    expect(mc.unsupported).toEqual([]);
  });
});

describe('face icons', () => {
  it('servant: first-ascension face URL from extraAssets', () => {
    expect(compactServant(castoria as any).face).toBe('https://static.atlasacademy.io/NA/Faces/f_5045000.png');
  });
  it('CE: equip face URL', () => {
    expect(compactCE(kscope as any).face).toBe('https://static.atlasacademy.io/NA/Faces/f_94003400.png');
  });
  it('faceOf: "1" key, else first entry, else empty', () => {
    expect(faceOf({ '2': 'b', '1': 'a' })).toBe('a');
    expect(faceOf({ '3': 'c' })).toBe('c');
    expect(faceOf({})).toBe('');
    expect(faceOf(undefined)).toBe('');
  });
});

describe('per-part marks, deferred effects, buff effectiveness (real fixtures)', () => {
  const lookup = new Map<number, any>([skill960408, skill966456, skill966458, skill966533].map((k: any) => [k.id, k]));
  const lv10 = (e: any) => e.lv[9];
  it('Ishtar S3 "Mana Burst (Gem)": the delayFunction becomes a delayed ATK up (next turn)', () => {
    const s = compactServant(ishtar as any, lookup);
    expect(s.unsupported).toEqual([]);
    const [atk] = s.skills[2].effects;
    expect(s.skills[2].effects).toHaveLength(1);
    expect(atk).toMatchObject({ kind: 'atkUp', target: 'self', deferred: { at: 'delay', turns: 1 } });
    expect(lv10(atk)).toEqual({ value: 500, turns: 1, count: -1 });
    expect(atk.lv[0].value).toBe(300);
    // Without the lookup the trigger is only helpful: dropped, as before.
    expect(compactServant(ishtar as any).skills[2].effects).toEqual([]);
  });
  it('Oberon: usable; the NP (enemy invincible after the damage) and S3 are marked per part', () => {
    const s = compactServant(oberon as any, lookup);
    expect(s.unsupported).toEqual([]);
    expect(s.castBlockTraits).toEqual([500800]); // passive: buffs cast by Merlin allies fail
    expect(s.np!.unsupported).toEqual(['buff:invincible@enemy']);
    // S1: NP damage up carries the trait S3 amplifies.
    expect(s.skills[0].effects[0]).toMatchObject({ kind: 'npDmgUp', buffTraits: [3030] });
    // S2: charge now, NP drain on the target at the end of the turn.
    expect(s.skills[1].effects.map((e) => [e.kind, e.target, e.deferred])).toEqual([
      ['gainNp', 'ptOne', undefined], ['lossNp', 'ptOne', { at: 'turnEnd', turns: 1 }],
    ]);
    expect(lv10(s.skills[1].effects[1]).value).toBe(2000);
    expect(s.skills[1].lastTurnOnly).toBeUndefined();
    // S3: buster up + buff effectiveness up; the end-of-turn sleep: last turn only.
    expect(s.skills[2].effects.map((e) => e.kind)).toEqual(['cardUp', 'buffRate']);
    expect(s.skills[2].effects[1]).toMatchObject({ target: 'ptOne', rateOf: [3030] });
    expect(lv10(s.skills[2].effects[1]).value).toBe(1000);
    expect(s.skills[2].lastTurnOnly).toEqual(['trigger:selfturnendFunction:func:subState']);
    expect(partUnsupported(s)).toEqual({
      skills: [], lastTurnOnly: [{ num: 3, reasons: ['trigger:selfturnendFunction:func:subState'] }],
      np: ['buff:invincible@enemy'],
    });
  });
  it('without a lookup the trigger skills are restricted per skill, not the servant', () => {
    const s = compactServant(oberon as any);
    expect(s.unsupported).toEqual([]);
    expect(partUnsupported(s).lastTurnOnly.map((x) => x.num)).toEqual([2, 3]);
  });
  it('farming CEs: The Black Grail (HP loss each turn) and Aerial Drive (event encounter bonus) are usable', () => {
    const grail = compactCE(blackGrail as any);
    expect(grail.unsupported).toEqual([]);
    expect(grail.effectsMlb).toEqual([expect.objectContaining({ kind: 'npDmgUp', target: 'self', lv: [{ value: 800, turns: -1, count: -1 }] })]);
    const drive = compactCE(aerialDrive as any);
    expect(drive.unsupported).toEqual([]);
    expect(drive.effectsMlb.map((e) => e.kind)).toEqual(['cardUp', 'npDmgUp', 'gainNp']);
  });
  it('drop audit: helpful effects that are not modelled are reported per part', () => {
    const report: PartDrops[] = [];
    compactServant(koyanskaya as any, lookup, report);
    // Her S2 command-card trigger never fires on an NP: nothing lost, nothing reported.
    expect(report).toEqual([]);
  });
});

describe('convertFunctions: deferred and restricted triggers', () => {
  const buff = (type: string, target = 'self', sv: Record<string, number> = {}) => ({
    funcType: 'addStateShort', funcTargetType: target, funcTargetTeam: 'playerAndEnemy', functvals: [],
    buffs: [{ type, ckSelfIndv: [], ckOpIndv: [], script: {}, vals: [{ id: 3004 }, { id: 3030 }] }],
    svals: [{ Rate: 1000, Turn: 3, Count: -1, Value: 200, ...sv }],
  });
  const func = (funcType: string, target = 'self', sv: Record<string, number> = {}) => ({
    funcType, funcTargetType: target, funcTargetTeam: 'playerAndEnemy', functvals: [], buffs: [], svals: [{ Rate: 1000, Value: 1000, ...sv }],
  });
  const lookup = new Map<number, any>([
    [1, { id: 1, functions: [buff('upNpdamage', 'self', { Turn: 1, Value: 300 }), func('gainStar')] }],
    [2, { id: 2, functions: [func('lossNp', 'self', { Value: 2000 })] }],
    [3, { id: 3, functions: [buff('donotAct', 'self')] }],
    [4, { id: 4, functions: [func('gainNp', 'ptAll')] }],
    [5, { id: 5, functions: [func('lossNp', 'self', { Rate: 500 })] }],
  ]);
  const run = (funcs: any[]) => {
    const unsupported: string[] = [], restrict: string[] = [], drops: string[] = [];
    return { out: convertFunctions(funcs, unsupported, { triggers: lookup, restrict, drops }), unsupported, restrict, drops };
  };
  const trig = (t: string, id: number, sv: Record<string, number> = {}, target = 'ptOne') =>
    run([buff(t, target, { Value: id, Value2: 1, Turn: 1, Count: -1, Rate: 5000, ...sv })]);
  it('delayFunction -> deferred effects on the holder, with the triggered skill level', () => {
    const r = trig('delayFunction', 1, { Turn: 2 });
    expect(r.unsupported).toEqual([]);
    expect(r.out).toEqual([{ kind: 'npDmgUp', target: 'ptOne', lv: [{ value: 300, turns: 1, count: -1 }], buffTraits: [3030], deferred: { at: 'delay', turns: 2 } }]);
  });
  it('selfturnendFunction: lasts min(Turn, Count) turn ends; unbounded is restricted', () => {
    expect(trig('selfturnendFunction', 2, { Turn: -1, Count: 2 }).out[0]).toMatchObject({ kind: 'lossNp', deferred: { at: 'turnEnd', turns: 2 } });
    expect(trig('selfturnendFunction', 2, { Turn: 3, Count: 1 }).out[0].deferred).toEqual({ at: 'turnEnd', turns: 1 });
    expect(trig('selfturnendFunction', 2, { Turn: -1, Count: -1 })).toMatchObject({ out: [], restrict: ['trigger:selfturnendFunction:func:lossNp'] });
  });
  it('a harmful or unknown end-of-turn effect: last turn only; a helpful one we cannot model: dropped', () => {
    expect(trig('selfturnendFunction', 3)).toMatchObject({ out: [], unsupported: [], restrict: ['trigger:selfturnendFunction:buff:donotAct'] });
    expect(trig('selfturnendFunction', 5)).toMatchObject({ out: [], restrict: ['trigger:selfturnendFunction:func:lossNp'] });
    // Charge for the whole party from a buff one unit holds: not the holder's own.
    expect(trig('delayFunction', 4)).toMatchObject({ out: [], unsupported: [], restrict: [], drops: ['trigger:delayFunction:inner:gainNp@ptAll'] });
  });
  it('buffRate: modelled on tracked traits, dropped otherwise, unsupported when negative', () => {
    const br = (ids: number[], Value = 500) => ({
      ...buff('buffRate', 'self', { Value }),
      buffs: [{ type: 'buffRate', ckSelfIndv: [], ckOpIndv: [], script: { UpBuffRateBuffIndiv: ids.map((id) => ({ id })) } }],
    });
    expect(run([br([3030])]).out[0]).toMatchObject({ kind: 'buffRate', rateOf: [3030] });
    expect(run([br([3027])])).toMatchObject({ out: [], drops: ['buffRate:untracked'] });
    expect(run([br([3030], -500)]).unsupported).toEqual(['buff:buffRate-']);
  });
  it('drop audit tags', () => {
    expect(run([func('gainNp', 'self', { Rate: 500 })]).drops).toEqual(['rate:gainNp']);
    expect(run([func('gainNp', 'self', { ActSet: 1 })]).drops).toEqual(['actSet:gainNp']);
    expect(run([{ ...func('gainNp', 'ptAll'), functvals: [{ id: 5 }] }]).drops).toEqual(['cond:gainNp']);
  });
});
