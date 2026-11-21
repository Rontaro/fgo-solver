import type { Card } from '../data/types';

/** NiceCard adjustTdGauge / 1000 (verified: arts 3000, buster 0, quick 1000). */
const CARD_GAIN: Record<Card, number> = { arts: 3, buster: 0, quick: 1 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Permille modifiers as in Atlas Academy; npRate and results in units of 0.01%. */
export interface NpGainInput {
  npRate: number;    // servant NP charge per hit on attack (54 = 0.54%)
  card: Card;
  cardMod: number;   // card up, permille, clamped to -100%..400%
  tdRate: number;    // enemy class NP gain modifier, permille (caster 1200, rider 1100, ...)
  npGainMod: number; // NP gain up, permille
}

export function npGainPerHit(i: NpGainInput & { overkill: boolean }): number {
  return Math.floor(
    i.npRate * CARD_GAIN[i.card] * (1 + clamp(i.cardMod / 1000, -1, 4)) * i.tdRate / 1000
    * (1 + i.npGainMod / 1000) * (i.overkill ? 1.5 : 1),
  );
}

/**
 * Split total damage by hit distribution. Each hit but the last is
 * floor(total * h / sum(hits)); the last takes the remainder. Same rule as
 * Chaldea's Laplace (lib/app/battle/functions/damage.dart, hit loop).
 */
export function splitHits(total: number, hits: readonly number[]): number[] {
  const sumHits = hits.reduce((a, b) => a + b, 0);
  const parts = hits.map(h => Math.floor(total * h / sumHits));
  if (parts.length > 0) {
    const sum = parts.slice(0, -1).reduce((a, b) => a + b, 0);
    parts[parts.length - 1] = total - sum;
  }
  return parts;
}

export interface Hit { damage: number; overkill: boolean; }

/**
 * Apply hits in order to an enemy. A hit is overkill when the enemy HP after
 * that hit is strictly below 0, as in Chaldea's Laplace
 * (lib/app/battle/functions/damage.dart: `isOverkill = target.hp < 0`, checked
 * after `receiveDamage`; HP may go negative). So the killing hit is overkill
 * unless it lands exactly on 0, and later hits are overkill once HP is below 0.
 */
export function hitsOnEnemy(enemyHp: number, hitDamages: readonly number[]): { hits: Hit[]; hpLeft: number } {
  let hp = enemyHp;
  const hits = hitDamages.map(damage => {
    hp -= damage;
    return { damage, overkill: hp < 0 };
  });
  return { hits, hpLeft: hp };
}

/** Total NP refund (0.01% units) from a sequence of hits, each with its own overkill flag. */
export function npRefund(i: NpGainInput, hits: readonly Pick<Hit, 'overkill'>[]): number {
  return hits.reduce((sum, h) => sum + npGainPerHit({ ...i, overkill: h.overkill }), 0);
}
