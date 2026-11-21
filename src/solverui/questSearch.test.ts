import { describe, it, expect } from 'vitest';
import type { QuestEntry, QuestWar } from '../data/types';
import { lastPhase, questIndex, searchQuests } from './questSearch';
import { MAX_RECENT, pushRecent } from './questPrefs';

const q = (id: number, name: string, type: string, openedAt = 0, spot?: string): QuestEntry =>
  ({ id, name, type, phases: [1, 2, 3], openedAt, closedAt: 0, ...(spot && { spot }) });
const WARS: QuestWar[] = [
  { warId: 100, warName: 'Fuyuki', eventId: 0, quests: [q(1, 'Burning City', 'free', 10, 'Bridge')] },
  { warId: 9001, warName: 'Summer Event 2020', eventId: 1, quests: [q(2, 'Beach Party', 'event', 500), q(3, 'Ocean Free Quest', 'free', 500)] },
  { warId: 9002, warName: 'Halloween Rising', eventId: 2, quests: [q(4, 'Pumpkin Patch', 'event', 900)] },
  { warId: 9000, warName: 'Old Event', eventId: 3, quests: [q(5, 'Old Beach', 'event', 100)] },
];
const ids = (query: string, limit?: number) => searchQuests(questIndex(WARS), query, limit).map((x) => x.quest.id);

describe('questIndex', () => {
  it('free first, then events newest war first', () => {
    expect(questIndex(WARS).map((x) => x.quest.id)).toEqual([1, 3, 4, 2, 5]);
  });
});

describe('searchQuests', () => {
  it('matches quest name, war name and spot name', () => {
    expect(ids('burning')).toEqual([1]);
    expect(ids('halloween')).toEqual([4]);
    expect(ids('bridge')).toEqual([1]);
  });
  it('case/accent-insensitive, multi-word AND, partial words', () => {
    expect(ids('BEACH')).toEqual([2, 5]);
    expect(ids('béach summ')).toEqual([2]);
    expect(ids('summer ocean')).toEqual([3]);
    expect(ids('beach halloween')).toEqual([]);
  });
  it('blank query → nothing; limit caps the list', () => {
    expect(ids('  ')).toEqual([]);
    expect(ids('e', 2)).toHaveLength(2);
  });
  it('lastPhase picks the last phase', () => {
    expect(lastPhase(q(1, 'x', 'free'))).toBe(3);
    expect(lastPhase({ ...q(1, 'x', 'free'), phases: [] })).toBeNull();
  });
});

describe('pushRecent', () => {
  it('moves the quest to the front, dedupes by id, keeps at most 8', () => {
    const list = Array.from({ length: 8 }, (_, i) => ({ id: i, phase: 1 }));
    const next = pushRecent(list, { id: 3, phase: 2 });
    expect(next[0]).toEqual({ id: 3, phase: 2 });
    expect(next.filter((x) => x.id === 3)).toHaveLength(1);
    expect(pushRecent(list, { id: 99, phase: 1 })).toHaveLength(MAX_RECENT);
    expect(pushRecent(list, { id: 99, phase: 1 }).map((x) => x.id)).not.toContain(7);
  });
});
