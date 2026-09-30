import { describe, expect, it } from 'vitest';
import { buildMoodPeriodReport, summarizeMoodLabelTrends } from '../src/mood-reports';
import type { MoodRecord } from '../src/types';

/** Builds a record whose score may be any JSON value, including invalid ones. */
function record(score: unknown, extra: Record<string, unknown> = {}): MoodRecord {
  return { score, labels: [], recordedAt: '', updatedAt: '', ...extra } as MoodRecord;
}

describe('mood report date derivation', () => {
  it('takes the period from the note date instead of the UTC timestamp', () => {
    const monthly = buildMoodPeriodReport({
      'Daily/2026-04-01.md': record(1, { recordedAt: '2026-03-31T17:30:00.000Z' }),
    }, 'month');

    expect(monthly.map((item) => item.key)).toEqual(['2026-04']);
    expect(monthly[0].recordCount).toBe(1);
  });

  it('prefers an explicit entry date over the recorded timestamp', () => {
    const monthly = buildMoodPeriodReport(
      [{ date: '2026-04-05', mood: record(1, { recordedAt: '2026-03-31T17:30:00.000Z' }) }],
      'month',
    );

    expect(monthly.map((item) => item.key)).toEqual(['2026-04']);
  });

  it('derives the date from the record path when no entry date is given', () => {
    const monthly = buildMoodPeriodReport(
      [record(2, { path: 'Daily/2026-05-02.md', recordedAt: '2026-04-30T23:00:00.000Z' })],
      'month',
    );

    expect(monthly.map((item) => item.key)).toEqual(['2026-05']);
  });
});

describe('mood report score handling', () => {
  it('parses string scores and excludes invalid scores from the average', () => {
    const monthly = buildMoodPeriodReport({
      'Daily/2026-04-01.md': record('1'),
      'Daily/2026-04-02.md': record(2),
      'Daily/2026-04-03.md': record('not-a-score'),
      'Daily/2026-04-04.md': record(9),
      'Daily/2026-04-05.md': record(1.5),
    }, 'month');

    expect(monthly[0].recordCount).toBe(2);
    expect(monthly[0].averageScore).toBe(1.5);
    expect(monthly[0].minScore).toBe(1);
    expect(monthly[0].maxScore).toBe(2);
    expect(monthly[0].scoreCounts).toEqual({ '-2': 0, '-1': 0, '0': 0, '1': 1, '2': 1 });
  });

  it('does not concatenate string scores in label trends', () => {
    const trends = summarizeMoodLabelTrends([
      { date: '2026-04-01', mood: record('1', { labels: ['focus'] }) },
      { date: '2026-04-02', mood: record(1, { labels: ['focus'] }) },
      { date: '2026-04-03', mood: record(9, { labels: ['focus'] }) },
    ], 'month');

    expect(trends).toHaveLength(1);
    expect(trends[0]).toMatchObject({ label: 'focus', count: 2, averageScore: 1 });
    expect(trends[0].trend[0]).toMatchObject({ key: '2026-04', count: 2, averageScore: 1 });
  });
});
