// @ts-nocheck
/**
 * The memory card used to render a diary title and its body as one run-on
 * paragraph, so the card read:
 *
 *     Low Tide Last Year / 去年低潮线 Same calendar date, previous year. Used to
 *     preview the merged weather-car…
 *
 * — a title indistinguishable from the first sentence of its body. These tests
 * pin the two zones down at the DOM level (title row separate from body row)
 * and at the CSS level (the two rows must not share one type treatment), plus
 * the panel seam that separates the title bar from the wall.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { installObsidianDomShim } from './setup/obsidian-dom';

vi.mock('obsidian', () => ({
  setIcon: (element: HTMLElement, name: string) => {
    const icon = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('data-icon', name);
    element.replaceChildren(icon);
  },
  Notice: class {
    constructor(public message: string) {}
  },
  TFile: class {},
}));

import { TFile } from 'obsidian';
import { OnThisDayModal, OnThisDayProvider } from '../src/on-this-day';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const CURRENT_YEAR = new Date().getUTCFullYear();

/** The sandbox note that reproduced the run-on card, in index-entry shape. */
const SPLICED_ENTRY = {
  date: `${CURRENT_YEAR - 1}-07-18`,
  path: 'Dayline Demo/Daily/2025-07-18.md',
  title: 'Low Tide Last Year / 去年低潮线',
  attachments: ['Dayline Demo/Media/dayline-01-tide.png'],
  frontmatter: { title: 'Low Tide Last Year / 去年低潮线' },
  searchText: [
    '# Low Tide Last Year / 去年低潮线',
    '',
    'Same calendar date, previous year. Used to preview the merged weather-card entry.',
    '',
    '![[Dayline Demo/Media/dayline-01-tide.png]]',
  ].join('\n'),
};

function createProvider(entries: any[], settings: Record<string, unknown> = {}) {
  return new OnThisDayProvider({
    settings: { weatherTimezone: 'UTC', onThisDayExcerptMode: 'auto', ...settings },
    journalIndex: { getEntries: () => entries },
  });
}

function createPlugin() {
  return {
    settings: {
      weatherTimezone: 'UTC',
      weatherLanguage: 'zh',
      dailyFolder: 'Dayline Demo/Daily',
      onThisDayEntry: 'merged',
    },
    thumbnailService: { load: async () => ({ url: 'blob:dayline-thumb' }) },
    // Mirrors the real plugin: reuse the reader's journal leaf, never split.
    openJournalFile: vi.fn(async (file: unknown) => ({ file })),
  };
}

/** Extract one rule body at the start of a line, e.g. `.cal-otd-wall-title`. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped} \\{`, 'm').exec(source);
  expect(match, `missing rule: ${selector}`).not.toBeNull();
  const start = match.index;
  const end = source.indexOf('}', start);
  return source.slice(start, end);
}

/** Extract a balanced `@media (...) { … }` body so gating can be asserted. */
function mediaBlock(source: string, query: string): string {
  const start = source.indexOf(`@media ${query}`);
  expect(start, `missing media query: ${query}`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index);
    }
  }
  throw new Error(`unbalanced media query: ${query}`);
}

