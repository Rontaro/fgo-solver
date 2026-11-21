import { useState } from 'react';
import { RegionDataProvider, useRegionData } from './app/RegionData';
import type { Region } from './data/types';
import { RosterPage } from './roster/RosterPage';

type Tab = 'roster' | 'solver';
const REGIONS: Region[] = ['NA', 'JP'];

function Shell() {
  const { region, setRegion, data, loading, error } = useRegionData();
  const [tab, setTab] = useState<Tab>('roster');
  const tabCls = (t: Tab) =>
    `border-b-2 px-3 py-2 text-sm ${tab === t ? 'border-sky-500 text-sky-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="text-xl font-bold text-sky-400">FGO 3T Solver</h1>
          <div className="flex rounded bg-zinc-800 p-0.5" role="group" aria-label="Regione">
            {REGIONS.map((r) => (
              <button key={r} onClick={() => setRegion(r)} aria-pressed={region === r}
                className={`rounded px-3 py-1 text-sm ${region === r ? 'bg-sky-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl px-4">
          <button className={tabCls('roster')} onClick={() => setTab('roster')}>Roster</button>
          <button className={tabCls('solver')} onClick={() => setTab('solver')}>Solver</button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {data?.stale && (
          <div className="rounded border border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-300">
            Impossibile aggiornare i dati di gioco: stai usando una copia salvata
            (versione {data.version.hash}, {new Date(data.version.timestamp * 1000).toLocaleDateString('it-IT')}).
          </div>
        )}
        {error && (
          <div className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            Impossibile caricare i dati di gioco {region}: {error}
          </div>
        )}
        {loading && <p className="text-zinc-400">Caricamento dati {region}…</p>}
        {data && (tab === 'roster'
          ? <RosterPage />
          : <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">Solver: in arrivo.</p>)}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <RegionDataProvider>
      <Shell />
    </RegionDataProvider>
  );
}
