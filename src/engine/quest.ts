import type { Enemy, Quest, WaveLayout } from './state';

// Typed subset of an Atlas Academy quest phase (nice/{region}/quest/{id}/{phase}).
export interface RawFunc {
  funcType: string; funcTargetType: string; funcTargetTeam?: string;
  buffs?: readonly { type: string }[];
}
export interface RawSkill { name?: string; functions: readonly RawFunc[]; }
export interface RawEnemy {
  deck: string; deckId: number; name: string; hp: number;
  svt: { className: string; attribute: string };
  traits: readonly { id: number }[];
  serverMod: { tdRate: number };
  /** Active skills: never used (enemies never act), not checked. */
  skills?: { skill1?: RawSkill | null; skill2?: RawSkill | null; skill3?: RawSkill | null };
  classPassive?: { classPassive?: readonly RawSkill[]; addPassive?: readonly RawSkill[] };
}
export interface RawStage {
  wave: number; enemyFieldPosCount?: number | null; call?: readonly number[];
  /** 1-based field slots that are never refilled. */
  NoEntryIds?: readonly number[] | null;
  originalScript?: { enemyEntryOrder?: readonly number[] } | null;
  enemies: readonly RawEnemy[];
}
export interface RawQuest { flags?: readonly string[]; stages: readonly RawStage[]; }

export class UnsupportedQuestError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super('unsupported quest: ' + reasons.join('; '));
    this.name = 'UnsupportedQuestError';
    this.reasons = reasons;
  }
}

/*
 * Enemy-side effects. In a 3-wave / 3-turn clear every wave dies on the turn
 * it appears (endTurn throws otherwise), so enemies never take a turn: their
 * active skills and NP never fire and are not checked at all. Only what is in
 * effect when they enter can matter: the class passives and added passives
 * (Chaldea's initActorSkills runs them at wave start, for the field and the
 * reserve alike). The trigger buffs a passive can install (entry, wave start,
 * on-damage, on-death functions...) are buff types too, outside the
 * allow-list, so they are rejected. Anything a passive puts on our side is
 * rejected.
 *
 * Allow-list of buffs an enemy may hold on itself without changing whether our
 * NP kills it or how much NP we gain: debuff resist / immunity (we never debuff
 * enemies in the model), its own attack / crit / star / charge buffs, taunt,
 * regen and heal-received (it dies before the turn ends). Anything else
 * (defence, damage cut, special defence, invincible, evade, guts, max HP,
 * card resist, unknown) makes the quest unsupported.
 */
const ENEMY_SELF_BUFFS_OK = new Set([
  'avoidState', 'upTolerance', 'upToleranceSubstate', 'upResistInstantdeath', 'upNonresistInstantdeath',
  'upAtk', 'upCommandall', 'upNpdamage', 'upDamage', 'upChagetd', 'upGrantstate',
  'upCriticaldamage', 'upCriticalrate', 'upCriticalpoint', 'upStarweight', 'upDropstar',
  'upHate', 'regainHp', 'regainNp', 'regainStar', 'upGainHp', 'upGivegainHp',
]);
// Non-buff functions on its own side that cannot change our damage or its HP pool.
const ENEMY_SELF_FUNCS_OK = new Set(['none', 'gainStar', 'gainNp', 'hastenNpturn', 'gainHp', 'gainHpPer']);
const OWN_SIDE = new Set(['self', 'ptAll', 'ptOne', 'ptOther', 'ptFull', 'ptAnother', 'ptRandom', 'ptOneOther']);
const OTHER_SIDE = /^enemy/;

function checkPassive(where: string, funcs: readonly RawFunc[], out: string[]): void {
  for (const f of funcs) {
    // team 'player': only runs when a player-side unit casts it.
    if (f.funcTargetTeam === 'player') continue;
    if (OTHER_SIDE.test(f.funcTargetType)) {
      if (f.funcType !== 'none') out.push(`${where}: ${f.funcType} on our side`);
      continue;
    }
    if (!OWN_SIDE.has(f.funcTargetType)) { out.push(`${where}: target ${f.funcTargetType}`); continue; }
    if (f.funcType === 'addState' || f.funcType === 'addStateShort') {
      const t = f.buffs?.[0]?.type ?? 'none';
      if (!ENEMY_SELF_BUFFS_OK.has(t)) out.push(`${where}: buff ${t}`);
    } else if (!ENEMY_SELF_FUNCS_OK.has(f.funcType)) out.push(`${where}: ${f.funcType}`);
  }
}

