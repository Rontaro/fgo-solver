import { useEffect, useMemo, useState } from 'react';
import type { QuestWar, Region } from '../data/types';
import { questFromAtlas, UnsupportedQuestError, type RawQuest } from '../engine/quest';

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

const sel = 'w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm';

export function QuestPicker({ region, wars, onChange }: { region: Region; wars: QuestWar[]; onChange: (q: PickedQuest | null) => void }) {
  const [filter, setFilter] = useState('');
  const [warId, setWarId] = useState<number | null>(null);
  const [questId, setQuestId] = useState<number | null>(null);
  const [phase, setPhase] = useState<number | null>(null);
  const [picked, setPicked] = useState<PickedQuest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const f = filter.trim().toLowerCase();
  const shownWars = useMemo(() => wars.filter((w) => !f || w.warName.toLowerCase().includes(f)
    || w.quests.some((q) => q.name.toLowerCase().includes(f))), [wars, f]);
  const war = wars.find((w) => w.warId === warId) ?? null;
  const quests = war ? war.quests.filter((q) => !f || war.warName.toLowerCase().includes(f) || q.name.toLowerCase().includes(f)) : [];
  const quest = war?.quests.find((q) => q.id === questId) ?? null;

  useEffect(() => {
    setPicked(null); setErr(null); onChange(null);
    if (!quest || phase === null) return;
    let alive = true;
    fetchQuest(region, quest.id, phase).then((raw) => {
      if (!alive) return;
      let unsupported: readonly string[] | null = null;
      try { questFromAtlas(raw); } catch (e) {
        if (e instanceof UnsupportedQuestError) unsupported = e.reasons;
        else { setErr(e instanceof Error ? e.message : String(e)); return; }
      }
      const p = { raw, label: `${quest.name} (${phase})`, unsupported };
      setPicked(p); onChange(p);
    }, (e: unknown) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [region, quest, phase]);

  return (
    <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="font-semibold">Quest</h2>
      <input className={sel} placeholder="Filtra guerre e quest…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="grid gap-2 sm:grid-cols-[2fr_2fr_1fr]">
        <select className={sel} value={warId ?? ''} onChange={(e) => { setWarId(Number(e.target.value) || null); setQuestId(null); setPhase(null); }}>
          <option value="">— Guerra —</option>
          {shownWars.map((w) => <option key={w.warId} value={w.warId}>{w.warName}</option>)}
        </select>
        <select className={sel} value={questId ?? ''} disabled={!war} onChange={(e) => {
          const q = war?.quests.find((x) => x.id === Number(e.target.value));
          setQuestId(q?.id ?? null); setPhase(q ? q.phases[q.phases.length - 1] ?? null : null);
        }}>
          <option value="">— Quest —</option>
          {quests.map((q) => <option key={q.id} value={q.id}>{q.name} ({q.type})</option>)}
        </select>
        <select className={sel} value={phase ?? ''} disabled={!quest} onChange={(e) => setPhase(Number(e.target.value))}>
          {quest?.phases.map((p) => <option key={p} value={p}>Fase {p}</option>)}
        </select>
      </div>
      {err && <p className="text-sm text-red-400">Errore nel caricamento della quest: {err}</p>}
      {quest && phase !== null && !picked && !err && <p className="text-sm text-zinc-400">Caricamento quest…</p>}
      {picked?.unsupported && (
        <div className="rounded border border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-300">
          <p className="font-semibold">Nodo non supportato</p>
          <ul className="list-disc pl-5">{picked.unsupported.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {picked && (
        <div className="grid gap-2 sm:grid-cols-3">
          {[...picked.raw.stages].sort((a, b) => a.wave - b.wave).map((st) => (
            <div key={st.wave} className="rounded bg-zinc-800 p-2 text-sm">
              <p className="font-semibold text-sky-400">Wave {st.wave}</p>
              {st.enemies.filter((e) => e.deck === 'enemy').sort((a, b) => a.deckId - b.deckId).map((e) => (
                <p key={e.deckId}>{e.name} <span className="text-zinc-400">· {e.svt.className} · {e.hp.toLocaleString('it-IT')} HP</span></p>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
