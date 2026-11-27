import { useState } from 'react';
import { del } from 'idb-keyval';
import { useRegionData } from '../app/RegionData';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../app/settings';
import { IdbRosterStore } from '../roster/store';
import { useT } from '../i18n';
import { SYNC_ENABLED } from '../sync/api';
import { SyncPanel } from '../sync/SyncPanel';

const inp = 'w-24 rounded border border-gold-500/30 bg-night-950 px-2 py-1 text-sm text-night-50 focus:border-gold-400 focus:outline-none';

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-night-300">{label}
      <input type="number" className={inp} min={min} max={max} value={value}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isInteger(v)) onChange(Math.min(max, Math.max(min, v))); }} />
    </label>
  );
}

const Heading = ({ num, children }: { num: string; children: string }) => (
  <h2 className="flex items-baseline gap-3"><span className="panel-num" aria-hidden="true">{num}</span><span className="panel-title">{children}</span></h2>
);

export function SettingsPage() {
  const t = useT().settings;
  const tSync = useT().sync;
  const { region, data } = useRegionData();
  const [s, setS] = useState<Settings>(getSettings);
  const [note, setNote] = useState('');
  const update = (next: Settings) => { setS(saveSettings(next)); setNote(t.saved); };
  const sup = s.support;
  const setSup = (patch: Partial<Settings['support']>) => update({ ...s, support: { ...sup, ...patch } });

  const redownload = async () => {
    // Cached game data of every schema version, both regions (load.ts: data:v<SCHEMA>:<region>).
    for (let v = 1; v <= 10; v++) for (const r of ['NA', 'JP']) await del(`data:v${v}:${r}`);
    location.reload();
  };
  const clearRoster = async () => {
    if (!confirm(t.clearRosterConfirm(region))) return;
    const store = new IdbRosterStore();
    const doc = await store.load(region);
    await store.save({ ...doc, servants: [], ces: [], mcs: [], friends: [] });
    setNote(t.rosterCleared(region));
  };
  const built = data ? new Date(data.version.build ? Date.parse(data.version.build) : data.version.timestamp * 1000).toLocaleString() : '';

  return (
    <div className="space-y-4">
      <section className="panel space-y-3">
        <Heading num="I">{t.searchHeading}</Heading>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={s.maxTimeS === null} onChange={(e) => update({ ...s, maxTimeS: e.target.checked ? null : 20 })} />
          {t.autoTime}
        </label>
        {s.maxTimeS !== null && <Num label={t.maxTime} value={s.maxTimeS} min={1} max={600} onChange={(v) => update({ ...s, maxTimeS: v })} />}
      </section>

      <section className="panel space-y-3">
        <Heading num="II">{t.supportHeading}</Heading>
        <p className="text-xs text-night-300">{t.supportHelp}</p>
        <div className="flex flex-wrap gap-4">
          <Num label={t.level} value={sup.lv} min={1} max={120} onChange={(lv) => setSup({ lv })} />
          <Num label={t.npLevel} value={sup.npLv} min={1} max={5} onChange={(npLv) => setSup({ npLv })} />
          {[0, 1, 2].map((i) => (
            <Num key={i} label={t.skill(i + 1)} value={sup.skillLv[i]} min={1} max={10}
              onChange={(v) => setSup({ skillLv: sup.skillLv.map((x, j) => (j === i ? v : x)) as [number, number, number] })} />
          ))}
          <Num label={t.fou} value={sup.fou} min={0} max={2000} onChange={(fou) => setSup({ fou })} />
        </div>
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => update({ ...s, support: DEFAULT_SETTINGS.support })}>{t.reset}</button>
      </section>

      <section className="panel space-y-3">
        <Heading num="III">{t.dataHeading}</Heading>
        {data && <p className="text-sm text-night-200">{t.version(region, data.version.hash, built)}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void redownload()}>{t.redownload}</button>
          <button type="button" className="rounded-lg border border-red-500/50 px-3 py-1.5 text-sm text-red-300 hover:border-red-400"
            onClick={() => void clearRoster()}>{t.clearRoster(region)}</button>
        </div>
        <p className="text-xs text-night-400">{t.localNote}</p>
      </section>
      {SYNC_ENABLED && (
        <section className="panel space-y-3">
          <Heading num="IV">{tSync.heading}</Heading>
          <SyncPanel />
        </section>
      )}
      {note && <p role="status" className="text-sm text-gold-300">{note}</p>}
    </div>
  );
}
