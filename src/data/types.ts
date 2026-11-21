export type Region = 'NA' | 'JP';
export type Card = 'arts' | 'buster' | 'quick';
export type TargetKind = 'self' | 'ptOne' | 'ptAll' | 'ptOther' | 'enemy' | 'enemyAll' | 'orderChange';

export type EffectKind =
  | 'atkUp' | 'cardUp' | 'npDmgUp' | 'powerUp' | 'npGainUp' | 'ocUp'
  | 'gainNp' | 'shortenSkill' | 'orderChange'
  | 'dmgPlus';             // flat damage (addDamage), added after flooring (engine dmgPlus)

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
}

export interface Skill { num: 1 | 2 | 3; cooldown: number[]; effects: Effect[]; }

export interface NoblePhantasm {
  card: Card;
  aoe: boolean;
  mult: number[][];        // [ocLv-1][npLv-1], permille
  seMult?: number[][];     // supereffective multiplier, permille
  seTraits?: number[];
  hits: number[];          // npDistribution
  npRate: number[];        // npGain.np per npLv
  extra: Effect[];         // non-damage effects of the NP
}

export interface CompactServant {
  id: number; collectionNo: number; name: string;
  className: string; attribute: string; traits: number[];
  atkGrowth: number[];
  skills: Skill[];
  passives: Effect[];
  append2: number[];       // starting NP charge per append level, in 0.01%
  np: NoblePhantasm | null;
  unsupported: string[];   // unhandled effect types; empty = simulable
}

export interface CompactCE {
  id: number; collectionNo: number; name: string;
  atkGrowth: number[];
  effects: Effect[];
  effectsMlb: Effect[];
  unsupported: string[];
}

export interface CompactMC { id: number; name: string; skills: Skill[]; unsupported: string[]; }

export interface Constants {
  classAtk: Record<string, number>;
  classRel: Record<string, Record<string, number>>;
  attrRel: Record<string, Record<string, number>>;
}
