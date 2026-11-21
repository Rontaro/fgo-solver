import type {
  Card, Effect, EffectKind, TargetKind, Skill, NoblePhantasm,
  CompactServant, CompactCE, CompactMC, LevelVal,
} from './types';

// Raw Atlas Academy input is untyped JSON: `any` on the input side only.
//
// Safety principle: ignoring an effect that can only help is safe (a combo may
// be missed, never reported wrongly). Anything that could hurt, or that we do
// not recognise, marks the entity unsupported.

const CARD_BY_ID: Record<string, Card> = { '1': 'arts', '2': 'buster', '3': 'quick' };
const CARD_BY_TRAIT: Record<number, Card> = { 4001: 'arts', 4002: 'buster', 4003: 'quick' };
const ALL_CARDS: Card[] = ['arts', 'buster', 'quick'];

type Side = 'ally' | 'enemy';
const SIDE: Record<string, Side> = {
  self: 'ally', ptOne: 'ally', ptAll: 'ally', ptOther: 'ally', ptFull: 'ally', ptOtherFull: 'ally',
  ptselectOneSub: 'ally',
  enemy: 'enemy', enemyAll: 'enemy',
};
const TARGET: Record<string, TargetKind> = {
  // *Full variants also reach the backline. Mapping them to the front-line
  // target only drops the buff on subs: conservative for modelled (helpful)
  // effects; harmful ones are unsupported whatever the target.
  self: 'self', ptOne: 'ptOne', ptAll: 'ptAll', ptOther: 'ptOther', ptFull: 'ptAll', ptOtherFull: 'ptOther',
  ptselectOneSub: 'orderChange',
};

// Buffs we model. Only on allies: on an enemy they are unsupported.
const BUFF_KIND: Record<string, EffectKind> = {
  upAtk: 'atkUp', upCommandall: 'cardUp', upNpdamage: 'npDmgUp',
  upDamage: 'powerUp', upDropnp: 'npGainUp', upChagetd: 'ocUp',
  // Flat extra damage per hit-sequence, added after flooring (engine dmgPlus).
  addDamage: 'dmgPlus',
};
// Functions we model. Only on allies.
const FUNC_KIND: Record<string, EffectKind> = {
  gainNp: 'gainNp', shortenSkill: 'shortenSkill', replaceMember: 'orderChange',
};

