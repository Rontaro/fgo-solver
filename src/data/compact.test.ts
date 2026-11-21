import { describe, it, expect } from 'vitest';
import castoria from '../../test/fixtures/castoria.json';
import altria from '../../test/fixtures/altria.json';
import kscope from '../../test/fixtures/kaleidoscope.json';
import mcCombat from '../../test/fixtures/mc-combat.json';
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
  it('Altria: buster AoE NP, 600% at NP5 OC1, 1 hit, simulable', () => {
    const s = compactServant(altria as any);
    expect(s.np!.card).toBe('buster');
    expect(s.np!.aoe).toBe(true);
    expect(s.np!.mult[0][4]).toBe(6000);
    expect(s.np!.hits).toEqual([100]);
    expect(s.unsupported).toEqual([]);
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
});

describe('compactCE', () => {
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
