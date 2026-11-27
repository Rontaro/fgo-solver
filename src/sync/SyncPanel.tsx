import { useEffect, useState } from 'react';
import { useRegionData } from '../app/RegionData';
import { IdbRosterStore, importJson } from '../roster/store';
import { loadResults, loadTeams, saveResults, saveTeams } from '../saved/store';
import { parseResults, parseTeams } from '../saved/io';
import { useT } from '../i18n';
import { clearSession, fetchAll, getSession, login, putDoc, SyncAuthError, type ServerDocs, type SyncSession } from './api';

const inp = 'rounded border border-gold-500/30 bg-night-950 px-2 py-1 text-sm text-night-50 focus:border-gold-400 focus:outline-none';
const store = new IdbRosterStore();

/** Settings section: log in, then upload or download roster, teams and results of the current region. */
export function SyncPanel() {
  const t = useT().sync;
  const { region } = useRegionData();
  const [session, setSession] = useState<SyncSession | null>(getSession);
  const [user, setUser] = useState(''), [pass, setPass] = useState('');
  const [server, setServer] = useState<ServerDocs | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const run = async (f: () => Promise<void>) => {
    setBusy(true); setNote('');
    try { await f(); } catch (e) {
      if (e instanceof SyncAuthError) { setSession(null); setNote(t.expired); } else setNote(t.error(e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  };
  const refresh = (s: SyncSession) => run(async () => { setServer(await fetchAll(s, region)); });
  useEffect(() => { if (session) void refresh(session); }, [session, region]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) {
    return (
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        void run(async () => { const s = await login(user, pass); setPass(''); setSession(s); });
      }}>
        <label className="flex flex-col gap-1 text-xs text-night-300">{t.username}
          <input className={inp} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-night-300">{t.password}
          <input className={inp} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
        </label>
        <button type="submit" disabled={busy || !user || !pass} className="btn-primary px-3 py-1.5 text-sm">{t.login}</button>
        {note && <p role="status" className="w-full text-sm text-amber-200">{note}</p>}
      </form>
    );
  }

  const upload = () => run(async () => {
    const [roster, teams, results] = await Promise.all([store.load(region), loadTeams(region), loadResults(region)]);
    await putDoc(session, region, 'roster', roster);
    await putDoc(session, region, 'teams', teams);
    await putDoc(session, region, 'results', results);
    setServer(await fetchAll(session, region));
    setNote(t.uploaded(region));
  });
  const download = () => run(async () => {
    const docs = await fetchAll(session, region);
    if (!docs.roster && !docs.teams && !docs.results) { setNote(t.nothing(region)); return; }
    if (!window.confirm(t.confirmDownload(region))) return;
    // Validated as on a file import: a malformed roster stops here with an error (nothing more is written).
    if (docs.roster) await store.save(importJson(JSON.stringify(docs.roster.data), region));
    if (docs.teams) await saveTeams(region, parseTeams(JSON.stringify(docs.teams.data)));
    if (docs.results) await saveResults(region, parseResults(JSON.stringify(docs.results.data)));
    setServer(docs);
    setNote(t.downloaded(region));
  });
  const when = (k: keyof ServerDocs) => (server?.[k] ? new Date(server[k]!.updatedAt).toLocaleString() : t.never);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-night-200">{t.loggedAs(session.username)}{' '}
        <button type="button" className="text-xs text-gold-300 underline" onClick={() => { clearSession(); setSession(null); setServer(null); }}>{t.logout}</button>
      </p>
      <ul className="text-xs text-night-300">
        <li>{t.kindRoster}: {when('roster')}</li>
        <li>{t.kindTeams}: {when('teams')}</li>
        <li>{t.kindResults}: {when('results')}</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => void upload()} className="btn-primary px-3 py-1.5 text-sm">{t.upload(region)}</button>
        <button type="button" disabled={busy} onClick={() => void download()} className="btn-ghost px-3 py-1.5 text-sm">{t.download(region)}</button>
      </div>
      <p className="text-xs text-night-400">{t.help}</p>
      {note && <p role="status" className="text-sm text-gold-300">{note}</p>}
    </div>
  );
}
