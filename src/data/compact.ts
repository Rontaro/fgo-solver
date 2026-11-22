import type {
  Card, Effect, EffectKind, TargetKind, Skill, NoblePhantasm,
  CompactServant, CompactCE, CompactMC, LevelVal, EventPassive, Deferred, PartUnsupported,
} from './types';

// Raw Atlas Academy input is untyped JSON: `any` on the input side only.
//
// Safety principle: ignoring an effect that can only help is safe (a combo may
// be missed, never reported wrongly). Anything that could hurt, or that we do
// not recognise, marks the entity unsupported.

const CARD_BY_ID: Record<string, Card> = { '1': 'arts', '2': 'buster', '3': 'quick' };
const CARD_BY_TRAIT: Record<number, Card> = { 4001: 'arts', 4002: 'buster', 4003: 'quick' };
const ALL_CARDS: Card[] = ['arts', 'buster', 'quick'];

type Side = 'ally' | 'enemy';
const SIDE: Record<string, Side> = {
  self: 'ally', ptOne: 'ally', ptAll: 'ally', ptOther: 'ally', ptFull: 'ally', ptOtherFull: 'ally',
  ptselectOneSub: 'ally',
  enemy: 'enemy', enemyAll: 'enemy',
};
const TARGET: Record<string, TargetKind> = {
  // *Full variants also reach the backline. Mapping them to the front-line
  // target only drops the buff on subs: conservative for modelled (helpful)
  // effects; harmful ones are unsupported whatever the target.
  self: 'self', ptOne: 'ptOne', ptAll: 'ptAll', ptOther: 'ptOther', ptFull: 'ptAll', ptOtherFull: 'ptOther',
  ptselectOneSub: 'orderChange',
  enemy: 'enemy', enemyAll: 'enemyAll',
};

// Buffs we model. Only on allies: on an enemy they are unsupported.
const BUFF_KIND: Record<string, EffectKind> = {
  upAtk: 'atkUp', upCommandall: 'cardUp', upNpdamage: 'npDmgUp',
  upDamage: 'powerUp', upDropnp: 'npGainUp', upChagetd: 'ocUp',
  // Card attack up: the same Atlas buff action (commandAtk) as upCommandall.
  upCommandatk: 'cardUp',
  // Flat extra damage per hit-sequence, added after flooring (engine dmgPlus).
  addDamage: 'dmgPlus',
};
// Functions we model. Only on allies.
const FUNC_KIND: Record<string, EffectKind> = {
  gainNp: 'gainNp', shortenSkill: 'shortenSkill', replaceMember: 'orderChange',
};

// On allies: survival, stars, crits, defence, taunt, debuff resist, face cards.
// Enemies are not simulated as attackers and face cards/crits are out of the
// 3T model, so these never change the outcome; none of them lowers our damage
// or NP gauge.
const IGNORED_BUFFS_ALLY = new Set([
  'invincible', 'specialInvincible', 'avoidance', 'upDefence', 'upDefencecommandall',
  'upCriticaldamage', 'upCriticalpoint', 'upCriticalrate', 'upStarweight', 'upDropstar',
  'upTolerance', 'upToleranceSubstate', 'regainNp', 'regainHp', 'regainStar', 'guts', 'gutsRatio',
  'upHate', 'avoidState', 'upGrantstate', 'upGivegainHp', 'upGainHp', 'addMaxhp', 'upDamagedropnp',
  'upResistInstantdeath', 'upNonresistInstantdeath',
  // Turns face cards into another type (Altria's Dragon's Core): face cards are
  // out of the model and the NP card itself is unchanged.
  'changeCommandCardType',
  // Hit through enemy invincible/evade: enemies never act in our model, so they
  // never have those buffs; it can only help.
  'pierceInvincible', 'breakAvoidance',
  // Damage cut / defence down on our side: survival only, enemies do not attack
  // in the model.
  'subSelfdamage', 'downDefence', 'downDefencecommandall',
  // Adds a trait to our servant: we never read ally traits added at runtime,
  // so at worst we miss a bonus that depends on it (conservative).
  'addIndividuality',
  // Ignore enemy DEF buffs: enemies have none in the model; only helps.
  'pierceDefence',
  // Crit damage taken / star absorption / instant-death odds and resist /
  // debuff resist down (demerit): crits, stars, enemy debuffs and death are out
  // of the model.
  'downCriticalRateDamageTaken', 'downStarweight', 'upGrantInstantdeath', 'avoidInstantdeath',
  // Our own crit damage / star drop down (CE demerits): crits and stars are out of the model.
  'downCriticaldamage', 'downCriticalpoint',
  'downTolerance',
  // Adds a field trait: field conditions are any-of and checked on the quest's
  // own traits (questCond), so an added trait can only make us miss a bonus.
  // Removing one (subFieldIndividuality) is not listed: unsupported.
  'fieldIndividuality',
  // Stronger DoT received by the holder (Super Orion's "Corroding Poison"
  // demerit): a DoT on our side cannot kill (see reduceHp below), so a
  // stronger one cannot either.
  'upFuncHpReduce',
  // Damage over time on the holder (The Black Grail's HP loss, burn, poison,
  // curse): it runs at a turn end, and in the model every turn ends with the
  // wave cleared (endTurn requires it), where Chaldea (endOfMyTurn) caps the
  // turn-end damage at HP - 1: it cannot kill, so it only touches HP, which
  // nothing we model reads.
  'reduceHp',
]);
// On enemies: only effects that help us (weaker / stunned / slower enemies).
// Ignoring them under-estimates our damage, which is the prudent direction.
const IGNORED_BUFFS_ENEMY = new Set([
  'downDefence', 'downDefencecommandall', 'donotAct', 'downAtk', 'downCriticalrate',
  'downCriticalpoint', 'downTolerance', 'downNpdamage',
  // Seal skills / seal NP / damage-over-time (burn, poison, curse): weaker
  // enemies; DoT is extra damage we do not count.
  'donotSkill', 'donotNoble', 'reduceHp',
  // Adds a trait to an enemy: we only miss supereffective/"vs trait" bonuses.
  'addIndividuality',
  // Stronger DoT on the enemy / higher death chance on it: extra damage or
  // kills we do not count.
  'upFuncHpReduce', 'upNonresistInstantdeath',
  // Enemy healing received down: we do not model enemy healing.
  'downGainHp',
  // Enemy immunity to debuffs: we never count our debuffs on enemies.
  'avoidState',
]);
const IGNORED_FUNCS_ALLY = new Set([
  'gainStar', 'gainHp', 'gainHpPer', 'none',
  // Self HP loss that cannot kill (HP stops at 1): survival only.
  'lossHpSafe',
  // Stars lost, popup text, face-card reshuffle: no effect on NPs.
  'lossStar', 'displayBuffstring', 'cardReset',
  // NP gain scaled by a buff count: helpful only, not modelled yet.
  'gainNpBuffIndividualSum',
  // Adds a field trait: same reasoning as fieldIndividuality.
  'addFieldChangeToField',
  // hastenNpturn on an ally with team player/playerAndEnemy (team=enemy variants
  // are skipped earlier, they only run when an enemy casts the skill). Its only
  // possible effect is to raise a charge/gauge, never to lower it: helpful only.
  'hastenNpturn',
  // Bond/drop/event-point bonuses: no battle effect.
  'servantFriendshipUp', 'eventDropUp', 'eventPointUp', 'eventDropRateUp', 'eventPointRateUp',
  'expUp', 'qpUp', 'qpDropUp', 'userEquipExpUp',
  // Friend points, encounter rates, drops and event points (Aerial Drive's
  // event bonus, the support friend-point CEs): no battle effect.
  'friendPointUp', 'friendPointUpDuplicate', 'enemyEncountRateUp', 'enemyEncountCopyRateUp', 'classDropUp',
  'eventFortificationPointUp',
]);
// hastenNpturn on an enemy (team player/playerAndEnemy) fills its charge bar:
// enemies are not simulated as attackers, so a charged enemy NP never changes
// whether our NPs clear the wave.
const IGNORED_FUNCS_ENEMY = new Set([
  'hastenNpturn', 'delayNpturn', 'absorbNpturn', 'instantDeath', 'gainHpFromTargets', 'subState', 'none',
  // Drains the enemy charge bar (lossNp on an enemy is charge, not our gauge).
  'lossNp', 'displayBuffstring',
]);
// subState on an ally is safe only when it removes nothing we model:
// debuffs (buffNegativeEffect, the DoT families poison / burn / curse, mental
// effects such as charm), defence ups (buffIncreaseDefence: not modelled on
// our side), and Lady Avalon's own NP charge block (a demerit).
const DEBUFF_TRAITS = new Set([3005, 3011, 3015, 3026, 3010, 3007, 2836]);

