import type { EventBonus, EventItems } from '../data/types';
import type { TeamMember } from '../engine/state';

/** One line of a team's event bonus: an item (0 = none) and a kind, summed over the party. */
export interface BonusLine { item: number; kind: EventBonus['kind']; value: number }

/**
 * Event bonus of a whole party for an event: the bonuses of its CEs (MLB or
 * not) and of its servants' event passives, summed per item and kind. Every
 * member counts, back line and supports included, as in game.
 */
export function teamBonus(members: readonly TeamMember[], eventId: number): BonusLine[] {
  if (!eventId) return [];
  const sum = new Map<string, BonusLine>();
  const add = (b: EventBonus) => {
    if (b.eventId !== eventId) return;
    const k = `${b.item}:${b.kind}`;
    const cur = sum.get(k);
    if (cur) cur.value += b.value; else sum.set(k, { item: b.item, kind: b.kind, value: b.value });
  };
  for (const m of members) {
    for (const b of m.svt.eventBonus ?? []) add(b);
    for (const b of (m.ce ? (m.ceMlb ? m.ce.bonusMlb : m.ce.bonus) : undefined) ?? []) add(b);
  }
  const order: Record<BonusLine['kind'], number> = { drop: 0, dropRate: 1, point: 2, pointRate: 3 };
  return [...sum.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.item - b.item);
}

/** Total extra items per drop (the 'drop' lines), the main sort key. */
export const dropTotal = (lines: readonly BonusLine[]) => lines.reduce((a, l) => a + (l.kind === 'drop' ? l.value : 0), 0);

/** The bonus as small item chips ("+2", "+20%"). */
export function BonusChips({ lines, items }: { lines: readonly BonusLine[]; items: EventItems }) {
  if (!lines.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {lines.map((l) => {
        const it = items[String(l.item)];
        const v = l.kind === 'drop' || l.kind === 'point' ? `+${l.value}` : `+${l.value / 10}%`;
        const label = `${it?.name ?? (l.kind.startsWith('point') ? 'Points' : 'Item')} ${v}`;
        return (
          <span key={`${l.item}:${l.kind}`} title={label}
            className="inline-flex items-center gap-1 rounded-full border border-gold-500/40 bg-night-950/70 py-0.5 pl-0.5 pr-2 text-xs text-gold-200">
            {it ? <img src={it.icon} alt={it.name} width={18} height={18} className="rounded-full" loading="lazy" />
              : <span className="px-1">{l.kind.startsWith('point') ? 'Pt' : '?'}</span>}
            {v}
          </span>
        );
      })}
    </span>
  );
}
