// Golden test against Chaldea's Laplace: NA quest 94136713 phase 1, "[Ghost Room]
// Spirit Bound in the Basement" (war 9175, event 80494, field trait 94000160).
// Ereshkigal (Lancer, NP1, ATK 12054) with Pioneering Oni (lv1, MLB) and two
// Koyanskaya of Light, Chaldea Combat Uniform. Laplace (default options: damage
// roll attackRateRandomMin = 0.9, the same roll as RANDOM_MIN) shows 368,064 on
// wave 1 and 297,325 on wave 2. The CE's "ATK Strength Up" (upDamage 200%,
// funcquestTvals [94000160]) is most of it: without it wave 2 falls short.
import { describe, it, expect } from 'vitest';
import eresh from '../../test/fixtures/ereshkigal.json';
import koyRaw from '../../test/fixtures/koyanskaya-light.json';
import oniRaw from '../../test/fixtures/pioneering-oni.json';
import skill966533 from '../../test/fixtures/skill-966533.json';
import ghostRaw from '../../test/fixtures/quest-ghost-room.json';
import { compactServant, compactCE } from '../data/compact';
import { questFromAtlas, type RawQuest } from './quest';
import { initBattle, useSkill, endTurn, nextWave, type BattleState, type Quest } from './state';
import { fireNp } from './np';
import { constants, member, mcCombat } from './test-helpers';
import { RANDOM_MIN } from './damage';
import { solve } from '../solver/solve';

const triggers = new Map<number, any>([[skill966533.id, skill966533]]);
const ereshkigal = compactServant(eresh as any, triggers);
const koyanskaya = compactServant(koyRaw as any, triggers);
const oni = compactCE(oniRaw as any);
const EVENT = 80494; // war 9175 "Super Mystery House, A.C.L." (QuestWar.eventId)
const ghost = questFromAtlas({ ...(ghostRaw as unknown as RawQuest), eventId: EVENT });

// Laplace's ATK: Ereshkigal 12054 (lv90 10343 + CE 500 + fou), Koyanskaya 12616.
const team = () => [
  member(ereshkigal, 'eresh', { fou: 12054 - 10343 - 500, ce: oni, ceLv: 1, ceMlb: true }),
  member(koyanskaya, 'koy2', { fou: 12616 - 11616 }),
  member(koyanskaya, 'koy3', { fou: 12616 - 11616 }),
];

/** Laplace's turns 1-2; returns the damage of each NP (one enemy per wave). */
function laplaceLine(q: Quest): number[] {
  let s: BattleState = initBattle(team(), mcCombat, 10, q, constants);
  expect(s.front[0]!.atk).toBe(12054);
  const dmg: number[] = [];
  const np = () => {
    const hp = s.enemies.find((e) => e.hp > 0)!.hp;
    const r = fireNp(s, 'eresh');
    dmg.push(Math.round(r.minMargin * hp));
    s = r.state;
  };
  s = useSkill(s, 'koy2', 3, 'eresh');
  s = useSkill(s, 'koy3', 3, 'eresh');
  s = useSkill(s, 'eresh', 2);
  np();
  s = nextWave(endTurn(s), q, constants);
  s = useSkill(s, 'koy2', 1, 'eresh');
  s = useSkill(s, 'koy3', 1, 'eresh');
  np();
  return dmg;
}

describe('Ghost Room golden test (Laplace)', () => {
  it('the quest exposes its field trait and event', () => {
    expect(ghost.fieldTraits).toEqual([94000160]);
    expect(ghost.eventId).toBe(EVENT);
  });
  it('wave 1 = 368,064 and wave 2 = 297,325 (±2%), at the same 0.9 roll as Laplace', () => {
    expect(RANDOM_MIN).toBe(0.9);
    const [w1, w2] = laplaceLine(ghost);
    expect(Math.abs(w1 / 368064 - 1)).toBeLessThan(0.02);
    expect(Math.abs(w2 / 297325 - 1)).toBeLessThan(0.02);
    // Wave 2 enemy: 182,636 HP, now cleared with margin.
    expect(w2).toBeGreaterThan(182636);
  });
  it('without the field trait the CE bonus does not apply (a third of the damage)', () => {
    const [, w2] = laplaceLine({ ...ghost, fieldTraits: [] });
    expect(w2 / 297325).toBeCloseTo(1 / 3, 1);
  });
  it('solver: waves 1-2 now clear; wave 3 is short of NP gauge, not damage', () => {
    // Buster NPs refund no gauge, and on turn 3 only Ereshkigal S2 is back
    // (Koyanskaya S1 shortens it twice on turn 2): 50% short of a third NP.
    const r = solve(team(), mcCombat, 10, ghost, constants, { maxMs: 20_000 });
    expect(r.exhausted).toBe(true);
    expect(r.solutions).toEqual([]);
    expect(r.best).toMatchObject({ wave: 3, reason: 'no NP charged', gaugeShort: 5000 });
  });
});