describe('On This Day card: title zone vs body zone', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      HTMLElement: dom.window.HTMLElement,
      Event: dom.window.Event,
      KeyboardEvent: dom.window.KeyboardEvent,
    });
    installObsidianDomShim(dom.window);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function render(settings: Record<string, unknown> = {}) {
    const provider = createProvider([SPLICED_ENTRY], settings);
    const plugin = createPlugin();
    return provider.getEntries(7, 18).then((resolved) => {
      const modal = new OnThisDayModal({}, plugin, provider, 7, 18, resolved);
      modal.open();
      return { modal, plugin };
    });
  }

  /** An app whose vault resolves the memory's path to `file` (null = deleted). */
  function createApp(file: unknown) {
    return {
      vault: { getAbstractFileByPath: vi.fn(() => file) },
      workspace: {
        getLeaf: vi.fn(() => ({ openFile: vi.fn() })),
        openLinkText: vi.fn(),
      },
    };
  }

  /** Open the memory card through the real click path and let it settle. */
  async function clickCard(app: unknown, plugin: unknown) {
    const provider = createProvider([SPLICED_ENTRY]);
    const entries = await provider.getEntries(7, 18);
    const modal = new OnThisDayModal(app, plugin, provider, 7, 18, entries);
    modal.open();
    document.querySelector('.cal-otd-wall-card').dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('renders the diary title and the body as two separate rows', async () => {
    await render();

    const text = document.querySelector('.cal-otd-wall-text');
    expect(text).not.toBeNull();
    const title = text.querySelector('.cal-otd-wall-title');
    const excerpt = text.querySelector('.cal-otd-wall-excerpt');

    expect(title?.textContent).toBe('Low Tide Last Year / 去年低潮线');
    expect(excerpt?.textContent).toBe('Same calendar date, previous year. Used to preview the merged weather-card entry.');
    // The regression: the title must not leak into the body row.
    expect(excerpt?.textContent).not.toContain('Low Tide Last Year');
    expect(title?.nextElementSibling).toBe(excerpt);
  });

  it('keeps the title out of every excerpt mode, including template {body}', async () => {
    for (const settings of [
      { onThisDayExcerptMode: 'auto' },
      { onThisDayExcerptMode: 'template', onThisDayExcerptTemplate: '{year} · {body}' },
    ]) {
      await render(settings);
      const excerpt = document.querySelector('.cal-otd-wall-excerpt');
      expect(excerpt?.textContent, JSON.stringify(settings)).not.toContain('Low Tide Last Year');
      document.body.innerHTML = '';
    }
  });

  it('exposes the card as a keyboard-reachable button that names what it opens', async () => {
    await render();

    const card = document.querySelector('.cal-otd-wall-card');
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.getAttribute('title')).toBe('打开笔记');
    expect(card.getAttribute('aria-label')).toContain('Low Tide Last Year / 去年低潮线');
  });

  it('replaces the open journal note instead of growing the workspace a pane', async () => {
    const file = new TFile();
    const app = createApp(file);
    const plugin = createPlugin();

    await clickCard(app, plugin);

    // Same route the calendar cell and the timeline card take: reuse the
    // reader's Markdown leaf via the plugin's journal-open policy.
    expect(plugin.openJournalFile).toHaveBeenCalledWith(file);
    expect(app.workspace.getLeaf).not.toHaveBeenCalledWith('split');
    expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    // The wall is dismissed on the way out.
    expect(document.querySelector('.cal-otd-modal')).toBeNull();
  });

  it('still falls back to a link open when the indexed path is gone', async () => {
    const app = createApp(null);
    const plugin = createPlugin();

    await clickCard(app, plugin);

    expect(plugin.openJournalFile).not.toHaveBeenCalled();
    expect(app.workspace.getLeaf).not.toHaveBeenCalledWith('split');
    expect(app.workspace.openLinkText).toHaveBeenCalledWith(
      SPLICED_ENTRY.date,
      'Dayline Demo/Daily',
      false,
    );
  });

  it('counts the extra photos so a multi-image day is not silently cropped', async () => {
    const provider = createProvider([
      { ...SPLICED_ENTRY, attachments: ['a.png', 'b.png', 'c.png'] },
    ]);
    const entries = await provider.getEntries(7, 18);
    new OnThisDayModal({}, createPlugin(), provider, 7, 18, entries).open();

    expect(document.querySelector('.cal-otd-wall-count')?.textContent).toBe('+2');
  });

  it('labels the badge from today, the same rule the merged strip uses', async () => {
    const provider = createProvider([
      { ...SPLICED_ENTRY, date: `${CURRENT_YEAR - 2}-07-18`, path: 'older.md' },
    ]);
    const entries = await provider.getEntries(7, 18);
    new OnThisDayModal({}, createPlugin(), provider, 7, 18, entries).open();

    expect(document.querySelector('.cal-otd-wall-badge')?.textContent).toBe(`2年前  ·  ${CURRENT_YEAR - 2}`);
  });

  it('leaves a photo-only card without a text row, and marks a truly empty one', async () => {
    const photoOnly = createProvider([
      { date: `${CURRENT_YEAR - 1}-07-18`, path: 'x.md', attachments: ['a.png'], searchText: '![[a.png]]\n' },
    ]);
    const photoEntries = await photoOnly.getEntries(7, 18);
    new OnThisDayModal({}, createPlugin(), photoOnly, 7, 18, photoEntries).open();
    expect(document.querySelector('.cal-otd-wall-photo')).not.toBeNull();
    expect(document.querySelector('.cal-otd-wall-text')).toBeNull();
    document.body.innerHTML = '';

    // No photo and no text: the card must not collapse to a bare year badge.
    const empty = createProvider([
      { date: `${CURRENT_YEAR - 1}-07-18`, path: 'y.md', attachments: [], searchText: '' },
    ]);
    const emptyEntries = await empty.getEntries(7, 18);
    new OnThisDayModal({}, createPlugin(), empty, 7, 18, emptyEntries).open();

    expect(document.querySelector('.cal-otd-wall-excerpt.is-empty')?.textContent).toBe('（无文字内容）');
  });

  it('gives the no-memories state an icon and a message instead of one bare sentence', () => {
    new OnThisDayModal({}, createPlugin(), null, 7, 18, []).open();

    expect(document.querySelector('.cal-otd-empty-icon svg')?.getAttribute('data-icon')).toBe('history');
    expect(document.querySelector('.cal-otd-empty-title')?.textContent).toBe('还没有往年的今天');
  });
});

