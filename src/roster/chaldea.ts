/*
 * Import from a Chaldea (chaldea.center) user-data backup.
 *
 * Format notes, worked out by reading the Chaldea source (AGPL; nothing copied,
 * only the field names and meanings are described here). Paths are relative to
 * github.com/chaldea-center/chaldea.
 *
 * File / encoding
 * - "Save As" and "Backup" (lib/app/modules/home/subpage/user_data_page.dart,
 *   lib/models/db.dart backupUserdata) write `jsonEncode(db.userData)`: a plain
 *   UTF-8 JSON file named `chaldea-userdata-<yyyyMMddTHHmmss>.json` (Save As) or
 *   `<timestamp>m-<appVer>.json` (Backup folder). Not zipped.
 * - The GitHub backup (github_backup_page.dart) is also plain JSON.
 * - Only the server backup (lib/models/api/api.dart UserBackupData) is
 *   base64(gzip(JSON)); it lives on Chaldea's server and is not a user file.
 *   readChaldeaFile() still accepts raw gzip or base64-gzip, just in case.
 *
 * Top level: UserData (lib/models/userdata/userdata.dart, serializer in
 * lib/generated/models/userdata/userdata.g.dart)
 *   { version: int (modelVersion, currently 4), appVer: string, curUserKey: int,
 *     users: User[], itemAbundantValue, svtAscensionIcon, preferAprilFoolIcon,
 *     customSvtIcon }
 *   Chaldea itself rejects a file without `version` (GitHub restore) or
 *   without `users` (backup history import). We require both.
 *
 * Accounts: `users[]`, each a User:
 *   { id: uuid string, name: string (user-chosen account label, default
 *     "Gudako"), isGirl, region: "jp"|"cn"|"tw"|"na"|"kr" (RegionConverter, lower
 *     case; missing = jp), servants: {<key>: SvtStatus}, dupServantMapping:
 *     {<dupKey>: originalCollectionNo}, plans: UserPlan[] (targets, ignored),
 *     craftEssences: {<collectionNo>: CraftStatus}, cmdCodes, mysticCodes:
 *     {<mcId>: lv}, items, summons, battleSim, ... }
 *   All map keys are JSON strings of ints.
 *
 * Servants: `servants` is keyed by collectionNo (gamedata `servantsWithDup` is
 *   keyed by collectionNo). Duplicate entries a user adds for the same servant
 *   use synthetic keys 10000000 + originalCollectionNo*100 + n, listed in
 *   dupServantMapping; we skip them (our roster has one entry per servant).
 *   SvtStatus = { cur: SvtPlan, priority, bond, equipCmdCodes, cmdCardStrengthen,
 *   grandSvt }. Current state is `cur`; `plans[].servants` are targets.
 *   SvtPlan fields (JSON names):
 *     favorite: bool        - for `cur`, true = owned
 *     ascension: int 0..4
 *     skills: int[3] 1..10
 *     appendSkills: int[5] 0..10 (index 1 = append 2, NP charge)
 *     costumes, bondLimit   - ignored
 *     grail: int 0..        - grails used
 *     npLv: int 1..5        - written from a getter that defaults to 1
 *     fouAtk3: int 0..20, x50 ATK (default 20 = 1000 when missing!)
 *     fouAtk:  int 0..50, x20 ATK above 1000 (JSON name of field fouAtk4)
 *     fouAtk5: int 0..10, x100 ATK above 2000
 *     (fouHp3 / fouHp / fouHp5: same for HP, ignored)
 *   Chaldea's ATK total: fouAtk5>0 -> 2000+100*fouAtk5; else fouAtk>0 ->
 *   1000+20*fouAtk; else 50*fouAtk3. (Its getFouAtk reads fouHp3 in the last
 *   branch, an upstream slip; we use fouAtk3.)
 *
 * Level: Chaldea stores no level. It shows `svt.grailedLv(grail)` = lvMax +
 *   svtGrailCost[rarity][grail].addLvMax (lib/models/gamedata/servant.dart),
 *   i.e. it assumes the servant is at its cap. We do the same: with grails, the
 *   grailed cap; without, the ascension cap lvMax - 10*(4-ascension).
 *   lvMax by rarity (0..5): 65, 60, 65, 70, 80, 90; addLvMax tables are the
 *   game's (Atlas NiceSvtGrailCost), reproduced below.
 *   // UNVERIFIED: Mash (collectionNo 1) and any servant whose lvMax differs
 *   // from its rarity's usual cap get the wrong level.
 *   // UNVERIFIED: ascension caps below the final one assumed to be 10 apart.
 *
 * CEs: `craftEssences` keyed by collectionNo, CraftStatus = { status: 0 not met
 *   | 1 met | 2 owned, lv: int, limitCount: 0..4 }. MLB = limitCount 4.
 *
 * Region: per account (`users[i].region`), see above.
 *
 * Personal data / secrets: userdata holds no tokens or passwords; those live
 *   in the separate settings file (lib/models/userdata/local_settings.dart,
 *   autologin.dart), which is not part of this backup. It does hold the account
 *   label (`name`), a random `id`, `isGirl`, `lastImportId`, summon/plan data.
 *   We read only `name` (shown locally in the account picker) and `region`;
 *   everything else is ignored and never stored.
 */
