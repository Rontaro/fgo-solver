import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegionData } from '../app/RegionData';
import { FaceIcon } from '../app/ServantIcon';
import type { TeamMember } from '../engine/state';
import { describeTurns } from '../solverui/members';
import type { SolverLoad } from '../solverui/SolverPage';
import { emptySlot, type SlotState } from '../solverui/TeamBuilder';
import { MarginBars, TurnSteps } from '../solverui/TurnSteps';
import { BonusChips, teamBonus } from '../solverui/eventBonus';
import { useT } from '../i18n';
import { download, parseResults } from './io';
import { loadResults, newId, saveResults, type SavedResult } from './store';
import { dataVersionOf, membersOf, verifyResult, type Verdict } from './verify';

/** Slots for the solver from a saved result's team (front line first). */
function slotsOf(r: SavedResult): SlotState[] {
  const slots = Array.from({ length: 6 }, emptySlot);
  [...r.front, ...r.back].forEach((k, i) => {
    const m = r.members.find((x) => x.key === k);
    if (!m || i >= 6) return;
    slots[i] = { kind: m.support ? 'support' : 'roster', collectionNo: m.collectionNo, ceNo: m.ceNo, ceLv: m.ceLv, ceMlb: m.ceMlb, ...(m.form && { form: m.form }) };
  });
  return slots;
}

function ResultCard({ r, onLoad, onRename, onDelete }: {
  r: SavedResult; onLoad: () => void; onRename: () => void; onDelete: () => void;
}) {
  const { region, data } = useRegionData();
  const t = useT().saved;
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | 'running' | null>(null);
  const team = useMemo(() => (data ? membersOf(r, data) : null), [r, data]);
  if (!data) return null;
  const mc = data.mcs.find((m) => m.id === r.mcId);
  const unit = (k: string | undefined): TeamMember | undefined => (k ? team?.find((m) => m.key === k) : undefined);
  const outdated = r.dataVersion !== dataVersionOf(data);
  const check = async () => { setVerdict('running'); setVerdict(await verifyResult(r, data, region)); };

  return (
    <li className={`space-y-3 rounded-lg border bg-night-950/60 p-4 ${r.kind === 'solution' ? 'border-gold-500/30' : 'border-amber-500/40'}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded px-1.5 text-xs font-bold ${r.kind === 'solution' ? 'bg-gold-500 text-night-950' : 'bg-amber-800/70 text-amber-100'}`}>
          {r.kind === 'solution' ? '3T' : t.closestBadge((r.missingPct! * 100).toFixed(1))}
        </span>
        <h3 className="font-semibold text-night-50">{r.name}</h3>
        <span className="text-xs text-night-400">{r.quest.label} · {new Date(r.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {[...r.front, ...r.back].map((k, i) => {
          const m = unit(k);
          return (
            <span key={k} className={`flex flex-col items-center gap-0.5 ${i === r.front.length ? 'ml-3' : ''}`}>
              <FaceIcon face={m?.svt.face} name={m ? `${m.svt.name} · lv ${m.lv} · NP${m.npLv} · ${m.skillLv.join('/')}` : '?'} size={44} />
              {m?.ce && <FaceIcon face={m.ce.face} name={`${m.ce.name} lv ${m.ceLv}${m.ceMlb ? ' MLB' : ''}`} size={24} />}
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-night-300">
        {mc && <span>{mc.name}</span>}
        <span>{t.actions(r.actions)}{r.usesSwap ? t.orderChange : ''}</span>
        {r.margins && <MarginBars margins={r.margins} />}
        {team && <BonusChips lines={teamBonus(team, r.quest.eventId)} items={data.items} />}
      </div>
      {outdated && (
        <p className="text-xs text-amber-200">
          {t.outdated}{' '}
          {verdict === null && <button type="button" className="underline hover:text-amber-100" onClick={() => void check()}>{t.verify}</button>}
        </p>
      )}
      {verdict === 'running' && <p className="text-xs text-night-300">{t.verifying}</p>}
      {verdict && verdict !== 'running' && (
        <p className={`text-xs ${verdict.ok ? 'text-quick' : 'text-red-300'}`}>
          {verdict.ok
            ? (verdict.missingPct !== undefined ? t.stillClosest((verdict.missingPct * 100).toFixed(1)) : t.stillValid)
            : t.broken(verdict.reason)}
        </p>
      )}
      {open && team && <TurnSteps turns={describeTurns(r.turns, r.front, r.back, mc)} unit={unit} />}
      {open && !team && <p className="text-xs text-red-300">{t.missingData}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(!open)}>{open ? t.hideSteps : t.showSteps}</button>
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={onLoad}>{t.loadResult}</button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onRename}>{t.renameBtn}</button>
        <button type="button" className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:border-red-400" onClick={onDelete}>{t.delete}</button>
      </div>
    </li>
  );
}

/** Saved results (3T solutions and closest lines): steps, verification, load into the solver, export / import. */
export function ResultsPage({ onLoad }: { onLoad: (l: Omit<SolverLoad, 'n'>) => void }) {
  const { region, data } = useRegionData();
  const t = useT().saved;
  const [results, setResults] = useState<SavedResult[] | null>(null);
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { let alive = true; loadResults(region).then((x) => { if (alive) setResults(x); }); return () => { alive = false; }; }, [region]);
  const put = (next: SavedResult[]) => { setResults(next); void saveResults(region, next); };
  if (!data || !results) return null;

  const importFile = async (f: File) => {
    try {
      const got = parseResults(await f.text()).map((x) => ({ ...x, id: newId() }));
      put([...got, ...results]);
      setNote(t.imported(got.length));
    } catch (e) { setNote(t.importError(e instanceof Error ? e.message : String(e))); }
  };

  return (
    <div className="space-y-4">
      <section className="panel space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="panel-title">{t.resultsHeading}</h2>
          <span className="text-xs text-night-400">{t.count(results.length)}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={!results.length}
              onClick={() => download(`fgo-solver-results-${region}.json`, results)}>{t.export}</button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => file.current?.click()}>{t.import}</button>
            <input ref={file} type="file" accept="application/json,.json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
          </div>
        </div>
        {note && <p role="status" className="text-sm text-gold-300">{note}</p>}
        {results.length === 0 && <p className="text-sm text-night-300">{t.noResults}</p>}
        <ul className="space-y-3">
          {results.map((r) => (
            <ResultCard key={r.id} r={r}
              onLoad={() => onLoad({ slots: slotsOf(r), mcId: r.mcId, quest: { id: r.quest.id, phase: r.quest.phase } })}
              onRename={() => { const n = window.prompt(t.rename, r.name); if (n !== null && n.trim()) put(results.map((y) => (y.id === r.id ? { ...y, name: n.trim() } : y))); }}
              onDelete={() => { if (window.confirm(t.deleteConfirm(r.name))) put(results.filter((y) => y.id !== r.id)); }} />
          ))}
        </ul>
      </section>
    </div>
  );
}
