import { describe, it, expect } from 'vitest';
import type { Card, CompactServant } from '../data/types';
import {
  EMPTY_FILTERS, activeFilterCount, classLabel, classesOf, filterServants, groupServants, parsePrefs,
  servantType, toggle, type CatalogFilters,
} from './catalog';

const svt = (collectionNo: number, over: Partial<CompactServant> & { card?: Card; aoe?: boolean | null } = {}): CompactServant => {
  const { card = 'arts', aoe = true, ...rest } = over;
  return {
    id: collectionNo * 100, collectionNo, name: `Servant ${collectionNo}`, face: '', className: 'saber',
    attribute: 'earth', traits: [], rarity: 5, atkGrowth: [], skills: [], passives: [], append2: [],
    np: aoe === null ? null : { card, aoe, mult: [], hits: [], npRate: [], extra: [] },
    unsupported: [], ...rest,
  };
};

const f = (over: Partial<CatalogFilters>): CatalogFilters => ({ ...EMPTY_FILTERS, ...over });
const nos = (l: CompactServant[]) => l.map((s) => s.collectionNo);

describe('servantType', () => {
  it('support when np is null, else aoe / st', () => {
    expect(servantType(svt(1, { aoe: null }))).toBe('support');
    expect(servantType(svt(1, { aoe: true }))).toBe('aoe');
    expect(servantType(svt(1, { aoe: false }))).toBe('st');
  });
});

describe('filterServants', () => {
  const list = [
    svt(1, { className: 'saber', rarity: 5, card: 'buster', aoe: true }),
    svt(2, { className: 'archer', rarity: 4, card: 'arts', aoe: false }),
    svt(3, { className: 'caster', rarity: 5, aoe: null, name: 'Altria Caster' }),
    svt(4, { className: 'saber', rarity: 3, card: 'quick', aoe: false, unsupported: ['buff:x'] }),
  ];
  const owned = new Set([2, 3]);

  it('no filters keeps everything', () => {
    expect(nos(filterServants(list, EMPTY_FILTERS, owned))).toEqual([1, 2, 3, 4]);
  });
  it('chips within a group are OR', () => {
    expect(nos(filterServants(list, f({ classes: ['archer', 'caster'] }), owned))).toEqual([2, 3]);
    expect(nos(filterServants(list, f({ rarities: [4, 3] }), owned))).toEqual([2, 4]);
  });
  it('groups are AND', () => {
    expect(nos(filterServants(list, f({ classes: ['saber'], rarities: [5] }), owned))).toEqual([1]);
    expect(nos(filterServants(list, f({ classes: ['saber'], types: ['st'] }), owned))).toEqual([4]);
  });
  it('card filter only matches damaging NPs', () => {
    expect(nos(filterServants(list, f({ cards: ['arts'] }), owned))).toEqual([2]);
    expect(nos(filterServants(list, f({ cards: ['buster', 'quick'] }), owned))).toEqual([1, 4]);
  });
  it('type filter', () => {
    expect(nos(filterServants(list, f({ types: ['support'] }), owned))).toEqual([3]);
    expect(nos(filterServants(list, f({ types: ['aoe', 'support'] }), owned))).toEqual([1, 3]);
  });
  it('roster ownership', () => {
    expect(nos(filterServants(list, f({ owned: ['in'] }), owned))).toEqual([2, 3]);
    expect(nos(filterServants(list, f({ owned: ['out'] }), owned))).toEqual([1, 4]);
    expect(nos(filterServants(list, f({ owned: ['in', 'out'] }), owned))).toEqual([1, 2, 3, 4]);
  });
  it('hides unsupported', () => {
    expect(nos(filterServants(list, f({ hideUnsupported: true }), owned))).toEqual([1, 2, 3]);
  });
  it('tolerant query (Artoria = Altria, case-insensitive)', () => {
    expect(nos(filterServants(list, EMPTY_FILTERS, owned, 'artoria cas'))).toEqual([3]);
    expect(nos(filterServants(list, f({ classes: ['saber'] }), owned, 'altria'))).toEqual([]);
  });
  it('counts active filters', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount(f({ classes: ['saber', 'archer'], cards: ['arts'], hideUnsupported: true }))).toBe(4);
  });
  it('toggle adds and removes', () => {
    expect(toggle([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggle([1, 2], 1)).toEqual([2]);
  });
});

describe('groupServants', () => {
  const list = [
    svt(10, { className: 'archer', rarity: 4 }),
    svt(20, { className: 'saber', rarity: 5 }),
    svt(30, { className: 'archer', rarity: 5 }),
    svt(40, { className: 'zzNew', rarity: 3 }),
    svt(50, { className: 'archer', rarity: 5 }),
    svt(60, { className: 'shielder', rarity: 4 }),
  ];
  it('by class: game order, unknown classes last; rarity desc then newest first', () => {
    const g = groupServants(list, 'class');
    expect(g.map((x) => x.key)).toEqual(['shielder', 'saber', 'archer', 'zzNew']);
    expect(nos(g[2].servants)).toEqual([50, 30, 10]);
    expect(g[2].label).toBe('Archer');
  });
  it('by rarity: 5 first, newest first inside', () => {
    const g = groupServants(list, 'rarity');
    expect(g.map((x) => x.label)).toEqual(['5★', '4★', '3★']);
    expect(nos(g[0].servants)).toEqual([50, 30, 20]);
  });
  it('classesOf and classLabel', () => {
    expect(classesOf(list)).toEqual(['shielder', 'saber', 'archer', 'zzNew']);
    expect(classLabel('alterEgo')).toBe('Alter Ego');
    expect(classLabel('beastIII')).toBe('Beast III');
  });
});

describe('parsePrefs', () => {
  it('defaults and drops invalid values', () => {
    expect(parsePrefs(null)).toEqual({ groupBy: 'class', filters: EMPTY_FILTERS });
    expect(parsePrefs({ groupBy: 'rarity', filters: { cards: ['arts', 'bad'], rarities: [5, 9, 'x'], owned: ['in'], hideUnsupported: true } }))
      .toEqual({ groupBy: 'rarity', filters: f({ cards: ['arts'], rarities: [5], owned: ['in'], hideUnsupported: true }) });
  });
});
