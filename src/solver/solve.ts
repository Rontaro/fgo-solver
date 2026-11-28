import type { Card, CompactMC, Constants, Effect } from '../data/types';
import { inForm } from '../data/forms';
import { STATUS_TRAITS } from '../data/status';
// The engine's useSkill / useMc are imported as castSkill / castMc: they are not
// React hooks, and the lint rule goes by the name.
import { initBattle, useSkill as castSkill, useMc as castMc, endTurn, nextWave, livingSlots, isEnemyDebuff, soleTarget, canNp, canSkill, isHarmful, type BattleState, type Buff, type Enemy, type Quest, type TeamMember, type Unit } from '../engine/state';
import { fireNp } from '../engine/np';
import { damageBound, type BoundCtx } from './bound';

/*
 * Depth-first 3T solver: turn t clears wave t with NPs.
 *
 * Per turn, a use/skip recursion runs over a fixed canonical move list
 * (front slot 0..2 x skill 1..3, then the MC skills other than order change),
 * so a set of skills is tried once, never as permutations. At the end of the
 * list the NPs fire: every ordered sequence of up to 3 distinct charged front
 * units, stopping as soon as the wave dies. Single-target NPs hit the turn's
 * target (one per turn, chosen before the NPs; see fireSeq for the choices
 * tried). Reinforcements enter after each NP (fireNp), so a
 * wave with a reserve needs several NPs in the turn; the wave dies when field
 * and reserve are empty.
 *
 * Order change (once per battle, enforced by the engine): a turn either does
 * not swap, or swaps front slot f with back slot b. A swapping turn first runs
 * the use/skip recursion over the outgoing unit's own skills, then the swap,
 * then the normal recursion over the whole list (the incoming unit included).
 * Any other skill is used after the swap: its effect on the units that stay is
 * the same, it reaches the incoming unit instead of the outgoing one, and the
 * outgoing unit never comes back, so its later state does not matter. Using it
 * before the swap is dominated.
 *
 * Last turn: every immediate modelled effect but orderChange and demerits
 * (isHarmful: an immediate NP loss, a seal / stun, a negative value) can only
 * help (buffs, NP charge and skill cooldown cuts on allies; a deferred lossNp
 * runs at a turn end, which the last turn never reaches), so every relevant
 * skill without a demerit is used, with no skip branch; one with a demerit
 * keeps its skip branch (Option.optional).
 * Skills marked lastTurnOnly are refused by the engine on earlier turns.
 *
 * Relevance (moves that cannot matter are not tried): an effect with value 0 at
 * its level, an enemy-side effect, a buff or charge that only lands on units
 * without a damaging NP, a card buff for another card than the holder's NP, a
 * "vs trait" buff when no enemy left has the trait, npGainUp on a buster NP
 * (buster gives no NP), an NP drain (lossNp), a deferred effect that would
 * only run after the last turn's NPs and, on the last turn, shortenSkill and
 * npGainUp.
 *
 * Memo: (canonical state, position) -> explored (identical builds are
 * interchangeable, see buildOf). The subtree under a node
 * depends on nothing else, so revisits are skipped. The hash drops what can no
 * longer matter: gauge and buffs of units without a damaging NP, buffs that can
 * no longer change an NP (see relevance), buff turns and cooldowns beyond the
 * end of the quest (cooldowns only when nothing in the team shortens them),
 * and the state of a unit that was swapped out.
 *
 * Prunes (all keep at least one line as good as the one cut; prune: false
 * turns them off for tests, which check the best action count is unchanged):
 * - damage bound (bound.ts) at each turn start and after a swap: some wave is
 *   out of reach even with every remaining buff -> cut, Partial recorded;
 * - gauge bound in the move recursion: no front shooter can reach 100% with
 *   the charge left in the list -> cut (moves with charge come first);
 * - delay dominance on non-last turns (delayDominated, swapDelayed,
 *   wastedCharge): a step that did not change this turn's NPs is better used
 *   next turn, and that line is explored.
 *
 * Solutions: the line found is replayed, its last turn reduced to the exact
 * smallest set of steps (exactLastTurn), then the rest greedily (minimize).
 * Earlier turns need no exact step: their use/skip choices are all explored.
 *
 * Known gaps (a combo may be missed, never reported wrongly): a skill made
 * ready again within the same turn by a shortenSkill is not reused that turn;
 * at most 3 NPs per turn; the NP-chain overcharge bonus is not modelled; two
 * shorten skills in one turn run in list order (see orderFor); on a solution-
 * rich last turn only LINES_PER_START lines per start become solutions, and
 * exactLastTurn falls back to the greedy result past EXACT_CAP evaluations.
 */

export interface Step {
  kind: 'skill' | 'mc' | 'np';
  unit?: string;
  /** Servant skill num (1..3) or MC skill number (1-based: mc.skills[num - 1]). */
  num?: number;
  target?: string;
  swap?: [number, number];
  /**
   * NP steps: the turn's enemy target, a field slot at the start of the NPs.
   * Only on the turn's first NP step (one target per turn, as in the game);
   * single-target NPs hit it while it lives, then the auto target.
   */
  targetIndex?: number;
}
export interface Solution { turns: Step[][]; margins: number[]; actions: number; usesSwap: boolean; }
/** wave and turn are 1-based. */
export interface Partial { wave: number; turn: number; reason: string; missingDamagePct?: number; gaugeShort?: number; }
export interface SolveOptions {
  maxMs: number;
  onSolution?: (s: Solution) => void;
  cancel?: { cancelled: boolean };
  maxSolutions?: number;
  /** Memo entries kept before the memo is cleared (default 2M). */
  memoCap?: number;
  /** Testing only: false turns off the bounds and dominance prunes (the memo stays). */
  prune?: boolean;
}
export interface SolveStats {
  nodes: number; memoHits: number; memoSize: number; npFires: number; boundPrunes: number; delayPrunes: number; rawSolutions: number;
  /** Solutions dropped because they did not replay (should stay 0). */
  replayFailures: number;
  /** Last-turn lines not minimised: LINES_PER_START reached for their start. */
  skippedLines: number; ms: number;
}
/**
 * The explored line that came closest to clearing the last wave in time
 * (every NP of the last turn fired, enemies still standing): its steps and the
 * largest share of an enemy's HP left. Not a solution: face cards after the NP
 * may finish the job, but nothing guarantees it.
 */
export interface NearMiss { turns: Step[][]; missingPct: number; }
export interface SolveResult {
  solutions: Solution[]; best: Partial | null; exhausted: boolean; stats: SolveStats;
  /** Only when there is no solution, filled by findClosest (solve itself leaves it null): see NearMiss. */
  closest: NearMiss | null;
}

const MAX_NP_PER_TURN = 3;
const CHECK_EVERY = 256;
/** Max skill subsets tried per solution by exactLastTurn. */
const EXACT_CAP = 4000;
/** Last-turn lines turned into solutions per last-turn start and swap choice (see found). */
const LINES_PER_START = 4;

// --- replay --------------------------------------------------------------