// On allies: survival, stars, crits, defence, taunt, debuff resist, face cards.
// Enemies are not simulated as attackers and face cards/crits are out of the
// 3T model, so these never change the outcome; none of them lowers our damage
// or NP gauge.
const IGNORED_BUFFS_ALLY = new Set([
  'invincible', 'specialInvincible', 'avoidance', 'upDefence', 'upDefencecommandall',
  'upCriticaldamage', 'upCriticalpoint', 'upCriticalrate', 'upStarweight', 'upDropstar',
  'upTolerance', 'upToleranceSubstate', 'regainNp', 'regainHp', 'regainStar', 'guts', 'gutsRatio',
  'upHate', 'avoidState', 'upGrantstate', 'upGivegainHp', 'upGainHp', 'addMaxhp', 'upDamagedropnp',
  'upResistInstantdeath', 'upNonresistInstantdeath',
  // Turns face cards into another type (Altria's Dragon's Core): face cards are
  // out of the model and the NP card itself is unchanged.
  'changeCommandCardType',
  // Hit through enemy invincible/evade: enemies never act in our model, so they
  // never have those buffs; it can only help.
  'pierceInvincible', 'breakAvoidance',
  // Damage cut / defence down on our side: survival only, enemies do not attack
  // in the model.
  'subSelfdamage', 'downDefence', 'downDefencecommandall',
  // Adds a trait to our servant: we never read ally traits added at runtime,
  // so at worst we miss a bonus that depends on it (conservative).
  'addIndividuality',
  // Ignore enemy DEF buffs: enemies have none in the model; only helps.
  'pierceDefence',
  // Crit damage taken / star absorption / instant-death odds and resist /
  // debuff resist down (demerit): crits, stars, enemy debuffs and death are out
  // of the model.
  'downCriticalRateDamageTaken', 'downStarweight', 'upGrantInstantdeath', 'avoidInstantdeath',
  'downTolerance',
  // Changes field traits: none of our modelled effects reads the field (field
  // conditions are reported as cond:*).
  'fieldIndividuality',
  // NOT ignored, on purpose: *Function buffs (attackAfterFunction,
  // commandattackAfterFunction, attackBefore..., selfturnend..., damage...,
  // guts..., dead..., delay...) trigger another skill whose functions are not
  // in the servant export (only its id in svals.Value). They stay unsupported
  // until build-data resolves those skill ids and classifies them recursively.
]);
// On enemies: only effects that help us (weaker / stunned / slower enemies).
// Ignoring them under-estimates our damage, which is the prudent direction.
const IGNORED_BUFFS_ENEMY = new Set([
  'downDefence', 'downDefencecommandall', 'donotAct', 'downAtk', 'downCriticalrate',
  'downCriticalpoint', 'downTolerance', 'downNpdamage',
  // Seal skills / seal NP / damage-over-time (burn, poison, curse): weaker
  // enemies; DoT is extra damage we do not count.
  'donotSkill', 'donotNoble', 'reduceHp',
  // Adds a trait to an enemy: we only miss supereffective/"vs trait" bonuses.
  'addIndividuality',
  // Stronger DoT on the enemy / higher death chance on it: extra damage or
  // kills we do not count.
  'upFuncHpReduce', 'upNonresistInstantdeath',
  // Enemy healing received down: we do not model enemy healing.
  'downGainHp',
  // Enemy immunity to debuffs: we never count our debuffs on enemies.
  'avoidState',
]);
const IGNORED_FUNCS_ALLY = new Set([
  'gainStar', 'gainHp', 'gainHpPer', 'none',
  // Self HP loss that cannot kill (HP stops at 1): survival only.
  'lossHpSafe',
  // Stars lost, popup text, face-card reshuffle: no effect on NPs.
  'lossStar', 'displayBuffstring', 'cardReset',
  // NP gain scaled by a buff count: helpful only, not modelled yet.
  'gainNpBuffIndividualSum',
  // Adds a field trait: same reasoning as fieldIndividuality.
  'addFieldChangeToField',
  // hastenNpturn on an ally with team player/playerAndEnemy (team=enemy variants
  // are skipped earlier, they only run when an enemy casts the skill). Its only
  // possible effect is to raise a charge/gauge, never to lower it: helpful only.
  'hastenNpturn',
  // Bond/drop/event-point bonuses: no battle effect.
  'servantFriendshipUp', 'eventDropUp', 'eventPointUp', 'eventDropRateUp', 'eventPointRateUp',
  'expUp', 'qpUp', 'qpDropUp', 'userEquipExpUp',
]);
// hastenNpturn on an enemy (team player/playerAndEnemy) fills its charge bar:
// enemies are not simulated as attackers, so a charged enemy NP never changes
// whether our NPs clear the wave.
const IGNORED_FUNCS_ENEMY = new Set([
  'hastenNpturn', 'delayNpturn', 'absorbNpturn', 'instantDeath', 'gainHpFromTargets', 'subState', 'none',
  // Drains the enemy charge bar (lossNp on an enemy is charge, not our gauge).
  'lossNp', 'displayBuffstring',
]);
// subState on an ally is safe only when it removes debuffs and nothing else:
// buffNegativeEffect, or the debuff-only DoT families poison/burn/curse.
const DEBUFF_TRAITS = new Set([3005, 3011, 3015, 3026]);

