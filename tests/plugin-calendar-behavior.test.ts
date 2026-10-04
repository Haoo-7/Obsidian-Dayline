// @ts-nocheck
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
// same way `calendar-navigation-behavior.test.ts` does.
const source = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
const ast = ts.createSourceFile('plugin.ts', source, ts.ScriptTarget.Latest, true);
function loadClass(name, dependencies) {
  const node = ast.statements.find((item) => ts.isClassDeclaration(item) && item.name?.text === name);
  return new Function(...Object.keys(dependencies), `${node.getText(ast)}; return ${name};`)(...Object.values(dependencies));
}

let document;
let phoneLayout = false;
let daylineDate = () => '2026-08-15';
const noticeMessages: string[] = [];
const localizeSpy = vi.fn((language, key) => `${language}:${key}`);
const displayLanguageSpy = vi.fn((settings) => (
  settings?.displayLanguage === 'system'
    ? 'ja'
    : settings?.displayLanguage || settings?.weatherLanguage || 'en'
));

class TestTFile {}
class TestNotice {
  constructor(message) {
    noticeMessages.push(String(message));
  }
}

const CalendarView = loadClass('CalendarView', {
  ItemView: class {},
  TFile: TestTFile,
  Notice: TestNotice,
  t,
  formatCalendarMonth,
  formatJournalDate,
  getCalendarWeekdays,
  getCalendarGridOffset,
  getDisplayLanguage: displayLanguageSpy,
  LOCALE_TAGS,
  moodLabel,
  _l: localizeSpy,
  setIcon: () => {},
  calendarCellTouchRouting,
  bindOpenOnPointer,
  usesPhoneLayout: () => phoneLayout,
  shouldOpenCalendarDateFromPointer,
  getMediaControlOwner,
  shouldAddMediaInfoControl,
  _daylineDate: () => daylineDate(),
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
  normalizeMediaLink: (value) => String(value ?? ''),
  createMediaAttachment: () => null,
  cssUrl,
  CreateNoteModal: class { constructor() {} open() {} },
  shouldPreserveCalendarSelection: () => false,
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
  noticeMessages.length = 0;
  phoneLayout = false;
  localizeSpy.mockClear();
  displayLanguageSpy.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  daylineDate = () => '2026-08-15';
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
    weatherLanguage: 'en',
    dailyFolder: 'Daily',
    weatherEnabled: true,
    weatherLatitude: '1',
    weatherLongitude: '2',
    weatherUnits: 'metric',
    weatherTtlHours: 2,
    showCalendarWeatherCard: false,
    showCalendarWeatherBadge: false,
    showCalendarMood: false,
    ...overrides,
  };
}

function makeWeather() {
  return {
    getSnapshot: vi.fn(async () => null),
    forceRefresh: vi.fn(async () => null),
    isSnapshotCompatible: () => true,
    hasCachedSnapshot: () => false,
    getCachedSnapshot: () => null,
    _shouldFetch: vi.fn(() => false),
  };
}

function makeView({ weather = makeWeather(), settings = baseSettings(), moodStore } = {}) {
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
      moodStore: moodStore || { get: () => undefined },
      _endExifHover: () => {},
      _syncDaylineRibbon: () => {},
    },
    weather,
    _renderMobileModeControls: () => {},
    _ensureExifTooltip: () => {},
    _renderWeatherCard: vi.fn(),
    _renderOnThisDayHeader: () => {},
    _renderOnThisDayEntry: () => {},
    buildMonthCache: vi.fn(async () => {}),
  });
  return view;
}

function cellOf(view, dateStr) {
  return view.contentEl.querySelector(`[data-calendar-focus="day-${dateStr}"]`);
}

/* ------------------------------------------------------------------------ *
 * P-14: display and edit must agree on which path owns the mood
 * ------------------------------------------------------------------------ */

