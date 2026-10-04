// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as calendarDisplay from '../src/calendar-display';
import * as dateUtils from '../src/date-utils';
import * as daylineMobile from '../src/dayline-mobile';
import * as onThisDayEntry from '../src/on-this-day-entry';
import * as viewVisibility from '../src/view-visibility-controller';
import * as pluginIdentity from '../src/plugin-identity';
import {
  DAYLINE_VIEW_TYPES,
  MOBILE_DAYLINE_VIEW,
  createSerialMobileDaylineModeController,
  getDaylineLeaves,
  getJournalOpenLeaf,
  getMobileDaylineLeaf,
  getMobileDaylineViewType,
  getMobileMarkdownLeaf,
  getPreferredDaylineLeaf,
  isMainAreaLeaf,
  normalizeDaylineMobileMode,
  renderMobileDaylineModeControls,
  resolveMobileJournalLeaf,
  setMobileDaylineLeafView,
} from '../src/dayline-mobile';

const CALENDAR_VIEW = 'calendar-sidebar-view';
const TIMELINE_VIEW = 'journal-timeline-view';
const DAYLINE_VIEW_TYPES_LOCAL = [CALENDAR_VIEW, TIMELINE_VIEW, MOBILE_DAYLINE_VIEW] as const;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

/* ------------------------------------------------------------------------ *
 * Minimal Obsidian harness.
 *
 * `src/plugin.ts` is CommonJS (`require`) with TypeScript syntax, so it cannot
 * be imported by Vite and its `require('obsidian')` bypasses module mocks. It is
 * therefore transpiled with the TypeScript compiler and evaluated with a stub
 * `require`, which lets the regression tests below exercise real plugin methods
 * instead of asserting on source text. Only pure helpers are shared with the
 * plugin (date-utils, plugin-identity); everything else is stubbed.
 * ------------------------------------------------------------------------ */

const noticeMessages: string[] = [];

class HarnessPlugin {}
class HarnessItemView {
  leaf: unknown;
  constructor(leaf: unknown) {
    this.leaf = leaf;
  }
}
class HarnessTFile {}
class HarnessModal {}
class HarnessMenu {}
class HarnessNotice {
  constructor(message: unknown) {
    noticeMessages.push(String(message));
  }
}

const obsidianStub = {
  Plugin: HarnessPlugin,
  ItemView: HarnessItemView,
  TFile: HarnessTFile,
  Modal: HarnessModal,
  Menu: HarnessMenu,
  Notice: HarnessNotice,
  setIcon: () => undefined,
  Platform: { isMobile: true, isPhone: true },
  normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/{2,}/g, '/'),
};

const i18nStub = {
  t: (_settings: unknown, key: string) => (typeof key === 'string' ? key : ''),
  getDisplayLanguage: (settings: { displayLanguage?: string } | null | undefined) => settings?.displayLanguage || 'en',
  normalizeDisplayLanguageSetting: () => 'en',
  moodLabel: (value: unknown) => String(value),
  formatCalendarMonth: () => '',
  getCalendarGridOffset: () => 0,
  getCalendarWeekdays: () => [],
  LOCALE_TAGS: {},
};

type PluginOverrides = Record<string, unknown>;

function loadPluginClass(overrides: PluginOverrides = {}): any {
  const source = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} as { default?: unknown } };
  const requireStub = (id: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
    if (id === 'obsidian') return obsidianStub;
    if (id === './i18n') return i18nStub;
    if (id === './date-utils') return dateUtils;
    if (id === './dayline-mobile') return daylineMobile;
    if (id === './calendar-display') return calendarDisplay;
    if (id === './on-this-day-entry') return onThisDayEntry;
    if (id === './view-visibility-controller') return viewVisibility;
    if (id === './plugin-identity') return pluginIdentity;
    if (id.endsWith('?raw')) return '';
    return {};
  };
  const evaluate = new Function('require', 'module', 'exports', outputText);
  evaluate(requireStub, module, module.exports);
  return module.exports.default;
}

let cachedPluginClass: any = null;
function defaultPluginClass(): any {
  if (!cachedPluginClass) cachedPluginClass = loadPluginClass();
  return cachedPluginClass;
}

