import { describe, it, expect } from 'vitest';
import { ALIASES, matchesAll, normalize, queryWords, resolveAlias, searchServants } from './search';

const svt = (collectionNo: number, name: string) => ({ collectionNo, name });
const LIST = [
  svt(2, 'Altria Pendragon'), svt(3, 'Altria Pendragon (Alter)'), svt(284, 'Altria Caster'),
  svt(215, 'Scáthach-Skadi'), svt(70, 'Scáthach'), svt(314, 'Koyanskaya of Light'),
  svt(334, 'Koyanskaya of Dark'), svt(37, 'Zhuge Liang (Lord El-Melloi II)'), svt(312, 'Mélusine'),
  svt(247, 'Arjuna (Alter)'), svt(84, 'Arjuna'),
];
const names = (q: string) => searchServants(LIST, q).map((s) => s.collectionNo);

describe('normalize', () => {
  it('drops case, accents and punctuation; Artoria → altria', () => {
    expect(normalize('Scáthach-Skadi')).toBe('scathach skadi');
    expect(normalize('  Mélusine ')).toBe('melusine');
    expect(normalize('ARTORIA Pendragon (Alter)')).toBe('altria pendragon alter');
    expect(queryWords('  Arjuna   ALTER ')).toEqual(['arjuna', 'alter']);
  });
  it('matchesAll: every word must appear, as a substring', () => {
    expect(matchesAll(['alt', 'pen'], 'altria pendragon alter')).toBe(true);
    expect(matchesAll(['alt', 'lily'], 'altria pendragon alter')).toBe(false);
    expect(matchesAll([], 'x')).toBe(true);
  });
});

describe('searchServants', () => {
  it('accents ignored and partial words match', () => {
    expect(names('scath')).toEqual(expect.arrayContaining([70, 215]));
    expect(names('melu')).toEqual([312]);
    expect(names('scathach skadi')).toEqual([215]);
  });
  it('Artoria finds Altria', () => {
    expect(names('artoria caster')).toEqual([284]);
    expect(names('Artoria')).toEqual(expect.arrayContaining([2, 3, 284]));
  });
  it('multi-word AND, in any order', () => {
    expect(names('alter arjuna')).toEqual([247]);
    expect(names('pendragon alter')).toEqual([3]);
  });
  it('exact name ranks before prefix, before substring', () => {
    expect(names('arjuna')).toEqual([84, 247]);
    expect(names('altria pendragon')[0]).toBe(2);
  });
  it('nicknames', () => {
    expect(names('castoria')).toEqual([284]);
    expect(names('skadi')[0]).toBe(215);
    expect(names('waver')).toEqual([37]);
    expect(names('koyan')).toEqual(expect.arrayContaining([314, 334]));
    expect(names('koyan light')).toEqual([314]);
  });
  it('blank query finds nothing; limit applies', () => {
    expect(names('  ')).toEqual([]);
    expect(searchServants(LIST, 'a', 3)).toHaveLength(3);
  });
  it('extra text (e.g. class) is searchable', () => {
    expect(searchServants(LIST, 'caster', 20, (s) => (s.collectionNo === 37 ? 'caster' : '')).map((s) => s.collectionNo))
      .toEqual([284, 37]);
  });
});

describe('aliases', () => {
  it('resolveAlias: exact and partial nicknames', () => {
    expect(resolveAlias('Castoria')).toEqual(expect.arrayContaining([284, 386]));
    expect(resolveAlias('mhxx')).toEqual([222]);
    expect(resolveAlias('Arjuna Alter')).toEqual([247]);
    expect(resolveAlias('jalter')).toEqual(expect.arrayContaining([106, 219, 141]));
    expect(resolveAlias('nobody')).toEqual([]);
    expect(resolveAlias('')).toEqual([]);
  });
  it('keys are normalized and point to positive collectionNos', () => {
    for (const [k, v] of ALIASES) {
      expect(k).toBe(normalize(k));
      expect(Number.isInteger(v) && v > 0).toBe(true);
    }
  });
  // public/data is generated (npm run data) and gitignored: checked when present.
  const files = import.meta.glob<{ collectionNo: number; name: string }[]>('/public/data/NA/servants.json', { eager: true, import: 'default' });
  const data = Object.values(files)[0];
  it.skipIf(!data)('every alias targets an existing NA servant', () => {
    const byNo = new Map(data!.map((s) => [s.collectionNo, s.name]));
    for (const [, no] of ALIASES) expect(byNo.has(no), `collectionNo ${no}`).toBe(true);
    expect(byNo.get(284)).toBe('Altria Caster');
    expect(byNo.get(215)).toBe('Scáthach-Skadi');
    expect(byNo.get(314)).toBe('Koyanskaya of Light');
    expect(byNo.get(247)).toBe('Arjuna (Alter)');
    expect(byNo.get(321)).toBe('Kama (Avenger)');
  });
});
