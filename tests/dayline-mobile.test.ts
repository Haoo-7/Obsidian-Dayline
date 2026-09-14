import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_DAYLINE_VIEW,
  createSerialMobileDaylineModeController,
  getMobileDaylineLeaf,
  getMobileDaylineViewType,
  getMobileMarkdownLeaf,
  normalizeDaylineMobileMode,
  renderMobileDaylineModeControls,
  setMobileDaylineLeafView,
} from '../src/dayline-mobile';

const CALENDAR_VIEW = 'calendar-sidebar-view';
const TIMELINE_VIEW = 'journal-timeline-view';
const DAYLINE_VIEW_TYPES = [CALENDAR_VIEW, TIMELINE_VIEW, MOBILE_DAYLINE_VIEW] as const;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('mobile Dayline routing', () => {
  it('reuses the active real Dayline leaf before querying workspace topology', () => {
    const activeLeaf = { id: 'dayline', view: { getViewType: () => TIMELINE_VIEW } };
    const workspace = {
      activeLeaf,
      getLeavesOfType: vi.fn(),
      getLeaf: vi.fn(),
      getLeftLeaf: vi.fn(() => { throw new Error('mobile must not use sidebar routing'); }),
    };

    expect(getMobileDaylineLeaf(workspace, DAYLINE_VIEW_TYPES)).toBe(activeLeaf);
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

    expect(getMobileDaylineLeaf(workspace, DAYLINE_VIEW_TYPES)).toBe(existing);
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

    expect(getMobileDaylineLeaf(workspace, DAYLINE_VIEW_TYPES)).toBe(created);
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

  it('keeps the legacy view as a redirect-only shim', () => {
    const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
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

  it('reveals a mobile Markdown leaf after opening a journal entry', () => {
    const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
    const pluginOpenStart = pluginSource.indexOf('async openJournalFile(file)');
    const pluginOpenEnd = pluginSource.indexOf('async _openTimelineView()', pluginOpenStart);
    const pluginOpenSource = pluginSource.slice(pluginOpenStart, pluginOpenEnd);
    const calendarOpenStart = pluginSource.indexOf('const openFileInLeaf = (f) => {');
    const calendarOpenEnd = pluginSource.indexOf('if (file instanceof TFile)', calendarOpenStart);
    const calendarOpenSource = pluginSource.slice(calendarOpenStart, calendarOpenEnd);

    expect(pluginOpenSource).toContain('await workspace.revealLeaf?.(leaf);');
    expect(pluginOpenSource).toContain('workspace.setActiveLeaf?.(leaf, { focus: true });');
    expect(calendarOpenSource).toContain('await this.app.workspace.revealLeaf?.(leaf);');
    expect(calendarOpenSource).toContain('this.app.workspace.setActiveLeaf?.(leaf, { focus: true });');
  });

  it('keeps mode controls inside the two real ItemViews and isolates mobile close persistence', () => {
    const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
    const timelineSource = readFileSync(new URL('../src/journal-timeline-view.ts', import.meta.url), 'utf8');
    const calendarStart = pluginSource.indexOf('class CalendarView extends ItemView');
    const calendarEnd = pluginSource.indexOf('/* ============================================================\n   Legacy Mobile Dayline View', calendarStart);
    const calendarSource = pluginSource.slice(calendarStart, calendarEnd);

    expect(calendarSource).toContain("activeMode: 'calendar'");
    expect(timelineSource).toContain("activeMode: 'timeline'");
    expect(calendarSource).toContain('if (!this.plugin.capabilities?.isMobile)');
    expect(timelineSource).toContain('if (!this.plugin.capabilities?.isMobile)');
    expect(calendarSource).toContain('Promise.resolve().then(() => this.render())');
    expect(calendarSource).not.toContain('this.embedded');
    expect(timelineSource).not.toContain('this.embedded');
  });

  it('removes nested ItemView hosts and empty-leaf cleanup from mobile routing', () => {
    const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
    const mobileSource = readFileSync(new URL('../src/dayline-mobile.ts', import.meta.url), 'utf8');
    const start = pluginSource.indexOf('async _openMobileDayline(mode = \'calendar\',');
    const end = pluginSource.indexOf('async openTimelineForDate(date)', start);
    const routeSource = pluginSource.slice(start, end);

    expect(pluginSource).not.toContain('bindMobileEmbeddedViewHost');
    expect(pluginSource).not.toContain('dayline-mobile-wide-layout');
    expect(pluginSource).not.toContain('_pruneMobileEmptyLeaves');
    expect(pluginSource).toContain('createSerialMobileDaylineModeController');
    expect(routeSource).toContain('this._requestMobileDaylineMode(mode, preferredLeaf, afterApply)');
    expect(routeSource).not.toContain('detachLeaf');
    expect(routeSource).not.toContain('getMobileEmptyLeaves');
    expect(mobileSource).not.toContain('setMobileHost');
    expect(mobileSource).not.toContain('Object.defineProperties');
    expect(pluginSource).not.toContain('mobileHost');
    expect(readFileSync(new URL('../src/journal-timeline-view.ts', import.meta.url), 'utf8')).not.toContain('mobileHost');
  });

  it('keeps native mobile content scrollable without reintroducing an embedded host', () => {
    const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
    const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    expect(stylesSource).toContain('.dayline-mobile-native-view .view-content');
    expect(stylesSource).toContain('overflow-y: auto;');
    expect(stylesSource).toContain('.dayline-mobile-native-mode-controls');
    expect(pluginSource).not.toContain('dayline-mobile-embedded-host');
  });
});
