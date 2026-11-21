import type { TeamMember } from '../engine/state';
import type { Solution } from '../solver/solve';
import { toFgaCommand } from './command';
import names from './support-names.json';

/** The borrowed support: our collectionNos; mapped to FGA image names here. */
export interface SupportInfo { collectionNo: number; ceCollectionNo?: number; ceMlb: boolean }

const servantNames: Record<string, string> = names.servants;
const ceNames: Record<string, string> = names.ces;

/*
 * A .fga file: one battle config's SharedPreferences as a flat JSON object
 * (prefs/.../ImportExport.kt, BattleConfigFile). Support prefs live in the same
 * SharedPreferences (BattleConfigCore.support = SupportPrefsCore(maker)), so
 * they go in the same file. autoskill_party is stringAsInt: a string.
 * Support servants are FGA asset folder names, CEs asset file names (.png).
 */
export function toFgaConfig(solution: Solution, team: readonly TeamMember[], questName: string,
  supportInfo: SupportInfo | null): string {
  const label = (m: TeamMember) => m.svt.name + (m.ce ? ` [${m.ce.name}${m.ceMlb ? ' MLB' : ''}]` : '');
  const notes = [
    `Front: ${team.slice(0, 3).map(label).join(', ')}`,
    team.length > 3 ? `Back: ${team.slice(3).map(label).join(', ')}` : '',
    'Generato da fgo-solver.',
  ].filter(Boolean).join('\n');
  const cfg: Record<string, string | number | boolean | string[]> = {
    autoskill_name: `3T ${questName.trim()}`.trim(),
    autoskill_cmd: toFgaCommand(solution, team),
    autoskill_notes: notes,
    autoskill_party: '-1',
  };
  const svt = supportInfo ? servantNames[supportInfo.collectionNo] : undefined;
  if (supportInfo && svt) {
    cfg.support_mode = 'Preferred';
    cfg.support_pref_servant_list = [svt];
    // The solver assumes support skills 10/10/10.
    cfg.support_skill_max_1 = true;
    cfg.support_skill_max_2 = true;
    cfg.support_skill_max_3 = true;
    const ce = supportInfo.ceCollectionNo !== undefined ? ceNames[supportInfo.ceCollectionNo] : undefined;
    if (ce) {
      cfg.support_pref_ce_list = [ce];
      cfg.support_pref_ce_mlb = supportInfo.ceMlb;
    }
  }
  return JSON.stringify(cfg, null, 2);
}
