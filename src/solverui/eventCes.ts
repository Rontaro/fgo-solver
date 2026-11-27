import type { CompactCE, Effect } from '../data/types';
import { fieldTraitsOf, type RawQuest } from '../engine/quest';
import type { OwnedCE } from '../roster/types';
import type { CeFill } from '../solver/autocomplete';

/** An effect conditioned on this quest (its event, or a field trait it has). */
const tiedTo = (e: Effect, eventId: number, fieldTraits: readonly number[]) =>
  (!!e.eventId && e.eventId === eventId) || (!!e.fieldTraits && e.fieldTraits.some((t) => fieldTraits.includes(t)));

/**
 * The CEs with an effect that only works in this quest (event bonus CEs,
 * e.g. Pioneering Oni in the Ghost Room nodes), simulable ones only, newest
 * first. eventId: the quest war's event (0 = none).
 */
export function eventCesFor(ces: readonly CompactCE[], raw: RawQuest, eventId: number): CompactCE[] {
  const ft = fieldTraitsOf(raw);
  if (!eventId && !ft.length) return [];
  return ces
    .filter((c) => !c.unsupported.length && [...c.effects, ...c.effectsMlb].some((e) => tiedTo(e, eventId, ft)))
    .sort((a, b) => b.collectionNo - a.collectionNo);
}

/** A CE's drop bonus for an event (extra items per drop, all items summed), MLB or not. */
export function ceDropBonus(ce: CompactCE, mlb: boolean, eventId: number): number {
  return ((mlb ? ce.bonusMlb : ce.bonus) ?? []).reduce((a, b) => a + (b.eventId === eventId && b.kind === 'drop' ? b.value : 0), 0);
}

/**
 * Event CEs for the auto-picked members (autocomplete ceFill): the user's
 * owned copies of the node's event CEs, best drop bonus first, minus the
 * copies the team's own slots already wear (usedByRoster: their CE numbers);
 * the support gets the best one MLB. eventCes: eventCesFor, newest first
 * (the tie order).
 */
export function eventCeFill(eventCes: readonly CompactCE[], owned: readonly OwnedCE[], usedByRoster: readonly number[], eventId: number): CeFill {
  const used = [...usedByRoster];
  const order = (c: CompactCE) => eventCes.indexOf(c);
  const roster = owned.flatMap((o) => {
    const ce = eventCes.find((c) => c.collectionNo === o.collectionNo);
    if (!ce) return [];
    const u = used.indexOf(o.collectionNo);
    if (u >= 0) { used.splice(u, 1); return []; }
    return [{ ce, lv: o.lv, mlb: o.mlb }];
  }).sort((a, b) => ceDropBonus(b.ce, b.mlb, eventId) - ceDropBonus(a.ce, a.mlb, eventId) || order(a.ce) - order(b.ce));
  const best = [...eventCes].sort((a, b) => ceDropBonus(b, true, eventId) - ceDropBonus(a, true, eventId) || order(a) - order(b))[0];
  return { roster, support: best ? { ce: best, lv: best.atkGrowth.length, mlb: true } : null };
}
