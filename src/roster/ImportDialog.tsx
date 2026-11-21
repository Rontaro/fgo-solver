import { useT } from '../i18n';
import { diffServants } from './diff';
import type { RosterDoc } from './types';

interface Props {
  current: RosterDoc;
  next: RosterDoc;
  onConfirm: () => void;
  onCancel: () => void;
  warnings?: string[];
}

const WARN_OPEN_MAX = 5;

function Warnings({ items }: { items: string[] }) {
  const list = (
    <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-amber-200/90">
      {items.map((w, i) => <li key={i}>{w}</li>)}
    </ul>
  );
  const title = useT().importDialog.warnings(items.length);
  return (
    <div className="mb-4 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
      {items.length > WARN_OPEN_MAX
        ? <details><summary className="cursor-pointer">{title}</summary>{list}</details>
        : <>{title}{list}</>}
    </div>
  );
}

export function ImportDialog({ current, next, onConfirm, onCancel, warnings }: Props) {
  const d = diffServants(current, next);
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold">{t.importDialog.title}</h2>
        <p className="mb-3 text-sm text-zinc-400">
          {t.importDialog.replace(current.servants.length, next.servants.length)}
        </p>
        <ul className="mb-5 space-y-1 text-sm">
          <li><span className="text-emerald-400">{d.added}</span> {t.importDialog.added}</li>
          <li><span className="text-amber-400">{d.changed}</span> {t.importDialog.changed}</li>
          <li><span className="text-red-400">{d.removed}</span> {t.importDialog.removed}</li>
        </ul>
        {warnings && warnings.length > 0 && <Warnings items={warnings} />}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">{t.common.cancel}</button>
          <button onClick={onConfirm} className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500">{t.common.confirm}</button>
        </div>
      </div>
    </div>
  );
}
