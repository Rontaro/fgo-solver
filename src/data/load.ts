import { get, set } from 'idb-keyval';
import type { CompactCE, CompactMC, CompactServant, Constants, DataVersion, QuestWar, Region } from './types';

export interface RegionData {
  servants: Map<number, CompactServant>;
  ces: CompactCE[];
  mcs: CompactMC[];
  constants: Constants;
  quests: QuestWar[];
  version: DataVersion;
  /** true when the network failed and the data comes from an older cache. */
  stale: boolean;
}

interface CachedData {
  version: DataVersion;
  servants: CompactServant[];
  ces: CompactCE[];
  mcs: CompactMC[];
  constants: Constants;
  quests: QuestWar[];
}

// Bumped when the compact format changes (2: face icons, quest spot names,
// 3: servant rarity), so
// data cached under the same Atlas hash is refetched.
const SCHEMA = 3;
const cacheKey = (region: Region) => `data:v${SCHEMA}:${region}`;

async function fetchJson<T>(region: Region, file: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/data/${region}/${file}`, init);
  if (!res.ok) throw new Error(`GET /data/${region}/${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function toRegionData(c: CachedData, stale: boolean): RegionData {
  return {
    servants: new Map(c.servants.map((s) => [s.collectionNo, s])),
    ces: c.ces, mcs: c.mcs, constants: c.constants, quests: c.quests, version: c.version,
    stale,
  };
}

async function fetchAll(region: Region): Promise<CachedData> {
  const version = await fetchJson<DataVersion>(region, 'version.json', { cache: 'no-cache' });
  const cached = await get<CachedData>(cacheKey(region));
  if (cached && cached.version.hash === version.hash) return cached;
  // The hash is part of the URL so a new data version never hits a stale HTTP cache.
  const q = `?v=${encodeURIComponent(version.hash)}-${SCHEMA}`;
  const [servants, ces, mcs, constants, quests] = await Promise.all([
    fetchJson<CompactServant[]>(region, `servants.json${q}`),
    fetchJson<CompactCE[]>(region, `ces.json${q}`),
    fetchJson<CompactMC[]>(region, `mcs.json${q}`),
    fetchJson<Constants>(region, `constants.json${q}`),
    fetchJson<QuestWar[]>(region, `quests.json${q}`),
  ]);
  const fresh: CachedData = { version, servants, ces, mcs, constants, quests };
  await set(cacheKey(region), fresh);
  return fresh;
}

/**
 * Loads the static game data for `region`, cached in IndexedDB by data version hash.
 * Falls back to the cache (stale: true) when the network fails; throws if there is no cache.
 */
export async function loadRegionData(region: Region): Promise<RegionData> {
  try {
    return toRegionData(await fetchAll(region), false);
  } catch (err) {
    const cached = await get<CachedData>(cacheKey(region));
    if (cached) return toRegionData(cached, true);
    throw err;
  }
}
