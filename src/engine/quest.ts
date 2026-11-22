import type { Enemy, Quest, WaveLayout } from './state';

// Typed subset of an Atlas Academy quest phase (nice/{region}/quest/{id}/{phase}).
export interface RawFunc {
  funcType: string; funcTargetType: string; funcTargetTeam?: string;
  buffs?: readonly { type: string }[];
  /** Per skill level. */
  svals?: readonly { Value?: number }[];
}
export interface RawSkill { name?: string; functions: readonly RawFunc[]; }
export interface RawEnemy {
  deck: string; deckId: number; name: string; hp: number;
  svt: { className: string; attribute: string };
  traits: readonly { id: number }[];
  serverMod: { tdRate: number };
  /** Active skills: never used (enemies never act), not checked. */
  skills?: { skill1?: RawSkill | null; skill2?: RawSkill | null; skill3?: RawSkill | null };
  classPassive?: { classPassive?: readonly RawSkill[]; addPassive?: readonly RawSkill[] };
}
export interface RawStage {
  wave: number; enemyFieldPosCount?: number | null; call?: readonly number[];
  /** 1-based field slots that are never refilled. */
  NoEntryIds?: readonly number[] | null;
  originalScript?: { enemyEntryOrder?: readonly number[]; enemyAutoTargetOrder?: readonly number[] } | null;
  enemies: readonly RawEnemy[];
}
type Traits = readonly { id: number }[];
export interface RawQuest {
  flags?: readonly string[]; stages: readonly RawStage[];
  /** Field traits: individuality, or battleBg + phaseIndividuality (see fieldTraitsOf). */
  individuality?: Traits; phaseIndividuality?: Traits | null; battleBg?: { individuality?: Traits } | null;
  /**
   * The quest war's event (QuestWar.eventId). Atlas quest phases only carry
   * warId: the caller sets it from the war index. 0 / absent = no event.
   */
  eventId?: number;
}

export class UnsupportedQuestError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super('unsupported quest: ' + reasons.join('; '));
    this.name = 'UnsupportedQuestError';
    this.reasons = reasons;
  }
}

/*
 * Enemy-side effects. In a 3-wave / 3-turn clear every wave dies on the turn
 * it appears (endTurn throws otherwise), so enemies never take a turn: their
 * active skills and NP never fire and are not checked at all. Only what is in
 * effect when they enter can matter: the class passives and added passives
 * (Chaldea's initActorSkills runs them at wave start, for the field and the
 * reserve alike). The trigger buffs a passive can install (entry, wave start,
 * on-damage, on-death functions...) are buff types too, outside the
 * allow-list, so they are rejected. Anything a passive puts on our side is
 * rejected.
 *
 * Allow-list of buffs an enemy may hold on itself without changing whether our
 * NP kills it or how much NP we gain: debuff resist / immunity (they only mark
 * the enemy Enemy.noDebuff, see DEBUFF_GUARD), its own attack / crit / star / charge / card buffs
 * and flat damage plus, taunt, regen and heal-received (it dies before the
 * turn ends), critical stars from hits on it (stars are not modelled), added
 * traits (ignoring them only hides trait bonuses we would get), triggers that
 * fire on its own attack or at its own turn start / end (it has neither), and
 * delayFunction, which fires at the end of a turn, its own or ours: safe only
 * because every wave dies during our turn, before any turn ends (endTurn
 * enforces it).
 *
 * Modelled instead: defence up (upDefence) and flat damage cut
 * (subSelfdamage) enter our damage formula, at the highest value over the
 * skill levels and regardless of conditions, rate, turns or count (more
 * defence only lowers our damage). One aimed at its side (not self) is given
 * to every enemy of the wave.
 *
 * Anything else (special defence, invincible, evade, guts, max HP, card
 * resist, class relation changes, death / damage / entry / wave start
 * triggers, unknown) makes the quest unsupported.
 */
const ENEMY_SELF_BUFFS_OK = new Set([
  'avoidState', 'upTolerance', 'upToleranceSubstate', 'upResistInstantdeath', 'upNonresistInstantdeath',
  'upAtk', 'upCommandall', 'upNpdamage', 'upDamage', 'upChagetd', 'upGrantstate',
  'upCriticaldamage', 'upCriticalrate', 'upCriticalpoint', 'upStarweight', 'upDropstar',
  'upHate', 'regainHp', 'regainNp', 'regainStar', 'upGainHp', 'upGivegainHp',
  'downTolerance', 'downCommandall', 'addDamage', 'addIndividuality', 'downCriticalStarDamageTaken',
  // Chaldea: run by the attacker after / before its own attack, or at its own turn start / end;
  // delayFunction at a turn end (ours too), when the wave is already dead.
  'commandattackAfterFunction', 'commandattackBeforeFunction', 'attackAfterFunction', 'attackBeforeFunction',
  'selfturnstartFunction', 'selfturnendFunction', 'delayFunction',
]);
/** Buffs that enter our damage formula (see Enemy.defUp / dmgCut). */
const MODELLED: Record<string, 'defUp' | 'dmgCut'> = { upDefence: 'defUp', subSelfdamage: 'dmgCut' };
interface Defence { defUp: number; dmgCut: number; noDebuff: boolean; }
/**
 * Buffs that can make our debuffs fail on it (immunity, resistance): the
 * enemy gets Enemy.noDebuff, whatever their value or condition.
 */
