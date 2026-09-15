import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { localize } from '../src/locale';
import {
  clearOnThisDayStrip,
  createStandaloneOnThisDayHost,
  mountOnThisDayStrip,
  normalizeOnThisDayEntryMode,
  onThisDayEntryDate,
  onThisDayStripMeta,
  parseOnThisDayMonthDay,
  pickOnThisDayPreview,
  resolveWeatherOnThisDayHost,
  shouldPreserveCalendarSelection,
  shouldShowHeaderOnThisDayEntry,
  shouldShowMergedOnThisDayEntry,
} from '../src/on-this-day-entry';

describe('on-this-day sidebar entry mode', () => {
  it('defaults to the merged weather-card entry and migrates the old toggle', () => {
    expect(normalizeOnThisDayEntryMode({})).toBe('merged');
    expect(normalizeOnThisDayEntryMode({ onThisDayButton: true })).toBe('merged');
    expect(normalizeOnThisDayEntryMode({ onThisDayButton: false })).toBe('off');
    expect(normalizeOnThisDayEntryMode({ onThisDayEntry: 'header', onThisDayButton: false })).toBe('header');
    expect(normalizeOnThisDayEntryMode({ onThisDayEntry: 'nope' })).toBe('merged');
    expect(shouldShowMergedOnThisDayEntry({ onThisDayEntry: 'merged' })).toBe(true);
    expect(shouldShowHeaderOnThisDayEntry({ onThisDayEntry: 'header' })).toBe(true);
    expect(shouldShowMergedOnThisDayEntry({ onThisDayEntry: 'header' })).toBe(false);
  });

  it('follows the active calendar date when one is selected', () => {
    expect(onThisDayEntryDate(null, '2026-09-15')).toBe('2026-09-15');
    expect(onThisDayEntryDate('2026-07-18', '2026-09-15')).toBe('2026-07-18');
    expect(parseOnThisDayMonthDay('2026-07-18')).toEqual({ month: 7, day: 18 });
    expect(parseOnThisDayMonthDay('bad')).toBeNull();
  });

  it('keeps the selected date when the calendar pane itself is focused', () => {
    const calendar = { id: 'calendar' };
    expect(shouldPreserveCalendarSelection(calendar, calendar)).toBe(true);
    expect(shouldPreserveCalendarSelection({ id: 'note' }, calendar)).toBe(false);
  });

  it('picks the newest year and a photo from any matching year', () => {
    expect(pickOnThisDayPreview([])).toBeNull();
    expect(pickOnThisDayPreview([
      { year: 2025, images: [], excerpt: 'walked by the river', path: '2025.md', dateStr: '2025-09-15' },
      { year: 2024, images: ['old.jpg'], excerpt: 'older', path: '2024.md', dateStr: '2024-09-15' },
    ])).toEqual({
      year: 2025,
      image: 'old.jpg',
      imageNotePath: '2024.md',
      imageDateStr: '2024-09-15',
      excerpt: 'walked by the river',
      count: 2,
    });
  });

  it('formats the compact strip meta line', () => {
    expect(onThisDayStripMeta('1年前', '9月15日')).toBe('1年前 · 9月15日');
    expect(localize('zh', 'otd_entryDate', 9, 15)).toBe('9月15日');
    expect(localize('en', 'otd_entryDate', 9, 15)).toBe('9/15');
    expect(localize('zh', 's_otdEntryMerged')).toBe('合并进天气卡');
    expect(localize('en', 's_otdEntryHeader')).toBe('Header icon');
  });
});

describe('on-this-day merged strip DOM', () => {
  it('mounts the strip on the weather card and can stand alone before weekdays', () => {
    const document = new JSDOM('<!doctype html><body></body>').window.document;
    const container = document.createElement('div');
    const weather = document.createElement('div');
    weather.className = 'cal-weather-card';
    const weekdays = document.createElement('div');
    weekdays.className = 'cal-weekdays';
    container.append(weather, weekdays);
    document.body.append(container);

    expect(resolveWeatherOnThisDayHost(container)).toBe(weather);

    const strip = mountOnThisDayStrip(weather, {
      title: '去年今日',
      meta: '1年前 · 9月15日',
      ariaLabel: '去年今日, 1年前 · 9月15日',
      dateStr: '2026-09-15',
    });
    expect(strip.dataset.otdDate).toBe('2026-09-15');
    expect(weather.classList.contains('has-otd')).toBe(true);
    expect(strip.className).toBe('cal-otd-strip');
    expect(strip.querySelector('.cal-otd-strip-title')?.textContent).toBe('去年今日');
    expect(strip.querySelector('.cal-otd-strip-meta')?.textContent).toBe('1年前 · 9月15日');

    clearOnThisDayStrip(container);
    expect(weather.querySelector('.cal-otd-strip')).toBeNull();
    expect(weather.classList.contains('has-otd')).toBe(false);

    const standalone = createStandaloneOnThisDayHost(container);
    expect(standalone.className).toContain('cal-otd-standalone');
    expect(standalone.nextElementSibling).toBe(weekdays);
    expect(createStandaloneOnThisDayHost(container)).toBe(standalone);
  });

  it('places a standalone host after the weather setup hint', () => {
    const document = new JSDOM('<!doctype html><body></body>').window.document;
    const container = document.createElement('div');
    const setup = document.createElement('div');
    setup.className = 'cal-weather-setup';
    const weekdays = document.createElement('div');
    weekdays.className = 'cal-weekdays';
    container.append(setup, weekdays);
    const standalone = createStandaloneOnThisDayHost(container);
    expect(setup.nextElementSibling).toBe(standalone);
    expect(standalone.nextElementSibling).toBe(weekdays);
  });
});
