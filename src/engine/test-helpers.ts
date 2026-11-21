// Shared fixtures for engine tests (not used by the app).
import castoriaRaw from '../../test/fixtures/castoria.json';
import altriaRaw from '../../test/fixtures/altria.json';
import siegfriedRaw from '../../test/fixtures/siegfried.json';
import kscopeRaw from '../../test/fixtures/kaleidoscope.json';
import mcRaw from '../../test/fixtures/mc-combat.json';
import questRaw from '../../test/fixtures/quest-prison-ruins.json';
import classRel from '../../test/fixtures/class-relation.json';
import attrRel from '../../test/fixtures/attribute-relation.json';
import classAtk from '../../test/fixtures/class-attack-rate.json';
import { compactServant, compactCE, compactMC } from '../data/compact';
import type { CompactServant, CompactCE, Constants } from '../data/types';
import type { TeamMember } from './state';
import { questFromAtlas, type RawQuest } from './quest';

export const castoria = compactServant(castoriaRaw);
export const altria = compactServant(altriaRaw);
export const siegfried = compactServant(siegfriedRaw);
export const kaleidoscope = compactCE(kscopeRaw);
export const mcCombat = compactMC(mcRaw);
export const prisonRuinsRaw = questRaw as RawQuest;
export const prisonRuins = questFromAtlas(prisonRuinsRaw);
export const constants: Constants = {
  classAtk: classAtk as unknown as Constants['classAtk'],
  classRel: classRel as unknown as Constants['classRel'],
  attrRel: attrRel as unknown as Constants['attrRel'],
};

export function member(svt: CompactServant, key: string, over: Partial<TeamMember> = {}): TeamMember {
  return {
    svt, key, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 0,
    ce: null as CompactCE | null, ceLv: 1, ceMlb: false, ...over,
  };
}
