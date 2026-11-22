import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, normalize } from './settings';

describe('settings normalize', () => {
  it('falls back to the defaults on garbage', () => {
    expect(normalize(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalize({ maxTimeS: 'x', support: { lv: 999, npLv: 0, skillLv: [11, 'a'], fou: -5 } })).toEqual({
      maxTimeS: 20, support: { lv: 90, npLv: 1, skillLv: [10, 10, 10], fou: 1000 },
    });
  });
  it('keeps valid values', () => {
    const s = { maxTimeS: 60, support: { lv: 100, npLv: 5, skillLv: [10, 9, 8] as [number, number, number], fou: 2000 } };
    expect(normalize(s)).toEqual(s);
  });
});
