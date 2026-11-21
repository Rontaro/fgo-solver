import { describe, it, expect } from 'vitest';
import { buildClassConstants, classGaps, type ClassInfo } from './constants';

const classes: ClassInfo[] = [
  { id: 1, className: 'saber', attackRate: 1000, relationId: 1 },
  { id: 2, className: 'archer', attackRate: 950, relationId: 2 },
  { id: 10001, className: 'grandSaber', attackRate: 1000, relationId: 1 },
  { id: 42, className: '42', attackRate: 1000, relationId: 42 },
  { id: 97, className: 'unknown', attackRate: 1000, relationId: 0 },
];
const relation = {
  saber: { saber: 1000, archer: 500 },
  archer: { saber: 2000, archer: 1000 },
  '42': { saber: 1000 },
};

describe('buildClassConstants', () => {
  const c = buildClassConstants(classes, { saber: 1000, archer: 950, '98': 1000 }, relation);
  it('takes attackRate from NiceClass, drops numeric class names', () => {
    expect(c.classAtk).toEqual({ saber: 1000, archer: 950, grandSaber: 1000, unknown: 1000 });
    expect(c.classRel['42']).toBeUndefined();
  });
  it('fills missing pairs from the classes sharing the relationId', () => {
    expect(c.classRel.grandSaber).toEqual({ saber: 1000, archer: 500, grandSaber: 1000 });
    expect(c.classRel.archer.grandSaber).toBe(2000);
    expect(c.classRel.saber.grandSaber).toBe(1000);
  });
  it('keeps listed pairs and never invents unresolved ones', () => {
    expect(c.classRel.saber.archer).toBe(500);
    expect(c.classRel.unknown).toBeUndefined(); // relationId 0: no representative
    expect(c.filled).toBe(5);
  });
  it('classGaps lists what does not resolve', () => {
    expect(classGaps(c, ['saber', 'grandSaber'], ['archer', 'grandSaber'])).toEqual([]);
    expect(classGaps(c, ['saber', 'beast'], ['unknown'])).toEqual([
      'classRel[saber][unknown]', 'classAtk[beast]', 'classRel[beast][unknown]',
    ]);
  });
});
