import type { Constants, Effect, LevelVal } from '../data/types';
import { npDamage } from './damage';
import { splitHits, hitsOnEnemy, npRefund } from './npgain';
import { cloneState, applyEffect, mods, buffApplies, GAUGE_CAP, type BattleState, type Buff, type Enemy } from './state';

export interface NpResult { state: BattleState; killedAll: boolean; minMargin: number; }

const extraVal = (e: Effect, ocLv: number, npLv: number): LevelVal => (e.oc ? e.oc[ocLv - 1] : e.lv)[npLv - 1];
const rel = (t: Record<string, Record<string, number>>, a: string, d: string) => t[a]?.[d] ?? 1000;

/**
 * Fire the NP of a front-line unit at the minimum damage roll.
 * Order: gauge -> 0, pre extras, damage + refund per target, count buffs
 * consumed, post extras. minMargin = min(damage / hp before the NP) over targets.
 */
export function fireNp(state: BattleState, unitKey: string, constants: Constants): NpResult {
  const s = cloneState(state);
  const u = s.front.find((x) => x?.key === unitKey);
  if (!u) throw new Error(`unit ${unitKey} is not on the front line`);
  const np = u.svt.np;
  if (!np) throw new Error(`${unitKey} has no damage NP`);
  if (u.gauge < 10000) throw new Error(`${unitKey} NP gauge below 100%`);
  const alive = s.enemies.filter((e) => e.hp > 0);
  if (alive.length === 0) throw new Error('no living enemy');
  const targets: Enemy[] = np.aoe ? alive : [alive[0]];

  // ocUp is in whole OC levels (see mods()).
  const ocLv = Math.min(5, Math.floor(u.gauge / 10000) + mods(u, targets[0], np.card).ocUp);
  const npLv = u.npLv;
  u.gauge = 0;

  for (const e of np.extra) if (e.pre) applyEffect(s, e, extraVal(e, ocLv, npLv), unitKey);

  const svt = u.svt;
  const mult = np.mult[ocLv - 1][npLv - 1];
  const used = new Set<Buff>();
  let refund = 0;
  let minMargin = Infinity;
  for (const t of targets) {
    const m = mods(u, t, np.card);
    for (const b of u.buffs) if (b.count > 0 && buffApplies(b, t, np.card)) used.add(b);
    const se = np.seTraits && np.seMult && np.seTraits.some((tr) => t.traits.includes(tr))
      ? np.seMult[ocLv - 1][npLv - 1] : 1000;
    const damage = npDamage({
      atk: u.atk, mult, card: np.card, cardMod: m.cardMod,
      classAtk: constants.classAtk[svt.className] ?? 1000,
      triangle: rel(constants.classRel, svt.className, t.className),
      attribute: rel(constants.attrRel, svt.attribute, t.attribute),
      atkMod: m.atkMod, defMod: 0, npDmgMod: m.npDmgMod, powerMod: m.powerMod,
      seMult: se, dmgPlus: m.dmgPlus,
    });
    minMargin = Math.min(minMargin, damage / t.hp);
    const { hits, hpLeft } = hitsOnEnemy(t.hp, splitHits(damage, np.hits));
    refund += npRefund({
      npRate: np.npRate[npLv - 1], card: np.card, cardMod: m.cardMod, tdRate: t.tdRate, npGainMod: m.npGainMod,
    }, hits);
    t.hp = hpLeft;
  }
  u.gauge = Math.min(GAUGE_CAP, u.gauge + refund);

  // Count-limited buffs are consumed by the attack if they applied to it (any
  // kind: consuming is the conservative direction). Done before the post
  // extras so buffs those grant are not consumed by this NP.
  if (used.size) {
    const buffs: Buff[] = [];
    for (const b of u.buffs) {
      if (!used.has(b)) buffs.push(b);
      else if (b.count > 1) buffs.push({ ...b, count: b.count - 1 });
    }
    u.buffs = buffs;
  }

  for (const e of np.extra) if (!e.pre) applyEffect(s, e, extraVal(e, ocLv, npLv), unitKey);

  return { state: s, killedAll: s.enemies.every((e) => e.hp <= 0), minMargin };
}
