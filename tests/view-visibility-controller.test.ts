import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VIEW_VISIBILITY,
  ViewVisibilityController,
  normalizeViewVisibilitySettings,
} from '../src/view-visibility-controller';

type ViewKind = 'calendar' | 'timeline';

interface FakeLeaf {
  type: string;
  id: string;
}

function createWorkspace(initial: Partial<Record<ViewKind, number>> = {}) {
  const leaves: FakeLeaf[] = [];
  let nextId = 0;

  const addLeaf = (kind: ViewKind) => {
    const leaf = { type: kind === 'calendar' ? 'calendar-sidebar-view' : 'journal-timeline-view', id: `${kind}-${nextId++}` };
    leaves.push(leaf);
    return leaf;
  };

  for (const kind of ['calendar', 'timeline'] as const) {
    for (let i = 0; i < (initial[kind] ?? 0); i++) addLeaf(kind);
  }

  return {
    leaves,
    addLeaf,
    removeLeaf(leaf: FakeLeaf) {
      const index = leaves.indexOf(leaf);
      if (index >= 0) leaves.splice(index, 1);
    },
    getLeavesOfType(type: string) {
      return leaves.filter((leaf) => leaf.type === type);
    },
    revealLeaf: vi.fn(),
    detachLeaf(leaf: FakeLeaf) {
      this.removeLeaf(leaf);
    },
  };
}

function createController(
  workspace: ReturnType<typeof createWorkspace>,
  options: { initialState?: Partial<Record<'showCalendarView' | 'showTimelineView', boolean>>; open?: Partial<Record<ViewKind, () => Promise<void>>> } = {},
) {
  const writes: Array<{ kind: ViewKind; visible: boolean }> = [];
  const controller = new ViewVisibilityController({
    workspace,
    initialState: options.initialState,
    openers: {
      calendar: options.open?.calendar ?? (async () => { workspace.addLeaf('calendar'); }),
      timeline: options.open?.timeline ?? (async () => { workspace.addLeaf('timeline'); }),
    },
    onPersist: async (kind, visible) => {
      writes.push({ kind, visible });
    },
  });
  return { controller, writes };
}

describe('view visibility defaults', () => {
  it('uses calendar-on and timeline-off defaults for missing fields', () => {
    expect(DEFAULT_VIEW_VISIBILITY).toEqual({ showCalendarView: true, showTimelineView: false });
    expect(normalizeViewVisibilitySettings({})).toEqual(DEFAULT_VIEW_VISIBILITY);
    expect(normalizeViewVisibilitySettings({ showCalendarView: false, showTimelineView: true })).toEqual({
      showCalendarView: false,
      showTimelineView: true,
    });
  });
});

describe('view visibility controller', () => {
  it('toggles calendar and timeline independently from actual leaves', async () => {
    const workspace = createWorkspace();
    const { controller, writes } = createController(workspace);

    await controller.toggle('calendar');
    await controller.toggle('timeline');
    await controller.toggle('calendar');

    expect(controller.isOpen('calendar')).toBe(false);
    expect(controller.isOpen('timeline')).toBe(true);
    expect(writes).toEqual([
      { kind: 'calendar', visible: true },
      { kind: 'timeline', visible: true },
      { kind: 'calendar', visible: false },
    ]);
  });

  it('keeps the original preference when opening fails', async () => {
    const workspace = createWorkspace();
    const { controller, writes } = createController(workspace, {
      initialState: { showCalendarView: true },
      open: { calendar: async () => { throw new Error('leaf creation failed'); } },
    });

    const result = await controller.open('calendar');

    expect(result).toBe(false);
    expect(controller.getPreferences().showCalendarView).toBe(true);
    expect(writes).toEqual([]);
  });

  it('restores both views without persisting startup calibration', async () => {
    const workspace = createWorkspace({ timeline: 1 });
    const { controller, writes } = createController(workspace, {
      initialState: { showCalendarView: true, showTimelineView: false },
    });

    await controller.restore();

    expect(controller.isOpen('calendar')).toBe(true);
    expect(controller.isOpen('timeline')).toBe(false);
    expect(writes).toEqual([]);
  });

  it('persists command-style opening after a successful leaf is created', async () => {
    const workspace = createWorkspace();
    const { controller, writes } = createController(workspace);

    expect(await controller.open('timeline')).toBe(true);
    expect(writes).toEqual([{ kind: 'timeline', visible: true }]);
  });

  it('records closing only after the last duplicate leaf disappears', async () => {
    const workspace = createWorkspace({ timeline: 2 });
    const { controller, writes } = createController(workspace, {
      initialState: { showTimelineView: true },
    });

    const [first, second] = workspace.getLeavesOfType('journal-timeline-view');
    workspace.removeLeaf(first);
    await controller.viewClosed('timeline');
    expect(writes).toEqual([]);

    workspace.removeLeaf(second);
    await controller.viewClosed('timeline');
    expect(writes).toEqual([{ kind: 'timeline', visible: false }]);
  });

  it('waits for workspace removal when the close callback arrives first', async () => {
    const workspace = createWorkspace({ calendar: 1 });
    const { controller, writes } = createController(workspace, {
      initialState: { showCalendarView: true },
    });

    const pending = controller.viewClosed('calendar');
    workspace.removeLeaf(workspace.getLeavesOfType('calendar-sidebar-view')[0]);
    await pending;

    expect(writes).toEqual([{ kind: 'calendar', visible: false }]);
  });

  it('closes every duplicate leaf and persists one close operation', async () => {
    const workspace = createWorkspace({ calendar: 3 });
    const { controller, writes } = createController(workspace, {
      initialState: { showCalendarView: true },
    });

    await controller.close('calendar');

    expect(workspace.getLeavesOfType('calendar-sidebar-view')).toHaveLength(0);
    expect(writes).toEqual([{ kind: 'calendar', visible: false }]);
  });

  it('suppresses persistence while unloading', async () => {
    const workspace = createWorkspace({ calendar: 2, timeline: 1 });
    const { controller, writes } = createController(workspace, {
      initialState: { showCalendarView: true, showTimelineView: true },
    });

    await controller.unload();

    expect(workspace.leaves).toHaveLength(0);
    expect(writes).toEqual([]);
  });

  it('falls back to the leaf detach API used by Obsidian', async () => {
    const leaves: Array<{ type: string; detach: () => void }> = [];
    const leaf = { type: 'calendar-sidebar-view', detach: () => { leaves.splice(0, 1); } };
    leaves.push(leaf);
    const controller = new ViewVisibilityController({
      workspace: {
        getLeavesOfType: (type) => leaves.filter((item) => item.type === type),
        revealLeaf: vi.fn(),
      },
      initialState: { showCalendarView: true },
      openers: { calendar: vi.fn(), timeline: vi.fn() },
    });

    await controller.close('calendar');

    expect(leaves).toHaveLength(0);
  });
});
