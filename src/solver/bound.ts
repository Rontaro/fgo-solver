import type { CompactMC, Constants, Effect, NoblePhantasm } from '../data/types';
import { affinity, effectActive, layoutOf, type BattleState, type Buff, type Enemy, type Quest, type Unit } from '../engine/state';
import { npDamage } from '../engine/damage';

/*
 * Optimistic damage bound, used to prune the search. For each wave from the
 * current one on, it gives every possible shooter every damage buff that could
 * still be active then (its live buffs, each remaining skill and MC skill as
 * many times as its cooldown allows before that wave, every NP extra once per
 * turn), at the highest overcharge (OC5 rows: gauge, upChagetd and the NP
 * chain bonus never go past it), and lets the best three shooters hit each
 * enemy. With an order change still open, the pool is the front line plus at
 * most one back unit (the best choice). Damage is monotone in every modifier, so if even that leaves an enemy
 * alive, no line of play explored by the solver clears that wave.
 * Gauge is ignored (optimistic). With a shortenSkill anywhere in the team every
 * skill is counted once per turn, the most the solver ever uses it. Deferred
 * effects (Effect.deferred) count as if immediate, and pending ones on a unit
 * as live buffs (both optimistic). Buff effectiveness up (buffRate) scales
 * every damage modifier of the shooter by the sum of every rate that can reach
 * it (capped like the engine), more than the engine ever applies.
 *
 * Every enemy of the wave counts, the reserve included, and every NP is
 * counted as hitting it (AoE, optimistic for single target). At most 3 NPs
 * fire per turn and reinforcements only enter after an NP, refilling at most
 * one slot per refill slot each time: reserve enemy k (0-based) enters after
 * NP floor(k / refill slots) + 1 at the earliest, so only the remaining NPs of
 * the turn can hit it (the best of the pool, optimistic). Evaluated before any
 * NP of the turn (turn start, after a swap), where all 3 NPs are still to come.
 */

export interface BoundCtx {
  quest: Quest; constants: Constants; mc: CompactMC; mcLv: number;
  swapMcs: readonly number[];
  /** MC skills counted as buff sources (all of them, see solve.ts). */
  mcSources: readonly number[];
  hasShorten: boolean;
}
export interface BoundFail { wave: number; missing: number; }

/** NPs per turn: 3 front units, each fires at most once (MAX_NP_PER_TURN in solve.ts). */
const MAX_NPS = 3;

type DmgKind = 'atkUp' | 'cardUp' | 'npDmgUp' | 'powerUp' | 'dmgPlus';
const FIELD: Record<DmgKind, 'atkMod' | 'cardMod' | 'npDmgMod' | 'powerMod' | 'dmgPlus'> = {
  atkUp: 'atkMod', cardUp: 'cardMod', npDmgUp: 'npDmgMod', powerUp: 'powerMod', dmgPlus: 'dmgPlus',
};
const isDmg = (k: string): k is DmgKind => k in FIELD;

/** A damage buff (effect or live buff) counted for holder u's NP against enemy en. */
const counts = (x: { kind: string; cards?: readonly string[]; opTraits?: readonly number[] }, np: NoblePhantasm, en: Enemy) =>
  isDmg(x.kind) && !(x.cards && !x.cards.includes(np.card)) && !(x.opTraits && !x.opTraits.some((t) => en.traits.includes(t)));

const reaches = (target: Effect['target'], caster: string | null, u: Unit) =>
  target === 'ptAll' || target === 'ptOne' || (caster !== null && (target === 'self' ? caster === u.key : target === 'ptOther' && caster !== u.key));

const maxRow = (grid: readonly (readonly number[])[], npLv: number) => Math.max(...grid.map((r) => r[npLv - 1]));

/** How often a skill with current cooldown cd and base cooldown cool can be used on turns T..W (waves are turns). */
const usesUntil = (T: number, W: number, cd: number, cool: number, hasShorten: boolean) => {
  if (hasShorten) return W - T + 1;
  const ready = T + cd;
  return ready > W ? 0 : 1 + Math.floor((W - ready) / Math.max(1, cool));
};

