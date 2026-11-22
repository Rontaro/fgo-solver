import { Fragment } from 'react';
import { FaceIcon } from '../app/ServantIcon';
import type { TeamMember } from '../engine/state';
import type { TurnItem } from './members';
import { useT } from '../i18n';

type Lookup = (key: string | undefined) => TeamMember | undefined;
/** Enemy name in a field slot at the start of turn t's wave, when known. */
type EnemyAt = (turn: number, slot: number) => string | undefined;

const badge = 'absolute -bottom-1 -right-1 rounded bg-night-950/90 px-1 text-[10px] font-bold leading-4 ring-1';

function Unit({ m, size = 40, label, tone = 'text-gold-300 ring-gold-700' }: { m: TeamMember | undefined; size?: number; label?: string; tone?: string }) {
  const name = m?.svt.name ?? '?';
  return (
    <span className="relative inline-block shrink-0">
      <FaceIcon face={m?.svt.face} name={name} size={size} />
      {label && <span className={`${badge} ${tone}`}>{label}</span>}
    </span>
  );
}

// NP step: a ring and glow in the colour of the NP's command card.
const NP_GLOW: Record<string, string> = {
  arts: 'ring-arts/70 shadow-[0_0_14px_rgba(79,140,255,0.45)]',
  buster: 'ring-buster/70 shadow-[0_0_14px_rgba(255,90,90,0.45)]',
  quick: 'ring-quick/70 shadow-[0_0_14px_rgba(63,209,122,0.45)]',
};

const Arrow = ({ children = '→' }: { children?: string }) => <span aria-hidden className="text-night-500">{children}</span>;

function Item({ it, unit, enemy }: { it: TurnItem; unit: Lookup; enemy: (slot: number) => string | undefined }) {
  const t = useT().turns;
  if (it.kind === 'target') {
    const name = enemy(it.slot);
    const text = name ? t.targetNamed(it.slot + 1, name) : t.targetPos(it.slot + 1);
    return (
      <span title={t.targetTitle(it.slot + 1)}
        className="inline-flex h-6 max-w-48 items-center truncate rounded-full bg-red-950/60 px-2 text-[11px] text-red-200 ring-1 ring-red-800">
        {text}
      </span>
    );
  }
  if (it.kind === 'skill') {
    const target = unit(it.target);
    const label = t.skill(unit(it.unit)?.svt.name ?? '?', it.num) + (it.target ? t.on(target?.svt.name ?? '?') : '');
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
      <span className="flex items-center gap-1" title={t.mc(it.name ?? 'Mystic Code', it.num) + (it.target ? t.on(target?.svt.name ?? '?') : '')}>
        <span className="inline-flex h-10 items-center rounded-md bg-violet-900/60 px-2 text-xs font-bold text-violet-200 ring-1 ring-violet-700">MC {it.num}</span>
        {it.target && <><Arrow /><Unit m={target} size={28} /></>}
      </span>
    );
  }
  if (it.kind === 'swap') {
    return (
      <span className="flex items-center gap-1" title={`${t.orderChange}: ${unit(it.out)?.svt.name ?? '?'} ⇄ ${unit(it.inn)?.svt.name ?? '?'}`}>
        <Unit m={unit(it.out)} /><Arrow>⇄</Arrow><Unit m={unit(it.inn)} />
      </span>
    );
  }
  return (
    <span className={`flex items-center gap-1 rounded-lg p-0.5 ring-1 ${NP_GLOW[unit(it.unit)?.svt.np?.card ?? 'buster']}`} title={`NP ${unit(it.unit)?.svt.name ?? '?'}`}>
      <Unit m={unit(it.unit)} label="NP" tone="text-gold-200 ring-gold-600" />
    </span>
  );
}

/** One row of icon steps per turn. */
export function TurnSteps({ turns, unit, enemyAt }: { turns: TurnItem[][]; unit: Lookup; enemyAt?: EnemyAt }) {
  return (
    <ol className="space-y-2">
      {turns.map((items, t) => (
        <li key={t} className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-gold-500/15 bg-night-900/70 px-3 py-2.5">
          <span className="w-8 font-display text-base font-bold text-gold-300">T{t + 1}</span>
          {items.map((it, j) => (
            <Fragment key={j}>
              {j > 0 && items[j - 1].kind !== 'target' && <span aria-hidden className="text-night-700">·</span>}
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
  const t = useT().turns;
  return (
    <div className="flex flex-wrap gap-3" aria-label={t.margins}>
      {margins.map((m, i) => {
        const pct = Math.round(m * 100);
        const fill = Math.max(0.04, Math.min(1, m - 1));
        return (
          <span key={i} className="flex items-center gap-1 text-[11px] text-night-400" title={t.marginTitle(i + 1, pct)}>
            W{i + 1}
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-night-700" role="meter" aria-valuemin={0} aria-valuemax={200}
              aria-valuenow={pct} aria-label={t.marginLabel(i + 1)}>
              <span className="block h-full rounded-full bg-gold-500" style={{ width: `${fill * 100}%` }} />
            </span>
            <span className="tabular-nums">{pct}%</span>
          </span>
        );
      })}
    </div>
  );
}
