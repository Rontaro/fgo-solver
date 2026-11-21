import { useState } from 'react';
import { RegionDataProvider, useRegionData } from './app/RegionData';
import type { Region } from './data/types';
import { CatalogPage } from './catalog/CatalogPage';
import { RosterPage } from './roster/RosterPage';
import { SolverPage } from './solverui/SolverPage';
import { I18nProvider, LANGS, useLang, useT } from './i18n';

type Tab = 'roster' | 'catalog' | 'solver';
const REGIONS: Region[] = ['NA', 'JP'];

function Shell() {
  const { region, setRegion, data, loading, error } = useRegionData();
  const [tab, setTab] = useState<Tab>('roster');
  const t = useT();
  const [lang, setLang] = useLang();
  const segCls = (on: boolean) => `rounded px-3 py-1 text-sm ${on ? 'bg-sky-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`;
  const tabCls = (t: Tab) =>
    `border-b-2 px-3 py-2 text-sm ${tab === t ? 'border-sky-500 text-sky-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="text-xl font-bold text-sky-400">FGO 3T Solver</h1>
          <div className="flex gap-2">
            <div className="flex rounded bg-zinc-800 p-0.5" role="group" aria-label={t.app.region}>
              {REGIONS.map((r) => (
                <button key={r} onClick={() => setRegion(r)} aria-pressed={region === r} className={segCls(region === r)}>
                  {r}
                </button>
              ))}
            </div>
            <div className="flex rounded bg-zinc-800 p-0.5" role="group" aria-label={t.app.language}>
              {LANGS.map((l) => (
                <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} lang={l} className={segCls(lang === l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl px-4">
          <button className={tabCls('roster')} onClick={() => setTab('roster')}>{t.app.tabs.roster}</button>
          <button className={tabCls('catalog')} onClick={() => setTab('catalog')}>{t.app.tabs.catalog}</button>
          <button className={tabCls('solver')} onClick={() => setTab('solver')}>{t.app.tabs.solver}</button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {data?.stale && (
          <div className="rounded border border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-300">
            {t.app.stale(data.version.hash, new Date(data.version.timestamp * 1000).toLocaleDateString(t.locale))}
          </div>
        )}
        {error && (
          <div className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {t.app.loadError(region, error)}
          </div>
        )}
        {loading && <p className="text-zinc-400">{t.app.loading(region)}</p>}
        {data && (tab === 'roster' ? <RosterPage /> : tab === 'catalog' ? <CatalogPage /> : <SolverPage />)}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <RegionDataProvider>
        <Shell />
      </RegionDataProvider>
    </I18nProvider>
  );
}
