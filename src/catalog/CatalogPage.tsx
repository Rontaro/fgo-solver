import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRegionData } from '../app/RegionData';
import { FaceIcon } from '../app/ServantIcon';
import type { CompactServant } from '../data/types';
import { IdbRosterStore } from '../roster/store';
import { useT } from '../i18n';
import { newOwned } from '../roster/defaults';
import {
  EMPTY_FILTERS, activeFilterCount, classLabel, classesOf, filterServants, groupServants, loadPrefs, savePrefs,
  servantType, toggle, type CatalogFilters, type GroupBy, type Ownership,
} from './catalog';
import { CARD_LABEL, Chip, Corner, ServantTile, TYPE_LABEL, starStr } from './ServantTile';

const store = new IdbRosterStore();

const RARITIES = [5, 4, 3, 2, 1, 0];

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-night-400">{title}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function ServantCard({ s, owned, onOpen }: { s: CompactServant; owned: boolean; onOpen: () => void }) {
  const t = useT().catalog;
  const unsupported = s.unsupported.length > 0;
  return (
    <ServantTile s={s} onClick={onOpen} dim={unsupported} corners={<>
      {owned && <Corner pos="tr" cls="bg-gold-500 !text-night-950" label={t.inRoster}>✓</Corner>}
      {unsupported && <Corner pos="tl" cls="bg-amber-600" label={t.notSimulable}>!</Corner>}
    </>} />
  );
}

function Detail({ s, owned, busy, onAdd, onClose }: {
  s: CompactServant; owned: boolean; busy: boolean; onAdd: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const tt = useT();
  const t = servantType(s);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={s.name} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-t-lg border border-night-700 bg-night-900 p-4 sm:rounded-lg">
        <div className="flex items-start gap-3">
          <FaceIcon face={s.face} name={s.name} size={64} />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-night-100">{s.name}</h3>
            <p className="text-sm text-night-400">{classLabel(s.className)} · <span className="text-amber-400">{starStr(s.rarity)}</span></p>
            <p className="text-sm text-night-400">
              NP: {s.np ? `${CARD_LABEL[s.np.card]} ${TYPE_LABEL[t]}` : tt.catalog.supportNoNp}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={tt.common.close} className="text-night-400 hover:text-night-100">✕</button>
        </div>
        {s.unsupported.length > 0 && (
          <div className="rounded border border-amber-900 bg-amber-950/40 p-2 text-xs text-amber-300">
            <p className="mb-1 font-semibold">{tt.catalog.unsupportedHeading}</p>
            <ul className="list-inside list-disc break-all">{s.unsupported.map((u) => <li key={u}>{u}</li>)}</ul>
          </div>
        )}
        {owned
          ? <p className="rounded bg-night-800 px-3 py-2 text-center text-sm text-gold-300">{tt.catalog.alreadyInRoster}</p>
          : (
            <button type="button" onClick={onAdd} disabled={busy}
              className="w-full rounded bg-gold-600 px-3 py-2 text-sm font-medium text-night-950 hover:bg-gold-500 disabled:opacity-50">
              {tt.catalog.addToRoster}
            </button>
          )}
      </div>
    </div>
  );
}

