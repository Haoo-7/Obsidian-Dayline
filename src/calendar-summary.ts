import { createMediaAttachment } from './media-links';
import type { CalendarDaySummary, JournalEntry, MediaAttachment } from './types';

function entryOrder(a: JournalEntry, b: JournalEntry): number {
  if (a.sourceType !== b.sourceType) return a.sourceType === 'daily' ? -1 : 1;
  const aCreated = a.createdAt || '';
  const bCreated = b.createdAt || '';
  if (aCreated !== bCreated) return bCreated.localeCompare(aCreated);
  return a.path.localeCompare(b.path);
}

function addMedia(result: MediaAttachment[], seen: Set<string>, media: MediaAttachment[]): void {
  for (const item of media) {
    if (item.kind === 'unknown') continue;
    const linkKey = item.normalizedLink;
    const key = `${item.sourcePath}\u0000${linkKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
}

/** Build stable, date-keyed summaries without doing any vault or media I/O. */
export function aggregateCalendarDays(entries: JournalEntry[]): Map<string, CalendarDaySummary> {
  const grouped = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.date) || [];
    list.push(entry);
    grouped.set(entry.date, list);
  }

  const result = new Map<string, CalendarDaySummary>();
  for (const [date, rawEntries] of grouped) {
    const dateEntries = rawEntries.slice().sort(entryOrder);
    const media: MediaAttachment[] = [];
    const seen = new Set<string>();
    for (const entry of dateEntries) addMedia(media, seen, entry.media || []);

    let explicitCover: MediaAttachment | undefined;
    for (const entry of dateEntries) {
      if (!entry.cover) continue;
      const candidate = createMediaAttachment(entry.cover, entry.path);
      if (candidate && candidate.kind !== 'unknown') {
        explicitCover = candidate;
        const linkKey = candidate.normalizedLink;
        if (!seen.has(`${candidate.sourcePath}\u0000${linkKey}`)) {
          media.unshift(candidate);
          seen.add(`${candidate.sourcePath}\u0000${linkKey}`);
        }
        break;
      }
    }

    const primary = dateEntries[0];
    const summary: CalendarDaySummary = {
      date,
      entries: dateEntries,
      entryCount: dateEntries.length,
      sourceIds: Array.from(new Set(dateEntries.map((entry) => entry.sourceId))),
      hasRecord: dateEntries.length > 0,
      hasWeather: dateEntries.some((entry) => Boolean(entry.weather)),
      primaryEntryPath: primary?.path,
      media,
      cover: explicitCover || media[0],
      path: primary?.path,
      mood: dateEntries.find((entry) => entry.mood)?.mood,
      images: media.filter((item) => item.kind === 'image'),
    };
    result.set(date, summary);
  }
  return result;
}

export function summaryForDate(entries: JournalEntry[], date: string): CalendarDaySummary | undefined {
  return aggregateCalendarDays(entries).get(date);
}

/** Add calendar summaries for cached-weather dates that have no journal file. */
export function withWeatherOnlyDays(
  summaries: Map<string, CalendarDaySummary>,
  weatherDates: Iterable<string>,
  dailyFolder = 'Calendar/Daily',
): Map<string, CalendarDaySummary> {
  const result = new Map(summaries);
  for (const date of weatherDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || result.has(date)) continue;
    const folder = dailyFolder.replace(/\/+$/, '');
    const path = folder ? `${folder}/${date}.md` : `${date}.md`;
    result.set(date, {
      date,
      entries: [],
      entryCount: 0,
      sourceIds: [],
      hasRecord: false,
      hasWeather: true,
      primaryEntryPath: path,
      path,
      media: [],
      images: [],
    });
  }
  return result;
}
