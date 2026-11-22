import { DEFAULT_FORM } from '../data/forms';
import { getSettings } from '../app/settings';
import { useEffect, useMemo, useState } from 'react';
import type { CompactCE, CompactMC, CompactServant } from '../data/types';
import type { OwnedServant } from '../roster/types';
import { isDefaultOwned } from '../roster/defaults';
import { FaceIcon } from '../app/ServantIcon';
import { useT } from '../i18n';
import { CePicker, type CeValue } from './CePicker';
import { addRecent, availablePresets, loadRecent, partialParts, PRESET_SLOTS, saveRecent } from './picker';
import { ServantPicker, type PickerTab } from './ServantPicker';

export type SlotKind = 'empty' | 'roster' | 'support' | 'free' | 'supportAuto';
export interface SlotState {
  kind: SlotKind; collectionNo: number | null; ceNo: number | null; ceLv: number; ceMlb: boolean;
  /** Starting form of a servant with forms (data/forms.ts); absent = DEFAULT_FORM. */
  form?: 'low' | 'high';
}
export const emptySlot = (): SlotState => ({ kind: 'empty', collectionNo: null, ceNo: null, ceLv: 100, ceMlb: false });

const inp = 'rounded border border-night-700 bg-night-800 px-2 py-1 text-sm';
const KIND_CLS: Record<SlotKind, string> = {
  empty: 'text-night-500', roster: 'text-gold-300', support: 'text-emerald-300', free: 'text-amber-300', supportAuto: 'text-amber-300',
};

interface Props {
  slots: SlotState[]; setSlots: (s: SlotState[]) => void;
  servants: Map<number, CompactServant>; ces: CompactCE[]; mcs: CompactMC[]; owned: OwnedServant[];
  mcId: number | null; setMcId: (id: number) => void; maxS: number; setMaxS: (s: number) => void;
  /** Some slot is "Any": the run is an autocomplete. */
  isAuto: boolean; defaultMaxS: number;
  /** Saves the current team (Teams tab); absent = no button. */
  onSaveTeam?: () => void;
}

type Picking = { slot: number; what: 'servant' | 'ce' };

