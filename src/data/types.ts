export type Region = 'NA' | 'JP';
export type Card = 'arts' | 'buster' | 'quick';
export type TargetKind = 'self' | 'ptOne' | 'ptAll' | 'ptOther' | 'enemy' | 'enemyAll' | 'orderChange';

export type EffectKind =
  | 'atkUp' | 'cardUp' | 'npDmgUp' | 'powerUp' | 'npGainUp' | 'ocUp'
  | 'gainNp' | 'shortenSkill' | 'orderChange'
  | 'dmgPlus'              // flat damage (addDamage), added after flooring (engine dmgPlus)
  // Buff effectiveness up (Atlas buffRate, e.g. Oberon S3): while active, every
  // buff of its holder that carries one of Effect.rateOf (buff traits) counts
  // value * (1000 + sum of rates) / 1000, floored per buff, as in Chaldea's
  // getBuffRateValue (total capped at 5000).
  | 'buffRate'
  // NP gauge loss of the holder: a deferred effect (end of turn) or an
  // immediate demerit (see isHarmful).
  | 'lossNp'
  // Demerits on our side (Atlas donotNoble / donotSkill / donotAct): the
  // holder cannot fire its NP / use skills / do either while it lasts, and
  // its skill cooldowns do not tick (Chaldea canSkillCoolDown). A self ATK
  // down is an atkUp with a negative value. Modelled as certain whatever their
  // Rate (pessimistic).
  | 'sealNp' | 'sealSkill' | 'stun'
  // Self HP loss (Atlas lossHp, an NP / skill demerit): the unit must not die
  // of it (CompactServant.hp, no HP fou counted).
  | 'lossHp'
  // The holder dies (Atlas forceInstantDeath on self, e.g. Arash's NP): its
  // slot is empty until the next turn starts, when the first back-line unit
  // takes it (Chaldea _replenishActors).
  | 'selfDeath'
  // Kills the first other ally on the field, in slot order, skipping allies
  // with one of Effect.exceptTraits (Atlas forceInstantDeath on
  // ptSelfAnotherFirst, e.g. Chen Gong's NP). Same replacement as selfDeath.
  | 'allyDeath'
  // Class relation overwrite on the holder's attacks (Atlas
  // overwriteClassRelation, attack side, overwriteForce): Effect.classRel.
  | 'classRel'
  // The holder switches form (Atlas transformServant on itself, Melusine /
  // Ptolemaios): Effect.toForm, see data/forms.ts.
  | 'transform'
  // Removes the holder's removable positive buffs (Atlas subState of
  // buffPositiveEffect on our side, Hassan of the Hundred Personas S3): a
  // demerit. Passive / CE buffs (battle start) cannot be removed.
  | 'clearBuffs'
  // Debuffs on enemies (target enemy / enemyAll), see Enemy.debuffs in the
  // engine: DEF down (Atlas downDefence) and card resistance down
  // (downDefencecommandall, Effect.cards = the attacking cards it applies to).
  | 'defDown' | 'cardResDown';

// value 0 = "not guaranteed at this level" (chance-based or a failed dependent
// follow-up): the effect does nothing there. The solver must treat orderChange
// and shortenSkill with value 0 as unavailable at that level.
export interface LevelVal { value: number; turns: number; count: number; }

