// Class constants: attack rate per class and the class relation (triangle)
// table, completed from Atlas NiceClass.json.
//
// The relation exports only list some attacker/defender pairs (e.g. NA has no
// grand classes as defenders). Like Chaldea, a class takes its relation from
// its relationId: the class whose id equals that relationId (grandSaber has
// relationId 1 = saber). Missing pairs are filled from the representative
// classes; pairs that still cannot be resolved are reported, never invented.

/** One entry of /export/{region}/NiceClass.json (fields we use). */
export interface ClassInfo { id: number; className: string; attackRate: number; relationId: number; }

type Rel = Record<string, Record<string, number>>;

// Numeric "class names" ("42", "98", ...) are unnamed internal classes: a
// CompactServant.className is always a name, so they are left out.
const named = (name: string) => !/^\d+$/.test(name);

export function buildClassConstants(
  classes: readonly ClassInfo[],
  attackRates: Record<string, number>,
  relation: Rel,
): { classAtk: Record<string, number>; classRel: Rel; filled: number } {
  const list = classes.filter((c) => named(c.className));
  // attackRate from NiceClass; the attack-rate export only for names it lacks.
  const classAtk: Record<string, number> = {};
  for (const [k, v] of Object.entries(attackRates)) if (named(k)) classAtk[k] = v;
  for (const c of list) classAtk[c.className] = c.attackRate;

  const nameById = new Map(list.map((c) => [c.id, c.className]));
  const relIdByName = new Map(list.map((c) => [c.className, c.relationId]));
  const rep = (name: string) => nameById.get(relIdByName.get(name) ?? -1) ?? name;

  const classRel: Rel = {};
  for (const [a, row] of Object.entries(relation)) {
    if (!named(a)) continue;
    classRel[a] = {};
    for (const [d, v] of Object.entries(row)) if (named(d)) classRel[a][d] = v;
  }
  const names = [...new Set([...list.map((c) => c.className), ...Object.keys(classRel)])];
  let filled = 0;
  for (const a of names) {
    for (const d of names) {
      if (classRel[a]?.[d] !== undefined) continue;
      const v = relation[rep(a)]?.[rep(d)];
      if (v === undefined) continue;
      (classRel[a] ??= {})[d] = v;
      filled++;
    }
  }
  return { classAtk, classRel, filled };
}

/** Attacker classes x defender classes pairs that do not resolve (gaps). */
export function classGaps(
  c: { classAtk: Record<string, number>; classRel: Rel },
  attackers: Iterable<string>,
  defenders: readonly string[],
): string[] {
  const gaps: string[] = [];
  for (const a of new Set(attackers)) {
    if (c.classAtk[a] === undefined) gaps.push(`classAtk[${a}]`);
    for (const d of defenders) if (c.classRel[a]?.[d] === undefined) gaps.push(`classRel[${a}][${d}]`);
  }
  return gaps;
}
