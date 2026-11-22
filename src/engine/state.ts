import { inForm } from '../data/forms';
import type { CompactServant, CompactCE, CompactMC, Constants, Effect, EffectKind, LevelVal, Card } from '../data/types';

/*
 * Immutability convention: every exported function returns a new state and
 * never mutates its input. Types are readonly to enforce it. Copies are
 * copy-on-write: unchanged units, the back line, enemies and the affinity
 * table are shared between states, so cloning is cheap for the solver.
 */

export type BuffKind = Extract<EffectKind, 'atkUp' | 'cardUp' | 'npDmgUp' | 'powerUp' | 'npGainUp' | 'ocUp' | 'dmgPlus' | 'buffRate' | 'sealNp' | 'sealSkill' | 'stun' | 'classRel'>;
export interface Buff {
  readonly kind: BuffKind; readonly value: number; readonly turns: number; readonly count: number;
  readonly cards?: readonly Card[]; readonly opTraits?: readonly number[];
  /** buffRate: buff traits it amplifies; other kinds: their traits a buffRate can target (Effect). */
  readonly rateOf?: readonly number[]; readonly buffTraits?: readonly number[];
  /** Aura (Effect.onField): counts only while the unit with this key is on the front line. */
  readonly src?: string;
  /** classRel: see Effect.classRel. */
  readonly classRel?: Record<string, Record<string, number>>;
}
/**
 * A deferred effect waiting on its holder (Effect.deferred): it runs at the
 * end of the turn when wait reaches 0 (wait 1 = this turn's end), then again
 * at each following turn end while times is left.
 */
export interface Pending { readonly e: Effect; readonly v: LevelVal; readonly wait: number; readonly times: number; }
export interface Unit {
  readonly key: string; readonly svt: CompactServant; readonly lv: number; readonly npLv: number;
  readonly skillLv: readonly [number, number, number];
  readonly atk: number; readonly gauge: number;
  readonly cd: readonly [number, number, number];
  readonly buffs: readonly Buff[];
  /** Deferred effects on this unit (see Pending). */
  readonly pending: readonly Pending[];
  /** The buffs it casts fail (CompactServant.castBlockTraits of a party member). */
  readonly castBlocked?: true;
  /** HP left, tracked only for servants with lossHp effects (CompactServant.hp, no HP fou). */
  readonly hp?: number;
  /**
   * Auras (Buff.src) whose holder is in the back line: inactive, moved back to
   * `buffs` when the holder enters the field (syncAuras). They are permanent,
   * so this list only depends on who is on the front line.
   */
  readonly dormant?: readonly Buff[];
}
export interface Enemy {
  readonly hp: number; readonly className: string; readonly attribute: string;
  readonly traits: readonly number[]; readonly tdRate: number;
  /** Defence up from its passives (permille, upDefence), and flat damage cut (subSelfdamage). */
  readonly defUp?: number; readonly dmgCut?: number;
  /**
   * A passive of it (or of its wave) gives debuff immunity or resistance
   * (avoidState, upTolerance...): our debuffs are never applied to it
   * (Chaldea: Rate + grant chance - resist must reach 1000; we do not count
   * the resist, so we skip the enemy).
   */
  readonly noDebuff?: true;
  /** Our debuffs on it (only within its wave: every wave dies on its turn). */
  readonly debuffs?: readonly EnemyDebuff[];
}
/**
 * A debuff on an enemy (EffectKind defDown / cardResDown). count: attacks it
 * still applies to (-1 = unlimited); cards: the attacking cards it applies to.
 */
export interface EnemyDebuff {
  readonly kind: 'defDown' | 'cardResDown'; readonly value: number; readonly count: number;
  readonly cards?: readonly Card[];
}
export const isEnemyDebuff = (k: EffectKind): k is EnemyDebuff['kind'] => k === 'defDown' || k === 'cardResDown';

/** Sum of the enemy's debuffs of this kind that apply to an attack with this card. */
export function debuffSum(e: Enemy, kind: EnemyDebuff['kind'], card: Card): number {
  let v = 0;
  for (const d of e.debuffs ?? []) if (d.kind === kind && d.count !== 0 && (!d.cards || d.cards.includes(card))) v += d.value;
  return v;
}