/** First wave that no explored line can clear, or null. */
export function damageBound(s: BattleState, c: BoundCtx): BoundFail | null {
  const { quest } = c;
  const T = s.wave;
  const front = s.front.filter((u): u is Unit => u !== null);
  for (let W = T; W < quest.waves.length; W++) {
    // One order change per battle: at most one back unit ever joins.
    const swapOpen = !s.swapped && s.back.length > 0 &&
      c.swapMcs.some((i) => usesUntil(T, W, s.mcCd[i], 1, false) > 0);
    let missing = missingWith(front, W);
    if (swapOpen) for (const b of s.back) if (missing > 0) missing = Math.min(missing, missingWith([...front, b], W));
    if (missing > 0) return { wave: W, missing };
  }
  return null;

  /** Largest share of an enemy's HP the best 3 shooters of the pool leave standing on wave W. */
  function missingWith(pool: readonly Unit[], W: number): number {
    const shooters = pool.filter((u) => u.svt.np);
    const enemies = W === T ? s.enemies : quest.waves[W];
    const sums = enemies.map(() => [] as number[]);
    // NPs of the turn that can still hit each enemy (see the header).
    const reserve = W === T ? s.reserve : layoutOf(quest, W).reserve;
    const refillSlots = Math.max(1, (W === T ? s.refill : layoutOf(quest, W).refill).length);
    const hits = enemies.map(() => MAX_NPS);
    reserve.forEach((ei, k) => { hits[ei] = Math.max(0, MAX_NPS - (Math.floor(k / refillSlots) + 1)); });

    for (const u of shooters) {
      const np = u.svt.np!;
      const perEnemy = enemies.map(() => ({ atkMod: 0, cardMod: 0, npDmgMod: 0, powerMod: 0, dmgPlus: 0 }));
      let rate = 0;
      const put = (x: { kind: string; cards?: readonly string[]; opTraits?: readonly number[] }, v: number) => {
        if (x.kind === 'buffRate') { rate += v; return; }
        enemies.forEach((en, i) => { if (counts(x, np, en)) perEnemy[i][FIELD[x.kind as DmgKind]] += v; });
      };
      // Live buffs still active on wave W (a buff on a back unit is frozen there: counted).
      const inBack = !s.front.includes(u);
      for (const b of u.buffs as readonly Buff[]) {
        if (b.turns < 0 || inBack || b.turns >= W - T + 1) put(b, b.value);
      }
      // Dormant auras (holder in the back) may wake up with the order change: counted.
      for (const b of u.dormant ?? []) put(b, b.value);
      for (const p of u.pending) if (p.v.value > 0) put(p.e, p.v.value);
      for (const cu of pool) {
        cu.svt.skills.forEach((sk) => {
          const i = sk.num - 1;
          const lv = cu.skillLv[i] - 1;
          const n = usesUntil(T, W, cu.cd[i], sk.cooldown[lv], c.hasShorten);
          if (n === 0) return;
          for (const e of sk.effects) {
            const v = e.lv[lv]?.value ?? 0;
            if (v > 0 && reaches(e.target, cu.key, u) && effectActive(e, s.cond)) put(e, v * n);
          }
        });
        const cnp = cu.svt.np;
        if (cnp) {
          for (const e of cnp.extra) {
            if (!reaches(e.target, cu.key, u) || e.target === 'ptOne' || !effectActive(e, s.cond)) continue;
            const v = Math.max(...(e.oc ?? [e.lv]).map((row) => row[cu.npLv - 1]?.value ?? 0));
            if (v > 0) put(e, v * (W - T + 1));
          }
        }
      }
      for (const i of c.mcSources) {
        const sk = c.mc.skills[i];
        const n = usesUntil(T, W, s.mcCd[i], sk.cooldown[c.mcLv - 1], c.hasShorten);
        if (n === 0) continue;
        for (const e of sk.effects) {
          const v = e.lv[c.mcLv - 1]?.value ?? 0;
          if (v > 0 && reaches(e.target, null, u) && effectActive(e, s.cond)) put(e, v * n);
        }
      }
      const mult = maxRow(np.mult, u.npLv);
      enemies.forEach((en, i) => {
        if (en.hp <= 0) return;
        const a = W === T && s.aff[u.key] ? s.aff[u.key][i] : affinity(c.constants, u.svt, en);
        const m0 = perEnemy[i];
        const k = Math.min(5000, 1000 + rate) / 1000;
        const up = (v: number) => (rate > 0 && v > 0 ? v * k : v);
        const m = { atkMod: up(m0.atkMod), cardMod: up(m0.cardMod), npDmgMod: up(m0.npDmgMod), powerMod: up(m0.powerMod), dmgPlus: up(m0.dmgPlus) };
        const se = np.seTraits && np.seMult && np.seTraits.some((t) => en.traits.includes(t)) ? maxRow(np.seMult, u.npLv) : 1000;
        sums[i].push(npDamage({
          atk: u.atk, mult, card: np.card, cardMod: m.cardMod, classAtk: a.classAtk, triangle: a.triangle,
          attribute: a.attribute, atkMod: m.atkMod, defMod: en.defUp ?? 0, npDmgMod: m.npDmgMod, powerMod: m.powerMod,
          seMult: se, dmgPlus: m.dmgPlus - (en.dmgCut ?? 0),
        }));
      });
    }

    let missing = 0;
    enemies.forEach((en, i) => {
      if (en.hp <= 0) return;
      const best = sums[i].sort((a, b) => b - a).slice(0, hits[i]).reduce((a, b) => a + b, 0);
      missing = Math.max(missing, 1 - best / en.hp);
    });
    return missing;
  }
}
