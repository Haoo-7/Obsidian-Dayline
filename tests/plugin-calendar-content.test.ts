// @ts-nocheck
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarMoodMarkerClass, isCurrentCalendarMonth, shouldShowCalendarMood, shouldShowCalendarWrittenMarker } from '../src/calendar-display';
import { formatDateParts, joinVaultPath } from '../src/date-utils';
import {
  formatCalendarMonth,
  formatJournalDate,
  getCalendarGridOffset,
  getCalendarWeekdays,
  getDisplayLanguage,
  LOCALE_TAGS,
  moodLabel,
  t,
} from '../src/i18n';
import { localize as _l } from '../src/locale';
import { getMoodColor } from '../src/mood';
import {
  clearOnThisDayStrip,
  createStandaloneOnThisDayHost,
  mountOnThisDayStrip,
  onThisDayStripMeta,
  onThisDayYearsAgo,
  parseOnThisDayMonthDay,
  pickOnThisDayPreview,
  resolveWeatherOnThisDayHost,
} from '../src/on-this-day-entry';
import { getMediaControlOwner, shouldAddMediaInfoControl, shouldOpenCalendarDateFromPointer } from '../src/media-interaction';
import { calendarCellTouchRouting, bindOpenOnPointer } from '../src/touch-targets';
import { usesPhoneLayout } from '../src/platform-capabilities';
import { cssUrl } from '../src/css-url';

// Execute the real CalendarView class with only its host services stubbed, the
// same way `calendar-navigation-behavior.test.ts` does. The free identifiers the
// class body references must all be injected here.
const source = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('plugin.ts', source, ts.ScriptTarget.Latest, true);
function loadClass(name, dependencies) {
  const node = ast.statements.find((item) => ts.isClassDeclaration(item) && item.name?.text === name);
  return new Function(...Object.keys(dependencies), `${node.getText(ast)}; return ${name};`)(...Object.values(dependencies));
}

let document;
class TestTFile {}
const CalendarView = loadClass('CalendarView', {
  ItemView: class {},
  TFile: TestTFile,
  Notice: class {},
  t,
  formatCalendarMonth,
  formatJournalDate,
  getCalendarWeekdays,
  getCalendarGridOffset,
  getDisplayLanguage,
  LOCALE_TAGS,
  moodLabel,
  _l,
  setIcon: () => {},
  calendarCellTouchRouting,
  bindOpenOnPointer,
  usesPhoneLayout,
  shouldOpenCalendarDateFromPointer,
  getMediaControlOwner,
  shouldAddMediaInfoControl,
  _daylineDate: () => '2026-08-15',
  formatDateParts,
  joinVaultPath,
  shouldShowCalendarMood,
  shouldShowCalendarWrittenMarker,
  calendarMoodMarkerClass,
  calendarMediaAccessibilityLabel: () => '',
  isCurrentCalendarMonth,
  getMoodColor,
  _iconUrl: () => 'icon.svg',
  validateWeatherCoordinates: () => true,
  shouldShowCalendarWeatherCard: () => true,
  shouldShowCalendarWeatherBadge: () => false,
  shouldShowCalendarWeatherLocation: () => false,
  weatherConditionLabel: () => 'cond',
  buildWeatherCardParts: () => ({ detail: [], extra: [] }),
  buildWeatherStatus: () => [],
  normalizeWeatherDisplayFields: () => [],
  weatherBadgeIcon: () => 'badge-sun.svg',
  BADGE_ICON_CATEGORY: {},
  BADGE_SVG: {},
  appendBadgeSvg: () => {},
  HEIC_EXTS: ['heic', 'heif'],
  hasExistingImage: () => false,
  resolveCapabilityRoute: () => 'full',
  clearOnThisDayStrip,
  resolveWeatherOnThisDayHost,
  createStandaloneOnThisDayHost,
  mountOnThisDayStrip,
  pickOnThisDayPreview,
  onThisDayStripMeta,
  onThisDayYearsAgo,
  parseOnThisDayMonthDay,
  shouldShowHeaderOnThisDayEntry: () => false,
  shouldShowMergedOnThisDayEntry: () => false,
  MEDIA_EXTENSIONS: [],
  MEDIA_IMAGE_EXTENSIONS: [],
  classifyMediaLink: () => ({ extension: '' }),
  normalizeMediaLink: (value: unknown) => String(value ?? ''),
  createMediaAttachment: () => null,
  cssUrl,
  createEl: (tag) => document.createElement(tag),
  createDiv: () => document.createElement('div'),
  createSpan: () => document.createElement('span'),
});

