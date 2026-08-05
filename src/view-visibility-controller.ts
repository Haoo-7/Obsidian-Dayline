export type ViewKind = 'calendar' | 'timeline';

export interface ViewVisibilityState {
  showCalendarView: boolean;
  showTimelineView: boolean;
}

export const DEFAULT_VIEW_VISIBILITY: ViewVisibilityState = {
  showCalendarView: true,
  showTimelineView: false,
};

export const VIEW_TYPE_BY_KIND: Record<ViewKind, string> = {
  calendar: 'calendar-sidebar-view',
  timeline: 'journal-timeline-view',
};

export interface ViewVisibilityWorkspace {
  getLeavesOfType(viewType: string): Array<unknown>;
  revealLeaf?(leaf: unknown): void | Promise<void>;
  detachLeaf?(leaf: unknown): void | Promise<void>;
}

export interface ViewVisibilityControllerOptions {
  workspace: ViewVisibilityWorkspace;
  initialState?: Partial<ViewVisibilityState>;
  openers: Record<ViewKind, () => void | Promise<void>>;
  onPersist?: (kind: ViewKind, visible: boolean) => void | Promise<void>;
}

export function normalizeViewVisibilitySettings(
  settings: Partial<ViewVisibilityState> = {},
): ViewVisibilityState {
  return {
    showCalendarView: typeof settings.showCalendarView === 'boolean'
      ? settings.showCalendarView
      : DEFAULT_VIEW_VISIBILITY.showCalendarView,
    showTimelineView: typeof settings.showTimelineView === 'boolean'
      ? settings.showTimelineView
      : DEFAULT_VIEW_VISIBILITY.showTimelineView,
  };
}

export class ViewVisibilityController {
  private readonly workspace: ViewVisibilityWorkspace;
  private readonly openers: Record<ViewKind, () => void | Promise<void>>;
  private readonly onPersist?: (kind: ViewKind, visible: boolean) => void | Promise<void>;
  private preferences: ViewVisibilityState;
  private readonly closing = new Set<ViewKind>();
  private suppressClosePersistence = false;

  constructor(options: ViewVisibilityControllerOptions) {
    this.workspace = options.workspace;
    this.openers = options.openers;
    this.onPersist = options.onPersist;
    this.preferences = normalizeViewVisibilitySettings(options.initialState);
  }

  getPreferences(): ViewVisibilityState {
    return { ...this.preferences };
  }

  isOpen(kind: ViewKind): boolean {
    return this.leaves(kind).length > 0;
  }

  isAnyOpen(): boolean {
    return this.isOpen('calendar') || this.isOpen('timeline');
  }

  async toggle(kind: ViewKind): Promise<boolean> {
    return this.isOpen(kind) ? this.close(kind) : this.open(kind);
  }

  async open(kind: ViewKind): Promise<boolean> {
    try {
      await this.openWithoutPersist(kind);
    } catch (error) {
      console.warn(`[Dayline] Failed to open ${kind} view:`, errorMessage(error));
      return false;
    }

    if (!this.isOpen(kind)) return false;
    await this.persist(kind, true);
    return true;
  }

  async close(kind: ViewKind): Promise<boolean> {
    return this.closeWithoutPersist(kind, true);
  }

  async viewClosed(kind: ViewKind): Promise<void> {
    if (this.suppressClosePersistence || this.closing.has(kind)) return;
    await Promise.resolve();
    if (!this.isOpen(kind)) await this.persist(kind, false);
  }

  async restore(): Promise<void> {
    this.suppressClosePersistence = true;
    try {
      for (const kind of ['calendar', 'timeline'] as const) {
        if (this.preferences[preferenceKey(kind)]) {
          try {
            await this.openWithoutPersist(kind);
          } catch (error) {
            console.warn(`[Dayline] Failed to restore ${kind} view:`, errorMessage(error));
          }
        } else {
          await this.closeWithoutPersist(kind, false);
        }
      }
    } finally {
      this.suppressClosePersistence = false;
    }
  }

  async unload(): Promise<void> {
    this.suppressClosePersistence = true;
    await this.closeWithoutPersist('calendar', false);
    await this.closeWithoutPersist('timeline', false);
  }

  private async openWithoutPersist(kind: ViewKind): Promise<void> {
    const existing = this.leaves(kind);
    if (existing.length > 0) {
      await this.workspace.revealLeaf?.(existing[0]);
      this.closing.add(kind);
      try {
        for (const duplicate of existing.slice(1)) {
          await this.detachLeaf(duplicate);
        }
      } finally {
        this.closing.delete(kind);
      }
      return;
    }

    await this.openers[kind]();
  }

  private async closeWithoutPersist(kind: ViewKind, persistWhenClosed: boolean): Promise<boolean> {
    const existing = this.leaves(kind);
    if (existing.length > 0) {
      this.closing.add(kind);
      try {
        for (const leaf of existing) {
          try {
            await this.detachLeaf(leaf);
          } catch (error) {
            console.warn(`[Dayline] Failed to close ${kind} view:`, errorMessage(error));
          }
        }
      } finally {
        this.closing.delete(kind);
      }
    }

    const closed = !this.isOpen(kind);
    if (closed && persistWhenClosed && !this.suppressClosePersistence) {
      await this.persist(kind, false);
    }
    return closed;
  }

  private leaves(kind: ViewKind): Array<unknown> {
    return this.workspace.getLeavesOfType(VIEW_TYPE_BY_KIND[kind]) || [];
  }

  private async detachLeaf(leaf: unknown): Promise<void> {
    if (this.workspace.detachLeaf) {
      await this.workspace.detachLeaf(leaf);
      return;
    }
    const detach = (leaf as { detach?: () => void | Promise<void> } | null)?.detach;
    if (detach) await detach.call(leaf);
  }

  private async persist(kind: ViewKind, visible: boolean): Promise<void> {
    this.preferences[preferenceKey(kind)] = visible;
    await this.onPersist?.(kind, visible);
  }
}

function preferenceKey(kind: ViewKind): keyof ViewVisibilityState {
  return kind === 'calendar' ? 'showCalendarView' : 'showTimelineView';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
