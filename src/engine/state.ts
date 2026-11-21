import type { CompactServant, CompactCE, CompactMC, Effect, EffectKind, LevelVal, Card } from '../data/types';

export interface Buff { kind: Effect['kind']; value: number; turns: number; count: number; cards?: Card[]; opTraits?: number[]; }
export interface Unit {
  key: string; svt: CompactServant; lv: number; npLv: number; skillLv: [number, number, number];
  atk: number; gauge: number; cd: [number, number, number]; buffs: Buff[];
}
export interface Enemy { hp: number; className: string; attribute: string; traits: number[]; tdRate: number; }
export interface BattleState {
  turn: number; wave: number;          // turn starts at 1; wave is a 0-based index into Quest.waves
  front: (Unit | null)[]; back: Unit[];
  enemies: Enemy[];
  mcCd: number[]; swapped: boolean;
}
export interface TeamMember { svt: CompactServant; lv: number; npLv: number; skillLv: [number, number, number]; append2Lv: number; fou: number; ce: CompactCE | null; ceLv: number; ceMlb: boolean; key: string; }

export interface Quest { waves: Enemy[][]; }

// MVP: the real cap is 100%/200%/300% depending on the servant and NP level.
export const GAUGE_CAP = 30000;

export interface Mods {
  atkMod: number; cardMod: number; npDmgMod: number; powerMod: number;
  npGainMod: number; ocUp: number; dmgPlus: number;
}

// Buff kinds and the modifier each one adds to. The keys are exactly the
// effect kinds that become Buffs; every other kind is an instant function.
// TODO(dmgPlus): when EffectKind gains 'dmgPlus', add `dmgPlus: 'dmgPlus',` here.
const MOD_FIELD: Partial<Record<EffectKind, keyof Mods>> = {
  atkUp: 'atkMod', cardUp: 'cardMod', npDmgUp: 'npDmgMod', powerUp: 'powerMod',
  npGainUp: 'npGainMod', ocUp: 'ocUp',
};
export const isBuffKind = (k: EffectKind): boolean => MOD_FIELD[k] !== undefined;

/** Raw Atlas quest (one phase) -> engine quest. Only the initial deck ('enemy'), by wave then deckId. */
export function questFromAtlas(raw: any): Quest {
  const stages = [...raw.stages].sort((a: any, b: any) => a.wave - b.wave);
  return {
    waves: stages.map((st: any) => st.enemies
      .filter((e: any) => (e.deck ?? 'enemy') === 'enemy')
      .sort((a: any, b: any) => a.deckId - b.deckId)
      .map((e: any): Enemy => ({
        hp: e.hp, className: e.svt.className, attribute: e.svt.attribute,
        traits: e.traits.map((t: any) => t.id), tdRate: e.serverMod.tdRate,
      }))),
  };
}

// --- copying -------------------------------------------------------------
// Shallow per-level copies: svt, Buff objects and enemy traits are shared and
// must be treated as immutable. Everything else is copied, so callers can
// mutate the result freely.
export function cloneUnit(u: Unit): Unit {
  return { ...u, cd: [u.cd[0], u.cd[1], u.cd[2]], buffs: u.buffs.slice() };
}
export function cloneState(s: BattleState): BattleState {
  return {
    turn: s.turn, wave: s.wave,
    front: s.front.map((u) => (u ? cloneUnit(u) : null)),
    back: s.back.map(cloneUnit),
    enemies: s.enemies.map((e) => ({ ...e })),
    mcCd: s.mcCd.slice(), swapped: s.swapped,
  };
}

const aliveFront = (s: BattleState): Unit[] => s.front.filter((u): u is Unit => u !== null);
const frontUnit = (s: BattleState, key: string): Unit => {
  const u = s.front.find((x) => x?.key === key);
  if (!u) throw new Error(`unit ${key} is not on the front line`);
  return u;
};

