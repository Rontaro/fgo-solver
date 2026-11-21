import { matchesAll, normalize, queryWords } from '../data/search';
import type { QuestEntry, QuestWar } from '../data/types';

export interface QuestItem { quest: QuestEntry; war: QuestWar; hay: string }

const newest = (w: QuestWar) => Math.max(0, ...w.quests.map((q) => q.openedAt));

/**
 * Every quest of every war, in display order: free quests first (data order),
 * then event quests with the newest war first.
 */
export function questIndex(wars: readonly QuestWar[]): QuestItem[] {
  const free: QuestItem[] = [], events: { item: QuestItem; at: number }[] = [];
  for (const war of wars) {
    const at = newest(war);
    for (const quest of war.quests) {
      const item = { quest, war, hay: normalize([quest.name, war.warName, quest.spot ?? ''].join(' | ')) };
      if (quest.type === 'free') free.push(item); else events.push({ item, at });
    }
  }
  events.sort((a, b) => b.at - a.at || b.item.war.warId - a.item.war.warId);
  return [...free, ...events.map((e) => e.item)];
}

/** Quests whose name, war or spot contain every query word (accents/case ignored). */
export function searchQuests(index: readonly QuestItem[], query: string, limit = 30): QuestItem[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const out: QuestItem[] = [];
  for (const it of index) {
    if (!matchesAll(words, it.hay)) continue;
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

/** Default phase for a quest: the last one. */
export const lastPhase = (q: QuestEntry): number | null => q.phases[q.phases.length - 1] ?? null;
