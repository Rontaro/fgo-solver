// Brute-force reference for the solver tests (not used by the app). Based on
// the review's reference: no relevance rules, bounds or dominance, every
// target, the order change at any point of a turn, exact-state memo.
import type { CompactMC, Constants } from '../data/types';
import {
  initBattle, useSkill as castSkill, useMc as castMc, endTurn, nextWave, livingSlots, chooseTarget,
  type BattleState, type Quest, type TeamMember,
} from '../engine/state';
import { fireNp } from '../engine/np';

type Atom = { id: string; opts: ((s: BattleState) => BattleState)[] };

/**
 * Minimum number of skill/MC actions of a clear (Infinity if none). Per turn:
 * any subset of the available skills and non-swap MC skills (in slot order),
 * optionally an order change followed by any subset of what is left (the
 * incoming unit included), then every NP sequence of up to 3 distinct units
 * and every turn target (one living field slot per turn, chosen before the
 * NPs; waves with a reserve refill after each NP, as the engine does).
 */
export function bruteMinActions(team: readonly TeamMember[], mc: CompactMC, mcLv: number, quest: Quest, constants: Constants): number {
  const idx = mcLv - 1;
  const swapMcs = mc.skills.flatMap((k, i) => (k.effects.some((e) => e.kind === 'orderChange') ? [i] : []));
  const plainMcs = mc.skills.flatMap((_, i) => (swapMcs.includes(i) ? [] : [i]));
  const memo = new Map<string, number>();
  const key = (s: BattleState) => JSON.stringify(
    [s.wave, s.front, s.back, s.enemies.map((e) => e.hp), s.field, s.mcCd, s.swapped],
    (k, v) => (k === 'svt' ? undefined : v),
  );
  // One target per turn, chosen before the NPs: every living field slot, then
  // every NP sequence (single-target NPs follow the engine's npTarget).
  const fireAll = (s: BattleState, out: BattleState[]) => {
    const living = livingSlots(s);
    for (const t of living.length > 1 ? living : [undefined]) fire(t === undefined ? s : chooseTarget(s, t), 0, 0, out);
  };
  const fire = (s: BattleState, used: number, depth: number, out: BattleState[]) => {
    s.front.forEach((u, slot) => {
      if (!u || !u.svt.np || used & (1 << slot) || u.gauge < 10000 || depth >= 3) return;
      const r = fireNp(s, u.key);
      if (r.killedAll) out.push(r.state); else fire(r.state, used | (1 << slot), depth + 1, out);
    });
  };
  const frontKeys = (s: BattleState) => s.front.flatMap((x) => (x ? [x.key] : []));
  const atomsOf = (s: BattleState, done: Set<string>): Atom[] => {
    const res: Atom[] = [];
    for (const u of s.front) {
      if (!u) continue;
      for (const sk of u.svt.skills) {
        const id = u.key + sk.num;
        if (done.has(id) || u.cd[sk.num - 1] > 0) continue;
        const tg = sk.effects.some((e) => e.target === 'ptOne') ? frontKeys(s) : [undefined];
        res.push({ id, opts: tg.map((t) => (x: BattleState) => castSkill(x, u.key, sk.num, t)) });
      }
    }
    for (const i of plainMcs) {
      const id = 'mc' + i;
      if (done.has(id) || s.mcCd[i] > 0) continue;
      const tg = mc.skills[i].effects.some((e) => e.target === 'ptOne') ? frontKeys(s) : [undefined];
      res.push({ id, opts: tg.map((t) => (x: BattleState) => castMc(x, i, mc, mcLv, t)) });
    }
    return res;
  };
  const subsets = (s: BattleState, atoms: Atom[], i: number, n: number, done: Set<string>,
    cb: (s: BattleState, n: number, done: Set<string>) => void) => {
    if (i === atoms.length) { cb(s, n, done); return; }
    subsets(s, atoms, i + 1, n, done, cb);
    for (const o of atoms[i].opts) {
      let x: BattleState;
      try { x = o(s); } catch { continue; }
      const d = new Set(done); d.add(atoms[i].id);
      subsets(x, atoms, i + 1, n + 1, d, cb);
    }
  };
  const f = (s: BattleState): number => {
    const k = key(s);
    const m = memo.get(k);
    if (m !== undefined) return m;
    let best = Infinity;
    const finish = (x: BattleState, n: number) => {
      if (n >= best) return;
      const outs: BattleState[] = [];
      fireAll(x, outs);
      for (const o of outs) {
        const rest = s.wave === quest.waves.length - 1 ? 0 : f(nextWave(endTurn(o), quest, constants));
        best = Math.min(best, n + rest);
      }
    };
    subsets(s, atomsOf(s, new Set()), 0, 0, new Set(), (x, n, done) => {
      finish(x, n);
      if (x.swapped || !x.back.length) return;
      for (const si of swapMcs) {
        if (x.mcCd[si] > 0 || (mc.skills[si].effects.find((e) => e.kind === 'orderChange')?.lv[idx]?.value ?? 0) === 0) continue;
        x.front.forEach((u, fi) => {
          if (!u) return;
          x.back.forEach((_, bi) => {
            const y = castMc(x, si, mc, mcLv, undefined, [fi, bi]);
            subsets(y, atomsOf(y, done), 0, n + 1, done, (z, n2) => finish(z, n2));
          });
        });
      }
    });
    memo.set(k, best);
    return best;
  };
  return f(initBattle(team, mc, mcLv, quest, constants));
}
