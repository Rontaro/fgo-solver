import type { Card } from '../data/types';

const CARD_VALUE: Record<Card, number> = { arts: 1.0, buster: 1.5, quick: 0.8 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Everything is computed at the minimum damage roll to stay on the safe side. */
export const RANDOM_MIN = 0.9;

/** All modifiers are permille integers as in Atlas Academy (200 = 20%). */
export interface DamageInput {
  atk: number;
  mult: number;       // NP damage multiplier, permille (6000 = 600%)
  card: Card;
  cardMod: number;    // card up - enemy card resist down
  classAtk: number;   // class attack modifier (archer 950, berserker 1100, ...)
  triangle: number;   // class affinity (2000 = advantage)
  attribute: number;  // attribute affinity (1100 = advantage)
  atkMod: number;     // attack up
  defMod: number;     // enemy defense (negative = defense down)
  npDmgMod: number;   // NP damage up
  powerMod: number;   // special attack / power mod
  seMult: number;     // supereffective NP multiplier (1000 = none)
  dmgPlus?: number;   // flat additive damage (addDamage) minus the enemy's damage cut
}

export function npDamage(i: DamageInput): number {
  const k = (v: number) => v / 1000;
  const v = i.atk * k(i.mult) * CARD_VALUE[i.card] * (1 + clamp(k(i.cardMod), -1, 4))
    * k(i.classAtk) * k(i.triangle) * k(i.attribute) * RANDOM_MIN * 0.23
    * Math.max(0, 1 + clamp(k(i.atkMod), -1, 4) - clamp(k(i.defMod), -1, 1))
    * Math.max(0.001, 1 + clamp(k(i.powerMod), -1, 10) + clamp(k(i.npDmgMod), -1, 5))
    * k(i.seMult);
  return Math.max(0, Math.floor(v) + (i.dmgPlus ?? 0));
}
