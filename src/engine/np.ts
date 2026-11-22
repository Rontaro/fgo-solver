import type { Effect, LevelVal, NoblePhantasm } from '../data/types';
import { npDamage } from './damage';
import { splitHits, hitsOnEnemy, npRefund } from './npgain';
import { applyEffect, canNp, syncAuras, mods, buffApplies, gaugeCap, livingSlots, refillField, chooseTarget, npTarget, debuffSum, consumeDebuffs, type BattleState, type Buff, type EffectDraft, type Enemy } from './state';

export interface NpResult { state: BattleState; killedAll: boolean; minMargin: number; }

const extraVal = (e: Effect, ocLv: number, npLv: number): LevelVal => (e.oc ? e.oc[ocLv - 1] : e.lv)[npLv - 1];

/**
 * Specific attack rate of the NP against one enemy (permille, 1000 = none):
 * supereffective vs a trait (seMult), or damageNpIndividualSum (see
 * NoblePhantasm.sum). pick reads a [ocLv-1][npLv-1] table (the engine: the
 * fired OC; the bound: the best OC).
 */
export function specificRate(np: NoblePhantasm, selfTraits: readonly number[], enemy: Pick<Enemy, 'traits'>, pick: (t: number[][]) => number): number {
  if (np.seTraits && np.seMult && np.seTraits.some((tr) => enemy.traits.includes(tr))) return pick(np.seMult);
  if (np.sum) {
    const own = np.sum.onEnemy ? enemy.traits : selfTraits;
    let n = np.sum.traits.filter((t) => own.includes(t)).length;
    if (np.sum.max > 0) n = Math.min(n, np.sum.max);
    if (n > 0) return pick(np.sum.base) + n * pick(np.sum.step);
  }
  return 1000;
}

/**
 * NP extras: self, ptAll (alive front line) and ptOther apply; ptOne is
 * skipped (an NP picks no ally target; skipping only loses help). Debuffs on
 * enemies: enemyAll on the living field, enemy on the NP's turn target.
 */
function applyExtras(d: EffectDraft, extras: readonly Effect[], pre: boolean, ocLv: number, npLv: number, key: string, target: number) {
  for (const e of extras) {
    if (!!e.pre !== pre || e.target === 'ptOne') continue;
    applyEffect(d, e, extraVal(e, ocLv, npLv), key, undefined, target);
  }
}

/**
 * Fire the NP of a front-line unit at the minimum damage roll.
 * Order (as in Chaldea's activateNP): OC level from gauge, gauge -> 0, pre
 * extras, damage + refund per target, count buffs consumed, post extras.
 * minMargin = min(damage / HP before the NP) over the targets.
 * AoE hits the living enemies on the field. A single-target NP hits the
 * turn's target (npTarget): targetIndex, a living field slot, chooses it and
 * is only allowed on the turn's first NP (the game picks one target per
 * turn, before the NPs; it can be on an AoE NP too). Afterwards the empty
 * slots are refilled from the reserve (refillField), so a later NP of the
 * same turn hits the enemies that just entered. killedAll: field and reserve
 * are both empty. The NP's overcharge includes the chain bonus (2nd NP of the
 * turn +1 OC, 3rd +2).
 */