import { en } from '../i18n/en';
import type { Messages } from '../i18n';
import type { OwnedCE, OwnedServant, Region } from './types';

export interface ChaldeaAccount { index: number; name: string; region?: string; }

export interface ChaldeaImport {
  accounts: ChaldeaAccount[];
  servants: OwnedServant[];
  ces: OwnedCE[];
  warnings: string[];
}

export interface ChaldeaOptions {
  accountIndex?: number;
  /** Known servants for the region, with their rarity when known. Missing
   *  collectionNos are kept with a warning; without it nothing is checked. */
  servants?: ReadonlyMap<number, { rarity?: number }>;
  /** Known CE collectionNos for the region. */
  ces?: ReadonlySet<number>;
  /** Error and warning copy; English by default. */
  msg?: Messages['chaldea'];
}

const LV_MAX = [65, 60, 65, 70, 80, 90];
// addLvMax per grail count (index 0 = 1 grail), by rarity.
const step = (first: number[], from: number, n: number) => [...first, ...Array.from({ length: n }, (_, i) => from + 2 * (i + 1))];
const GRAIL_ADD = [
  step([5, 10, 15, 20, 25], 25, 15),
  step([10, 15, 20, 25, 30], 30, 15),
  step([5, 10, 15, 20, 25], 25, 15),
  step([5, 10, 15, 20], 20, 15),
  step([5, 10], 10, 15),
  step([], 0, 15),
];

/** Level a Chaldea servant is shown at: the cap for its ascension and grails. */
export function chaldeaLevel(rarity: number, ascension: number, grails: number): number {
  const lvMax = LV_MAX[rarity] ?? 90;
  if (grails <= 0) return lvMax - 10 * (4 - ascension);
  const add = GRAIL_ADD[rarity] ?? GRAIL_ADD[5];
  return lvMax + add[Math.min(grails, add.length) - 1];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : dflt);

