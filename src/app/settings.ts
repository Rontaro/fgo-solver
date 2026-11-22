/**
 * User settings, kept in this browser (localStorage). Every access is guarded:
 * storage can be missing or blocked (private mode), and then the defaults
 * apply. Read at use time (getSettings), so a change counts from the next run.
 */
export interface SupportDefaults { lv: number; npLv: number; skillLv: [number, number, number]; fou: number; }
export interface Settings {
  /** Default search time limit in seconds; null = the built-in default. */
  maxTimeS: number | null;
  /** Stats assumed for support servants (friend supports). */
  support: SupportDefaults;
}

export const DEFAULT_SETTINGS: Settings = {
  maxTimeS: null,
  support: { lv: 90, npLv: 1, skillLv: [10, 10, 10], fou: 1000 },
};

const KEY = 'fgo-solver:settings';
const int = (v: unknown, lo: number, hi: number, d: number) =>
  (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d);

/** Clamps a (possibly stale or hand-edited) settings object to valid values. */
export function normalize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const s = (r.support && typeof r.support === 'object' ? r.support : {}) as Partial<SupportDefaults>;
  const d = DEFAULT_SETTINGS.support;
  const sk = Array.isArray(s.skillLv) ? s.skillLv : d.skillLv;
  return {
    maxTimeS: r.maxTimeS === null || r.maxTimeS === undefined ? null : int(r.maxTimeS, 1, 600, 20),
    support: {
      lv: int(s.lv, 1, 120, d.lv), npLv: int(s.npLv, 1, 5, d.npLv), fou: int(s.fou, 0, 2000, d.fou),
      skillLv: [0, 1, 2].map((i) => int(sk[i], 1, 10, d.skillLv[i])) as [number, number, number],
    },
  };
}

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): Settings {
  const n = normalize(s);
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage blocked: not kept */ }
  return n;
}
