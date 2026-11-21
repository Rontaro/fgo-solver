import { Fragment } from 'react';
import { FaceIcon } from '../app/ServantIcon';
import type { TeamMember } from '../engine/state';
import type { TurnItem } from './members';

type Lookup = (key: string | undefined) => TeamMember | undefined;
/** Enemy name in a field slot at the start of turn t's wave, when known. */
type EnemyAt = (turn: number, slot: number) => string | undefined;

const badge = 'absolute -bottom-1 -right-1 rounded bg-zinc-950/90 px-1 text-[10px] font-bold leading-4 ring-1';

function Unit({ m, size = 40, label, tone = 'text-sky-300 ring-sky-700' }: { m: TeamMember | undefined; size?: number; label?: string; tone?: string }) {
  const name = m?.svt.name ?? '?';
  return (
    <span className="relative inline-block shrink-0">
      <FaceIcon face={m?.svt.face} name={name} size={size} />
      {label && <span className={`${badge} ${tone}`}>{label}</span>}
    </span>
  );
}

const Arrow = ({ children = '→' }: { children?: string }) => <span aria-hidden className="text-zinc-500">{children}</span>;

function Item({ it, unit, enemy }: { it: TurnItem; unit: Lookup; enemy: (slot: number) => string | undefined }) {
  if (it.kind === 'target') {
    const name = enemy(it.slot);
    const text = name ? `bersaglio: nemico ${it.slot + 1} · ${name}` : `bersaglio: posizione ${it.slot + 1}`;
    return (
      <span title={`Bersaglio del turno (posizione ${it.slot + 1} in campo)`}
        className="inline-flex h-6 max-w-48 items-center truncate rounded-full bg-red-950/60 px-2 text-[11px] text-red-200 ring-1 ring-red-800">
        {text}
      </span>
    );
  }
  if (it.kind === 'skill') {
    const target = unit(it.target);
    const label = `${unit(it.unit)?.svt.name ?? '?'} skill ${it.num}${it.target ? ` su ${target?.svt.name ?? '?'}` : ''}`;
    return (
      <span className="flex items-center gap-1" title={label}>
        <Unit m={unit(it.unit)} label={`S${it.num}`} />
        {it.target && <><Arrow /><Unit m={target} size={28} /></>}
      </span>
    );
  }
  if (it.kind === 'mc') {
    const target = unit(it.target);
    return (
      <span className="flex items-center gap-1" title={`${it.name ?? 'Mystic Code'} (skill MC ${it.num})${it.target ? ` su ${target?.svt.name ?? '?'}` : ''}`}>
        <span className="inline-flex h-10 items-center rounded-md bg-violet-900/60 px-2 text-xs font-bold text-violet-200 ring-1 ring-violet-700">MC {it.num}</span>
        {it.target && <><Arrow /><Unit m={target} size={28} /></>}
      </span>
    );
  }
  if (it.kind === 'swap') {
    return (
      <span className="flex items-center gap-1" title={`Order change: ${unit(it.out)?.svt.name ?? '?'} ⇄ ${unit(it.inn)?.svt.name ?? '?'}`}>
        <Unit m={unit(it.out)} /><Arrow>⇄</Arrow><Unit m={unit(it.inn)} />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1" title={`NP ${unit(it.unit)?.svt.name ?? '?'}`}>
      <Unit m={unit(it.unit)} label="NP" tone="text-amber-300 ring-amber-700" />
    </span>
  );
}

/** One row of icon steps per turn. */
export function TurnSteps({ turns, unit, enemyAt }: { turns: TurnItem[][]; unit: Lookup; enemyAt?: EnemyAt }) {
  return (
    <ol className="space-y-2">
      {turns.map((items, t) => (
        <li key={t} className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className="w-6 text-xs font-semibold text-zinc-400">T{t + 1}</span>
          {items.map((it, j) => (
            <Fragment key={j}>
              {j > 0 && items[j - 1].kind !== 'target' && <span aria-hidden className="text-zinc-700">·</span>}
              <Item it={it} unit={unit} enemy={(slot) => enemyAt?.(t, slot)} />
            </Fragment>
          ))}
        </li>
      ))}
    </ol>
  );
}

/**
 * Per-wave margin (damage dealt / wave HP, min over enemies; 1 = exact kill).
 * The bar fills with the overkill, full at +100%.
 */
export function MarginBars({ margins }: { margins: number[] }) {
  return (
    <div className="flex flex-wrap gap-3" aria-label="Margini per wave">
      {margins.map((m, i) => {
        const pct = Math.round(m * 100);
        const fill = Math.max(0.04, Math.min(1, m - 1));
        return (
          <span key={i} className="flex items-center gap-1 text-[11px] text-zinc-400" title={`Wave ${i + 1}: danno ${pct}% degli HP`}>
            W{i + 1}
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-700" role="meter" aria-valuemin={0} aria-valuemax={200}
              aria-valuenow={pct} aria-label={`Margine wave ${i + 1}`}>
              <span className="block h-full rounded-full bg-sky-500" style={{ width: `${fill * 100}%` }} />
            </span>
            <span className="tabular-nums">{pct}%</span>
          </span>
        );
      })}
    </div>
  );
}
