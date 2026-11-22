import { useEffect, useState } from 'react';

/** The top-level pages. Anything unknown falls back to the landing page. */
export type Page = 'landing' | 'app' | 'about';

export const PATHS: Record<Page, string> = { landing: '/', app: '/app', about: '/about' };

/** Maps a location pathname to its page: `/app` and `/app/...` are the app, `/about` is About, the rest is Landing. */
export function pageFor(pathname: string): Page {
  const p = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  if (p === '/app' || p.startsWith('/app/')) return 'app';
  if (p === '/about') return 'about';
  return 'landing';
}

const EVENT = 'fgo-solver:navigate';

/** Goes to an in-app path without a reload. */
export function navigate(path: string) {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

/** The current page, kept in sync with pushState navigation and back/forward. */
export function usePage(): Page {
  const [page, setPage] = useState<Page>(() => pageFor(window.location.pathname));
  useEffect(() => {
    const sync = () => setPage(pageFor(window.location.pathname));
    window.addEventListener('popstate', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return page;
}
