import { describe, expect, it } from 'vitest';
import type { Solution, Step } from '../solver/solve';
import { toFgaCommand } from './command';

const sol = (turns: Step[][]): Solution => ({ turns, margins: [], actions: 0, usesSwap: false });
const team = ['A', 'B', 'C', 'D', 'E', 'F'].map((key) => ({ key }));
const sk = (unit: string, num: number, target?: string): Step => ({ kind: 'skill', unit, num, ...(target && { target }) });
const np = (unit: string, targetIndex?: number): Step => ({ kind: 'np', unit, ...(targetIndex !== undefined && { targetIndex }) });

describe('toFgaCommand', () => {
  it('writes a simple 3-turn line', () => {
    expect(toFgaCommand(sol([[sk('A', 1), np('A')], [sk('B', 2), np('A')], [sk('C', 3), np('A')]]), team))
      .toBe('a4,#,e4,#,i4');
  });
  it('writes ally targets and empty turns', () => {
    expect(toFgaCommand(sol([[sk('B', 1, 'C'), np('C')], [], [np('C')]]), team)).toBe('d36,#,0,#,6');
  });
  it('writes an MC skill with a target', () => {
    expect(toFgaCommand(sol([[{ kind: 'mc', num: 2, target: 'B' }, np('B')]]), team)).toBe('k25');
  });
  it('tracks positions through an order change', () => {
    const swap: Step = { kind: 'mc', num: 3, swap: [1, 0] };
    expect(toFgaCommand(sol([[sk('B', 1), swap, sk('D', 3, 'A'), np('A')], [sk('D', 1), sk('C', 2, 'D'), np('D')]]), team))
      .toBe('dx21f14,#,dh25');
  });
  it('groups two NPs at the end of the turn', () => {
    expect(toFgaCommand(sol([[sk('A', 1), np('C'), np('A')]]), team)).toBe('a64');
  });
  it('targets the enemy of a single-target NP', () => {
    expect(toFgaCommand(sol([[sk('A', 2), np('B', 2)]]), team)).toBe('bt35');
  });
});
