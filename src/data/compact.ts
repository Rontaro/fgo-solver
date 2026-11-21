import type {
  Card, Effect, EffectKind, TargetKind, Skill, NoblePhantasm,
  CompactServant, CompactCE, CompactMC, LevelVal,
} from './types';

// Raw Atlas Academy input is untyped JSON: `any` on the input side only.

const CARD_BY_ID: Record<string, Card> = { '1': 'arts', '2': 'buster', '3': 'quick' };
const CARD_BY_TRAIT: Record<number, Card> = { 4001: 'arts', 4002: 'buster', 4003: 'quick' };

const BUFF_KIND: Record<string, EffectKind> = {
  upAtk: 'atkUp', upCommandall: 'cardUp', upNpdamage: 'npDmgUp',
  upDamage: 'powerUp', upDropnp: 'npGainUp', upChagetd: 'ocUp',
};

// Effects that can only help, or that our model does not consider
// (survival, stars, crits, enemy charge): ignoring them is safe.
const IGNORED_BUFFS = new Set([
  'invincible', 'avoidance', 'upDefence', 'upCriticaldamage', 'upCriticalpoint',
  'upStarweight', 'upDropstar', 'upTolerance', 'upToleranceSubstate', 'regainNp',
  'regainHp', 'regainStar', 'guts', 'gutsRatio', 'upHate', 'avoidState', 'upGrantstate',
  'upGivegainHp', 'upGainHp', 'addMaxhp', 'upDamagedropnp', 'upCriticalrate', 'downDefence',
  'subSelfdamage', 'reduceHp', 'donotAct', 'upResistInstantdeath', 'upNonresistInstantdeath',
  // Turns face cards into another type (Altria's Dragon's Core). Face cards are
  // out of the 3T model (NP-only waves), and the NP card itself is unchanged.
  'changeCommandCardType',
  // Damage-avoidance variant of invincible (Castoria NP): survival only.
  'specialInvincible',
]);
const IGNORED_FUNCS = new Set([
  // hastenNpturn ("Charge Gain") on ptAll/self has funcTargetTeam "enemy" in the
  // fixtures: it only fills enemy charge bars and never touches an ally NP gauge.
  'gainStar', 'gainHp', 'gainHpPer', 'subState', 'hastenNpturn', 'delayNpturn',
  'lossNp', 'none', 'instantDeath', 'gainHpFromTargets', 'absorbNpturn',
]);

const TARGET: Record<string, TargetKind> = {
  self: 'self', ptOne: 'ptOne', ptAll: 'ptAll', ptOther: 'ptOther', ptFull: 'ptAll',
  enemy: 'enemy', enemyAll: 'enemyAll', ptselectOneSub: 'orderChange',
};

function levels(svals: any[]): LevelVal[] {
  return svals.map((v) => ({ value: v.Value ?? 0, turns: v.Turn ?? -1, count: v.Count ?? -1 }));
}

export function convertFunctions(funcs: any[], unsupported: string[]): Effect[] {
  const out: Effect[] = [];
  for (const f of funcs) {
    // Rate < 1000 = chance-based: treated as absent. MCs use 5000 (guaranteed).
    const rate = f.svals?.[0]?.Rate ?? 1000;
    if (rate < 1000) continue;
    const target = TARGET[f.funcTargetType];
    if (f.funcType === 'addState' || f.funcType === 'addStateShort') {
      const b = f.buffs[0];
      const kind = BUFF_KIND[b.type];
      if (!kind) { if (!IGNORED_BUFFS.has(b.type)) unsupported.push('buff:' + b.type); continue; }
      if (!target) { unsupported.push('target:' + f.funcTargetType); continue; }
      const e: Effect = { kind, target, lv: levels(f.svals) };
      const self: number[] = (b.ckSelfIndv ?? []).map((t: any) => t.id);
      const op: number[] = (b.ckOpIndv ?? []).map((t: any) => t.id);
      if (kind === 'cardUp') {
        const cards = self.map((id) => CARD_BY_TRAIT[id]).filter(Boolean);
        if (cards.length !== self.length || !cards.length) { unsupported.push('ckSelfIndv:' + b.type); continue; }
        e.cards = cards;
      } else if (self.length) { unsupported.push('ckSelfIndv:' + b.type); continue; }
      if (op.length) e.opTraits = op;
      out.push(e);
    } else if (f.funcType === 'gainNp' || f.funcType === 'shortenSkill' || f.funcType === 'replaceMember') {
      if (!target) { unsupported.push('target:' + f.funcTargetType); continue; }
      const kind: EffectKind = f.funcType === 'gainNp' ? 'gainNp'
        : f.funcType === 'shortenSkill' ? 'shortenSkill' : 'orderChange';
      out.push({ kind, target, lv: levels(f.svals) });
    } else if (!IGNORED_FUNCS.has(f.funcType) && !f.funcType.startsWith('damageNp')) {
      unsupported.push('func:' + f.funcType);
    }
  }
  return out;
}

