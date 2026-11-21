import { describe, expect, it } from 'vitest';
import { castoria, altria, kaleidoscope, member } from '../engine/test-helpers';
import type { Solution } from '../solver/solve';
import { toFgaConfig } from './config';

const sol: Solution = { turns: [[{ kind: 'np', unit: 'a' }], [{ kind: 'np', unit: 'a' }], [{ kind: 'np', unit: 'a' }]], margins: [], actions: 3, usesSwap: false };
const team = [member(altria, 'a'), member(castoria, 's1', { ce: kaleidoscope, ceMlb: true })];

describe('toFgaConfig', () => {
  it('writes the battle config with JSON types FGA imports', () => {
    const cfg = JSON.parse(toFgaConfig(sol, team, ' Prison Ruins ', { collectionNo: 284, ceCollectionNo: 34, ceMlb: true }));
    expect(cfg).toEqual({
      autoskill_name: '3T Prison Ruins',
      autoskill_cmd: '4,#,4,#,4',
      autoskill_notes: expect.any(String),
      autoskill_party: '-1',
      support_mode: 'Preferred',
      support_pref_servant_list: ['Artoria (Caster)'],
      support_skill_max_1: true, support_skill_max_2: true, support_skill_max_3: true,
      support_pref_ce_list: ['Kaleidoscope.png'],
      support_pref_ce_mlb: true,
    });
    expect(cfg.autoskill_notes).toContain('Altria Caster [Kaleidoscope MLB]');
  });
  it('leaves the support out when FGA has no image for it', () => {
    const cfg = JSON.parse(toFgaConfig(sol, team, 'Q', { collectionNo: 2, ceMlb: false }));
    expect(Object.keys(cfg).sort()).toEqual(['autoskill_cmd', 'autoskill_name', 'autoskill_notes', 'autoskill_party']);
  });
});
