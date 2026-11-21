import { describe, expect, it } from 'vitest';
import { diffServants } from './diff';
import { emptyRoster } from './store';
import type { OwnedServant } from './types';

const sv = (collectionNo: number, lv = 90): OwnedServant =>
  ({ collectionNo, lv, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 0 });

describe('diffServants', () => {
  it('counts added, changed and removed servants', () => {
    const cur = { ...emptyRoster('NA'), servants: [sv(1), sv(2), sv(3)] };
    const next = { ...emptyRoster('NA'), servants: [sv(1), sv(2, 100), sv(4), sv(5)] };
    expect(diffServants(cur, next)).toEqual({ added: 2, changed: 1, removed: 1 });
  });

  it('detects skill level changes', () => {
    const cur = { ...emptyRoster('NA'), servants: [sv(1)] };
    const next = { ...emptyRoster('NA'), servants: [{ ...sv(1), skillLv: [10, 9, 10] as [number, number, number] }] };
    expect(diffServants(cur, next).changed).toBe(1);
  });
});
