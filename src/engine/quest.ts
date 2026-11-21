import type { Enemy, Quest } from './state';

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
  skills?: { skill1?: RawSkill | null; skill2?: RawSkill | null; skill3?: RawSkill | null };
  classPassive?: { classPassive?: readonly RawSkill[]; addPassive?: readonly RawSkill[] };
}
export interface RawStage {
  wave: number; enemyFieldPosCount?: number; call?: readonly number[];
  enemies: readonly RawEnemy[];
}
export interface RawQuest { stages: readonly RawStage[]; }

export class UnsupportedQuestError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super('unsupported quest: ' + reasons.join('; '));
    this.name = 'UnsupportedQuestError';
    this.reasons = reasons;
  }
}

/*
 * Enemy-side effects. Only effects an enemy puts on its own side can matter:
 * in a 3-wave / 3-turn clear every wave dies on the turn it appears, so enemies
 * never act; their NP and the parts of their skills that target our side never
 * fire. Passives apply on entry, so anything a passive puts on our side is
 * rejected. Skills on their own side are checked too (conservative).
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

function checkFuncs(where: string, funcs: readonly RawFunc[], passive: boolean, out: string[]): void {
  for (const f of funcs) {
    // team 'player': only runs when a player-side unit casts it.
    if (f.funcTargetTeam === 'player') continue;
    if (OTHER_SIDE.test(f.funcTargetType)) {
      if (passive && f.funcType !== 'none') out.push(`${where}: ${f.funcType} on our side`);
      continue; // skills on our side never fire (enemies never act)
    }
    if (!OWN_SIDE.has(f.funcTargetType)) { out.push(`${where}: target ${f.funcTargetType}`); continue; }
    if (f.funcType === 'addState' || f.funcType === 'addStateShort') {
      const t = f.buffs?.[0]?.type ?? 'none';
      if (!ENEMY_SELF_BUFFS_OK.has(t)) out.push(`${where}: buff ${t}`);
    } else if (!ENEMY_SELF_FUNCS_OK.has(f.funcType)) out.push(`${where}: ${f.funcType}`);
  }
}

/**
 * Atlas quest phase -> engine quest. Throws UnsupportedQuestError (with every
 * reason) for reinforcements, shift/call/change decks and enemy self-buffs
 * that could reduce our damage or keep an enemy alive.
 */
export function questFromAtlas(raw: RawQuest): Quest {
  const reasons: string[] = [];
  const stages = [...raw.stages].sort((a, b) => a.wave - b.wave);
  const waves = stages.map((st) => {
    const w = `wave ${st.wave}`;
    const field = st.enemyFieldPosCount ?? 3;
    if (st.call?.length) reasons.push(`${w}: call deck`);
    const onField = st.enemies.filter((e) => e.deck === 'enemy');
    for (const e of st.enemies) if (e.deck !== 'enemy') reasons.push(`${w}: ${e.deck} deck (${e.name})`);
    if (onField.length > field || onField.some((e) => e.deckId > field)) {
      reasons.push(`${w}: reinforcements (${onField.length} enemies, ${field} on field)`);
    }
    for (const e of onField) {
      const where = `${w} ${e.name}`;
      for (const p of [...(e.classPassive?.classPassive ?? []), ...(e.classPassive?.addPassive ?? [])]) {
        checkFuncs(`${where} passive ${p.name ?? ''}`.trim(), p.functions, true, reasons);
      }
      for (const s of [e.skills?.skill1, e.skills?.skill2, e.skills?.skill3]) {
        if (s) checkFuncs(`${where} skill ${s.name ?? ''}`.trim(), s.functions, false, reasons);
      }
    }
    return [...onField].sort((a, b) => a.deckId - b.deckId).map((e): Enemy => ({
      hp: e.hp, className: e.svt.className, attribute: e.svt.attribute,
      traits: e.traits.map((t) => t.id), tdRate: e.serverMod.tdRate,
    }));
  });
  if (reasons.length) throw new UnsupportedQuestError([...new Set(reasons)]);
  return { waves };
}