/** Per-turn margin: min over enemies of damage dealt this turn / wave HP (1 = exact kill). */
function waveMargin(s: BattleState, wave: readonly Enemy[]): number {
  let m = Infinity;
  s.enemies.forEach((e, i) => { m = Math.min(m, (wave[i].hp - e.hp) / wave[i].hp); });
  return m;
}
/** Largest share of wave HP still standing (0 when the wave is dead). */
function missingShare(s: BattleState, wave: readonly Enemy[]): number {
  let m = 0;
  s.enemies.forEach((e, i) => { m = Math.max(m, Math.max(0, e.hp) / wave[i].hp); });
  return m;
}
const allDead = (s: BattleState) => s.enemies.every((e) => e.hp <= 0);

function applyStep(s: BattleState, st: Step, mc: CompactMC, mcLv: number): BattleState {
  if (st.kind === 'skill') return castSkill(s, st.unit!, st.num as 1 | 2 | 3, st.target);
  if (st.kind === 'mc') return castMc(s, st.num! - 1, mc, mcLv, st.target, st.swap);
  if (allDead(s)) throw new Error('NP fired at a dead wave');
  return fireNp(s, st.unit!, st.targetIndex).state;
}

/**
 * Why a step cannot run here (the common cases, checked without letting the
 * engine throw: exceptions are slow and minimisation hits these often), or null.
 */
function blocker(s: BattleState, st: Step): string | null {
  const onFront = (k: string | undefined) => k === undefined || s.front.some((u) => u?.key === k);
  if (st.kind === 'mc') {
    if ((s.mcCd[st.num! - 1] ?? 1) > 0) return `MC skill ${st.num} not ready`;
    if (st.swap && (s.swapped || !s.front[st.swap[0]] || !s.back[st.swap[1]])) return 'order change not possible';
    return onFront(st.target) ? null : `${st.target} is not on the front line`;
  }
  const u = s.front.find((x) => x?.key === st.unit);
  if (!u) return `${st.unit} is not on the front line`;
  if (st.kind === 'skill') {
    if (u.cd[st.num! - 1] > 0) return `${st.unit} skill ${st.num} on cooldown`;
    if (!canSkill(u)) return `${st.unit} skills sealed`;
    return onFront(st.target) ? null : `${st.target} is not on the front line`;
  }
  if (u.gauge < 10000) return `${st.unit} NP gauge below 100%`;
  if (!canNp(u)) return `${st.unit} NP sealed`;
  return allDead(s) ? 'NP fired at a dead wave' : null;
}
/** applyStep, or null when the step cannot run. */
function tryStep(s: BattleState, st: Step, mc: CompactMC, mcLv: number): BattleState | null {
  if (blocker(s, st)) return null;
  try { return applyStep(s, st, mc, mcLv); } catch { return null; }
}

export type Simulation = { ok: true; margins: number[] } | { ok: false; reason: string };

