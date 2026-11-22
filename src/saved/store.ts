/**
 * Saved teams and saved results, per region, in IndexedDB (idb-keyval), like
 * the roster. Results keep everything needed to show them again without the
 * solver: the node, the members with their stats, the steps, and the data
 * version they were found with (see verifyResult in ./verify).
 */
import { get, set } from 'idb-keyval';
import type { Region } from '../data/types';
import type { Step } from '../solver/solve';
import type { SlotState } from '../solverui/TeamBuilder';

export interface SavedTeam {
  id: string; name: string; createdAt: string;
  slots: SlotState[]; mcId: number | null;
}

/** A team member as it was when the result was saved (TeamMember without the data objects). */
export interface SavedMember {
  key: string; collectionNo: number; lv: number; npLv: number; skillLv: [number, number, number];
  append2Lv: number; fou: number; ceNo: number | null; ceLv: number; ceMlb: boolean;
  /** A friend support (else from the roster). */
  support: boolean;
  /** Starting form of a servant with forms (data/forms.ts). */
  form?: 'low' | 'high';
}

export interface SavedQuest { id: number; phase: number; label: string; eventId: number }

export interface SavedResult {
  id: string; createdAt: string; name: string;
  quest: SavedQuest;
  members: SavedMember[];
  /** Member keys on the front / back line at battle start. */
  front: string[]; back: string[];
  mcId: number;
  /** 'solution': a 3T; 'closest': the closest line when there was none (missingPct = HP left). */
  kind: 'solution' | 'closest';
  turns: Step[][];
  margins?: number[]; missingPct?: number;
  actions: number; usesSwap: boolean;
  /** Game data the result was found with (DataVersion hash + build). */
  dataVersion: string;
}

const teamsKey = (r: Region) => `saved:teams:${r}`;
const resultsKey = (r: Region) => `saved:results:${r}`;

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function loadTeams(r: Region): Promise<SavedTeam[]> { return (await get<SavedTeam[]>(teamsKey(r))) ?? []; }
export async function saveTeams(r: Region, teams: SavedTeam[]): Promise<void> { await set(teamsKey(r), teams); }
export async function loadResults(r: Region): Promise<SavedResult[]> { return (await get<SavedResult[]>(resultsKey(r))) ?? []; }
export async function saveResults(r: Region, results: SavedResult[]): Promise<void> { await set(resultsKey(r), results); }

export async function addTeam(r: Region, t: Omit<SavedTeam, 'id' | 'createdAt'>): Promise<SavedTeam> {
  const team: SavedTeam = { ...t, id: newId(), createdAt: new Date().toISOString() };
  await saveTeams(r, [team, ...(await loadTeams(r))]);
  return team;
}
export async function addResult(r: Region, x: Omit<SavedResult, 'id' | 'createdAt'>): Promise<SavedResult> {
  const result: SavedResult = { ...x, id: newId(), createdAt: new Date().toISOString() };
  await saveResults(r, [result, ...(await loadResults(r))]);
  return result;
}
