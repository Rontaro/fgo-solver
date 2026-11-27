/**
 * Servants whose kit depends on the ascension (Atlas limitCount) and that can
 * switch it in battle with transformServant on themselves (Melusine,
 * Ptolemaios). Two forms: 'low' (ascension 0-2) and 'high' (3-4). The skill /
 * NP variants hidden in each form are the game's "limit hide" rules (as
 * listed by Chaldea's constData svtLimitHides); the rest is picked by
 * priority as usual. CompactServant's top-level kit is the 'high' one;
 * CompactServant.forms carries both, and a team member starts in the form its
 * slot chooses (DEFAULT_FORM when none).
 */
import type { CompactServant } from './types';

export type FormName = 'low' | 'high';
export interface FormHides { tds: number[]; skills: number[] }

/** svt id -> the ids hidden in each form. */
export const FORM_HIDES: Record<number, Record<FormName, FormHides>> = {
  304800: { low: { tds: [304802], skills: [888575] }, high: { tds: [304801], skills: [888550] } }, // Melusine
  205000: { low: { tds: [205002], skills: [2281675] }, high: { tds: [205001], skills: [2281650] } }, // Ptolemaios
};

/**
 * Starting form when nothing is chosen: 'low' (the usual play: Melusine starts
 * in her first form and transforms with S3). In game it follows the chosen
 * appearance (ascension or costume), so the team slot lets the user pick.
 */
export const DEFAULT_FORM: FormName = 'low';

/** Ascension (limitCount) -> form; transformServant's SetLimitCount uses the same scale. */
export const formOfLimit = (limit: number): FormName => (limit >= 3 ? 'high' : 'low');

const views = new WeakMap<CompactServant, Partial<Record<FormName, CompactServant>>>();

/** The form of a servant with forms (the top level is 'high' unless it says otherwise). */
export const formOf = (svt: CompactServant): FormName => svt.form ?? 'high';

/**
 * The servant in the given form (same object for the same base and form, so
 * the engine's per-servant caches keep working). A servant without forms is
 * returned as is. A form with its own ATK / traits / attribute (a transformation into
 * another servant id, Aoko) carries them too.
 */
export function inForm(svt: CompactServant, form: FormName): CompactServant {
  const base = svt.formBase ?? svt;
  if (!base.forms) return svt;
  if (form === formOf(base)) return base;
  let v = views.get(base);
  if (!v) { v = {}; views.set(base, v); }
  const k = base.forms[form];
  return (v[form] ??= {
    ...base, skills: k.skills, np: k.np, form, formBase: base,
    ...(k.atkGrowth && { atkGrowth: k.atkGrowth }), ...(k.traits && { traits: k.traits }), ...(k.attribute && { attribute: k.attribute }),
  });
}