// Conditions we understand. Anything else on a modelled effect: dropped if the
// effect is helpful (we only lose a bonus), unsupported otherwise.
// Helpful = any modelled kind on an ally except orderChange (it moves members
// around, so it is not a pure bonus).
const NOT_HELPFUL = new Set<EffectKind>(['orderChange']);
const SVAL_KEYS = new Set([
  'Rate', 'Turn', 'Count', 'Value', 'ShowState', 'Correction', 'Target',
  // Display only: whether to show "MISS"/"NO EFFECT" popups (no game logic).
  'ShowQuestNoEffect', 'HideMiss', 'HideNoEffect',
  // Random pick among sets (ActSet + weight) or a player-chosen option
  // (ActSelectIndex): the effect is not guaranteed, so isChancy() turns it into
  // a failed chance (value 0) like Rate < 1000.
  'ActSet', 'ActSetWeight', 'ActSelectIndex',
]);
const CHANCE_KEYS = ['ActSet', 'ActSelectIndex'];
// ProgressSelfTurn: the buff's turns tick on its holder's turn (standard for
// player-side buffs, matches how we count turns).
// checkIndvType: how ckSelfIndv/ckOpIndv lists match (any vs all). Identical
// for lists of 0 or 1 traits, so it is accepted only then (see plain()).
// UpBuffRateBuffIndiv: which buffs a buffRate amplifies (read by classify).
const BUFF_SCRIPT_KEYS = new Set(['ProgressSelfTurn', 'checkIndvType', 'UpBuffRateBuffIndiv']);
// Function script keys we accept: funcIndividuality = the function's own
// traits, only when it is the "demerit" tag (3098). It only matters to effects
// that block demerits, which we never model: ignoring them can only keep a
// demerit we would in fact avoid.
const DEMERIT_FUNC = 3098;
/**
 * Buff traits a buffRate may target (Effect.rateOf / buffTraits). In NA and JP
 * the only buffRate (Oberon S3) targets buffNpDamageUp (3030), which every
 * upNpdamage buff carries. A buffRate targeting another trait is dropped
 * (helpful, so we only lose a bonus).
 */
export const RATE_TRAITS = new Set([3030]);
const OC_SVALS = ['svals2', 'svals3', 'svals4', 'svals5'];

// ignore.drop: the effect is helpful but not modelled (reported by the drop audit).
// demerit: a harmful effect on our side, applied as certain (see DEMERIT_BUFF).
type Class = { cls: 'apply'; kind: EffectKind; demerit?: boolean } | { cls: 'ignore'; drop?: string } | { cls: 'unsupported'; reason: string };
// Demerit buffs on our side we model (pessimistically: certain, unconditioned).
const DEMERIT_BUFF: Record<string, EffectKind> = { downAtk: 'atkUp', donotNoble: 'sealNp', donotSkill: 'sealSkill', donotAct: 'stun' };
const CONTROL_KINDS = new Set<EffectKind>(['sealNp', 'sealSkill', 'stun']);

const svalSets = (f: any): any[][] => [f.svals ?? [], ...OC_SVALS.map((k) => f[k]).filter(Boolean)];

/** buffRate: its UpBuffRateBuffIndiv traits, when all of them are tracked (RATE_TRAITS); else null. */
function rateTraitsOf(f: any): number[] | null {
  const tv: any[] = f.buffs?.[0]?.script?.UpBuffRateBuffIndiv ?? [];
  const ids = tv.map((t: any) => (t.negative ? -t.id : t.id));
  return ids.length && ids.every((id: number) => RATE_TRAITS.has(id)) ? ids : null;
}

/** Raw Atlas skills (as returned by /nice/{region}/skill/{id}) by skill id. */
export type TriggerLookup = Map<number, any>;

// Trigger buffs that only fire when the holder is hit, evades, gets guts or
// dies. Enemies do not act in our model, so on an ally they never fire: ignored
// with no lookup needed. On an enemy holder (fires when WE hit it) they are
// resolved like the ones below.
const TRIGGER_ON_HIT = new Set([
  'damageFunction', 'gutsFunction', 'deadFunction', 'counterFunction', 'reflectionFunction',
  'avoidFunctionExecuteSelf',
]);
// Trigger buffs whose svals.Value is the id of the skill they run (level in
// Value2). Resolved through the lookup and classified recursively.
export const TRIGGER_BUFFS = new Set([
  'attackBeforeFunction', 'attackAfterFunction', 'attackAfterFunctionMainOnly',
  'commandattackBeforeFunction', 'commandattackBeforeFunctionMainOnly',
  'commandattackAfterFunction', 'commandattackAfterFunctionMainOnly',
  'selfturnstartFunction', 'selfturnendFunction', 'delayFunction', 'entryFunction',
  'npattackPrevBuff', 'skillBeforeFunction', 'treasureDeviceBeforeFunction', 'confirmCommandFunction',
  ...TRIGGER_ON_HIT,
]);
const TRIGGER_DEPTH = 2;

