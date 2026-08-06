import { createMediaAttachment, isDisplayableMedia } from './media-links';
import { normalizeJournalTag, normalizeJournalText, buildJournalSearchText } from './journal-search';
import type { JournalEntry, JournalFilter, JournalMediaFilter } from './types';

export const MISSING_LOCATION_FILTER = '__missing__';

export interface JournalLocationOption {
  value: string;
  label: string;
}

export interface JournalTagOption {
  value: string;
  label: string;
}

function coordinatePart(value: number | undefined, label: string): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  return `${label} ${String(Number(value.toFixed(5)))}`;
}

/** A stable key for filtering a location with a name, coordinates, or neither. */
export function locationFilterKey(location: JournalEntry['location']): string {
  const name = normalizeJournalText(location?.name);
  if (name) return `name:${name}`;
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  if (latitude !== undefined || longitude !== undefined) {
    return `coordinates:${latitude === undefined ? '' : Number(latitude.toFixed(5))},${longitude === undefined ? '' : Number(longitude.toFixed(5))}`;
  }
  return MISSING_LOCATION_FILTER;
}

export function locationFilterLabel(location: JournalEntry['location']): string {
  const name = typeof location?.name === 'string' ? location.name.trim() : '';
  if (name) return name;
  const coordinates = [
    coordinatePart(location?.latitude, 'lat'),
    coordinatePart(location?.longitude, 'lng'),
  ].filter(Boolean);
  return coordinates.join(', ') || MISSING_LOCATION_FILTER;
}

/** Build first-seen, deduplicated location options from the current entry order. */
export function buildJournalLocationOptions(entries: JournalEntry[]): JournalLocationOption[] {
  const options = new Map<string, JournalLocationOption>();
  for (const entry of entries) {
    const value = locationFilterKey(entry.location);
    if (options.has(value)) continue;
    options.set(value, {
      value,
      label: value === MISSING_LOCATION_FILTER ? 'No location' : locationFilterLabel(entry.location),
    });
  }
  return Array.from(options.values());
}

export function buildJournalTagOptions(entries: JournalEntry[]): JournalTagOption[] {
  const options = new Map<string, JournalTagOption>();
  for (const entry of entries) {
    for (const rawTag of entry.tags || []) {
      const value = normalizeJournalTag(rawTag);
      if (!value || options.has(value)) continue;
      options.set(value, { value, label: `#${value}` });
    }
  }
  return Array.from(options.values());
}

/** Return displayable media, including a displayable frontmatter-only cover. */
export function displayableJournalMedia(entry: JournalEntry): NonNullable<JournalEntry['media']> {
  const result = (entry.media || []).filter(isDisplayableMedia).slice();
  if (entry.cover) {
    const cover = createMediaAttachment(entry.cover, entry.path);
    if (cover && isDisplayableMedia(cover) && !result.some((item) => item.normalizedLink === cover.normalizedLink)) {
      result.push(cover);
    }
  }
  return result;
}

export function journalEntryMatchesMediaFilter(entry: JournalEntry, filter: JournalMediaFilter = 'all'): boolean {
  if (filter === 'all') return true;
  const media = displayableJournalMedia(entry);
  if (filter === 'any') return media.length > 0;
  if (filter === 'none') return media.length === 0;
  return media.some((item) => item.kind === filter);
}

function fallbackSearchText(entry: JournalEntry): string {
  return normalizeJournalText(entry.normalizedSearchText || entry.searchText || buildJournalSearchText({
    path: entry.path,
    title: entry.title,
    excerpt: entry.excerpt,
    sourceId: entry.sourceId,
    sourcePath: entry.sourcePath,
    sourceType: entry.sourceType,
    sourceLabel: entry.sourceLabel,
    location: entry.location,
    tags: entry.tags,
    activity: entry.activity,
    weather: entry.weather,
    uuid: entry.uuid,
    frontmatter: entry.frontmatter,
  }));
}

/** Match all active timeline filters with AND semantics. */
export function journalEntryMatchesFilter(entry: JournalEntry, filter: JournalFilter = {}): boolean {
  if (filter.from && entry.date < filter.from) return false;
  if (filter.to && entry.date > filter.to) return false;
  if (filter.sourceId && entry.sourceId !== filter.sourceId) return false;
  if (filter.moodScore !== undefined && entry.mood?.score !== filter.moodScore) return false;
  if (filter.favoriteOnly && !entry.favorite) return false;
  if (filter.media && !journalEntryMatchesMediaFilter(entry, filter.media)) return false;
  if (filter.location && locationFilterKey(entry.location) !== filter.location) return false;
  if (filter.tag && !(entry.tags || []).some((tag) => normalizeJournalTag(tag) === normalizeJournalTag(filter.tag))) return false;
  const query = normalizeJournalText(filter.query);
  if (query && !fallbackSearchText(entry).includes(query)) return false;
  return true;
}

export function filterJournalEntries(entries: JournalEntry[], filter: JournalFilter = {}): JournalEntry[] {
  return entries.filter((entry) => journalEntryMatchesFilter(entry, filter));
}
