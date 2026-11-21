import { describe, it, expect } from 'vitest';
import type { CompactMC } from '../data/types';
import type { Step } from '../solver/solve';
import type { RawQuest } from '../engine/quest';
import { en } from '../i18n/en';
import { describeTurns, formatTurns, slotEnemyNames } from './members';

const mc = { id: 1, name: 'MC', skills: [{ num: 1 }, { num: 2 }, { num: 3, name: 'Order Change' }], unsupported: [] } as unknown as CompactMC;
const turns: Step[][] = [
  [{ kind: 'skill', unit: 'a', num: 1, target: 'b' }, { kind: 'mc', num: 2 }, { kind: 'np', unit: 'a' }],
  [{ kind: 'mc', num: 3, swap: [0, 0] }, { kind: 'np', unit: 'd', targetIndex: 1 }],
];

describe('describeTurns', () => {
  it('resolves steps, MC names and order-change units', () => {
    expect(describeTurns(turns, ['a', 'b', 'c'], ['d'], mc)).toEqual([
      [{ kind: 'skill', unit: 'a', num: 1, target: 'b' }, { kind: 'mc', num: 2 }, { kind: 'np', unit: 'a' }],
      [{ kind: 'swap', out: 'a', inn: 'd' }, { kind: 'target', slot: 1 }, { kind: 'np', unit: 'd' }],
    ]);
  });
  it('formatTurns keeps the text form', () => {
    expect(formatTurns(turns, ['a', 'b', 'c'], ['d'], (k) => (k ?? '?').toUpperCase(), mc, en.turns)).toEqual([
      'T1: A S1 → B · MC 2 · NP A',
      'T2: Order change: A ↔ D · target: enemy 2 · NP D',
    ]);
  });
});

describe('turn target', () => {
  it('one target chip per turn, before the first NP that carries it, the later NPs plain', () => {
    const t: Step[][] = [[{ kind: 'np', unit: 'a', targetIndex: 2 }, { kind: 'np', unit: 'b' }]];
    expect(describeTurns(t, ['a', 'b', 'c'], [], mc)[0])
      .toEqual([{ kind: 'target', slot: 2 }, { kind: 'np', unit: 'a' }, { kind: 'np', unit: 'b' }]);
  });
});

describe('slotEnemyNames', () => {
  const e = (deckId: number, name: string, deck = 'enemy') => ({ deck, deckId, name });
  it('slot i holds the enemy with deckId i + 1; reserves and missing slots are undefined', () => {
    const raw = { stages: [
      { wave: 2, enemyFieldPosCount: 2, enemies: [e(1, 'C'), e(3, 'R')] },
      { wave: 1, enemies: [e(2, 'B'), e(1, 'A'), e(1, 'S', 'shift')] },
    ] } as unknown as RawQuest;
    expect(slotEnemyNames(raw)).toEqual([['A', 'B', undefined], ['C', undefined]]);
  });
});
