import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clear } from 'idb-keyval';
import { IdbRosterStore, RosterValidationError, emptyRoster, exportJson, importJson } from './store';
import type { RosterDoc } from './types';

const clock = () => new Date('2026-11-21T10:00:00.000Z');

function sampleDoc(region: 'NA' | 'JP' = 'NA'): RosterDoc {
  return {
    version: 1,
    region,
    servants: [
      { collectionNo: 284, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 10, fou: 1000, defaultCe: 1652 },
      { collectionNo: 215, lv: 100, npLv: 5, skillLv: [10, 9, 10], append2Lv: 0, fou: 2000 },
    ],
    ces: [{ collectionNo: 1652, lv: 100, mlb: true }],
    mcs: [{ id: 20, lv: 10 }],
    friends: [
      {
        name: 'Friend A',
        servant: { collectionNo: 314, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 0 },
        ce: { collectionNo: 1652, lv: 50, mlb: true },
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function mutate(f: (d: any) => void): string {
  const d = JSON.parse(exportJson(sampleDoc()));
  f(d);
  return JSON.stringify(d);
}

function pathOf(text: string, region: 'NA' | 'JP' = 'NA'): string {
  try {
    importJson(text, region);
  } catch (e) {
    expect(e).toBeInstanceOf(RosterValidationError);
    return (e as RosterValidationError).path;
  }
  throw new Error('expected a validation error');
}

describe('IdbRosterStore', () => {
  beforeEach(async () => {
    await clear();
  });

  it('returns an empty doc when nothing is saved', async () => {
    const doc = await new IdbRosterStore(clock).load('NA');
    expect(doc).toEqual(emptyRoster('NA'));
  });

  it('round-trips save/load with updatedAt from the clock', async () => {
    const store = new IdbRosterStore(clock);
    const saved = await store.save(sampleDoc());
    expect(saved.updatedAt).toBe('2026-11-21T10:00:00.000Z');
    expect(await store.load('NA')).toEqual(saved);
  });

  it('keeps NA and JP separate', async () => {
    const store = new IdbRosterStore(clock);
    await store.save(sampleDoc('NA'));
    expect(await store.load('JP')).toEqual(emptyRoster('JP'));
    await store.save({ ...sampleDoc('JP'), servants: [] });
    expect((await store.load('NA')).servants).toHaveLength(2);
    expect((await store.load('JP')).servants).toHaveLength(0);
  });
});

describe('exportJson / importJson', () => {
  it('round-trips', () => {
    const doc = sampleDoc();
    expect(importJson(exportJson(doc), 'NA')).toEqual(doc);
  });

  it('reports exact paths of bad fields', () => {
    expect(pathOf(mutate((d) => (d.servants[1].skillLv[1] = 11)))).toBe('servants[1].skillLv[1]');
    expect(pathOf(mutate((d) => (d.servants[0].lv = 121)))).toBe('servants[0].lv');
    expect(pathOf(mutate((d) => (d.servants[0].npLv = 0)))).toBe('servants[0].npLv');
    expect(pathOf(mutate((d) => (d.servants[0].append2Lv = -1)))).toBe('servants[0].append2Lv');
    expect(pathOf(mutate((d) => (d.servants[0].fou = 2001)))).toBe('servants[0].fou');
    expect(pathOf(mutate((d) => (d.ces[0].lv = 101)))).toBe('ces[0].lv');
    expect(pathOf(mutate((d) => (d.ces[0].mlb = 'yes')))).toBe('ces[0].mlb');
    expect(pathOf(mutate((d) => (d.servants[0].collectionNo = '284')))).toBe('servants[0].collectionNo');
    expect(pathOf(mutate((d) => (d.servants[0].skillLv = [10, 10])))).toBe('servants[0].skillLv');
    expect(pathOf(mutate((d) => (d.friends[0].servant.skillLv[2] = 1.5)))).toBe('friends[0].servant.skillLv[2]');
    expect(pathOf(mutate((d) => (d.friends[0].ce.lv = 0)))).toBe('friends[0].ce.lv');
    expect(pathOf(mutate((d) => (d.friends[0].name = 5)))).toBe('friends[0].name');
    expect(pathOf(mutate((d) => (d.mcs[0].id = null)))).toBe('mcs[0].id');
    expect(pathOf(mutate((d) => delete d.ces))).toBe('ces');
    expect(pathOf(mutate((d) => (d.version = 2)))).toBe('version');
    expect(pathOf('not json')).toBe('$');
  });

  it('names the path in the error message', () => {
    expect(() => importJson(mutate((d) => (d.servants[1].skillLv[1] = 0)), 'NA')).toThrow(
      /servants\[1\]\.skillLv\[1\]/,
    );
  });

  it('rejects a region mismatch', () => {
    expect(pathOf(exportJson(sampleDoc('JP')), 'NA')).toBe('region');
    expect(() => importJson(exportJson(sampleDoc('JP')), 'NA')).toThrow(/expected NA, got JP/);
  });

  it('drops unknown extra fields', () => {
    const text = mutate((d) => {
      d.extra = 1;
      d.servants[0].bond = 15;
      d.ces[0].note = 'x';
      d.friends[0].servant.foo = true;
      d.mcs[0].bar = 2;
    });
    expect(importJson(text, 'NA')).toEqual(sampleDoc());
  });
});