/** The enemy's debuffs after one attack with this card: count-limited ones that applied lose a use. */
export function consumeDebuffs(e: Enemy, card: Card): Enemy {
  if (!e.debuffs?.some((d) => d.count > 0 && (!d.cards || d.cards.includes(card)))) return e;
  const debuffs: EnemyDebuff[] = [];
  for (const d of e.debuffs) {
    if (d.count > 0 && (!d.cards || d.cards.includes(card))) { if (d.count > 1) debuffs.push({ ...d, count: d.count - 1 }); }
    else debuffs.push(d);
  }
  return { ...e, debuffs };
}
/** Constants resolved for one unit against one enemy (permille). */
export interface Affinity { readonly classAtk: number; readonly triangle: number; readonly attribute: number; }
export interface BattleState {
  readonly turn: number;               // starts at 1
  readonly wave: number;               // 0-based index into Quest.waves
  readonly front: readonly (Unit | null)[];
  readonly back: readonly Unit[];
  /** Every enemy of the current wave (Quest.waves order); index = enemy id within the wave. */
  readonly enemies: readonly Enemy[];
  /** Field slot -> enemy index (-1 = empty). Single-target NPs aim at a slot. */
  readonly field: readonly number[];
  /** Enemies still waiting to enter, in entry order. */
  readonly reserve: readonly number[];
  /** Slots refilled from the reserve, in refill order (see refillField). */
  readonly refill: readonly number[];
  /** Enemy indices in auto-target order (see npTarget). */
  readonly retarget: readonly number[];
  /**
   * The turn's enemy target (enemy index, -1 = none chosen). In the game the
   * target is chosen once, before the NPs; single-target NPs hit it while it
   * lives, then the auto target (npTarget).
   */
  readonly target: number;
  /**
   * NPs fired so far this turn, in chain order (the target can no longer be
   * chosen once one has fired; the next NP is chain position npsFired + 1).
   */
  readonly npsFired: number;
  readonly mcCd: readonly number[];
  readonly swapped: boolean;
  /** unit key -> affinity against enemies[i] of the current wave. */
  readonly aff: Readonly<Record<string, readonly Affinity[]>>;
  /** The quest's field traits and event, for quest-conditioned effects (effectActive). */
  readonly cond: QuestCond;
  /** Index of the quest's last wave: Skill.lastTurnOnly skills are only usable on it. */
  readonly lastWave: number;
}
export interface QuestCond { readonly fieldTraits: readonly number[]; readonly eventId: number; }
export interface TeamMember {
  svt: CompactServant; lv: number; npLv: number; skillLv: [number, number, number]; append2Lv: number;
  fou: number; ce: CompactCE | null; ceLv: number; ceMlb: boolean; key: string;
}
/**
 * Field layout of a wave with reinforcements. field: initial slot -> enemy
 * index (-1 = empty); reserve: the other enemies in entry order; refill: the
 * slots that take a reserve enemy, in the order they are filled.
 */
export interface WaveLayout {
  readonly field: readonly number[]; readonly reserve: readonly number[]; readonly refill: readonly number[];
  /**
   * Enemy indices in auto-target order (default: index order). Chaldea's
   * getNonNullTargetIndex: the living field enemy with the lowest uniqueId
   * on enemyImmediateAppear quests, else the first living slot.
   */
  readonly retarget?: readonly number[];
}
/**
 * waves[w]: every enemy of wave w. layouts[w] absent: all of them on the
 * field (slot i = enemy i), no reserve.
 */
export interface Quest {
  readonly waves: readonly (readonly Enemy[])[];
  readonly layouts?: readonly (WaveLayout | undefined)[];
  /** Field traits (Chaldea's questIndividuality); absent = none. */
  readonly fieldTraits?: readonly number[];
  /** Event of the quest's war; absent = none. */
  readonly eventId?: number;
}

const NO_TRAITS: readonly number[] = [];
export const questCond = (q: Quest): QuestCond => ({ fieldTraits: q.fieldTraits ?? NO_TRAITS, eventId: q.eventId ?? 0 });

/**
 * Whether a quest-conditioned effect runs in this quest: one of its field
 * traits is on the field (any-of, Chaldea's checkSignedIndivPartialMatch on
 * funcquestTvals) and its event, if any, is the quest's (svals EventId).
 */
export function effectActive(e: Pick<Effect, 'fieldTraits' | 'eventId'>, c: QuestCond): boolean {
  if (e.fieldTraits && !e.fieldTraits.some((t) => c.fieldTraits.includes(t))) return false;
  return !e.eventId || e.eventId === c.eventId;
}

/*
 * The parts of a servant the engine may use (CompactServant per-part marks):
 * skills with unsupported effects are left out (never usable: useSkill throws
 * as for a missing skill) and an NP with unsupported effects becomes null
 * (never fires). Sound: a part that is never used cannot change anything.
 * Cached, so a servant keeps one view (object identity) across battles.
 */
const views = new WeakMap<CompactServant, CompactServant>();
export function usableServant(svt: CompactServant): CompactServant {
  let v = views.get(svt);
  if (!v) {
    const bad = svt.skills.some((k) => k.unsupported?.length) || !!svt.np?.unsupported?.length;
    v = bad ? {
      ...svt, skills: svt.skills.filter((k) => !k.unsupported?.length),
      np: svt.np?.unsupported?.length ? null : svt.np,
    } : svt;
    views.set(svt, v);
  }
  return v;
}