/** Skill ids a trigger buff function points to (every level and OC variant). */
export function triggerSkillIds(f: any): number[] {
  const t = f.buffs?.[0]?.type;
  if (!t || !TRIGGER_BUFFS.has(t)) return [];
  const ids = new Set<number>();
  for (const k of ['svals', ...OC_SVALS]) for (const v of f[k] ?? []) if (v.Value) ids.add(v.Value);
  return [...ids];
}

interface Ctx { triggers?: TriggerLookup; depth: number; flip: boolean; allowLoss?: boolean; }

// Sides inside a triggered skill are relative to the buff holder: when the
// holder is an enemy, its "self" is the enemy side and its "enemy" is us.
function sideOf(f: any, ctx: Ctx): Side | undefined {
  const s = SIDE[f.funcTargetType];
  if (!s || !ctx.flip) return s;
  return s === 'ally' ? 'enemy' : 'ally';
}

// A trigger buff is ignored when every function of every skill it can run is
// helpful or ignored. The extra help is not modelled (conservative); modelling
// attackAfter NP-gain triggers is a later improvement.
function classifyTrigger(f: any, t: string, side: Side, ctx: Ctx): Class {
  const at = side === 'enemy' ? '@enemy' : '';
  if (side === 'ally' && TRIGGER_ON_HIT.has(t)) return { cls: 'ignore' };
  if (!ctx.triggers) return { cls: 'unsupported', reason: 'buff:' + t + at };
  const fail = (why: string): Class => ({ cls: 'unsupported', reason: 'trigger:' + t + at + ':' + why });
  if (ctx.depth >= TRIGGER_DEPTH) return fail('depth');
  const ids = triggerSkillIds(f);
  if (!ids.length) return fail('noSkill');
  const inner: Ctx = { triggers: ctx.triggers, depth: ctx.depth + 1, flip: side === 'enemy' };
  for (const id of ids) {
    const skill = ctx.triggers.get(id);
    if (!skill) return fail('missing:' + id);
    for (const g of skill.functions ?? []) {
      // funcTargetTeam is about the caster (the holder): skip what does not run.
      if (g.funcTargetTeam === (inner.flip ? 'player' : 'enemy')) continue;
      // Extra damage on the opposing side: only more damage, not counted.
      if (String(g.funcType).startsWith('damageNp') && sideOf(g, inner) === 'enemy') continue;
      const c = classify(g, inner);
      if (c.cls === 'unsupported') return fail(c.reason);
      if (c.cls === 'apply' && NOT_HELPFUL.has(c.kind)) return fail(c.kind);
    }
  }
  return { cls: 'ignore', drop: 'trigger:' + t };
}

// Debuffs on enemies we model (EffectKind defDown / cardResDown), when cast
// directly by our skills / NPs (not from inside trigger buffs).
const ENEMY_DEBUFF_KIND: Record<string, EffectKind> = { downDefence: 'defDown', downDefencecommandall: 'cardResDown' };

function classify(f: any, ctx: Ctx = { depth: 0, flip: false }): Class {
  const side = sideOf(f, ctx);
  if (!side) return { cls: 'unsupported', reason: 'target:' + f.funcTargetType };
  const at = side === 'enemy' ? '@enemy' : '';
  if (f.funcType === 'addState' || f.funcType === 'addStateShort') {
    const t: string | undefined = f.buffs?.[0]?.type;
    if (!t) return { cls: 'unsupported', reason: 'buff:none' };
    if (side === 'ally' && BUFF_KIND[t]) return { cls: 'apply', kind: BUFF_KIND[t] };
    if (side === 'enemy' && ENEMY_DEBUFF_KIND[t] && ctx.depth === 0 && !ctx.flip) return { cls: 'apply', kind: ENEMY_DEBUFF_KIND[t] };
    if (side === 'ally' && DEMERIT_BUFF[t] && ctx.depth === 0 && !ctx.flip) return { cls: 'apply', kind: DEMERIT_BUFF[t], demerit: true };
    // Special attack up vs enemies in some state (burn, curse...: buff traits
    // we do not track): helps, dropped. A negative value (a damage down) would
    // hurt: unsupported.
    if (side === 'ally' && (t === 'upDamageIndividuality' || t === 'upDamageIndividualityActiveonly')) {
      if (svalSets(f).some((set) => set.some((v: any) => (v.Value ?? 0) < 0))) return { cls: 'unsupported', reason: 'buff:' + t + '-' };
      return { cls: 'ignore', drop: 'buff:' + t };
    }
    if (side === 'ally' && t === 'buffRate') {
      // A rate down (negative) would weaken our buffs: unsupported. A rate up only
      // helps: modelled when it targets traits we track, else dropped.
      if (svalSets(f).some((set) => set.some((v: any) => (v.Value ?? 0) < 0))) return { cls: 'unsupported', reason: 'buff:buffRate-' };
      return rateTraitsOf(f) ? { cls: 'apply', kind: 'buffRate' } : { cls: 'ignore', drop: 'buffRate:untracked' };
    }
    if ((side === 'ally' ? IGNORED_BUFFS_ALLY : IGNORED_BUFFS_ENEMY).has(t)) return { cls: 'ignore' };
    if (TRIGGER_BUFFS.has(t)) return classifyTrigger(f, t, side, ctx);
    return { cls: 'unsupported', reason: 'buff:' + t + at };
  }
  if (side === 'ally' && FUNC_KIND[f.funcType]) return { cls: 'apply', kind: FUNC_KIND[f.funcType] };
  // Inside a deferred (end-of-turn) effect only: see EffectKind 'lossNp'.
  if (side === 'ally' && ctx.allowLoss && f.funcType === 'lossNp') return { cls: 'apply', kind: 'lossNp' };
  // Immediate NP loss on our side (a skill / NP demerit).
  if (side === 'ally' && ctx.depth === 0 && !ctx.flip && f.funcType === 'lossNp') return { cls: 'apply', kind: 'lossNp', demerit: true };
  if (side === 'ally' && f.funcType === 'gainNpBuffIndividualSum') return { cls: 'ignore', drop: 'func:gainNpBuffIndividualSum' };
  if (side === 'ally' && f.funcType === 'subState') {
    const tv: number[] = (f.traitVals ?? []).map((t: any) => t.id);
    if (tv.length && tv.every((id) => DEBUFF_TRAITS.has(id))) return { cls: 'ignore' };
  }
  if ((side === 'ally' ? IGNORED_FUNCS_ALLY : IGNORED_FUNCS_ENEMY).has(f.funcType)) return { cls: 'ignore' };
  return { cls: 'unsupported', reason: 'func:' + f.funcType + at };
}

