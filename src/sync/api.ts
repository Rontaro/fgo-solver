/**
 * Personal sync with rontaro-workers (api.rontaro.com/api/fgo): roster,
 * saved teams and saved results, one JSON document per region and kind. Off
 * unless VITE_ENABLE_SYNC=true (personal build only: the public site never
 * shows it). The session token (an 8-hour admin JWT) is kept in localStorage.
 */
import type { Region } from '../data/types';

export const SYNC_ENABLED = import.meta.env.VITE_ENABLE_SYNC === 'true';
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://api.rontaro.com';
const KEY = 'fgo-solver:sync';

export type SyncKind = 'roster' | 'teams' | 'results';
export interface SyncSession { token: string; username: string }
export type ServerDocs = Partial<Record<SyncKind, { data: unknown; updatedAt: string }>>;

export class SyncAuthError extends Error {}

export function getSession(): SyncSession | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) as SyncSession : null; } catch { return null; }
}
export function clearSession(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...init.headers },
  });
  if (res.status === 401 || res.status === 403) { if (token) clearSession(); throw new SyncAuthError(`HTTP ${res.status}`); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function login(username: string, password: string): Promise<SyncSession> {
  const r = await call<{ token: string; username: string }>('/api/auth/fgo', { method: 'POST', body: JSON.stringify({ username, password }) });
  const s = { token: r.token, username: r.username };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: session for this page only */ }
  return s;
}

export const fetchAll = (s: SyncSession, region: Region) => call<ServerDocs>(`/api/fgo/sync/${region}`, {}, s.token);

export const putDoc = (s: SyncSession, region: Region, kind: SyncKind, data: unknown) =>
  call<{ ok: true; updatedAt: string }>(`/api/fgo/sync/${region}/${kind}`, { method: 'PUT', body: JSON.stringify({ data }) }, s.token);
