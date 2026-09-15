import { describe, expect, it } from 'vitest';
import {
  calendarEntryAffectsDisplay,
  calendarMediaAccessibilityLabel,
  calendarMoodMarker,
  calendarMoodMarkerClass,
  isCurrentCalendarMonth,
  shouldShowCalendarMood,
  shouldShowCalendarMoodStyle,
  shouldShowCalendarWeather,
  shouldShowCalendarWeatherBadge,
  shouldShowCalendarWeatherCard,
  shouldShowCalendarWeatherLocation,
} from '../src/calendar-display';

describe('calendar display settings', () => {
  it('does not rebuild the calendar for a journal body-only update', () => {
    const previous = {
      path: 'Calendar/Daily/2026-08-15.md',
      date: '2026-08-15',
      title: 'Daily Note',
      excerpt: 'before',
      searchText: 'before',
      sourceId: 'daily',
      sourceType: 'daily',
      media: [],
    } as any;
    const entry = { ...previous, excerpt: 'after', searchText: 'after' };

    expect(calendarEntryAffectsDisplay(previous, entry)).toBe(false);
  });

  it('rebuilds the calendar when a date entry changes its visible media or date', () => {
    const previous = {
      path: 'Calendar/Daily/2026-08-15.md',
      date: '2026-08-15',
      sourceId: 'daily',
      sourceType: 'daily',
      media: [],
    } as any;
    const withPhoto = {
      ...previous,
      media: [{ link: 'photo.jpg', normalizedLink: 'photo.jpg', sourcePath: previous.path, kind: 'image', external: false }],
    };

    expect(calendarEntryAffectsDisplay(previous, withPhoto)).toBe(true);
    expect(calendarEntryAffectsDisplay(previous, { ...previous, date: '2026-08-16' })).toBe(true);
  });

  it('keeps the media label out of mouse hover while exposing it on focus', () => {
    expect(calendarMediaAccessibilityLabel('2026-08-05', '媒体信息', false)).toBeNull();
    expect(calendarMediaAccessibilityLabel('2026-08-05', '媒体信息', true)).toBe('2026-08-05 媒体信息');
  });

  it('keeps both displays visible for legacy settings without the new fields', () => {
    expect(shouldShowCalendarMood({})).toBe(true);
    expect(shouldShowCalendarWeather({})).toBe(true);
  });

  it('hides only the selected calendar display', () => {
    expect(shouldShowCalendarMood({ showCalendarMood: false, showCalendarWeather: true })).toBe(false);
    expect(shouldShowCalendarWeather({ showCalendarMood: true, showCalendarWeather: false })).toBe(false);
    expect(shouldShowCalendarMood({ showCalendarMood: true, showCalendarWeather: false })).toBe(true);
  });

  it('defaults the calendar mood marker to a corner dot and accepts a bottom bar', () => {
    expect(calendarMoodMarker({})).toBe('dot');
    expect(calendarMoodMarker({ calendarMoodMarker: 'dot' })).toBe('dot');
    expect(calendarMoodMarker({ calendarMoodMarker: 'bar' })).toBe('bar');
    expect(calendarMoodMarker({ calendarMoodMarker: 'stripe' })).toBe('dot');
    expect(calendarMoodMarkerClass({ calendarMoodMarker: 'bar' })).toBe('cal-mood-marker-bar');
    expect(shouldShowCalendarMoodStyle({})).toBe(true);
    expect(shouldShowCalendarMoodStyle({ showCalendarMood: false })).toBe(false);
  });

  it('controls the weather card and date badges independently', () => {
    expect(shouldShowCalendarWeatherCard({ showCalendarWeatherCard: false, showCalendarWeatherBadge: true })).toBe(false);
    expect(shouldShowCalendarWeatherBadge({ showCalendarWeatherCard: false, showCalendarWeatherBadge: true })).toBe(true);
    expect(shouldShowCalendarWeatherCard({ showCalendarWeatherCard: true, showCalendarWeatherBadge: false })).toBe(true);
    expect(shouldShowCalendarWeatherBadge({ showCalendarWeatherCard: true, showCalendarWeatherBadge: false })).toBe(false);
    expect(shouldShowCalendarWeather({ showCalendarWeatherCard: false, showCalendarWeatherBadge: true })).toBe(true);
  });

  it('keeps the weather location hidden unless explicitly enabled', () => {
    expect(shouldShowCalendarWeatherLocation({})).toBe(false);
    expect(shouldShowCalendarWeatherLocation({ showCalendarWeatherLocation: false })).toBe(false);
    expect(shouldShowCalendarWeatherLocation({ showCalendarWeatherLocation: true })).toBe(true);
  });

  it('treats the header today jump as useful only off the current month', () => {
    expect(isCurrentCalendarMonth(new Date(2026, 8, 1), '2026-09-15')).toBe(true);
    expect(isCurrentCalendarMonth(new Date(2026, 6, 1), '2026-09-15')).toBe(false);
    expect(isCurrentCalendarMonth(new Date(2025, 8, 1), '2026-09-15')).toBe(false);
    expect(isCurrentCalendarMonth(null, '2026-09-15')).toBe(false);
  });
});