// True when the function carries no condition beyond the ones we model.
// functvals = traits the target must have. On a self-targeted function, traits
// the servant always has (its base traits) make the condition always true.
// quest: also accept the quest conditions (field traits, EventId), which
// questCond() turns into Effect.fieldTraits / eventId.
function plain(f: any, selfTraits?: Set<number>, quest = false): boolean {
  const tv: number[] = (f.functvals ?? []).map((t: any) => t.id);
  const tvOk = !tv.length || (f.funcTargetType === 'self' && !!selfTraits && tv.every((id) => selfTraits.has(id)));
  if (!tvOk || f.overWriteTvalsList?.length) return false;
  if (f.funcquestTvals?.length && !quest) return false;
  if (f.script && Object.entries(f.script).some(([k, v]: [string, any]) =>
    k !== 'funcIndividuality' || !Array.isArray(v) || v.some((t: any) => t.id !== DEMERIT_FUNC))) return false;
  for (const k of ['svals', ...OC_SVALS]) {
    for (const v of f[k] ?? []) if (Object.keys(v).some((key) => !SVAL_KEYS.has(key) && !(quest && key === 'EventId'))) return false;
  }
  const b = f.buffs?.[0];
  const script = b?.script ?? {};
  if (!Object.keys(script).every((k) => BUFF_SCRIPT_KEYS.has(k))) return false;
  if ('checkIndvType' in script && ((b.ckSelfIndv?.length ?? 0) > 1 || (b.ckOpIndv?.length ?? 0) > 1)) return false;
  return true;
}

const isChancy = (v: any) => CHANCE_KEYS.some((k) => k in v);

/*
 * Quest conditions of a function, as Chaldea's FunctionExecutor checks them
 * when the function runs: funcquestTvals against the quest's field traits
 * (positive ids: any-of; negative ids: none-of) and svals EventId against the
 * war's event (0 = none). Field traits only change at runtime through buffs we
 * ignore (fieldIndividuality, addFieldChangeToField), which only add traits:
 * an any-of condition evaluated on the quest's own traits can then only be
 * missed, never wrongly met. A negative trait could be wrongly met, so it is
 * unevaluable (null), as is an EventId that varies across levels.
 */
function questCond(f: any): { fieldTraits?: number[]; eventId?: number } | null {
  const fieldTraits: number[] = (f.funcquestTvals ?? []).map((t: any) => t.id);
  if (fieldTraits.some((id) => id <= 0)) return null;
  const ev = new Set<number>();
  for (const k of ['svals', ...OC_SVALS]) for (const v of f[k] ?? []) ev.add(v.EventId ?? 0);
  if (ev.size > 1) return null;
  const eventId = [...ev][0] ?? 0;
  return { ...(fieldTraits.length && { fieldTraits }), ...(eventId && { eventId }) };
}

function levels(svals: any[], ok: boolean[]): LevelVal[] {
  return svals.map((v, i) => ({ value: ok[i] ? v.Value ?? 0 : 0, turns: v.Turn ?? -1, count: v.Count ?? -1 }));
}

interface ConvOpts {
  npDamage?: any;   // the NP's main damage function: skipped, splits pre/post extras
  npExtras?: boolean; // NP extras: fill Effect.oc when OC variants differ
  selfTraits?: Set<number>; // the servant's base traits (self functvals check)
  triggers?: TriggerLookup; // skills run by trigger buffs; absent = triggers unsupported
  /**
   * Servant skills only: end-of-turn triggers (delayFunction,
   * selfturnendFunction) become deferred effects when possible (deferredOf);
   * when not, a harmful one goes to `restrict` (the skill becomes last-turn
   * only) instead of `unsupported`.
   */
  restrict?: string[];
  /** Drop audit sink: one tag per helpful effect that is not modelled (see convertFunctions). */
  drops?: string[];
  /** Internal (deferred conversion): accept lossNp on the holder. */
  allowLoss?: boolean;
  /** CE / event passive (battle start): mark party reach and OnField auras (Effect.full / onField). */
  start?: boolean;
  /** The servant's HP at level 1 (Atlas hpBase): a self HP loss it cannot die of is ignored. */
  hpMin?: number;
}

/**
 * Battle-start effects (opts.start): sval OnField = 1 on every level and
 * variant ties the buff to its holder being on the field. Returns the
 * function without the key (so plain() accepts it) and whether it was there;
 * only permanent buffs (Turn and Count -1) qualify, others keep the key and
 * stay unmodelled.
 */
function stripOnField(f: any): { f: any; onField: boolean } {
  const sets: any[][] = ['svals', ...OC_SVALS].map((k) => f[k] ?? []).filter((x: any[]) => x.length);
  const all = sets.flat();
  if (!all.length || !all.every((v) => v.OnField === 1)) return { f, onField: false };
  if (!all.every((v) => (v.Turn ?? -1) === -1 && (v.Count ?? -1) === -1)) return { f, onField: false };
  const out = { ...f };
  for (const k of ['svals', ...OC_SVALS]) if (f[k]) out[k] = f[k].map((v: any) => { const o = { ...v }; delete o.OnField; return o; });
  return { f: out, onField: true };
}

/** End-of-turn trigger buffs that can become deferred effects (Effect.deferred). */
const DEFER: Record<string, Deferred['at']> = { delayFunction: 'delay', selfturnendFunction: 'turnEnd' };
// Kinds a deferred effect may have: buffs and charge on the holder, its NP
// drain, a cooldown cut. Not orderChange.
const DEFER_KINDS = new Set<EffectKind>(['atkUp', 'cardUp', 'npDmgUp', 'powerUp', 'npGainUp', 'ocUp', 'dmgPlus', 'buffRate', 'gainNp', 'lossNp', 'shortenSkill']);

/*
 * An end-of-turn trigger buff given to an ally (f: addState of delayFunction /
 * selfturnendFunction), as effects that run on the holder later. Chaldea
 * (svt_entity.dart endOfMyTurn / endOfYourTurn): a delayFunction with Turn N
 * fires its skill once, when the buff expires, i.e. at the end of the N-th
 * turn (the triggered skill at level Value2); a selfturnendFunction fires its
 * skill at the end of each of the holder's turns while it lasts (Turn turns,
 * Count uses). Only for triggered skills whose every function runs on the
 * holder itself and converts to a DEFER_KIND under no condition (or is
 * ignored). Returns the effects, or a reason string.
 */