export function CatalogPage() {
  const { region, data } = useRegionData();
  const t = useT().catalog;
  const [prefs] = useState(loadPrefs);
  const [filters, setFilters] = useState<CatalogFilters>(prefs.filters);
  const [groupBy, setGroupBy] = useState<GroupBy>(prefs.groupBy);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState(false);
  const [owned, setOwned] = useState<ReadonlySet<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => savePrefs({ filters, groupBy }), [filters, groupBy]);

  useEffect(() => {
    let alive = true;
    store.load(region).then((d) => { if (alive) setOwned(new Set(d.servants.map((s) => s.collectionNo))); });
    return () => { alive = false; };
  }, [region]);

  const all = useMemo(() => [...(data?.servants.values() ?? [])], [data]);
  const classes = useMemo(() => classesOf(all), [all]);
  const groups = useMemo(
    () => groupServants(filterServants(all, filters, owned, query), groupBy),
    [all, filters, owned, query, groupBy],
  );
  const shown = groups.reduce((n, g) => n + g.servants.length, 0);
  const nActive = activeFilterCount(filters);
  const set = <K extends keyof CatalogFilters>(k: K, v: CatalogFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const selected = open === null ? undefined : data?.servants.get(open);

  const add = async (collectionNo: number) => {
    setBusy(true);
    setError(null);
    try {
      const doc = await store.load(region);
      if (!doc.servants.some((s) => s.collectionNo === collectionNo)) {
        await store.save({ ...doc, servants: [...doc.servants, newOwned(collectionNo)] });
      }
      setOwned((o) => new Set([...o, collectionNo]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchPlaceholder} aria-label={t.searchLabel}
          className="min-w-0 flex-1 rounded border border-night-700 bg-night-800 px-3 py-2 text-sm text-night-100 placeholder:text-night-500 focus:border-gold-500 focus:outline-none" />
        <button type="button" onClick={() => setPanel(true)}
          className="rounded border border-night-700 bg-night-800 px-3 py-2 text-sm text-night-200 hover:border-night-500">
          {t.filters}{nActive > 0 && <span className="ml-1.5 rounded-full bg-gold-600 px-1.5 text-xs text-night-950">{nActive}</span>}
        </button>
        <div className="flex items-center gap-1 text-sm text-night-400">
          <span className="hidden sm:inline">{t.groupBy}</span>
          <div className="flex rounded bg-night-800 p-0.5" role="group" aria-label={t.groupBy}>
            {(['class', 'rarity'] as const).map((g) => (
              <button key={g} type="button" onClick={() => setGroupBy(g)} aria-pressed={groupBy === g}
                className={`rounded px-2.5 py-1 ${groupBy === g ? 'bg-gold-600 text-night-950' : 'text-night-400 hover:text-night-200'}`}>
                {g === 'class' ? t.byClass : t.byRarity}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-night-500">{t.shown(shown, all.length)}</p>
      {error && <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{t.saveError(error)}</p>}

      {groups.length === 0 && <p className="text-sm text-night-400">{t.noMatch}</p>}
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.key} className="flex overflow-hidden rounded border border-night-800 bg-night-900">
            <div className="flex w-16 shrink-0 items-center justify-center bg-night-800 px-1 text-center text-xs font-semibold text-night-200 sm:w-24 sm:text-sm">
              {g.label}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1 p-2">
              {g.servants.map((s) => (
                <ServantCard key={s.collectionNo} s={s} owned={owned.has(s.collectionNo)} onOpen={() => setOpen(s.collectionNo)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {panel && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/50" onClick={() => setPanel(false)}>
          <aside role="dialog" aria-label={t.filters} onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full flex-col border-l border-night-800 bg-night-900 sm:w-96">
            <div className="flex items-center justify-between border-b border-night-800 px-4 py-3">
              <h2 className="font-semibold text-night-100">{t.filters}</h2>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} disabled={nActive === 0}
                  className="rounded px-2 py-1 text-sm text-night-300 hover:text-white disabled:opacity-40">{t.reset}</button>
                <button type="button" onClick={() => setPanel(false)} aria-label={t.closeFilters}
                  className="rounded px-2 py-1 text-night-400 hover:text-night-100">✕</button>
              </div>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <FilterGroup title={t.fClass}>
                {classes.map((c) => (
                  <Chip key={c} on={filters.classes.includes(c)} onClick={() => set('classes', toggle(filters.classes, c))}>{classLabel(c)}</Chip>
                ))}
              </FilterGroup>
              <FilterGroup title={t.fRarity}>
                {RARITIES.map((r) => (
                  <Chip key={r} on={filters.rarities.includes(r)} onClick={() => set('rarities', toggle(filters.rarities, r))}>{r}★</Chip>
                ))}
              </FilterGroup>
              <FilterGroup title={t.fCard}>
                {(['arts', 'buster', 'quick'] as const).map((c) => (
                  <Chip key={c} on={filters.cards.includes(c)} onClick={() => set('cards', toggle(filters.cards, c))}>{CARD_LABEL[c]}</Chip>
                ))}
              </FilterGroup>
              <FilterGroup title={t.fTarget}>
                {(['aoe', 'st', 'support'] as const).map((t) => (
                  <Chip key={t} on={filters.types.includes(t)} onClick={() => set('types', toggle(filters.types, t))}>{TYPE_LABEL[t]}</Chip>
                ))}
              </FilterGroup>
              <FilterGroup title={t.fRoster}>
                {([['in', t.onlyInRoster], ['out', t.notInRoster]] as [Ownership, string][]).map(([o, label]) => (
                  <Chip key={o} on={filters.owned.includes(o)} onClick={() => set('owned', toggle(filters.owned, o))}>{label}</Chip>
                ))}
              </FilterGroup>
              <FilterGroup title={t.fSimulation}>
                <Chip on={filters.hideUnsupported} onClick={() => set('hideUnsupported', !filters.hideUnsupported)}>{t.hideUnsupported}</Chip>
              </FilterGroup>
            </div>
            <div className="border-t border-night-800 p-3">
              <button type="button" onClick={() => setPanel(false)}
                className="w-full rounded bg-gold-600 px-3 py-2 text-sm font-medium text-night-950 hover:bg-gold-500">
                {t.show(shown)}
              </button>
            </div>
          </aside>
        </div>
      )}

      {selected && (
        <Detail s={selected} owned={owned.has(selected.collectionNo)} busy={busy}
          onAdd={() => void add(selected.collectionNo)} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}
