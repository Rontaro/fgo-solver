import type { TeamMember } from '../engine/state';
import type { Solution } from '../solver/solve';

/*
 * Fate-Grand-Automata skill command (scripts/.../models/AutoSkillCommand.kt):
 * servant skills a-i (front slot x skill), optional ally target 1-3; MC skills
 * j/k/l with optional target; order change x<starting 1-3><sub 1-3> (FGA always
 * presses MC skill 3 for it); NP 4/5/6; enemy target t1-t3; no-op 0. Turns are
 * split by ",", waves by ",#,"; our 3T has one turn per wave.
 *
 * FGA keeps only the last NP group of a turn (AutoSkill.execute), so the NPs
 * are written together at the end, after at most one enemy target: the one of
 * the first single-target NP. The attack itself is implied (FGA fills the rest
 * of the turn with face cards).
 */
export function toFgaCommand(solution: Solution, team: readonly Pick<TeamMember, 'key'>[]): string {
  const front: (string | undefined)[] = team.slice(0, 3).map((m) => m.key);
  const back: (string | undefined)[] = team.slice(3).map((m) => m.key);
  const pos = (key: string | undefined) => (key === undefined ? -1 : front.indexOf(key));
  const target = (key: string | undefined) => {
    const p = pos(key);
    return p >= 0 ? String(p + 1) : '';
  };
  return solution.turns.map((steps) => {
    let out = '', nps = '', enemy = '';
    for (const s of steps) {
      if (s.kind === 'skill') {
        const p = pos(s.unit);
        if (p < 0) throw new Error(`unit ${s.unit} not on the front line`);
        out += 'abcdefghi'[p * 3 + (s.num ?? 1) - 1] + target(s.target);
      } else if (s.kind === 'mc') {
        if (s.swap) {
          const [i, j] = s.swap;
          out += `x${i + 1}${j + 1}`;
          const o = front[i];
          front[i] = back[j]; back[j] = o;
        } else {
          out += 'jkl'[(s.num ?? 1) - 1] + target(s.target);
        }
      } else {
        const p = pos(s.unit);
        if (p < 0) throw new Error(`unit ${s.unit} not on the front line`);
        nps += '456'[p];
        if (!enemy && s.targetIndex !== undefined) enemy = `t${s.targetIndex + 1}`;
      }
    }
    return out + enemy + nps || '0';
  }).join(',#,');
}