/** Reads a backup file as text, unpacking gzip or base64-gzip if needed. */
export async function readChaldeaFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const gunzip = async (b: Uint8Array) =>
    new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzip(bytes);
  const text = new TextDecoder().decode(bytes).trim();
  if (text.startsWith('H4sI')) {
    return gunzip(Uint8Array.from(atob(text.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
  }
  return text;
}

export function parseChaldeaBackup(input: unknown, region: Region, opts: ChaldeaOptions = {}): ChaldeaImport {
  const msg = opts.msg ?? en.chaldea;
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error(msg.invalidJson); }
  }
  if (!isRecord(data)) throw new Error(msg.noRoot);
  if (typeof data.version !== 'number') throw new Error(msg.missingField('version'));
  if (!Array.isArray(data.users)) throw new Error(msg.missingField('users'));
  const users = data.users;

  const accounts: ChaldeaAccount[] = users.map((u, index) => {
    const r = isRecord(u) ? u : {};
    const acc: ChaldeaAccount = { index, name: typeof r.name === 'string' && r.name ? r.name : `Account ${index + 1}` };
    if (typeof r.region === 'string') acc.region = r.region.toLowerCase();
    return acc;
  });

  let index = opts.accountIndex;
  if (index === undefined) {
    if (users.length !== 1) return { accounts, servants: [], ces: [], warnings: [] };
    index = 0;
  }
  const user = users[index];
  if (!isRecord(user)) throw new Error(msg.accountNotFound(index));
  if (!isRecord(user.servants)) throw new Error(msg.missingField('users[].servants'));

  const warnings: string[] = [];
  const accRegion = accounts[index].region ?? 'jp';
  if (accRegion !== region.toLowerCase()) {
    warnings.push(msg.regionMismatch(accounts[index].name, accRegion.toUpperCase(), region));
  }

  const clamp = (v: number, min: number, max: number, what: string) => {
    if (v >= min && v <= max) return v;
    const c = Math.min(max, Math.max(min, v));
    warnings.push(msg.clamped(what, v, min, max, c));
    return c;
  };

  const servants: OwnedServant[] = [];
  const dupKeys = new Set(Object.keys(isRecord(user.dupServantMapping) ? user.dupServantMapping : {}));
  let dups = 0;
  for (const [key, status] of Object.entries(user.servants)) {
    const cur = isRecord(status) && isRecord(status.cur) ? status.cur : null;
    if (!cur || cur.favorite !== true) continue;
    const no = Number(key);
    if (!Number.isInteger(no) || no < 1) continue;
    if (dupKeys.has(key) || no >= 10000000) { dups++; continue; }

    const info = opts.servants?.get(no);
    const label = `Servant #${no}`;
    if (opts.servants && !info) warnings.push(msg.notInData(label, region));
    let rarity = info?.rarity;
    if (rarity === undefined) {
      rarity = 5;
      if (info || !opts.servants) warnings.push(msg.unknownRarity(label));
    }

    const ascension = Math.min(4, Math.max(0, num(cur.ascension, 0)));
    const grail = Math.max(0, num(cur.grail, 0));
    const skills = Array.isArray(cur.skills) ? cur.skills : [];
    const appends = Array.isArray(cur.appendSkills) ? cur.appendSkills : [];
    const fouAtk5 = num(cur.fouAtk5, 0), fouAtk4 = num(cur.fouAtk, 0), fouAtk3 = num(cur.fouAtk3, 20);
    const fou = fouAtk5 > 0 ? 2000 + 100 * fouAtk5 : fouAtk4 > 0 ? 1000 + 20 * fouAtk4 : 50 * fouAtk3;

    servants.push({
      collectionNo: no,
      lv: clamp(chaldeaLevel(rarity, ascension, grail), 1, 120, msg.level(label)),
      npLv: clamp(num(cur.npLv, 1), 1, 5, `${label} NP`),
      skillLv: [0, 1, 2].map((i) => clamp(num(skills[i], 1), 1, 10, `${label} skill ${i + 1}`)) as OwnedServant['skillLv'],
      append2Lv: clamp(num(appends[1], 0), 0, 10, `${label} append 2`),
      fou: clamp(fou, 0, 2000, `${label} Fou ATK`),
    });
  }
  if (dups) warnings.push(msg.dups(dups));

  const ces: OwnedCE[] = [];
  for (const [key, st] of Object.entries(isRecord(user.craftEssences) ? user.craftEssences : {})) {
    if (!isRecord(st) || st.status !== 2) continue;
    const no = Number(key);
    if (!Number.isInteger(no) || no < 1) continue;
    const label = `CE #${no}`;
    if (opts.ces && !opts.ces.has(no)) warnings.push(msg.notInData(label, region));
    ces.push({
      collectionNo: no,
      lv: clamp(num(st.lv, 1), 1, 100, msg.level(label)),
      mlb: num(st.limitCount, 0) >= 4,
    });
  }

  servants.sort((a, b) => a.collectionNo - b.collectionNo);
  ces.sort((a, b) => a.collectionNo - b.collectionNo);
  return { accounts, servants, ces, warnings };
}
