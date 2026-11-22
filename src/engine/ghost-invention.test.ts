// Golden test against Chaldea's Laplace: NA quest 94136714 phase 1, "[Ghost Room]
// The Dangerous Invention" (war 9175, event 80494, field trait 94000160).
// Ishtar (Archer, NP1, ATK 15252) with Pioneering Oni (MLB), two Koyanskaya of
// Light (ATK 12616), Oberon in the back (ATK 12810), Chaldea Combat Uniform.
// Laplace (default damage roll 0.9 = RANDOM_MIN) shows:
//   T1: Ishtar S1 S2 S3, Koyan(2) S3 -> Ishtar, Koyan(3) S3 -> Ishtar, NP: 332,788 x 2
//   T2: Koyan(2) S1, Ishtar S3, Koyan(3) S1, Ishtar S1, NP: 526,783 x 2 and 579,439
//   T3: Ishtar S2 S3, Koyan(2) S2, Koyan(3) S2, order change Koyan(3) <-> Oberon,
//       Oberon S1 S2 S3 (-> Ishtar), MC S1, NP: 1,010,385 (enemy: 1,005,200 HP)
// It exercises Ishtar's S3 "Mana Burst Set" (a delayFunction: ATK +50% on the
// next turn, Effect.deferred), Koyanskaya's cooldown cuts and Oberon's S3 buff
// effectiveness up (buffRate: NP damage up x2). Turns 1-2 match to the point
// (the 1-point gap on the zombie is Laplace's 32-bit float rounding).
//
// Turn 3: our engine gives 981,523, i.e. exactly 15% of "power" short (1 +
// power + NP damage = 5.10 vs 5.25). The CE derived from the numbers: Laplace's
// Ishtar ATK 15252 = 12252 + Oni at max level (2000) + 1000 fou, and the
// missing 15% is Koyanskaya of Light's bond CE ("Koyanskaya's Ambition -East
// Coast Edition-": party Special Attack +15% vs [Human] and vs [Human
// Attribute] while she is on the field). Only the wave 3 boss has [Human
// Attribute] (202), which is why turns 1-2 match. Our engine does not apply a
// CE's party-wide effects (conservative), so the test emulates that aura as a
// +15% power vs 202 on Ishtar herself, which is exactly what it does here.
import { describe, it, expect } from 'vitest';
import ishRaw from '../../test/fixtures/ishtar.json';
import obRaw from '../../test/fixtures/oberon.json';
import koyRaw from '../../test/fixtures/koyanskaya-light.json';
import oniRaw from '../../test/fixtures/pioneering-oni.json';
import skill966533 from '../../test/fixtures/skill-966533.json';
import skill960408 from '../../test/fixtures/skill-960408.json';
import skill966456 from '../../test/fixtures/skill-966456.json';
import skill966458 from '../../test/fixtures/skill-966458.json';
import questRaw from '../../test/fixtures/quest-ghost-invention.json';
import { compactServant, compactCE } from '../data/compact';
import type { CompactCE, Effect } from '../data/types';
import { questFromAtlas, type RawQuest } from './quest';
import { initBattle, useSkill, useMc, endTurn, nextWave, type BattleState, type Quest } from './state';
import { fireNp } from './np';
import { constants, member, mcCombat } from './test-helpers';
import { RANDOM_MIN } from './damage';
import { solve, replay } from '../solver/solve';

const triggers = new Map<number, any>([skill966533, skill960408, skill966456, skill966458].map((k: any) => [k.id, k]));
const ishtar = compactServant(ishRaw as any, triggers);
const oberon = compactServant(obRaw as any, triggers);
const koyanskaya = compactServant(koyRaw as any, triggers);
const oni = compactCE(oniRaw as any);
const quest: Quest = questFromAtlas({ ...(questRaw as unknown as RawQuest), eventId: 80494 });

// Koyanskaya's bond CE aura, as it acts on Ishtar (see the header).
const bondAura: Effect = { kind: 'powerUp', target: 'self', lv: [{ value: 150, turns: -1, count: -1 }], opTraits: [202] };
const oniWithAura: CompactCE = { ...oni, effectsMlb: [...oni.effectsMlb, bondAura] };

// Lv90 ATK: Ishtar 12252, Koyanskaya 11616, Oberon 11810.
const team = (ce: CompactCE = oni) => [
  member(ishtar, 'ish', { fou: 15252 - 12252 - ce.atkGrowth[0], ce, ceLv: 1, ceMlb: true }),
  member(koyanskaya, 'koy2', { fou: 1000 }),
  member(koyanskaya, 'koy3', { fou: 1000 }),
  member(oberon, 'ob', { fou: 1000 }),
];