function createPlugin(overrides: PluginOverrides = {}): any {
  const DaylinePlugin = Object.keys(overrides).length > 0 ? loadPluginClass(overrides) : defaultPluginClass();
  const plugin: any = Object.create(DaylinePlugin.prototype);
  plugin.app = { workspace: {} };
  plugin.settings = { dailyFolder: 'Calendar/Daily', weatherTimezone: 'UTC' };
  return plugin;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  noticeMessages.length = 0;
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('mobile Dayline routing', () => {
  it('reuses the active real Dayline leaf before querying workspace topology', () => {
    const activeLeaf = { id: 'dayline', view: { getViewType: () => TIMELINE_VIEW } };
    const workspace = {
      activeLeaf,
      getLeavesOfType: vi.fn(),
      getLeaf: vi.fn(),
      getLeftLeaf: vi.fn(() => { throw new Error('mobile must not use sidebar routing'); }),
    };

    expect(getMobileDaylineLeaf(workspace, DAYLINE_VIEW_TYPES_LOCAL)).toBe(activeLeaf);
    expect(workspace.getLeavesOfType).not.toHaveBeenCalled();
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(workspace.getLeftLeaf).not.toHaveBeenCalled();
  });

  it('reuses an existing real Dayline leaf before creating a tab', () => {
    const existing = { id: 'dayline', view: { getViewType: () => CALENDAR_VIEW } };
    const workspace = {
      activeLeaf: { id: 'note', view: { getViewType: () => 'markdown' } },
      getLeavesOfType: vi.fn((type: string) => type === CALENDAR_VIEW ? [existing] : []),
      getLeaf: vi.fn(),
    };

    expect(getMobileDaylineLeaf(workspace, DAYLINE_VIEW_TYPES_LOCAL)).toBe(existing);
    expect(workspace.getLeavesOfType).toHaveBeenCalledWith(CALENDAR_VIEW);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
  });

  it('creates a normal tab without touching sidebar routing APIs', () => {
    const created = { id: 'new-dayline' };
    const workspace = {
      getLeavesOfType: vi.fn(() => []),
      getLeaf: vi.fn((kind: string) => kind === 'tab' ? created : null),
      getLeftLeaf: vi.fn(() => { throw new Error('mobile must not use getLeftLeaf'); }),
    };

    expect(getMobileDaylineLeaf(workspace, DAYLINE_VIEW_TYPES_LOCAL)).toBe(created);
    expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(workspace.getLeftLeaf).not.toHaveBeenCalled();
  });

  it('switches calendar and timeline on the same real leaf', async () => {
    let currentType = CALENDAR_VIEW;
    const leaf = {
      view: { getViewType: () => currentType },
      setViewState: vi.fn(async (state: { type: string }) => { currentType = state.type; }),
    };

    await setMobileDaylineLeafView(leaf, TIMELINE_VIEW);
    await setMobileDaylineLeafView(leaf, CALENDAR_VIEW);

    expect(leaf.setViewState).toHaveBeenNthCalledWith(1, { type: TIMELINE_VIEW, active: true });
    expect(leaf.setViewState).toHaveBeenNthCalledWith(2, { type: CALENDAR_VIEW, active: true });
    expect(currentType).toBe(CALENDAR_VIEW);
  });

  it('does not recreate a matching real view state', async () => {
    const leaf = {
      view: { getViewType: () => CALENDAR_VIEW },
      setViewState: vi.fn(),
    };

    await expect(setMobileDaylineLeafView(leaf, CALENDAR_VIEW)).resolves.toBe(leaf);
    expect(leaf.setViewState).not.toHaveBeenCalled();
  });

  it('serializes real leaf transitions and records the mode that actually settled', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    let currentType = CALENDAR_VIEW;
    const applied: string[] = [];
    const leaf = {
      view: { getViewType: () => currentType },
      setViewState: vi.fn((state: { type: string }) => {
        const gate = state.type === TIMELINE_VIEW ? first : second;
        return gate.promise.then(() => { currentType = state.type; });
      }),
    };
    const revealLeaf = vi.fn(async () => undefined);
    const controller = createSerialMobileDaylineModeController({
      getLeaf: () => leaf,
      getViewType: (mode) => getMobileDaylineViewType(mode, CALENDAR_VIEW, TIMELINE_VIEW),
      revealLeaf,
      onApplied: (transition) => applied.push(transition.mode),
    });

    const timeline = controller.request('timeline');
    const calendar = controller.request('calendar');

    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalledTimes(1));
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: TIMELINE_VIEW, active: true });
    expect(applied).toEqual([]);

    first.resolve();
    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalledTimes(2));
    expect(leaf.setViewState).toHaveBeenLastCalledWith({ type: CALENDAR_VIEW, active: true });
    second.resolve();

    await expect(timeline).resolves.toMatchObject({ leaf, mode: 'timeline', viewType: TIMELINE_VIEW });
    await expect(calendar).resolves.toMatchObject({ leaf, mode: 'calendar', viewType: CALENDAR_VIEW });
    expect(revealLeaf).toHaveBeenCalledTimes(2);
    expect(applied).toEqual(['timeline', 'calendar']);
    expect(currentType).toBe(CALENDAR_VIEW);
  });

  it('continues queued transitions after a failed view change without reporting a false settled mode', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    let currentType = MOBILE_DAYLINE_VIEW;
    const applied: string[] = [];
    const leaf = {
      view: { getViewType: () => currentType },
      setViewState: vi.fn((state: { type: string }) => {
        const gate = state.type === TIMELINE_VIEW ? first : second;
        return gate.promise.then(() => { currentType = state.type; });
      }),
    };
    const controller = createSerialMobileDaylineModeController({
      getLeaf: () => leaf,
      getViewType: (mode) => getMobileDaylineViewType(mode, CALENDAR_VIEW, TIMELINE_VIEW),
      onApplied: (transition) => applied.push(transition.mode),
    });

    const timeline = controller.request('timeline');
    const calendar = controller.request('calendar');
    void timeline.catch(() => undefined);

    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalledTimes(1));
    first.reject(new Error('timeline leaf failed'));
    await expect(timeline).rejects.toThrow('timeline leaf failed');
    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalledTimes(2));
    second.resolve();

    await expect(calendar).resolves.toMatchObject({ leaf, mode: 'calendar', viewType: CALENDAR_VIEW });
    expect(applied).toEqual(['calendar']);
    expect(currentType).toBe(CALENDAR_VIEW);
  });

  it('records a successful view change before reveal fails and continues the queue without running its after-apply work', async () => {
    let currentType = MOBILE_DAYLINE_VIEW;
    const applied: string[] = [];
    const afterApply = vi.fn();
    const revealFailure = new Error('reveal failed');
    let revealCalls = 0;
    const leaf = {
      view: { getViewType: () => currentType },
      setViewState: vi.fn(async (state: { type: string }) => { currentType = state.type; }),
    };
    const controller = createSerialMobileDaylineModeController({
      getLeaf: () => leaf,
      getViewType: (mode) => getMobileDaylineViewType(mode, CALENDAR_VIEW, TIMELINE_VIEW),
      revealLeaf: vi.fn(() => {
        revealCalls++;
        return revealCalls === 1 ? Promise.reject(revealFailure) : Promise.resolve();
      }),
      onApplied: (transition) => applied.push(transition.mode),
    });

    const timeline = controller.request('timeline', null, afterApply);
    const calendar = controller.request('calendar');
    void timeline.catch(() => undefined);

    await expect(timeline).rejects.toThrow('reveal failed');
    await expect(calendar).resolves.toMatchObject({ leaf, mode: 'calendar', viewType: CALENDAR_VIEW });
    expect(applied).toEqual(['timeline', 'calendar']);
    expect(afterApply).not.toHaveBeenCalled();
    expect(currentType).toBe(CALENDAR_VIEW);
  });

  it('applies a timeline date filter before a later queued mode change can rebuild the leaf', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const firstReveal = deferred<void>();
    const secondReveal = deferred<void>();
    let currentType = CALENDAR_VIEW;
    const filterCalls: string[] = [];
    const leaf: any = {
      view: { getViewType: () => currentType },
      setViewState: vi.fn((state: { type: string }) => {
        const gate = state.type === TIMELINE_VIEW ? first : second;
        return gate.promise.then(() => {
          currentType = state.type;
          leaf.view = state.type === TIMELINE_VIEW
            ? { getViewType: () => currentType, setDateFilter: (date: string) => filterCalls.push(date) }
            : { getViewType: () => currentType };
        });
      }),
    };
    const controller = createSerialMobileDaylineModeController({
      getLeaf: () => leaf,
      getViewType: (mode) => getMobileDaylineViewType(mode, CALENDAR_VIEW, TIMELINE_VIEW),
      revealLeaf: vi.fn(() => currentType === TIMELINE_VIEW ? firstReveal.promise : secondReveal.promise),
    });

    const timeline = controller.request('timeline', null, ({ leaf: activeLeaf }) => activeLeaf.view.setDateFilter('2026-07-20'));
    const calendar = controller.request('calendar');

    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalledTimes(1));
    first.resolve();
    await vi.waitFor(() => expect(currentType).toBe(TIMELINE_VIEW));
    expect(filterCalls).toEqual([]);
    expect(leaf.setViewState).toHaveBeenCalledTimes(1);
    firstReveal.resolve();
    await vi.waitFor(() => expect(filterCalls).toEqual(['2026-07-20']));
    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalledTimes(2));
    second.resolve();
    secondReveal.resolve();

    await expect(timeline).resolves.toMatchObject({ mode: 'timeline' });
    await expect(calendar).resolves.toMatchObject({ mode: 'calendar' });
    expect(filterCalls).toEqual(['2026-07-20']);
  });

  it('reports a rejected mode-control callback instead of leaving a rejected UI promise', async () => {
    const handlers: Array<() => void> = [];
    const onError = vi.fn();
    const parent = {
      createDiv: vi.fn(() => ({
        createEl: vi.fn(() => ({
          toggleClass: vi.fn(),
          addEventListener: (_type: string, callback: () => void) => handlers.push(callback),
        })),
      })),
    };
    const failure = new Error('switch failed');

    renderMobileDaylineModeControls(parent, {
      activeMode: 'calendar',
      labels: { calendar: 'Calendar', timeline: 'Timeline' },
      onSelect: () => Promise.reject(failure),
      onError,
    });
    handlers[1]();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure, 'timeline'));
  });

  it('maps legacy mobile mode state onto real registered view types', () => {
    expect(getMobileDaylineViewType('calendar', CALENDAR_VIEW, TIMELINE_VIEW)).toBe(CALENDAR_VIEW);
    expect(getMobileDaylineViewType('timeline', CALENDAR_VIEW, TIMELINE_VIEW)).toBe(TIMELINE_VIEW);
    expect(getMobileDaylineViewType('unknown', CALENDAR_VIEW, TIMELINE_VIEW)).toBe(CALENDAR_VIEW);
    expect(normalizeDaylineMobileMode('timeline')).toBe('timeline');
    expect(normalizeDaylineMobileMode('unknown')).toBe('calendar');
  });

  it('opens a mobile journal note in a Markdown tab rather than replacing Dayline', () => {
    const markdown = { id: 'note', view: { getViewType: () => 'markdown' } };
    const workspace = {
      activeLeaf: { id: 'dayline', view: { getViewType: () => CALENDAR_VIEW } },
      getLeavesOfType: vi.fn((type: string) => type === 'markdown' ? [markdown] : []),
      getLeaf: vi.fn(() => { throw new Error('must reuse Markdown before creating a tab'); }),
    };
    expect(getMobileMarkdownLeaf(workspace)).toBe(markdown);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
  });

  it('creates a normal mobile tab for a journal note when no Markdown tab exists', () => {
    const tab = { id: 'new-note' };
    const workspace = {
      activeLeaf: { id: 'dayline', view: { getViewType: () => TIMELINE_VIEW } },
      getLeavesOfType: vi.fn(() => []),
      getLeaf: vi.fn((kind: string) => kind === 'tab' ? tab : null),
      getLeftLeaf: vi.fn(() => { throw new Error('mobile must not use sidebar routing'); }),
    };
    expect(getMobileMarkdownLeaf(workspace)).toBe(tab);
    expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(workspace.getLeftLeaf).not.toHaveBeenCalled();
  });

  it('reuses once-created mobile leaves for later dates instead of new tabs', () => {
    const first = { id: 'first-note', openFile: vi.fn() };
    const second = { id: 'second-note', openFile: vi.fn() };
    const workspace = {
      activeLeaf: { id: 'dayline', view: { getViewType: () => CALENDAR_VIEW } },
      getLeavesOfType: vi.fn(() => []),
      getLeaf: vi.fn((kind: string) => kind === 'tab' ? first : null),
    };

    expect(getJournalOpenLeaf(workspace, true, second)).toBe(second);
    expect(getJournalOpenLeaf(workspace, true, null)).toBe(first);
    expect(workspace.getLeaf).toHaveBeenCalledTimes(1);
  });

  it('finds the right-drawer leaf when Dayline is already open there', () => {
    const right = { id: 'right-drawer', view: { getViewType: () => CALENDAR_VIEW } };
    const workspace = {
      getLeavesOfType: vi.fn((type: string) => type === CALENDAR_VIEW ? [right] : []),
      getRightLeaf: vi.fn(),
    };

    expect(DAYLINE_VIEW_TYPES).toEqual([CALENDAR_VIEW, TIMELINE_VIEW, MOBILE_DAYLINE_VIEW]);
    expect(getPreferredDaylineLeaf(workspace)).toBe(right);
    expect(workspace.getRightLeaf).not.toHaveBeenCalled();
    expect(getDaylineLeaves(workspace)).toEqual([right]);
  });

  it('opens Dayline in the right drawer before creating a tab', () => {
    const drawer = { id: 'drawer' };
    const plugin = createPlugin();
    plugin.app = {
      workspace: {
        activeLeaf: null,
        rootSplit: {},
        getLeavesOfType: vi.fn(() => []),
        getRightLeaf: vi.fn((split: boolean) => split ? null : drawer),
      },
    };

    expect(plugin._openDaylineDrawerLeaf()).toBe(drawer);
    expect(plugin.app.workspace.getRightLeaf).toHaveBeenCalledWith(false);
  });

  /* P-01: the Dayline drawer leaf must never host a journal note. */
  it('never uses the Dayline drawer leaf as the phone note target', () => {
    const mainRoot = { id: 'main' };
    const drawerRoot = { id: 'right-drawer' };
    const emptyMain = {
      id: 'main-empty',
      view: { getViewType: () => 'empty' },
      getRoot: () => mainRoot,
      openFile: vi.fn(),
    };
    const drawer = {
      id: 'drawer-calendar',
      view: { getViewType: () => CALENDAR_VIEW },
      getRoot: () => drawerRoot,
      openFile: vi.fn(),
      setViewState: vi.fn(),
    };
    const workspace = {
      rootSplit: mainRoot,
      activeLeaf: drawer,
      getLeavesOfType: vi.fn((type: string) => {
        if (type === 'empty') return [emptyMain];
        if (type === CALENDAR_VIEW) return [drawer];
        return [];
      }),
      getLeaf: vi.fn(() => { throw new Error('must reuse the empty main-area leaf'); }),
    };

    // The drawer leaf is offered both directly and through the remembered-leaf path.
    expect(getJournalOpenLeaf(workspace, true, drawer)).toBe(emptyMain);
    expect(resolveMobileJournalLeaf(workspace, drawer)).toBe(emptyMain);
    expect(drawer.setViewState).not.toHaveBeenCalled();
    expect(workspace.getLeaf).not.toHaveBeenCalled();
  });

  /* P-01: two dates must not pile up drawer leaves or replace the calendar. */
  it('keeps the Dayline drawer leaf on the calendar across two journal dates', async () => {
    const mainRoot = { id: 'main' };
    const drawerRoot = { id: 'right-drawer' };
    const emptyMain = {
      id: 'main-empty',
      view: { getViewType: () => 'empty' },
      getRoot: () => mainRoot,
      openFile: vi.fn(async () => undefined),
    };
    const drawer = {
      id: 'drawer-calendar',
      view: { getViewType: () => CALENDAR_VIEW },
      getRoot: () => drawerRoot,
      openFile: vi.fn(async () => undefined),
    };
    const workspace = {
      rootSplit: mainRoot,
      activeLeaf: drawer,
      getLeavesOfType: vi.fn((type: string) => (type === 'empty' ? [emptyMain] : [])),
      getLeaf: vi.fn(() => { throw new Error('must reuse the main-area leaf'); }),
    };

    let remembered: any = null;
    const opened: string[] = [];
    for (const date of ['2026-09-28', '2026-09-29']) {
      const leaf = resolveMobileJournalLeaf(workspace, remembered);
      expect(leaf).toBe(emptyMain);
      if (!remembered && isMainAreaLeaf(workspace, leaf)) remembered = leaf;
      await leaf.openFile({ path: `Calendar/Daily/${date}.md` });
      opened.push(date);
    }

    expect(opened).toEqual(['2026-09-28', '2026-09-29']);
    expect(emptyMain.openFile).toHaveBeenCalledTimes(2);
    expect(drawer.openFile).not.toHaveBeenCalled();
    expect(drawer.view.getViewType()).toBe(CALENDAR_VIEW);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
  });

  /* P-03: a remembered journal leaf that was closed is never reused. */
  it('drops a recorded journal leaf that is no longer attached', () => {
    const created = { id: 'new-note', view: { getViewType: () => 'empty' } };
    const detached = { id: 'closed-note', view: { getViewType: () => 'markdown' }, openFile: vi.fn() };
    const workspace = {
      activeLeaf: null,
      getLeavesOfType: vi.fn(() => []),
      getLeaf: vi.fn((kind: string) => (kind === 'tab' ? created : null)),
    };

    expect(resolveMobileJournalLeaf(workspace, detached)).toBe(created);
    expect(detached.openFile).not.toHaveBeenCalled();
  });

  it('clears a remembered journal leaf that was closed or retyped', () => {
    const plugin = createPlugin();
    plugin.app = { workspace: { getLeavesOfType: () => [] } };

    plugin._mobileJournalLeaf = { view: { getViewType: () => 'markdown' } };
    expect(plugin._getMobileJournalLeaf()).toBeNull();
    expect(plugin._mobileJournalLeaf).toBeNull();

    plugin._mobileJournalLeaf = { parent: {}, view: { getViewType: () => CALENDAR_VIEW } };
    expect(plugin._getMobileJournalLeaf()).toBeNull();
    expect(plugin._mobileJournalLeaf).toBeNull();
  });

  /* P-04: synchronous DOM cleanup must happen even when a flush rejects. */
  it('clears DOM state on unload even when a cache flush rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.body.classList.add('dayline-mobile', 'dayline-phone');
    const overlay = document.createElement('div');
    overlay.setAttribute('data-cal-weather-overlay', '1');
    document.body.appendChild(overlay);

    const plugin = createPlugin();
    plugin._overlayRegistry = { clear: vi.fn() };
    plugin._overlayOriginalPositions = new Map();
    plugin._hostPositionMarkers = new Set();
    plugin._journalWriteQueue = { flush: vi.fn(async () => undefined) };
    plugin.viewVisibilityController = { unload: vi.fn(async () => undefined) };
    plugin.moodStore = { flush: vi.fn(() => Promise.reject(new Error('mood flush failed'))) };
    plugin._flushWeatherCache = vi.fn(() => Promise.reject(new Error('saveData failed')));
    plugin._flushGeocoderCache = vi.fn(async () => undefined);

    await plugin.onunload();

    expect(document.body.classList.contains('dayline-mobile')).toBe(false);
    expect(document.body.classList.contains('dayline-phone')).toBe(false);
    expect(document.querySelectorAll('[data-cal-weather-overlay]')).toHaveLength(0);
    expect(plugin._flushGeocoderCache).toHaveBeenCalledTimes(1);
    expect(plugin.moodStore.flush).toHaveBeenCalledTimes(1);
    expect(plugin.viewVisibilityController.unload).toHaveBeenCalledTimes(1);
  });

  /* P-05: an external data.json write must survive a debounced cache flush. */
  it('merges a debounced cache flush with entries written to data.json externally', async () => {
    const plugin = createPlugin();
    const disk = {
      dailyFolder: 'Calendar/Daily',
      weatherCache: { '2026-01-01': { fetchedAt: '2026-01-01T00:00:00.000Z', external: true } },
      geocoderCache: { '1.000,2.000': { place: 'External', at: '2026-01-01T00:00:00.000Z' } },
    };
    plugin.loadData = vi.fn(async () => JSON.parse(JSON.stringify(disk)));
    let saved: any = null;
    plugin.saveData = vi.fn(async (data: any) => {
      saved = data;
      // Mimic the write that Obsidian persists, so the later flush re-reads it.
      Object.assign(disk, JSON.parse(JSON.stringify(data)));
    });
    plugin._dataWriteQueue = Promise.resolve();
    plugin.weatherCache = { '2026-09-29': { fetchedAt: '2026-09-29T00:00:00.000Z', local: true } };
    plugin.geocoderCache = { '3.000,4.000': { place: 'Local', at: '2026-09-29T00:00:00.000Z' } };

    await plugin._flushWeatherCache();
    await plugin._flushGeocoderCache();

    expect(saved.weatherCache['2026-09-29']).toEqual({ fetchedAt: '2026-09-29T00:00:00.000Z', local: true });
    expect(saved.weatherCache['2026-01-01']).toEqual({ fetchedAt: '2026-01-01T00:00:00.000Z', external: true });
    expect(saved.geocoderCache['3.000,4.000']).toEqual({ place: 'Local', at: '2026-09-29T00:00:00.000Z' });
    expect(saved.geocoderCache['1.000,2.000']).toEqual({ place: 'External', at: '2026-01-01T00:00:00.000Z' });
  });

  /* P-05: Obsidian Sync rewrites are re-read instead of being overwritten. */
  it('reloads settings and refreshes views when data.json changes externally', async () => {
    const plugin = createPlugin();
    plugin.loadData = vi.fn(async () => ({ dailyFolder: 'Synced/Daily', reminderEnabled: true, reminderHour: 8 }));
    plugin._cleanupWeatherCache = vi.fn();
    plugin.moodStore = { configure: vi.fn() };
    plugin.refreshJournalViews = vi.fn();
    plugin._syncDaylineRibbon = vi.fn();

    await plugin.onExternalSettingsChange();

    expect(plugin.settings.dailyFolder).toBe('Synced/Daily');
    expect(plugin.settings.reminderEnabled).toBe(true);
    expect(plugin.moodStore.configure).toHaveBeenCalledWith(plugin.settings);
    expect(plugin.refreshJournalViews).toHaveBeenCalledTimes(1);
    expect(plugin._syncDaylineRibbon).toHaveBeenCalledTimes(1);
  });

  /* P-18: a manually installed folder name must not redirect the migration. */
  it('migrates legacy data next to the running manifest directory', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const adapter = {
      exists: vi.fn(async (path: string) => path === '.obsidian/plugins/dayline/data.json'),
      read: vi.fn(async () => '{"legacy":true}'),
      write: vi.fn(async () => undefined),
    };
    const plugin = createPlugin();
    plugin.app = { vault: { adapter, configDir: '.obsidian' } };
    plugin.manifest = { dir: '.obsidian/plugins/dayline-main' };

    await plugin._migrateLegacyData();

    expect(adapter.write).toHaveBeenCalledWith('.obsidian/plugins/dayline-main/data.json', '{"legacy":true}');
  });

  /* M-02: the metadata JSON is watched, not only Markdown files. */
  it('reloads mood metadata when its JSON file is modified outside the plugin', async () => {
    const plugin = createPlugin();
    plugin.settings = { dailyFolder: 'Calendar/Daily', moodMetadataPath: 'Calendar/journal-metadata.json' };
    plugin.moodStore = { reloadFromDisk: vi.fn(async () => undefined) };
    plugin.refreshJournalViews = vi.fn();
    plugin._handleJournalCreateOrModify = vi.fn();

    plugin._handleVaultModify({ path: 'Calendar/journal-metadata.json' });
    await vi.waitFor(() => expect(plugin.refreshJournalViews).toHaveBeenCalledTimes(1));
    expect(plugin.moodStore.reloadFromDisk).toHaveBeenCalledTimes(1);

    plugin._handleVaultModify({ path: 'Calendar/Daily/2026-09-29.md' });
    expect(plugin._handleJournalCreateOrModify).toHaveBeenCalledTimes(1);
    expect(plugin.moodStore.reloadFromDisk).toHaveBeenCalledTimes(1);
  });

  it('ignores mood metadata changes when the store has no reload entry point', () => {
    const plugin = createPlugin();
    plugin.settings = { dailyFolder: 'Calendar/Daily', moodMetadataPath: 'Calendar/journal-metadata.json' };
    plugin.moodStore = {};

    expect(() => plugin._handleVaultModify({ path: 'Calendar/journal-metadata.json' })).not.toThrow();
  });

  /* J-13: the lazy mobile first build still waits for metadataCache resolution. */
  it('waits for metadataCache resolution before the first journal index build', async () => {
    const gate = deferred<void>();
    let resolved = false;
    const builds: boolean[] = [];
    const plugin = createPlugin({
      './journal-index': {
        JournalIndex: class {},
        startJournalIndexLoad: () => undefined,
        waitForJournalIndexStartup: () => gate.promise.then(() => { resolved = true; }),
      },
    });
    plugin.settings = { dailyFolder: 'Calendar/Daily' };
    plugin.journalIndex = {
      isReady: false,
      ensureReady: vi.fn(async () => { builds.push(resolved); }),
    };

    const pending = plugin.ensureJournalIndexReady();
    await Promise.resolve();
    expect(builds).toEqual([]);

    gate.resolve();
    await pending;
    expect(builds).toEqual([true]);
  });

  /* The phone mode controls are swipe-first: only the two mode buttons render. */
  it('renders only the calendar and timeline mode buttons', () => {
    const created: any[] = [];
    const parent = {
      createDiv: vi.fn(() => ({
        createEl: vi.fn((tag: string, options: any) => {
          const element: any = { tag, options, remove: vi.fn(), toggleClass: vi.fn(), handlers: {} as Record<string, () => void> };
          element.addEventListener = (type: string, callback: () => void) => { element.handlers[type] = callback; };
          created.push(element);
          return element;
        }),
      })),
    };

    renderMobileDaylineModeControls(parent, {
      activeMode: 'calendar',
      labels: { calendar: 'Calendar', timeline: 'Timeline' },
      onSelect: () => undefined,
    });

    const buttons = created.filter((element) => element.tag === 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.options.attr['aria-label'])).toEqual(['Calendar', 'Timeline']);
    expect(created.find((element) => String(element.options?.cls ?? '').includes('dayline-mobile-return-button'))).toBeUndefined();
    expect(created.find((element) => element.options?.cls === 'dayline-mobile-return-hint')).toBeUndefined();
  });

  /* P-06: a not-yet-ready index must not claim the user has not written today. */
  it('does not remind when the lazy index is empty but the day\'s note exists', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T21:30:00Z'));
    const plugin = createPlugin();
    plugin.settings = { dailyFolder: 'Calendar/Daily', weatherTimezone: 'UTC', reminderEnabled: true, reminderHour: 21 };
    plugin.journalIndex = { isReady: false, getEntries: () => [] };
    const getAbstractFileByPath = vi.fn(() => ({ path: 'Calendar/Daily/2026-09-29.md' }));
    plugin.app = { vault: { getAbstractFileByPath } };

    plugin._maybeRemind();

    expect(getAbstractFileByPath).toHaveBeenCalledWith('Calendar/Daily/2026-09-29.md');
    expect(noticeMessages).toEqual([]);
  });

  it('reminds once a day when the day\'s note is really missing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T21:30:00Z'));
    const plugin = createPlugin();
    plugin.settings = { dailyFolder: 'Calendar/Daily', weatherTimezone: 'UTC', reminderEnabled: true, reminderHour: 21 };
    plugin.journalIndex = { isReady: false, getEntries: () => [] };
    plugin.app = { vault: { getAbstractFileByPath: vi.fn(() => null) } };

    plugin._maybeRemind();
    plugin._maybeRemind();
    plugin._maybeRemind();

    expect(noticeMessages).toHaveLength(1);
  });

  it('does not remind before the configured hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T20:00:00Z'));
    const plugin = createPlugin();
    plugin.settings = { dailyFolder: 'Calendar/Daily', weatherTimezone: 'UTC', reminderEnabled: true, reminderHour: 21 };
    plugin.journalIndex = { isReady: true, getEntries: () => [] };
    plugin.app = { vault: { getAbstractFileByPath: vi.fn(() => null) } };

    plugin._maybeRemind();

    expect(noticeMessages).toEqual([]);
  });

  /* P-07: a mood edit on the day's path must use the Daily Notes template. */
  it('creates the daily note through the Daily Notes path when saving a mood', async () => {
    const opened: any[] = [];
    class RecordingMoodPickerModal {
      constructor(_app: unknown, options: any) {
        opened.push(options);
      }
      open() {}
    }
    const plugin = createPlugin({
      './mood-picker-modal': {
        MoodPickerModal: RecordingMoodPickerModal,
        MoodRecoveryModal: class { open() {} },
      },
    });
    plugin.settings = { dailyFolder: 'Calendar/Daily', moodMetadataPath: 'Calendar/journal-metadata.json' };
    plugin.moodStore = {
      get: () => null,
      getCustomLabels: () => [],
      set: vi.fn(async () => undefined),
    };
    plugin.journalIndex = { getEntries: () => [], refreshFile: vi.fn(async () => undefined) };
    plugin.refreshJournalViews = vi.fn();
    plugin.createDailyNoteForDate = vi.fn(async () => ({ path: 'Calendar/Daily/2026-09-29.md' }));
    plugin.ensureJournalFile = vi.fn(async () => ({}));

    await plugin.openMoodPicker('Calendar/Daily/2026-09-29.md');

    expect(plugin.createDailyNoteForDate).toHaveBeenCalledWith('2026-09-29');
    expect(plugin.ensureJournalFile).not.toHaveBeenCalled();

    await opened[0].onSave({ filePath: 'Calendar/Daily/2026-09-29.md', score: 1, labels: [], note: '' });
    expect(plugin.createDailyNoteForDate).toHaveBeenCalledTimes(2);
    expect(plugin.ensureJournalFile).not.toHaveBeenCalled();

    // A journal path that is not the date's daily note keeps the plain create.
    await plugin.openMoodPicker('Notes/2026-09-29.md');
    expect(plugin.ensureJournalFile).toHaveBeenCalledWith('Notes/2026-09-29.md', '');
    expect(plugin.createDailyNoteForDate).toHaveBeenCalledTimes(2);
  });

  it('reuses the active Markdown leaf for desktop journal opens instead of splitting', () => {
    const markdown = { id: 'note', view: { getViewType: () => 'markdown' } };
    const workspace = {
      activeLeaf: markdown,
      getLeavesOfType: vi.fn(() => [markdown]),
      getLeaf: vi.fn(() => { throw new Error('desktop must reuse the active Markdown leaf'); }),
    };
    expect(getJournalOpenLeaf(workspace, false)).toBe(markdown);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
  });

  it('creates a desktop leaf without a split when no Markdown tab exists', () => {
    const created = { id: 'new-note' };
    const workspace = {
      activeLeaf: { id: 'timeline', view: { getViewType: () => TIMELINE_VIEW } },
      getLeavesOfType: vi.fn(() => []),
      getLeaf: vi.fn((kind: unknown) => {
        if (kind === 'split' || kind === 'tab') throw new Error(`desktop must not use ${String(kind)}`);
        return kind === true ? created : null;
      }),
    };
    expect(getJournalOpenLeaf(workspace, false)).toBe(created);
    expect(workspace.getLeaf).toHaveBeenCalledWith(true);
  });

  it('keeps the legacy view as a redirect-only shim', () => {
    const pluginSource = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
    const start = pluginSource.indexOf('class MobileDaylineView extends ItemView');
    const end = pluginSource.indexOf('/* ============================================================\n   Create Note Confirm Modal', start);
    const shimSource = pluginSource.slice(start, end);

    expect(shimSource).toContain('this.plugin._redirectLegacyMobileDaylineLeaf(this.leaf)');
    expect(shimSource).not.toContain('createDiv');
    expect(shimSource).not.toContain('new CalendarView');
    expect(shimSource).not.toContain('new JournalTimelineView');
    expect(shimSource).not.toContain('setMode');
    expect(shimSource).not.toContain('setDateFilter');
  });

  it('reveals a Markdown leaf after opening a journal entry from calendar or timeline', () => {
    const pluginSource = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
    const timelineSource = readFileSync(join(process.cwd(), 'src/journal-timeline-view.ts'), 'utf8');
    const pluginOpenStart = pluginSource.indexOf('async openJournalFile(file)');
    const pluginOpenEnd = pluginSource.indexOf('async _openTimelineView()', pluginOpenStart);
    const pluginOpenSource = pluginSource.slice(pluginOpenStart, pluginOpenEnd);
    const calendarOpenStart = pluginSource.indexOf('const openFileInLeaf = (f) => {');
    const calendarOpenEnd = pluginSource.indexOf('if (file instanceof TFile)', calendarOpenStart);
    const calendarOpenSource = pluginSource.slice(calendarOpenStart, calendarOpenEnd);

    // Only the phone layout lacks a reusable Markdown tab; tablets and desktop
    // must reuse the active or first Markdown leaf. Phones reuse a main-area
    // leaf and never the Dayline drawer leaf.
    expect(pluginOpenSource).toContain('resolveMobileJournalLeaf(workspace, journalLeaf)');
    expect(pluginOpenSource).not.toContain('getLeaf(\'split\')');
    expect(pluginOpenSource).toContain('await workspace.revealLeaf?.(leaf);');
    expect(pluginOpenSource).toContain('workspace.setActiveLeaf?.(leaf, { focus: true });');
    expect(calendarOpenSource).toContain('this.plugin.openJournalFile(f)');
    expect(pluginSource).toContain('bindOpenOnPointer(cell');
    expect(timelineSource).toContain('bindOpenOnPointer(card');
    expect(timelineSource).not.toContain("card.addEventListener('click'");
    expect(timelineSource).not.toContain("getLeaf('split')");
  });

  it('routes vault modify events for the mood metadata JSON through the reload entry point', () => {
    const pluginSource = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
    expect(pluginSource).toContain("this.app.vault.on('modify', (file) => this._handleVaultModify(file))");
    expect(pluginSource).toContain("typeof store.reloadFromDisk !== 'function'");
  });

  it('keeps mode controls inside the two real ItemViews and isolates mobile close persistence', () => {
    const pluginSource = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
    const timelineSource = readFileSync(join(process.cwd(), 'src/journal-timeline-view.ts'), 'utf8');
    const calendarStart = pluginSource.indexOf('class CalendarView extends ItemView');
    const calendarEnd = pluginSource.indexOf('/* ============================================================\n   Legacy Mobile Dayline View', calendarStart);
    const calendarSource = pluginSource.slice(calendarStart, calendarEnd);

    expect(calendarSource).toContain("activeMode: 'calendar'");
    expect(timelineSource).toContain("activeMode: 'timeline'");
    // Close persistence is owned by the sidebar views off the phone layout;
    // the phone layout only re-syncs the ribbon.
    expect(calendarSource).toContain('if (!usesPhoneLayout(this.plugin.capabilities))');
    expect(timelineSource).toContain('if (!usesPhoneLayout(this.plugin.capabilities))');
    expect(calendarSource).toContain('Promise.resolve().then(() => this.render())');
    expect(calendarSource).not.toContain('this.embedded');
    expect(timelineSource).not.toContain('this.embedded');
  });

  it('removes nested ItemView hosts and empty-leaf cleanup from mobile routing', () => {
    const pluginSource = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
    const mobileSource = readFileSync(join(process.cwd(), 'src/dayline-mobile.ts'), 'utf8');
    const start = pluginSource.indexOf('async _openMobileDayline(mode = \'calendar\',');
    const end = pluginSource.indexOf('async openTimelineForDate(date)', start);
    const routeSource = pluginSource.slice(start, end);

    expect(pluginSource).not.toContain('bindMobileEmbeddedViewHost');
    expect(pluginSource).not.toContain('dayline-mobile-wide-layout');
    expect(pluginSource).not.toContain('_pruneMobileEmptyLeaves');
    expect(pluginSource).toContain('createSerialMobileDaylineModeController');
    expect(routeSource).toContain('await this._requestMobileDaylineMode(mode, leaf, afterApply)');
    expect(routeSource).toContain('this._openDaylineDrawerLeaf(preferredLeaf)');
    expect(routeSource).not.toContain('detachLeaf');
    expect(routeSource).not.toContain('getMobileEmptyLeaves');
    expect(mobileSource).not.toContain('setMobileHost');
    expect(mobileSource).not.toContain('Object.defineProperties');
    expect(pluginSource).not.toContain('mobileHost');
    expect(readFileSync(join(process.cwd(), 'src/journal-timeline-view.ts'), 'utf8')).not.toContain('mobileHost');
  });

  it('keeps native mobile content scrollable without reintroducing an embedded host', () => {
    const pluginSource = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
    const stylesSource = readFileSync(join(process.cwd(), 'styles.css'), 'utf8');
    expect(stylesSource).toContain('.dayline-mobile-native-view .view-content');
    expect(stylesSource).toContain('overflow-y: auto;');
    expect(stylesSource).toContain('.dayline-mobile-native-mode-controls');
    expect(pluginSource).not.toContain('dayline-mobile-embedded-host');
  });
});