function toBuff(e: Effect, v: LevelVal): Buff {
  const b: Buff = { kind: e.kind, value: v.value, turns: v.turns, count: v.count };
  if (e.cards) b.cards = e.cards;
  if (e.opTraits) b.opTraits = e.opTraits;
  return b;
}

/**
 * Apply one effect at the given level values, mutating `s` (a clone).
 * casterKey null = Mystic Code (no self/ptOther). Enemy-side targets and
 * orderChange are not handled here. A value of 0 means "not guaranteed": no-op.
 */
export function applyEffect(s: BattleState, e: Effect, v: LevelVal, casterKey: string | null, targetKey?: string): void {
  if (v.value === 0 || e.kind === 'orderChange') return;
  let targets: Unit[];
  switch (e.target) {
    case 'self':
      if (casterKey === null) throw new Error('self target without a caster');
      targets = [frontUnit(s, casterKey)]; break;
    case 'ptAll': targets = aliveFront(s); break;
    case 'ptOther':
      if (casterKey === null) throw new Error('ptOther target without a caster');
      targets = aliveFront(s).filter((u) => u.key !== casterKey); break;
    case 'ptOne':
      if (targetKey === undefined) throw new Error('ptOne effect needs a target');
      targets = [frontUnit(s, targetKey)]; break;
    default: return; // enemy / enemyAll: not modelled (only helpful debuffs reach here)
  }
  for (const u of targets) {
    if (e.kind === 'gainNp') u.gauge = Math.min(GAUGE_CAP, u.gauge + v.value);
    else if (e.kind === 'shortenSkill') u.cd = [Math.max(0, u.cd[0] - v.value), Math.max(0, u.cd[1] - v.value), Math.max(0, u.cd[2] - v.value)];
    else if (isBuffKind(e.kind)) u.buffs.push(toBuff(e, v));
  }
}

// --- battle --------------------------------------------------------------

export function initBattle(members: TeamMember[], mc: CompactMC, _mcLv: number, quest: Quest): BattleState {
  const units = members.map((m): Unit => {
    const buffs: Buff[] = [];
    let gauge = m.append2Lv > 0 ? m.svt.append2[m.append2Lv - 1] ?? 0 : 0;
    // Passives and CEs use index 0. Only self-targeted ones are applied: a
    // party-wide passive/CE effect is skipped (conservative, they only help).
    for (const e of m.svt.passives) {
      const v = e.lv[0];
      if (v && v.value !== 0 && v.turns === -1 && e.target === 'self' && isBuffKind(e.kind)) buffs.push(toBuff(e, v));
    }
    if (m.ce) {
      for (const e of m.ceMlb ? m.ce.effectsMlb : m.ce.effects) {
        const v = e.lv[0];
        if (!v || v.value === 0 || e.target !== 'self') continue;
        if (e.kind === 'gainNp') gauge += v.value;
        else if (isBuffKind(e.kind)) buffs.push(toBuff(e, v));
      }
    }
    return {
      key: m.key, svt: m.svt, lv: m.lv, npLv: m.npLv, skillLv: m.skillLv,
      atk: m.svt.atkGrowth[m.lv - 1] + m.fou + (m.ce ? m.ce.atkGrowth[m.ceLv - 1] : 0),
      gauge: Math.min(GAUGE_CAP, gauge), cd: [0, 0, 0], buffs,
    };
  });
  return {
    turn: 1, wave: 0,
    front: units.slice(0, 3), back: units.slice(3),
    enemies: quest.waves[0].map((e) => ({ ...e })),
    mcCd: mc.skills.map(() => 0), swapped: false,
  };
}

