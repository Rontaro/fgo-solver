import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { loadRegionData } from './load';

const servant = (collectionNo: number, name: string) => ({
  id: collectionNo * 100, collectionNo, name, className: 'saber', attribute: 'earth', traits: [],
  rarity: 5, atkGrowth: [], skills: [], passives: [], append2: [], np: null, unsupported: [],
});

function files(hash: string, names: string[]): Record<string, unknown> {
  return {
    'version.json': { hash, timestamp: 1 },
    'servants.json': names.map((n, i) => servant(i + 1, n)),
    'ces.json': [], 'mcs.json': [],
    'constants.json': { classAtk: {}, classRel: {}, attrRel: {} },
    'quests.json': [],
    'items.json': {},
  };
}

/** Mocks fetch over `data`; returns the list of requested file names. */
function mockFetch(data: Record<string, unknown> | 'offline'): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const file = url.split('/').pop()!.split('?')[0];
    calls.push(file);
    if (data === 'offline') throw new TypeError('Failed to fetch');
    if (!(file in data)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(data[file]), { status: 200 });
  }));
  return calls;
}

beforeEach(async () => { await clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('loadRegionData', () => {
  it('fetches fresh data and indexes servants by collectionNo', async () => {
    const calls = mockFetch(files('h1', ['Mash', 'Artoria']));
    const d = await loadRegionData('NA');
    expect(d.stale).toBe(false);
    expect(d.version.hash).toBe('h1');
    expect(d.servants.get(2)?.name).toBe('Artoria');
    expect(calls).toHaveLength(7); // version + servants, ces, mcs, constants, quests, items
  });

  it('uses the cache when the version hash is unchanged', async () => {
    mockFetch(files('h1', ['Mash']));
    await loadRegionData('NA');
    const calls = mockFetch(files('h1', ['Changed']));
    const d = await loadRegionData('NA');
    expect(calls).toEqual(['version.json']);
    expect(d.servants.get(1)?.name).toBe('Mash');
    expect(d.stale).toBe(false);
  });

  it('refetches when the hash changes', async () => {
    mockFetch(files('h1', ['Mash']));
    await loadRegionData('NA');
    mockFetch(files('h2', ['Changed']));
    const d = await loadRegionData('NA');
    expect(d.version.hash).toBe('h2');
    expect(d.servants.get(1)?.name).toBe('Changed');
  });

  it('keeps regions separate', async () => {
    mockFetch(files('h1', ['Mash']));
    await loadRegionData('NA');
    mockFetch('offline');
    await expect(loadRegionData('JP')).rejects.toThrow();
  });

  it('falls back to the cache as stale when offline', async () => {
    mockFetch(files('h1', ['Mash']));
    await loadRegionData('NA');
    mockFetch('offline');
    const d = await loadRegionData('NA');
    expect(d.stale).toBe(true);
    expect(d.servants.get(1)?.name).toBe('Mash');
  });

  it('falls back to the cache as stale when a data file fails after a hash change', async () => {
    mockFetch(files('h1', ['Mash']));
    await loadRegionData('NA');
    const broken = files('h2', ['Changed']);
    delete broken['servants.json'];
    mockFetch(broken);
    const d = await loadRegionData('NA');
    expect(d.stale).toBe(true);
    expect(d.version.hash).toBe('h1');
  });

  it('throws without a cache when offline', async () => {
    mockFetch('offline');
    await expect(loadRegionData('NA')).rejects.toThrow('Failed to fetch');
  });
});
