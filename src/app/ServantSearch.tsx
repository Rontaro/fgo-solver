import { useId, useMemo, useState, type ReactNode } from 'react';
import { searchServants } from '../data/search';
import type { CompactServant } from '../data/types';
import { FaceIcon } from './ServantIcon';

type Svt = Pick<CompactServant, 'name' | 'collectionNo' | 'face' | 'className'>;

/**
 * Search box over servants (names, nicknames, Altria/Artoria, no accents) with a
 * keyboard-navigable result list: arrows move, Enter picks, Escape clears.
 */
export function ServantSearch<T extends Svt>({ items, onPick, placeholder, sub, extra, limit = 20, className = '', autoFocus }: {
  items: readonly T[]; onPick: (s: T) => void; placeholder: string;
  sub?: (s: T) => ReactNode; extra?: (s: T) => string; limit?: number; className?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const id = useId();
  const found = useMemo(() => searchServants(items, q, limit, extra), [items, q, limit, extra]);
  const results = open ? found : [];
  const pick = (s: T) => { onPick(s); setQ(''); setActive(0); };

  return (
    <div className={`relative ${className}`}>
      <input
        value={q} placeholder={placeholder} autoFocus={autoFocus}
        role="combobox" aria-expanded={results.length > 0} aria-controls={id} aria-autocomplete="list"
        aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
        className="w-full rounded border border-night-700 bg-night-800 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gold-500"
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
          else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]); }
          else if (e.key === 'Escape') { setQ(''); setOpen(false); }
        }}
      />
      {results.length > 0 && (
        <ul id={id} role="listbox" className="absolute z-20 mt-1 max-h-80 w-full min-w-64 overflow-auto rounded border border-night-700 bg-night-900 shadow-lg">
          {results.map((s, i) => (
            <li key={s.collectionNo} id={`${id}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)} onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1 text-sm ${i === active ? 'bg-night-800' : ''}`}>
              <FaceIcon face={s.face} name={s.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{s.name}</span>
                <span className="block truncate text-xs text-night-500">{sub ? sub(s) : <span className="capitalize">{s.className}</span>}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
