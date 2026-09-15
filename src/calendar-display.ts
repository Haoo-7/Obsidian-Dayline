import type { JournalEntry } from './types';

export const CALENDAR_MOOD_MARKERS = ['dot', 'bar'] as const;
export type CalendarMoodMarker = (typeof CALENDAR_MOOD_MARKERS)[number];

export interface CalendarDisplaySettings {
  showCalendarMood?: boolean;
  calendarMoodMarker?: CalendarMoodMarker | string;
  showCalendarWeatherCard?: boolean;
  showCalendarWeatherBadge?: boolean;
  showCalendarWeatherLocation?: boolean;
  /** Legacy combined weather visibility setting. */
  showCalendarWeather?: boolean;
}

/**
 * Calendar cells use date, ordering, media, weather, and mood score, but not
 * journal prose or search text. Avoid rebuilding the full month for the latter.
 */
export function calendarEntryAffectsDisplay(previous?: JournalEntry, entry?: JournalEntry): boolean {
  if (!previous || !entry) return previous !== entry;

  const projection = (value: JournalEntry) => JSON.stringify({
    path: value.path,
    date: value.date,
    sourceId: value.sourceId,
    sourceType: value.sourceType,
    createdAt: value.createdAt,
    media: value.media,
    cover: value.cover,
    weather: value.weather,
    mood: value.mood ? { score: value.mood.score } : undefined,
  });

  return projection(previous) !== projection(entry);
}

/** Keep the media name available to keyboard users without creating a hover label. */
export function calendarMediaAccessibilityLabel(dateStr: string, mediaLabel: string, focused: boolean): string | null {
  return focused ? `${dateStr} ${mediaLabel}` : null;
}

/** Missing fields remain visible so older plugin data keeps its current UI. */
export function shouldShowCalendarMood(settings: CalendarDisplaySettings = {}): boolean {
  return settings.showCalendarMood !== false;
}

/** Older settings without this field keep the corner color-dot marker. */
export function calendarMoodMarker(settings: CalendarDisplaySettings = {}): CalendarMoodMarker {
  return settings.calendarMoodMarker === 'bar' ? 'bar' : 'dot';
}

export function calendarMoodMarkerClass(settings: CalendarDisplaySettings = {}): string {
  return `cal-mood-marker-${calendarMoodMarker(settings)}`;
}

export function shouldShowCalendarMoodStyle(settings: CalendarDisplaySettings = {}): boolean {
  return shouldShowCalendarMood(settings);
}

export function shouldShowCalendarWeather(settings: CalendarDisplaySettings = {}): boolean {
  return shouldShowCalendarWeatherCard(settings) || shouldShowCalendarWeatherBadge(settings);
}

export function shouldShowCalendarWeatherCard(settings: CalendarDisplaySettings = {}): boolean {
  return settings.showCalendarWeatherCard ?? settings.showCalendarWeather !== false;
}

export function shouldShowCalendarWeatherBadge(settings: CalendarDisplaySettings = {}): boolean {
  return settings.showCalendarWeatherBadge ?? settings.showCalendarWeather !== false;
}

/** Location is opt-in so existing settings do not add a second weather-card line. */
export function shouldShowCalendarWeatherLocation(settings: CalendarDisplaySettings = {}): boolean {
  return settings.showCalendarWeatherLocation === true;
}

/** The header "today" jump is only useful when the visible month is not this month. */
export function isCurrentCalendarMonth(displayMonth: Date | null | undefined, todayStr: string | null | undefined): boolean {
  if (!displayMonth || !todayStr) return false;
  const [year, month] = String(todayStr).split('-').map(Number);
  if (!year || !month) return false;
  return displayMonth.getFullYear() === year && displayMonth.getMonth() === month - 1;
}
