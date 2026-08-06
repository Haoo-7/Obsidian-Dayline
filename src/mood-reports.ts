import type { MoodRecord } from './types';

export interface MoodReportEntry {
  date: string;
  path?: string;
  mood?: MoodRecord;
  record?: MoodRecord;
}

export type MoodReportPeriod = 'week' | 'month' | 'year';

export interface MoodPeriodReport {
  key: string;
  startDate: string;
  endDate: string;
  recordCount: number;
  averageScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  scoreCounts: Record<'-2' | '-1' | '0' | '1' | '2', number>;
  labelCounts: Record<string, number>;
}

export interface MoodLabelTrendPoint {
  key: string;
  count: number;
  averageScore: number | null;
}

export interface MoodLabelTrendSummary {
  label: string;
  count: number;
  averageScore: number | null;
  trend: MoodLabelTrendPoint[];
}

export interface MoodReports {
  weekly: MoodPeriodReport[];
  monthly: MoodPeriodReport[];
  yearly: MoodPeriodReport[];
  labelTrends: MoodLabelTrendSummary[];
}

export interface MoodReportOptions {
  from?: string;
  to?: string;
  includeEmpty?: boolean;
  /** First day of the reporting week: 0 Sunday or 1 Monday. */
  weekStartsOn?: 0 | 1;
}

const SCORES = [-2, -1, 0, 1, 2] as const;

function dateValue(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function dateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function shiftDays(date: string, days: number): string {
  const value = dateValue(date);
  value.setUTCDate(value.getUTCDate() + days);
  return dateString(value);
}

function startOfWeek(date: string, weekStartsOn: 0 | 1 = 1): string {
  const value = dateValue(date);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - ((day - weekStartsOn + 7) % 7));
  return dateString(value);
}

function periodInfo(date: string, period: MoodReportPeriod, weekStartsOn: 0 | 1 = 1): { key: string; startDate: string; endDate: string } {
  if (period === 'year') {
    const key = date.slice(0, 4);
    return { key, startDate: `${key}-01-01`, endDate: `${key}-12-31` };
  }
  if (period === 'month') {
    const key = date.slice(0, 7);
    const value = dateValue(`${key}-01`);
    value.setUTCMonth(value.getUTCMonth() + 1, 0);
    return { key, startDate: `${key}-01`, endDate: dateString(value) };
  }
  const startDate = startOfWeek(date, weekStartsOn);
  return { key: startDate, startDate, endDate: shiftDays(startDate, 6) };
}

function emptyScoreCounts(): Record<'-2' | '-1' | '0' | '1' | '2', number> {
  return { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 };
}

function normalizeEntries(input: MoodReportEntry[] | Record<string, MoodRecord> | MoodRecord[]): MoodReportEntry[] {
  if (Array.isArray(input)) {
    return input.map((value, index) => {
      if ('date' in (value as object)) {
        const item = value as MoodReportEntry;
        return { ...item, mood: item.mood || item.record };
      }
      const record = value as MoodRecord;
      const date = String(record.date || record.recordedAt || '').slice(0, 10);
      return { date, path: String(index), mood: record };
    }).filter((item) => /^\d{4}-\d{2}-\d{2}$/u.test(item.date) && Boolean(item.mood));
  }
  return Object.entries(input || {}).map(([path, mood]) => ({
    path,
    date: String((mood as MoodRecord & { date?: unknown }).date || mood.recordedAt || '').slice(0, 10),
    mood,
  })).filter((item) => /^\d{4}-\d{2}-\d{2}$/u.test(item.date));
}

