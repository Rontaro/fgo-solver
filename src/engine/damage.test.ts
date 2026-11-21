import { describe, it, expect } from 'vitest';
import { npDamage } from './damage';

const base = { atk: 11221, mult: 6000, card: 'buster' as const, cardMod: 0, classAtk: 1000, triangle: 1000,
  attribute: 1000, atkMod: 0, defMod: 0, npDmgMod: 0, powerMod: 0, seMult: 1000, dmgPlus: 0 };

describe('npDamage (min damage, random 0.9)', () => {
  it('Altria NP5, no buffs, neutral target', () => {
    // 11221 * 6.0 * 1.5 * 0.23 * 0.9 = 20904.7
    expect(npDamage(base)).toBe(20904);
  });
  it('cardMod 50% and atkMod 20%', () => {
    // 11221 * 6 * 1.5 * 1.5 * 0.23 * 0.9 * 1.2 = 37628.5
    expect(npDamage({ ...base, cardMod: 500, atkMod: 200 })).toBe(37628);
  });
  it('class advantage x2 and attribute x1.1', () => {
    // 11221 * 6 * 1.5 * 2 * 1.1 * 0.23 * 0.9 = 45990.4
    expect(npDamage({ ...base, triangle: 2000, attribute: 1100 })).toBe(45990);
  });
  it('class attack modifier (archer 0.95)', () => {
    // 20904.7 * 0.95 = 19859.5
    expect(npDamage({ ...base, classAtk: 950 })).toBe(19859);
  });
  it('supereffective multiplier 150%', () => {
    // 20904.7 * 1.5 = 31357.0 (31357.05)
    expect(npDamage({ ...base, seMult: 1500 })).toBe(31357);
  });
  it('npDmgMod and powerMod add together', () => {
    // 20904.7 * (1 + 0.3 + 0.2) = 31357.0
    expect(npDamage({ ...base, npDmgMod: 300, powerMod: 200 })).toBe(31357);
  });
  it('defMod (enemy defense down) adds to atkMod', () => {
    // 20904.7 * (1 + 0.2 - (-0.2)) = 29266.6
    expect(npDamage({ ...base, atkMod: 200, defMod: -200 })).toBe(29266);
  });
  it('dmgPlus is added after flooring the multiplicative part', () => {
    expect(npDamage({ ...base, dmgPlus: 500 })).toBe(20904 + 500);
  });
  it('dmgPlus defaults to 0 when omitted', () => {
    const { dmgPlus: _omit, ...noPlus } = base;
    expect(npDamage(noPlus)).toBe(20904);
  });
  it('arts and quick card values', () => {
    // 11221 * 6 * 1.0 * 0.23 * 0.9 = 13936.4 ; * 0.8 = 11149.1
    expect(npDamage({ ...base, card: 'arts' })).toBe(13936);
    expect(npDamage({ ...base, card: 'quick' })).toBe(11149);
  });
  it('caps: cardMod at most 400%, npDmgMod at most 500%', () => {
    expect(npDamage({ ...base, cardMod: 9000 })).toBe(npDamage({ ...base, cardMod: 4000 }));
    expect(npDamage({ ...base, npDmgMod: 9000 })).toBe(npDamage({ ...base, npDmgMod: 5000 }));
  });
});
