import { describe, it, expect } from 'vitest';
import { npGainPerHit, splitHits, hitsOnEnemy, npRefund } from './npgain';

const castoria = { npRate: 54, card: 'arts' as const, cardMod: 0, tdRate: 900, npGainMod: 0 };

describe('npGainPerHit', () => {
  it('Castoria-like arts NP, no overkill: floor(54*3*0.9) = 145', () => {
    expect(npGainPerHit({ ...castoria, overkill: false })).toBe(145);
  });
  it('with overkill: floor(54*3*0.9*1.5) = 218', () => {
    expect(npGainPerHit({ ...castoria, overkill: true })).toBe(218);
  });
  it('cardMod and npGainMod multiply: floor(54*3*1.5*0.9*1.3) = 284', () => {
    // 54*3*1.5*0.9*1.3 = 284.31
    expect(npGainPerHit({ ...castoria, cardMod: 500, npGainMod: 300, overkill: false })).toBe(284);
  });
  it('cardMod is clamped to 400%', () => {
    expect(npGainPerHit({ ...castoria, cardMod: 9000, overkill: false }))
      .toBe(npGainPerHit({ ...castoria, cardMod: 4000, overkill: false }));
  });
  it('quick card gain is 1: floor(54*1*0.9) = 48', () => {
    expect(npGainPerHit({ ...castoria, card: 'quick', overkill: false })).toBe(48);
  });
  it('buster NP gives 0 gain regardless', () => {
    expect(npGainPerHit({ ...castoria, card: 'buster', cardMod: 4000, npGainMod: 1000, overkill: true })).toBe(0);
  });
});

describe('splitHits', () => {
  it('splits by percentage', () => {
    expect(splitHits(10000, [16, 33, 51])).toEqual([1600, 3300, 5100]);
  });
  it('puts the rounding remainder on the last hit', () => {
    const parts = splitHits(1000, [33, 33, 34]);
    expect(parts).toEqual([330, 330, 340]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    const odd = splitHits(1001, [33, 33, 34]);
    expect(odd).toEqual([330, 330, 341]);
  });
  it('divides by the sum of the distribution, not by 100 (Chaldea)', () => {
    expect(splitHits(1000, [1, 1, 2])).toEqual([250, 250, 500]);
  });
});

describe('hitsOnEnemy', () => {
  it('2000 HP, hits 1600 and 3300: only the second is overkill', () => {
    const r = hitsOnEnemy(2000, [1600, 3300]);
    expect(r.hits).toEqual([{ damage: 1600, overkill: false }, { damage: 3300, overkill: true }]);
    expect(r.hpLeft).toBe(-2900);
  });
  it('a hit landing exactly on 0 is not overkill, the following one is', () => {
    const r = hitsOnEnemy(1000, [1000, 500]);
    expect(r.hits.map(h => h.overkill)).toEqual([false, true]);
    expect(r.hpLeft).toBe(-500);
  });
  it('overkill = HP after the hit < 0 (Chaldea): a 0-damage hit at exactly 0 HP is not overkill', () => {
    expect(hitsOnEnemy(1000, [1000, 0, 1]).hits.map(h => h.overkill)).toEqual([false, false, true]);
    expect(hitsOnEnemy(-5, [0]).hits[0].overkill).toBe(true);
  });
});

describe('npRefund', () => {
  it('sums per-hit gain using each hit overkill flag', () => {
    const { hits } = hitsOnEnemy(2000, splitHits(10000, [16, 33, 51]));
    // 1600 (hp 400, no OK), 3300 (OK), 5100 (OK)
    expect(npRefund(castoria, hits)).toBe(145 + 218 + 218);
  });
  it('buster NP refunds nothing', () => {
    const { hits } = hitsOnEnemy(100, [5000, 5000]);
    expect(npRefund({ ...castoria, card: 'buster' }, hits)).toBe(0);
  });
});
