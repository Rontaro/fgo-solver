import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegionData } from '../app/RegionData';
import type { CompactMC } from '../data/types';
import type { TeamMember } from '../engine/state';
import { IdbRosterStore } from '../roster/store';
import type { OwnedServant } from '../roster/types';
import { compareSolutions, type Partial, type Solution, type SolveStats } from '../solver/solve';
import type { Slot } from '../solver/autocomplete';
import type { InMsg, OutMsg, Progress } from '../solver/worker-handler';
import { defaultMc, describeTurns, formatTurns, ownedToMember, slotEnemyNames, supportMember, SUPPORT_POOL_CAP, type CeChoice } from './members';
import { QuestPicker, type PickedQuest } from './QuestPicker';
import { emptySlot, TeamBuilder, type SlotState } from './TeamBuilder';
import { defaultMaxS, noSolutionKind } from './picker';
import { MarginBars, TurnSteps } from './TurnSteps';
import { FaceIcon } from '../app/ServantIcon';
import { toFgaCommand } from '../fga/command';
import { toFgaConfig } from '../fga/config';
import { useT } from '../i18n';

const store = new IdbRosterStore();
const MC_LV = 10;
const MAX_SHOWN = 50;
const FGA = import.meta.env.VITE_ENABLE_FGA !== 'false';

interface Found { solution: Solution; team?: string[] }
interface Run { kind: 'team' | 'autocomplete'; front: string[]; back: string[]; mc: CompactMC; quest: string; slotNames: (string | undefined)[][] }

