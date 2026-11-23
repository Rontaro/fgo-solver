// Golden tests from the expected values of Chaldea's own battle tests
// (test/app/battle/models/battle_test.dart, "Combat integration"), computed by
// its Laplace engine on JP data. Only the numbers and the scenario are taken
// (no code): quest 93000406 phase 3 "王室の狩場", whose wave 1 has a caster
// ("Sky caster", 18,334 HP) in field slot 2. Chaldea's defaults: skill level
// 10, damage roll at the minimum (0.9, our RANDOM_MIN), ATK fou as stated.
//
// Chaldea pins the skill / NP variants with setSkillStrengthenLvs and
// setNpStrengthenLv; pin() picks the same ones from the Atlas data (JP Altria
// has newer upgrades, strengthStatus 99, which our compaction would choose).
import { describe, it, expect } from 'vitest';
import altriaRaw from '../../test/fixtures/jp-altria.json';
import koyRaw from '../../test/fixtures/jp-koyanskaya-light.json';
import yuyuRaw from '../../test/fixtures/jp-yang-guifei.json';
import okuniRaw from '../../test/fixtures/jp-okuni.json';
import skadiRaw from '../../test/fixtures/jp-skadi.json';
import castoriaRaw from '../../test/fixtures/jp-castoria.json';
import kamaRaw from '../../test/fixtures/jp-kama-avenger.json';
import sapphireRaw from '../../test/fixtures/jp-sapphire.json';
import hijikataRaw from '../../test/fixtures/jp-hijikata.json';
import bunyanRaw from '../../test/fixtures/jp-bunyan.json';
import robertsRaw from '../../test/fixtures/jp-roberts.json';
import triggerCacheJP from '../../data-cache/trigger-skills-JP.json';
import questRaw from '../../test/fixtures/jp-quest-sky-caster.json';
import { compactCE, compactServant } from '../data/compact';
import { questFromAtlas, type RawQuest } from './quest';
import { initBattle, useSkill, type BattleState } from './state';
import { fireNp } from './np';
import { constants, kaleidoscope, member, mcCombat } from './test-helpers';
import type { TeamMember } from './state';
import { RANDOM_MIN } from './damage';

/** Keeps only the given skill ids (per skill num) and NP id, as Chaldea's strengthen levels pick them. */
function pin(raw: any, skillIds: Record<number, number>, npId?: number): any {
  return {
    ...raw,
    skills: raw.skills.filter((s: any) => skillIds[s.num] === undefined || s.id === skillIds[s.num]),
    noblePhantasms: npId === undefined ? raw.noblePhantasms : raw.noblePhantasms.filter((n: any) => n.id === npId),
  };
}

// setSkillStrengthenLvs([1, 2, 1]): S1 "Charisma B" (5450), S2 "Dragon Core B"
// (756450); setNpStrengthenLv(2): NP 100102.
const altria = compactServant(pin(altriaRaw, { 1: 5450, 2: 756450 }, 100102));
const koyanskaya = compactServant(koyRaw as any);
// Yang Guifei [2, 1, 1]: S1 710551, S3 712550. Okuni [1, 1, 1]: S1 954450.
const yuyu = compactServant(pin(yuyuRaw, { 1: 710551, 3: 712550 }));
const okuni = compactServant(pin(okuniRaw, { 1: 954450 }));
const skadi = compactServant(skadiRaw as any);
const castoria = compactServant(castoriaRaw as any);
// getNP100Equip(): Kaleidoscope lv 100, MLB (+100% NP charge, ATK 2000).
const dps = (svt: typeof yuyu, key: string): TeamMember =>
  member(svt, key, { lv: 90, npLv: 5, fou: 1000, ce: kaleidoscope, ceLv: 100, ceMlb: true });
const support = (svt: typeof yuyu, key: string): TeamMember => member(svt, key, { lv: 90, npLv: 1, fou: 0 });

/** Damage on the sky caster and the NP gauge of the shooter right after its NP. */
function shoot(s: BattleState, key: string): { dmg: number; gauge: number } {
  // battle.enemyTargetIndex = 1 in Chaldea: the turn target is the sky caster.
  const r = fireNp({ ...s, target: s.field[SKY_CASTER] }, key);
  return { dmg: s.enemies[SKY_CASTER].hp - r.state.enemies[SKY_CASTER].hp, gauge: r.state.front.find((u) => u?.key === key)!.gauge };
}
const quest = questFromAtlas(questRaw as unknown as RawQuest);
const SKY_CASTER = 1;

