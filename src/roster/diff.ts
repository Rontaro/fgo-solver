import type { OwnedServant, RosterDoc } from './types';

export interface RosterDiff { added: number; changed: number; removed: number; }

const same = (a: OwnedServant, b: OwnedServant) =>
  a.lv === b.lv && a.npLv === b.npLv && a.append2Lv === b.append2Lv && a.fou === b.fou &&
  a.defaultCe === b.defaultCe && a.skillLv.every((v, i) => v === b.skillLv[i]);

/** Servant changes going from `current` to `next`, matched by collectionNo. */
export function diffServants(current: RosterDoc, next: RosterDoc): RosterDiff {
  const cur = new Map(current.servants.map((s) => [s.collectionNo, s]));
  const nxt = new Map(next.servants.map((s) => [s.collectionNo, s]));
  let added = 0, changed = 0, removed = 0;
  for (const [no, s] of nxt) {
    const old = cur.get(no);
    if (!old) added++;
    else if (!same(old, s)) changed++;
  }
  for (const no of cur.keys()) if (!nxt.has(no)) removed++;
  return { added, changed, removed };
}
