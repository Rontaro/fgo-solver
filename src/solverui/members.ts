import type { CompactCE, CompactMC, CompactServant } from '../data/types';
import type { TeamMember } from '../engine/state';
import type { OwnedServant } from '../roster/types';
import type { Step } from '../solver/solve';

export const SUPPORT_POOL_CAP = 400;

const clampLv = (svt: CompactServant, lv: number) => Math.max(1, Math.min(lv, svt.atkGrowth.length));

export interface CeChoice { ce: CompactCE | null; lv: number; mlb: boolean }
const NO_CE: CeChoice = { ce: null, lv: 1, mlb: false };

export function ownedToMember(o: OwnedServant, svt: CompactServant, key: string, ce: CeChoice = NO_CE): TeamMember {
  return {
    svt, lv: clampLv(svt, o.lv), npLv: o.npLv, skillLv: o.skillLv,
    append2Lv: Math.min(o.append2Lv, svt.append2.length), fou: o.fou,
    ce: ce.ce, ceLv: ce.ce ? Math.min(ce.lv, ce.ce.atkGrowth.length) : 1, ceMlb: ce.mlb, key,
  };
}

/** A support at lv 90, NP1, skills 10/10/10, fou 1000. */
export function supportMember(svt: CompactServant, key: string, ce: CeChoice = NO_CE): TeamMember {
  return ownedToMember({ collectionNo: svt.collectionNo, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 1000 }, svt, key, ce);
}

export function defaultMc(mcs: CompactMC[]): CompactMC | undefined {
  return mcs.find((m) => m.name === 'Chaldea Combat Uniform') ?? mcs.find((m) => m.id === 20) ?? mcs[0];
}

/** One rendered step of a turn; unit keys refer to TeamMember.key. */
export type TurnItem =
  | { kind: 'skill'; unit: string | undefined; num: number; target?: string }
  | { kind: 'mc'; num: number; name?: string; target?: string }
  | { kind: 'swap'; out: string | undefined; inn: string | undefined }
  | { kind: 'np'; unit: string | undefined; targetIndex?: number };

/** Steps per turn, resolving order changes to the units swapped. front/back are the starting unit keys. */
export function describeTurns(turns: Step[][], front: (string | null)[], back: (string | null)[], mc: CompactMC | undefined): TurnItem[][] {
  const f = front.slice(), b = back.slice();
  return turns.map((steps) => steps.map((s): TurnItem => {
    if (s.kind === 'np') return { kind: 'np', unit: s.unit, ...(s.targetIndex !== undefined && { targetIndex: s.targetIndex }) };
    if (s.kind === 'skill') return { kind: 'skill', unit: s.unit, num: s.num ?? 1, ...(s.target && { target: s.target }) };
    if (s.swap) {
      const [i, j] = s.swap;
      const out = f[i], inn = b[j];
      f[i] = inn; b[j] = out;
      return { kind: 'swap', out: out ?? undefined, inn: inn ?? undefined };
    }
    const name = (mc?.skills[(s.num ?? 1) - 1] as { name?: string } | undefined)?.name;
    return { kind: 'mc', num: s.num ?? 1, ...(name && { name }), ...(s.target && { target: s.target }) };
  }));
}

/** One line per turn, e.g. "T1: A S1 → B · MC 2 · NP A". front/back are the starting unit keys. */
export function formatTurns(turns: Step[][], front: (string | null)[], back: (string | null)[],
  name: (key: string | undefined) => string, mc: CompactMC | undefined): string[] {
  return describeTurns(turns, front, back, mc).map((items, t) => `T${t + 1}: ` + items.map((s) => {
    const to = 'target' in s && s.target ? ` → ${name(s.target)}` : '';
    if (s.kind === 'np') return `NP ${name(s.unit)}`;
    if (s.kind === 'skill') return `${name(s.unit)} S${s.num}${to}`;
    if (s.kind === 'swap') return `Order change: ${name(s.out)} ↔ ${name(s.inn)}`;
    return `${s.name ?? `MC ${s.num}`}${to}`;
  }).join(' · '));
}
