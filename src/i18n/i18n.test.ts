import { describe, it as test, expect } from 'vitest';
import { en } from './en';
import { it } from './it';

const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? keys(v as object, `${p}${k}.`) : [`${p}${k}:${typeof v}`]);

describe('i18n', () => {
  test('en and it have the same keys, with the same kinds', () => {
    expect(keys(it).sort()).toEqual(keys(en).sort());
  });
});
