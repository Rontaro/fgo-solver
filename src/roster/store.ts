import { get, set } from 'idb-keyval';
import type { Friend, OwnedCE, OwnedServant, Region, RosterDoc, RosterStore } from './types';

export function emptyRoster(region: Region): RosterDoc {
  return { version: 1, region, servants: [], ces: [], mcs: [], friends: [], updatedAt: new Date(0).toISOString() };
}

const key = (region: Region) => `roster:${region}`;

export class IdbRosterStore implements RosterStore {
  private readonly clock: () => Date;
  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  async load(region: Region): Promise<RosterDoc> {
    const doc = await get<RosterDoc>(key(region));
    return doc ?? emptyRoster(region);
  }

  async save(doc: RosterDoc): Promise<RosterDoc> {
    const saved: RosterDoc = { ...doc, updatedAt: this.clock().toISOString() };
    await set(key(doc.region), saved);
    return saved;
  }
}

export class RosterValidationError extends Error {
  readonly path: string;
  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = 'RosterValidationError';
    this.path = path;
  }
}

export function exportJson(doc: RosterDoc): string {
  return JSON.stringify(doc, null, 2);
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new RosterValidationError(path, 'expected an object');
  }
  return v as Record<string, unknown>;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new RosterValidationError(path, 'expected an array');
  return v;
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new RosterValidationError(path, 'expected an integer');
  if (v < min || v > max) throw new RosterValidationError(path, `expected ${min}..${max}, got ${v}`);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new RosterValidationError(path, 'expected a string');
  return v;
}

const ID_MAX = Number.MAX_SAFE_INTEGER;

function parseServant(v: unknown, path: string): OwnedServant {
  const o = obj(v, path);
  const skills = arr(o.skillLv, `${path}.skillLv`);
  if (skills.length !== 3) throw new RosterValidationError(`${path}.skillLv`, 'expected 3 entries');
  const s: OwnedServant = {
    collectionNo: int(o.collectionNo, `${path}.collectionNo`, 1, ID_MAX),
    lv: int(o.lv, `${path}.lv`, 1, 120),
    npLv: int(o.npLv, `${path}.npLv`, 1, 5),
    skillLv: [
      int(skills[0], `${path}.skillLv[0]`, 1, 10),
      int(skills[1], `${path}.skillLv[1]`, 1, 10),
      int(skills[2], `${path}.skillLv[2]`, 1, 10),
    ],
    append2Lv: int(o.append2Lv, `${path}.append2Lv`, 0, 10),
    fou: int(o.fou, `${path}.fou`, 0, 2000),
  };
  if (o.defaultCe !== undefined) s.defaultCe = int(o.defaultCe, `${path}.defaultCe`, 1, ID_MAX);
  return s;
}

function parseCE(v: unknown, path: string): OwnedCE {
  const o = obj(v, path);
  const collectionNo = int(o.collectionNo, `${path}.collectionNo`, 1, ID_MAX);
  const lv = int(o.lv, `${path}.lv`, 1, 100);
  if (typeof o.mlb !== 'boolean') throw new RosterValidationError(`${path}.mlb`, 'expected a boolean');
  return { collectionNo, lv, mlb: o.mlb };
}

function parseFriend(v: unknown, path: string): Friend {
  const o = obj(v, path);
  const f: Friend = { name: str(o.name, `${path}.name`), servant: parseServant(o.servant, `${path}.servant`) };
  if (o.ce !== undefined) f.ce = parseCE(o.ce, `${path}.ce`);
  return f;
}

/** Parses and validates a roster JSON export for `region`; unknown fields are dropped. */
export function importJson(text: string, region: Region): RosterDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RosterValidationError('$', 'invalid JSON');
  }
  const o = obj(raw, '$');
  if (o.version !== 1) throw new RosterValidationError('version', 'expected 1');
  if (o.region !== 'NA' && o.region !== 'JP') throw new RosterValidationError('region', "expected 'NA' or 'JP'");
  if (o.region !== region) throw new RosterValidationError('region', `expected ${region}, got ${o.region}`);
  return {
    version: 1,
    region,
    servants: arr(o.servants, 'servants').map((s, i) => parseServant(s, `servants[${i}]`)),
    ces: arr(o.ces, 'ces').map((c, i) => parseCE(c, `ces[${i}]`)),
    mcs: arr(o.mcs, 'mcs').map((m, i) => {
      const mo = obj(m, `mcs[${i}]`);
      return { id: int(mo.id, `mcs[${i}].id`, 1, ID_MAX), lv: int(mo.lv, `mcs[${i}].lv`, 1, 10) };
    }),
    friends: arr(o.friends, 'friends').map((f, i) => parseFriend(f, `friends[${i}]`)),
    updatedAt: str(o.updatedAt, 'updatedAt'),
  };
}