export function TeamBuilder({ slots, setSlots, servants, ces, mcs, owned, mcId, setMcId, maxS, setMaxS, isAuto, defaultMaxS, onSaveTeam }: Props) {
  const tt = useT();
  const t = tt.team;
  const sup = getSettings().support;
  const [picking, setPicking] = useState<Picking | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const ownedBy = useMemo(() => new Map(owned.map((o) => [o.collectionNo, o])), [owned]);
  const ceBy = useMemo(() => new Map(ces.map((c) => [c.collectionNo, c])), [ces]);
  const presets = useMemo(() => availablePresets(servants), [servants]);
  const label = (i: number) => (i < 3 ? t.front(i + 1) : t.back(i - 2));
  const update = (i: number, patch: Partial<SlotState>) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  useEffect(() => {
    if (menu === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const applyPreset = (fill: (number | null)[]) => {
    const next = slots.slice();
    PRESET_SLOTS.forEach((si, k) => {
      const no = fill[k];
      next[si] = no === null ? emptySlot() : { ...emptySlot(), kind: 'support', collectionNo: no };
    });
    setSlots(next);
  };

  const pickServant = (i: number, tab: PickerTab, no: number) => {
    update(i, { kind: tab, collectionNo: no });
    saveRecent(addRecent(loadRecent(), no));
    setPicking(null);
  };

  const usedRoster = (i: number) => new Set(slots.flatMap((s, j) =>
    (j !== i && s.kind === 'roster' && s.collectionNo !== null ? [s.collectionNo] : [])));

  const card = (s: SlotState, i: number) => {
    const v = s.collectionNo !== null ? servants.get(s.collectionNo) : undefined;
    const o = s.kind === 'roster' && v ? ownedBy.get(v.collectionNo) : undefined;
    const locked = (s.kind === 'roster' || s.kind === 'support') && v;
    const auto = s.kind === 'free' || s.kind === 'supportAuto';
    const ce = s.ceNo !== null ? ceBy.get(s.ceNo) : undefined;
    const parts = v ? partialParts(v) : [];
    const stats = o ? `lv ${o.lv} · NP${o.npLv} · ${o.skillLv.join('/')}` : s.kind === 'support' ? t.supportStats(sup.lv, sup.npLv, sup.skillLv.join('/')) : '';
    return (
      <div key={i} className={`relative flex flex-col gap-2 rounded-lg border p-2 ${i < 3
        ? 'border-gold-500/40 bg-night-950/60 shadow-[inset_3px_0_0_#d9b86c]'
        : 'border-gold-500/15 bg-night-950/30'}`}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-night-400">{label(i)}</span>
          <span className="flex items-center gap-1">
            {s.kind !== 'empty' && <span className={KIND_CLS[s.kind]}>{t.kinds[s.kind]}</span>}
            <button type="button" onClick={() => setMenu(menu === i ? null : i)} aria-haspopup="menu" aria-expanded={menu === i}
              aria-label={t.slotMenu(label(i))} className="rounded px-1.5 leading-5 text-night-400 hover:bg-night-700 hover:text-night-100">⋯</button>
          </span>
        </div>
        {menu === i && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
            <div role="menu" className="absolute right-2 top-8 z-20 w-52 overflow-hidden rounded border border-night-700 bg-night-900 text-sm shadow-lg">
              {([['empty', t.clear], ['free', t.makeFree], ['supportAuto', t.makeSupportAuto]] as [SlotKind, string][]).map(([k, text]) => (
                <button key={k} type="button" role="menuitem" onClick={() => { setSlots(slots.map((x, j) => (j === i ? { ...emptySlot(), kind: k } : x))); setMenu(null); }}
                  className="block w-full px-3 py-2 text-left text-night-200 hover:bg-night-800">{text}</button>
              ))}
            </div>
          </>
        )}
        <button type="button" onClick={() => setPicking({ slot: i, what: 'servant' })} title={t.pickServant(label(i))}
          className="flex items-center gap-2 rounded p-1 text-left hover:bg-night-700/60">
          {locked ? <FaceIcon face={v.face} name={v.name} size={56} />
            : (
              <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-md border-2 border-dashed text-2xl ${auto
                ? 'border-amber-700 text-amber-400' : 'border-night-600 text-night-500'}`}>{auto ? '?' : '+'}</span>
            )}
          <span className="min-w-0 flex-1 text-sm">
            {locked ? (
              <>
                <span className="block truncate text-night-100">{v.name}</span>
                <span className="block truncate text-xs text-night-400">{stats}</span>
                <span className="flex flex-wrap gap-1 pt-0.5">
                  {o && isDefaultOwned(o) && <span title={t.defaultsTitle} className="rounded bg-night-700 px-1 text-[10px] text-night-200">{t.defaults}</span>}
                  {parts.length > 0 && (
                    <span title={tt.picker.partialTitle(parts.map((p) => (p.part === 'np' ? tt.picker.np : tt.picker.skill(p.num ?? 0))).join(', '))}
                      className="rounded bg-amber-800/70 px-1 text-[10px] text-amber-100">{tt.picker.partial}</span>
                  )}
                </span>
              </>
            ) : <span className="block text-night-400">{auto ? t.anyHint : t.addServant}</span>}
          </span>
        </button>
        {locked && v.forms && (
          <label className="flex items-center gap-2 px-1 text-xs text-night-300">{t.startForm}
            <select className={inp} value={s.form ?? DEFAULT_FORM}
              onChange={(e) => update(i, { form: e.target.value as 'low' | 'high' })}>
              <option value="low">{t.formLow}</option>
              <option value="high">{t.formHigh}</option>
            </select>
          </label>
        )}
        {locked && (
          <button type="button" onClick={() => setPicking({ slot: i, what: 'ce' })} title={t.pickCe(label(i))}
            className="flex items-center gap-2 rounded border-t border-night-700/60 p-1 pt-2 text-left hover:bg-night-700/60">
            {ce ? <FaceIcon face={ce.face} name={ce.name} size={32} />
              : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-dashed border-night-600 text-night-500">+</span>}
            <span className="min-w-0 flex-1 text-xs">
              <span className="block truncate text-night-200">{ce ? ce.name : t.noCe}</span>
              {ce && <span className="block text-night-400">lv {s.ceLv}{s.ceMlb ? ' · MLB' : ''}</span>}
            </span>
          </button>
        )}
      </div>
    );
  };

  const p = picking;
  const ps = p ? slots[p.slot] : null;
  return (
    <section className="panel space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-baseline gap-3"><span className="panel-num" aria-hidden="true">II</span><span className="panel-title">{t.heading}</span></h2>
        {onSaveTeam && slots.some((s) => s.kind !== 'empty') && (
          <button type="button" onClick={onSaveTeam} className="ml-auto rounded-md border border-gold-500/40 px-2.5 py-1 text-xs text-gold-300 hover:border-gold-400">{t.saveTeam}</button>
        )}
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" title={t.presetTitle}>
          <span className="text-xs text-night-400">{t.presets}</span>
          {presets.map(({ preset, fill }) => (
            <button key={preset.id} type="button" onClick={() => applyPreset(fill)}
              className="rounded-full border border-gold-500/35 bg-night-950/70 px-3 py-1 text-xs text-night-100 hover:border-gold-400 hover:text-gold-200">
              {t.presetNames[preset.id as keyof typeof t.presetNames] ?? preset.id}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.18em] text-gold-500">{t.frontLine}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{slots.slice(0, 3).map((s, i) => card(s, i))}</div>
        <p className="pt-2 text-xs uppercase tracking-[0.18em] text-night-400">{t.backLine}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{slots.slice(3).map((s, i) => card(s, i + 3))}</div>
      </div>
      {isAuto && <p className="rounded border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">{t.notExhaustive}</p>}
      <div className="flex flex-wrap items-center gap-3 border-t border-gold-500/15 pt-4 text-sm">
        <label className="flex items-center gap-2">{t.mysticCode}
          <select className={inp} value={mcId ?? ''} onChange={(e) => setMcId(Number(e.target.value))}>
            {mcs.map((m) => <option key={m.id} value={m.id}>{m.name}{m.unsupported.length ? t.mcUnsupported : ''}</option>)}
          </select>
          <span className="text-night-400">lv 10</span>
        </label>
        <label className="flex items-center gap-2">{t.maxTime}
          <input type="number" min={1} max={600} className={`${inp} w-20`} value={maxS} onChange={(e) => setMaxS(Number(e.target.value) || defaultMaxS)} />
        </label>
      </div>
      {p && ps && p.what === 'servant' && (
        <ServantPicker title={t.pickServant(label(p.slot))} servants={servants} owned={owned} usedRoster={usedRoster(p.slot)}
          initialTab={ps.kind === 'support' || ps.kind === 'supportAuto' || owned.length === 0 ? 'support' : 'roster'}
          onPick={(tab, no) => pickServant(p.slot, tab, no)} onClose={() => setPicking(null)} />
      )}
      {p && ps && p.what === 'ce' && (
        <CePicker title={t.pickCe(label(p.slot))} ces={ces} value={ps as CeValue}
          onChange={(patch) => update(p.slot, patch)} onClose={() => setPicking(null)} />
      )}
    </section>
  );
}