// Conditions we understand. Anything else on a modelled effect -> unsupported.
const SVAL_KEYS = new Set([
  'Rate', 'Turn', 'Count', 'Value', 'ShowState', 'Correction', 'Target',
  // Display only: whether to show "MISS"/"NO EFFECT" popups (no game logic).
  'ShowQuestNoEffect', 'HideMiss', 'HideNoEffect',
  // Random pick among sets (ActSet + weight) or a player-chosen option
  // (ActSelectIndex): the effect is not guaranteed, so isChancy() turns it into
  // a failed chance (value 0) like Rate < 1000.
  'ActSet', 'ActSetWeight', 'ActSelectIndex',
]);
const CHANCE_KEYS = ['ActSet', 'ActSelectIndex'];
// ProgressSelfTurn: the buff's turns tick on its holder's turn (standard for
// player-side buffs, matches how we count turns).
// checkIndvType: how ckSelfIndv/ckOpIndv lists match (any vs all). Identical
// for lists of 0 or 1 traits, so it is accepted only then (see plain()).
const BUFF_SCRIPT_KEYS = new Set(['ProgressSelfTurn', 'checkIndvType']);
const OC_SVALS = ['svals2', 'svals3', 'svals4', 'svals5'];

type Class = { cls: 'apply'; kind: EffectKind } | { cls: 'ignore' } | { cls: 'unsupported'; reason: string };

function classify(f: any): Class {
  const side = SIDE[f.funcTargetType];
  if (!side) return { cls: 'unsupported', reason: 'target:' + f.funcTargetType };
  const at = side === 'enemy' ? '@enemy' : '';
  if (f.funcType === 'addState' || f.funcType === 'addStateShort') {
    const t: string | undefined = f.buffs?.[0]?.type;
    if (!t) return { cls: 'unsupported', reason: 'buff:none' };
    if (side === 'ally' && BUFF_KIND[t]) return { cls: 'apply', kind: BUFF_KIND[t] };
    if ((side === 'ally' ? IGNORED_BUFFS_ALLY : IGNORED_BUFFS_ENEMY).has(t)) return { cls: 'ignore' };
    return { cls: 'unsupported', reason: 'buff:' + t + at };
  }
  if (side === 'ally' && FUNC_KIND[f.funcType]) return { cls: 'apply', kind: FUNC_KIND[f.funcType] };
  if (side === 'ally' && f.funcType === 'subState') {
    const tv: number[] = (f.traitVals ?? []).map((t: any) => t.id);
    if (tv.length && tv.every((id) => DEBUFF_TRAITS.has(id))) return { cls: 'ignore' };
  }
  if ((side === 'ally' ? IGNORED_FUNCS_ALLY : IGNORED_FUNCS_ENEMY).has(f.funcType)) return { cls: 'ignore' };
  return { cls: 'unsupported', reason: 'func:' + f.funcType + at };
}

// True when the function carries no condition beyond the ones we model.
// functvals = traits the target must have. On a self-targeted function, traits
// the servant always has (its base traits) make the condition always true.
function plain(f: any, selfTraits?: Set<number>): boolean {
  const tv: number[] = (f.functvals ?? []).map((t: any) => t.id);
  const tvOk = !tv.length || (f.funcTargetType === 'self' && !!selfTraits && tv.every((id) => selfTraits.has(id)));
  if (!tvOk || f.funcquestTvals?.length || f.overWriteTvalsList?.length) return false;
  if (f.script && Object.keys(f.script).length) return false;
  for (const k of ['svals', ...OC_SVALS]) {
    for (const v of f[k] ?? []) if (Object.keys(v).some((key) => !SVAL_KEYS.has(key))) return false;
  }
  const b = f.buffs?.[0];
  const script = b?.script ?? {};
  if (!Object.keys(script).every((k) => BUFF_SCRIPT_KEYS.has(k))) return false;
  if ('checkIndvType' in script && ((b.ckSelfIndv?.length ?? 0) > 1 || (b.ckOpIndv?.length ?? 0) > 1)) return false;
  return true;
}

const isChancy = (v: any) => CHANCE_KEYS.some((k) => k in v);

function levels(svals: any[], ok: boolean[]): LevelVal[] {
  return svals.map((v, i) => ({ value: ok[i] ? v.Value ?? 0 : 0, turns: v.Turn ?? -1, count: v.Count ?? -1 }));
}

