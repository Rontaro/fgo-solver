// Tolerant text search shared by the servant and quest pickers: case- and
// accent-insensitive, Altria/Artoria treated alike, every query word must
// appear (as a substring) somewhere in the searched text.
import aliasJson from './aliases.json';
import type { CompactServant } from './types';

/** Lowercase, strip accents and punctuation, unify Artoria → altria. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/artoria/g, 'altria');
}

/** Normalized query words (empty for a blank query). */
export const queryWords = (q: string): string[] => normalize(q).split(' ').filter(Boolean);

/** True when every word occurs in the (already normalized) haystack. */
export const matchesAll = (words: readonly string[], hay: string): boolean => words.every((w) => hay.includes(w));

/** Community nickname → collectionNo (normalized keys). */
export const ALIASES: ReadonlyMap<string, number> = new Map(
  Object.entries(aliasJson as Record<string, number>).map(([k, v]) => [normalize(k), v]),
);

/** Normalized aliases of each collectionNo. */
const aliasesByNo = new Map<number, string[]>();
for (const [a, no] of ALIASES) aliasesByNo.set(no, [...(aliasesByNo.get(no) ?? []), a]);

export const aliasesOf = (collectionNo: number): readonly string[] => aliasesByNo.get(collectionNo) ?? [];

/** collectionNos whose nickname matches the query (all words, partial). */
export function resolveAlias(q: string): number[] {
  const words = queryWords(q);
  if (!words.length) return [];
  const out = new Set<number>();
  for (const [a, no] of ALIASES) if (matchesAll(words, a)) out.add(no);
  return [...out];
}

/**
 * 0 = exact name/nickname, 1 = name/nickname starts with the query,
 * 2 = every word found somewhere, null = no match.
 */
export function servantScore(s: Pick<CompactServant, 'name' | 'collectionNo'>, words: readonly string[], extra = ''): number | null {
  if (!words.length) return null;
  const q = words.join(' ');
  const names = [normalize(s.name), ...aliasesOf(s.collectionNo)];
  if (names.includes(q)) return 0;
  if (names.some((n) => n.startsWith(q))) return 1;
  const hay = [...names, normalize(extra)].join(' | ');
  return matchesAll(words, hay) ? 2 : null;
}

/** Matching servants, best first (score, then name), at most `limit`. */
export function searchServants<T extends Pick<CompactServant, 'name' | 'collectionNo'>>(
  list: Iterable<T>, query: string, limit = 20, extra?: (s: T) => string,
): T[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const hits: { s: T; score: number }[] = [];
  for (const s of list) {
    const score = servantScore(s, words, extra?.(s));
    if (score !== null) hits.push({ s, score });
  }
  hits.sort((a, b) => a.score - b.score || a.s.name.localeCompare(b.s.name) || a.s.collectionNo - b.s.collectionNo);
  return hits.slice(0, limit).map((h) => h.s);
}
