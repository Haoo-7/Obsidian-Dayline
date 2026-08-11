import type { JournalEntry } from './types';
import { buildMoodReports, type MoodLabelTrendSummary, type MoodPeriodReport } from './mood-reports';
import { resolveWeekStart } from './i18n';

export interface JournalStats {
  currentStreak: number;
  longestStreak: number;
  monthCompletionRate: number;
  moodDistribution: Record<string, number>;
  labelCounts: Record<string, number>;
  trend: Array<{ date: string; score?: number }>;
  monthly: JournalPeriodStat[];
  quarterly: JournalPeriodStat[];
  yearly: JournalPeriodStat[];
  /** Per-label counts and average score by month. */
  labelTrends: MoodLabelTrendSummary[];
  weeklyMood: MoodPeriodReport[];
  monthlyMood: MoodPeriodReport[];
  yearlyMood: MoodPeriodReport[];
}

export interface JournalPeriodStat {
  key: string;
  entries: number;
  recordedDays: number;
  favoriteCount: number;
  moodAverage?: number;
}

export interface JournalMoodTrendPoint {
  date: string;
  score?: number;
}

function dateOnly(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return dateOnly(value);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function uniqueDates(entries: JournalEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.date))).sort();
}

function periodKey(date: string, period: 'month' | 'quarter' | 'year'): string {
  const year = date.slice(0, 4);
  if (period === 'year') return year;
  const month = Number(date.slice(5, 7));
  if (period === 'month') return `${year}-${String(month).padStart(2, '0')}`;
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** Build one mood slot for each natural day in the recent seven-day window. */
export function buildRecentMoodTrend(entries: JournalEntry[], today = new Date(), days = 7): JournalMoodTrendPoint[] {
  const count = Math.max(0, Math.floor(days));
  const moodByDate = new Map<string, number>();
  const moodEntries = entries
    .filter((entry) => Boolean(entry.mood))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date)
      || String(a.mood?.updatedAt || '').localeCompare(String(b.mood?.updatedAt || ''))
      || a.path.localeCompare(b.path));
  for (const entry of moodEntries) moodByDate.set(entry.date, entry.mood!.score);
  const start = shiftDate(dateOnly(today), -(count - 1));
  return Array.from({ length: count }, (_, index) => {
    const date = shiftDate(start, index);
    return { date, score: moodByDate.get(date) };
  });
}

/** Aggregate entries into deterministic month, quarter, and year buckets. */
export function aggregateJournalPeriods(entries: JournalEntry[], period: 'month' | 'quarter' | 'year'): JournalPeriodStat[] {
  const buckets = new Map<string, { entries: number; dates: Set<string>; favoriteCount: number; moodTotal: number; moodCount: number }>();
  for (const entry of entries) {
    const key = periodKey(entry.date, period);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { entries: 0, dates: new Set<string>(), favoriteCount: 0, moodTotal: 0, moodCount: 0 };
      buckets.set(key, bucket);
    }
    bucket.entries++;
    bucket.dates.add(entry.date);
    if (entry.favorite) bucket.favoriteCount++;
    if (entry.mood) {
      bucket.moodTotal += entry.mood.score;
      bucket.moodCount++;
    }
  }
  return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, bucket]) => ({
    key,
    entries: bucket.entries,
    recordedDays: bucket.dates.size,
    favoriteCount: bucket.favoriteCount,
    moodAverage: bucket.moodCount > 0 ? Math.round((bucket.moodTotal / bucket.moodCount) * 100) / 100 : undefined,
  }));
}

export function calculateJournalStats(entries: JournalEntry[], today = new Date(), settings: { weekStart?: string } = {}): JournalStats {
  const dates = uniqueDates(entries);
  const dateSet = new Set(dates);
  let currentStreak = 0;
  let cursor = dateOnly(today);
  if (!dateSet.has(cursor)) cursor = shiftDate(cursor, -1);
  while (dateSet.has(cursor)) {
    currentStreak++;
    cursor = shiftDate(cursor, -1);
  }

  let longestStreak = 0;
  let run = 0;
  let previous: string | undefined;
  for (const date of dates) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = date;
  }

  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const todayString = dateOnly(today);
  const recordedThisMonth = dates.filter((date) => date.startsWith(monthPrefix) && date <= todayString).length;
  const monthCompletionRate = Math.round((recordedThisMonth / daysInMonth(today)) * 100);
  const moodDistribution: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.mood) {
      const key = String(entry.mood.score);
      moodDistribution[key] = (moodDistribution[key] ?? 0) + 1;
      for (const label of entry.mood.labels) labelCounts[label] = (labelCounts[label] ?? 0) + 1;
    }
  }
  const moodInputs = entries.map((entry) => ({ date: entry.date, path: entry.path, mood: entry.mood }));
  const moodReports = buildMoodReports(moodInputs, { weekStartsOn: resolveWeekStart(settings) });
  return {
    currentStreak,
    longestStreak,
    monthCompletionRate,
    moodDistribution,
    labelCounts,
    trend: entries
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14)
      .map((entry) => ({ date: entry.date, score: entry.mood?.score })),
    monthly: aggregateJournalPeriods(entries, 'month'),
    quarterly: aggregateJournalPeriods(entries, 'quarter'),
    yearly: aggregateJournalPeriods(entries, 'year'),
    labelTrends: moodReports.labelTrends,
    weeklyMood: moodReports.weekly,
    monthlyMood: moodReports.monthly,
    yearlyMood: moodReports.yearly,
  };
}