function deferredOf(f: any, at: Deferred['at'], opts: ConvOpts): Effect[] | string {
  const target = TARGET[f.funcTargetType];
  if (!target || target === 'orderChange') return 'target';
  if (!opts.triggers) return 'noLookup';
  const svals: any[] = f.svals ?? [];
  // Value2 = the triggered skill's level: part of the trigger, not a condition.
  const noLevel = (v: any) => { const o = { ...v }; delete o.Value2; return o; };
  if (!plain({ ...f, svals: svals.map(noLevel) }, opts.selfTraits)) return 'cond';
  if (!svals.length) return 'noSkill';
  const ids = new Set(svals.map((v) => v.Value));
  if (ids.size !== 1) return 'skillPerLevel';
  if (svals.some((v) => isChancy(v) || (v.Rate ?? 1000) < 1000)) return 'rate';
  const turnSet = new Set(svals.map((v) => `${v.Turn ?? -1},${v.Count ?? -1}`));
  if (turnSet.size !== 1) return 'turnsPerLevel';
  const turn = svals[0].Turn ?? -1, count = svals[0].Count ?? -1;
  let turns: number;
  if (at === 'delay') {
    if (turn < 1) return 'noDelay';
    turns = turn;
  } else {
    turns = count > 0 && turn > 0 ? Math.min(count, turn) : count > 0 ? count : turn;
    if (!(turns > 0)) return 'unbounded';
  }
  const id = [...ids][0];
  const skill = opts.triggers.get(id);
  if (!skill) return 'missing:' + id;
  const out: Effect[] = [];
  for (const g of skill.functions ?? []) {
    if (g.funcTargetTeam === 'enemy') continue; // runs only when an enemy holds it
    // The triggered skill at level Value2 of each outer level.
    const lvSvals = svals.map((v) => g.svals?.[(v.Value2 ?? 1) - 1] ?? g.svals?.[0]);
    if (lvSvals.some((v) => !v)) return 'noLevel';
    const inner: string[] = [];
    const es = convertFunctions([{ ...g, svals: lvSvals }], inner, { triggers: opts.triggers, allowLoss: true, drops: opts.drops });
    if (inner.length) return inner[0];
    for (const e of es) {
      if (e.target !== 'self' || !DEFER_KINDS.has(e.kind)) return 'inner:' + e.kind + '@' + e.target;
      out.push({ ...e, target, deferred: { at, turns } });
    }
  }
  return out;
}

/*
 * Rate rules (applied after classification, so ignored effects are never
 * looked at and unsupported ones are reported whatever their Rate):
 * - Rate >= 1000: guaranteed (MCs use 5000).
 * - 0 <= Rate < 1000: chance-based, treated as absent: a modelled (helpful)
 *   effect gets value 0 at that level; if no level is guaranteed it is dropped.
 * - Rate < 0: dependent follow-up, runs only if the previous function in the
 *   same list succeeded. Kept only when |Rate| >= 1000 and the previous function
 *   was applied unconditionally (ally target, no extra conditions, guaranteed
 *   at every level). Otherwise treated like a failed chance (value 0).
 * - ActSet / ActSelectIndex (random or player-chosen option): not guaranteed,
 *   handled like 0 <= Rate < 1000.
 * Rate is evaluated per level, since it can vary across levels.
 * lossNp (deferred only) must be guaranteed at every level: a drain we cannot
 * count on either way is unsupported.
 *
 * Drop audit (opts.drops): a helpful effect that is not modelled is tagged
 * '<why>:<kind or type>' with why = rate (not guaranteed at the top level),
 * actSet (random / chosen option at the top level), cond (condition we cannot
 * evaluate), holderTrait (condition on the holder's traits), trigger (trigger
 * buff whose skill only helps), buffRate / func (helpful kind not modelled).
 */