describe('calendar mood path consistency (P-14)', () => {
  it('reads the mood from the same primary entry path the picker edits', () => {
    const lookedUp = [];
    const settings = baseSettings({ showCalendarMood: true });
    const view = makeView({
      settings,
      moodStore: {
        get: (path) => {
          lookedUp.push(path);
          return path === 'Journal/Other/2026-08-05.md' ? { score: 2 } : undefined;
        },
      },
    });
    view.monthCache.set(view._monthKey(view.displayMonth), new Map([
      ['2026-08-05', {
        date: '2026-08-05',
        entries: [],
        entryCount: 1,
        hasRecord: true,
        primaryEntryPath: 'Journal/Other/2026-08-05.md',
        path: 'Journal/Other/2026-08-05.md',
        media: [],
        images: [],
      }],
    ]));

    view.render();

    expect(lookedUp).toContain('Journal/Other/2026-08-05.md');
    expect(lookedUp).not.toContain('Daily/2026-08-05.md');
    const button = view.contentEl.querySelector('.cal-mood-button');
    expect(button.classList.contains('mood-2')).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *
 * P-15: a superseded refresh must not leave loading state or paint elsewhere
 * ------------------------------------------------------------------------ */

describe('weather refresh staleness (P-15)', () => {
  it('clears the loading state without touching a newer date when superseded', async () => {
    const view = makeView();
    const snapshot = { date: '2026-08-01', temperature: 20, units: 'metric', icon: 'overcast.svg' };
    const pending = deferred();
    view.weather.forceRefresh = vi.fn(() => pending.promise);

    const refreshing = view._performRefresh('2026-08-01', null);
    expect(view._weatherLoading).toBe(true);

    // The user navigated or the grid redrew while the request was in flight.
    view._fetchToken++;
    view._weatherCardDate = '2026-08-02';
    view._weatherSnapshot = null;
    view._weatherError = false;
    pending.resolve(snapshot);
    await refreshing;

    expect(view._weatherLoading).toBe(false);
    expect(view._weatherSnapshot).toBeNull();
    expect(view._weatherError).toBe(false);
  });

  it('does not paint a failed refresh onto a different date', async () => {
    const view = makeView();
    const pending = deferred();
    view.weather.forceRefresh = vi.fn(() => pending.promise);

    const refreshing = view._performRefresh('2026-08-01', null);
    view._fetchToken++;
    view._weatherCardDate = '2026-08-02';
    view._weatherError = false;
    pending.reject(new Error('boom'));
    await refreshing;

    expect(view._weatherError).toBe(false);
    expect(noticeMessages).toEqual([]);
    expect(view._weatherLoading).toBe(false);
  });

  it('still reports a failure for the date that is on screen', async () => {
    const view = makeView();
    view._weatherCardDate = '2026-08-01';
    view.weather.forceRefresh = vi.fn(async () => { throw new Error('boom'); });

    await view._performRefresh('2026-08-01', null);

    expect(view._weatherError).toBe(true);
    expect(noticeMessages).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * P-17.3: a date click and its active-leaf-change must rebuild the grid once
 * ------------------------------------------------------------------------ */

describe('calendar render coalescing (P-17)', () => {
  it('rebuilds the grid once for a click plus its active-leaf-change', async () => {
    const file = new TestTFile();
    Object.assign(file, { path: 'Daily/2026-08-05.md' });
    const view = makeView();
    view.app = {
      workspace: { activeLeaf: null },
      vault: { getAbstractFileByPath: (path) => (path === file.path ? file : null) },
    };
    view.plugin.openJournalFile = vi.fn(async () => ({}));
    view.render = vi.fn();
    view._syncActiveDate = vi.fn();
    view._triggerWeatherAfterOpen = vi.fn();

    const frames = [];
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
    try {
      view._openNote('2026-08-05');
      await flush();
      view._handleActiveLeafChange();

      // Nothing paints synchronously: both triggers coalesce into one frame.
      expect(view.render).not.toHaveBeenCalled();
      expect(frames).toHaveLength(1);

      for (const callback of frames.splice(0)) callback(0);
      expect(view.render).toHaveBeenCalledTimes(1);
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });

  it('keeps the global EXIF cache across a full refresh', async () => {
    const view = makeView();
    view.exifCache = { invalidate: vi.fn() };
    view._otdProvider = { invalidate: vi.fn(), ensureDateIndex: async () => {}, dateIndexSnapshot: new Set() };
    view.render = vi.fn();

    await view.refresh();

    expect(view.buildMonthCache).toHaveBeenCalled();
    expect(view.render).toHaveBeenCalledTimes(1);
    expect(view.exifCache.invalidate).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * P-20: the today highlight follows the clock across midnight
 * ------------------------------------------------------------------------ */

describe('midnight today highlight (P-20)', () => {
  it('moves the highlight at midnight without waiting for another redraw', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 23, 59, 30));
    const pad = (value) => String(value).padStart(2, '0');
    daylineDate = () => {
      const now = new Date();
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    };
    const view = makeView();

    view.render();
    expect(cellOf(view, '2026-08-15').classList.contains('cal-today')).toBe(true);

    view._scheduleMidnightRefresh();
    vi.advanceTimersByTime(90 * 1000);

    expect(cellOf(view, '2026-08-16').classList.contains('cal-today')).toBe(true);
    expect(cellOf(view, '2026-08-15').classList.contains('cal-today')).toBe(false);
  });

  /* The panel keeps its 1-9999 range (raising `min` to 100 would remove a real
     capability), so the year construction must stay correct for 0-99. This
     guards the chosen option; the actual P-20 code change is the timer above. */
  it('keeps the header and the grid on the same year when jumping to year 42', async () => {
    const view = makeView();
    view.render();

    view.contentEl.querySelector('[data-calendar-focus="title"]').click();
    view.contentEl.querySelector('[data-calendar-focus="jump-year"]').value = '42';
    view.contentEl.querySelector('[data-calendar-focus="jump-month"]').value = '2';
    view.contentEl.querySelector('[data-calendar-focus="jump-apply"]').click();
    await flush();

    expect(view.displayMonth.getFullYear()).toBe(42);
    expect(view.displayMonth.getMonth()).toBe(2);
    expect(view.contentEl.querySelector('[data-calendar-focus="title"]').textContent).toContain('42');
  });
});

/* ------------------------------------------------------------------------ *
 * J-08: the calendar view owns the On This Day panel it opened
 * ------------------------------------------------------------------------ */

describe('calendar On This Day teardown (J-08)', () => {
  it('closes the provider panel when the view closes', () => {
    const closeModal = vi.fn();
    const view = makeView();
    view._otdProvider = { closeModal };
    view._overlayContainers = new Set();
    view._hostPositionMarkers = new Set();
    view._exifObservers = new Map();

    view.onClose();

    expect(closeModal).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------ *
 * U-08: the locale used for weather labels follows the system language live
 * ------------------------------------------------------------------------ */

describe('live display language for weather labels (U-08)', () => {
  it('resolves the label locale at call time instead of the stored weatherLanguage', () => {
    const settings = baseSettings({
      displayLanguage: 'system',
      weatherLanguage: 'zh',
      showCalendarWeatherCard: true,
    });
    const view = makeView({ settings });
    delete view._renderWeatherCard;

    view.render();

    const languages = localizeSpy.mock.calls.map((call) => call[0]);
    expect(languages).toContain('ja');
    expect(languages).not.toContain('zh');
  });
});
