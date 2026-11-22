/** JSON export / import of saved teams and results (light validation: malformed entries are dropped). */
import type { SavedResult, SavedTeam } from './store';

export function download(name: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v);

function list(text: string): unknown[] {
  const v: unknown = JSON.parse(text);
  if (!Array.isArray(v)) throw new Error('expected a JSON array');
  return v;
}

const okSlot = (s: unknown) => isObj(s) && typeof s.kind === 'string' && (s.collectionNo === null || isInt(s.collectionNo))
  && (s.ceNo === null || isInt(s.ceNo)) && isInt(s.ceLv) && typeof s.ceMlb === 'boolean';

export function parseTeams(text: string): SavedTeam[] {
  return list(text).filter((x): x is SavedTeam => isObj(x) && typeof x.name === 'string' && typeof x.createdAt === 'string'
    && Array.isArray(x.slots) && x.slots.length === 6 && x.slots.every(okSlot) && (x.mcId === null || isInt(x.mcId)));
}

const okMember = (m: unknown) => isObj(m) && typeof m.key === 'string' && isInt(m.collectionNo) && isInt(m.lv) && isInt(m.npLv)
  && Array.isArray(m.skillLv) && m.skillLv.length === 3 && isInt(m.append2Lv) && isInt(m.fou)
  && (m.ceNo === null || isInt(m.ceNo)) && isInt(m.ceLv) && typeof m.ceMlb === 'boolean' && typeof m.support === 'boolean';

export function parseResults(text: string): SavedResult[] {
  return list(text).filter((x): x is SavedResult => isObj(x) && typeof x.name === 'string' && typeof x.createdAt === 'string'
    && isObj(x.quest) && isInt(x.quest.id) && isInt(x.quest.phase) && typeof x.quest.label === 'string'
    && Array.isArray(x.members) && x.members.every(okMember) && Array.isArray(x.front) && Array.isArray(x.back)
    && isInt(x.mcId) && (x.kind === 'solution' || x.kind === 'closest') && Array.isArray(x.turns) && x.turns.every(Array.isArray)
    && isInt(x.actions) && typeof x.usesSwap === 'boolean' && typeof x.dataVersion === 'string');
}