export function convertFunctions(funcs: any[], unsupported: string[], opts: ConvOpts = {}): Effect[] {
  const out: Effect[] = [];
  const drop = (tag: string) => opts.drops?.push(tag);
  let prevOk = false;
  let afterDamage = false;
  for (const f0 of funcs) {
    if (opts.npDamage && f0 === opts.npDamage) { prevOk = true; afterDamage = true; continue; }
    const { f, onField } = opts.start ? stripOnField(f0) : { f: f0, onField: false };
    // team=enemy: only runs when an enemy casts it. Never for our side.
    if (f.funcTargetTeam === 'enemy') { prevOk = false; continue; }
    const svals: any[] = f.svals ?? [];
    // svals = OC1; svals2..svals5 = OC2..OC5 (NP functions only). The Rate rule
    // applies to every OC variant; plain() checks the keys of all of them.
    const sets: any[][] = svalSets(f);
    const isPlain = plain(f, opts.selfTraits);
    // Not plain only because of quest conditions: kept with them when evaluable.
    const qc = isPlain ? {} : plain(f, opts.selfTraits, true) ? questCond(f) : null;
    const okOf = (set: any[]) => set.map((v) => {
      if (isChancy(v)) return false;
      const r = v.Rate ?? 1000;
      return r >= 1000 || (r <= -1000 && prevOk);
    });
    const setOk = sets.map(okOf);
    const lvOk = setOk[0];
    prevOk = SIDE[f.funcTargetType] === 'ally' && isPlain && lvOk.length > 0 && setOk.every((s) => s.every(Boolean));

    // Self HP loss (NP / skill demerit): ignored when even five uses (more NPs
    // than a battle has turns) cannot kill the servant at level 1 with no fou;
    // else an EffectKind lossHp the engine counts against CompactServant.hp.
    // Certain whatever its Rate (pessimistic).
    if (f.funcType === 'lossHp' && f.funcTargetType === 'self' && f.funcTargetTeam !== 'enemy' && opts.hpMin
      && Object.keys(f.svals?.[0] ?? {}).every((k) => ['Rate', 'Value', 'EvenIfWinDie'].includes(k))) {
      prevOk = false;
      if (sets.flat().every((v: any) => (v.Value ?? 0) * 5 < opts.hpMin!)) continue;
      const lvHp = (set: any[]) => set.map((v) => ({ value: Math.abs(v.Value ?? 0), turns: -1, count: -1 }));
      const e: Effect = { kind: 'lossHp', target: 'self', lv: lvHp(svals) };
      if (opts.npExtras && sets.length === 5 && sets.some((s) => JSON.stringify(s) !== JSON.stringify(svals))) e.oc = sets.map(lvHp);
      if (opts.npDamage && !afterDamage) e.pre = true;
      out.push(e);
      continue;
    }
    const ctx: Ctx = { triggers: opts.triggers, depth: 0, flip: false, allowLoss: opts.allowLoss };
    const bt: string | undefined = f.buffs?.[0]?.type;
    const isState = f.funcType === 'addState' || f.funcType === 'addStateShort';
    const at = isState && bt ? DEFER[bt] : undefined;
    if (at && opts.restrict && SIDE[f.funcTargetType] === 'ally') {
      const d = deferredOf(f, at, opts);
      if (typeof d !== 'string') { out.push(...d); continue; }
      const c = classify(f, ctx);
      if (c.cls === 'ignore') { if (c.drop) drop(c.drop + ':' + d); continue; }
      // Harmful or unknown, but it only runs at a turn end: fine on the last turn.
      opts.restrict.push(c.cls === 'unsupported' ? c.reason : 'trigger:' + bt + ':' + d);
      continue;
    }
    const c = classify(f, ctx);
    if (c.cls === 'ignore') { if (c.drop) drop(c.drop); continue; }
    if (c.cls === 'unsupported') { unsupported.push(c.reason); continue; }
    const demerit = !!c.demerit;
    // Helpful effect under a condition we cannot evaluate: dropped (we only lose
    // a bonus). A non-helpful one is unsupported, quest conditions included.
    if (!isPlain && (!qc || NOT_HELPFUL.has(c.kind) || demerit)) {
      if (NOT_HELPFUL.has(c.kind) || demerit) unsupported.push('cond:' + f.funcType);
      else drop('cond:' + c.kind);
      continue;
    }
    if (demerit) {
      // Certain whatever its Rate (pessimistic): seals / stun count 1, an ATK
      // down is a negative atkUp, an NP loss its value. No condition kept.
      const lvAll = (set: any[]) => set.map((v) => ({
        value: CONTROL_KINDS.has(c.kind) ? 1 : c.kind === 'atkUp' ? -Math.abs(v.Value ?? 0) : Math.abs(v.Value ?? 0),
        turns: v.Turn ?? -1, count: v.Count ?? -1,
      }));
      const e: Effect = { kind: c.kind, target: TARGET[f.funcTargetType], lv: lvAll(svals) };
      if (opts.npExtras && sets.length === 5 && sets.some((s) => JSON.stringify(s) !== JSON.stringify(svals))) e.oc = sets.map(lvAll);
      if (opts.npDamage && !afterDamage) e.pre = true;
      out.push(e);
      continue;
    }
    if (c.kind === 'lossNp') {
      if (!setOk.every((s) => s.every(Boolean))) { unsupported.push('func:lossNp:rate'); continue; }
    } else {
      const top = svals.length - 1;
      if (top >= 0 && !lvOk[top]) drop((isChancy(svals[top]) ? 'actSet:' : 'rate:') + c.kind);
      if (!setOk.some((s) => s.some(Boolean))) continue;
    }

    // lv = OC1 values: code that ignores OC stays conservative for helpful effects.
    const e: Effect = { kind: c.kind, target: TARGET[f.funcTargetType], lv: levels(svals, lvOk), ...qc };
    if (opts.start && (f.funcTargetType === 'ptFull' || f.funcTargetType === 'ptOtherFull')) e.full = true;
    if (onField) e.onField = true;
    if (opts.npExtras && sets.length === 5 && sets.some((s) => JSON.stringify(s) !== JSON.stringify(svals))) {
      e.oc = sets.map((s, i) => levels(s, setOk[i]));
    }
    if (isState) {
      const b = f.buffs[0];
      const self: number[] = (b.ckSelfIndv ?? []).map((t: any) => t.id);
      const op: number[] = (b.ckOpIndv ?? []).map((t: any) => t.id);
      if (c.kind === 'defDown' || c.kind === 'cardResDown') {
        // On the enemy: ckOpIndv = the attacking card (or attacker traits),
        // ckSelfIndv = traits the enemy must have. Only card conditions are
        // modelled; any other condition drops the (helpful) debuff.
        const cards = op.map((id) => CARD_BY_TRAIT[id]).filter(Boolean);
        if (self.length || cards.length !== op.length) { drop('holderTrait:' + c.kind); continue; }
        if (cards.length) e.cards = cards;
      } else if (c.kind === 'cardUp') {
        // Empty ckSelfIndv = unconditioned: applies to every card, NP card included.
        const cards = self.length ? self.map((id) => CARD_BY_TRAIT[id]).filter(Boolean) : ALL_CARDS;
        // A non-card trait in ckSelfIndv is a holder condition: dropped (helpful).
        if (cards.length !== self.length && self.length) { drop('holderTrait:' + c.kind); continue; }
        e.cards = cards;
      } else if (self.length) { drop('holderTrait:' + c.kind); continue; } // holder-trait condition on a helpful buff
      const onEnemy = c.kind === 'defDown' || c.kind === 'cardResDown';
      if (op.length && !onEnemy) e.opTraits = op;
      if (c.kind === 'buffRate') e.rateOf = rateTraitsOf(f)!;
      else if (!onEnemy) {
        const tr: number[] = (b.vals ?? []).map((t: any) => t.id).filter((id: number) => RATE_TRAITS.has(id));
        if (tr.length) e.buffTraits = tr;
      }
    }
    if (opts.npDamage && !afterDamage) e.pre = true;
    out.push(e);
  }
  return out;
}

/** Drop audit: the helpful effects a part does not model (see convertFunctions). part: s1..s3, np, passive, ce, ceMlb. */
export interface PartDrops { part: string; drops: string[]; }

const uniq = (xs: string[]) => [...new Set(xs)];

function skillsOf(raw: any[], base: ConvOpts, report?: PartDrops[]): Skill[] {
  // Same num appears once per upgrade (rank-up/interlude): highest priority wins.
  const byNum = new Map<number, any>();
  for (const s of raw) if (!byNum.has(s.num) || s.priority > byNum.get(s.num).priority) byNum.set(s.num, s);
  return [...byNum.values()].sort((a, b) => a.num - b.num).map((s) => {
    // Per skill: what it cannot model makes only this skill unavailable.
    const unsupported: string[] = [], restrict: string[] = [], drops: string[] = [];
    const effects = convertFunctions(s.functions, unsupported, { ...base, restrict, drops });
    if (drops.length) report?.push({ part: 's' + s.num, drops: uniq(drops) });
    return {
      num: s.num, cooldown: s.coolDown, effects,
      ...(unsupported.length && { unsupported: uniq(unsupported) }),
      ...(restrict.length && { lastTurnOnly: uniq(restrict) }),
    };
  });
}

const isDamage = (f: any) => f.funcType.startsWith('damageNp');