export function SolverPage() {
  const { region, data } = useRegionData();
  const tt = useT();
  const t = tt.solver;
  const [owned, setOwned] = useState<OwnedServant[]>([]);
  const [quest, setQuest] = useState<PickedQuest | null>(null);
  const [slots, setSlots] = useState<SlotState[]>(() => Array.from({ length: 6 }, emptySlot));
  const [mcId, setMcId] = useState<number | null>(null);
  // null = the default for the run kind (autocomplete gets more time).
  const [maxSOverride, setMaxS] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const [stats, setStats] = useState<Progress | SolveStats | null>(null);
  const [best, setBest] = useState<Partial | null | undefined>(undefined);
  const [exhausted, setExhausted] = useState<boolean | null>(null);
  const [stoppedByUser, setStoppedByUser] = useState(false);
  const [error, setError] = useState<{ message: string; reasons?: readonly string[] } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [showText, setShowText] = useState(false);
  const worker = useRef<Worker | null>(null);
  const jobId = useRef(0);
  const members = useRef(new Map<string, TeamMember>());

  useEffect(() => {
    let alive = true;
    store.load(region).then((d) => { if (alive) setOwned(d.servants); });
    return () => { alive = false; };
  }, [region]);
  useEffect(() => { if (data && mcId === null) setMcId(defaultMc(data.mcs)?.id ?? null); }, [data, mcId]);
  useEffect(() => () => worker.current?.terminate(), []);

  const sorted = useMemo(() => [...found].sort((a, b) => compareSolutions(a.solution, b.solution)).slice(0, MAX_SHOWN), [found]);
  if (!data) return null;
  const mc = data.mcs.find((m) => m.id === mcId);

  const ceOf = (s: SlotState): CeChoice => ({ ce: s.ceNo === null ? null : data.ces.find((c) => c.collectionNo === s.ceNo) ?? null, lv: s.ceLv, mlb: s.ceMlb });
  const memberOf = (s: SlotState, i: number): TeamMember | null => {
    const svt = s.collectionNo !== null ? data.servants.get(s.collectionNo) : undefined;
    if (!svt) return null;
    if (s.kind === 'support') return supportMember(svt, `s${i}`, ceOf(s));
    const o = owned.find((x) => x.collectionNo === s.collectionNo);
    return s.kind === 'roster' && o ? ownedToMember(o, svt, `r${svt.collectionNo}`, ceOf(s)) : null;
  };

  const locked = slots.map(memberOf);
  const keys = locked.flatMap((m) => (m ? [m.key] : []));
  const isAuto = slots.some((s) => s.kind === 'free' || s.kind === 'supportAuto');
  const maxS = maxSOverride ?? defaultMaxS(isAuto);
  const problem = !quest ? t.noQuest
    : quest.unsupported ? t.unsupportedNode
    : !mc ? t.noMc
    : new Set(keys).size !== keys.length ? t.dupServant
    : slots.some((s, i) => (s.kind === 'roster' || s.kind === 'support') && !locked[i]) ? t.incomplete
    : !isAuto && keys.length === 0 ? t.emptyTeam
    : null;

  const name = (k: string | undefined) => (k ? members.current.get(k)?.svt.name ?? k : '?');
  const unit = (k: string | undefined) => (k ? members.current.get(k) : undefined);

  const start = () => {
    if (problem || !quest || !mc) return;
    worker.current?.terminate();
    const w = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const id = ++jobId.current;
    const map = new Map<string, TeamMember>();
    const add = (m: TeamMember) => { map.set(m.key, m); return m; };
    const team = locked.flatMap((m) => (m ? [add(m)] : []));
    const common = { mc, mcLv: MC_LV, constants: data.constants, rawQuest: quest.raw, maxMs: maxS * 1000 };
    let msg: InMsg;
    if (isAuto) {
      const ok = (cn: number) => data.servants.get(cn)?.unsupported.length === 0;
      const roster = owned.filter((o) => ok(o.collectionNo)).map((o) => add(ownedToMember(o, data.servants.get(o.collectionNo)!, `r${o.collectionNo}`)));
      const supportPool = [...data.servants.values()].filter((s) => s.unsupported.length === 0).slice(0, SUPPORT_POOL_CAP)
        .map((s) => add(supportMember(s, `p${s.collectionNo}`)));
      const acSlots: Slot[] = slots.flatMap((s, i): Slot[] => (locked[i] ? [{ locked: locked[i]! }]
        : s.kind === 'free' ? [{ free: true }] : s.kind === 'supportAuto' ? [{ support: true }] : []));
      msg = { type: 'solve', id, payload: { ...common, kind: 'autocomplete', slots: acSlots, roster, supportPool,
        maxPerTeam: Math.max(1000, Math.min(5000, common.maxMs / 10)) } };
    } else {
      msg = { type: 'solve', id, payload: { ...common, kind: 'team', team } };
    }
    members.current = map;
    const k = team.map((m) => m.key);
    setRun({ kind: isAuto ? 'autocomplete' : 'team', front: k.slice(0, 3), back: k.slice(3), mc, quest: quest.label, slotNames: slotEnemyNames(quest.raw) });
    setFound([]); setStats(null); setBest(undefined); setExhausted(null); setStoppedByUser(false); setError(null); setRunning(true);

    w.onmessage = (e: MessageEvent<OutMsg>) => {
      const m = e.data;
      if (m.id !== jobId.current) return;
      if (m.type === 'solution') setFound((f) => [...f, { solution: m.solution, team: m.team }]);
      else if (m.type === 'progress') setStats(m.stats);
      else if (m.type === 'done') {
        if ('best' in m.result) { setBest(m.result.best); setStats(m.result.stats); }
        else setStats((s) => ({ triedTeams: (m.result as { triedTeams: number }).triedTeams, solutions: s && 'solutions' in s ? s.solutions : 0, ms: s?.ms ?? 0 }));
        setExhausted(m.result.exhausted); setRunning(false); w.terminate();
      } else if (m.type === 'error') { setError({ message: m.message, reasons: m.reasons }); setRunning(false); w.terminate(); }
    };
    w.onerror = (e) => { setError({ message: e.message || t.workerError }); setRunning(false); };
    w.postMessage(msg);
  };

  const fgaTeam = (keys: string[]) => keys.flatMap((k) => { const m = members.current.get(k); return m ? [m] : []; });
  const downloadFga = (f: Found, keys: string[], n: number) => {
    if (!run) return;
    const team = fgaTeam(keys);
    // Support keys: s<slot> (locked support slot) or p<collectionNo> (autocomplete pool).
    const sup = team.find((m) => /^[sp]\d/.test(m.key));
    const json = toFgaConfig(f.solution, team, run.quest,
      sup ? { collectionNo: sup.svt.collectionNo, ceCollectionNo: sup.ce?.collectionNo, ceMlb: sup.ceMlb } : null);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `3T-${run.quest.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_')}-${n}.fga`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copyFga = (f: Found, keys: string[]) => {
    void navigator.clipboard?.writeText(toFgaCommand(f.solution, fgaTeam(keys)));
  };

  const stop = () => {
    const w = worker.current;
    if (!w) return;
    setStoppedByUser(true);
    w.postMessage({ type: 'cancel', id: jobId.current } satisfies InMsg);
    const id = jobId.current;
    setTimeout(() => {
      if (worker.current === w && jobId.current === id) { w.terminate(); setRunning((r) => { if (r) setExhausted(false); return false; }); }
    }, 1000);
  };

  return (
    <div className="space-y-4">
      <QuestPicker region={region} wars={data.quests} onChange={setQuest} />
      <TeamBuilder slots={slots} setSlots={setSlots} servants={data.servants} ces={data.ces} mcs={data.mcs} owned={owned}
        mcId={mcId} setMcId={setMcId} maxS={maxS} setMaxS={setMaxS} isAuto={isAuto} defaultMaxS={defaultMaxS(isAuto)} />
      <section className={`panel space-y-4 ${sorted.length > 0 ? 'border-gold-500 shadow-[0_0_40px_rgba(217,184,108,0.12)]' : ''}`}>
        <h2 className="flex items-baseline gap-3"><span className="panel-num" aria-hidden="true">III</span><span className="panel-title">{t.heading}</span></h2>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={start} disabled={running || !!problem} className="btn-primary min-h-11 px-8 font-display text-base font-bold tracking-widest">{t.start}</button>
          <button onClick={stop} disabled={!running} className="btn-ghost min-h-11 disabled:opacity-40">{t.stop}</button>
          {problem && <span className="text-sm text-night-400">{problem}</span>}
          {running && <span className="text-sm text-gold-400">{t.running}</span>}
        </div>
        {stats && (
          <p className="text-xs text-night-400">
            {(stats.ms / 1000).toFixed(1)} s
            {'nodes' in stats ? t.statsNodes(stats.nodes.toLocaleString(tt.locale), stats.memoHits.toLocaleString(tt.locale))
              : t.statsTeams(stats.triedTeams)}
            {t.statsSolutions(found.length)}
            {exhausted !== null && (exhausted ? t.exhausted : t.interrupted)}
          </p>
        )}
        {error && (
          <div className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            <p>{error.reasons ? t.unsupportedQuest : t.error(error.message)}</p>
            {error.reasons && <ul className="list-disc pl-5">{error.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          </div>
        )}
        {!running && run && found.length === 0 && !error && (
          <p className="text-sm text-amber-300">
            {{ none: t.noSolution, timeLimit: t.noSolutionTimeLimit, stopped: t.noSolutionStopped }[noSolutionKind(exhausted, stoppedByUser)]}{' '}
            {best ? (best.missingDamagePct !== undefined
              ? t.missingDamage(best.wave, (best.missingDamagePct * 100).toFixed(1))
              : t.npNotCharged(best.wave)) : ''}
          </p>
        )}
        {run && sorted.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-night-400">
            <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> {t.showText}
          </label>
        )}
        {run && sorted.map((f, i) => {
          const tk = f.team ?? [...run.front, ...run.back];
          const front = f.team ? tk.slice(0, 3) : run.front, back = f.team ? tk.slice(3) : run.back;
          return (
            <div key={i} className="space-y-3 rounded-lg border border-gold-500/25 bg-night-950/60 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-night-400">
                <span>{t.actions(f.solution.actions)}{f.solution.usesSwap ? t.orderChange : ''}</span>
                <MarginBars margins={f.solution.margins} />
              </div>
              {f.team && (
                <div className="flex flex-wrap items-center gap-1.5 text-gold-300">
                  <span className="text-xs uppercase tracking-wider">{t.team}</span>
                  {f.team.map((k) => <FaceIcon key={k} face={unit(k)?.svt.face} name={name(k)} size={28} />)}
                </div>
              )}
              <TurnSteps turns={describeTurns(f.solution.turns, front, back, run.mc)} unit={unit}
                enemyAt={(t, slot) => run.slotNames[t]?.[slot]} />
              {showText && (
                <div className="border-t border-night-700 pt-1 text-xs text-night-300">
                  {formatTurns(f.solution.turns, front, back, name, run.mc, tt.turns).map((l, j) => <p key={j}>{l}</p>)}
                </div>
              )}
              {FGA && (
                <div className="pt-1">
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => downloadFga(f, tk, i + 1)} className="rounded-md border border-gold-500/40 px-2.5 py-1 text-xs text-gold-300 hover:border-gold-400">{t.downloadFga}</button>
                    <button onClick={() => copyFga(f, tk)} className="rounded-md border border-gold-500/40 px-2.5 py-1 text-xs text-gold-300 hover:border-gold-400">{t.copyCommand}</button>
                  </div>
                  <p className="mt-1 text-xs text-night-500">{t.fgaWarning}</p>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