interface ConvOpts {
  npDamage?: any;   // the NP's main damage function: skipped, splits pre/post extras
  npExtras?: boolean; // NP extras: fill Effect.oc when OC variants differ
  selfTraits?: Set<number>; // the servant's base traits (self functvals check)
}

/*
 * Rate rules (applied after classification, so ignored effects are never
 * looked at and unsupported ones are reported whatever their Rate):
 * - Rate >= 1000: guaranteed (MCs use 5000).
 * - 0 <= Rate < 1000: chance-based, treated as absent: a modelled (helpful)
 *   effect gets value 0 at that level; if no level is guaranteed it is dropped.
 * - Rate < 0: dependent follow-up, runs only if the previous function in the
 *   same list succeeded. Kept only when |Rate| >= 1000 and the previous function
 *   was applied unconditionally (ally target, no extra conditions, guaranteed
 *   at every level). Otherwise treated like a failed chance (value 0).
 * - ActSet / ActSelectIndex (random or player-chosen option): not guaranteed,
 *   handled like 0 <= Rate < 1000.
 * Rate is evaluated per level, since it can vary across levels.
 */
export function convertFunctions(funcs: any[], unsupported: string[], opts: ConvOpts = {}): Effect[] {
  const out: Effect[] = [];
  let prevOk = false;
  let afterDamage = false;
  for (const f of funcs) {
    if (opts.npDamage && f === opts.npDamage) { prevOk = true; afterDamage = true; continue; }
    // team=enemy: only runs when an enemy casts it. Never for our side.
    if (f.funcTargetTeam === 'enemy') { prevOk = false; continue; }
    const svals: any[] = f.svals ?? [];
    // svals = OC1; svals2..svals5 = OC2..OC5 (NP functions only). The Rate rule
    // applies to every OC variant; plain() checks the keys of all of them.
    const sets: any[][] = [svals, ...OC_SVALS.map((k) => f[k]).filter(Boolean)];
    const isPlain = plain(f, opts.selfTraits);
    const okOf = (set: any[]) => set.map((v) => {
      if (isChancy(v)) return false;
      const r = v.Rate ?? 1000;
      return r >= 1000 || (r <= -1000 && prevOk);
    });
    const setOk = sets.map(okOf);
    const lvOk = setOk[0];
    prevOk = SIDE[f.funcTargetType] === 'ally' && isPlain && lvOk.length > 0 && setOk.every((s) => s.every(Boolean));

    const c = classify(f);
    if (c.cls === 'ignore') continue;
    if (c.cls === 'unsupported') { unsupported.push(c.reason); continue; }
    if (!isPlain) { unsupported.push('cond:' + f.funcType); continue; }
    if (!setOk.some((s) => s.some(Boolean))) continue;

    // lv = OC1 values: code that ignores OC stays conservative for helpful effects.
    const e: Effect = { kind: c.kind, target: TARGET[f.funcTargetType], lv: levels(svals, lvOk) };
    if (opts.npExtras && sets.length === 5 && sets.some((s) => JSON.stringify(s) !== JSON.stringify(svals))) {
      e.oc = sets.map((s, i) => levels(s, setOk[i]));
    }
    if (f.funcType === 'addState' || f.funcType === 'addStateShort') {
      const b = f.buffs[0];
      const self: number[] = (b.ckSelfIndv ?? []).map((t: any) => t.id);
      const op: number[] = (b.ckOpIndv ?? []).map((t: any) => t.id);
      if (c.kind === 'cardUp') {
        // Empty ckSelfIndv = unconditioned: applies to every card, NP card included.
        const cards = self.length ? self.map((id) => CARD_BY_TRAIT[id]).filter(Boolean) : ALL_CARDS;
        if (cards.length !== self.length && self.length) { unsupported.push('ckSelfIndv:' + b.type); continue; }
        e.cards = cards;
      } else if (self.length) { unsupported.push('ckSelfIndv:' + b.type); continue; }
      if (op.length) e.opTraits = op;
    }
    if (opts.npDamage && !afterDamage) e.pre = true;
    out.push(e);
  }
  return out;
}

