import { describe, it, expect } from 'vitest';
import type { CompactServant } from '../data/types';
import { en } from '../i18n/en';
import { it as itDict } from '../i18n/it';
import { isDefaultOwned, newOwned } from '../roster/defaults';
import {
  addRecent, availablePresets, commonCes, defaultMaxS, filterCes, noSolutionKind, partialParts, PRESETS, resolvePreset,
} from './picker';

const usable = { unsupported: [] as string[] };
const broken = { unsupported: ['someEffect'] };

describe('resolvePreset', () => {
  const all = new Map([[284, usable], [314, usable], [215, usable], [316, usable], [37, usable]]);
  const byId = (id: string) => PRESETS.find((p) => p.id === id)!;

  it('resolves nicknames through the alias map, keeping empty slots', () => {
    expect(resolvePreset(byId('doubleCastoria'), all)).toEqual([284, 284, 316]);
    expect(resolvePreset(byId('doubleKoyanskaya'), all)).toEqual([314, 314, 316]);
    expect(resolvePreset(byId('castoriaOberon'), all)).toEqual([284, 316, null]);
  });

  it('skips a preset whose servant is missing from the data or not usable', () => {
    expect(resolvePreset(byId('doubleSkadi'), new Map([[215, usable]]))).toBeNull();
    expect(resolvePreset(byId('doubleCastoria'), new Map([[284, usable], [316, broken]]))).toBeNull();
  });

  it('skips a preset whose nickname is not in the alias map', () => {
    expect(resolvePreset({ id: 'x', fill: ['nobody', 'castoria', null] }, all, new Map([['castoria', 284]]))).toBeNull();
  });

  it('lists only the presets that resolve', () => {
    const ids = availablePresets(new Map([[284, usable], [316, broken], [215, usable], [37, usable]])).map((p) => p.preset.id);
    expect(ids).toEqual(['doubleSkadi']);
  });
});

describe('isDefaultOwned', () => {
  it('detects untouched manual defaults', () => {
    expect(isDefaultOwned(newOwned(1))).toBe(true);
  });
  it('is false as soon as any value was edited', () => {
    const d = newOwned(1);
    expect(isDefaultOwned({ ...d, lv: 100 })).toBe(false);
    expect(isDefaultOwned({ ...d, npLv: 2 })).toBe(false);
    expect(isDefaultOwned({ ...d, skillLv: [10, 9, 10] })).toBe(false);
    expect(isDefaultOwned({ ...d, append2Lv: 1 })).toBe(false);
    expect(isDefaultOwned({ ...d, fou: 1000 })).toBe(false);
  });
});

describe('noSolutionKind', () => {
  it('says "no solution" only for a finished search', () => {
    expect(noSolutionKind(true, false)).toBe('none');
    expect(noSolutionKind(null, false)).toBe('none');
  });
  it('flags a search cut by the time limit, or by the stop button', () => {
    expect(noSolutionKind(false, false)).toBe('timeLimit');
    expect(noSolutionKind(false, true)).toBe('stopped');
  });
  it('has the wording in both languages', () => {
    expect(en.solver.noSolutionTimeLimit).toBe('No solution found within the time limit (search not exhaustive).');
    expect(itDict.solver.noSolutionTimeLimit).toMatch(/non esaustiva/);
  });
  it('defaults the time budget to 60 s for autocomplete, 20 s otherwise', () => {
    expect(defaultMaxS(true)).toBe(60);
    expect(defaultMaxS(false)).toBe(20);
  });
});

describe('partialParts', () => {
  const svt = (skills: unknown[], np: unknown) => ({ skills, np } as unknown as Pick<CompactServant, 'skills' | 'np'>);
  it('is empty without marks', () => {
    expect(partialParts(svt([{ num: 1 }, { num: 2, unsupported: [] }], null))).toEqual([]);
  });
  it('reads array, string and boolean marks on skills and NP', () => {
    expect(partialParts(svt([{ num: 1, unsupported: ['a', 'b'] }, { num: 2 }, { num: 3, unsupported: true }], { unsupported: 'c' })))
      .toEqual([{ part: 'skill', num: 1, effects: ['a', 'b'] }, { part: 'skill', num: 3, effects: [] }, { part: 'np', effects: ['c'] }]);
  });
});

describe('recents and CEs', () => {
  it('addRecent moves to the front, dedups and caps', () => {
    expect(addRecent([3, 2, 1], 2)).toEqual([2, 3, 1]);
    expect(addRecent([1, 2, 3], 4, 3)).toEqual([4, 1, 2]);
  });
  it('commonCes keeps list order and drops CEs not in the data', () => {
    expect(commonCes([{ collectionNo: 48 }, { collectionNo: 34 }, { collectionNo: 1 }]).map((c) => c.collectionNo)).toEqual([34, 48]);
  });
  it('filterCes matches every word, newest first', () => {
    const ces = [{ collectionNo: 34, name: 'Kaleidoscope' }, { collectionNo: 48, name: 'The Black Grail' }, { collectionNo: 50, name: 'Grail Black' }];
    expect(filterCes(ces, 'black grail').map((c) => c.collectionNo)).toEqual([50, 48]);
    expect(filterCes(ces, '').length).toBe(3);
  });
});
