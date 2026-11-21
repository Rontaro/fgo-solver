import { useMemo } from 'react';
import type { CompactCE, CompactMC, CompactServant } from '../data/types';
import type { OwnedServant } from '../roster/types';
import { FaceIcon } from '../app/ServantIcon';
import { ServantSearch } from '../app/ServantSearch';
import { useT } from '../i18n';

export type SlotKind = 'empty' | 'roster' | 'support' | 'free' | 'supportAuto';
export interface SlotState { kind: SlotKind; collectionNo: number | null; ceName: string; ceLv: number; ceMlb: boolean }
export const emptySlot = (): SlotState => ({ kind: 'empty', collectionNo: null, ceName: '', ceLv: 100, ceMlb: false });

const KINDS: SlotKind[] = ['empty', 'roster', 'support', 'free', 'supportAuto'];
const inp = 'rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm';

interface Props {
  slots: SlotState[]; setSlots: (s: SlotState[]) => void;
  servants: Map<number, CompactServant>; ces: CompactCE[]; mcs: CompactMC[]; owned: OwnedServant[];
  mcId: number | null; setMcId: (id: number) => void; maxS: number; setMaxS: (s: number) => void;
}

export function TeamBuilder({ slots, setSlots, servants, ces, mcs, owned, mcId, setMcId, maxS, setMaxS }: Props) {
  const t = useT().team;
  const ownedBy = useMemo(() => new Map(owned.map((o) => [o.collectionNo, o])), [owned]);
  const ownedOk = useMemo(() => owned.flatMap((o) => {
    const v = servants.get(o.collectionNo);
    return v && v.unsupported.length === 0 ? [v] : [];
  }), [owned, servants]);
  const ownedSub = (v: CompactServant) => {
    const o = ownedBy.get(v.collectionNo);
    return o ? `lv ${o.lv} · NP${o.npLv} · ${o.skillLv.join('/')}` : v.className;
  };
  const allOk = useMemo(() => [...servants.values()].filter((s) => s.unsupported.length === 0)
    .sort((a, b) => a.name.localeCompare(b.name)), [servants]);
  const ceNames = useMemo(() => [...new Set(ces.filter((c) => c.unsupported.length === 0).map((c) => c.name))].sort(), [ces]);
  const update = (i: number, patch: Partial<SlotState>) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="font-semibold">{t.heading}</h2>
      <datalist id="ce-names">{ceNames.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="grid gap-2 md:grid-cols-3">
        {slots.map((s, i) => (
          <div key={i} className="space-y-1 rounded bg-zinc-800/60 p-2">
            <p className="text-xs text-zinc-400">{i < 3 ? t.front(i + 1) : t.back(i - 2)}</p>
            <select className={`${inp} w-full`} value={s.kind} onChange={(e) => update(i, { kind: e.target.value as SlotKind, collectionNo: null })}>
              {KINDS.map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}
            </select>
            {(s.kind === 'roster' || s.kind === 'support') && (
              <>
                {s.collectionNo !== null && servants.get(s.collectionNo) ? (() => {
                  const v = servants.get(s.collectionNo)!;
                  return (
                    <div className="flex items-center gap-2">
                      <FaceIcon face={v.face} name={v.name} />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block truncate">{v.name}</span>
                        <span className="block truncate text-xs text-zinc-500">{s.kind === 'roster' ? ownedSub(v) : 'lv 90 · NP1 · 10/10/10'}</span>
                      </span>
                      <button onClick={() => update(i, { collectionNo: null })} aria-label={t.changeServant(v.name)}
                        className="rounded px-2 py-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100">×</button>
                    </div>
                  );
                })() : (
                  <ServantSearch items={s.kind === 'roster' ? ownedOk : allOk} limit={30}
                    placeholder={s.kind === 'roster' ? t.searchRoster : t.searchServant}
                    sub={s.kind === 'roster' ? ownedSub : undefined}
                    onPick={(v) => update(i, { collectionNo: v.collectionNo })} />
                )}
                <input className={`${inp} w-full`} list="ce-names" placeholder={t.cePlaceholder} value={s.ceName}
                  onChange={(e) => update(i, { ceName: e.target.value })} />
                <div className="flex items-center gap-3 text-sm">
                  <select className={inp} value={s.ceLv} onChange={(e) => update(i, { ceLv: Number(e.target.value) })}>
                    <option value={100}>CE lv 100</option><option value={1}>CE lv 1</option>
                  </select>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={s.ceMlb} onChange={(e) => update(i, { ceMlb: e.target.checked })} /> MLB
                  </label>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">{t.mysticCode}
          <select className={inp} value={mcId ?? ''} onChange={(e) => setMcId(Number(e.target.value))}>
            {mcs.map((m) => <option key={m.id} value={m.id}>{m.name}{m.unsupported.length ? t.mcUnsupported : ''}</option>)}
          </select>
          <span className="text-zinc-400">lv 10</span>
        </label>
        <label className="flex items-center gap-2">{t.maxTime}
          <input type="number" min={1} max={600} className={`${inp} w-20`} value={maxS} onChange={(e) => setMaxS(Number(e.target.value) || 20)} />
        </label>
      </div>
    </section>
  );
}