export function fireNp(state: BattleState, unitKey: string, targetIndex?: number): NpResult {
  if (targetIndex !== undefined) state = chooseTarget(state, targetIndex);
  const front = state.front.slice();
  const ui = front.findIndex((x) => x?.key === unitKey);
  if (ui < 0) throw new Error(`unit ${unitKey} is not on the front line`);
  const u0 = front[ui]!;
  const np = u0.svt.np;
  if (!np) throw new Error(`${unitKey} has no damage NP`);
  if (u0.gauge < 10000) throw new Error(`${unitKey} NP gauge below 100%`);
  if (!canNp(u0)) throw new Error(`${unitKey} cannot fire its NP (seal / stun)`);

  // Enemy indices (state.enemies) hit by the NP.
  const living = livingSlots(state);
  let targets: number[];
  if (np.aoe) {
    targets = living.map((slot) => state.field[slot]);
  } else {
    const ei = npTarget(state);
    targets = ei < 0 ? [] : [ei];
  }
  if (targets.length === 0) throw new Error('no living enemy');

  // OC as Chaldea's activateNP: gauge level + upChagetd (ocUp, whole levels, see
  // mods()) + the chain bonus, clamped to 1..5. The chain bonus (battle.dart:
  // extraOvercharge) is +1 per NP already fired in this card chain, i.e. this
  // turn (only NPs are played): 2nd NP +1, 3rd +2. It scales everything read at
  // ocLv: the damage multiplier, the supereffective one and OC-dependent extras.
  const ocUp = mods(u0, state.enemies[targets[0]], np.card).ocUp;
  const ocLv = Math.max(1, Math.min(5, Math.floor(u0.gauge / 10000) + ocUp + state.npsFired));
  const npLv = u0.npLv;
  front[ui] = { ...u0, gauge: 0 };

  // The turn's target (single-target debuffs of the NP land on it).
  const turnTarget = np.aoe ? npTarget(state) : targets[0];
  const pre: EffectDraft = { front, cond: state.cond, enemies: state.enemies, field: state.field };
  applyExtras(pre, np.extra, true, ocLv, npLv, unitKey, turnTarget);

  const u = front[ui]!;
  const aff = state.aff[unitKey];
  if (!aff) throw new Error(`no affinity for ${unitKey}`);
  const mult = np.mult[ocLv - 1][npLv - 1];
  const used = new Set<Buff>();
  const enemies: Enemy[] = pre.enemies!.slice();
  let refund = 0;
  let minMargin = Infinity;
  for (const ti of targets) {
    const t = enemies[ti];
    const a = aff[ti];
    const m0 = mods(u, t, np.card);
    // Our debuffs on the target: DEF down lowers its defence, card resist down
    // adds to the card modifier (damage and NP gain, as in Chaldea).
    const m = { ...m0, cardMod: m0.cardMod + debuffSum(t, 'cardResDown', np.card) };
    const defMod = (t.defUp ?? 0) - debuffSum(t, 'defDown', np.card);
    for (const b of u.buffs) if (b.count > 0 && buffApplies(b, t, np.card)) used.add(b);
    const se = specificRate(np, u.svt.traits, t, (tab) => tab[ocLv - 1][npLv - 1]);
    const damage = npDamage({
      atk: u.atk, mult, card: np.card, cardMod: m.cardMod,
      classAtk: a.classAtk, triangle: a.triangle, attribute: a.attribute,
      atkMod: m.atkMod, defMod, npDmgMod: m.npDmgMod, powerMod: m.powerMod,
      seMult: se, dmgPlus: m.dmgPlus - (t.dmgCut ?? 0),
    });
    minMargin = Math.min(minMargin, damage / t.hp);
    const { hits, hpLeft } = hitsOnEnemy(t.hp, splitHits(damage, np.hits));
    refund += npRefund({
      npRate: np.npRate[npLv - 1], card: np.card, cardMod: m.cardMod, tdRate: t.tdRate, npGainMod: m.npGainMod,
    }, hits);
    enemies[ti] = { ...consumeDebuffs(t, np.card), hp: hpLeft };
  }

  // Count-limited buffs are consumed by the attack if they applied to it (any
  // kind: consuming is the conservative direction). Done before the post
  // extras so buffs those grant are not consumed by this NP.
  let buffs = u.buffs;
  if (used.size) {
    const kept: Buff[] = [];
    for (const b of u.buffs) {
      if (!used.has(b)) kept.push(b);
      else if (b.count > 1) kept.push({ ...b, count: b.count - 1 });
    }
    buffs = kept;
  }
  front[ui] = { ...u, buffs, gauge: Math.min(gaugeCap(u.npLv), u.gauge + refund) };

  const post: EffectDraft = { front, cond: state.cond, enemies, field: state.field };
  applyExtras(post, np.extra, false, ocLv, npLv, unitKey, turnTarget);

  // enemies holds the reserve too (full HP until it enters): every enemy dead
  // means field and reserve are empty.
  const after = post.enemies!;
  // A unit that died (selfDeath) takes its auras with it.
  const died = front.some((x, i) => !x && state.front[i]);
  const next = refillField({ ...state, front, enemies: after, npsFired: state.npsFired + 1 });
  return { state: died ? syncAuras(next) : next, killedAll: after.every((e) => e.hp <= 0), minMargin };
}
