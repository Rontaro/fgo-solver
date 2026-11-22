import { describe, it, expect } from 'vitest';
import oniRaw from '../../test/fixtures/pioneering-oni.json';
import kscopeRaw from '../../test/fixtures/kaleidoscope.json';
import questRaw from '../../test/fixtures/quest-ghost-invention.json';
import prisonRaw from '../../test/fixtures/quest-prison-ruins.json';
import { compactCE } from '../data/compact';
import type { RawQuest } from '../engine/quest';
import { eventCesFor } from './eventCes';

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
