import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../i18n';

/** Picker dialog: full screen on phones, a centred panel from sm up. Esc and the backdrop close it. */
export function Modal({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const t = useT();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-night-900 sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-lg sm:border sm:border-night-700">
        <div className="flex items-center justify-between gap-2 border-b border-night-800 px-4 py-3">
          <h2 className="min-w-0 truncate font-semibold text-night-100">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.close}
            className="rounded px-2 py-1 text-night-400 hover:bg-night-800 hover:text-night-100">✕</button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t border-night-800 p-3">{footer}</div>}
      </div>
    </div>
  );
}
