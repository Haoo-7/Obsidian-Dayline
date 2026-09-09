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

import { JournalTimelineView } from '../src/journal-timeline-view';

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
    filter: () => entries,
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
});