describe('On This Day card CSS contract', () => {
  it('separates the panel title bar from the memory wall', () => {
    expect(ruleBody(styles, '.cal-otd-header')).toContain('border-bottom: 1px solid var(--background-modifier-border)');
  });

  it('types the title and the body differently', () => {
    const title = ruleBody(styles, '.cal-otd-wall-title');
    const excerpt = ruleBody(styles, '.cal-otd-wall-excerpt');

    expect(title).toContain('font-weight: 600');
    expect(title).toContain('color: var(--text-normal)');
    expect(title).toContain('font-size: 13px');
    expect(excerpt).toContain('color: var(--text-muted)');
    expect(excerpt).toContain('font-size: 12px');
    expect(excerpt).not.toContain('font-weight: 600');
  });

  it('gates the hover ring behind a real hovering pointer', () => {
    const hover = mediaBlock(styles, '(hover: hover) and (pointer: fine)');
    expect(hover).toContain('.cal-otd-wall-card:hover');
    // A tap must not paint the ring: the plain rule must be gone.
    expect(styles).not.toMatch(/\n\.cal-otd-wall-card:hover\s*\{/);
  });

  it('keeps focus visible and press feedback for the card', () => {
    expect(ruleBody(styles, '.cal-otd-wall-card:focus-visible')).toContain('outline: 2px solid var(--interactive-accent)');
    expect(ruleBody(styles, '.cal-otd-wall-card:active')).toContain('transform: scale(0.99)');
  });

  it('lets a single memory fill the wall instead of leaving a hole', () => {
    expect(ruleBody(styles, '.cal-otd-grid')).toContain('grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))');
    expect(ruleBody(styles, '.cal-otd-wall-photo')).toContain('max-height: 320px');
  });

  it('disables the panel entrance animation under reduced motion', () => {
    const modalSection = styles.slice(styles.indexOf('.cal-otd-modal'), styles.indexOf('.cal-otd-header-title'));
    expect(ruleBody(styles, '.cal-otd-panel')).toContain('animation: cal-otd-panel-in 200ms');
    expect(modalSection).toContain('@media (prefers-reduced-motion: reduce)');
    expect(modalSection).toContain('.cal-otd-panel { animation: none; }');
  });
});