/** Laplace's line; returns the damage of Ishtar's NP on each enemy, per turn. */
function laplaceLine(ce?: CompactCE): number[][] {
  let s: BattleState = initBattle(team(ce), mcCombat, 10, quest, constants);
  expect(s.front[0]!.atk).toBe(15252);
  const out: number[][] = [];
  const np = () => {
    const r = fireNp(s, 'ish');
    out.push(s.enemies.map((e, i) => e.hp - r.state.enemies[i].hp));
    s = r.state;
  };
  s = useSkill(s, 'ish', 1); s = useSkill(s, 'ish', 2); s = useSkill(s, 'ish', 3);
  s = useSkill(s, 'koy2', 3, 'ish'); s = useSkill(s, 'koy3', 3, 'ish');
  np();
  s = nextWave(endTurn(s), quest, constants);
  s = useSkill(s, 'koy2', 1, 'ish'); s = useSkill(s, 'ish', 3); s = useSkill(s, 'koy3', 1, 'ish'); s = useSkill(s, 'ish', 1);
  np();
  s = nextWave(endTurn(s), quest, constants);
  s = useSkill(s, 'ish', 2); s = useSkill(s, 'ish', 3);
  s = useSkill(s, 'koy2', 2, 'ish'); s = useSkill(s, 'koy3', 2, 'ish');
  s = useMc(s, 2, mcCombat, 10, undefined, [2, 0]);
  s = useSkill(s, 'ob', 1); s = useSkill(s, 'ob', 2, 'ish'); s = useSkill(s, 'ob', 3, 'ish');
  s = useMc(s, 0, mcCombat, 10);
  np();
  return out;
}
const near = (got: number, want: number) => expect(Math.abs(got / want - 1)).toBeLessThan(0.02);

describe('Ghost Room "The Dangerous Invention" golden test (Laplace)', () => {
  it('the parts this line needs are usable', () => {
    expect(ishtar.unsupported).toEqual([]);
    expect(oberon.unsupported).toEqual([]);
    // Ishtar S3: the delayed ATK up (30%..50%, next turn).
    expect(ishtar.skills[2].effects).toEqual([expect.objectContaining({ kind: 'atkUp', target: 'self', deferred: { at: 'delay', turns: 1 } })]);
    expect(oberon.skills[2].lastTurnOnly).toBeDefined();
  });
  it('turns 1-2 match Laplace (±2%), at the same 0.9 roll', () => {
    expect(RANDOM_MIN).toBe(0.9);
    const [t1, t2] = laplaceLine();
    t1.forEach((d) => near(d, 332788));
    near(t2[0], 526783); near(t2[1], 579439); near(t2[2], 526783);
  });
  it('turn 3 matches Laplace (±2%) once Koyanskaya\'s bond CE aura is counted; without it, 15% of power short', () => {
    const t3 = laplaceLine(oniWithAura)[2];
    near(t3[0], 1010385);
    const bare = laplaceLine()[2][0];
    expect(bare / 1010385).toBeCloseTo(5.10 / 5.25, 3);
    expect(bare).toBeLessThan(1005200);
  });
  it('without the Mana Burst Set (delayed ATK up), turn 2 falls 18% short of Laplace', () => {
    const noS3 = { ...ishtar, skills: ishtar.skills.map((k) => (k.num === 3 ? { ...k, effects: [] } : k)) };
    let s = initBattle([member(noS3, 'ish', { fou: 15252 - 12252 - 500, ce: oni, ceLv: 1, ceMlb: true }), ...team().slice(1)], mcCombat, 10, quest, constants);
    s = useSkill(s, 'ish', 1); s = useSkill(s, 'ish', 2); s = useSkill(s, 'ish', 3);
    s = useSkill(s, 'koy2', 3, 'ish'); s = useSkill(s, 'koy3', 3, 'ish');
    s = nextWave(endTurn(fireNp(s, 'ish').state), quest, constants);
    s = useSkill(s, 'koy2', 1, 'ish'); s = useSkill(s, 'koy3', 1, 'ish'); s = useSkill(s, 'ish', 1);
    const r = fireNp(s, 'ish');
    expect((s.enemies[0].hp - r.state.enemies[0].hp) / 526783).toBeLessThan(0.85);
  });
  it('solver: finds a 3T with the aura (Oberon from the back, S3 on the last turn only)', () => {
    const r = solve(team(oniWithAura), mcCombat, 10, quest, constants, { maxMs: 120_000, maxSolutions: 1 });
    expect(r.solutions.length).toBe(1);
    const sol = r.solutions[0];
    expect(replay(team(oniWithAura), mcCombat, 10, quest, constants, sol)).toHaveLength(3);
    expect(sol.usesSwap).toBe(true);
    // Oberon's S2 / S3 (end-of-turn drain and sleep) only on the last turn.
    for (const t of sol.turns.slice(0, 2)) expect(t.some((x) => x.unit === 'ob')).toBe(false);
  }, 180_000);
});