/** servantLevel: for what concerns the whole servant (an NP card we cannot read: no NP at all). */
function npOf(svt: any, servantLevel: string[], base: ConvOpts, report?: PartDrops[]): NoblePhantasm | null {
  // Highest priority NP is the current one (last wins ties).
  let np: any = null;
  for (const n of svt.noblePhantasms) if (!np || n.priority >= np.priority) np = n;
  if (!np) return null;
  // Support NPs (no damage, e.g. Castoria) are not wave clearers: null.
  const dmg = np.functions.find(isDamage);
  if (!dmg) return null;
  const card = CARD_BY_ID[String(np.card)];
  if (!card) { servantLevel.push('np:card:' + np.card); return null; }
  const unsupported: string[] = [], drops: string[] = [];
  const se = dmg.funcType === 'damageNpIndividual';
  const ocs: any[][] = [dmg.svals, ...OC_SVALS.map((k) => dmg[k])];
  // damageNpPierce = damageNp that ignores enemy DEF buffs: computing it with
  // the enemy's DEF up (Enemy.defUp) only under-estimates it.
  // Variants computed at their base rate (Chaldea damage.dart: specific attack
  // rate 1000 unless a condition holds): damageNpStateIndividualFix (vs an
  // enemy in some state: burn, charm... we do not track), damageNpRare (vs
  // enemies of some rarity), damageNpHpratioLow (more damage the lower the
  // servant's HP: ours never drops, HP loss is not modelled). Under-estimates.
  const BASE_RATE: Record<string, string[]> = {
    damageNpStateIndividualFix: ['Target', 'Correction', 'IncludeIgnoreIndividuality'],
    damageNpRare: ['Target', 'Correction', 'TargetRarityList'],
    damageNpHpratioLow: ['Target'],
    damageNpIndividualSum: ['Target', 'TargetList', 'Correction', 'Value2', 'ParamAddMaxCount', 'IncludeIgnoreIndividuality', 'IgnoreIndivUnreleaseable'],
  };
  const isSum = dmg.funcType === 'damageNpIndividualSum';
  const plainDmg = dmg.funcType === 'damageNp' || dmg.funcType === 'damageNpPierce' || !!BASE_RATE[dmg.funcType];
  if (!plainDmg && !se) unsupported.push('np:' + dmg.funcType);
  const keys = BASE_RATE[dmg.funcType] ?? [];
  const strip = (v: any) => { const o = { ...v }; for (const k of keys) delete o[k]; return o; };
  const bare = { ...dmg, svals: dmg.svals.map(strip), ...Object.fromEntries(OC_SVALS.filter((k) => dmg[k]).map((k) => [k, dmg[k].map(strip)])) };
  if (!plain(bare)) unsupported.push('cond:' + dmg.funcType);
  let sum: NoblePhantasm['sum'];
  if (isSum) {
    const all = ocs.flat();
    const v0 = dmg.svals[0];
    const same = (k: string) => all.every((v) => JSON.stringify(v[k]) === JSON.stringify(v0[k]));
    if (all.some((v) => !((v.Value2 ?? 0) >= 1000 && (v.Correction ?? 0) >= 0)) || !same('Target') || !same('TargetList') || !same('ParamAddMaxCount')
      || !Array.isArray(v0.TargetList)) unsupported.push('np:damageNpIndividualSum:shape');
    else sum = {
      onEnemy: v0.Target === 1, traits: v0.TargetList,
      base: ocs.map((oc) => oc.map((v) => v.Value2)), step: ocs.map((oc) => oc.map((v) => v.Correction ?? 0)),
      max: v0.ParamAddMaxCount ?? 0,
    };
  }
  if (ocs.some((oc) => oc.some((v) => (v.Rate ?? 1000) < 1000))) unsupported.push('np:rate');
  // Any other damageNp* in the list is reported unsupported by convertFunctions.
  const extra = convertFunctions(np.functions, unsupported, { ...base, npDamage: dmg, npExtras: true, drops });
  if (drops.length) report?.push({ part: 'np', drops: uniq(drops) });
  return {
    card,
    aoe: dmg.funcTargetType === 'enemyAll',
    mult: ocs.map((oc) => oc.map((v) => v.Value)),
    seMult: se ? ocs.map((oc) => oc.map((v) => v.Correction)) : undefined,
    seTraits: se ? [dmg.svals[0].Target] : undefined,
    ...(sum && { sum }),
    hits: np.npDistribution,
    npRate: np.npGain.np,
    extra,
    ...(unsupported.length && { unsupported: uniq(unsupported) }),
  };
}

/** Icon URL (Atlas CDN, never re-hosted) from an extraAssets face map:
 *  the "1" key (first ascension) when present, else the first entry. */
export function faceOf(faces: Record<string, string> | undefined): string {
  if (!faces) return '';
  return faces['1'] ?? Object.values(faces)[0] ?? '';
}

/*
 * Event bonus passives (Atlas extraPassive with an eventId), as Chaldea's
 * activateExtraPassive: at battle start, the skills whose event is the quest
 * war's event, one per event (the highest priority). An event is kept only when
 * none of its skills has a release condition (bond rank, ascension, level,
 * quest, releaseConditions): those depend on account data we do not have, and
 * a conditioned skill may be the one that wins on priority. Event-less extra
 * passives are campaign bonuses (Chaldea skips the limited ones): ignored.
 */
function eventPassivesOf(svt: any, unsupported: string[], base: ConvOpts): EventPassive[] {
  const byEvent = new Map<number, { skills: any[]; ok: boolean }>();
  for (const sk of svt.extraPassive ?? []) {
    const eps: any[] = sk.extraPassive ?? [];
    const first = eps[0]?.eventId ?? 0;
    if (!first) continue;
    const g = byEvent.get(first) ?? { skills: [], ok: true };
    byEvent.set(first, g);
    g.skills.push(sk);
    if (eps.some((ep) => ep.condFriendshipRank || ep.condLimitCount || ep.condLv || ep.condQuestId || ep.releaseConditions?.length)) g.ok = false;
  }
  const out: EventPassive[] = [];
  for (const g of byEvent.values()) {
    if (!g.ok) continue;
    let best: any = null;
    for (const sk of g.skills) if (!best || (sk.extraPassive[0].priority ?? 0) > (best.extraPassive[0].priority ?? 0)) best = sk;
    const effects = convertFunctions(best.functions, unsupported, { ...base, start: true });
    if (!effects.length) continue;
    const eventIds = [...new Set<number>(best.extraPassive.flatMap((ep: any) => [ep.eventId, ep.script?.otherValidEventId ?? 0]).filter(Boolean))];
    out.push({ eventIds, effects });
  }
  return out;
}

/*
 * Buff success rate down (downGrantstate) that a passive puts on some allies
 * (Oberon: "Decrease Buff Success Rate for all [Merlin] allies", ptFull with
 * functvals = the trait the ally must have). In Chaldea (add_state.dart) the
 * caster's grantState is added to the function Rate, so a buff that ally casts
 * at Rate 1000 drops below 100% and fails at the default threshold. Modelled
 * as CompactServant.castBlockTraits: the engine drops every buff such an ally
 * casts (also the Rate 5000 ones that would still pass: conservative). Returns
 * the traits, or null when the function is not of that form.
 */
