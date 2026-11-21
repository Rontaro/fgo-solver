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
import { compactServant, compactCE, compactMC, convertFunctions, faceOf } from './compact';

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
    expect(run([buff('downDefence', 'enemy')])).toEqual({ out: [], unsupported: [] });
    expect(run([buff('donotAct', 'self')]).unsupported).toEqual(['buff:donotAct']);
    expect(run([buff('upAtk', 'enemy')]).unsupported).toEqual(['buff:upAtk@enemy']);
  });
  const ignored = (f: any) => expect(run([f])).toEqual({ out: [], unsupported: [] });
  it('only-helpful effects on allies are ignored', () => {
    for (const t of ['pierceInvincible', 'breakAvoidance', 'subSelfdamage', 'downDefence',
      'downDefencecommandall', 'addIndividuality']) ignored(buff(t, 'self'));
    ignored(func('lossHpSafe', 'self'));
  });
  it('only-helpful effects on enemies are ignored', () => {
    for (const t of ['reduceHp', 'donotSkill', 'donotNoble', 'addIndividuality']) ignored(buff(t, 'enemy'));
    ignored(func('lossNp', 'enemyAll'));
    // ...but the same effects on our side still block: they can hurt.
    expect(run([buff('reduceHp', 'self')]).unsupported).toEqual(['buff:reduceHp']);
    expect(run([buff('donotNoble', 'self')]).unsupported).toEqual(['buff:donotNoble']);
  });
  it('more only-helpful effects are ignored on their side only', () => {
    for (const t of ['pierceDefence', 'downCriticalRateDamageTaken', 'downStarweight', 'upGrantInstantdeath',
      'avoidInstantdeath', 'downTolerance', 'fieldIndividuality']) ignored(buff(t, 'self'));
    for (const f of ['lossStar', 'displayBuffstring', 'cardReset', 'gainNpBuffIndividualSum', 'addFieldChangeToField']) {
      ignored(func(f, 'self'));
    }
    for (const t of ['upFuncHpReduce', 'upNonresistInstantdeath', 'avoidState', 'downGainHp']) ignored(buff(t, 'enemy'));
    ignored(func('displayBuffstring', 'enemy'));
    ignored(buff('upFuncHpReduce', 'self')); // DoT received: allies are never under a DoT in the model
    expect(run([buff('downTolerance', 'enemy')])).toEqual({ out: [], unsupported: [] });
  });
  it('without a lookup, skill-triggering buffs stay unsupported (old behaviour)', () => {
    for (const t of ['attackAfterFunction', 'commandattackAfterFunction', 'selfturnendFunction', 'delayFunction']) {
      expect(run([buff(t, 'self', { Value: 900001 })]).unsupported).toEqual(['buff:' + t]);
    }
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
    expect(run([func('subState', 'self', {}, { traitVals: [{ id: 3007 }] })]).unsupported).toEqual(['func:subState']);
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
  it('checkIndvType is accepted only with at most one trait per list', () => {
    const one = buff('upDamage');
    one.buffs[0].script = { checkIndvType: 1 } as any;
    one.buffs[0].ckOpIndv = [{ id: 1 }] as any;
    expect(run([one]).out[0].opTraits).toEqual([1]);
    const two = buff('upDamage');
    two.buffs[0].script = { checkIndvType: 1 } as any;
    two.buffs[0].ckOpIndv = [{ id: 1 }, { id: 2 }] as any;
    expect(run([two])).toEqual(DROPPED);
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
  it('harmful functions on allies are unsupported', () => {
    expect(run([func('lossNp')]).unsupported).toEqual(['func:lossNp']);
    expect(run([func('instantDeath', 'ptOne')]).unsupported).toEqual(['func:instantDeath']);
    expect(run([func('subState', 'self', {}, { traitVals: [{ id: 3004 }] })]).unsupported).toEqual(['func:subState']);
    expect(run([func('subState', 'self')]).unsupported).toEqual(['func:subState']);
    // Removing debuffs only (traitVals = buffNegativeEffect) can only help.
    expect(run([func('subState', 'self', {}, { traitVals: [{ id: 3005 }] })])).toEqual({ out: [], unsupported: [] });
  });
  it('Rate < 1000: helpful skipped, harmful unsupported', () => {
    expect(run([func('gainNp', 'self', { Rate: 500 })])).toEqual({ out: [], unsupported: [] });
    expect(run([func('lossNp', 'self', { Rate: 500 })]).unsupported).toEqual(['func:lossNp']);
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
    expect(run([buff('upAtk', 'self', { EventId: 80001 })])).toEqual(DROPPED);
    const scripted = buff('upAtk');
    scripted.buffs[0].script = { INDIVIDUALITIE: 1 } as any;
    expect(run([scripted])).toEqual(DROPPED);
    const ok = buff('upAtk');
    ok.buffs[0].script = { ProgressSelfTurn: 1 } as any;
    expect(run([ok]).unsupported).toEqual([]);
    // Conditions on an ignored effect do not matter.
    expect(run([buff('invincible', 'self', { EventId: 1 })]).unsupported).toEqual([]);
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
    expect(compactServant(koyanskaya as any).unsupported)
      .toEqual(['buff:commandattackAfterFunctionMainOnly']); // without a lookup: old behaviour
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