const plainLayouts = new WeakMap<readonly Enemy[], WaveLayout>();
export function layoutOf(quest: Quest, wave: number): WaveLayout {
  const l = quest.layouts?.[wave];
  if (l) return l;
  const es = quest.waves[wave];
  let p = plainLayouts.get(es);
  if (!p) {
    const field = es.map((_, i) => i);
    p = { field, reserve: [], refill: field, retarget: field };
    plainLayouts.set(es, p);
  }
  return p;
}

const waveState = (lay: WaveLayout) => ({
  field: lay.field, reserve: lay.reserve, refill: lay.refill,
  retarget: lay.retarget ?? lay.field.filter((x) => x >= 0).concat(lay.reserve).sort((a, b) => a - b),
  target: -1, npsFired: 0,
});

/**
 * Enemy hit by a single-target NP now: the turn's target while it is alive on
 * the field, else the first living field enemy in retarget order; -1 if none.
 */
export function npTarget(s: Pick<BattleState, 'enemies' | 'field' | 'retarget' | 'target'>): number {
  const on = (ei: number) => ei >= 0 && s.enemies[ei].hp > 0 && s.field.includes(ei);
  if (on(s.target)) return s.target;
  for (const ei of s.retarget) if (on(ei)) return ei;
  return -1;
}

/** Choose the turn's target: the enemy in a living field slot, before any NP of the turn. */
export function chooseTarget<S extends Pick<BattleState, 'enemies' | 'field' | 'target' | 'npsFired'>>(s: S, slot: number): S {
  if (s.npsFired > 0) throw new Error('the target is chosen before the NPs');
  const ei = s.field[slot] ?? -1;
  if (!(ei >= 0 && s.enemies[ei].hp > 0)) throw new Error(`enemy slot ${slot} is not alive`);
  return { ...s, target: ei };
}

/** Field slots holding a living enemy. */
export const livingSlots = (s: Pick<BattleState, 'enemies' | 'field'>): number[] =>
  s.field.flatMap((ei, slot) => (ei >= 0 && s.enemies[ei].hp > 0 ? [slot] : []));

/**
 * Reinforcements (Chaldea's _replenishActors, on quests flagged
 * enemyImmediateAppear: run after every NP): each refill slot, in order, that
 * is empty or holds a dead enemy takes the next reserve enemy. Returns the
 * state unchanged when nothing enters.
 */
export function refillField<S extends Pick<BattleState, 'enemies' | 'field' | 'reserve' | 'refill'>>(s: S): S {
  if (s.reserve.length === 0) return s;
  let field: number[] | null = null;
  let next = 0;
  for (const slot of s.refill) {
    if (next >= s.reserve.length) break;
    const ei = (field ?? s.field)[slot];
    if (ei >= 0 && s.enemies[ei].hp > 0) continue;
    field ??= s.field.slice();
    field[slot] = s.reserve[next++];
  }
  return field ? { ...s, field, reserve: s.reserve.slice(next) } : s;
}

/**
 * NP gauge cap by NP level: NP1 100%, NP2-4 200%, NP5 300%. This is a game
 * rule, not Atlas data: Chaldea's Laplace hardcodes it
 * (lib/app/battle/models/svt_entity.dart, getNPCap) on FULL_TD_POINT = 10000.
 */
export const gaugeCap = (npLv: number): number => 10000 * (npLv <= 1 ? 1 : npLv < 5 ? 2 : 3);

export interface Mods {
  atkMod: number; cardMod: number; npDmgMod: number; powerMod: number;
  npGainMod: number; ocUp: number; dmgPlus: number;
}

// Buff kinds and the modifier each one adds to (buffRate scales the others, see mods()).
const CONTROL = new Set<string>(['sealNp', 'sealSkill', 'stun']);
/**
 * Class relation of the unit's attacks on this enemy: the latest classRel
 * buff covering the pair, else the base one.
 */
export function triangleOf(u: Unit, enemy: Pick<Enemy, 'className'>, base: number): number {
  let t = base;
  for (const b of u.buffs) { const v = b.classRel?.[u.svt.className]?.[enemy.className]; if (v !== undefined) t = v; }
  return t;
}
/** The unit may fire its NP (no NP seal / stun on it). */
export const canNp = (u: Unit): boolean => !u.buffs.some((b) => b.kind === 'sealNp' || b.kind === 'stun');
/** The unit may use skills, and its cooldowns tick (no skill seal / stun on it). */
export const canSkill = (u: Unit): boolean => !u.buffs.some((b) => b.kind === 'sealSkill' || b.kind === 'stun');
/**
 * A harmful effect on our side (demerit): an immediate NP loss, a seal /
 * stun, a negative value. The solver never assumes such a move only helps.
 */
