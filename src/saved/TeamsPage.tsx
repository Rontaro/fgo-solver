import { useEffect, useRef, useState } from 'react';
import { useRegionData } from '../app/RegionData';
import { FaceIcon } from '../app/ServantIcon';
import type { SolverLoad } from '../solverui/SolverPage';
import { useT } from '../i18n';
import { loadTeams, newId, saveTeams, type SavedTeam } from './store';
import { download, parseTeams } from './io';

/** Saved teams: load one into the solver, rename, delete, export / import as JSON. */
export function TeamsPage({ onLoad }: { onLoad: (l: Omit<SolverLoad, 'n'>) => void }) {
  const { region, data } = useRegionData();
  const t = useT().saved;
  const [teams, setTeams] = useState<SavedTeam[] | null>(null);
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { let alive = true; loadTeams(region).then((x) => { if (alive) setTeams(x); }); return () => { alive = false; }; }, [region]);
  const put = (next: SavedTeam[]) => { setTeams(next); void saveTeams(region, next); };
  if (!data || !teams) return null;

  const rename = (x: SavedTeam) => {
    const name = window.prompt(t.rename, x.name);
    if (name !== null && name.trim()) put(teams.map((y) => (y.id === x.id ? { ...y, name: name.trim() } : y)));
  };
  const remove = (x: SavedTeam) => { if (window.confirm(t.deleteConfirm(x.name))) put(teams.filter((y) => y.id !== x.id)); };
  const importFile = async (f: File) => {
    try {
      const got = parseTeams(await f.text()).map((x) => ({ ...x, id: newId() }));
      put([...got, ...teams]);
      setNote(t.imported(got.length));
    } catch (e) { setNote(t.importError(e instanceof Error ? e.message : String(e))); }
  };

  return (
    <div className="space-y-4">
      <section className="panel space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="panel-title">{t.teamsHeading}</h2>
          <span className="text-xs text-night-400">{t.count(teams.length)}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={!teams.length}
              onClick={() => download(`fgo-solver-teams-${region}.json`, teams)}>{t.export}</button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => file.current?.click()}>{t.import}</button>
            <input ref={file} type="file" accept="application/json,.json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
          </div>
        </div>
        {note && <p role="status" className="text-sm text-gold-300">{note}</p>}
        {teams.length === 0 && <p className="text-sm text-night-300">{t.noTeams}</p>}
        <ul className="grid gap-3 lg:grid-cols-2">
          {teams.map((x) => {
            const mc = data.mcs.find((m) => m.id === x.mcId);
            return (
              <li key={x.id} className="space-y-3 rounded-lg border border-gold-500/25 bg-night-950/60 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="font-semibold text-night-50">{x.name}</h3>
                  <span className="text-xs text-night-400">{new Date(x.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {x.slots.map((s, i) => {
                    const svt = s.collectionNo !== null ? data.servants.get(s.collectionNo) : undefined;
                    const ce = s.ceNo !== null ? data.ces.find((c) => c.collectionNo === s.ceNo) : undefined;
                    return (
                      <span key={i} className={`flex flex-col items-center gap-0.5 ${i === 3 ? 'ml-3' : ''}`} title={i < 3 ? t.front : t.back}>
                        {svt ? <FaceIcon face={svt.face} name={svt.name} size={44} />
                          : <span className="flex h-11 w-11 items-center justify-center rounded-md border border-dashed border-night-600 text-xs text-night-400">
                            {s.kind === 'free' || s.kind === 'supportAuto' ? '?' : '–'}</span>}
                        {ce && <FaceIcon face={ce.face} name={`${ce.name} lv ${s.ceLv}${s.ceMlb ? ' MLB' : ''}`} size={24} />}
                      </span>
                    );
                  })}
                </div>
                {mc && <p className="text-xs text-night-300">{mc.name}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => onLoad({ slots: x.slots, mcId: x.mcId })}>{t.loadTeam}</button>
                  <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => rename(x)}>{t.renameBtn}</button>
                  <button type="button" className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:border-red-400" onClick={() => remove(x)}>{t.delete}</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
