import { describe, it, expect } from 'vitest';
import type { CompactMC } from '../data/types';
import type { Step } from '../solver/solve';
import { describeTurns, formatTurns } from './members';

const mc = { id: 1, name: 'MC', skills: [{ num: 1 }, { num: 2 }, { num: 3, name: 'Order Change' }], unsupported: [] } as unknown as CompactMC;
const turns: Step[][] = [
  [{ kind: 'skill', unit: 'a', num: 1, target: 'b' }, { kind: 'mc', num: 2 }, { kind: 'np', unit: 'a' }],
  [{ kind: 'mc', num: 3, swap: [0, 0] }, { kind: 'np', unit: 'd', targetIndex: 1 }],
];

describe('describeTurns', () => {
  it('resolves steps, MC names and order-change units', () => {
    expect(describeTurns(turns, ['a', 'b', 'c'], ['d'], mc)).toEqual([
      [{ kind: 'skill', unit: 'a', num: 1, target: 'b' }, { kind: 'mc', num: 2 }, { kind: 'np', unit: 'a' }],
      [{ kind: 'swap', out: 'a', inn: 'd' }, { kind: 'np', unit: 'd', targetIndex: 1 }],
    ]);
  });
  it('formatTurns keeps the text form', () => {
    expect(formatTurns(turns, ['a', 'b', 'c'], ['d'], (k) => (k ?? '?').toUpperCase(), mc)).toEqual([
      'T1: A S1 → B · MC 2 · NP A',
      'T2: Order change: A ↔ D · NP D',
    ]);
  });
});
