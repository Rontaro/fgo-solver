import { useEffect, useId, useMemo, useState } from 'react';
import type { QuestWar, Region } from '../data/types';
import { questFromAtlas, UnsupportedQuestError, type RawQuest } from '../engine/quest';
import { loadFavs, loadRecent, pushRecent, saveFavs, saveRecent, type RecentNode } from './questPrefs';
import { lastPhase, questIndex, searchQuests, type QuestItem } from './questSearch';
import { useT } from '../i18n';

export interface PickedQuest { raw: RawQuest; label: string; unsupported: readonly string[] | null }

const cache = new Map<string, Promise<RawQuest>>();
function fetchQuest(region: Region, id: number, phase: number): Promise<RawQuest> {
  const url = `https://api.atlasacademy.io/nice/${region}/quest/${id}/${phase}`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<RawQuest>;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

const inp = 'w-full rounded border border-night-700 bg-night-800 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gold-500';
const MAX_RESULTS = 30;

function TypeBadge({ type }: { type: string }) {
  const free = type === 'free';
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${free ? 'bg-gold-900/60 text-gold-300' : 'bg-amber-900/60 text-amber-300'}`}>
      {free ? 'free' : 'event'}
    </span>
  );
}

function Star({ on, onToggle, name, tabIndex }: { on: boolean; onToggle: () => void; name: string; tabIndex?: number }) {
  const t = useT().quest;
  return (
    <button type="button" tabIndex={tabIndex} aria-pressed={on}
      aria-label={on ? t.favRemove(name) : t.favAdd(name)}
      title={on ? t.favRemoveTitle : t.favAddTitle}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`shrink-0 rounded px-1 text-base leading-none ${on ? 'text-amber-400' : 'text-night-600 hover:text-night-300'}`}>
      {on ? '★' : '☆'}
    </button>
  );
}

const where = (it: QuestItem) => it.war.warName + (it.quest.spot ? ` · ${it.quest.spot}` : '');

export function QuestPicker({ region, wars, onChange }: { region: Region; wars: QuestWar[]; onChange: (q: PickedQuest | null) => void }) {
  const tt = useT();
  const t = tt.quest;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [sel, setSel] = useState<RecentNode | null>(null);
  const [recent, setRecent] = useState<RecentNode[]>(() => loadRecent(region));
  const [favs, setFavs] = useState<number[]>(() => loadFavs(region));
  const [picked, setPicked] = useState<PickedQuest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const listId = useId();

  const index = useMemo(() => questIndex(wars), [wars]);
  const byId = useMemo(() => new Map(index.map((it) => [it.quest.id, it])), [index]);
  const results = useMemo(() => searchQuests(index, query, MAX_RESULTS), [index, query]);
  const item = sel ? byId.get(sel.id) ?? null : null;
  const quest = item?.quest ?? null;
  const phase = sel?.phase ?? null;
  // Atlas quest phases only carry warId: the event (for event-conditioned effects) comes from the war index.
  const eventId = item?.war.eventId ?? 0;

  useEffect(() => {
    setSel(null); setQuery(''); setRecent(loadRecent(region)); setFavs(loadFavs(region));
  }, [region]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  useEffect(() => {
    setPicked(null); setErr(null); onChange(null);
    if (!quest || phase === null) return;
    let alive = true;
    fetchQuest(region, quest.id, phase).then((fetched) => {
      if (!alive) return;
      const raw: RawQuest = eventId ? { ...fetched, eventId } : fetched;
      let unsupported: readonly string[] | null = null;
      try { questFromAtlas(raw); } catch (e) {
        if (e instanceof UnsupportedQuestError) unsupported = e.reasons;
        else { setErr(e instanceof Error ? e.message : String(e)); return; }
      }
      const p = { raw, label: `${quest.name} (${phase})`, unsupported };
      setPicked(p); onChange(p);
    }, (e: unknown) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [region, quest, phase, eventId]);

  /** Selects a quest at `ph` (when valid) or its last phase, and records it as recent. */
  const choose = (it: QuestItem, ph?: number) => {
    const p = ph !== undefined && it.quest.phases.includes(ph) ? ph : lastPhase(it.quest);
    if (p === null) return;
    const node = { id: it.quest.id, phase: p };
    setSel(node); setQuery(''); setActive(0);
    const next = pushRecent(recent, node);
    setRecent(next); saveRecent(region, next);
  };
  const toggleFav = (id: number) => {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(next); saveFavs(region, next);
  };

  const favItems = favs.flatMap((id) => { const it = byId.get(id); return it ? [it] : []; });
  const recentItems = recent.flatMap((r) => { const it = byId.get(r.id); return it ? [{ it, phase: r.phase }] : []; });
  const chip = (it: QuestItem, ph: number | undefined, key: string, star: boolean) => (
    <button key={key} type="button" onClick={() => choose(it, ph)} title={`${it.quest.name} · ${where(it)}`}
      className="flex max-w-xs items-center gap-1 rounded-full border border-night-700 bg-night-800 px-2.5 py-0.5 text-xs hover:border-gold-600 hover:bg-night-700">
      {star && <span aria-hidden className="text-amber-400">★</span>}
      <span className="truncate">{it.quest.name}</span>
      {ph !== undefined && it.quest.phases.length > 1 && <span className="text-night-500">({ph})</span>}
    </button>
  );

  return (
    <section className="panel space-y-3">
      <h2 className="flex items-baseline gap-3"><span className="panel-num" aria-hidden="true">I</span><span className="panel-title">{t.heading}</span></h2>
      {item && phase !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-night-800/60 px-3 py-2">
          <Star on={favs.includes(item.quest.id)} onToggle={() => toggleFav(item.quest.id)} name={item.quest.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{item.quest.name}</span>
            <span className="block truncate text-xs text-night-400">{where(item)}</span>
          </span>
          <TypeBadge type={item.quest.type} />
          {item.quest.phases.length > 1 && (
            <details className="text-xs text-night-400">
              <summary className="cursor-pointer select-none">{t.phase(phase)}</summary>
              <select aria-label={t.phaseLabel} className={`${inp} mt-1 w-auto`} value={phase} onChange={(e) => choose(item, Number(e.target.value))}>
                {item.quest.phases.map((p) => <option key={p} value={p}>{t.phase(p)}</option>)}
              </select>
            </details>
          )}
        </div>
      )}
      <input
        className={inp} placeholder={t.searchPlaceholder} value={query} aria-label={t.searchLabel}
        role="combobox" aria-expanded={results.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
          else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active]); }
          else if (e.key === 'Escape') setQuery('');
        }}
      />
      {!query.trim() && (favItems.length > 0 || recentItems.length > 0) && (
        <div className="space-y-1">
          {favItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-night-500">{t.favorites}</span>
              {favItems.map((it) => chip(it, undefined, `f${it.quest.id}`, true))}
            </div>
          )}
          {recentItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-night-500">{t.recent}</span>
              {recentItems.map(({ it, phase: ph }) => chip(it, ph, `r${it.quest.id}`, false))}
            </div>
          )}
        </div>
      )}
      {query.trim() && (results.length === 0
        ? <p className="text-sm text-night-500">{t.noResults}</p>
        : (
          <ul id={listId} role="listbox" aria-label={t.results} className="max-h-80 overflow-auto rounded border border-night-800">
            {results.map((it, i) => (
              <li key={it.quest.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onClick={() => choose(it)} onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-night-800' : ''}`}>
                <Star on={favs.includes(it.quest.id)} onToggle={() => toggleFav(it.quest.id)} name={it.quest.name} tabIndex={-1} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{it.quest.name}</span>
                  <span className="block truncate text-xs text-night-500">{where(it)}</span>
                </span>
                <TypeBadge type={it.quest.type} />
              </li>
            ))}
          </ul>
        ))}
      {err && <p className="text-sm text-red-400">{t.loadError(err)}</p>}
      {quest && phase !== null && !picked && !err && <p className="text-sm text-night-400">{t.loading}</p>}
      {picked?.unsupported && (
        <div className="rounded border border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-300">
          <p className="font-semibold">{t.unsupported}</p>
          <ul className="list-disc pl-5">{picked.unsupported.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {picked && (
        <div className="grid gap-2 sm:grid-cols-3">
          {[...picked.raw.stages].sort((a, b) => a.wave - b.wave).map((st) => (
            <div key={st.wave} className="rounded bg-night-800 p-2 text-sm">
              <p className="font-semibold text-gold-400">{t.wave(st.wave)}</p>
              {st.enemies.filter((e) => e.deck === 'enemy').sort((a, b) => a.deckId - b.deckId).map((e) => (
                <p key={e.deckId}>{e.name} <span className="text-night-400">· {e.svt.className} · {e.hp.toLocaleString(tt.locale)} HP</span></p>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