function skillsOf(raw: any[], unsupported: string[]): Skill[] {
  // Same num appears once per upgrade (rank-up/interlude): highest priority wins.
  const byNum = new Map<number, any>();
  for (const s of raw) if (!byNum.has(s.num) || s.priority > byNum.get(s.num).priority) byNum.set(s.num, s);
  return [...byNum.values()].sort((a, b) => a.num - b.num)
    .map((s) => ({ num: s.num, cooldown: s.coolDown, effects: convertFunctions(s.functions, unsupported) }));
}

function npOf(svt: any, unsupported: string[]): NoblePhantasm | null {
  // Support NPs (no damage, e.g. Castoria) are not wave clearers: null.
  const nps = svt.noblePhantasms.filter((n: any) => n.functions.some((f: any) => f.funcType.startsWith('damageNp')));
  const np = nps.at(-1);
  if (!np) return null;
  const dmg = np.functions.find((f: any) => f.funcType.startsWith('damageNp'));
  const se = dmg.funcType === 'damageNpIndividual';
  if (dmg.funcType !== 'damageNp' && !se) unsupported.push('np:' + dmg.funcType);
  const ocs: any[][] = [dmg.svals, dmg.svals2, dmg.svals3, dmg.svals4, dmg.svals5];
  const extraFuncs = np.functions.filter((f: any) => f !== dmg);
  return {
    card: CARD_BY_ID[String(np.card)],
    aoe: dmg.funcTargetType === 'enemyAll',
    mult: ocs.map((oc) => oc.map((v) => v.Value)),
    seMult: se ? ocs.map((oc) => oc.map((v) => v.Correction)) : undefined,
    seTraits: se ? [dmg.svals[0].Target] : undefined,
    hits: np.npDistribution,
    npRate: np.npGain.np,
    extra: convertFunctions(extraFuncs, unsupported),
  };
}

export function compactServant(svt: any): CompactServant {
  const unsupported: string[] = [];
  // appendPassive num 100..104 = append 1..5; append 2 (num 101) is "Load Magical Energy".
  const append2 = svt.appendPassive?.find((a: any) => a.num === 101)?.skill;
  return {
    id: svt.id, collectionNo: svt.collectionNo, name: svt.name,
    className: svt.className, attribute: svt.attribute, traits: svt.traits.map((t: any) => t.id),
    atkGrowth: svt.atkGrowth,
    skills: skillsOf(svt.skills, unsupported),
    passives: svt.classPassive.flatMap((p: any) => convertFunctions(p.functions, unsupported)),
    append2: append2 ? append2.functions[0].svals.map((v: any) => v.Value) : [],
    np: npOf(svt, unsupported),
    unsupported: [...new Set(unsupported)],
  };
}

export function compactCE(ce: any): CompactCE {
  const unsupported: string[] = [];
  const base = ce.skills.filter((s: any) => (s.condLimitCount ?? 0) === 0);
  const mlb = ce.skills.filter((s: any) => s.condLimitCount === 4);
  const conv = (ss: any[]) => ss.flatMap((s) => convertFunctions(s.functions, unsupported));
  return {
    id: ce.id, collectionNo: ce.collectionNo, name: ce.name, atkGrowth: ce.atkGrowth,
    effects: conv(base), effectsMlb: mlb.length ? conv(mlb) : conv(base),
    unsupported: [...new Set(unsupported)],
  };
}

export function compactMC(mc: any): CompactMC {
  const unsupported: string[] = [];
  // MC skills all have num 0 in Atlas: order in the array is the in-game order.
  const skills: Skill[] = mc.skills.map((s: any, i: number) => ({
    num: (i + 1) as Skill['num'], cooldown: s.coolDown, effects: convertFunctions(s.functions, unsupported),
  }));
  return { id: mc.id, name: mc.name, skills, unsupported: [...new Set(unsupported)] };
}