/*
 * Field and reinforcements, as in Chaldea's battle (_fetchWaveEnemies,
 * _nextWave, _replenishActors). A wave has enemyFieldPosCount slots (default
 * 3); an enemy with deckId d <= slots starts in slot d - 1, the others wait in
 * the reserve in deckId order. Empty slots (dead or never filled) take the next
 * reserve enemy in slot order, or by ascending
 * stage.originalScript.enemyEntryOrder[slot] when present, skipping the
 * NoEntryIds slots. Refills run at the start of every turn (so wave 1 starts
 * with its empty slots filled; a later wave is placed after that turn-start
 * refill, its empty slots wait) and, only on quests flagged
 * enemyImmediateAppear, after every NP (and attack card). Without the flag a
 * reinforcement enters next turn, so the wave cannot die on the turn it
 * appears: rejected.
 */
function layout(st: RawStage, first: boolean, enemies: readonly RawEnemy[], w: string, out: string[]): WaveLayout | undefined {
  const slots = st.enemyFieldPosCount ?? 3;
  const field: number[] = Array.from({ length: slots }, () => -1);
  const reserve: number[] = [];
  enemies.forEach((e, i) => {
    if (e.deckId > slots) reserve.push(i);
    else if (e.deckId >= 1 && field[e.deckId - 1] < 0) field[e.deckId - 1] = i;
    else out.push(`${w}: deckId ${e.deckId} is not a free slot (${e.name})`);
  });
  if (reserve.length === 0) {
    // Every enemy in slot i = its index: the default layout.
    return field.every((x, i) => x === (i < enemies.length ? i : -1)) ? undefined : { field, reserve, refill: [] };
  }
  const order = st.originalScript?.enemyEntryOrder;
  const noEntry = new Set(st.NoEntryIds ?? []);
  const refill = field.map((_, i) => i)
    .sort((a, b) => (order ? (order[a] ?? 0) - (order[b] ?? 0) : 0) || a - b)
    .filter((i) => !noEntry.has(i + 1));
  if (refill.length === 0) out.push(`${w}: reinforcements with no slot to enter`);
  let r = 0;
  if (first) for (const slot of refill) if (field[slot] < 0 && r < reserve.length) field[slot] = reserve[r++];
  return { field, reserve: reserve.slice(r), refill };
}

/**
 * Atlas quest phase -> engine quest. Throws UnsupportedQuestError (with every
 * reason) for reinforcements that only enter next turn, shift/call/change
 * decks and enemy passives that could reduce our damage or keep an enemy alive.
 */
export function questFromAtlas(raw: RawQuest): Quest {
  const reasons: string[] = [];
  const immediate = raw.flags?.includes('enemyImmediateAppear') ?? false;
  const stages = [...raw.stages].sort((a, b) => a.wave - b.wave);
  const layouts: (WaveLayout | undefined)[] = [];
  const waves = stages.map((st, si) => {
    const w = `wave ${st.wave}`;
    if (st.call?.length) reasons.push(`${w}: call deck`);
    for (const e of st.enemies) if (e.deck !== 'enemy') reasons.push(`${w}: ${e.deck} deck (${e.name})`);
    const enemies = st.enemies.filter((e) => e.deck === 'enemy').sort((a, b) => a.deckId - b.deckId);
    const lay = layout(st, si === 0, enemies, w, reasons);
    if (lay?.reserve.length && !immediate) {
      reasons.push(`${w}: reinforcements enter next turn (${enemies.length} enemies, ${st.enemyFieldPosCount ?? 3} on field)`);
    }
    layouts.push(lay);
    for (const e of enemies) {
      const where = `${w} ${e.name}`;
      for (const p of [...(e.classPassive?.classPassive ?? []), ...(e.classPassive?.addPassive ?? [])]) {
        checkPassive(`${where} passive ${p.name ?? ''}`.trim(), p.functions, reasons);
      }
    }
    return enemies.map((e): Enemy => ({
      hp: e.hp, className: e.svt.className, attribute: e.svt.attribute,
      traits: e.traits.map((t) => t.id), tdRate: e.serverMod.tdRate,
    }));
  });
  if (reasons.length) throw new UnsupportedQuestError([...new Set(reasons)]);
  return layouts.some((l) => l) ? { waves, layouts } : { waves };
}
