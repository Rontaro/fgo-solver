import { DEFAULT_FORM, inForm, type FormName } from '../data/forms';
import { getSettings } from '../app/settings';
import type { CompactCE, CompactMC, CompactServant } from '../data/types';
import type { TeamMember } from '../engine/state';
import type { OwnedServant } from '../roster/types';
import type { Step } from '../solver/solve';
import type { RawQuest } from '../engine/quest';
import type { Messages } from '../i18n';

export const SUPPORT_POOL_CAP = 400;

const clampLv = (svt: CompactServant, lv: number) => Math.max(1, Math.min(lv, svt.atkGrowth.length));

export interface CeChoice { ce: CompactCE | null; lv: number; mlb: boolean }
const NO_CE: CeChoice = { ce: null, lv: 1, mlb: false };

export function ownedToMember(o: OwnedServant, svt0: CompactServant, key: string, ce: CeChoice = NO_CE, form?: FormName): TeamMember {
  // A servant with forms starts in the chosen form (default DEFAULT_FORM).
  const svt = svt0.forms ? inForm(svt0, form ?? DEFAULT_FORM) : svt0;
  return {
    svt, lv: clampLv(svt, o.lv), npLv: o.npLv, skillLv: o.skillLv,
    append2Lv: Math.min(o.append2Lv, svt.append2.length), fou: o.fou,
    ce: ce.ce, ceLv: ce.ce ? Math.min(ce.lv, ce.ce.atkGrowth.length) : 1, ceMlb: ce.mlb, key,
  };
}

/** A support at lv 90, NP1, skills 10/10/10, fou 1000. */
/** A friend support, with the stats of the Settings page (getSettings().support). */
export function supportMember(svt: CompactServant, key: string, ce: CeChoice = NO_CE, form?: FormName): TeamMember {
  const d = getSettings().support;
  const lv = Math.min(d.lv, svt.atkGrowth.length);
  return ownedToMember({ collectionNo: svt.collectionNo, lv, npLv: d.npLv, skillLv: [...d.skillLv], append2Lv: 0, fou: d.fou }, svt, key, ce, form);
}

export function defaultMc(mcs: CompactMC[]): CompactMC | undefined {
  return mcs.find((m) => m.name === 'Chaldea Combat Uniform') ?? mcs.find((m) => m.id === 20) ?? mcs[0];
}

/** One rendered step of a turn; unit keys refer to TeamMember.key. */
export type TurnItem =
  | { kind: 'skill'; unit: string | undefined; num: number; target?: string }
  | { kind: 'mc'; num: number; name?: string; target?: string }
  | { kind: 'swap'; out: string | undefined; inn: string | undefined }
  | { kind: 'np'; unit: string | undefined }
  /** The turn's enemy target: a field slot (0-based, FGA t1..t3), once per turn, before the NPs. */
  | { kind: 'target'; slot: number };

/** Steps per turn, resolving order changes to the units swapped. front/back are the starting unit keys. */
export function describeTurns(turns: Step[][], front: (string | null)[], back: (string | null)[], mc: CompactMC | undefined): TurnItem[][] {
  const f = front.slice(), b = back.slice();
  return turns.map((steps) => steps.flatMap((s): TurnItem[] => {
    // The engine records the turn's single enemy target on the turn's first NP step.
    if (s.kind === 'np') return s.targetIndex !== undefined
      ? [{ kind: 'target', slot: s.targetIndex }, { kind: 'np', unit: s.unit }] : [{ kind: 'np', unit: s.unit }];
    return [one(s)];
  }));
  function one(s: Step): TurnItem {
    if (s.kind === 'skill') return { kind: 'skill', unit: s.unit, num: s.num ?? 1, ...(s.target && { target: s.target }) };
    if (s.swap) {
      const [i, j] = s.swap;
      const out = f[i], inn = b[j];
      f[i] = inn; b[j] = out;
      return { kind: 'swap', out: out ?? undefined, inn: inn ?? undefined };
    }
    const name = (mc?.skills[(s.num ?? 1) - 1] as { name?: string } | undefined)?.name;
    return { kind: 'mc', num: s.num ?? 1, ...(name && { name }), ...(s.target && { target: s.target }) };
  }
}

/**
 * Enemy name in each field slot at the start of each wave (wave order): a
 * wave has enemyFieldPosCount slots (default 3) and the enemy with deckId d
 * starts in slot d - 1, as in the engine's layout. undefined = slot not
 * trivially known (empty at wave start, filled later by a reinforcement).
 */
export function slotEnemyNames(raw: RawQuest): (string | undefined)[][] {
  return [...raw.stages].sort((a, b) => a.wave - b.wave).map((st) => {
    const slots = st.enemyFieldPosCount ?? 3;
    const enemies = st.enemies.filter((e) => e.deck === 'enemy');
    return Array.from({ length: slots }, (_, i) => enemies.find((e) => e.deckId === i + 1)?.name);
  });
}

/** One line per turn, e.g. "T1: A S1 → B · MC 2 · NP A". front/back are the starting unit keys. */
export function formatTurns(turns: Step[][], front: (string | null)[], back: (string | null)[],
  name: (key: string | undefined) => string, mc: CompactMC | undefined, msg: Messages['turns']): string[] {
  return describeTurns(turns, front, back, mc).map((items, t) => `T${t + 1}: ` + items.map((s) => {
    const to = 'target' in s && s.target ? ` → ${name(s.target)}` : '';
    if (s.kind === 'np') return `NP ${name(s.unit)}`;
    if (s.kind === 'target') return msg.target(s.slot + 1);
    if (s.kind === 'skill') return `${name(s.unit)} S${s.num}${to}`;
    if (s.kind === 'swap') return `${msg.orderChange}: ${name(s.out)} ↔ ${name(s.inn)}`;
    return `${s.name ?? `MC ${s.num}`}${to}`;
  }).join(' · '));
}