/** Re-runs a solution through the engine; ok when every turn clears its wave. */
export function simulate(team: readonly TeamMember[], mc: CompactMC, mcLv: number, quest: Quest, constants: Constants,
  turns: readonly (readonly Step[])[]): Simulation {
  if (turns.length !== quest.waves.length) return { ok: false, reason: `${turns.length} turns for ${quest.waves.length} waves` };
  try {
    let s = initBattle(team, mc, mcLv, quest, constants);
    const margins: number[] = [];
    for (let t = 0; t < turns.length; t++) {
      for (const st of turns[t]) {
        const why = blocker(s, st);
        if (why) return { ok: false, reason: why };
        s = applyStep(s, st, mc, mcLv);
      }
      if (!allDead(s)) return { ok: false, reason: `wave ${t + 1} not cleared` };
      margins.push(waveMargin(s, quest.waves[t]));
      if (t < turns.length - 1) s = nextWave(endTurn(s), quest, constants);
    }
    return { ok: true, margins };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/**
 * Replays a line that should clear every wave but the last, and returns the
 * largest share of an enemy's HP left on the last wave after it (0 = cleared),
 * or null when the line breaks earlier.
 */
export function shortfall(team: readonly TeamMember[], mc: CompactMC, mcLv: number, quest: Quest, constants: Constants,
  turns: readonly (readonly Step[])[]): number | null {
  if (turns.length !== quest.waves.length) return null;
  try {
    let s = initBattle(team, mc, mcLv, quest, constants);
    for (let t = 0; t < turns.length; t++) {
      for (const st of turns[t]) {
        if (blocker(s, st)) return null;
        if (st.kind === 'np' && allDead(s)) return null;
        s = applyStep(s, st, mc, mcLv);
      }
      if (t === turns.length - 1) return allDead(s) ? 0 : missingShare(s, quest.waves[t]);
      if (!allDead(s)) return null;
      s = nextWave(endTurn(s), quest, constants);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The closest line when there is no 3T (see NearMiss): the bounds prune every
 * line that cannot clear, so the solver never walks the near misses. Instead,
 * search the quest again with the last wave's HP cut by `relax` (10%: lines
 * at most 10% short), then replay what it finds on the real quest and keep
 * the line that leaves the least HP. null when nothing comes that close.
 */
export function findClosest(team: readonly TeamMember[], mc: CompactMC, mcLv: number, quest: Quest, constants: Constants,
  opts: { maxMs: number; cancel?: { cancelled: boolean }; relax?: number; maxLines?: number }): NearMiss | null {
  const last = quest.waves.length - 1;
  const keep = 1 - (opts.relax ?? 0.1);
  const soft: Quest = {
    ...quest,
    waves: quest.waves.map((w, i) => (i === last ? w.map((e) => ({ ...e, hp: Math.max(1, Math.ceil(e.hp * keep)) })) : w)),
  };
  const r = solve(team, mc, mcLv, soft, constants, { maxMs: opts.maxMs, cancel: opts.cancel, maxSolutions: opts.maxLines ?? 20 });
  let out: NearMiss | null = null;
  for (const sol of r.solutions) {
    const m = shortfall(team, mc, mcLv, quest, constants, sol.turns);
    if (m !== null && m > 0 && (!out || m < out.missingPct)) out = { turns: sol.turns, missingPct: m };
  }
  return out;
}

/** Like simulate, but throws unless the solution clears every wave. Returns the margins. */
export function replay(team: readonly TeamMember[], mc: CompactMC, mcLv: number, quest: Quest, constants: Constants,
  solution: Pick<Solution, 'turns'>): number[] {
  const r = simulate(team, mc, mcLv, quest, constants, solution.turns);
  if (!r.ok) throw new Error(`replay failed: ${r.reason}`);
  return r.margins;
}

// --- solver --------------------------------------------------------------

type Move = { kind: 'skill'; slot: number; num: 1 | 2 | 3 } | { kind: 'mc'; index: number };
/** optional: the move has a demerit (isHarmful), so it is never forced (see branch). */
interface Option { state: BattleState; step: Step; optional?: boolean; }

const minOf = (a: readonly number[]) => a.reduce((x, y) => Math.min(x, y), Infinity);

export function compareSolutions(a: Solution, b: Solution): number {
  return a.actions - b.actions || Number(a.usesSwap) - Number(b.usesSwap) || minOf(b.margins) - minOf(a.margins);
}

/** True when p got further than q: later wave, then damage short over gauge short, then the smaller shortfall. */
function further(p: Partial, q: Partial | null): boolean {
  if (!q) return true;
  if (p.wave !== q.wave) return p.wave > q.wave;
  const pd = p.missingDamagePct !== undefined, qd = q.missingDamagePct !== undefined;
  if (pd !== qd) return pd;
  return pd ? p.missingDamagePct! < q.missingDamagePct! : p.gaugeShort! < q.gaugeShort!;
}

export function solve(team: readonly TeamMember[], mc: CompactMC, mcLv: number, quest: Quest, constants: Constants,
  opts: SolveOptions): SolveResult {
  const t0 = performance.now();
  const deadline = t0 + opts.maxMs;
  const memoCap = opts.memoCap ?? 2_000_000;
  const prune = opts.prune ?? true;
  const lastWave = quest.waves.length - 1;
  const mcIdx = mcLv - 1;
  const stats: SolveStats = { nodes: 0, memoHits: 0, memoSize: 0, npFires: 0, boundPrunes: 0, delayPrunes: 0, rawSolutions: 0, replayFailures: 0, skippedLines: 0, ms: 0 };
  const solutions: Solution[] = [];
  const seen = new Set<string>();
  const linesPerStart = new Map<string, number>();
  let best: Partial | null = null;
  let stop = false;
  let exhausted = true;

  const moves: Move[] = [];
  for (let slot = 0; slot < 3; slot++) for (const num of [1, 2, 3] as const) moves.push({ kind: 'skill', slot, num });
  // MC skills with an order change are not in the list: turnNode handles them.
  const swapMcs: number[] = [];
  mc.skills.forEach((k, index) => {
    if (k.effects.some((e) => e.kind === 'orderChange')) swapMcs.push(index);
    else moves.push({ kind: 'mc', index });
  });

  /**
   * Move order for a front line: moves with NP charge first (then list order),
   * so the gauge bound in moveNode cuts a line as soon as it skipped too much
   * charge; moves with shortenSkill last of all. The engine sets a skill's
   * cooldown when it is used, so a shorten applied before another skill of the
   * same turn would be wasted on it. Residual gap: between two shorten moves
   * the list order still decides, so the first one used does not cut the
   * cooldown of the second. A function of the slot-ordered front, hence of the
   * exact hash.
   */
  const orders = new Map<string, Move[]>();
  const effectsOf = (s: BattleState, m: Move): readonly Effect[] =>
    m.kind === 'mc' ? mc.skills[m.index].effects : s.front[m.slot]?.svt.skills.find((k) => k.num === m.num)?.effects ?? [];
  const has = (s: BattleState, m: Move, kind: Effect['kind']) => effectsOf(s, m).some((e) => e.kind === kind);
  const orderFor = (s: BattleState): Move[] => {
    const key = s.front.map((u) => u?.key ?? '-').join('/');
    let o = orders.get(key);
    if (!o) {
      const plain = moves.filter((m) => !has(s, m, 'shortenSkill'));
      o = [
        ...plain.filter((m) => has(s, m, 'gainNp')), ...plain.filter((m) => !has(s, m, 'gainNp')),
        ...moves.filter((m) => has(s, m, 'shortenSkill')),
      ];
      orders.set(key, o);
    }
    return o;
  };

  // --- canonical state hash (interned ids keep keys short) ---------------
  const ids = new Map<string, number>();
  const intern = (s: string) => { let i = ids.get(s); if (i === undefined) ids.set(s, i = ids.size); return i; };
  // Units are hashed by build, not key, and the front and back lines as sorted
  // multisets: two copies of the same servant (own + support Castoria) in
  // swapped places give isomorphic subtrees (skill effects commute, every NP
  // order and target is tried), so one is enough.
  const objIds = new Map<object, number>();
  const objId = (o: object | null) => { if (!o) return -1; let i = objIds.get(o); if (i === undefined) objIds.set(o, i = objIds.size); return i; };
  const buildOf = new Map(team.map((m) => [m.key, intern(JSON.stringify([
    objId(m.svt), m.lv, m.npLv, m.skillLv, m.append2Lv, m.fou, objId(m.ce), m.ceLv, m.ceMlb,
  ]))]));
  // Waves left including the current one: a buff lasting longer, or a cooldown
  // that ends later, is the same as one that never ends.
  const left = (wave: number) => quest.waves.length - wave;
  // Cooldowns can only be capped when nothing in the team cuts them.
  const hasShorten = [mc.skills.flatMap((k) => k.effects), ...team.map((m) => [
    ...m.svt.skills.flatMap((k) => k.effects), ...(m.svt.np?.extra ?? []),
  ])].some((es) => es.some((e) => e.kind === 'shortenSkill'));
  const boundCtx: BoundCtx = {
    quest, constants, mc, mcLv, swapMcs, hasShorten,
    // Every MC skill is a buff source, the order-change ones included: their
    // orderChange effect is not a damage kind and is ignored, and any buff
    // they also carry counts.
    mcSources: mc.skills.map((_, i) => i),
  };
  // Some NP gives NP charge to other units (see wastedCharge).
  const partyChargeNp = team.some((m) => m.svt.np?.extra.some((e) => e.kind === 'gainNp' && e.target !== 'self'));
  const capCd = (c: number, wave: number) => (hasShorten ? c : Math.min(c, left(wave)));
  /** Whether a buff on u can still change one of its NPs from this wave on. */
  const buffMatters = (b: Buff, u: Unit, wave: number) =>
    helps(b, u) && !(b.kind === 'npGainUp' && wave === lastWave) && !(b.opTraits && !traitAhead(wave, b.opTraits));
  // Per wave, keyed by the buff object (buffs are shared between states).
  const buffKeys = quest.waves.map(() => new WeakMap<Buff, number>());
  const buffKey = (b: Buff, wave: number) => {
    let k = buffKeys[wave].get(b);
    if (k === undefined) {
      const turns = b.turns < 0 ? -1 : Math.min(b.turns, left(wave));
      k = intern(`${b.kind},${b.value},${turns},${b.count},${b.cards?.join('') ?? ''},${b.opTraits?.join('.') ?? ''}${b.opAll ? '&' : ''},${b.rateOf ?? ''},${b.buffTraits ?? ''}${b.grow ? `~${b.grow.add}` : ''}`);
      buffKeys[wave].set(b, k);
    }
    return k;
  };
  // Per wave and buff array: a buff array belongs to one unit and survives
  // gauge and cooldown changes (copy-on-write), so this is mostly a lookup.
  const buffsHashes = quest.waves.map(() => new WeakMap<readonly Buff[], string>());
  const buffsHash = (u: Unit, wave: number) => {
    let h = buffsHashes[wave].get(u.buffs);
    if (h === undefined) {
      h = u.buffs.filter((b) => buffMatters(b, u, wave)).map((b) => buffKey(b, wave)).sort((x, y) => x - y).join('.');
      buffsHashes[wave].set(u.buffs, h);
    }
    return h;
  };
  // Deferred effects still to run before the last wave's NPs (the others never matter).
  const pendingHash = (u: Unit, wave: number) => u.pending
    .filter((p) => wave + p.wait <= lastWave && (u.svt.np || p.e.kind === 'shortenSkill'))
    .map((p) => intern(`${p.e.kind},${p.v.value},${p.v.turns},${p.v.count},${p.wait},${p.times},${p.e.cards?.join('') ?? ''},${p.e.opTraits?.join('.') ?? ''},${p.e.rateOf ?? ''},${p.e.buffTraits ?? ''}`))
    .sort((x, y) => x - y).join('.');
  // Per wave: the normalisation above depends on it.
  const unitHashes = quest.waves.map(() => new WeakMap<Unit, string>());
  // Gauge and buffs only matter on a unit with a damaging NP.
  const unitHash = (u: Unit | null, wave: number) => {
    if (!u) return '-';
    let h = unitHashes[wave].get(u);
    if (h === undefined) {
      h = `${buildOf.get(u.key)}${u.svt.form === 'low' ? 'L' : ''}:${capCd(u.cd[0], wave)},${capCd(u.cd[1], wave)},${capCd(u.cd[2], wave)}`;
      if (u.svt.np) h += `:${u.gauge}:${buffsHash(u, wave)}`;
      // Seals / stuns and HP matter on any unit (they block its skills / NP).
      const ctl = u.buffs.filter((b) => b.kind === 'sealNp' || b.kind === 'sealSkill' || b.kind === 'stun');
      if (ctl.length) h += `:c${ctl.map((b) => `${b.kind}${b.turns}`).sort().join('.')}`;
      if (u.hp !== undefined) h += `:h${u.hp}`;
      if (u.pending.length) h += `:${pendingHash(u, wave)}`;
      unitHashes[wave].set(u, h);
    }
    return h;
  };
  // After the (single) swap, back units never return: only their identity counts.
  const line = (xs: string[], canon: boolean) => (canon ? xs.sort() : xs).join('/');
  const backHash = (s: BattleState, canon: boolean) => line(s.swapped
    ? s.back.map((u) => String(buildOf.get(u.key)))
    : s.back.map((u) => unitHash(u, s.wave)), canon);
  // Enemy HPs and the field layout (which slot each enemy is in) give the
  // reserve too: an enemy not on the field with full HP has not entered yet.
  const enemyHashes = new WeakMap<readonly Enemy[], string>();
  const enemyHash = (es: readonly Enemy[]) => {
    let h = enemyHashes.get(es);
    if (h === undefined) {
      h = es.map((e) => (e.debuffs?.length
        ? `${e.hp}~${e.debuffs.map((d) => `${d.kind}:${d.value}:${d.count}:${d.cards?.join('/') ?? ''}`).sort().join(';')}`
        : `${e.hp}`) + (e.status?.length ? `!${e.status.join('.')}` : '')).join(',');
      enemyHashes.set(es, h);
    }
    return h;
  };
  /**
   * canon = lines as sorted multisets: only for nodes whose subtree does not
   * depend on slot order (turn start, NP phase, delay checks). Nodes inside a
   * turn (a list position, a swap slot) use the slot-ordered hash.
   */
  const partyHash = (s: BattleState, canon = true) =>
    `${s.wave}|${line(s.front.map((u) => unitHash(u, s.wave)), canon)}|${backHash(s, canon)}|${s.mcCd.map((c) => capCd(c, s.wave)).join(',')}${s.swapped ? 'S' : ''}`;
  const stateHashes = [new WeakMap<BattleState, string>(), new WeakMap<BattleState, string>()];
  const stateHash = (s: BattleState, canon: boolean) => {
    const cache = stateHashes[canon ? 1 : 0];
    let h = cache.get(s);
    if (h === undefined) { h = `${partyHash(s, canon)}|${enemyHash(s.enemies)}|${s.field.join(',')}`; cache.set(s, h); }
    return h;
  };

  /*
   * Memo notes. key -> fewest skill/MC actions of a line that reached it. A
   * hit skips the subtree only when the line now arriving has at least as
   * many actions: its Partials were recorded on the first visit and its
   * solutions found then, with fewer or equal actions. A cheaper line
   * re-explores it. The hash does not pin the action count: cooldowns are
   * capped at the end of the quest, so lines that used different skills can
   * reach the same key. On the last turn every relevant skill is forced and
   * the solution is then reduced to the exact minimum from the turn start
   * (exactLastTurn), so what a node inside that turn is worth depends on the
   * turn start, not only on the node: keys inside the last turn carry the
   * turn start (lastKey).
   * At memoCap the map is cleared, which only costs re-exploration; `seen`
   * deduplicates the solutions. The memo lives for one solve() call.
   */
  const memo = new Map<string, number>();
  /** Skill/MC steps on the current path (NPs excluded). */
  let acts = 0;
  const visit = (key: string): boolean => {
    const m = memo.get(key);
    if (m !== undefined && m <= acts) { stats.memoHits++; return false; }
    if (m === undefined && memo.size >= memoCap) memo.clear();
    memo.set(key, acts);
    return true;
  };
  /** Prefix for memo keys inside a turn: the turn start on the last turn (see the memo notes). */
  const lastKey = (s: BattleState) => (s.wave === lastWave ? stateHash(turnStarts[turnStarts.length - 1], true) + '#' : '');
  const tick = () => {
    if (++stats.nodes % CHECK_EVERY === 0 && (performance.now() > deadline || opts.cancel?.cancelled)) {
      stop = true; exhausted = false;
    }
    return stop;
  };

  // --- moves -------------------------------------------------------------

  /**
   * Targets worth trying for a skill, or null when none of its effects can
   * matter. [undefined] = no ptOne effect. Damage-side effects only matter on
   * units with a damaging NP; shortenSkill on anyone; on the last turn
   * shortenSkill and npGainUp cannot matter any more.
   */
  /** Whether some enemy of this wave or a later one has one of the traits. */
  // Per wave, keyed by the (shared) trait array of the effect or buff.
  const traitCache = quest.waves.map(() => new WeakMap<readonly number[], boolean>());
  const traitAhead = (wave: number, traits: readonly number[]) => {
    let r = traitCache[wave].get(traits);
    if (r === undefined) {
      // A status trait (data/status.ts): our skills / NPs may put it on an enemy.
      r = traits.some((t) => STATUS_TRAITS.has(t)) || quest.waves.slice(wave).some((w) => w.some((en) => en.traits.some((t) => traits.includes(t))));
      traitCache[wave].set(traits, r);
    }
    return r;
  };
  /**
   * Whether a buff / charge effect can change the NP of unit u. A card-limited
   * buff only counts for its cards (the NP is the only card fired); npGainUp
   * never counts for a buster NP (buster cards give no NP, a game rule).
   */
  const helps = (e: { kind: Effect['kind']; cards?: readonly Card[] }, u: Unit): boolean =>
    // A unit with forms: either kit's NP (it may transform before firing).
    (u.svt.forms ? [u.svt.np, inForm(u.svt, u.svt.form === 'low' ? 'high' : 'low').np] : [u.svt.np]).some((np) => {
      if (!np || np.noDamage) return false;
      if (e.cards && !e.cards.includes(np.card)) return false;
      if (e.kind === 'npGainUp' && np.card === 'buster') return false;
      return true;
    });

  function targetsOf(s: BattleState, effects: readonly Effect[], idx: number, caster: string | null, last: boolean): (string | undefined)[] | null {
    let relevant = false, needTarget = false;
    const targets = new Set<string>();
    for (const e of effects) {
      const v = e.lv[idx];
      if (e.target === 'ptOne') needTarget = true;
      if (e.kind === 'transform' && v?.value) { relevant = true; continue; } // a form change: always worth trying
      if (!v || v.value === 0 || e.kind === 'orderChange' || e.kind === 'lossNp' || isHarmful(e)) continue;
      if (e.target === 'enemy' || e.target === 'enemyAll') {
        // A debuff on enemies counts when it lands on a debuffable enemy and
        // some front-line NP is of a card it applies to.
        if (e.kind === 'enemyStatus') {
          // Counts when some front-line unit holds a buff checking one of its traits.
          const tr = e.buffTraits ?? [];
          if (s.front.some((u) => u?.buffs.some((b) => b.opTraits?.some((t) => tr.includes(t))))) relevant = true;
          continue;
        }
        if (!isEnemyDebuff(e.kind)) continue;
        const hit = e.target === 'enemyAll' ? s.field.filter((ei) => ei >= 0 && s.enemies[ei].hp > 0) : [soleTarget(s)].filter((ei) => ei >= 0);
        if (hit.some((ei) => !s.enemies[ei].noDebuff) && s.front.some((u) => u?.svt.np && (!e.cards || e.cards.includes(u.svt.np.card)))) relevant = true;
        continue;
      }
      // A deferred effect runs at the end of turn wave + wait - 1: too late if that is the last turn or later.
      if (e.deferred && s.wave + (e.deferred.at === 'delay' ? e.deferred.turns : 1) > lastWave) continue;
      if (caster === null && (e.target === 'self' || e.target === 'ptOther')) continue;
      if (last && (e.kind === 'shortenSkill' || e.kind === 'npGainUp')) continue;
      if (e.opTraits && !traitAhead(s.wave, e.opTraits)) continue;
      const counts = (u: Unit | null): u is Unit => !!u && (e.kind === 'shortenSkill' || helps(e, u));
      if (e.target === 'ptOne') {
        for (const u of s.front) if (counts(u)) { targets.add(u.key); relevant = true; }
      } else if (s.front.some((u) => counts(u) && (e.target === 'ptAll' || (e.target === 'self') === (u.key === caster)))) {
        relevant = true;
      }
    }
    if (!relevant) return null;
    if (!needTarget) return [undefined];
    if (targets.size) return [...targets];
    return [s.front.find((u) => u)!.key];
  }

  function expand(s: BattleState, m: Move, last: boolean): Option[] {
    const out: Option[] = [];
    if (m.kind === 'skill') {
      const u = s.front[m.slot];
      if (!u || u.cd[m.num - 1] > 0) return out;
      const sk = u.svt.skills.find((k) => k.num === m.num);
      if (!sk) return out;
      const targets = targetsOf(s, sk.effects, u.skillLv[m.num - 1] - 1, u.key, last);
      for (const target of targets ?? []) {
        try {
          out.push({
            state: castSkill(s, u.key, m.num, target), step: { kind: 'skill', unit: u.key, num: m.num, ...(target !== undefined && { target }) },
            ...(sk.effects.some(isHarmful) && { optional: true }),
          });
        } catch { /* engine refused the move: treat it as unavailable */ }
      }
      return out;
    }
    if (s.mcCd[m.index] > 0) return out;
    for (const target of targetsOf(s, mc.skills[m.index].effects, mcIdx, null, last) ?? []) {
      try { out.push({ state: castMc(s, m.index, mc, mcLv, target), step: mcStep(m.index, target) }); } catch { /* unavailable */ }
    }
    return out;
  }

  const mcStep = (index: number, target: string | undefined, swap?: [number, number]): Step =>
    ({ kind: 'mc', num: index + 1, ...(target !== undefined && { target }), ...(swap && { swap }) });

  /** Every way to swap front slot fi with back slot bi now (one per order-change MC skill and target). */
  function swapOptions(s: BattleState, fi: number, bi: number, last: boolean): Option[] {
    const out: Option[] = [];
    for (const index of swapMcs) {
      if (s.mcCd[index] > 0) continue;
      for (const target of targetsOf(s, mc.skills[index].effects, mcIdx, null, last) ?? [undefined]) {
        const swap: [number, number] = [fi, bi];
        try { out.push({ state: castMc(s, index, mc, mcLv, target, swap), step: mcStep(index, target, swap) }); } catch { /* unavailable */ }
      }
    }
    return out;
  }

  // --- search ------------------------------------------------------------

  const path: Step[][] = [];
  const turnStarts: BattleState[] = [];
  // Per open turn: end state of each line that cleared it, by its steps (see delayDominated).
  const turnClears: Map<string, BattleState>[] = [];
  const cur = () => path[path.length - 1];

  function record(p: Partial) { if (further(p, best)) best = p; }

  /** Damage bound (see bound.ts): true, with a Partial recorded, when some wave is out of reach. */
  function boundFails(s: BattleState): boolean {
    if (!prune) return false;
    const fail = damageBound(s, boundCtx);
    if (!fail) return false;
    stats.boundPrunes++;
    record({ wave: fail.wave + 1, turn: fail.wave + 1, reason: 'out of reach even with every remaining buff', missingDamagePct: fail.missing });
    return true;
  }

  /** Start of a turn: the no-swap recursion, then every swap. */
  function turnNode(s: BattleState): void {
    if (tick()) return;
    if (boundFails(s)) return;
    turnStarts.push(s);
    turnClears.push(new Map());
    moveNode(s, 0);
    if (!s.swapped && s.back.length > 0 && swapMcs.some((i) => s.mcCd[i] === 0)) {
      for (let fi = 0; fi < s.front.length && !stop; fi++) {
        if (!s.front[fi]) continue;
        for (let bi = 0; bi < s.back.length && !stop; bi++) outNode(s, fi, bi, 1);
      }
    }
    turnStarts.pop();
    turnClears.pop();
  }

  /** Swapping turn: use/skip over the outgoing unit's skills k..3, then the swap, then the full recursion. */
  function outNode(s: BattleState, fi: number, bi: number, k: number): void {
    if (tick()) return;
    if (!visit(`${lastKey(s)}O${fi}${bi}${k}${stateHash(s, false)}`)) return;
    const last = s.wave === lastWave;
    if (k === 4) {
      for (const o of swapOptions(s, fi, bi, last)) {
        if (boundFails(o.state)) continue;
        cur().push(o.step); acts++;
        moveNode(o.state, 0);
        cur().pop(); acts--;
        if (stop) return;
      }
      return;
    }
    branch(s, expand(s, { kind: 'skill', slot: fi, num: k as 1 | 2 | 3 }, last), last, (x) => outNode(x, fi, bi, k + 1));
  }

  /** Skip or use (each option); on the last turn a usable move is always used. */
  function branch(s: BattleState, options: Option[], last: boolean, next: (s: BattleState) => void): void {
    // Skip first: fewer actions are found first, and delayDominated finds the
    // clear of the line without a skill already cached.
    // A move with a demerit may hurt: skipping it is always explored too.
    if (!(last && options.length && !options.some((o) => o.optional))) next(s);
    for (const o of options) {
      if (stop) return;
      cur().push(o.step); acts++;
      next(o.state);
      cur().pop(); acts--;
    }
  }

  function moveNode(s: BattleState, pos: number, order = orderFor(s)): void {
    if (tick()) return;
    if (!visit(`${pos === 0 ? '' : lastKey(s)}M${pos}|${stateHash(s, pos === 0)}`)) return;
    if (pos === order.length) {
      if (prune && s.wave !== lastWave && wastedCharge(s)) { stats.delayPrunes++; return; }
      firePhase(s);
      return;
    }
    const short = prune ? gaugeShortfall(s, pos, order) : 0;
    if (short > 0) {
      record({ wave: s.wave + 1, turn: s.turn, reason: 'no NP charged', gaugeShort: short });
      return;
    }
    const last = s.wave === lastWave;
    branch(s, expand(s, order[pos], last), last, (x) => moveNode(x, pos + 1, order));
  }

  /**
   * Gauge bound: 0 when some front shooter can still reach 100% this turn with
   * the charge left in order[pos..], else the smallest shortfall. No NP this
   * turn means no clear. Charge from another NP's extras needs that unit to
   * fire first, and a unit that can fire already makes the result 0.
   */
  function gaugeShortfall(s: BattleState, pos: number, moves: readonly Move[]): number {
    let best = Infinity;
    for (const u of s.front) {
      // A unit with forms may get its NP from a transform: its charge counts too.
      if (!u?.svt.np && !u?.svt.forms) continue;
      let need = 10000 - u.gauge;
      for (let p = pos; p < moves.length && need > 0; p++) {
        const m = moves[p];
        if (m.kind === 'skill') {
          const c = s.front[m.slot];
          if (!c || c.cd[m.num - 1] > 0) continue;
          const sk = c.svt.skills.find((k) => k.num === m.num);
          if (sk) need -= chargeTo(sk.effects, c.skillLv[m.num - 1] - 1, c.key, u);
        } else if (s.mcCd[m.index] === 0) {
          need -= chargeTo(mc.skills[m.index].effects, mcIdx, null, u);
        }
      }
      if (need <= 0) return 0;
      best = Math.min(best, need);
    }
    return best === Infinity ? 10000 : best;
  }
  /**
   * Wasted charge (non-last turns, before firing): a step whose only effects
   * are NP charge, where taking that charge away leaves every NP holder it
   * reached at the same overcharge level (the floor of gauge / 100%). The NPs
   * then play out the same without it: a unit that fires restarts from 0, one
   * that does not keeps the difference, which using the step next turn gives
   * back. So it is delay-dominated, like in delayDominated, and the line
   * without it is explored. Off when an NP extra charges other units (it could
   * push a later NP over a threshold) or anything shortens cooldowns.
   */
  function wastedCharge(s: BattleState): boolean {
    if (hasShorten || partyChargeNp) return false;
    const steps = cur();
    const from = steps.findIndex((x) => x.swap) + 1; // before a swap: the caster has left
    for (let i = from; i < steps.length; i++) {
      const x = steps[i];
      const sk = x.kind === 'mc' ? mc.skills[x.num! - 1] : s.front.find((u) => u?.key === x.unit)?.svt.skills.find((k) => k.num === x.num);
      if (!sk || !sk.effects.every((e) => e.kind === 'gainNp' && !e.deferred)) continue;
      const caster = x.kind === 'mc' ? null : s.front.find((u) => u?.key === x.unit)!;
      const idx = caster ? caster.skillLv[x.num! - 1] - 1 : mcIdx;
      if (s.wave + sk.cooldown[idx] < quest.waves.length) continue;
      const wasted = s.front.every((u) => {
        if (!u?.svt.np) return true;
        let g = 0;
        for (const e of sk.effects) {
          const v = e.lv[idx]?.value ?? 0;
          if (e.target === 'ptAll' || (e.target === 'ptOne' && x.target === u.key) ||
            (caster && (e.target === 'self' ? caster.key === u.key : e.target === 'ptOther' && caster.key !== u.key))) g += v;
        }
        return g === 0 || Math.floor((u.gauge - g) / 10000) === Math.floor(u.gauge / 10000);
      });
      if (wasted) return true;
    }
    return false;
  }

  /** NP charge a skill's effects give unit u (caster null = MC). */
  function chargeTo(effects: readonly Effect[], idx: number, caster: string | null, u: Unit): number {
    let n = 0;
    for (const e of effects) {
      if (e.kind !== 'gainNp') continue;
      const v = e.lv[idx]?.value ?? 0;
      const hits = e.target === 'ptAll' || e.target === 'ptOne' ||
        (caster !== null && (e.target === 'self' ? caster === u.key : e.target === 'ptOther' && caster !== u.key));
      if (v > 0 && hits) n += v;
    }
    return n;
  }

  function firePhase(s: BattleState): void {
    if (!visit(`${lastKey(s)}F${stateHash(s, true)}`)) return;
    const shooters = s.front.filter((u): u is Unit => !!u && u.svt.np !== null && canNp(u));
    if (!shooters.some((u) => u.gauge >= 10000)) {
      const short = shooters.length ? Math.min(...shooters.map((u) => 10000 - u.gauge)) : 10000;
      record({ wave: s.wave + 1, turn: s.turn, reason: shooters.length ? 'no NP charged' : 'no damaging NP on the front line', gaugeShort: short });
      return;
    }
    fireSeq(s, 0, 0);
  }

  /**
   * Every ordered NP sequence from s. The turn's target (one per turn, chosen
   * before the NPs, see fireNp) is chosen lazily, at the first single-target
   * NP: the distinct outcomes are each enemy alive at the phase start and
   * still alive now, plus the auto target when one of them has died. The
   * choice (a slot at the phase start) goes on the turn's first NP step.
   * start: the state at the phase start; first: index of the turn's first NP
   * step in cur().
   */
  function fireSeq(s: BattleState, used: number, depth: number, start = s, first = cur().length): void {
    let fired = false;
    for (let slot = 0; slot < s.front.length; slot++) {
      const u = s.front[slot];
      if (!u || !u.svt.np || used & (1 << slot) || u.gauge < 10000 || !canNp(u)) continue;
      fired = true;
      for (const ti of targetChoices(s, start, u.svt.np.aoe)) {
        if (tick()) return;
        stats.npFires++;
        let r: ReturnType<typeof fireNp>;
        try { r = fireNp(ti === undefined ? s : { ...s, target: start.field[ti] }, u.key); } catch { continue; } // e.g. it would die of its HP loss
        const step: Step = { kind: 'np', unit: u.key };
        const firstStep = depth > 0 ? cur()[first] : undefined;
        if (ti !== undefined) {
          if (depth === 0) step.targetIndex = ti;
          else cur()[first] = { ...firstStep!, targetIndex: ti };
        }
        cur().push(step);
        if (r.killedAll) waveCleared(r.state);
        else if (depth + 1 < MAX_NP_PER_TURN) fireSeq(r.state, used | (1 << slot), depth + 1, start, first);
        else recordShort(r.state);
        cur().pop();
        if (firstStep) cur()[first] = firstStep;
        if (stop) return;
      }
    }
    if (!fired) recordShort(s);
  }
  /** Target slots (at the phase start) worth trying for this NP; [undefined] = no choice to make now. */
  function targetChoices(s: BattleState, start: BattleState, aoe: boolean): (number | undefined)[] {
    if (aoe || s.target >= 0) return [undefined];
    const startLiving = livingSlots(start);
    if (startLiving.length < 2) return [undefined];
    const alive = startLiving.filter((sl) => s.enemies[start.field[sl]].hp > 0);
    const dead = startLiving.find((sl) => s.enemies[start.field[sl]].hp <= 0);
    return dead === undefined ? alive : [...alive, dead];
  }

  function recordShort(s: BattleState) {
    record({ wave: s.wave + 1, turn: s.turn, reason: 'not enough damage', missingDamagePct: missingShare(s, quest.waves[s.wave]) });
  }

  /**
   * Delay dominance (non-last turns). A skill or MC step X of this turn is
   * dominated when replaying the turn without X, then using X after the NPs,
   * gives the same party state: X changed nothing about this turn's NPs (gauge
   * after firing, OC-scaled extras and the clear included). Using X at the start
   * of next turn instead is then at least as good (same charge, buffs last one
   * turn longer, same targets), and that line is explored too: the skip branch
   * of X reaches this same clear, then X is still ready next turn. Only when
   * nothing shortens cooldowns and X cannot come back before the quest ends,
   * so the later cooldown costs nothing.
   */
  function delayDominated(end: BattleState): boolean {
    if (hasShorten) return false;
    const start = turnStarts[turnStarts.length - 1];
    const clears = turnClears[turnClears.length - 1];
    const steps = cur();
    let endHash: string | undefined;
    for (let i = 0; i < steps.length; i++) {
      const x = steps[i];
      if (x.kind === 'np' || x.swap) continue;
      // A skill of a unit that has left the field cannot be delayed.
      if (x.kind === 'skill' && !end.front.some((u) => u?.key === x.unit)) continue;
      if (start.wave + cooldownOf(x, start) < quest.waves.length) continue;
      // Deferred effects run at a turn end counted from the use: using X a turn
      // later changes them (a delayed buff comes a turn later). Never delayed.
      if (deferredStep(x, start)) continue;
      // The line without X is explored first (skip first). Not cached: it did
      // not clear, or a memo hit cut it short; either way, no prune (safe).
      let w = clears.get(stepsKey(steps, i));
      if (!w) continue;
      w = tryStep(w, x, mc, mcLv) ?? undefined;
      if (!w) continue;
      if (!sameGauges(w, end)) continue; // cheap reject before hashing
      endHash ??= partyHash(end);
      if (partyHash(w) === endHash) return true;
    }
    return false;
  }
  /**
   * Swap delay dominance (non-last turns): if the unit that came in is
   * untouched at the end of the turn (same object: no skill, effect or NP on
   * it), swapping at the start of next turn instead is at least as good: this
   * turn plays the same with the outgoing unit still on the field, its unused
   * skills stay usable next turn before the swap, and the incoming unit enters
   * in the same state. That line is explored (the no-swap branch of this turn
   * with the same steps, then the swap next turn).
   */
  function swapDelayed(end: BattleState): boolean {
    const sw = cur().find((x) => x.swap);
    if (!sw) return false;
    const [fi, bi] = sw.swap!;
    return end.front[fi] === turnStarts[turnStarts.length - 1].back[bi];
  }
  const stepKeys = new WeakMap<Step, string>();
  const stepKey = (x: Step) => {
    let k = stepKeys.get(x);
    if (k === undefined) {
      k = `${x.kind[0]}${x.unit ?? ''},${x.num ?? ''},${x.target ?? ''},${x.swap ?? ''},${x.targetIndex ?? ''};`;
      stepKeys.set(x, k);
    }
    return k;
  };
  /** Key of a turn's steps, without step `skip` (-1: all). */
  const stepsKey = (steps: readonly Step[], skip: number) => {
    let k = '';
    for (let j = 0; j < steps.length; j++) if (j !== skip) k += stepKey(steps[j]);
    return k;
  };
  // Gauge of units with a damaging NP (the others are not hashed either).
  const sameGauges = (a: BattleState, b: BattleState) =>
    a.front.every((u, i) => !u?.svt.np || u.gauge === b.front[i]?.gauge);
  /** Whether the skill a step used has a deferred effect. */
  // Also true for a skill with a demerit (isHarmful): using it a turn later is
  // not "at least as good" (the demerit lasts into later turns).
  function deferredStep(x: Step, s: BattleState): boolean {
    if (x.kind === 'mc') return mc.skills[x.num! - 1].effects.some((e) => e.deferred || isHarmful(e));
    const u = [...s.front, ...s.back].find((v) => v?.key === x.unit)!;
    return !!u.svt.skills.find((k) => k.num === x.num)?.effects.some((e) => e.deferred || isHarmful(e));
  }
  /** Base cooldown of the skill a step used. */
  function cooldownOf(x: Step, s: BattleState): number {
    if (x.kind === 'mc') return mc.skills[x.num! - 1].cooldown[mcIdx];
    const u = [...s.front, ...s.back].find((v) => v?.key === x.unit)!;
    return u.svt.skills.find((k) => k.num === x.num)!.cooldown[u.skillLv[x.num! - 1] - 1];
  }

  function waveCleared(s: BattleState): void {
    if (s.wave === lastWave) { found(); return; }
    turnClears[turnClears.length - 1].set(stepsKey(cur(), -1), s);
    if (prune && (swapDelayed(s) || delayDominated(s))) { stats.delayPrunes++; return; }
    path.push([]);
    turnNode(nextWave(endTurn(s), quest, constants));
    path.pop();
  }

  // --- solutions ---------------------------------------------------------

  const sim = (turns: Step[][]) => simulate(team, mc, mcLv, quest, constants, turns);

  /**
   * Greedy: drops skill/MC steps one at a time while the solution still
   * clears. Not exact on its own (two half charges can each be needed once a
   * full one is gone), hence exactLastTurn. Stops early, keeping the current
   * valid solution, when time runs out or the search is cancelled.
   */
  function minimize(turns: Step[][]): Step[][] {
    let changed = true;
    while (changed && !tick()) {
      changed = false;
      outer: for (let t = 0; t < turns.length; t++) {
        for (let i = 0; i < turns[t].length; i++) {
          if (turns[t][i].kind === 'np') continue;
          const cand = turns.map((x, j) => (j === t ? [...x.slice(0, i), ...x.slice(i + 1)] : x));
          if (sim(cand).ok) { turns = cand; changed = true; break outer; }
        }
      }
    }
    return turns;
  }

  /**
   * Exact minimum for the last turn, given the earlier turns: the smallest
   * subset of its skill/MC steps (kept in their order, any ally target for a
   * targeted one) for which some NP sequence clears, tried by increasing size below `below`
   * (the greedy count). Run on the raw search line, before greedy can drop a
   * step the minimum needs. Null when nothing smaller exists. More of these steps only makes clearing easier (they are all
   * helpful), and the forced last turn used every relevant skill, so the true
   * minimum of the last turn from this start (for this swap choice) is among
   * them, whatever targets and NPs the line itself took. Gives up (null) after
   * EXACT_CAP evaluations.
   */
  function exactLastTurn(turns: Step[][], below: number): Step[][] | null {
    const L = turns.length - 1;
    const steps = turns[L].filter((x) => x.kind !== 'np');
    let start: BattleState;
    try {
      start = initBattle(team, mc, mcLv, quest, constants);
      for (let t = 0; t < L; t++) {
        for (const st of turns[t]) start = applyStep(start, st, mc, mcLv);
        start = nextWave(endTurn(start), quest, constants);
      }
    } catch { return null; }
    // Target choices: the line's own, or any unit with a damaging NP that can be
    // on the field this turn (tryStep rejects one that is not there yet).
    const incoming = steps.find((x) => x.swap)?.swap;
    const shooters = [...start.front, ...(incoming ? [start.back[incoming[1]]] : [])]
      .flatMap((u) => (u?.svt.np ? [u.key] : []));
    const choices = steps.map((x) => (x.target === undefined ? [x]
      : [x, ...shooters.filter((k) => k !== x.target).map((target) => ({ ...x, target }))]));
    let evals = 0;
    const picked: number[] = [];
    const chosen: Step[] = [];
    const tryPicked = (s: BattleState, j: number): Step[] | null => {
      if (j === picked.length) {
        evals++;
        const nps = clearingNps(s);
        return nps ? [...chosen, ...nps] : null;
      }
      for (const st of choices[picked[j]]) {
        if (evals >= EXACT_CAP) return null;
        const n = tryStep(s, st, mc, mcLv);
        if (!n) continue;
        chosen.push(st);
        const r = tryPicked(n, j + 1);
        chosen.pop();
        if (r) return r;
      }
      return null;
    };
    const combos = (from: number, left: number): Step[] | null => {
      if (left === 0) return tryPicked(start, 0);
      for (let i = from; i <= steps.length - left && evals < EXACT_CAP; i++) {
        picked.push(i);
        const r = combos(i + 1, left - 1);
        picked.pop();
        if (r) return r;
      }
      return null;
    };
    for (let size = 0; size < Math.min(below, steps.length) && evals < EXACT_CAP; size++) {
      const r = combos(0, size);
      if (r) return [...turns.slice(0, L), r];
    }
    return null;
  }

  /**
   * Some NP sequence (up to 3 distinct units, any turn target) that clears s,
   * or null. The target is chosen up front (every living slot when a charged
   * single-target NP is on the field) and carried by the first NP step.
   */
  function clearingNps(s: BattleState): Step[] | null {
    const st = s.front.some((u) => u?.svt.np && !u.svt.np.aoe && u.gauge >= 10000 && canNp(u));
    const living = livingSlots(s);
    for (const ti of st && living.length > 1 ? living : [undefined]) {
      const seq = npsFrom(ti === undefined ? s : { ...s, target: s.field[ti] }, 0, 0);
      if (seq) return ti === undefined ? seq : [{ ...seq[0], targetIndex: ti }, ...seq.slice(1)];
    }
    return null;
  }
  function npsFrom(s: BattleState, used: number, depth: number): Step[] | null {
    if (depth >= MAX_NP_PER_TURN) return null;
    for (let slot = 0; slot < s.front.length; slot++) {
      const u = s.front[slot];
      if (!u || !u.svt.np || used & (1 << slot) || u.gauge < 10000 || !canNp(u)) continue;
      let r: ReturnType<typeof fireNp>;
      try { r = fireNp(s, u.key); } catch { continue; }
      const step: Step = { kind: 'np', unit: u.key };
      if (r.killedAll) return [step];
      const rest = npsFrom(r.state, used | (1 << slot), depth + 1);
      if (rest) return [step, ...rest];
    }
    return null;
  }

  /**
   * A line reached the end. maxSolutions keeps the first N distinct solutions
   * in DFS order (skip first, so lines with fewer actions tend to come early),
   * not the best N: the returned list is sorted, but a better solution may lie
   * in the part of the tree left unexplored.
   */
  function found(): void {
    stats.rawSolutions++;
    const raw = path.map((t) => t.slice());
    // The forced last turn yields one line per target and NP choice; the first
    // line from a last-turn start (and swap choice) already gives that start's
    // exact minimum (exactLastTurn tries every target and NP sequence). A few
    // more are kept as alternatives, the rest skipped.
    const sw = raw[raw.length - 1].find((x) => x.swap);
    // Per action count before the last turn too: a cheaper prefix to the same start gets its own lines.
    const lastActs = raw[raw.length - 1].filter((x) => x.kind !== 'np').length;
    const startKey = `${acts - lastActs}|${stateHash(turnStarts[turnStarts.length - 1], true)}${sw ? stepKey(sw) : '-'}`;
    const nth = linesPerStart.get(startKey) ?? 0;
    linesPerStart.set(startKey, nth + 1);
    if (nth >= LINES_PER_START) { stats.skippedLines++; return; }
    // Defensive: the search line must replay. It always should; if it does
    // not, count it and skip it instead of aborting the search.
    if (!sim(raw).ok) { stats.replayFailures++; return; }
    const greedy = minimize(raw);
    const lastCount = greedy[greedy.length - 1].filter((x) => x.kind !== 'np').length;
    const exact = nth === 0 ? exactLastTurn(raw, lastCount) : null;
    const turns = exact ? minimize(exact) : greedy;
    const key = JSON.stringify(turns);
    if (seen.has(key)) return;
    seen.add(key);
    const r = sim(turns);
    if (!r.ok) { stats.replayFailures++; return; }
    const steps = turns.flat();
    const sol: Solution = {
      turns, margins: r.margins,
      actions: steps.filter((x) => x.kind !== 'np').length,
      usesSwap: steps.some((x) => x.swap !== undefined),
    };
    solutions.push(sol);
    opts.onSolution?.(sol);
    if (opts.cancel?.cancelled) { stop = true; exhausted = false; }
    if (opts.maxSolutions !== undefined && solutions.length >= opts.maxSolutions) { stop = true; exhausted = false; }
  }

  path.push([]);
  turnNode(initBattle(team, mc, mcLv, quest, constants));

  solutions.sort(compareSolutions);
  stats.memoSize = memo.size;
  stats.ms = performance.now() - t0;
  return { solutions, best: solutions.length ? null : best, exhausted, stats, closest: null };
}
