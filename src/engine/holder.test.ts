// CE effects conditioned on the holder's fixed traits (Effect.holderTraits).
import { describe, it, expect } from 'vitest';
import sapphireRaw from '../../test/fixtures/kaleid-sapphire.json';
import princessRaw from '../../test/fixtures/phantasmal-princess.json';
import { compactCE } from '../data/compact';
import { altria, siegfried, constants, member, mcCombat, prisonRuins } from './test-helpers';
import { initBattle } from './state';
import type { CompactServant } from '../data/types';

const sapphire = compactCE(sapphireRaw as any);
const princess = compactCE(princessRaw as any);
// A Berserker: Altria with the classBerserker trait (106) added.
const berserker: CompactServant = { ...altria, traits: [...altria.traits, 106] };
// Sapphire's bonus also needs its event's field traits.
const eventQuest = { ...prisonRuins, fieldTraits: [94000047, 94000048] };
const buffsWith = (svt: CompactServant, ce: typeof sapphire) =>
  initBattle([member(svt, 'u', { ce, ceLv: 1, ceMlb: true })], mcCombat, 10, eventQuest, constants).front[0]!.buffs;

describe('CE effects on holder traits', () => {
  it('Kaleid Sapphire: the female / unknown-gender bonus is kept with its condition', () => {
    expect(sapphire.effectsMlb).toContainEqual(expect.objectContaining({ kind: 'powerUp', holderTraits: [2, 3] }));
  });
  it('it applies to Altria (female), not to Siegfried; the unconditioned NP damage up applies to both', () => {
    const power = (b: ReturnType<typeof buffsWith>) => b.filter((x) => x.kind === 'powerUp' && x.passive).length;
    expect(power(buffsWith(altria, sapphire))).toBeGreaterThan(0);
    expect(power(buffsWith(siegfried, sapphire))).toBe(0);
    expect(buffsWith(siegfried, sapphire).some((x) => x.kind === 'npDmgUp')).toBe(true);
  });
  it('Phantasmal Princess: NP damage up for Berserkers only', () => {
    expect(princess.effectsMlb).toContainEqual(expect.objectContaining({ kind: 'npDmgUp', holderTraits: [106] }));
    expect(buffsWith(berserker, princess).some((x) => x.kind === 'npDmgUp')).toBe(true);
    expect(buffsWith(altria, princess).some((x) => x.kind === 'npDmgUp')).toBe(false);
  });
});
