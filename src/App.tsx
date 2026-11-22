import { useEffect, useState } from 'react';
import { Link } from './app/Link';
import { RegionDataProvider, useRegionData } from './app/RegionData';
import { PATHS, usePage, type Page } from './app/router';
import type { Region } from './data/types';
import { CatalogPage } from './catalog/CatalogPage';
import { RosterPage } from './roster/RosterPage';
import { SolverPage } from './solverui/SolverPage';
import { I18nProvider, LANGS, useLang, useT } from './i18n';
import { AboutPage } from './pages/AboutPage';
import { Footer } from './pages/Footer';
import { LandingPage } from './pages/LandingPage';

type Tab = 'roster' | 'catalog' | 'solver';
const REGIONS: Region[] = ['NA', 'JP'];

function Shell() {
  const { region, setRegion, data, loading, error } = useRegionData();
  const page = usePage();
  // Kept here so the tab survives a trip to Home or About.
  const [tab, setTab] = useState<Tab>('roster');
  const t = useT();
  useEffect(() => { document.title = page === 'about' ? t.titles.about : t.titles.default; }, [page, t]);
  const [lang, setLang] = useLang();
  const segCls = (on: boolean) => `rounded px-3 py-1 text-sm ${on ? 'bg-sky-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`;
  const tabCls = (t: Tab) =>
    `border-b-2 px-3 py-2 text-sm ${tab === t ? 'border-sky-500 text-sky-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`;
  const navCls = (p: Page) => `text-sm ${page === p ? 'text-sky-400' : 'text-zinc-400 hover:text-zinc-200'}`;
  const navItems: [Page, string][] = [['landing', t.nav.home], ['app', t.nav.app], ['about', t.nav.about]];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-5">
            <Link to={PATHS.landing} className="text-xl font-bold text-sky-400">FGO 3T Solver</Link>
            <nav aria-label={t.nav.label} className="flex gap-3">
              {navItems.map(([p, label], i) => (
                <span key={p} className="flex gap-3">
                  {i > 0 && <span className="text-zinc-600" aria-hidden="true">·</span>}
                  <Link to={PATHS[p]} className={navCls(p)} aria-current={page === p ? 'page' : undefined}>{label}</Link>
                </span>
              ))}
            </nav>
          </div>
          <div className="flex gap-2">
            {page === 'app' && <div className="flex rounded bg-zinc-800 p-0.5" role="group" aria-label={t.app.region}>
              {REGIONS.map((r) => (
                <button key={r} onClick={() => setRegion(r)} aria-pressed={region === r} className={segCls(region === r)}>
                  {r}
                </button>
              ))}
            </div>}
            <div className="flex rounded bg-zinc-800 p-0.5" role="group" aria-label={t.app.language}>
              {LANGS.map((l) => (
                <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} lang={l} className={segCls(lang === l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        {page === 'app' && <nav className="mx-auto flex max-w-6xl px-4">
          <button className={tabCls('roster')} onClick={() => setTab('roster')}>{t.app.tabs.roster}</button>
          <button className={tabCls('catalog')} onClick={() => setTab('catalog')}>{t.app.tabs.catalog}</button>
          <button className={tabCls('solver')} onClick={() => setTab('solver')}>{t.app.tabs.solver}</button>
        </nav>}
      </header>

      {page === 'landing' && <main className="flex-1"><LandingPage /></main>}
      {page === 'about' && <main className="flex-1"><AboutPage /></main>}
      {page === 'app' && <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-6">
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
      </main>}
      <Footer />
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