export interface Effect {
  kind: EffectKind;
  target: TargetKind;
  lv: LevelVal[];          // index = skill level - 1 (or 0 for passives/CE)
  cards?: Card[];          // cardUp: which cards it applies to
  opTraits?: number[];     // powerUp/npDmgUp: only vs these traits
  pre?: boolean;           // NP extra only: true = runs before the damage function
  // NP extra only, set when the value depends on Overcharge: oc[ocLv-1][npLv-1]
  // (from svals..svals5). `lv` always equals oc[0] (OC1), so code that ignores
  // OC stays conservative for helpful effects.
  oc?: LevelVal[][];
  // Quest conditions (Atlas funcquestTvals / svals EventId). The effect only
  // runs when the quest has at least one of these field traits (any-of, as in
  // Chaldea's checkSignedIndivPartialMatch) / belongs to this event's war.
  fieldTraits?: number[];
  eventId?: number;
  /** buffRate: the buff traits it amplifies (Atlas script.UpBuffRateBuffIndiv). */
  rateOf?: number[];
  /**
   * Modelled buffs: the buff's own traits (Atlas buff.vals) that some buffRate
   * can target (only the ones in compact.ts RATE_TRAITS, to keep the data small).
   */
  buffTraits?: number[];
  /** transform: the form the holder switches to. */
  toForm?: 'low' | 'high';
  /** allyDeath: allies with one of these traits are skipped. */
  exceptTraits?: number[];
  /** classRel: [attacker class][defender class] -> class relation (permille) while it lasts. */
  classRel?: Record<string, Record<string, number>>;
  /** Skill effects only: runs later on its target (the trigger buff's holder), see Deferred. */
  deferred?: Deferred;
  /**
   * CE / event passive effects only (applied at battle start). full: the
   * party target includes the back line (Atlas ptFull / ptOtherFull; plain
   * ptAll / ptOther only reach the units on the field at battle start).
   * onField (Atlas sval OnField): the buff only counts while its holder (the
   * CE's servant) is on the front line, e.g. bond CE auras. Only kept on
   * permanent buffs (turns and count -1).
   */
  full?: true;
  onField?: true;
}

/**
 * An effect run by a trigger buff at the end of a turn instead of now (T = the
 * turn the skill is used; the battle ends with the last wave's kill, so an
 * effect due at the end of the last turn never runs):
 * - 'delay' (Atlas delayFunction, e.g. Ishtar's "Mana Burst Set"): runs once,
 *   at the end of turn T + turns - 1 (Turn 1 = this turn's end, so a 1-turn
 *   buff it grants is active on turn T + 1);
 * - 'turnEnd' (selfturnendFunction, e.g. Oberon S2's NP drain): runs at the
 *   end of each of turns T .. T + turns - 1.
 * Ticks only while the holder is on the front line (back units are frozen).
 */
export interface Deferred { at: 'delay' | 'turnEnd'; turns: number; }

/**
 * An event bonus of a CE or a servant (Atlas eventDropUp & co.): in quests of
 * that event, `value` more of the item with trait `item` per drop ('drop'),
 * or that much more in permille ('dropRate'), or more event points ('point',
 * 'pointRate'). item 0 = not tied to one item.
 */
export interface EventBonus { eventId: number; item: number; kind: 'drop' | 'dropRate' | 'point' | 'pointRate'; value: number }

/** Event bonus passive (Atlas extraPassive): active only in quests of these events. */
export interface EventPassive { eventIds: number[]; effects: Effect[]; }

export interface Skill {
  num: 1 | 2 | 3; cooldown: number[]; effects: Effect[];
  /**
   * Effects of this skill we cannot model (same format as CompactServant.unsupported).
   * Non-empty = the skill is never used by the engine/solver (see usableServant);
   * omitted when empty.
   */
  unsupported?: string[];
  /**
   * Non-empty = the skill may only be used on the last turn (the turn of the
   * last wave): it installs an end-of-turn trigger we cannot model (e.g.
   * Oberon S3 "Ending of Dreams": sleep at the end of the turn), which never
   * runs when the battle is won that turn. The strings are the reasons. Omitted when empty.
   */
  lastTurnOnly?: string[];
}

