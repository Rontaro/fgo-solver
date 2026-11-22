import { describe, it, expect } from 'vitest';
import { parseResults, parseTeams } from './io';
import type { SavedResult, SavedTeam } from './store';

const slot = { kind: 'support', collectionNo: 314, ceNo: null, ceLv: 100, ceMlb: false };
const empty = { kind: 'empty', collectionNo: null, ceNo: null, ceLv: 100, ceMlb: false };
const team: SavedTeam = { id: 'a', name: 'Koyan', createdAt: '2026-11-22T00:00:00Z', slots: [slot, empty, empty, empty, empty, empty] as SavedTeam['slots'], mcId: 20 };
const member = { key: 's0', collectionNo: 314, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 1000, ceNo: null, ceLv: 1, ceMlb: false, support: true };
const result: SavedResult = {
  id: 'b', createdAt: '2026-11-22T00:00:00Z', name: 'Node', quest: { id: 94136714, phase: 1, label: 'Node (1)', eventId: 80494 },
  members: [member as SavedResult['members'][number]], front: ['s0'], back: [], mcId: 20, kind: 'closest',
  turns: [[{ kind: 'np', unit: 's0' }]], missingPct: 0.02, actions: 0, usesSwap: false, dataVersion: 'h-b',
};

describe('saved JSON import', () => {
  it('round-trips valid entries', () => {
    expect(parseTeams(JSON.stringify([team]))).toEqual([team]);
    expect(parseResults(JSON.stringify([result]))).toEqual([result]);
  });
  it('drops malformed entries and rejects non-arrays', () => {
    expect(parseTeams(JSON.stringify([team, { name: 'x' }, { ...team, slots: [slot] }]))).toEqual([team]);
    expect(parseResults(JSON.stringify([{ ...result, kind: 'other' }, result]))).toEqual([result]);
    expect(() => parseTeams('{}')).toThrow(/array/);
    expect(() => parseResults('nope')).toThrow();
  });
});
