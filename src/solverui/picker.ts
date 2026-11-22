// Pure logic of the team picker: partial-support marks, recents, presets,
// common CEs, time budget and the "no solution" wording.
import { ALIASES, matchesAll, normalize, queryWords } from '../data/search';
import type { CompactCE, CompactServant } from '../data/types';

/** A servant is usable by the solver when no effect is unsupported at servant level. */
export const isUsable = (s: Pick<CompactServant, 'unsupported'>): boolean => s.unsupported.length === 0;

/** One skill or the NP the engine only partly simulates (optional per-part `unsupported` marks). */
export interface PartialPart { part: 'skill' | 'np'; num?: number; effects: string[] }

/** Reads an optional `unsupported` mark of any reasonable shape: string[], string or boolean. */
function mark(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.length ? v.map(String) : null;
  if (typeof v === 'string') return v ? [v] : null;
  return v === true ? [] : null;
}

/** Skills (by num) and NP flagged with an `unsupported` mark; empty when fully simulated. */
export function partialParts(s: Pick<CompactServant, 'skills' | 'np'>): PartialPart[] {
  const out: PartialPart[] = [];
  s.skills.forEach((sk, i) => {
    const m = mark((sk as { unsupported?: unknown }).unsupported);
    if (m) out.push({ part: 'skill', num: sk.num ?? i + 1, effects: m });
  });
  const np = s.np ? mark((s.np as { unsupported?: unknown }).unsupported) : null;
  if (np) out.push({ part: 'np', effects: np });
  return out;
}

// Recently picked servants, per viewer; every storage access is guarded.
const RECENT_KEY = 'fgo-solver:recent-servants';
export const RECENT_MAX = 12;

/** Moves `no` to the front, without duplicates, keeping at most `max`. */
export const addRecent = (list: readonly number[], no: number, max = RECENT_MAX): number[] =>
  [no, ...list.filter((x) => x !== no)].slice(0, max);

export function loadRecent(): number[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
export function saveRecent(list: readonly number[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

/**
 * Quick 3T cores. `fill` lists the servants (alias-map nicknames) of Front 2,
 * Front 3 and Back 1; null leaves that slot empty. Front 1 (the DPS) is kept.
 */
export interface Preset { id: string; fill: readonly [string, string, string | null] }
export const PRESETS: readonly Preset[] = [
  { id: 'doubleCastoria', fill: ['castoria', 'castoria', 'oberon'] },
  { id: 'doubleKoyanskaya', fill: ['koyanskaya light', 'koyanskaya light', 'oberon'] },
  { id: 'doubleSkadi', fill: ['skadi', 'skadi', 'waver'] },
  { id: 'castoriaOberon', fill: ['castoria', 'oberon', null] },
  { id: 'koyanskayaOberon', fill: ['koyanskaya light', 'oberon', null] },
];
/** Slot indexes a preset fills: Front 2, Front 3, Back 1. */
export const PRESET_SLOTS = [1, 2, 3] as const;

/**
 * The collectionNos of a preset's fill, or null when one of its servants is
 * not in the alias map, not in the region data, or not usable by the solver.
 */
export function resolvePreset(p: Preset, servants: ReadonlyMap<number, Pick<CompactServant, 'unsupported'>>,
  aliases: ReadonlyMap<string, number> = ALIASES): (number | null)[] | null {
  const out: (number | null)[] = [];
  for (const name of p.fill) {
    if (name === null) { out.push(null); continue; }
    const no = aliases.get(normalize(name));
    const s = no === undefined ? undefined : servants.get(no);
    if (no === undefined || !s || !isUsable(s)) return null;
    out.push(no);
  }
  return out;
}

/** Presets whose servants all resolve, with their fill. */
export const availablePresets = (servants: ReadonlyMap<number, Pick<CompactServant, 'unsupported'>>,
  aliases: ReadonlyMap<string, number> = ALIASES) =>
  PRESETS.flatMap((p) => { const fill = resolvePreset(p, servants, aliases); return fill ? [{ preset: p, fill }] : []; });

/**
 * Commonly used 3T CEs, by collectionNo (the same in every region; names
 * differ in JP). English names checked against the Atlas NA export.
 */
export const COMMON_CES: readonly { no: number; name: string }[] = [
  { no: 34, name: 'Kaleidoscope' },
  { no: 48, name: 'The Black Grail' },
  { no: 683, name: 'Aerial Drive' },
  { no: 390, name: 'Holy Night Supper' },
  { no: 400, name: 'Devilish Bodhisattva' },
  { no: 40, name: 'Prisma Cosmos' },
  { no: 35, name: "Heaven's Feel" },
  { no: 212, name: 'Golden Captures the Carp' },
  { no: 330, name: 'Chaldea Lunchtime' },
];

/** The common CEs present in this region's data, in list order. */
export const commonCes = <T extends Pick<CompactCE, 'collectionNo'>>(ces: readonly T[]): T[] => {
  const by = new Map(ces.map((c) => [c.collectionNo, c]));
  return COMMON_CES.flatMap((c) => { const ce = by.get(c.no); return ce ? [ce] : []; });
};

/** CEs whose name contains every query word, newest first. */
export function filterCes<T extends Pick<CompactCE, 'name' | 'collectionNo'>>(ces: readonly T[], query: string): T[] {
  const words = queryWords(query);
  return ces.filter((c) => !words.length || matchesAll(words, normalize(c.name)))
    .sort((a, b) => b.collectionNo - a.collectionNo);
}

/** Default max time: autocomplete searches many teams, so it gets more. */
export const defaultMaxS = (auto: boolean): number => (auto ? 60 : 20);

/**
 * Which "no solution" wording applies. exhausted is the run's result (null
 * while unknown); a search that did not finish proves nothing.
 */
export type NoSolutionKind = 'none' | 'timeLimit' | 'stopped';
export function noSolutionKind(exhausted: boolean | null, stoppedByUser: boolean): NoSolutionKind {
  if (exhausted !== false) return 'none';
  return stoppedByUser ? 'stopped' : 'timeLimit';
}
