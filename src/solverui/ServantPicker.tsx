import { getSettings } from '../app/settings';
import { useMemo, useState } from 'react';
import type { CompactServant } from '../data/types';
import { EMPTY_FILTERS, classLabel, classesOf, compareServants, filterServants, toggle, type SvtType } from '../catalog/catalog';
import { Chip, Corner, ServantTile, TYPE_LABEL } from '../catalog/ServantTile';
import { isDefaultOwned } from '../roster/defaults';
import type { OwnedServant } from '../roster/types';
import { useT } from '../i18n';
import { Modal } from './Modal';
import { isUsable, loadRecent, partialParts } from './picker';

export type PickerTab = 'roster' | 'support';

const byUsableThenRarity = (a: CompactServant, b: CompactServant) =>
  Number(!isUsable(a)) - Number(!isUsable(b)) || compareServants(a, b);

/** Servant grid with roster / support tabs, search and class / type chips. */
export function ServantPicker({ title, initialTab, servants, owned, usedRoster, onPick, onClose, selected }: {
  title: string; initialTab: PickerTab; servants: ReadonlyMap<number, CompactServant>; owned: readonly OwnedServant[];
  /** Roster servants already in another slot (one copy each). */
  usedRoster: ReadonlySet<number>;
  onPick: (tab: PickerTab, collectionNo: number) => void; onClose: () => void;
  /** Multi-select mode (list slot): the picks so far; onPick toggles one and the picker stays open. */
  selected?: readonly { tab: PickerTab; no: number }[];
}) {
  const tt = useT();
  const t = tt.picker;
  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [query, setQuery] = useState('');
  const [classes, setClasses] = useState<string[]>([]);
  const [types, setTypes] = useState<SvtType[]>([]);
  const [recent] = useState(loadRecent);

  const ownedBy = useMemo(() => new Map(owned.map((o) => [o.collectionNo, o])), [owned]);
  const ownedSet = useMemo(() => new Set(ownedBy.keys()), [ownedBy]);
  const list = useMemo(() => (tab === 'roster'
    ? owned.flatMap((o) => { const s = servants.get(o.collectionNo); return s ? [s] : []; })
    : [...servants.values()]).sort(byUsableThenRarity), [tab, owned, servants]);
  const classOpts = useMemo(() => classesOf(list), [list]);
  const shown = useMemo(() => filterServants(list, { ...EMPTY_FILTERS, classes, types }, ownedSet, query),
    [list, classes, types, ownedSet, query]);
  const inList = useMemo(() => new Map(list.map((s) => [s.collectionNo, s])), [list]);
  const recentShown = query || classes.length || types.length ? []
    : recent.flatMap((no) => { const s = inList.get(no); return s ? [s] : []; });

  const reason = (s: CompactServant): string | null =>
    !isUsable(s) ? t.unusable(s.unsupported.join(', '))
    : tab === 'roster' && usedRoster.has(s.collectionNo) ? t.inTeam
    : null;

  const tile = (s: CompactServant) => {
    const why = reason(s);
    const parts = partialParts(s);
    const o = tab === 'roster' ? ownedBy.get(s.collectionNo) : undefined;
    const partsText = parts.map((p) => (p.part === 'np' ? t.np : t.skill(p.num ?? 0))
      + (p.effects.length ? ` (${p.effects.join(', ')})` : '')).join('; ');
    return (
      <ServantTile key={s.collectionNo} s={s} disabled={!!why} title={why ? `${s.name}: ${why}` : s.name}
        onClick={() => onPick(tab, s.collectionNo)}
        corners={<>
          {selected?.some((x) => x.tab === tab && x.no === s.collectionNo)
            && <Corner pos="tl" cls="bg-quick !text-night-950" label={t.selected}>✓</Corner>}
          {tab === 'support' && ownedSet.has(s.collectionNo)
            && <Corner pos="tr" cls="bg-gold-500 !text-night-950" label={tt.catalog.inRoster}>✓</Corner>}
        </>}
        sub={(o || parts.length > 0) && (
          <span className="flex flex-col items-center gap-0.5">
            {o && <span>lv {o.lv} · NP{o.npLv}<br />{o.skillLv.join('/')}</span>}
            {o && isDefaultOwned(o) && (
              <span title={tt.team.defaultsTitle} className="rounded bg-night-700 px-1 text-[9px] text-night-200">{tt.team.defaults}</span>
            )}
            {parts.length > 0 && (
              <span title={t.partialTitle(partsText)} className="rounded bg-amber-800/70 px-1 text-[9px] text-amber-100">{t.partial}</span>
            )}
          </span>
        )} />
    );
  };

  return (
    <Modal title={title} onClose={onClose}>
      {selected && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gold-500/30 bg-night-950/60 px-3 py-2 text-sm">
          <span className="text-night-200">{t.listHelp(selected.length)}</span>
          <button type="button" onClick={onClose} className="btn-primary ml-auto px-3 py-1 text-xs">{t.done}</button>
        </div>
      )}
      <div className="flex rounded bg-night-800 p-0.5 text-sm" role="tablist">
        {(['roster', 'support'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex-1 rounded px-3 py-1.5 ${tab === k ? 'bg-gold-600 text-night-950' : 'text-night-400 hover:text-night-200'}`}>
            {k === 'roster' ? t.tabRoster : t.tabSupport}
          </button>
        ))}
      </div>
      <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder={tt.catalog.searchPlaceholder} aria-label={tt.catalog.searchLabel}
        className="w-full rounded border border-night-700 bg-night-800 px-3 py-2 text-sm text-night-100 placeholder:text-night-500 focus:border-gold-500 focus:outline-none" />
      <div className="flex flex-wrap gap-1.5">
        {(['aoe', 'st', 'support'] as const).map((k) => (
          <Chip key={k} on={types.includes(k)} onClick={() => setTypes(toggle(types, k))}>{TYPE_LABEL[k]}</Chip>
        ))}
        <span className="mx-1 w-px self-stretch bg-night-700" />
        {classOpts.map((c) => (
          <Chip key={c} on={classes.includes(c)} onClick={() => setClasses(toggle(classes, c))}>{classLabel(c)}</Chip>
        ))}
      </div>
      {tab === 'support' && <p className="text-xs text-night-500">{((sup) => t.supportNote(sup.lv, sup.npLv, sup.skillLv.join('/'), sup.fou))(getSettings().support)}</p>}
      {recentShown.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-night-400">{t.recent}</p>
          <div className="flex gap-1 overflow-x-auto pb-1">{recentShown.map(tile)}</div>
        </div>
      )}
      <p className="text-xs text-night-500">{t.count(shown.length)}</p>
      {tab === 'roster' && owned.length === 0
        ? <p className="text-sm text-night-400">{t.emptyRoster}</p>
        : shown.length === 0
          ? <p className="text-sm text-night-400">{tt.catalog.noMatch}</p>
          : <div className="flex flex-wrap gap-1">{shown.map(tile)}</div>}
    </Modal>
  );
}
