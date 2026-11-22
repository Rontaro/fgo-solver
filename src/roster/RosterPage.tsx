import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegionData } from '../app/RegionData';
import { FaceIcon } from '../app/ServantIcon';
import { ServantSearch } from '../app/ServantSearch';
import { queryWords, servantScore } from '../data/search';
import type { CompactServant } from '../data/types';
import { type ChaldeaAccount, type ChaldeaOptions, parseChaldeaBackup, readChaldeaFile } from './chaldea';
import { ImportDialog } from './ImportDialog';
import { useT } from '../i18n';
import { IdbRosterStore, RosterValidationError, exportJson, importJson } from './store';
import type { OwnedServant, RosterDoc } from './types';
import { newOwned } from './defaults';

const store = new IdbRosterStore();
const SAVE_DELAY_MS = 500;
const MAX_RESULTS = 20;

const newServant = newOwned;

/** Integer input that commits only valid values in [min, max] and reverts on blur. */
function NumberCell({ value, min, max, onChange, label }: {
  value: number; min: number; max: number; onChange: (v: number) => void; label: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number" min={min} max={max} value={text} aria-label={label}
      className="w-16 rounded bg-night-800 px-1.5 py-0.5 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-gold-500"
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
  const t = useT();
  if (!s || s.unsupported.length === 0) return null;
  return (
    <span
      title={t.roster.unsupportedTitle(s.unsupported.join(', '))}
      className="ml-2 cursor-help rounded bg-amber-900/60 px-1.5 py-0.5 text-xs text-amber-300"
    >
      {t.roster.unsupportedBadge}
    </span>
  );
}

export function RosterPage() {
  const { region, data } = useRegionData();
  const t = useT();
  const [doc, setDoc] = useState<RosterDoc | null>(null);
  const [filter, setFilter] = useState('');
  const [pendingImport, setPendingImport] = useState<RosterDoc | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [chaldeaPick, setChaldeaPick] = useState<{ raw: unknown; accounts: ChaldeaAccount[]; index: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<RosterDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const chaldeaInput = useRef<HTMLInputElement>(null);

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

  const addable = useMemo(() => (servants ? [...servants.values()].filter((s) => !owned.has(s.collectionNo)) : []),
    [servants, owned]);

  if (!doc) return <p className="text-night-400">{t.roster.loading}</p>;

  const words = queryWords(filter);
  const rows = doc.servants.filter((o) => {
    if (!words.length) return true;
    const s = servants?.get(o.collectionNo);
    return !!s && servantScore(s, words, s.className) !== null;
  });

  const setServant = (no: number, patch: Partial<OwnedServant>) =>
    update({ ...doc, servants: doc.servants.map((s) => (s.collectionNo === no ? { ...s, ...patch } : s)) });
  const setSkill = (o: OwnedServant, i: number, v: number) => {
    const skillLv = [...o.skillLv] as OwnedServant['skillLv'];
    skillLv[i] = v;
    setServant(o.collectionNo, { skillLv });
  };
  const remove = (no: number) => update({ ...doc, servants: doc.servants.filter((s) => s.collectionNo !== no) });
  const add = (no: number) => update({ ...doc, servants: [...doc.servants, newServant(no)] });

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
      setImportWarnings([]);
      setPendingImport(importJson(await file.text(), region));
    } catch (e) {
      if (e instanceof RosterValidationError) setImportError(t.roster.validationError(e.path, e.message.slice(e.path.length + 2)));
      else setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const chaldeaOpts = (): ChaldeaOptions => ({
    // rarity is read defensively: older cached data may not carry it
    servants: new Map([...(servants?.values() ?? [])].map((s) => [s.collectionNo, { rarity: (s as { rarity?: number }).rarity }])),
    ces: data ? new Set(data.ces.map((c) => c.collectionNo)) : undefined,
    msg: t.chaldea,
  });

  const chaldeaImport = (raw: unknown, accountIndex: number) => {
    const r = parseChaldeaBackup(raw, region, { ...chaldeaOpts(), accountIndex });
    setChaldeaPick(null);
    setImportWarnings(r.warnings);
    // servants and CEs are replaced; friends and mystic codes are kept
    setPendingImport({ ...doc, servants: r.servants, ces: r.ces });
  };

  const onChaldeaFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      const raw: unknown = JSON.parse(await readChaldeaFile(file));
      const { accounts } = parseChaldeaBackup(raw, region, chaldeaOpts());
      if (accounts.length === 0) throw new Error(t.roster.noAccounts);
      if (accounts.length === 1) chaldeaImport(raw, 0);
      else setChaldeaPick({ raw, accounts, index: Math.max(0, accounts.findIndex((a) => a.region === region.toLowerCase())) });
    } catch (e) {
      setImportError(e instanceof SyntaxError ? t.roster.invalidJson : e instanceof Error ? e.message : String(e));
    } finally {
      if (chaldeaInput.current) chaldeaInput.current.value = '';
    }
  };

  const btn = 'rounded bg-night-800 px-3 py-1.5 text-sm hover:bg-night-700';
  const input = 'w-full rounded bg-night-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gold-500';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ServantSearch items={addable} onPick={(s) => add(s.collectionNo)} limit={MAX_RESULTS}
          placeholder={t.roster.addPlaceholder} className="w-full sm:w-72" />
        <input
          value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.roster.filterPlaceholder}
          className={`${input} sm:w-48`}
        />
        <div className="flex gap-2 sm:ml-auto">
          <button onClick={doExport} className={btn}>{t.roster.exportJson}</button>
          <button onClick={() => fileInput.current?.click()} className={btn}>{t.roster.importJson}</button>
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])} />
          <button onClick={() => chaldeaInput.current?.click()} className={btn}>{t.roster.importChaldea}</button>
          <input ref={chaldeaInput} type="file" accept="application/json,.json,.gz" className="hidden"
            onChange={(e) => onChaldeaFile(e.target.files?.[0])} />
        </div>
      </div>

      {importError && (
        <div className="flex items-start justify-between rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          <span>{t.roster.importFailed(importError)}</span>
          <button onClick={() => setImportError(null)} className="ml-3 text-red-400 hover:text-red-200" aria-label={t.common.close}>×</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gold-500/25 bg-night-900">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-night-500">
            <tr className="border-b border-night-800">
              <th className="px-3 py-2">{t.roster.colServant}</th>
              <th className="px-3 py-2">{t.roster.colClass}</th>
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
                <tr key={no} className="border-b border-night-800/60 last:border-0">
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <FaceIcon face={s?.face} name={s?.name ?? `#${no}`} />
                      <span>
                        {s ? s.name : <span className="text-night-500">{t.roster.unknown(no)}</span>}
                        <UnsupportedBadge s={s} />
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 capitalize text-night-400">{s?.className ?? '—'}</td>
                  <td className="px-2 py-1.5"><NumberCell label={t.roster.level} value={o.lv} min={1} max={120} onChange={(v) => setServant(no, { lv: v })} /></td>
                  <td className="px-2 py-1.5"><NumberCell label={t.roster.npLevel} value={o.npLv} min={1} max={5} onChange={(v) => setServant(no, { npLv: v })} /></td>
                  {[0, 1, 2].map((i) => (
                    <td key={i} className="px-2 py-1.5"><NumberCell label={t.roster.skill(i + 1)} value={o.skillLv[i]} min={1} max={10} onChange={(v) => setSkill(o, i, v)} /></td>
                  ))}
                  <td className="px-2 py-1.5"><NumberCell label="Append 2" value={o.append2Lv} min={0} max={10} onChange={(v) => setServant(no, { append2Lv: v })} /></td>
                  <td className="px-2 py-1.5"><NumberCell label="Fou" value={o.fou} min={0} max={2000} onChange={(v) => setServant(no, { fou: v })} /></td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => remove(no)} className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-950">{t.roster.remove}</button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-night-500">
                {doc.servants.length === 0 ? t.roster.empty : t.roster.noMatch}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-night-500">
        {t.roster.count(doc.servants.length)} · {saving ? t.roster.saving : t.roster.saved}
      </p>

      {chaldeaPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border border-gold-500/25 bg-night-900 p-5 shadow-xl">
            <h2 className="mb-3 text-lg font-semibold">{t.roster.chooseAccount}</h2>
            <select
              aria-label={t.roster.account} value={chaldeaPick.index}
              onChange={(e) => setChaldeaPick({ ...chaldeaPick, index: Number(e.target.value) })}
              className={`${input} mb-5`}
            >
              {chaldeaPick.accounts.map((a) => (
                <option key={a.index} value={a.index}>{a.name}{a.region ? ` (${a.region.toUpperCase()})` : ''}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setChaldeaPick(null)} className={btn}>{t.common.cancel}</button>
              <button
                onClick={() => {
                  try { chaldeaImport(chaldeaPick.raw, chaldeaPick.index); } catch (e) {
                    setChaldeaPick(null);
                    setImportError(e instanceof Error ? e.message : String(e));
                  }
                }}
                className="rounded bg-gold-600 px-3 py-1.5 text-sm font-medium text-night-950 hover:bg-gold-500"
              >{t.common.continue}</button>
            </div>
          </div>
        </div>
      )}

      {pendingImport && (
        <ImportDialog
          current={doc} next={pendingImport} warnings={importWarnings}
          onCancel={() => { setPendingImport(null); setImportWarnings([]); }}
          onConfirm={() => { update(pendingImport); flush(); setPendingImport(null); setImportWarnings([]); }}
        />
      )}
    </section>
  );
}
