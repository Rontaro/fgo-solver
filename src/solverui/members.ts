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

/** One line per turn, e.g. "T1: A S1 → B · MC 2 · NP A". front/back are the starting unit keys. */
export function formatTurns(turns: Step[][], front: (string | null)[], back: (string | null)[],
  name: (key: string | undefined) => string, mc: CompactMC | undefined): string[] {
  const f = front.slice(), b = back.slice();
  return turns.map((steps, t) => `T${t + 1}: ` + steps.map((s) => {
    const to = s.target ? ` → ${name(s.target)}` : '';
    if (s.kind === 'np') return `NP ${name(s.unit)}`;
    if (s.kind === 'skill') return `${name(s.unit)} S${s.num}${to}`;
    if (s.swap) {
      const [i, j] = s.swap;
      const out = f[i], inn = b[j];
      f[i] = inn; b[j] = out;
      return `Order change: ${name(out ?? undefined)} ↔ ${name(inn ?? undefined)}`;
    }
    const skillName = (mc?.skills[(s.num ?? 1) - 1] as { name?: string } | undefined)?.name;
    return `${skillName ?? `MC ${s.num}`}${to}`;
  }).join(' · '));
}
