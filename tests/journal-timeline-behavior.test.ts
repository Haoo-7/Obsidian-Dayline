// @ts-nocheck
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('obsidian', () => ({
  ItemView: class {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf?.app || {};
      this.contentEl = document.createElement('div');
      this.containerEl = document.createElement('div');
      this.containerEl.append(this.contentEl);
      document.body.append(this.containerEl);
    }
  },
  Notice: class {},
  TFile: class {},
  setIcon: vi.fn(),
}));

import { TFile } from 'obsidian';
import { JournalTimelineView } from '../src/journal-timeline-view';
import { filterJournalEntries } from '../src/journal-timeline-filters';

function pointerEvent(type, clientX = 0, clientY = 0, pointerId = 1) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: pointerId },
    isPrimary: { value: true },
  });
  return event;
}

function installDomHelpers() {
  const prototype = HTMLElement.prototype;
  prototype.empty = function () { this.replaceChildren(); };
  prototype.addClass = function (...classes) { this.classList.add(...classes); };
  prototype.removeClass = function (...classes) { this.classList.remove(...classes); };
  prototype.setText = function (text) { this.textContent = text; };
  prototype.createEl = function (tag, options = {}) {
    const element = document.createElement(tag);
    if (options.text !== undefined) element.textContent = options.text;
    if (options.cls) element.classList.add(...options.cls.split(/\s+/).filter(Boolean));
    for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
    this.append(element);
    return element;
  };
  prototype.createDiv = function (options = {}) { return this.createEl('div', options); };
  prototype.createSpan = function (options = {}) { return this.createEl('span', options); };
}

function makeEntry(index) {
  const day = String((index % 28) + 1).padStart(2, '0');
  return {
    path: `Calendar/Daily/2026-07-${day}-${index}.md`,
    date: `2026-07-${day}`,
    title: `Entry ${index}`,
    excerpt: 'Body',
    attachments: [],
    media: [],
    tags: [],
    sourceId: 'daily',
    sourcePath: 'Calendar/Daily',
    sourceType: 'daily',
  };
}

function makeView(entries = []) {
  let listener;
  const index = {
    isReady: true,
    sources: [{ id: 'daily', path: 'Calendar/Daily' }],
    getEntries: () => entries,
    filter: (filter = {}) => filterJournalEntries(entries, filter),
    subscribe: (callback) => { listener = callback; return () => undefined; },
    refresh: async () => undefined,
  };
  const plugin = {
    settings: { displayLanguage: 'en', showTimelineMoodTrend: false },
    capabilities: { isMobile: false },
    journalIndex: index,
    thumbnailService: { isImageLink: () => true, loadFirst: vi.fn() },
    mediaService: { loadFirstCover: vi.fn() },
    ensureJournalIndexReady: async () => undefined,
    refreshJournalViews: vi.fn(),
  };
  const view = new JournalTimelineView({ app: {} }, plugin);
  return { view, emit: () => listener?.() };
}

