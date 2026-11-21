import type { Effect, LevelVal } from '../data/types';
import { npDamage } from './damage';
import { splitHits, hitsOnEnemy, npRefund } from './npgain';
import { applyEffect, mods, buffApplies, gaugeCap, type BattleState, type Buff, type Enemy, type Unit } from './state';

export interface NpResult { state: BattleState; killedAll: boolean; minMargin: number; }

const extraVal = (e: Effect, ocLv: number, npLv: number): LevelVal => (e.oc ? e.oc[ocLv - 1] : e.lv)[npLv - 1];

/**
 * NP extras: self, ptAll (alive front line) and ptOther apply; ptOne is
 * skipped (an NP picks no ally target; skipping only loses help); enemy-side
 * targets are not modelled.
 */
function applyExtras(front: (Unit | null)[], extras: readonly Effect[], pre: boolean, ocLv: number, npLv: number, key: string) {
  for (const e of extras) {
    if (!!e.pre !== pre || e.target === 'ptOne') continue;
    applyEffect({ front }, e, extraVal(e, ocLv, npLv), key);
  }
}

/**
 * Fire the NP of a front-line unit at the minimum damage roll.
 * Order (as in Chaldea's activateNP): OC level from gauge, gauge -> 0, pre
 * extras, damage + refund per target, count buffs consumed, post extras.
 * minMargin = min(damage / HP before the NP) over the targets.
 * targetIndex: enemy index for a single-target NP (default: first living).
 * TODO(M7): NP chains add OC (2nd NP +1, 3rd +2); not modelled yet.
 */
export function fireNp(state: BattleState, unitKey: string, targetIndex?: number): NpResult {
  const front = state.front.slice();
  const ui = front.findIndex((x) => x?.key === unitKey);
  if (ui < 0) throw new Error(`unit ${unitKey} is not on the front line`);
  const u0 = front[ui]!;
  const np = u0.svt.np;
  if (!np) throw new Error(`${unitKey} has no damage NP`);
  if (u0.gauge < 10000) throw new Error(`${unitKey} NP gauge below 100%`);

  let targets: number[];
  if (np.aoe) {
    targets = [];
    state.enemies.forEach((e, i) => { if (e.hp > 0) targets.push(i); });
  } else if (targetIndex !== undefined) {
    if (!(state.enemies[targetIndex]?.hp > 0)) throw new Error(`enemy ${targetIndex} is not alive`);
    targets = [targetIndex];
  } else {
    const i = state.enemies.findIndex((e) => e.hp > 0);
    targets = i < 0 ? [] : [i];
  }
  if (targets.length === 0) throw new Error('no living enemy');

  // ocUp is in whole OC levels (see mods()); clamped to 1..5 like Chaldea.
  const ocUp = mods(u0, state.enemies[targets[0]], np.card).ocUp;
  const ocLv = Math.max(1, Math.min(5, Math.floor(u0.gauge / 10000) + ocUp));
  const npLv = u0.npLv;
  front[ui] = { ...u0, gauge: 0 };

  applyExtras(front, np.extra, true, ocLv, npLv, unitKey);

  const u = front[ui]!;
  const aff = state.aff[unitKey];
  if (!aff) throw new Error(`no affinity for ${unitKey}`);
  const mult = np.mult[ocLv - 1][npLv - 1];
  const used = new Set<Buff>();
  const enemies: Enemy[] = state.enemies.slice();
  let refund = 0;
  let minMargin = Infinity;
  for (const ti of targets) {
    const t = enemies[ti];
    const a = aff[ti];
    const m = mods(u, t, np.card);
    for (const b of u.buffs) if (b.count > 0 && buffApplies(b, t, np.card)) used.add(b);
    const se = np.seTraits && np.seMult && np.seTraits.some((tr) => t.traits.includes(tr))
      ? np.seMult[ocLv - 1][npLv - 1] : 1000;
    const damage = npDamage({
      atk: u.atk, mult, card: np.card, cardMod: m.cardMod,
      classAtk: a.classAtk, triangle: a.triangle, attribute: a.attribute,
      atkMod: m.atkMod, defMod: 0, npDmgMod: m.npDmgMod, powerMod: m.powerMod,
      seMult: se, dmgPlus: m.dmgPlus,
    });
    minMargin = Math.min(minMargin, damage / t.hp);
    const { hits, hpLeft } = hitsOnEnemy(t.hp, splitHits(damage, np.hits));
    refund += npRefund({
      npRate: np.npRate[npLv - 1], card: np.card, cardMod: m.cardMod, tdRate: t.tdRate, npGainMod: m.npGainMod,
    }, hits);
    enemies[ti] = { ...t, hp: hpLeft };
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

  applyExtras(front, np.extra, false, ocLv, npLv, unitKey);

  return { state: { ...state, front, enemies }, killedAll: enemies.every((e) => e.hp <= 0), minMargin };
}
