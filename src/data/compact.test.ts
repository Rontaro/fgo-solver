import { describe, it, expect } from 'vitest';
import castoria from '../../test/fixtures/castoria.json';
import altria from '../../test/fixtures/altria.json';
import kscope from '../../test/fixtures/kaleidoscope.json';
import mcCombat from '../../test/fixtures/mc-combat.json';
import siegfried from '../../test/fixtures/siegfried.json';
import { compactServant, compactCE, compactMC, convertFunctions } from './compact';

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
  it('upCommandall conditioned on a non-card trait is unsupported', () => {
    const unsupported: string[] = [];
    expect(convertFunctions([cardUpFn([{ id: 4001 }, { id: 9999 }])], unsupported)).toEqual([]);
    expect(unsupported).toEqual(['ckSelfIndv:upCommandall']);
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
    expect(run([buff('downDefence', 'self')]).unsupported).toEqual(['buff:downDefence']);
    expect(run([buff('donotAct', 'self')]).unsupported).toEqual(['buff:donotAct']);
    expect(run([buff('upAtk', 'enemy')]).unsupported).toEqual(['buff:upAtk@enemy']);
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
  });
  it('extra conditions on a modelled effect are unsupported', () => {
    expect(run([buff('upAtk', 'self', {}, { functvals: [{ id: 1 }] })]).unsupported).toEqual(['cond:addStateShort']);
    expect(run([buff('upAtk', 'self', { EventId: 80001 })]).unsupported).toEqual(['cond:addStateShort']);
    const scripted = buff('upAtk');
    scripted.buffs[0].script = { INDIVIDUALITIE: 1 } as any;
    expect(run([scripted]).unsupported).toEqual(['cond:addStateShort']);
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
    expect(run([dmg, condOc], { npDamage: dmg, npExtras: true }).unsupported).toEqual(['cond:gainNp']);
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
  it('Siegfried: supereffective NP vs Dragon (2002), simulable', () => {
    const s = compactServant(siegfried as any);
    expect(s.np!.seTraits).toEqual([2002]);
    expect(s.np!.seMult![0][0]).toBe(1500);
    expect(s.np!.seMult![1][0]).toBe(1625);
    expect(s.np!.mult[0][0]).toBe(4000);
    expect(s.unsupported).toEqual([]);
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