export interface NoblePhantasm {
  card: Card;
  aoe: boolean;
  mult: number[][];        // [ocLv-1][npLv-1], permille
  seMult?: number[][];     // supereffective multiplier, permille
  seTraits?: number[];
  /**
   * damageNpIndividualSum: specific rate = base + count * step (capped at max
   * counts when max > 0) when count > 0, else 1000. count = traits of the
   * target enemy (onEnemy) or of the servant in `traits`; we count only their
   * fixed traits (not buffs), a lower bound (base >= 1000, step >= 0).
   * [ocLv-1][npLv-1], permille.
   */
  sum?: { onEnemy: boolean; traits: number[]; base: number[][]; step: number[][]; max: number };
  /**
   * damageNpRare: specific rate `mult` when the rarity of the target enemy
   * (onEnemy) or of the servant is in `rarities`, else 1000. [ocLv-1][npLv-1].
   * An enemy of unknown rarity gets 1000 (an under-estimate).
   */
  rare?: { onEnemy: boolean; rarities: number[]; mult: number[][] };
  hits: number[];          // npDistribution
  npRate: number[];        // npGain.np per npLv
  extra: Effect[];         // non-damage effects of the NP
  /** Effects of the NP we cannot model. Non-empty = the NP never fires (see usableServant); omitted when empty. */
  unsupported?: string[];
}

export interface CompactServant {
  id: number; collectionNo: number; name: string;
  face: string;            // icon URL on the Atlas CDN ('' if none)
  className: string; attribute: string; traits: number[];
  rarity: number;          // 0..5 stars (Atlas `rarity`)
  atkGrowth: number[];
  skills: Skill[];
  passives: Effect[];
  eventPassives?: EventPassive[]; // omitted when empty
  append2: number[];       // starting NP charge per append level, in 0.01%
  np: NoblePhantasm | null;
  /**
   * Servant-level unhandled effects (passives, append, event passives, form
   * changes): they are always active, so non-empty = the servant is not
   * usable at all. Skills and the NP carry their own lists (Skill.unsupported,
   * NoblePhantasm.unsupported): an unsupported skill/NP only makes that part
   * unavailable. partUnsupported() (compact.ts) summarises them for the UI.
   */
  unsupported: string[];
  /**
   * While this servant is in the party, allies having one of these traits
   * cast no buffs (Oberon's passive: buff success rate down for Merlin). The
   * engine drops every buff such a unit casts (CompactServant traits, any-of).
   */
  castBlockTraits?: number[];
  /** Event drop / point bonuses of its event passives (no condition), omitted when none. */
  eventBonus?: EventBonus[];
  /** HP by level (Atlas hpGrowth), only for servants with a lossHp effect. */
  hp?: number[];
  /**
   * Both kits of a servant with forms (data/forms.ts); the top-level skills /
   * NP are the 'high' one. A form view (inForm) sets form and formBase.
   */
  forms?: Record<'low' | 'high', { skills: Skill[]; np: NoblePhantasm | null }>;
  form?: 'low' | 'high';
  formBase?: CompactServant;
}

/**
 * Part-level marks of a servant, for display (compact.ts partUnsupported).
 * skills: one entry per skill with unsupported effects (never used);
 * lastTurnOnly: one per skill restricted to the last turn; np: the NP's
 * unsupported effects (it never fires), null when the NP is fine or absent.
 */
export interface PartUnsupported {
  skills: { num: number; reasons: string[] }[];
  lastTurnOnly: { num: number; reasons: string[] }[];
  np: string[] | null;
}

export interface CompactCE {
  id: number; collectionNo: number; name: string;
  face: string;            // icon URL on the Atlas CDN ('' if none)
  atkGrowth: number[];
  effects: Effect[];
  effectsMlb: Effect[];
  unsupported: string[];
  /** Event drop / point bonuses (base / MLB), omitted when none. */
  bonus?: EventBonus[];
  bonusMlb?: EventBonus[];
}

/** Name and icon of the event items referenced by EventBonus.item (items.json, by trait). */
export type EventItems = Record<string, { name: string; icon: string }>;

export interface CompactMC { id: number; name: string; skills: Skill[]; unsupported: string[]; }

export interface Constants {
  classAtk: Record<string, number>;
  classRel: Record<string, Record<string, number>>;
  attrRel: Record<string, Record<string, number>>;
}

export interface QuestEntry {
  id: number; name: string; type: string; phases: number[];
  spot?: string;           // map spot name, when the war has one
  openedAt: number; closedAt: number;
}

export interface QuestWar { warId: number; warName: string; eventId: number; quests: QuestEntry[]; }

export interface DataVersion { hash: string; timestamp: number; build?: string; }
