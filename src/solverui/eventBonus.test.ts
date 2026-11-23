import { describe, it, expect } from 'vitest';
import oniRaw from '../../test/fixtures/pioneering-oni.json';
import { compactCE } from '../data/compact';
import { altria, castoria, member } from '../engine/test-helpers';
import { dropTotal, teamBonus } from './eventBonus';

const oni = compactCE(oniRaw as any);

describe('event bonus', () => {
  it('Pioneering Oni: +1 (MLB +2) on the three Ghost Room items', () => {
    expect(oni.bonus).toEqual([10898, 10897, 10899].map((item) => ({ eventId: 80494, item, kind: 'drop', value: 1 })));
    expect(oni.bonusMlb?.map((b) => b.value)).toEqual([2, 2, 2]);
  });
  it('sums over the whole party, only for the quest event', () => {
    const team = [
      member(altria, 'a', { ce: oni, ceLv: 100, ceMlb: true }),
      member(castoria, 'c', { ce: oni, ceLv: 100, ceMlb: false }),
      member(castoria, 'back'),
    ];
    const lines = teamBonus(team, 80494);
    expect(lines).toEqual([10897, 10898, 10899].map((item) => ({ item, kind: 'drop', value: 3 })));
    expect(dropTotal(lines)).toBe(9);
    expect(teamBonus(team, 12345)).toEqual([]);
  });
});
