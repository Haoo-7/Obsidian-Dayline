// @ts-nocheck
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isCurrentCalendarMonth } from '../src/calendar-display';

// Execute the actual classes without loading the plugin's unrelated host services.
const source = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('plugin.ts', source, ts.ScriptTarget.Latest, true);
function loadClass(name, dependencies) {
  const node = ast.statements.find((item) => ts.isClassDeclaration(item) && item.name?.text === name);
  return new Function(...Object.keys(dependencies), `${node.getText(ast)}; return ${name};`)(...Object.values(dependencies));
}

let document;
const translate = vi.fn((settings, key, values = {}) => `${settings.language}:${key}:${JSON.stringify(values)}`);
const CalendarView = loadClass('CalendarView', {
  ItemView: class {},
  t: translate,
  setIcon: () => {},
  formatCalendarMonth: (year, month) => `${year}-${month}`,
  getCalendarWeekdays: () => [],
  getCalendarGridOffset: () => 0,
  getDisplayLanguage: () => 'en',
  calendarCellTouchRouting: () => ({ showEntryCountControl: true }),
  usesPhoneLayout: () => false,
  bindOpenOnPointer: () => {},
  shouldOpenCalendarDateFromPointer: () => true,
  _daylineDate: () => '2026-09-09',
  formatDateParts: (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  shouldShowCalendarMood: () => false,
  calendarMoodMarkerClass: () => 'cal-mood-marker-dot',
  isCurrentCalendarMonth,
  Notice: class {},
});
const CreateNoteModal = loadClass('CreateNoteModal', {
  t: translate,
  Modal: class {
    constructor() { this.contentEl = document.createElement('div'); }
    close() { this.onClose(); }
  },
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
  translate.mockClear();
});

function makeView() {
  const view = Object.create(CalendarView.prototype);
  Object.assign(view, {
    contentEl: document.body.createDiv({ attr: { tabindex: '0' } }),
    displayMonth: new Date(2026, 7, 1),
    monthCache: new Map(),
    plugin: { settings: { language: 'zh', dailyFolder: 'Daily' }, journalIndex: { isReady: true } },
    weather: { hasCachedSnapshot: () => false },
    _renderMobileModeControls: () => {},
    _ensureExifTooltip: () => {},
    _renderWeatherCard: vi.fn(),
    _renderOnThisDayHeader: vi.fn(),
    _renderOnThisDayEntry: vi.fn(),
    buildMonthCache: vi.fn(async () => {}),
  });
  view.render();
  return view;
}

const control = (view, key) => view.contentEl.querySelector(`[data-calendar-focus="${key}"]`);
const focusedKey = () => document.activeElement?.getAttribute('data-calendar-focus');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }
function escape(element) {
  element.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

describe('calendar navigation focus', () => {
  it('renders weather and the on-this-day entry before the month grid', () => {
    const view = makeView();
    expect(view._renderWeatherCard).toHaveBeenCalled();
    expect(view._renderOnThisDayHeader).toHaveBeenCalled();
    expect(view._renderOnThisDayEntry).toHaveBeenCalled();
  });

  it('hides the today jump on the current month and shows it on other months', () => {
    const view = makeView();
    expect(control(view, 'today')).toBeTruthy();
    view.displayMonth = new Date(2026, 8, 1);
    view.render();
    expect(control(view, 'today')).toBeNull();
  });

  it('keeps the title focused when toggling and closing with Escape', () => {
    const view = makeView();
    control(view, 'title').click();
    expect(focusedKey()).toBe('title');
    expect(control(view, 'title').getAttribute('aria-expanded')).toBe('true');
    control(view, 'title').click();
    expect(focusedKey()).toBe('title');
    control(view, 'title').click();
    escape(control(view, 'title'));
    expect(view._calendarJumpOpen).toBe(false);
    expect(focusedKey()).toBe('title');
    control(view, 'title').click();
    control(view, 'jump-year').focus();
    escape(control(view, 'jump-year'));
    expect(view.contentEl.querySelector('.cal-jump-panel')).toBeNull();
    expect(focusedKey()).toBe('title');
  });

  it('returns an applied jump to the title and accepts years below 100', async () => {
    const view = makeView();
    control(view, 'title').click();
    control(view, 'jump-year').value = '42';
    control(view, 'jump-month').value = '2';
    control(view, 'jump-apply').click();
    await flush();
    expect(view.displayMonth.getFullYear()).toBe(42);
    expect(view.displayMonth.getMonth()).toBe(2);
    expect(focusedKey()).toBe('title');
    expect(view.contentEl.querySelector('.cal-jump-panel')).toBeNull();
  });

  it('keeps unfinished jump values through background refresh', async () => {
    const view = makeView();
    control(view, 'title').click();
    control(view, 'jump-year').value = '2031';
    control(view, 'jump-month').value = '3';
    control(view, 'jump-year').focus();
    await view.refresh();
    expect(control(view, 'jump-year').value).toBe('2031');
    expect(control(view, 'jump-month').value).toBe('3');
    expect(focusedKey()).toBe('jump-year');
  });

  it.each(['previous', 'next'])('preserves %s through asynchronous navigation', async (key) => {
    const view = makeView();
    const pending = deferred();
    view.buildMonthCache.mockReturnValueOnce(pending.promise);
    control(view, key).click();
    expect(focusedKey()).toBe(key);
    pending.resolve();
    await flush();
    expect(focusedKey()).toBe(key);
    expect(view.displayMonth.getMonth()).toBe(key === 'previous' ? 6 : 8);
  });

  it('removes the today jump after arriving at the current month', async () => {
    const view = makeView();
    const pending = deferred();
    view.buildMonthCache.mockReturnValueOnce(pending.promise);
    control(view, 'today').click();
    expect(focusedKey()).toBe('today');
    pending.resolve();
    await flush();
    expect(control(view, 'today')).toBeNull();
    expect(view.displayMonth.getMonth()).toBe(8);
  });

  it.each(['previous', 'next', 'today', 'jump-apply'])('does not reclaim focus after %s when the user moves outside', async (key) => {
    const view = makeView();
    const outside = document.body.createEl('input');
    const pending = deferred();
    view.buildMonthCache.mockReturnValueOnce(pending.promise);
    if (key === 'jump-apply') control(view, 'title').click();
    control(view, key).click();
    outside.focus();
    pending.resolve();
    await flush();
    expect(document.activeElement).toBe(outside);
  });

  it('preserves the newer navigation focus even when requests finish out of order', async () => {
    const view = makeView();
    const first = deferred(), second = deferred();
    view.buildMonthCache.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    control(view, 'previous').click();
    control(view, 'next').click();
    second.resolve();
    await flush();
    first.resolve();
    await flush();
    expect(focusedKey()).toBe('next');
    expect(view.displayMonth.getMonth()).toBe(7);
  });

  it('retains current focus through refresh and the delayed OTD repaint', async () => {
    const view = makeView();
    const dots = deferred();
    view.plugin.settings.onThisDayDot = true;
    view._otdProvider = { invalidate() {}, ensureDateIndex: () => dots.promise, dateIndexSnapshot: new Set() };
    control(view, 'today').focus();
    await view.refresh();
    expect(focusedKey()).toBe('today');
    control(view, 'title').focus();
    dots.resolve();
    await flush();
    expect(focusedKey()).toBe('title');
  });

  it('uses the focus moved during a pending refresh', async () => {
    const view = makeView();
    const pending = deferred();
    view.buildMonthCache.mockReturnValueOnce(pending.promise);
    control(view, 'previous').focus();
    const refreshing = view.refresh();
    control(view, 'today').focus();
    pending.resolve();
    await refreshing;
    expect(focusedKey()).toBe('today');
  });

  it('does not clear the newer month cache or reclaim focus when an older load fails', async () => {
    const view = makeView();
    const pending = deferred();
    view.buildMonthCache.mockReturnValueOnce(pending.promise);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      control(view, 'previous').focus();
      const navigation = view._goToMonth(-1);
      await view._goToMonth(1);
      const currentKey = view._monthKey(view.displayMonth);
      view.monthCache.set(currentKey, new Map());
      const outside = document.body.createEl('input');
      outside.focus();
      pending.reject(new Error('month load failed'));
      await navigation;
      expect(view.monthCache.has(currentKey)).toBe(true);
      expect(document.activeElement).toBe(outside);
    } finally {
      warning.mockRestore();
    }
  });

  it('keeps root shortcut focus and does not refocus a closed view', async () => {
    const view = makeView();
    view.contentEl.focus();
    await view._goToMonth(1);
    expect(document.activeElement).toBe(view.contentEl);
    const pending = deferred();
    view.buildMonthCache.mockReturnValueOnce(pending.promise);
    control(view, 'next').click();
    view.closed = true;
    view.contentEl.remove();
    const outside = document.body.createEl('input');
    outside.focus();
    pending.resolve();
    await flush();
    expect(document.activeElement).toBe(outside);
  });
});

