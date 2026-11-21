import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegionData } from '../app/RegionData';
import type { CompactServant } from '../data/types';
import { ImportDialog } from './ImportDialog';
import { IdbRosterStore, RosterValidationError, exportJson, importJson } from './store';
import type { OwnedServant, RosterDoc } from './types';

const store = new IdbRosterStore();
const SAVE_DELAY_MS = 500;
const MAX_RESULTS = 20;

function newServant(collectionNo: number): OwnedServant {
  return { collectionNo, lv: 90, npLv: 1, skillLv: [10, 10, 10], append2Lv: 0, fou: 0 };
}

/** Integer input that commits only valid values in [min, max] and reverts on blur. */
function NumberCell({ value, min, max, onChange, label }: {
  value: number; min: number; max: number; onChange: (v: number) => void; label: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number" min={min} max={max} value={text} aria-label={label}
      className="w-16 rounded bg-zinc-800 px-1.5 py-0.5 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-500"
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

function UnsupportedBadge({ s }: { s: CompactServant | undefined }) {
  if (!s || s.unsupported.length === 0) return null;
  return (
    <span
      title={`Effetti non gestiti: ${s.unsupported.join(', ')}`}
      className="ml-2 cursor-help rounded bg-amber-900/60 px-1.5 py-0.5 text-xs text-amber-300"
    >
      non simulabile
    </span>
  );
}

export function RosterPage() {
  const { region, data } = useRegionData();
  const [doc, setDoc] = useState<RosterDoc | null>(null);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [pendingImport, setPendingImport] = useState<RosterDoc | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<RosterDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const flush = () => {
    clearTimeout(timer.current);
    const d = pending.current;
    pending.current = null;
    if (!d) return;
    store.save(d).finally(() => setSaving(false));
  };

  useEffect(() => {
    let alive = true;
    setDoc(null);
    store.load(region).then((d) => { if (alive) setDoc(d); });
    window.addEventListener('pagehide', flush);
    return () => {
      alive = false;
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [region]);

  const update = (next: RosterDoc) => {
    setDoc(next);
    setSaving(true);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const servants = data?.servants;
  const owned = useMemo(() => new Set(doc?.servants.map((s) => s.collectionNo)), [doc]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !servants) return [];
    const out: CompactServant[] = [];
    for (const s of servants.values()) {
      if (owned.has(s.collectionNo) || !s.name.toLowerCase().includes(q)) continue;
      out.push(s);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [search, servants, owned]);

  if (!doc) return <p className="text-zinc-400">Caricamento roster…</p>;

  const q = filter.trim().toLowerCase();
  const rows = doc.servants.filter((o) => {
    if (!q) return true;
    const s = servants?.get(o.collectionNo);
    return !!s && (s.name.toLowerCase().includes(q) || s.className.toLowerCase().includes(q));
  });

  const setServant = (no: number, patch: Partial<OwnedServant>) =>
    update({ ...doc, servants: doc.servants.map((s) => (s.collectionNo === no ? { ...s, ...patch } : s)) });
  const setSkill = (o: OwnedServant, i: number, v: number) => {
    const skillLv = [...o.skillLv] as OwnedServant['skillLv'];
    skillLv[i] = v;
    setServant(o.collectionNo, { skillLv });
  };
  const remove = (no: number) => update({ ...doc, servants: doc.servants.filter((s) => s.collectionNo !== no) });
  const add = (no: number) => {
    update({ ...doc, servants: [...doc.servants, newServant(no)] });
    setSearch('');
  };

  const doExport = () => {
    const blob = new Blob([exportJson(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fgo-roster-${region}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      setPendingImport(importJson(await file.text(), region));
    } catch (e) {
      if (e instanceof RosterValidationError) setImportError(`Errore in ${e.path}: ${e.message.slice(e.path.length + 2)}`);
      else setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const btn = 'rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700';
  const input = 'w-full rounded bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Aggiungi servant (cerca per nome)…" className={input}
          />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded border border-zinc-800 bg-zinc-900 shadow-lg">
              {results.map((s) => (
                <li key={s.collectionNo}>
                  <button onClick={() => add(s.collectionNo)} className="flex w-full justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-800">
                    <span>{s.name}</span>
                    <span className="text-xs capitalize text-zinc-500">{s.className}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input
          value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtra roster…"
          className={`${input} sm:w-48`}
        />
        <div className="flex gap-2 sm:ml-auto">
          <button onClick={doExport} className={btn}>Esporta JSON</button>
          <button onClick={() => fileInput.current?.click()} className={btn}>Importa JSON</button>
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </div>

      {importError && (
        <div className="flex items-start justify-between rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          <span>Importazione non riuscita. {importError}</span>
          <button onClick={() => setImportError(null)} className="ml-3 text-red-400 hover:text-red-200" aria-label="Chiudi">×</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-3 py-2">Servant</th>
              <th className="px-3 py-2">Classe</th>
              <th className="px-2 py-2">Lv</th>
              <th className="px-2 py-2">NP</th>
              <th className="px-2 py-2">S1</th>
              <th className="px-2 py-2">S2</th>
              <th className="px-2 py-2">S3</th>
              <th className="px-2 py-2">Append 2</th>
              <th className="px-2 py-2">Fou</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const s = servants?.get(o.collectionNo);
              const no = o.collectionNo;
              return (
                <tr key={no} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-3 py-1.5">
                    {s ? s.name : <span className="text-zinc-500">Sconosciuto #{no}</span>}
                    <UnsupportedBadge s={s} />
                  </td>
                  <td className="px-3 py-1.5 capitalize text-zinc-400">{s?.className ?? '—'}</td>
                  <td className="px-2 py-1.5"><NumberCell label="Livello" value={o.lv} min={1} max={120} onChange={(v) => setServant(no, { lv: v })} /></td>
                  <td className="px-2 py-1.5"><NumberCell label="Livello NP" value={o.npLv} min={1} max={5} onChange={(v) => setServant(no, { npLv: v })} /></td>
                  {[0, 1, 2].map((i) => (
                    <td key={i} className="px-2 py-1.5"><NumberCell label={`Skill ${i + 1}`} value={o.skillLv[i]} min={1} max={10} onChange={(v) => setSkill(o, i, v)} /></td>
                  ))}
                  <td className="px-2 py-1.5"><NumberCell label="Append 2" value={o.append2Lv} min={0} max={10} onChange={(v) => setServant(no, { append2Lv: v })} /></td>
                  <td className="px-2 py-1.5"><NumberCell label="Fou" value={o.fou} min={0} max={2000} onChange={(v) => setServant(no, { fou: v })} /></td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => remove(no)} className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-950">Rimuovi</button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-zinc-500">
                {doc.servants.length === 0 ? 'Nessun servant nel roster. Aggiungine uno con la ricerca.' : 'Nessun servant corrisponde al filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        {doc.servants.length} servant · {saving ? 'Salvataggio…' : 'Salvato'}
      </p>

      {pendingImport && (
        <ImportDialog
          current={doc} next={pendingImport}
          onCancel={() => setPendingImport(null)}
          onConfirm={() => { update(pendingImport); flush(); setPendingImport(null); }}
        />
      )}
    </section>
  );
}