function castBlockOf(f: any): number[] | null {
  if (f.funcType !== 'addState' && f.funcType !== 'addStateShort') return null;
  if (f.buffs?.[0]?.type !== 'downGrantstate' || f.funcTargetTeam === 'enemy') return null;
  if (!['ptAll', 'ptFull', 'ptOther', 'ptOtherFull'].includes(f.funcTargetType)) return null;
  const tv: number[] = (f.functvals ?? []).map((t: any) => t.id);
  if (!tv.length || tv.some((id) => id <= 0) || f.funcquestTvals?.length) return null;
  return tv;
}

/**
 * `triggers`: skills run by trigger buffs (built by scripts/build-data.mjs).
 * Without it, trigger buffs other than the on-hit ones are unsupported.
 * `report`: drop audit sink (helpful effects not modelled, per part).
 */
export function compactServant(svt: any, triggers?: TriggerLookup, report?: PartDrops[]): CompactServant {
  const unsupported: string[] = [];
  // appendPassive num 100..104 = append 1..5; append 2 (num 101) is "Load Magical Energy".
  const selfTraits = new Set<number>(svt.traits.map((t: any) => t.id));
  const base: ConvOpts = { selfTraits, triggers, hpMin: svt.hpBase };
  // A form change (e.g. Mélusine, Ptolemaios) swaps skills and NP: the highest
  // priority skill/NP picked below may only exist after it. Checked on every
  // skill and NP variant, not only the chosen ones.
  const groups = [...svt.skills, ...svt.noblePhantasms];
  if (groups.some((g: any) => g.functions.some((f: any) => f.funcType === 'transformServant' && f.funcTargetTeam !== 'enemy'))) {
    unsupported.push('func:transformServant');
  }
  const append2 = svt.appendPassive?.find((a: any) => a.num === 101)?.skill;
  const eventPassives = eventPassivesOf(svt, unsupported, base);
  const castBlock = new Set<number>();
  const passiveDrops: string[] = [];
  const passives = svt.classPassive.flatMap((p: any) => convertFunctions(p.functions.filter((f: any) => {
    const tv = castBlockOf(f);
    if (tv) tv.forEach((t) => castBlock.add(t));
    return !tv;
  }), unsupported, { ...base, drops: passiveDrops }));
  if (passiveDrops.length) report?.push({ part: 'passive', drops: uniq(passiveDrops) });
  const skills = skillsOf(svt.skills, base, report);
  const np = npOf(svt, unsupported, base, report);
  const losesHp = [...skills.flatMap((k) => k.effects), ...(np?.extra ?? [])].some((e) => e.kind === 'lossHp');
  return {
    id: svt.id, collectionNo: svt.collectionNo, name: svt.name,
    face: faceOf(svt.extraAssets?.faces?.ascension),
    className: svt.className, attribute: svt.attribute, traits: svt.traits.map((t: any) => t.id),
    rarity: svt.rarity ?? 0,
    atkGrowth: svt.atkGrowth,
    skills,
    passives,
    ...(eventPassives.length && { eventPassives }),
    append2: append2 ? append2.functions[0].svals.map((v: any) => v.Value) : [],
    np,
    unsupported: uniq(unsupported),
    ...(castBlock.size && { castBlockTraits: [...castBlock] }),
    ...(losesHp && Array.isArray(svt.hpGrowth) && { hp: svt.hpGrowth }),
  };
}

/** Part-level marks of a servant, for display (shape: PartUnsupported in types.ts). */
export function partUnsupported(s: CompactServant): PartUnsupported {
  return {
    skills: s.skills.flatMap((k) => (k.unsupported?.length ? [{ num: k.num, reasons: k.unsupported }] : [])),
    lastTurnOnly: s.skills.flatMap((k) => (k.lastTurnOnly?.length && !k.unsupported?.length ? [{ num: k.num, reasons: k.lastTurnOnly }] : [])),
    np: s.np?.unsupported?.length ? s.np.unsupported : null,
  };
}

/*
 * CE skills, per skill num as Chaldea's getActivatedSkills: the MLB variants
 * (condLimitCount 4) of a num when it has any, else its base ones (0). Every
 * skill of the chosen group runs. Several skills in one group are usually
 * reruns of an event bonus on different field traits (only one can match);
 * on point-buff events (Chaldea's eventPointBuffGroupSkillNumMap) they are the
 * levels of one bonus, of which Chaldea runs at most one: a field-conditioned
 * effect whose traits overlap another skill of its group is dropped.
 */
/** report: drop audit sink (parts ce / ceMlb). */
export function compactCE(ce: any, triggers?: TriggerLookup, report?: PartDrops[]): CompactCE {
  const unsupported: string[] = [];
  const nums = [...new Set<number>(ce.skills.map((s: any) => s.num))].sort((a, b) => a - b);
  const group = (num: number, mlb: boolean) => {
    const ss = ce.skills.filter((s: any) => s.num === num);
    const lb = ss.filter((s: any) => s.condLimitCount === 4);
    return mlb && lb.length ? lb : ss.filter((s: any) => (s.condLimitCount ?? 0) === 0);
  };
  const conv = (mlb: boolean, drops: string[]) => nums.flatMap((num) => {
    const per: Effect[][] = group(num, mlb).map((s: any) => convertFunctions(s.functions, unsupported, { triggers, drops, start: true }));
    if (per.length < 2) return per.flat();
    const traitsOf = (es: Effect[]) => new Set(es.flatMap((e) => e.fieldTraits ?? []));
    return per.flatMap((es, i) => {
      const others = new Set(per.flatMap((o, j) => (j === i ? [] : [...traitsOf(o)])));
      return es.filter((e) => !e.fieldTraits?.some((t) => others.has(t)));
    });
  });
  const dropsBase: string[] = [], dropsMlb: string[] = [];
  const out: CompactCE = {
    id: ce.id, collectionNo: ce.collectionNo, name: ce.name, face: faceOf(ce.extraAssets?.faces?.equip),
    atkGrowth: ce.atkGrowth,
    effects: conv(false, dropsBase), effectsMlb: conv(true, dropsMlb),
    unsupported: [...new Set(unsupported)],
  };
  if (dropsBase.length) report?.push({ part: 'ce', drops: uniq(dropsBase) });
  if (dropsMlb.length) report?.push({ part: 'ceMlb', drops: uniq(dropsMlb) });
  return out;
}

export function compactMC(mc: any, triggers?: TriggerLookup): CompactMC {
  const unsupported: string[] = [];
  // MC skills all have num 0 in Atlas: order in the array is the in-game order.
  const skills: Skill[] = mc.skills.map((s: any, i: number) => ({
    num: (i + 1) as Skill['num'], cooldown: s.coolDown, effects: convertFunctions(s.functions, unsupported, { triggers }),
  }));
  return { id: mc.id, name: mc.name, skills, unsupported: [...new Set(unsupported)] };
}