function makeReport(info: { key: string; startDate: string; endDate: string }, entries: MoodReportEntry[]): MoodPeriodReport {
  const scoreCounts = emptyScoreCounts();
  const labelCounts: Record<string, number> = {};
  let total = 0;
  let minScore: number | null = null;
  let maxScore: number | null = null;
  for (const entry of entries) {
    const score = entry.mood?.score;
    if (score === undefined || score === null) continue;
    scoreCounts[String(score) as keyof typeof scoreCounts]++;
    total += score;
    minScore = minScore === null ? score : Math.min(minScore, score);
    maxScore = maxScore === null ? score : Math.max(maxScore, score);
    for (const label of entry.mood?.labels || []) labelCounts[label] = (labelCounts[label] || 0) + 1;
  }
  const recordCount = entries.filter((entry) => entry.mood).length;
  return {
    ...info,
    recordCount,
    averageScore: recordCount ? Math.round((total / recordCount) * 100) / 100 : null,
    minScore,
    maxScore,
    scoreCounts,
    labelCounts: Object.fromEntries(Object.entries(labelCounts).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function expandPeriodKeys(from: string, to: string, period: MoodReportPeriod, weekStartsOn: 0 | 1): Array<{ key: string; startDate: string; endDate: string }> {
  const result: Array<{ key: string; startDate: string; endDate: string }> = [];
  let cursor = period === 'week' ? startOfWeek(from, weekStartsOn) : period === 'month' ? `${from.slice(0, 7)}-01` : `${from.slice(0, 4)}-01-01`;
  const end = period === 'week' ? startOfWeek(to, weekStartsOn) : period === 'month' ? `${to.slice(0, 7)}-01` : `${to.slice(0, 4)}-01-01`;
  while (cursor <= end) {
    result.push(periodInfo(cursor, period, weekStartsOn));
    cursor = period === 'week' ? shiftDays(cursor, 7) : period === 'month' ? dateString(new Date(Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)), 1))) : `${Number(cursor.slice(0, 4)) + 1}-01-01`;
  }
  return result;
}

export function buildMoodPeriodReport(input: MoodReportEntry[] | Record<string, MoodRecord> | MoodRecord[], period: MoodReportPeriod, options: MoodReportOptions = {}): MoodPeriodReport[] {
  const entries = normalizeEntries(input).sort((a, b) => a.date.localeCompare(b.date) || String(a.path || '').localeCompare(String(b.path || '')));
  const grouped = new Map<string, MoodReportEntry[]>();
  for (const entry of entries) {
    if (options.from && entry.date < options.from) continue;
    if (options.to && entry.date > options.to) continue;
    const info = periodInfo(entry.date, period, options.weekStartsOn ?? 1);
    const list = grouped.get(info.key) || [];
    list.push(entry);
    grouped.set(info.key, list);
  }
  let infos = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b)).map((key) => periodInfo(key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key, period, options.weekStartsOn ?? 1));
  if (options.includeEmpty && options.from && options.to) infos = expandPeriodKeys(options.from, options.to, period, options.weekStartsOn ?? 1);
  return infos.map((info) => makeReport(info, grouped.get(info.key) || []));
}

export function summarizeMoodLabelTrends(input: MoodReportEntry[] | Record<string, MoodRecord> | MoodRecord[], period: MoodReportPeriod = 'month', options: MoodReportOptions = {}): MoodLabelTrendSummary[] {
  const entries = normalizeEntries(input);
  const labels = new Set<string>();
  const totals = new Map<string, { count: number; score: number }>();
  for (const entry of entries) {
    if (options.from && entry.date < options.from) continue;
    if (options.to && entry.date > options.to) continue;
    for (const label of entry.mood?.labels || []) {
      labels.add(label);
      const current = totals.get(label) || { count: 0, score: 0 };
      current.count++;
      current.score += entry.mood?.score ?? 0;
      totals.set(label, current);
    }
  }
  return Array.from(labels).sort((a, b) => a.localeCompare(b)).map((label) => {
    const total = totals.get(label)!;
    const trendMap = new Map<string, MoodReportEntry[]>();
    for (const entry of entries) {
      if (options.from && entry.date < options.from) continue;
      if (options.to && entry.date > options.to) continue;
      if (!entry.mood?.labels.includes(label)) continue;
      const key = periodInfo(entry.date, period, options.weekStartsOn ?? 1).key;
      const group = trendMap.get(key) || [];
      group.push(entry);
      trendMap.set(key, group);
    }
    const trend = Array.from(trendMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => ({
      key,
      count: group.length,
      averageScore: group.length ? Math.round((group.reduce((sum, entry) => sum + (entry.mood?.score || 0), 0) / group.length) * 100) / 100 : null,
    }));
    return { label, count: total.count, averageScore: Math.round((total.score / total.count) * 100) / 100, trend };
  });
}

export function buildMoodReports(input: MoodReportEntry[] | Record<string, MoodRecord> | MoodRecord[], options: MoodReportOptions = {}): MoodReports {
  return {
    weekly: buildMoodPeriodReport(input, 'week', options),
    monthly: buildMoodPeriodReport(input, 'month', options),
    yearly: buildMoodPeriodReport(input, 'year', options),
    labelTrends: summarizeMoodLabelTrends(input, 'month', options),
  };
}

// Friendly aliases for callers that prefer report-oriented names.
export const generateMoodReports = buildMoodReports;
export const buildLabelTrends = summarizeMoodLabelTrends;