export const isHarmful = (e: Effect): boolean =>
  // classRel may lower a relation (Semiramis: Assassin vs Caster x1): harmful-capable.
  // transform may be worse (an AoE NP on a single boss): never forced either.
  (e.kind === 'lossNp' && !e.deferred) || e.kind === 'lossHp' || e.kind === 'selfDeath' || e.kind === 'allyDeath' || e.kind === 'classRel' || e.kind === 'transform' || CONTROL.has(e.kind) || e.lv.some((v) => v.value < 0);
const MOD_FIELD: Record<Exclude<BuffKind, 'buffRate' | 'sealNp' | 'sealSkill' | 'stun' | 'classRel'>, keyof Mods> = {
  atkUp: 'atkMod', cardUp: 'cardMod', npDmgUp: 'npDmgMod', powerUp: 'powerMod',
  npGainUp: 'npGainMod', ocUp: 'ocUp', dmgPlus: 'dmgPlus',
};
export const isBuffKind = (k: EffectKind): k is BuffKind => k in MOD_FIELD || k === 'buffRate' || k === 'classRel' || CONTROL.has(k);
const NO_PENDING: readonly Pending[] = [];

// --- affinity ------------------------------------------------------------

function lookup(table: Record<string, number> | undefined, key: string, what: string): number {
  const v = table?.[key];
  if (v === undefined) throw new Error(`missing constant: ${what}`);
  return v;
}
export function affinity(c: Constants, svt: CompactServant, e: Enemy): Affinity {
  return {
    classAtk: lookup(c.classAtk, svt.className, `classAtk[${svt.className}]`),
    triangle: lookup(c.classRel[svt.className], e.className, `classRel[${svt.className}][${e.className}]`),
    attribute: lookup(c.attrRel[svt.attribute], e.attribute, `attrRel[${svt.attribute}][${e.attribute}]`),
  };
}
function affTable(c: Constants, units: readonly Unit[], enemies: readonly Enemy[]): Record<string, Affinity[]> {
  const out: Record<string, Affinity[]> = {};
  for (const u of units) out[u.key] = enemies.map((e) => affinity(c, u.svt, e));
  return out;
}

// --- copy-on-write helpers -----------------------------------------------

/** Mutable shell of a state: only the front array is copied; units are replaced, never mutated. */
type Draft = { -readonly [K in keyof BattleState]: BattleState[K] };
type Front = (Unit | null)[];
const draft = (s: BattleState): Draft & { front: Front } => ({ ...s, front: s.front.slice() });

const frontIndex = (front: readonly (Unit | null)[], key: string): number => {
  const i = front.findIndex((x) => x?.key === key);
  if (i < 0) throw new Error(`unit ${key} is not on the front line`);
  return i;
};
const sub3 = (cd: readonly [number, number, number], n: number): [number, number, number] =>
  [Math.max(0, cd[0] - n), Math.max(0, cd[1] - n), Math.max(0, cd[2] - n)];

function toBuff(e: Effect, kind: BuffKind, v: LevelVal): Buff {
  const b: { -readonly [K in keyof Buff]: Buff[K] } = { kind, value: v.value, turns: v.turns, count: v.count };
  if (e.cards) b.cards = e.cards;
  if (e.opTraits) b.opTraits = e.opTraits;
  if (e.rateOf) b.rateOf = e.rateOf;
  if (e.buffTraits) b.buffTraits = e.buffTraits;
  if (e.classRel) b.classRel = e.classRel;
  return b;
}

/** One effect on one unit; returns the new unit. */
function effectOn(u: Unit, e: Effect, v: LevelVal): Unit {
  if (e.deferred) {
    const delay = e.deferred.at === 'delay';
    const p: Pending = { e, v, wait: delay ? e.deferred.turns : 1, times: delay ? 1 : e.deferred.turns };
    return { ...u, pending: [...u.pending, p] };
  }
  if (e.kind === 'gainNp') return { ...u, gauge: Math.min(gaugeCap(u.npLv), u.gauge + v.value) };
  if (e.kind === 'lossNp') return { ...u, gauge: Math.max(0, u.gauge - v.value) };
  if (e.kind === 'transform') {
    // New kit (skills, NP) of the other form; levels, cooldowns, buffs and gauge are kept.
    if (!e.toForm) return u;
    const next = usableServant(inForm(u.svt, e.toForm));
    return next === u.svt ? u : { ...u, svt: next };
  }
  if (e.kind === 'lossHp') {
    // The unit would die (or its HP is unknown): the move is not allowed.
    if (u.hp === undefined || u.hp - v.value <= 0) throw new Error(`${u.key} would die of its HP loss`);
    return { ...u, hp: u.hp - v.value };
  }
  if (e.kind === 'shortenSkill') return { ...u, cd: sub3(u.cd, v.value) };
  if (isBuffKind(e.kind)) return { ...u, buffs: [...u.buffs, toBuff(e, e.kind, v)] };
  return u;
}

