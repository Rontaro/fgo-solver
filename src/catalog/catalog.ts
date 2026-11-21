// Pure logic of the servant catalog: type derivation, filters, grouping.
import type { Card, CompactServant } from '../data/types';
import { queryWords, servantScore } from '../data/search';

export type SvtType = 'aoe' | 'st' | 'support';
export type Ownership = 'in' | 'out';
export type GroupBy = 'class' | 'rarity';

/** 'support' when there is no damaging NP (np null), else AoE / ST. */
export const servantType = (s: Pick<CompactServant, 'np'>): SvtType =>
  s.np === null ? 'support' : s.np.aoe ? 'aoe' : 'st';

export interface CatalogFilters {
  classes: string[];
  rarities: number[];
  cards: Card[];
  types: SvtType[];
  owned: Ownership[];
  hideUnsupported: boolean;
}

export const EMPTY_FILTERS: CatalogFilters = {
  classes: [], rarities: [], cards: [], types: [], owned: [], hideUnsupported: false,
};

export const activeFilterCount = (f: CatalogFilters): number =>
  f.classes.length + f.rarities.length + f.cards.length + f.types.length + f.owned.length + (f.hideUnsupported ? 1 : 0);

/** Adds `v` to the list, or removes it if present. */
export const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * Chips within a group are OR'ed, groups are AND'ed; an empty group does not
 * filter. The NP card filter only matches servants with a damaging NP (the
 * compact data has no card for support NPs). The query uses the tolerant
 * servant search (names and nicknames).
 */
export function filterServants<T extends CompactServant>(
  list: Iterable<T>, f: CatalogFilters, owned: ReadonlySet<number>, query = '',
): T[] {
  const words = queryWords(query);
  const out: T[] = [];
  for (const s of list) {
    if (f.classes.length && !f.classes.includes(s.className)) continue;
    if (f.rarities.length && !f.rarities.includes(s.rarity)) continue;
    if (f.cards.length && !(s.np && f.cards.includes(s.np.card))) continue;
    if (f.types.length && !f.types.includes(servantType(s))) continue;
    if (f.owned.length && !f.owned.includes(owned.has(s.collectionNo) ? 'in' : 'out')) continue;
    if (f.hideUnsupported && s.unsupported.length) continue;
    if (words.length && servantScore(s, words) === null) continue;
    out.push(s);
  }
  return out;
}

const CLASS_ORDER = [
  'shielder', 'saber', 'archer', 'lancer', 'rider', 'caster', 'assassin', 'berserker',
  'ruler', 'avenger', 'alterEgo', 'moonCancer', 'foreigner', 'pretender', 'beyond',
  'beastEresh', 'beast',
];
const CLASS_LABEL: Record<string, string> = { alterEgo: 'Alter Ego', moonCancer: 'Moon Cancer' };

/** "saber" -> "Saber", "alterEgo" -> "Alter Ego", "beastIII" -> "Beast III". */
export const classLabel = (c: string): string =>
  CLASS_LABEL[c] ?? (c.charAt(0).toUpperCase() + c.slice(1)).replace(/([a-z])([A-Z])/g, '$1 $2');

/** Known classes in game order, then unknown ones alphabetically. */
export function compareClass(a: string, b: string): number {
  const ia = CLASS_ORDER.indexOf(a), ib = CLASS_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || 0;
  return a.localeCompare(b);
}

/** Every class present, in display order. */
export const classesOf = (list: Iterable<Pick<CompactServant, 'className'>>): string[] =>
  [...new Set([...list].map((s) => s.className))].sort(compareClass);

/** Rarity desc, then collectionNo desc (newest first). */
export const compareServants = (a: CompactServant, b: CompactServant): number =>
  b.rarity - a.rarity || b.collectionNo - a.collectionNo;

export interface CatalogGroup<T> { key: string; label: string; servants: T[]; }

const stars = (r: number) => (r > 0 ? `${r}★` : '0★');

/** Sections by class (game order) or rarity (5★ first), each sorted by compareServants. */
export function groupServants<T extends CompactServant>(list: readonly T[], by: GroupBy): CatalogGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const s of list) {
    const k = by === 'class' ? s.className : String(s.rarity);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const keys = [...groups.keys()].sort(by === 'class' ? compareClass : (a, b) => Number(b) - Number(a));
  return keys.map((k) => ({
    key: k,
    label: by === 'class' ? classLabel(k) : stars(Number(k)),
    servants: groups.get(k)!.sort(compareServants),
  }));
}

// Persisted per viewer in localStorage; every access is guarded.
const PREFS_KEY = 'fgo-solver:catalog';
export interface CatalogPrefs { filters: CatalogFilters; groupBy: GroupBy; }

const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const ofSet = <T extends string>(v: unknown, ok: readonly T[]): T[] =>
  (strs(v) ? v.filter((x): x is T => (ok as readonly string[]).includes(x)) : []);

/** Validates stored prefs, dropping anything unexpected. */
export function parsePrefs(raw: unknown): CatalogPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const f = (o.filters && typeof o.filters === 'object' ? o.filters : {}) as Record<string, unknown>;
  return {
    groupBy: o.groupBy === 'rarity' ? 'rarity' : 'class',
    filters: {
      classes: strs(f.classes) ? f.classes : [],
      rarities: Array.isArray(f.rarities) ? f.rarities.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 5) : [],
      cards: ofSet<Card>(f.cards, ['arts', 'buster', 'quick']),
      types: ofSet<SvtType>(f.types, ['aoe', 'st', 'support']),
      owned: ofSet<Ownership>(f.owned, ['in', 'out']),
      hideUnsupported: f.hideUnsupported === true,
    },
  };
}

export function loadPrefs(): CatalogPrefs {
  try { return parsePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')); } catch { return parsePrefs(null); }
}
export function savePrefs(p: CatalogPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
