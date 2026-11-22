import type { CompactCE, Effect } from '../data/types';
import { fieldTraitsOf, type RawQuest } from '../engine/quest';

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