const npOnSkyCaster = (s: BattleState): number => {
  const before = s.enemies[SKY_CASTER].hp;
  return before - fireNp(s, 'altria').state.enemies[SKY_CASTER].hp;
};

describe('Chaldea battle_test.dart golden values (JP, quest 93000406/3)', () => {
  it('the scenario as Chaldea sets it up', () => {
    expect(RANDOM_MIN).toBe(0.9);
    expect(quest.waves[0][SKY_CASTER]).toMatchObject({ className: 'caster', hp: 18334 });
    expect(altria.unsupported).toEqual([]);
    expect(altria.np?.card).toBe('buster');
  });

  it('Altria NP1 OC1, lv 90, no fou: 12,542', () => {
    let s = initBattle([member(altria, 'altria', { lv: 90, npLv: 1, fou: 0 })], mcCombat, 10, quest, constants);
    s = { ...s, front: s.front.map((u) => (u ? { ...u, gauge: 10000 } : u)) };
    expect(npOnSkyCaster(s)).toBe(12542);
  });

  it('Altria (1000 fou) S1 S2 with double Koyanskaya of Light S1 S3: 52,388', () => {
    let s = initBattle([
      member(altria, 'altria', { lv: 90, npLv: 1, fou: 1000 }),
      member(koyanskaya, 'koy1', { lv: 90, npLv: 1, fou: 0 }),
      member(koyanskaya, 'koy2', { lv: 90, npLv: 1, fou: 0 }),
    ], mcCombat, 10, quest, constants);
    s = useSkill(s, 'altria', 1); s = useSkill(s, 'altria', 2);
    s = useSkill(s, 'koy1', 1, 'altria'); s = useSkill(s, 'koy1', 3, 'altria');
    s = useSkill(s, 'koy2', 1, 'altria'); s = useSkill(s, 'koy2', 3, 'altria');
    expect(s.front[0]!.gauge).toBeGreaterThanOrEqual(10000);
    expect(npOnSkyCaster(s)).toBe(52388);
  });

  // Yang Guifei's NP is damageNpStateIndividualFix (supereffective vs burned
  // enemies): computed at its base rate, exact here since the sky caster is
  // not burned yet.
  it('Yang Guifei NP5 OC1 with Kaleidoscope: 52,575, gauge 9.14% after (2 hits overkill)', () => {
    const s = initBattle([dps(yuyu, 'yuyu')], mcCombat, 10, quest, constants);
    expect(shoot(s, 'yuyu')).toEqual({ dmg: 52575, gauge: 914 });
  });

  it('Yang Guifei with double Altria Caster (S1 S2 S3 each): 146,896, gauge 32.27% after', () => {
    let s = initBattle([dps(yuyu, 'yuyu'), support(castoria, 'c1'), support(castoria, 'c2')], mcCombat, 10, quest, constants);
    for (const c of ['c1', 'c2']) for (const n of [1, 2, 3] as const) s = useSkill(s, c, n, 'yuyu');
    expect(shoot(s, 'yuyu')).toEqual({ dmg: 146896, gauge: 3227 });
  });

  // Okuni's NP first lowers the target's Quick resistance by 20%
  // (downDefencecommandall vs cardQuick, Value 200, a pre-damage debuff on the
  // enemy: Enemy.debuffs), which counts for both damage and NP gain.
  it('Izumo no Okuni NP5 OC1 with Kaleidoscope: 56,556, gauge 14.35% after', () => {
    const s = initBattle([dps(okuni, 'okuni')], mcCombat, 10, quest, constants);
    expect(shoot(s, 'okuni')).toEqual({ dmg: 56556, gauge: 1435 });
  });

  it('Izumo no Okuni with double Scathach-Skadi (Caster) (S1 S3 each): 103,687, gauge 27.40% after', () => {
    let s = initBattle([dps(okuni, 'okuni'), support(skadi, 's1'), support(skadi, 's2')], mcCombat, 10, quest, constants);
    for (const k of ['s1', 's2']) for (const n of [1, 3] as const) s = useSkill(s, k, n, 'okuni');
    expect(shoot(s, 'okuni')).toEqual({ dmg: 103687, gauge: 2740 });
  });

  // "Kama 3 turn loop & double Castoria": Kama (Avenger) lv 120, NP5, 2000
  // fou, appends 10/10/10, Magical Girl of Sapphire lv 100 MLB; Kama S1,
  // Castoria (1) S2 S3, Castoria (2) S2 S3. Her NP (damageNpStateIndividualFix,
  // supereffective vs charmed enemies) at its base rate: the caster is not
  // charmed. Chaldea's NP gauge after it, 124.22%, includes its NP "pity"
  // rounding (a gauge of 99%+ counts as 100%, applied hit by hit), which we do
  // not model (it only adds charge): ours may only be lower.
  it('Kama (Avenger) with double Altria Caster: 82,618 on the sky caster', () => {
    const kama = compactServant(kamaRaw as any);
    const sapphire = compactCE(sapphireRaw as any);
    let s = initBattle([
      member(kama, 'kama', { lv: 120, npLv: 5, fou: 2000, append2Lv: 10, ce: sapphire, ceLv: 100, ceMlb: true }),
      member(castoria, 'c1', { lv: 90, npLv: 5, fou: 1000 }),
      member(castoria, 'c2', { lv: 90, npLv: 5, fou: 1000 }),
    ], mcCombat, 10, quest, constants);
    s = useSkill(s, 'kama', 1);
    for (const c of ['c1', 'c2']) for (const n of [2, 3] as const) s = useSkill(s, c, n, 'kama');
    const r = shoot(s, 'kama');
    expect(r.dmg).toBe(82618);
    expect(r.gauge).toBeLessThanOrEqual(12422);
  });
});

