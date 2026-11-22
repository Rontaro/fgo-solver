import type { OwnedServant } from './types';

/** A servant just added by hand (roster search or catalog): lv 90, NP1, skills 10/10/10, no append, no fou. */
export function newOwned(collectionNo: number): OwnedServant {
  return { collectionNo, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 0 };
}

/** True while the entry still has the manual defaults of newOwned (the user never edited it). */
export function isDefaultOwned(o: OwnedServant): boolean {
  const d = newOwned(o.collectionNo);
  return o.lv === d.lv && o.npLv === d.npLv && o.append2Lv === d.append2Lv && o.fou === d.fou
    && o.skillLv.every((v, i) => v === d.skillLv[i]);
}