beforeEach(() => {
  document = new JSDOM('<!doctype html><body></body>').window.document;
  const prototype = document.defaultView.HTMLElement.prototype;
  prototype.empty = function () { this.replaceChildren(); };
  prototype.addClass = function (...names) { this.classList.add(...names); };
  prototype.removeClass = function (...names) { this.classList.remove(...names); };
  prototype.setText = function (text) { this.textContent = text; };
  prototype.createEl = function (tag, options = {}) {
    const element = document.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.value !== undefined) element.value = options.value;
    for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
    this.append(element);
    return element;
  };
  prototype.createDiv = function (options) { return this.createEl('div', options); };
  prototype.createSpan = function (options) { return this.createEl('span', options); };
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

function baseSettings(overrides = {}) {
  return {
    displayLanguage: 'en',
    language: 'en',
    weatherLanguage: 'en',
    dailyFolder: 'Daily',
    weatherEnabled: true,
    weatherLatitude: '1',
    weatherLongitude: '2',
    weatherUnits: 'metric',
    showCalendarWeatherCard: true,
    showCalendarWeatherBadge: false,
    showCalendarMood: false,
    ...overrides,
  };
}

function makeWeather() {
  return {
    getSnapshot: vi.fn(async () => null),
    isSnapshotCompatible: () => true,
    hasCachedSnapshot: () => false,
    getCachedSnapshot: () => null,
  };
}

function makeView({ weather = makeWeather(), settings = baseSettings() } = {}) {
  const view = Object.create(CalendarView.prototype);
  Object.assign(view, {
    contentEl: document.body.createDiv({ attr: { tabindex: '0' } }),
    containerEl: document.body.createDiv(),
    displayMonth: new Date(2026, 7, 1),
    monthCache: new Map(),
    activeDate: '2026-08-01',
    plugin: {
      settings,
      journalIndex: { isReady: true },
      capabilities: {},
      moodStore: { get: () => undefined },
    },
    weather,
    _renderMobileModeControls: () => {},
    _ensureExifTooltip: () => {},
    _renderOnThisDayHeader: () => {},
    _renderOnThisDayEntry: () => {},
    buildMonthCache: vi.fn(async () => {}),
  });
  return view;
}

describe('calendar weather card revalidation (P-09)', () => {
  it('revalidates the same-date card on a redraw instead of refetching it', async () => {
    const snapshot = {
      date: '2026-08-01',
      temperature: 21,
      temperatureLabel: 'High',
      units: 'metric',
      icon: 'badge-sun.svg',
      weatherCode: 0,
      location: 'Here',
    };
    const weather = makeWeather();
    weather.getSnapshot = vi.fn(async () => snapshot);
    const view = makeView({ weather });

    view.render();
    await flush();
    expect(weather.getSnapshot).toHaveBeenCalledTimes(1);

    view.render();
    await flush();

    // A redraw of the same date must ask WeatherService to revalidate (TTL and
    // in-flight dedup live there) rather than rebuild the card and refetch.
    expect(weather.getSnapshot).toHaveBeenCalledTimes(2);
    expect(view.contentEl.querySelectorAll('.cal-weather-card')).toHaveLength(1);
  });

  it('does not rebuild and refetch a failed date on every redraw', async () => {
    const weather = makeWeather();
    weather.getSnapshot = vi.fn(async () => null);
    const view = makeView({ weather });
    // Pin the card to the harness "today" (2026-08-15): a failed fetch for
    // today is an error; a past date without data is the no-data policy state.
    view.activeDate = '2026-08-15';

    view.render();
    await flush();
    const card = view._weatherCardEl;
    expect(view._weatherError).toBe(true);
    expect(view._weatherLoading).toBe(false);

    const refetch = vi.spyOn(view, '_fetchWeatherForDate');
    view.render();
    await flush();

    expect(refetch).not.toHaveBeenCalled();
    expect(view._weatherCardEl).toBe(card);
    expect(view.contentEl.querySelectorAll('.cal-weather-card')).toHaveLength(1);
    expect(view._weatherLoading).toBe(false);
  });
});

describe('calendar mood marker accessibility (M-11)', () => {
  function makeMoodView(score) {
    const settings = baseSettings({ showCalendarMood: true });
    const view = makeView({ settings });
    view.plugin.moodStore = { get: (path) => (path.endsWith('2026-08-05.md') ? { score } : undefined) };
    view.render();
    return view;
  }

  it('keeps the mood marker uniform: level in the title, no non-color size cue (M-11 reverted)', () => {
    const view = makeMoodView(2);
    const button = view.contentEl.querySelector('.cal-mood-button');
    expect(button).toBeTruthy();
    // M-11 asked for a non-color cue. It was implemented as a uniform marker
    // scale and then reverted by the maintainer: at 6-10px it was imperceptible,
    // so it helped nobody while putting the pip's shape at risk. The level stays
    // in the hover title and the button keeps a localized date for screen
    // readers, but the marker geometry itself is left alone.
    expect(button.getAttribute('title')).toBe(moodLabel(view.plugin.settings, 2));
    expect(button.getAttribute('aria-label')).toContain(formatJournalDate('2026-08-05', view.plugin.settings));
    expect(button.hasAttribute('data-mood-level')).toBe(false);

    const dot = button.querySelector('.cal-mood-dot');
    expect(dot.style.height).toBe('');
    expect(dot.style.width).toBe('');
    expect(dot.style.transform).toBe('');
    expect(button.style.getPropertyValue('--journal-mood-color')).toBeTruthy();

    // Guard the decision: no per-level marker styling may creep back in.
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    expect(css).not.toContain('data-mood-level');
  });
});

describe('on-this-day thumbnail resource path (J-06)', () => {
  it('quotes and escapes the CSS url for a name containing parentheses and spaces', async () => {
    const view = makeView();
    const load = deferred();
    view.plugin.thumbnailService = { load: () => load.promise };
    view.plugin.openOnThisDay = vi.fn();

    view._mountMergedOnThisDayStrip(view.contentEl, '2026-08-05', 8, 5, [
      { year: 2020, images: ['IMG_1234 (1).jpg'], path: 'Daily/2020-08-05.md', dateStr: '2020-08-05', excerpt: '' },
    ]);

    const photo = view.contentEl.querySelector('.cal-otd-strip-photo');
    expect(photo).toBeTruthy();
    const recorded = [];
    Object.defineProperty(photo.style, 'backgroundImage', {
      set(value) { recorded.push(value); },
      get() { return recorded[recorded.length - 1] ?? ''; },
      configurable: true,
    });

    load.resolve({ url: 'app://local/IMG_1234 (1).jpg' });
    await flush();

    expect(recorded).toEqual(['url("app://local/IMG_1234 (1).jpg")']);
  });
});

describe('removed past-year dot marker', () => {
  it('draws no per-cell dot even when a vault still carries the old setting', () => {
    const settings = baseSettings({ onThisDayDot: true, onThisDayEntry: 'merged' });
    const view = makeView({ settings });
    view._otdDotCache = new Set(['08-05', '08-12']);

    view.render();

    // The marker was removed because it read as "this day has an entry" while
    // it actually meant "a past year has an entry". A stale data.json key must
    // not bring it back.
    expect(view.contentEl.querySelectorAll('.cal-day')).not.toHaveLength(0);
    expect(view.contentEl.querySelectorAll('.cal-otd-dot')).toHaveLength(0);
  });
});

describe('HEIC embed loader cleanup (P-11)', () => {
  it('removes the converting loader when the embed cannot be resolved', async () => {
    const view = makeView();
    view.app = { metadataCache: { getFirstLinkpathDest: () => null } };
    view._notePathForElement = () => 'Daily/2026-08-05.md';
    view.plugin.heicCache = { getThumbnail: vi.fn() };

    const embed = view.contentEl.createDiv({ cls: 'internal-embed', attr: { src: 'photo.heic' } });
    await view._convertHeicEmbed(embed, 'photo.heic');

    expect(embed.querySelector('.cal-heic-preview')).toBeNull();
    expect(view.plugin.heicCache.getThumbnail).not.toHaveBeenCalled();
  });
});

describe('calendar written-day marker (Day One style)', () => {
  const writtenEntry = {
    date: '2026-08-05',
    entries: [],
    entryCount: 1,
    sourceIds: [],
    hasRecord: true,
    hasWeather: false,
    path: 'Daily/2026-08-05.md',
    primaryEntryPath: undefined,
    mood: undefined,
    media: [],
    images: [],
    cover: undefined,
  };
  const photoEntry = { ...writtenEntry, date: '2026-08-06', path: 'Daily/2026-08-06.md', cover: { link: 'photo.jpg', normalizedLink: 'photo.jpg', sourcePath: 'Daily/2026-08-06.md', kind: 'image' } };

  function makeWrittenView(settingsOverrides = {}, augustEntries = [writtenEntry]) {
    const settings = baseSettings({ showCalendarMood: false, ...settingsOverrides });
    const view = makeView({ settings });
    view.monthCache.set('2026-7', new Map(augustEntries.map((entry) => [entry.date, entry])));
    view.render();
    return view;
  }

  it('fills a journaled date without a photo with the accent marker', () => {
    const view = makeWrittenView();
    expect(view.contentEl.querySelector('.cal-day[data-calendar-focus="day-2026-08-05"]').classList.contains('cal-written')).toBe(true);
  });

  it('leaves photo dates to the image and unwritten dates empty', () => {
    const view = makeWrittenView({}, [writtenEntry, photoEntry]);
    const photoCell = view.contentEl.querySelector('.cal-day[data-calendar-focus="day-2026-08-06"]');
    expect(photoCell.classList.contains('cal-written')).toBe(false);
    expect(photoCell.classList.contains('cal-has-image')).toBe(true);
    const emptyCell = view.contentEl.querySelector('.cal-day[data-calendar-focus="day-2026-08-07"]');
    expect(emptyCell.classList.contains('cal-written')).toBe(false);
    expect(emptyCell.classList.contains('cal-no-image')).toBe(true);
  });

  it('does not mark written days when the setting is off', () => {
    const view = makeWrittenView({ showCalendarWrittenMarker: false });
    expect(view.contentEl.querySelector('.cal-day[data-calendar-focus="day-2026-08-05"]').classList.contains('cal-written')).toBe(false);
  });
});