// function_executor_test.dart: NP damage variants on the same quest (target:
// enemy slot 1 = index 0, a saber; Kaleidoscope lv 100 MLB; defaults NP5,
// skills 10, 1000 ATK fou).
describe('Chaldea function_executor_test.dart NP damage variants (JP, quest 93000406/3)', () => {
  const triggers = new Map<number, any>(Object.entries((triggerCacheJP as any).skills)
    .filter(([, v]) => v).map(([k, v]) => [Number(k), v]));
  const at = (lv: number) => (svt: ReturnType<typeof compactServant>, key: string): TeamMember =>
    member(svt, key, { lv, npLv: 5, fou: 1000, ce: kaleidoscope, ceLv: 100, ceMlb: true });
  const npOn = (s: BattleState, key: string) => {
    const r = fireNp(s, key);
    return s.enemies.map((e, i) => e.hp - r.state.enemies[i].hp);
  };

  it('Hijikata (damageNpHpratioLow, NP 702502) at full HP: 107,144', () => {
    const hijikata = compactServant(pin(hijikataRaw, {}, 702502), triggers);
    expect(hijikata.np?.unsupported).toBeUndefined();
    const s = initBattle([at(90)(hijikata, 'h')], mcCombat, 10, quest, constants);
    expect(npOn(s, 'h')[0]).toBe(107144);
  });

  it('Paul Bunyan (damageNpIndividualSum on her own buffs): first NP 20,323', () => {
    // PlayerSvtData.id defaults to the first NP of the group (1001301), not the upgraded one.
    const bunyan = compactServant(pin(bunyanRaw, {}, 1001301), triggers);
    expect(bunyan.unsupported).toEqual([]);
    const s = initBattle([at(90)(bunyan, 'b')], mcCombat, 10, quest, constants);
    expect(npOn(s, 'b')[0]).toBe(20323);
  });

  // damageNpRare: x Correction vs enemies of rarity 1-2; the three enemies
  // here are rarity 2 (the caster also takes Rider's class advantage).
  it('Bartholomew Roberts (damageNpRare) lv 60: 24,043 / 48,087 / 24,043', () => {
    const roberts = compactServant(robertsRaw as any, triggers);
    expect(roberts.np?.rare).toMatchObject({ onEnemy: true, rarities: [1, 2] });
    const s = initBattle([at(60)(roberts, 'r')], mcCombat, 10, quest, constants);
    expect(npOn(s, 'r')).toEqual([24043, 48087, 24043]);
  });
});
