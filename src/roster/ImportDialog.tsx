import { diffServants } from './diff';
import type { RosterDoc } from './types';

interface Props {
  current: RosterDoc;
  next: RosterDoc;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportDialog({ current, next, onConfirm, onCancel }: Props) {
  const d = diffServants(current, next);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold">Importa roster</h2>
        <p className="mb-3 text-sm text-zinc-400">
          Il roster attuale ({current.servants.length} servant) verrà sostituito da quello importato
          ({next.servants.length} servant).
        </p>
        <ul className="mb-5 space-y-1 text-sm">
          <li><span className="text-emerald-400">{d.added}</span> aggiunti</li>
          <li><span className="text-amber-400">{d.changed}</span> modificati</li>
          <li><span className="text-red-400">{d.removed}</span> rimossi</li>
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">Annulla</button>
          <button onClick={onConfirm} className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500">Conferma</button>
        </div>
      </div>
    </div>
  );
}
