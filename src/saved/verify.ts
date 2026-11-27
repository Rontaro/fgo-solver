/**
 * Rebuilding the team of a saved result from the current game data, and
 * replaying its steps on the current engine (the data or the engine may have
 * changed since it was saved).
 */
import { formOf } from '../data/forms';
import type { RegionData } from '../data/load';
import type { Region } from '../data/types';
import { questFromAtlas } from '../engine/quest';
import type { TeamMember } from '../engine/state';
import { shortfall, simulate } from '../solver/solve';
import { ownedToMember } from '../solverui/members';
import { fetchQuest } from '../solverui/QuestPicker';
import type { SavedMember, SavedResult } from './store';

/** Version string of a data set, as stored in SavedResult.dataVersion. */
export const dataVersionOf = (d: RegionData) => `${d.version.hash}-${d.version.build ?? ''}`;

/** The members of a saved result rebuilt from the current data; null when a servant or CE no longer exists. */
export function membersOf(r: Pick<SavedResult, 'members'>, data: RegionData): TeamMember[] | null {
  const out: TeamMember[] = [];
  for (const m of r.members) {
    const svt = data.servants.get(m.collectionNo);
    const ce = m.ceNo === null ? null : data.ces.find((c) => c.collectionNo === m.ceNo) ?? null;
    if (!svt || (m.ceNo !== null && !ce)) return null;
    out.push(ownedToMember({ collectionNo: m.collectionNo, lv: m.lv, npLv: m.npLv, skillLv: m.skillLv, append2Lv: m.append2Lv, fou: m.fou },
      svt, m.key, { ce, lv: m.ceLv, mlb: m.ceMlb }, m.form));
  }
  return out;
}

/** A TeamMember as a SavedMember. */
export function toSavedMember(m: TeamMember, support: boolean): SavedMember {
  return {
    key: m.key, collectionNo: m.svt.collectionNo, lv: m.lv, npLv: m.npLv, skillLv: [...m.skillLv] as [number, number, number],
    append2Lv: m.append2Lv, fou: m.fou, ceNo: m.ce?.collectionNo ?? null, ceLv: m.ceLv, ceMlb: m.ceMlb, support,
    ...(m.svt.forms && { form: formOf(m.svt) }),
  };
}

export type Verdict =
  | { ok: true; margins?: number[]; missingPct?: number }
  | { ok: false; reason: string };

/**
 * Replays a saved result on the current data and engine: a solution must
 * still clear every wave; a closest line must still reach the last wave
 * (its HP left is reported, it may have changed).
 */
export async function verifyResult(r: SavedResult, data: RegionData, region: Region): Promise<Verdict> {
  const team = membersOf(r, data);
  if (!team) return { ok: false, reason: 'missing servant or CE' };
  const mc = data.mcs.find((m) => m.id === r.mcId);
  if (!mc) return { ok: false, reason: 'missing Mystic Code' };
  const ordered = [...r.front, ...r.back].map((k) => team.find((m) => m.key === k)).filter((m): m is TeamMember => !!m);
  let quest;
  try {
    const raw = await fetchQuest(region, r.quest.id, r.quest.phase);
    quest = questFromAtlas(r.quest.eventId ? { ...raw, eventId: r.quest.eventId } : raw);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (r.kind === 'solution') {
    const sim = simulate(ordered, mc, 10, quest, data.constants, r.turns);
    return sim.ok ? { ok: true, margins: sim.margins } : { ok: false, reason: sim.reason };
  }
  const m = shortfall(ordered, mc, 10, quest, data.constants, r.turns);
  return m === null ? { ok: false, reason: 'the line no longer reaches the last wave' } : { ok: true, missingPct: m };
}