export function useSkill(state: BattleState, unitKey: string, num: number, targetKey?: string): BattleState {
  const s = cloneState(state);
  const u = frontUnit(s, unitKey);
  const skill = u.svt.skills.find((k) => k.num === num);
  if (!skill) throw new Error(`${unitKey} has no skill ${num}`);
  const i = num - 1;
  if (u.cd[i] > 0) throw new Error(`${unitKey} skill ${num} is on cooldown`);
  const idx = u.skillLv[i] - 1;
  for (const e of skill.effects) applyEffect(s, e, e.lv[idx], unitKey, targetKey);
  u.cd[i] = skill.cooldown[idx];
  return s;
}

/** index is 0-based (mc.skills[index], mcCd[index]). swap = [frontIdx, backIdx] for order change. */
export function useMc(state: BattleState, index: number, mc: CompactMC, mcLv: number, targetKey?: string, swap?: [number, number]): BattleState {
  const skill = mc.skills[index];
  if (!skill) throw new Error(`MC has no skill ${index}`);
  if (state.mcCd[index] > 0) throw new Error(`MC skill ${index} is on cooldown`);
  const s = cloneState(state);
  const idx = mcLv - 1;
  for (const e of skill.effects) {
    if (e.kind !== 'orderChange') { applyEffect(s, e, e.lv[idx], null, targetKey); continue; }
    if (e.lv[idx].value === 0) throw new Error('order change not available at this level');
    if (s.swapped) throw new Error('order change already used');
    if (!swap) throw new Error('order change needs a swap');
    const [a, b] = swap;
    const out = s.front[a];
    const inn = s.back[b];
    if (!out || !inn) throw new Error('invalid order change slots');
    s.front[a] = inn;
    s.back[b] = out;
    s.swapped = true;
  }
  s.mcCd[index] = skill.cooldown[idx];
  return s;
}

/**
 * End of turn. Buff turns and skill cooldowns tick on the front line only
 * (in-game, back-line servants are frozen). A buff with turns N applied in
 * turn T is active for the NPs of turns T..T+N-1.
 */
export function endTurn(state: BattleState): BattleState {
  const s = cloneState(state);
  for (const u of s.front) {
    if (!u) continue;
    const buffs: Buff[] = [];
    for (const b of u.buffs) {
      if (b.turns < 0) buffs.push(b);
      else if (b.turns > 1) buffs.push({ ...b, turns: b.turns - 1 });
    }
    u.buffs = buffs;
    u.cd = [Math.max(0, u.cd[0] - 1), Math.max(0, u.cd[1] - 1), Math.max(0, u.cd[2] - 1)];
  }
  s.mcCd = s.mcCd.map((c) => Math.max(0, c - 1));
  s.turn += 1;
  return s;
}

export function nextWave(state: BattleState, quest: Quest): BattleState {
  const w = quest.waves[state.wave + 1];
  if (!w) throw new Error('no next wave');
  const s = cloneState(state);
  s.wave += 1;
  s.enemies = w.map((e) => ({ ...e }));
  return s;
}

/** True when the buff counts for this card against this enemy. */
export function buffApplies(b: Buff, enemy: Enemy, card: Card): boolean {
  if (b.cards && !b.cards.includes(card)) return false;
  if (b.opTraits && !b.opTraits.some((t) => enemy.traits.includes(t))) return false;
  return true;
}

/**
 * Sum of the active buffs. cards / opTraits restrict a buff whatever its kind
 * (Atlas only sets opTraits when the buff has a ckOpIndv condition).
 * ocUp is in whole OC levels: Atlas upChagetd Value is 1 per level
 * (checked on buffs 227 "Overcharge Lv. Up" = 1 and 5124 "by 2" = 2).
 */
export function mods(unit: Unit, enemy: Enemy, card: Card): Mods {
  const m: Mods = { atkMod: 0, cardMod: 0, npDmgMod: 0, powerMod: 0, npGainMod: 0, ocUp: 0, dmgPlus: 0 };
  for (const b of unit.buffs) {
    const f = MOD_FIELD[b.kind];
    if (f && buffApplies(b, enemy, card)) m[f] += b.value;
  }
  return m;
}