/**
 * Enemy a single-target debuff lands on when no attack picks it: the turn's
 * target if it was set this turn (an NP chose it) and is alive, else the only
 * living enemy on the field; -1 when it is ambiguous (the player could still
 * aim elsewhere before the NPs, so we do not guess: the debuff is skipped).
 */
export function soleTarget(s: Pick<BattleState, 'enemies' | 'field' | 'target' | 'npsFired'>): number {
  const alive = (ei: number) => ei >= 0 && s.enemies[ei].hp > 0 && s.field.includes(ei);
  if (s.npsFired > 0 && alive(s.target)) return s.target;
  const living = s.field.filter(alive);
  return living.length === 1 ? living[0] : -1;
}

/** Shell an effect writes to: the front line, plus the enemies for our debuffs (replaced, never mutated). */
export interface EffectDraft {
  front: Front; cond: QuestCond;
  enemies?: readonly Enemy[]; field?: readonly number[]; target?: number; npsFired?: number;
}

/**
 * Apply one effect at the given level values to the draft's front line (and,
 * for a debuff, to the draft's enemies). casterKey null = Mystic Code (no
 * self/ptOther). orderChange is not handled here. A value of 0 means "not
 * guaranteed": no-op. enemyTarget: the enemy a single-target debuff hits (an
 * NP's target); without it, soleTarget().
 */
export function applyEffect(d: EffectDraft, e: Effect, v: LevelVal, casterKey: string | null, targetKey?: string, enemyTarget?: number): void {
  if (v.value === 0 || e.kind === 'orderChange' || !effectActive(e, d.cond)) return;
  if (isEnemyDebuff(e.kind)) {
    if ((e.target !== 'enemy' && e.target !== 'enemyAll') || !d.enemies || !d.field) return;
    const es = d.enemies.slice();
    const living = d.field.filter((ei) => ei >= 0 && es[ei].hp > 0);
    const hit = e.target === 'enemyAll' ? living
      : [enemyTarget ?? soleTarget({ enemies: es, field: d.field, target: d.target ?? -1, npsFired: d.npsFired ?? 0 })].filter((ei) => living.includes(ei));
    const deb: EnemyDebuff = { kind: e.kind, value: v.value, count: v.count, ...(e.cards && { cards: e.cards }) };
    for (const ei of hit) if (!es[ei].noDebuff) es[ei] = { ...es[ei], debuffs: [...(es[ei].debuffs ?? []), deb] };
    d.enemies = es;
    return;
  }
  const f = d.front;
  // A caster whose buffs fail (castBlocked): its buffs, and the trigger buffs
  // behind deferred effects, are dropped; a deferred NP drain is kept (conservative).
  if (casterKey !== null && (isBuffKind(e.kind) || (e.deferred && e.kind !== 'lossNp')) && f.find((x) => x?.key === casterKey)?.castBlocked) return;
  const on = (i: number) => { f[i] = effectOn(f[i]!, e, v); };
  if (e.kind === 'selfDeath') {
    if (e.target !== 'self' || casterKey === null) throw new Error('selfDeath on another target');
    f[frontIndex(f, casterKey)] = null;
    return;
  }
  if (e.kind === 'allyDeath') {
    const i = f.findIndex((u) => u && u.key !== casterKey && !u.svt.traits.some((t) => e.exceptTraits?.includes(t)));
    if (i >= 0) f[i] = null;
    return;
  }
  switch (e.target) {
    case 'self':
      if (casterKey === null) throw new Error('self target without a caster');
      on(frontIndex(f, casterKey)); return;
    case 'ptAll':
      for (let i = 0; i < f.length; i++) if (f[i]) on(i);
      return;
    case 'ptOther':
      if (casterKey === null) throw new Error('ptOther target without a caster');
      for (let i = 0; i < f.length; i++) if (f[i] && f[i]!.key !== casterKey) on(i);
      return;
    case 'ptOne':
      if (targetKey === undefined) throw new Error('ptOne effect needs a target');
      on(frontIndex(f, targetKey)); return;
    default: return; // enemy / enemyAll: not modelled (only helpful debuffs reach here)
  }
}

// --- battle --------------------------------------------------------------