const DEBUFF_GUARD = new Set(['avoidState', 'upTolerance', 'upToleranceSubstate']);
// Non-buff functions on its own side that cannot change our damage or its HP pool.
const ENEMY_SELF_FUNCS_OK = new Set(['none', 'gainStar', 'gainNp', 'hastenNpturn', 'gainHp', 'gainHpPer']);
const OWN_SIDE = new Set(['self', 'ptAll', 'ptOne', 'ptOther', 'ptFull', 'ptOtherFull', 'ptAnother', 'ptRandom', 'ptOneOther']);
const OTHER_SIDE = /^enemy/;

/** self / side: defence the passive gives its holder / every enemy of the wave. */
function checkPassive(where: string, funcs: readonly RawFunc[], out: string[], self: Defence, side: Defence): void {
  for (const f of funcs) {
    // team 'player': only runs when a player-side unit casts it.
    if (f.funcTargetTeam === 'player') continue;
    if (OTHER_SIDE.test(f.funcTargetType)) {
      if (f.funcType !== 'none') out.push(`${where}: ${f.funcType} on our side`);
      continue;
    }
    if (!OWN_SIDE.has(f.funcTargetType)) { out.push(`${where}: target ${f.funcTargetType}`); continue; }
    if (f.funcType === 'addState' || f.funcType === 'addStateShort') {
      const t = f.buffs?.[0]?.type ?? 'none';
      const k = MODELLED[t];
      if (DEBUFF_GUARD.has(t)) (f.funcTargetType === 'self' ? self : side).noDebuff = true;
      if (k) {
        const vs = (f.svals ?? []).map((x) => x.Value ?? 0);
        if (vs.some((v) => v < 0)) out.push(`${where}: buff ${t} with a negative value`);
        else (f.funcTargetType === 'self' ? self : side)[k] += Math.max(0, ...vs);
      } else if (!ENEMY_SELF_BUFFS_OK.has(t)) out.push(`${where}: buff ${t}`);
    } else if (!ENEMY_SELF_FUNCS_OK.has(f.funcType)) out.push(`${where}: ${f.funcType}`);
  }
}

/*
 * Field and reinforcements, as in Chaldea's battle (_fetchWaveEnemies,
 * _nextWave, _replenishActors). A wave has enemyFieldPosCount slots (default
 * 3); an enemy with deckId d <= slots starts in slot d - 1, the others wait in
 * the reserve in deckId order. Empty slots (dead or never filled) take the next
 * reserve enemy in slot order, or by ascending
 * stage.originalScript.enemyEntryOrder[slot] when present, skipping the
 * NoEntryIds slots. Refills run at the start of every turn (so wave 1 starts
 * with its empty slots filled; a later wave is placed after that turn-start
 * refill, its empty slots wait) and, only on quests flagged
 * enemyImmediateAppear, after every NP (and attack card). Without the flag a
 * reinforcement enters next turn, so the wave cannot die on the turn it
 * appears: rejected.
 */
function layout(st: RawStage, first: boolean, immediate: boolean, enemies: readonly RawEnemy[], w: string, out: string[]): WaveLayout | undefined {
  const slots = st.enemyFieldPosCount ?? 3;
  const field: number[] = Array.from({ length: slots }, () => -1);
  const reserve: number[] = [];
  enemies.forEach((e, i) => {
    if (e.deckId > slots) reserve.push(i);
    else if (e.deckId >= 1 && field[e.deckId - 1] < 0) field[e.deckId - 1] = i;
    else out.push(`${w}: deckId ${e.deckId} is not a free slot (${e.name})`);
  });
  // Auto target (Chaldea's getNonNullTargetIndex): first living slot, or the
  // stage's enemyAutoTargetOrder[slot]; on enemyImmediateAppear quests the
  // lowest uniqueId, i.e. the order of stage.enemies.
  const slotOrder = (f: readonly number[], pri?: readonly number[]) => f.map((_, i) => i)
    .sort((a, b) => (pri ? (pri[a] ?? 0) - (pri[b] ?? 0) : 0) || a - b).flatMap((i) => (f[i] >= 0 ? [f[i]] : []));
  const byRaw = () => enemies.map((_, i) => i).sort((a, b) => st.enemies.indexOf(enemies[a]) - st.enemies.indexOf(enemies[b]));
  const autoOrder = st.originalScript?.enemyAutoTargetOrder;
  if (autoOrder && autoOrder.length !== slots) out.push(`${w}: enemyAutoTargetOrder does not match the ${slots} slots`);
  const isPlain = (xs: readonly number[]) => xs.every((x, i) => x === i);
  if (reserve.length === 0) {
    const retarget = immediate ? byRaw() : slotOrder(field, autoOrder);
    // Every enemy in slot i = its index and index-order targeting: the default layout.
    if (field.every((x, i) => x === (i < enemies.length ? i : -1)) && isPlain(retarget)) return undefined;
    return { field, reserve, refill: [], retarget };
  }
  // Refill order: Chaldea sorts the enemyEntryOrder entries by value and
  // refills their positions; without it, slot order.
  const order = st.originalScript?.enemyEntryOrder;
  if (order && order.length > slots) out.push(`${w}: enemyEntryOrder longer than the ${slots} slots`);
  const noEntry = new Set(st.NoEntryIds ?? []);
  const refill = (order ? order.map((_, i) => i).sort((a, b) => order[a] - order[b] || a - b) : field.map((_, i) => i))
    .filter((i) => i < slots && !noEntry.has(i + 1));
  if (refill.length === 0) out.push(`${w}: reinforcements with no slot to enter`);
  let r = 0;
  if (first) for (const slot of refill) if (field[slot] < 0 && r < reserve.length) field[slot] = reserve[r++];
  const left = reserve.slice(r);
  // Reserve enemy k enters after NP floor(k / refill slots) + 1 at the earliest
  // (refills only follow an NP); entering after the 3rd NP of the turn it cannot be hit.
  if (refill.length && left.length > 2 * refill.length) {
    out.push(`${w}: ${left.length} reinforcements on ${refill.length} refill slot(s) need more than 3 NPs`);
  }
  // Without the flag nothing enters during the turn (rejected if a reserve is left): slots are fixed.
  const retarget = immediate ? byRaw() : slotOrder(field, autoOrder);
  return { field, reserve: left, refill, ...(!isPlain(retarget) && { retarget }) };
}

