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

/** The site's mark (also the favicon's shape). */
function Crest() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <path d="M16 2 L29 9 V23 L16 30 L3 23 V9 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 8 L22 16 L16 24 L10 16 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

function Shell() {
  const { region, setRegion, data, loading, error } = useRegionData();
  const page = usePage();
  // Kept here so the tab survives a trip to Home or About.
  const [tab, setTab] = useState<Tab>('roster');
  const t = useT();
  useEffect(() => { document.title = page === 'about' ? t.titles.about : t.titles.default; }, [page, t]);
  const [lang, setLang] = useLang();
  const segCls = (on: boolean) => `px-3 py-1 text-sm ${on ? 'bg-gold-500 font-semibold text-night-950' : 'text-night-300 hover:text-gold-200'}`;
  const tabCls = (t: Tab) =>
    `border-b-2 px-4 py-2.5 text-sm ${tab === t ? 'border-gold-500 font-semibold text-gold-200' : 'border-transparent text-night-300 hover:text-gold-200'}`;
  const navCls = (p: Page) =>
    `border-b pb-0.5 text-sm tracking-wide ${page === p ? 'border-gold-500 text-gold-200' : 'border-transparent text-night-300 hover:text-gold-200'}`;
  const navItems: [Page, string][] = [['landing', t.nav.home], ['app', t.nav.app], ['about', t.nav.about]];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gold-500/20 bg-night-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <Link to={PATHS.landing} className="flex items-center gap-2.5 text-gold-400 hover:text-gold-200">
              <Crest />
              <span className="font-display text-lg font-bold tracking-wider">FGO 3T Solver</span>
            </Link>
            <nav aria-label={t.nav.label} className="flex gap-6">
              {navItems.map(([p, label]) => (
                <Link key={p} to={PATHS[p]} className={navCls(p)} aria-current={page === p ? 'page' : undefined}>{label}</Link>
              ))}
            </nav>
          </div>
          <div className="flex gap-2">
            {page === 'app' && <div className="flex overflow-hidden rounded-md border border-gold-500/35" role="group" aria-label={t.app.region}>
              {REGIONS.map((r) => (
                <button key={r} onClick={() => setRegion(r)} aria-pressed={region === r} className={segCls(region === r)}>
                  {r}
                </button>
              ))}
            </div>}
            <div className="flex overflow-hidden rounded-md border border-gold-500/35" role="group" aria-label={t.app.language}>
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
        {loading && <p className="text-night-400">{t.app.loading(region)}</p>}
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
