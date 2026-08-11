import { describe, expect, it } from 'vitest';
import { aggregateJournalPeriods, buildRecentMoodTrend, calculateJournalStats } from '../src/journal-stats';
import type { JournalEntry } from '../src/types';

function entry(date: string, score?: -2 | -1 | 0 | 1 | 2): JournalEntry {
  return {
    path: `${date}.md`, date, title: date, excerpt: '', sourceId: 'daily', sourcePath: 'Calendar/Daily',
    sourceType: 'daily', favorite: false, attachments: [],
    mood: score === undefined ? undefined : { score, labels: ['calm'], recordedAt: date, updatedAt: date },
    frontmatter: {},
  };
}

describe('journal stats', () => {
  it('calculates current and longest streaks and mood distribution', () => {
    const stats = calculateJournalStats([
      entry('2026-07-15', 1), entry('2026-07-16', 2), entry('2026-07-18', -1),
    ], new Date(2026, 6, 18, 12));
    expect(stats.currentStreak).toBe(1);
    expect(stats.longestStreak).toBe(2);
    expect(stats.moodDistribution).toEqual({ '1': 1, '2': 1, '-1': 1 });
    expect(stats.labelCounts.calm).toBe(3);
    expect(stats.monthly[0]).toMatchObject({ key: '2026-07', entries: 3, recordedDays: 3 });
    expect(stats.quarterly[0]).toMatchObject({ key: '2026-Q3', entries: 3 });
    expect(stats.yearly[0]).toMatchObject({ key: '2026', entries: 3 });
  });

  it('aggregates duplicate entries by unique recorded day and mood average', () => {
    expect(aggregateJournalPeriods([entry('2026-01-01', 2), entry('2026-01-01', 0)], 'quarter')).toEqual([
      { key: '2026-Q1', entries: 2, recordedDays: 1, favoriteCount: 0, moodAverage: 1 },
    ]);
  });

  it('passes the resolved week start into mood reports', () => {
    const stats = calculateJournalStats([
      entry('2026-01-04', 1),
      entry('2026-01-05', 2),
    ], new Date(2026, 0, 5, 12), { weekStart: 'sunday' });
    expect(stats.weeklyMood.map((item) => item.key)).toEqual(['2026-01-04']);
  });

  it('keeps missing calendar days as empty slots in the seven-day mood trend', () => {
    expect(buildRecentMoodTrend([
      entry('2026-08-05', 1),
      entry('2026-08-08', -1),
    ], new Date(2026, 7, 11, 12))).toEqual([
      { date: '2026-08-05', score: 1 },
      { date: '2026-08-06', score: undefined },
      { date: '2026-08-07', score: undefined },
      { date: '2026-08-08', score: -1 },
      { date: '2026-08-09', score: undefined },
      { date: '2026-08-10', score: undefined },
      { date: '2026-08-11', score: undefined },
    ]);
  });
});