/**
 * Field traits as Chaldea's QuestPhase.questIndividuality: with
 * phaseIndividuality, the battle background's traits plus its positive ids
 * minus its negative ones; otherwise the quest's individuality.
 */
export function fieldTraitsOf(raw: RawQuest): number[] {
  if (raw.phaseIndividuality) {
    const ph = raw.phaseIndividuality.map((t) => t.id);
    const drop = new Set(ph.filter((t) => t < 0).map((t) => -t));
    return [...(raw.battleBg?.individuality ?? []).map((t) => t.id), ...ph.filter((t) => t >= 0)].filter((t) => !drop.has(Math.abs(t)));
  }
  return (raw.individuality ?? []).map((t) => t.id);
}

/**
 * Atlas quest phase -> engine quest. Throws UnsupportedQuestError (with every
 * reason) for reinforcements that only enter next turn, shift/call/change
 * decks and enemy passives that could reduce our damage or keep an enemy alive.
 */
export function questFromAtlas(raw: RawQuest): Quest {
  const reasons: string[] = [];
  const immediate = raw.flags?.includes('enemyImmediateAppear') ?? false;
  const stages = [...raw.stages].sort((a, b) => a.wave - b.wave);
  const layouts: (WaveLayout | undefined)[] = [];
  const waves = stages.map((st, si) => {
    const w = `wave ${st.wave}`;
    if (st.call?.length) reasons.push(`${w}: call deck`);
    for (const e of st.enemies) if (e.deck !== 'enemy') reasons.push(`${w}: ${e.deck} deck (${e.name})`);
    const enemies = st.enemies.filter((e) => e.deck === 'enemy').sort((a, b) => a.deckId - b.deckId);
    const lay = layout(st, si === 0, immediate, enemies, w, reasons);
    if (lay?.reserve.length && !immediate) {
      reasons.push(`${w}: reinforcements enter next turn (${enemies.length} enemies, ${st.enemyFieldPosCount ?? 3} on field)`);
    }
    layouts.push(lay);
    const side: Defence = { defUp: 0, dmgCut: 0, noDebuff: false };
    const own = enemies.map((e) => {
      const self: Defence = { defUp: 0, dmgCut: 0, noDebuff: false };
      const where = `${w} ${e.name}`;
      for (const p of [...(e.classPassive?.classPassive ?? []), ...(e.classPassive?.addPassive ?? [])]) {
        checkPassive(`${where} passive ${p.name ?? ''}`.trim(), p.functions, reasons, self, side);
      }
      return self;
    });
    return enemies.map((e, i): Enemy => {
      const defUp = own[i].defUp + side.defUp, dmgCut = own[i].dmgCut + side.dmgCut;
      return {
        hp: e.hp, className: e.svt.className, attribute: e.svt.attribute,
        traits: e.traits.map((t) => t.id), tdRate: e.serverMod.tdRate,
        ...(defUp > 0 && { defUp }), ...(dmgCut > 0 && { dmgCut }),
        ...((own[i].noDebuff || side.noDebuff) && { noDebuff: true as const }),
      };
    });
  });
  if (reasons.length) throw new UnsupportedQuestError([...new Set(reasons)]);
  const fieldTraits = fieldTraitsOf(raw);
  return {
    waves, ...(layouts.some((l) => l) && { layouts }),
    ...(fieldTraits.length && { fieldTraits }), ...(raw.eventId && { eventId: raw.eventId }),
  };
}
