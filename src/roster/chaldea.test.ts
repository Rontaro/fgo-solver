import { describe, expect, it } from 'vitest';
import backup from '../../test/fixtures/chaldea-backup-synthetic.json';
import { chaldeaLevel, parseChaldeaBackup, readChaldeaFile } from './chaldea';

const known = new Map([[2, { rarity: 5 }], [16, { rarity: 3 }], [284, { rarity: 5 }]]);
const ces = new Set([34, 48, 1000]);

describe('chaldeaLevel', () => {
  it('uses the ascension cap without grails and the grailed cap with them', () => {
    expect(chaldeaLevel(5, 4, 0)).toBe(90);
    expect(chaldeaLevel(5, 0, 0)).toBe(50);
    expect(chaldeaLevel(5, 4, 5)).toBe(100);
    expect(chaldeaLevel(5, 4, 15)).toBe(120);
    expect(chaldeaLevel(4, 4, 7)).toBe(100);
    expect(chaldeaLevel(3, 4, 9)).toBe(100);
    expect(chaldeaLevel(1, 4, 1)).toBe(70);
    expect(chaldeaLevel(1, 4, 20)).toBe(120);
  });
});

describe('parseChaldeaBackup', () => {
  it('lists every account and imports nothing when several exist and none is chosen', () => {
    const r = parseChaldeaBackup(backup, 'NA');
    expect(r.accounts).toEqual([
      { index: 0, name: 'Main NA', region: 'na' },
      { index: 1, name: 'Alt JP', region: 'jp' },
    ]);
    expect(r.servants).toEqual([]);
    expect(r.ces).toEqual([]);
  });

  it('maps owned servants and CEs of the chosen account', () => {
    const r = parseChaldeaBackup(JSON.stringify(backup), 'NA', { accountIndex: 0, servants: known, ces });
    expect(r.servants).toEqual([
      { collectionNo: 2, lv: 94, npLv: 2, skillLv: [10, 9, 8], append2Lv: 10, fou: 2000 },
      { collectionNo: 16, lv: 60, npLv: 5, skillLv: [4, 4, 4], append2Lv: 3, fou: 500 },
      { collectionNo: 9999, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 2000 },
    ]);
    // 284 is not owned (favorite false), 10000201 is a duplicate entry
    expect(r.ces).toEqual([
      { collectionNo: 34, lv: 100, mlb: true },
      { collectionNo: 1000, lv: 20, mlb: false },
    ]);
  });

  it('warns on clamps, unknown servants, duplicates and region mismatch', () => {
    const r = parseChaldeaBackup(backup, 'JP', { accountIndex: 0, servants: known, ces });
    expect(r.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('regione NA'),
      expect.stringContaining('Servant #9999: non presente'),
      'Servant #9999 Fou ATK: 2500 fuori da 0..2000, impostato a 2000',
      expect.stringContaining('1 servant duplicati'),
    ]));
    expect(r.warnings).toHaveLength(4);
  });

  it('picks the only account when there is one', () => {
    const one = { ...backup, users: [backup.users[1]] };
    const r = parseChaldeaBackup(one, 'JP', { servants: known });
    expect(r.accounts).toHaveLength(1);
    expect(r.servants).toEqual([{ collectionNo: 2, lv: 90, npLv: 1, skillLv: [6, 6, 6], append2Lv: 0, fou: 1000 }]);
    expect(r.warnings).toEqual([]);
  });

  it('throws naming the missing field on a file that is not a backup', () => {
    expect(() => parseChaldeaBackup('not json', 'NA')).toThrow(/JSON/);
    expect(() => parseChaldeaBackup({ users: [] }, 'NA')).toThrow(/"version"/);
    expect(() => parseChaldeaBackup({ version: 1, region: 'NA', servants: [] }, 'NA')).toThrow(/"users"/);
    expect(() => parseChaldeaBackup({ version: 4, users: [{ name: 'x' }] }, 'NA')).toThrow(/"users\[\]\.servants"/);
  });
});

describe('readChaldeaFile', () => {
  const gzip = async (s: string) =>
    new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const text = JSON.stringify(backup);

  it('reads plain JSON as is', async () => {
    expect(await readChaldeaFile(new Blob([text]))).toBe(text);
  });
  it('unpacks gzip and base64-gzip', async () => {
    const gz = await gzip(text);
    expect(await readChaldeaFile(new Blob([gz]))).toBe(text);
    const b64 = btoa(String.fromCharCode(...gz));
    expect(await readChaldeaFile(new Blob([b64]))).toBe(text);
  });
});