describe('timeline rendered behavior', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, KeyboardEvent: dom.window.KeyboardEvent });
    installDomHelpers();
  });

  beforeEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('opens a timeline entry on pointerdown through the shared journal opener', async () => {
    const entry = makeEntry(1);
    const { view } = makeView([entry]);
    const file = new TFile();
    view.app.vault = { getAbstractFileByPath: vi.fn(() => file) };
    view.plugin.openJournalFile = vi.fn().mockResolvedValue(undefined);
    view.render();
    view.contentEl.querySelector('.journal-timeline-entry').dispatchEvent(pointerEvent('pointerdown'));
    await Promise.resolve();
    expect(view.app.vault.getAbstractFileByPath).toHaveBeenCalledWith(entry.path);
    expect(view.plugin.openJournalFile).toHaveBeenCalledWith(file);
  });

  it('does not open a timeline entry from the title control', async () => {
    const { view } = makeView([makeEntry(1)]);
    view.app.vault = { getAbstractFileByPath: vi.fn() };
    view.plugin.openJournalFile = vi.fn();
    view.render();
    view.contentEl.querySelector('.journal-timeline-entry-title').dispatchEvent(pointerEvent('pointerdown'));
    await Promise.resolve();
    expect(view.plugin.openJournalFile).not.toHaveBeenCalled();
  });

  it('ignores a coarse-pointer scroll when opening a timeline entry', async () => {
    const { view } = makeView([makeEntry(1)]);
    const file = new TFile();
    view.app.vault = { getAbstractFileByPath: () => file };
    view.plugin.capabilities = { isMobile: false, coarsePointer: true };
    view.plugin.openJournalFile = vi.fn().mockResolvedValue(undefined);
    view.render();
    const card = view.contentEl.querySelector('.journal-timeline-entry');
    card.dispatchEvent(pointerEvent('pointerdown', 10, 10));
    window.dispatchEvent(pointerEvent('pointermove', 10, 40));
    window.dispatchEvent(pointerEvent('pointerup', 10, 40));
    await Promise.resolve();
    expect(view.plugin.openJournalFile).not.toHaveBeenCalled();
    card.dispatchEvent(pointerEvent('pointerdown', 10, 10));
    window.dispatchEvent(pointerEvent('pointerup', 10, 10));
    await Promise.resolve();
    expect(view.plugin.openJournalFile).toHaveBeenCalledWith(file);
  });

  it('lets a title input receive Space without the title button preventing it', () => {
    const { view } = makeView([makeEntry(1)]);
    view.renderEntry(view.contentEl, makeEntry(1), 1);
    const editor = view.contentEl.querySelector('.journal-timeline-entry-title');
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const input = editor.querySelector('input');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('shows Title on a title-less card and keeps the editor empty', () => {
    const entry = { ...makeEntry(1), title: '' };
    const { view } = makeView([entry]);
    view.renderEntry(view.contentEl, entry, 1);
    const titleEl = view.contentEl.querySelector('.journal-timeline-entry-title');
    expect(titleEl.classList.contains('is-placeholder')).toBe(true);
    expect(titleEl.textContent).toBe('Title');
    expect(view.contentEl.querySelector('.journal-timeline-add-title')).toBeNull();

    titleEl.click();

    expect(titleEl.classList.contains('is-editing')).toBe(true);
    expect(titleEl.classList.contains('is-placeholder')).toBe(false);
    const input = titleEl.querySelector('input');
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Title');
  });

  it('localizes the untitled title placeholder', () => {
    const entry = { ...makeEntry(1), title: '' };
    const { view } = makeView([entry]);
    view.plugin.settings.displayLanguage = 'zh';
    view.renderEntry(view.contentEl, entry, 1);
    expect(view.contentEl.querySelector('.journal-timeline-entry-title').textContent).toBe('标题');
  });

  it('loads the thumbnail belonging to the intersecting observer target', async () => {
    let observerCallback;
    globalThis.IntersectionObserver = class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const entries = [makeEntry(1), makeEntry(2)];
    entries[0].attachments = ['first.jpg'];
    entries[1].attachments = ['second.jpg'];
    const { view } = makeView(entries);
    view.plugin.mediaService.loadFirstCover.mockImplementation(async (links) => ({ url: links[0].link }));
    view.renderEntry(view.contentEl, entries[0], 1);
    view.renderEntry(view.contentEl, entries[1], 1);
    const thumbnails = view.contentEl.querySelectorAll('.journal-timeline-thumbnail');

    observerCallback([{ isIntersecting: true, target: thumbnails[1] }]);
    await Promise.resolve();

    expect(view.plugin.mediaService.loadFirstCover).toHaveBeenCalledTimes(1);
    expect(view.plugin.mediaService.loadFirstCover.mock.calls[0][0][0].link).toBe('second.jpg');
  });

  it('renders a bounded first page and reveals another page on demand', () => {
    const entries = Array.from({ length: 121 }, (_, index) => makeEntry(index));
    const { view } = makeView(entries);

    view.renderList(view.contentEl, entries);
    expect(view.contentEl.querySelectorAll('.journal-timeline-entry')).toHaveLength(50);

    view.contentEl.querySelector('.journal-timeline-load-more').click();
    expect(view.contentEl.querySelectorAll('.journal-timeline-entry')).toHaveLength(100);
  });

  it('coalesces index notifications into one scheduled render', () => {
    vi.useFakeTimers();
    const { view, emit } = makeView([]);
    view.render = vi.fn();
    view.index.subscribe(() => view.scheduleRender());

    emit();
    emit();
    emit();
    expect(view.render).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(view.render).toHaveBeenCalledTimes(1);
  });

  it('keeps the filter trigger and search node focused across toggles and index refreshes', () => {
    const { view } = makeView([makeEntry(1)]);
    view.render();
    const query = view.contentEl.querySelector('input[type=search]');
    const trigger = view.contentEl.querySelector('.journal-timeline-filter-row button');
    trigger.focus();
    trigger.click();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(view.contentEl.querySelector('.journal-timeline-filter-menu').hidden).toBe(false);
    query.focus();
    query.value = 'draft search';
    query.setSelectionRange(3, 5);
    view.render();
    expect(view.contentEl.querySelector('input[type=search]')).toBe(query);
    expect(document.activeElement).toBe(query);
    expect(query.selectionStart).toBe(3);
  });

  it('removes filter chips without rebuilding the toolbar and returns focus to a surviving control', () => {
    const { view } = makeView([makeEntry(1)]);
    view.filter = { from: '2026-07-01', to: '2026-07-31' };
    view.render();
    const trigger = view.contentEl.querySelector('.journal-timeline-filter-row button');
    const chip = view.contentEl.querySelector('.journal-filter-chip');
    chip.focus();
    chip.click();
    expect(view.filter.from).toBeUndefined();
    expect(view.contentEl.querySelector('.journal-timeline-filter-row button')).toBe(trigger);
    expect(document.activeElement).toBe(view.contentEl.querySelector('.journal-filter-chip'));
    document.activeElement.click();
    expect(document.activeElement).toBe(trigger);
    expect(view.contentEl.querySelector('input[type=date]').value).toBe('');
  });

  it('groups cross-year entries by month and labels file modification times', () => {
    const entries = [
      { ...makeEntry(1), date: '2026-01-02', modifiedAt: '2026-09-01T10:00:00Z' },
      { ...makeEntry(2), date: '2025-12-31' },
    ];
    const { view } = makeView(entries);
    view.render();
    expect([...view.contentEl.querySelectorAll('.journal-timeline-month')].map(el => el.textContent))
      .toEqual(['January 2026', 'December 2025']);
    expect(view.contentEl.querySelector('article').getAttribute('aria-label')).toContain('2026');
    expect(view.contentEl.querySelector('.journal-timeline-meta').textContent).toContain('Updated');
  });

  it('preserves an active title draft through refresh and failed save, then supports retry', async () => {
    const { view } = makeView([makeEntry(1)]);
    view.plugin.saveJournalTitle = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined);
    view.render();
    view.contentEl.querySelector('.journal-timeline-entry-title').click();
    const input = view.contentEl.querySelector('.journal-timeline-entry-title input');
    input.value = 'My unsaved title';
    view.render();
    expect(view.contentEl.querySelector('.journal-timeline-entry-title input')).toBe(input);
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(view.contentEl.querySelector('[role=alert]')?.textContent).toContain('disk full'));
    expect(input.value).toBe('My unsaved title');
    expect(input.disabled).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(view.plugin.saveJournalTitle).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(view.contentEl.querySelector('.journal-timeline-entry-title input')).toBeNull());
    expect(view.plugin.saveJournalTitle).toHaveBeenLastCalledWith(makeEntry(1).path, 'My unsaved title');
  });

  it('does not write an unchanged title on blur or a cancelled title on Escape', () => {
    const { view } = makeView([makeEntry(1)]);
    view.plugin.saveJournalTitle = vi.fn();
    view.render();
    view.contentEl.querySelector('.journal-timeline-entry-title').click();
    view.contentEl.querySelector('.journal-timeline-entry-title input').blur();
    expect(view.plugin.saveJournalTitle).not.toHaveBeenCalled();
    view.contentEl.querySelector('.journal-timeline-entry-title').click();
    const input = view.contentEl.querySelector('.journal-timeline-entry-title input');
    input.value = 'discard me';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.plugin.saveJournalTitle).not.toHaveBeenCalled();
    expect(view.contentEl.querySelector('.journal-timeline-entry-title input')).toBeNull();
    expect(document.activeElement).toBe(view.contentEl.querySelector('.journal-timeline-entry-title'));
  });

  it('refreshes matching results during edits and failed saves while preserving the draft card', async () => {
    const entries = [makeEntry(1), makeEntry(2)];
    const { view } = makeView(entries);
    view.plugin.saveJournalTitle = vi.fn().mockRejectedValue(new Error('disk full'));
    view.render();
    const card = view.contentEl.querySelector('article');
    card.querySelector('.journal-timeline-entry-title').click();
    const input = card.querySelector('input');
    input.value = 'Unsaved draft';
    input.setSelectionRange(2, 6, 'backward');
    entries.push(makeEntry(3));
    view.render();
    expect(view.contentEl.querySelectorAll('.journal-timeline-list article')).toHaveLength(3);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 6, 'backward']);
    expect(view.contentEl.querySelector('article')).toBe(card);
    const search = view.filterControls.query;
    search.value = 'Entry 2';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(view.contentEl.querySelector('.journal-timeline-count').textContent).toBe('1');
    expect([...view.contentEl.querySelectorAll('.journal-timeline-list article')].map(el => el.dataset.path)).toEqual([entries[1].path]);
    expect(view.contentEl.querySelector('.journal-timeline-pending-edit article')).toBe(card);
    expect(view.contentEl.querySelector('.journal-timeline-pending-edit [role=status]')).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 6, 'backward']);
    expect(view.plugin.saveJournalTitle).not.toHaveBeenCalled();
    search.value = 'Entry';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(view.contentEl.querySelector('.journal-timeline-pending-edit')).toBeNull();
    expect([...view.contentEl.querySelectorAll('.journal-timeline-list article')].map(el => el.dataset.path))
      .toEqual(entries.map(entry => entry.path));
    expect(view.contentEl.querySelector('.journal-timeline-list article')).toBe(card);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 6, 'backward']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(card.querySelector('[role=alert]')).not.toBeNull());
    search.focus();
    search.value = 'no match';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(view.contentEl.querySelector('.journal-timeline-count').textContent).toBe('0');
    expect(view.contentEl.querySelectorAll('.journal-timeline-list article')).toHaveLength(0);
    expect(view.contentEl.querySelector('.journal-timeline-empty')).not.toBeNull();
    expect(view.contentEl.querySelector('.journal-timeline-pending-edit article')).toBe(card);
    expect(document.activeElement).toBe(search);
    expect(input.value).toBe('Unsaved draft');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.contentEl.querySelector('.journal-timeline-pending-edit')).toBeNull();
    expect(view.contentEl.querySelector('.journal-timeline-empty')).not.toBeNull();
  });

  it.each(['resolve', 'reject'])('does not steal search focus when a title save %ss', async (outcome) => {
    const { view } = makeView([makeEntry(1), makeEntry(2)]);
    let resolve, reject;
    view.plugin.saveJournalTitle = () => new Promise((yes, no) => { resolve = yes; reject = no; });
    view.render();
    view.contentEl.querySelector('.journal-timeline-entry-title').click();
    const input = view.contentEl.querySelector('.journal-timeline-entry-title input');
    input.value = 'Draft';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const search = view.filterControls.query;
    search.focus();
    search.value = 'Entry 2';
    search.setSelectionRange(1, 4);
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    if (outcome === 'resolve') resolve();
    else reject(new Error('disk full'));
    await Promise.resolve();
    expect(document.activeElement).toBe(search);
    expect([search.selectionStart, search.selectionEnd]).toEqual([1, 4]);
    expect(view.contentEl.querySelectorAll('.journal-timeline-list article')).toHaveLength(1);
    if (outcome === 'resolve') expect(view.contentEl.querySelector('.journal-timeline-pending-edit')).toBeNull();
    else expect(view.contentEl.querySelector('.journal-timeline-pending-edit input')).toBe(input);
  });

  it.each([
    ['tag', 'new-tag', { tags: ['new-tag'] }],
    ['location', 'name:paris', { location: { name: 'Paris' } }],
    ['sourceId', 'new-source', { sourceId: 'new-source' }],
  ])('refreshes deferred %s options on blur', (key, value, change) => {
    const entries = [makeEntry(1)];
    const { view } = makeView(entries);
    view.render();
    view.filterButton.click();
    const select = view.filterControls[key];
    select.focus();
    entries.push({ ...makeEntry(2), ...change });
    view.render();
    expect([...select.options].some(option => option.value === value)).toBe(false);
    view.filterControls.query.focus();
    expect([...select.options].some(option => option.value === value)).toBe(true);
    expect(document.activeElement).toBe(view.filterControls.query);
  });

  it('preserves the focused filter chip by key across index refreshes', () => {
    const { view } = makeView([makeEntry(1)]);
    view.filter = { query: 'Entry', tag: 'work' };
    view.render();
    const chip = view.contentEl.querySelectorAll('.journal-filter-chip')[1];
    chip.focus();
    view.render();
    expect(document.activeElement).toBe(view.contentEl.querySelectorAll('.journal-filter-chip')[1]);
    expect(document.activeElement.textContent).toContain('#work');
  });

  it.each(['resolve', 'reject'])('restores editor focus after disabled input falls to BODY and save %ss', async (outcome) => {
    const { view } = makeView([makeEntry(1)]);
    let resolve, reject;
    view.plugin.saveJournalTitle = () => new Promise((yes, no) => { resolve = yes; reject = no; });
    view.render();
    view.contentEl.querySelector('.journal-timeline-entry-title').click();
    const input = view.contentEl.querySelector('.journal-timeline-entry-title input');
    input.value = 'Draft';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // JSDOM does not blur a disabled input as Chromium does.
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    expect(document.activeElement).toBe(document.body);
    if (outcome === 'resolve') resolve();
    else reject(new Error('disk full'));
    await Promise.resolve();
    expect(document.activeElement).toBe(outcome === 'reject'
      ? input : view.contentEl.querySelector('.journal-timeline-entry-title'));
  });

  it('keeps a retained editing card thumbnail loadable after a results refresh', async () => {
    let callback;
    globalThis.IntersectionObserver = class {
      constructor(value) { callback = value; }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const entry = { ...makeEntry(1), attachments: ['cover.jpg'] };
    const { view } = makeView([entry]);
    view.plugin.mediaService.loadFirstCover.mockResolvedValue({ url: 'cover.jpg' });
    view.render();
    view.contentEl.querySelector('.journal-timeline-entry-title').click();
    const thumbnail = view.contentEl.querySelector('.journal-timeline-thumbnail');
    view.render();
    callback([{ isIntersecting: true, target: thumbnail }]);
    await Promise.resolve();
    expect(thumbnail.querySelector('img').getAttribute('src')).toBe('cover.jpg');
  });
});