describe('calendar localized labels', () => {
  it.each(['en', 'zh'])('uses the agreed count and weather keys with %s settings', (language) => {
    const view = makeView();
    view.plugin.settings.language = language;
    view.monthCache.set(view._monthKey(view.displayMonth), new Map([
      ['2026-08-01', { entryCount: 1, hasRecord: true, hasWeather: true }],
      ['2026-08-02', { entryCount: 3, hasRecord: true }],
    ]));
    view.render();
    const labels = [...view.contentEl.querySelectorAll('.cal-day')].map((el) => el.getAttribute('aria-label'));
    expect(labels[0]).toContain(`${language}:calendarWeatherAvailable`);
    expect(translate).toHaveBeenCalledWith(view.plugin.settings, 'calendarEntryCountOne', { count: 1 });
    expect(translate).toHaveBeenCalledWith(view.plugin.settings, 'calendarEntryCount', { count: 3 });
    expect(view.contentEl.querySelector('.cal-entry-count').getAttribute('aria-label')).toContain(`${language}:calendarEntriesOnDate`);
  });

  it.each(['en', 'zh'])('passes settings to every create-note label and preserves actions (%s)', (language) => {
    const settings = { language };
    const confirm = vi.fn();
    const modal = new CreateNoteModal({}, settings, '2026-09-09', confirm);
    modal.onOpen();
    expect(translate).toHaveBeenCalledWith(settings, 'createNoteTitle');
    expect(translate).toHaveBeenCalledWith(settings, 'createNotePrompt', { date: '2026-09-09' });
    expect(translate).toHaveBeenCalledWith(settings, 'cancel');
    expect(translate).toHaveBeenCalledWith(settings, 'createNoteAction');
    modal.contentEl.querySelector('button').click();
    expect(confirm).not.toHaveBeenCalled();
    modal.onOpen();
    modal.contentEl.querySelector('.mod-cta').click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(source).toContain('new CreateNoteModal(this.app, this.plugin.settings, dateStr,');
  });
});
