import type { Region } from '../data/types';

// Recent and favourite nodes, per region, in localStorage. A per-viewer
// convenience: every access is guarded and the UI works without it.
export interface RecentNode { id: number; phase: number }
export const MAX_RECENT = 8;

const key = (kind: 'recent' | 'favs', region: Region) => `fgo-solver:quests:${kind}:${region}`;

function read<T>(k: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(k) ?? 'null');
    return ok(v) ? v : fallback;
  } catch { return fallback; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

const isRecent = (v: unknown): v is RecentNode[] => Array.isArray(v)
  && v.every((x) => x && typeof x === 'object' && Number.isInteger((x as RecentNode).id) && Number.isInteger((x as RecentNode).phase));
const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.every(Number.isInteger);

export const loadRecent = (r: Region) => read(key('recent', r), isRecent, []).slice(0, MAX_RECENT);
export const loadFavs = (r: Region) => read(key('favs', r), isIds, []);

/** Puts `node` first (dropping older entries for the same quest), keeps MAX_RECENT. */
export function pushRecent(list: readonly RecentNode[], node: RecentNode): RecentNode[] {
  return [node, ...list.filter((x) => x.id !== node.id)].slice(0, MAX_RECENT);
}
export const saveRecent = (r: Region, list: RecentNode[]) => write(key('recent', r), list);
export const saveFavs = (r: Region, ids: number[]) => write(key('favs', r), ids);
