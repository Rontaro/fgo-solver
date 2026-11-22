import { useMemo, useState } from 'react';
import { FaceIcon } from '../app/ServantIcon';
import type { CompactCE } from '../data/types';
import { useT } from '../i18n';
import { Modal } from './Modal';
import { commonCes, filterCes } from './picker';

const MAX_SHOWN = 150;

export interface CeValue { ceNo: number | null; ceLv: number; ceMlb: boolean }

/** CE grid with search and a "commonly used" row; level and MLB are set here too. */
export function CePicker({ title, ces, value, onChange, onClose }: {
  title: string; ces: readonly CompactCE[]; value: CeValue;
  onChange: (patch: Partial<CeValue>) => void; onClose: () => void;
}) {
  const tt = useT();
  const t = tt.picker;
  const [query, setQuery] = useState('');
  const common = useMemo(() => commonCes(ces), [ces]);
  // Simulable CEs first; filterCes already sorts newest first and sort is stable.
  const found = useMemo(() => filterCes(ces, query).sort((a, b) => Number(a.unsupported.length > 0) - Number(b.unsupported.length > 0)), [ces, query]);
  const shown = found.slice(0, MAX_SHOWN);

  const pick = (no: number | null) => { onChange({ ceNo: no }); onClose(); };
  const tile = (c: CompactCE) => {
    const bad = c.unsupported.length > 0;
    const on = c.collectionNo === value.ceNo;
    return (
      <button key={c.collectionNo} type="button" onClick={bad ? undefined : () => pick(c.collectionNo)}
        aria-disabled={bad || undefined} aria-pressed={on}
        title={bad ? `${c.name}: ${t.ceUnusable(c.unsupported.join(', '))}` : c.name}
        className={`flex w-20 shrink-0 flex-col items-center gap-0.5 rounded p-1 text-center focus:outline-none ${on ? 'bg-sky-900/60 ring-1 ring-sky-500' : ''} ${bad
          ? 'cursor-not-allowed opacity-40' : 'hover:bg-zinc-800 focus:bg-zinc-800'}`}>
        <FaceIcon face={c.face} name={c.name} size={56} />
        <span className="line-clamp-2 text-[11px] leading-tight text-zinc-300">{c.name}</span>
      </button>
    );
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-zinc-400">{t.ceLevel}</span>
        <div className="flex rounded bg-zinc-800 p-0.5" role="group" aria-label={t.ceLevel}>
          {[100, 1].map((lv) => (
            <button key={lv} type="button" aria-pressed={value.ceLv === lv} onClick={() => onChange({ ceLv: lv })}
              className={`rounded px-2.5 py-1 ${value.ceLv === lv ? 'bg-sky-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>lv {lv}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={value.ceMlb} onChange={(e) => onChange({ ceMlb: e.target.checked })} /> MLB
        </label>
        <button type="button" onClick={() => pick(null)}
          className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-zinc-200 hover:border-zinc-500">{tt.team.noCe}</button>
      </div>
      <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder={t.ceSearch} aria-label={t.ceSearchLabel}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none" />
      {!query && common.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{t.common}</p>
          <div className="flex gap-1 overflow-x-auto pb-1">{common.map(tile)}</div>
        </div>
      )}
      {shown.length === 0
        ? <p className="text-sm text-zinc-400">{t.ceNoMatch}</p>
        : <div className="flex flex-wrap gap-1">{shown.map(tile)}</div>}
      {found.length > shown.length && <p className="text-xs text-zinc-500">{t.ceMore(found.length - shown.length)}</p>}
    </Modal>
  );
}