const inRange = (v: number, lo: number, hi: number, what: string) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${what} out of range: ${v} (expected ${lo}..${hi})`);
};

export function initBattle(members: readonly TeamMember[], mc: CompactMC, mcLv: number, quest: Quest, constants: Constants): BattleState {
  inRange(mcLv, 1, 10, 'mcLv');
  if (quest.waves.length === 0) throw new Error('quest has no waves');
  const keys = new Set<string>();
  for (const m of members) {
    if (keys.has(m.key)) throw new Error(`duplicate member key: ${m.key}`);
    keys.add(m.key);
  }
  const cond = questCond(quest);
  const blockTraits = new Set(members.flatMap((m) => m.svt.castBlockTraits ?? []));
  // CE / event passive effects on other units or tied to the field (applied below).
  const party: { e: Effect; v: LevelVal; holder: string; castBlocked: boolean }[] = [];
  const built = members.map((m): Unit => {
    const svt = usableServant(m.svt);
    const castBlocked = svt.traits.some((t) => blockTraits.has(t));
    const what = (f: string) => `${m.key}.${f}`;
    inRange(m.lv, 1, m.svt.atkGrowth.length, what('lv'));
    inRange(m.npLv, 1, 5, what('npLv'));
    m.skillLv.forEach((l, i) => inRange(l, 1, 10, what(`skillLv[${i}]`)));
    inRange(m.append2Lv, 0, m.svt.append2.length, what('append2Lv'));
    if (!Number.isFinite(m.fou) || m.fou < 0) throw new Error(`${what('fou')} must be a finite number >= 0: ${m.fou}`);
    if (m.ce) inRange(m.ceLv, 1, m.ce.atkGrowth.length, what('ceLv'));

    const buffs: Buff[] = [];
    let gauge = m.append2Lv > 0 ? m.svt.append2[m.append2Lv - 1] : 0;
    // Passives and CEs use index 0. Only self-targeted ones are applied: a
    // party-wide passive/CE effect is skipped (conservative, they only help).
    for (const e of svt.passives) {
      const v = e.lv[0];
      if (castBlocked) break; // conservative: its own passive buffs are dropped too
      if (v && v.value !== 0 && v.turns === -1 && e.target === 'self' && isBuffKind(e.kind) && effectActive(e, cond)) buffs.push(toBuff(e, e.kind, v));
    }
    // CE and event bonus passives (Chaldea's activateExtraPassive / activateCE, at battle start).
    const start = [
      ...(m.svt.eventPassives ?? []).filter((p) => cond.eventId && p.eventIds.includes(cond.eventId)).flatMap((p) => p.effects),
      ...(m.ce ? (m.ceMlb ? m.ce.effectsMlb : m.ce.effects) : []),
    ];
    for (const e of start) {
      const v = e.lv[0];
      if (!v || v.value === 0 || !effectActive(e, cond)) continue;
      if (e.target !== 'self' || e.onField) {
        if (e.target === 'self' || e.target === 'ptAll' || e.target === 'ptOther') party.push({ e, v, holder: m.key, castBlocked });
        continue;
      }
      if (e.kind === 'gainNp') gauge += v.value;
      else if (isBuffKind(e.kind) && !castBlocked) buffs.push(toBuff(e, e.kind, v));
    }
    return {
      key: m.key, svt, lv: m.lv, npLv: m.npLv, skillLv: [...m.skillLv],
      atk: m.svt.atkGrowth[m.lv - 1] + m.fou + (m.ce ? m.ce.atkGrowth[m.ceLv - 1] : 0),
      gauge: Math.min(gaugeCap(m.npLv), gauge), cd: [0, 0, 0], buffs, pending: NO_PENDING,
      ...(m.svt.hp && { hp: m.svt.hp[m.lv - 1] }),
      ...(castBlocked && { castBlocked: true as const }),
    };
  });
  // Party-wide battle-start effects (Chaldea activates every member's CE and
  // event passive at battle start, back line included): ptAll / ptOther reach
  // the units on the field then, Effect.full ones the whole party; an onField
  // aura stays on its targets but only counts while its holder is on the field.
  const units = built.map((u) => ({ ...u, buffs: [...u.buffs] }));
  for (const { e, v, holder, castBlocked } of party) {
    units.forEach((u, i) => {
      const reach = e.target === 'self' ? u.key === holder
        : (e.full || i < 3) && (e.target === 'ptAll' || u.key !== holder);
      if (!reach) return;
      if (e.kind === 'gainNp') {
        if (!e.onField) units[i] = { ...u, gauge: Math.min(gaugeCap(u.npLv), u.gauge + v.value) };
      } else if (isBuffKind(e.kind) && !castBlocked) {
        const b = toBuff(e, e.kind, v);
        (u.buffs as Buff[]).push(e.onField ? { ...b, src: holder } : b);
      }
    });
  }
  const enemies = quest.waves[0];
  const lay = layoutOf(quest, 0);
  return syncAuras({
    turn: 1, wave: 0,
    front: units.slice(0, 3), back: units.slice(3),
    enemies, ...waveState(lay), mcCd: mc.skills.map(() => 0), swapped: false,
    aff: affTable(constants, units, enemies), cond, lastWave: quest.waves.length - 1,
  });
}

/**
 * Puts every aura (Buff.src) in `buffs` when its holder is on the front line
 * and in `dormant` otherwise. Called whenever the front line changes (battle
 * start, order change). Units without auras keep their identity.
 */
export function syncAuras<S extends { front: readonly (Unit | null)[]; back: readonly Unit[] }>(s: S): S {
  const all = [...s.front, ...s.back];
  if (!all.some((u) => u && (u.dormant?.length || u.buffs.some((b) => b.src)))) return s;
  const onField = new Set(s.front.filter((u): u is Unit => u !== null).map((u) => u.key));
  const fix = (u: Unit): Unit => {
    if (!u.dormant?.length && !u.buffs.some((b) => b.src)) return u;
    const pool = [...u.buffs, ...(u.dormant ?? [])];
    const buffs = pool.filter((b) => !b.src || onField.has(b.src));
    const dormant = pool.filter((b) => b.src && !onField.has(b.src));
    const { dormant: _old, ...rest } = u;
    return dormant.length ? { ...rest, buffs, dormant } : { ...rest, buffs };
  };
  return { ...s, front: s.front.map((u) => (u ? fix(u) : null)), back: s.back.map(fix) };
}

export function useSkill(state: BattleState, unitKey: string, num: 1 | 2 | 3, targetKey?: string): BattleState {
  const d = draft(state);
  const ui = frontIndex(d.front, unitKey);
  const u = d.front[ui]!;
  const skill = u.svt.skills.find((k) => k.num === num);
  if (!skill) throw new Error(`${unitKey} has no skill ${num}`);
  const i = num - 1;
  if (u.cd[i] > 0) throw new Error(`${unitKey} skill ${num} is on cooldown`);
  if (!canSkill(u)) throw new Error(`${unitKey} cannot use skills (seal / stun)`);
  if (skill.lastTurnOnly?.length && state.wave !== state.lastWave) throw new Error(`${unitKey} skill ${num} is usable on the last turn only`);
  const idx = u.skillLv[i] - 1;
  for (const e of skill.effects) applyEffect(d, e, e.lv[idx], unitKey, targetKey);
  const after = d.front[ui]!;
  const cd: [number, number, number] = [after.cd[0], after.cd[1], after.cd[2]];
  cd[i] = skill.cooldown[idx];
  d.front[ui] = { ...after, cd };
  return d;
}

/** index is 0-based (mc.skills[index], mcCd[index]). swap = [frontIdx, backIdx] for order change. */
export function useMc(state: BattleState, index: number, mc: CompactMC, mcLv: number, targetKey?: string, swap?: [number, number]): BattleState {
  const skill = mc.skills[index];
  if (!skill) throw new Error(`MC has no skill ${index}`);
  if (state.mcCd[index] > 0) throw new Error(`MC skill ${index} is on cooldown`);
  inRange(mcLv, 1, skill.cooldown.length, 'mcLv');
  const d = draft(state);
  const idx = mcLv - 1;
  for (const e of skill.effects) {
    if (e.kind !== 'orderChange') { applyEffect(d, e, e.lv[idx], null, targetKey); continue; }
    if (e.lv[idx].value === 0) throw new Error('order change not available at this level');
    if (d.swapped) throw new Error('order change already used');
    if (!swap) throw new Error('order change needs a swap');
    const [a, b] = swap;
    const out = d.front[a];
    const inn = d.back[b];
    if (!out || !inn) throw new Error('invalid order change slots');
    const back = d.back.slice();
    d.front[a] = inn;
    back[b] = out;
    d.back = back;
    d.swapped = true;
    Object.assign(d, syncAuras(d));
  }
  const mcCd = d.mcCd.slice();
  mcCd[index] = skill.cooldown[idx];
  d.mcCd = mcCd;
  return d;
}

/**
 * End of turn for a front-line unit: buff turns and cooldowns tick, then its
 * deferred effects that are due run (Chaldea runs selfturnendFunction and
 * delayFunction skills after the turn progress, so a buff they grant with
 * turns 1 is active next turn).
 */
function tick(u: Unit): Unit {
  let changed = u.cd[0] > 0 || u.cd[1] > 0 || u.cd[2] > 0;
  const buffs: Buff[] = [];
  for (const b of u.buffs) {
    if (b.turns < 0) buffs.push(b);
    else { changed = true; if (b.turns > 1) buffs.push({ ...b, turns: b.turns - 1 }); }
  }
  // A skill seal / stun active this turn stops the cooldowns (Chaldea
  // canSkillCoolDown; checked before the buffs tick: the conservative side).
  let out: Unit = changed ? { ...u, buffs, cd: canSkill(u) ? sub3(u.cd, 1) : u.cd } : u;
  if (u.pending.length) {
    const left: Pending[] = [];
    const due: Pending[] = [];
    for (const p of u.pending) {
      if (p.wait > 1) left.push({ ...p, wait: p.wait - 1 });
      else { due.push(p); if (p.times > 1) left.push({ ...p, wait: 1, times: p.times - 1 }); }
    }
    out = { ...out, pending: left.length ? left : NO_PENDING };
    for (const p of due) out = effectOn(out, { ...p.e, deferred: undefined }, p.v);
  }
  return out;
}

/**
 * End of turn. Buff turns and skill cooldowns tick on the front line only
 * (in-game, back-line servants are frozen). A buff with turns N applied in
 * turn T is active for the NPs of turns T..T+N-1. Throws if any enemy is alive.
 */
export function endTurn(state: BattleState): BattleState {
  // The model assumes every wave dies on the turn it appears (enemies never
  // act); the enemy allow-list in quest.ts relies on it. enemies includes the
  // reserve (not entered yet, full HP), so this covers field and reserve.
  if (state.enemies.some((e) => e.hp > 0)) throw new Error('endTurn with living enemies');
  return {
    ...state,
    front: state.front.map((u) => (u ? tick(u) : null)),
    mcCd: state.mcCd.some((c) => c > 0) ? state.mcCd.map((c) => Math.max(0, c - 1)) : state.mcCd,
    turn: state.turn + 1, target: -1, npsFired: 0,
  };
}

export function nextWave(state: BattleState, quest: Quest, constants: Constants): BattleState {
  const enemies = quest.waves[state.wave + 1];
  if (!enemies) throw new Error('no next wave');
  const units = [...state.front.filter((u): u is Unit => u !== null), ...state.back];
  const lay = layoutOf(quest, state.wave + 1);
  // Turn start: empty front slots (a unit died) take the back line in order
  // (Chaldea _replenishActors).
  let front = state.front, back = state.back;
  if (front.some((u) => !u) && back.length) {
    const f = front.slice(), b = back.slice();
    for (let i = 0; i < f.length && b.length; i++) if (!f[i]) f[i] = b.shift()!;
    front = f; back = b;
  }
  return syncAuras({
    ...state, front, back, wave: state.wave + 1, enemies, ...waveState(lay),
    aff: affTable(constants, units, enemies),
  });
}

/** True when the buff counts for this card against this enemy. */
export function buffApplies(b: Buff, enemy: Enemy, card: Card): boolean {
  if (b.cards && !b.cards.includes(card)) return false;
  if (b.opTraits && !b.opTraits.some((t) => enemy.traits.includes(t))) return false;
  return true;
}

/**
 * Sum of the active buffs. cards / opTraits restrict a buff whatever its kind
 * (Atlas only sets opTraits when the buff has a ckOpIndv condition).
 * ocUp is in whole OC levels: Atlas upChagetd Value is 1 per level
 * (checked on buffs 227 "Overcharge Lv. Up" = 1 and 5124 "by 2" = 2).
 */
export function mods(unit: Unit, enemy: Enemy, card: Card): Mods {
  const m: Mods = { atkMod: 0, cardMod: 0, npDmgMod: 0, powerMod: 0, npGainMod: 0, ocUp: 0, dmgPlus: 0 };
  const rates = unit.buffs.filter((b) => b.kind === 'buffRate');
  for (const b of unit.buffs) {
    if (b.kind === 'buffRate' || b.kind === 'sealNp' || b.kind === 'sealSkill' || b.kind === 'stun' || b.kind === 'classRel' || !buffApplies(b, enemy, card)) continue;
    m[MOD_FIELD[b.kind]] += rates.length ? rated(b, rates) : b.value;
  }
  return m;
}

/**
 * A buff's value under buff effectiveness up (Chaldea's getBuffRateValue):
 * the rates of the holder's buffRate buffs whose traits match one of the
 * buff's (any-of) add up on a base of 1000, capped at 5000 (Atlas buffRate
 * action: baseParam 1000, maxRate 5000), and the value is multiplied by it,
 * truncated per buff. Only positive values are scaled (no modelled buff has a
 * negative one).
 */
export function rated(b: Buff, rates: readonly Buff[]): number {
  if (!b.buffTraits || b.value <= 0) return b.value;
  let r = 0;
  for (const x of rates) if (x.rateOf?.some((t) => b.buffTraits!.includes(t))) r += x.value;
  return r ? Math.trunc((b.value * Math.min(5000, Math.max(0, 1000 + r))) / 1000) : b.value;
}
