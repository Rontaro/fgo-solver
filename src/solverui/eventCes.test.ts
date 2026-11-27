import { describe, it, expect } from 'vitest';
import oniRaw from '../../test/fixtures/pioneering-oni.json';
import kscopeRaw from '../../test/fixtures/kaleidoscope.json';
import questRaw from '../../test/fixtures/quest-ghost-invention.json';
import prisonRaw from '../../test/fixtures/quest-prison-ruins.json';
import { compactCE } from '../data/compact';
import type { RawQuest } from '../engine/quest';
import { ceDropBonus, eventCeFill, eventCesFor } from './eventCes';

const oni = compactCE(oniRaw as any);
const kscope = compactCE(kscopeRaw as any);

describe('eventCesFor', () => {
  it('Pioneering Oni is an event CE of the Ghost Room node, Kaleidoscope is not', () => {
    const got = eventCesFor([kscope, oni], questRaw as unknown as RawQuest, 80494);
    expect(got.map((c) => c.collectionNo)).toEqual([oni.collectionNo]);
  });
  it('none on a node outside the event', () => {
    expect(eventCesFor([kscope, oni], prisonRaw as unknown as RawQuest, 0)).toEqual([]);
  });
});

describe('eventCeFill', () => {
  const ces = eventCesFor([kscope, oni], questRaw as unknown as RawQuest, 80494);
  const ev = 80494;
  it('owned copies, best drop bonus first, minus the copies the team already wears; support gets the best MLB', () => {
    expect(ceDropBonus(oni, true, ev)).toBeGreaterThan(ceDropBonus(oni, false, ev));
    const owned = [
      { collectionNo: oni.collectionNo, lv: 1, mlb: false },
      { collectionNo: kscope.collectionNo, lv: 100, mlb: true },
      { collectionNo: oni.collectionNo, lv: 50, mlb: true },
      { collectionNo: oni.collectionNo, lv: 20, mlb: false },
    ];
    const f = eventCeFill(ces, owned, [oni.collectionNo], ev);
    // Kaleidoscope is no event CE; the first Oni copy is the one a slot wears.
    expect(f.roster.map((c) => [c.ce.collectionNo, c.lv, c.mlb])).toEqual([[oni.collectionNo, 50, true], [oni.collectionNo, 20, false]]);
    expect(f.support).toEqual({ ce: oni, lv: oni.atkGrowth.length, mlb: true });
  });
  it('no event CE: nothing to equip', () => {
    expect(eventCeFill([], [{ collectionNo: oni.collectionNo, lv: 1, mlb: true }], [], ev)).toEqual({ roster: [], support: null });
  });
});
