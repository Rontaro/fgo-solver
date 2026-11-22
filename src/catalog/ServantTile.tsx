// Grid pieces shared by the catalog page and the solver's servant picker.
import type { ReactNode } from 'react';
import { FaceIcon } from '../app/ServantIcon';
import type { Card, CompactServant } from '../data/types';
import { servantType, type SvtType } from './catalog';

export const CARD_LABEL: Record<Card, string> = { arts: 'Arts', buster: 'Buster', quick: 'Quick' };
const CARD_CLS: Record<Card, string> = { arts: 'bg-blue-600', buster: 'bg-red-600', quick: 'bg-green-600' };
export const TYPE_LABEL: Record<SvtType, string> = { aoe: 'AoE', st: 'ST', support: 'Support' };

export const starStr = (r: number) => (r > 0 ? '★'.repeat(r) : '0★');

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`rounded-full border px-2.5 py-1 text-xs ${on
        ? 'border-gold-500 bg-gold-600/30 text-gold-200' : 'border-night-700 bg-night-800 text-night-300 hover:border-night-500'}`}>
      {children}
    </button>
  );
}

export function TypeBadge({ s }: { s: CompactServant }) {
  const t = servantType(s);
  const cls = s.np ? CARD_CLS[s.np.card] : 'bg-night-600';
  return <span className={`rounded px-1 text-[10px] font-bold leading-4 text-white ${cls}`}>{t.toUpperCase()}</span>;
}

/** A corner marker on a tile's face. */
export function Corner({ pos, cls, label, children }: { pos: 'tl' | 'tr'; cls: string; label: string; children: ReactNode }) {
  return (
    <span title={label} aria-label={label}
      className={`absolute ${pos === 'tl' ? '-left-1' : '-right-1'} -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold text-white ring-2 ring-night-950 ${cls}`}>
      {children}
    </span>
  );
}

/**
 * A servant in a grid: face, rarity, type badge, name, an optional sub line
 * and corner markers. `disabled` greys it out and blocks clicks; `title` is the
 * hover text (the reason, when disabled).
 */
export function ServantTile({ s, onClick, title, disabled, dim, corners, sub }: {
  s: CompactServant; onClick: () => void; title?: string; disabled?: boolean; dim?: boolean;
  corners?: ReactNode; sub?: ReactNode;
}) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} title={title ?? s.name} aria-disabled={disabled || undefined}
      className={`flex w-20 flex-col items-center gap-0.5 rounded p-1 text-center focus:outline-none ${disabled
        ? 'cursor-not-allowed opacity-40' : 'hover:bg-night-800 focus:bg-night-800'}`}>
      <span className="relative">
        <FaceIcon face={s.face} name={s.name} size={64} className={dim ? 'opacity-60' : ''} />
        {corners}
      </span>
      <span className="text-[10px] leading-3 text-amber-400">{starStr(s.rarity)}</span>
      <TypeBadge s={s} />
      <span className="line-clamp-2 text-[11px] leading-tight text-night-300">{s.name}</span>
      {sub && <span className="text-[10px] leading-tight text-night-500">{sub}</span>}
    </button>
  );
}