function skillsOf(raw: any[], unsupported: string[], selfTraits?: Set<number>): Skill[] {
  // Same num appears once per upgrade (rank-up/interlude): highest priority wins.
  const byNum = new Map<number, any>();
  for (const s of raw) if (!byNum.has(s.num) || s.priority > byNum.get(s.num).priority) byNum.set(s.num, s);
  return [...byNum.values()].sort((a, b) => a.num - b.num)
    .map((s) => ({ num: s.num, cooldown: s.coolDown, effects: convertFunctions(s.functions, unsupported, { selfTraits }) }));
}

const isDamage = (f: any) => f.funcType.startsWith('damageNp');

function npOf(svt: any, unsupported: string[], selfTraits?: Set<number>): NoblePhantasm | null {
  // Highest priority NP is the current one (last wins ties).
  let np: any = null;
  for (const n of svt.noblePhantasms) if (!np || n.priority >= np.priority) np = n;
  if (!np) return null;
  // Support NPs (no damage, e.g. Castoria) are not wave clearers: null.
  const dmg = np.functions.find(isDamage);
  if (!dmg) return null;
  const card = CARD_BY_ID[String(np.card)];
  if (!card) { unsupported.push('np:card:' + np.card); return null; }
  const se = dmg.funcType === 'damageNpIndividual';
  // damageNpPierce = damageNp that ignores enemy DEF buffs. Enemy DEF buffs are
  // not in the model (enemies do not act), so it computes exactly like damageNp.
  const plainDmg = dmg.funcType === 'damageNp' || dmg.funcType === 'damageNpPierce';
  if (!plainDmg && !se) unsupported.push('np:' + dmg.funcType);
  if (!plain(dmg)) unsupported.push('cond:' + dmg.funcType);
  const ocs: any[][] = [dmg.svals, ...OC_SVALS.map((k) => dmg[k])];
  if (ocs.some((oc) => oc.some((v) => (v.Rate ?? 1000) < 1000))) unsupported.push('np:rate');
  return {
    card,
    aoe: dmg.funcTargetType === 'enemyAll',
    mult: ocs.map((oc) => oc.map((v) => v.Value)),
    seMult: se ? ocs.map((oc) => oc.map((v) => v.Correction)) : undefined,
    seTraits: se ? [dmg.svals[0].Target] : undefined,
    hits: np.npDistribution,
    npRate: np.npGain.np,
    // Any other damageNp* in the list is reported unsupported by convertFunctions.
    extra: convertFunctions(np.functions, unsupported, { npDamage: dmg, npExtras: true, selfTraits }),
  };
}

export function compactServant(svt: any): CompactServant {
  const unsupported: string[] = [];
  // appendPassive num 100..104 = append 1..5; append 2 (num 101) is "Load Magical Energy".
  const selfTraits = new Set<number>(svt.traits.map((t: any) => t.id));
  // A form change (e.g. Mélusine, Ptolemaios) swaps skills and NP: the highest
  // priority skill/NP picked below may only exist after it. Checked on every
  // skill and NP variant, not only the chosen ones.
  const groups = [...svt.skills, ...svt.noblePhantasms];
  if (groups.some((g: any) => g.functions.some((f: any) => f.funcType === 'transformServant' && f.funcTargetTeam !== 'enemy'))) {
    unsupported.push('func:transformServant');
  }
  const append2 = svt.appendPassive?.find((a: any) => a.num === 101)?.skill;
  return {
    id: svt.id, collectionNo: svt.collectionNo, name: svt.name,
    className: svt.className, attribute: svt.attribute, traits: svt.traits.map((t: any) => t.id),
    atkGrowth: svt.atkGrowth,
    skills: skillsOf(svt.skills, unsupported, selfTraits),
    passives: svt.classPassive.flatMap((p: any) => convertFunctions(p.functions, unsupported, { selfTraits })),
    append2: append2 ? append2.functions[0].svals.map((v: any) => v.Value) : [],
    np: npOf(svt, unsupported, selfTraits),
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
