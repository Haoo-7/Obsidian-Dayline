export type DaylineMobileMode = 'calendar' | 'timeline';

/** Legacy view type kept only to migrate restored mobile workspace state. */
export const MOBILE_DAYLINE_VIEW = 'dayline-mobile-view';

export type MobileDaylineModeLabels = {
  calendar: string;
  timeline: string;
};

export type MobileDaylineModeControlsOptions = {
  activeMode: unknown;
  labels: MobileDaylineModeLabels;
  onSelect: (mode: DaylineMobileMode) => void | Promise<void>;
  onError?: (error: unknown, mode: DaylineMobileMode) => void;
  setIcon?: (element: any, icon: string) => void;
  onReturn?: () => void | Promise<void>;
};

export type MobileDaylineTransition = {
  leaf: any;
  mode: DaylineMobileMode;
  viewType: string;
};

export type MobileDaylineModeControllerOptions = {
  getLeaf: () => any | null;
  getViewType: (mode: DaylineMobileMode) => string;
  revealLeaf?: (leaf: any) => void | Promise<void>;
  onApplied?: (transition: MobileDaylineTransition) => void;
};

export function normalizeDaylineMobileMode(value: unknown): DaylineMobileMode {
  return value === 'timeline' ? 'timeline' : 'calendar';
}

/** Map the two mobile modes onto real registered Dayline view types. */
export function getMobileDaylineViewType(
  mode: unknown,
  calendarViewType: string,
  timelineViewType: string,
): string {
  return normalizeDaylineMobileMode(mode) === 'timeline' ? timelineViewType : calendarViewType;
}

function normalizedViewTypes(viewTypes: unknown): string[] {
  const values = Array.isArray(viewTypes) ? viewTypes : [viewTypes];
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

function leafViewType(leaf: any): string | null {
  const value = leaf?.view?.getViewType?.();
  return typeof value === 'string' ? value : null;
}

/** Find a real Dayline leaf without making any workspace-topology assumptions. */
export function getMobileDaylineLeaf(
  workspace: any,
  viewTypes: readonly string[] = [MOBILE_DAYLINE_VIEW],
): any | null {
  const types = normalizedViewTypes(viewTypes);
  const activeLeaf = workspace?.activeLeaf;
  if (types.includes(leafViewType(activeLeaf) || '')) return activeLeaf;

  for (const viewType of types) {
    const existing = workspace?.getLeavesOfType?.(viewType)?.[0];
    if (existing) return existing;
  }
  return workspace?.getLeaf?.('tab') || workspace?.getLeaf?.(true) || null;
}

/** Change the supplied leaf's real view type through Obsidian's public API. */
export async function setMobileDaylineLeafView(leaf: any, viewType: string): Promise<any | null> {
  if (!leaf) return null;
  if (leafViewType(leaf) === viewType) return leaf;
  if (typeof leaf.setViewState !== 'function') {
    throw new Error('mobile Dayline leaf cannot change view state');
  }
  await leaf.setViewState({ type: viewType, active: true });
  return leaf;
}

/** Serialize real-leaf mode changes so each view lifecycle settles in order. */
export function createSerialMobileDaylineModeController(options: MobileDaylineModeControllerOptions) {
  let pending: Promise<unknown> = Promise.resolve();

  return {
    request(
      mode: unknown,
      preferredLeaf: any = null,
      afterApply?: (transition: MobileDaylineTransition) => void | Promise<void>,
    ): Promise<MobileDaylineTransition> {
      const normalized = normalizeDaylineMobileMode(mode);
      const run = async (): Promise<MobileDaylineTransition> => {
        const leaf = preferredLeaf || options.getLeaf();
        if (!leaf) throw new Error('could not create Dayline tab');
        const viewType = options.getViewType(normalized);
        await setMobileDaylineLeafView(leaf, viewType);
        const transition = { leaf, mode: normalized, viewType };
        options.onApplied?.(transition);
        await options.revealLeaf?.(leaf);
        await afterApply?.(transition);
        return transition;
      };
      const task = pending.then(run, run);
      pending = task.catch(() => undefined);
      return task;
    },
  };
}

/**
 * Open notes beside Dayline: reuse the active or first Markdown leaf, and never
 * replace a Dayline tab or split the workspace.
 */
export function getJournalOpenLeaf(workspace: any, isMobile = false): any | null {
  const activeLeaf = workspace?.activeLeaf;
  if (activeLeaf?.view?.getViewType?.() === 'markdown') return activeLeaf;
  const existing = workspace?.getLeavesOfType?.('markdown')?.[0];
  if (existing) return existing;
  if (isMobile) return workspace?.getLeaf?.('tab') || workspace?.getLeaf?.(true) || null;
  return workspace?.getLeaf?.(true) || null;
}

/** Open notes beside Dayline, never by replacing its tab or using a split. */
export function getMobileMarkdownLeaf(workspace: any): any | null {
  return getJournalOpenLeaf(workspace, true);
}

/** Render the shared mobile mode control inside a real Dayline ItemView. */
export function renderMobileDaylineModeControls(parent: any, options: MobileDaylineModeControlsOptions): any {
  const controls = parent?.createDiv?.({
    cls: 'dayline-mobile-mode-controls dayline-mobile-native-mode-controls',
    attr: { role: 'group', 'aria-label': 'Dayline view' },
  });
  if (!controls?.createEl) return null;

  const activeMode = normalizeDaylineMobileMode(options?.activeMode);
  const modes: Array<[DaylineMobileMode, string, string]> = [
    ['calendar', 'calendar-days', options?.labels?.calendar || 'Calendar'],
    ['timeline', 'list', options?.labels?.timeline || 'Timeline'],
  ];
  for (const [mode, icon, label] of modes) {
    const button = controls.createEl('button', {
      cls: 'dayline-mobile-mode-button',
      attr: {
        type: 'button',
        'aria-label': label,
        title: label,
        'aria-pressed': String(activeMode === mode),
      },
    });
    button.toggleClass?.('is-active', activeMode === mode);
    options?.setIcon?.(button, icon);
    button.addEventListener('click', () => {
      Promise.resolve(options?.onSelect?.(mode)).catch((error) => {
        try {
          if (options?.onError) options.onError(error, mode);
          else console.warn('[Dayline] Mobile mode switch failed:', error);
        } catch (reportError) {
          console.warn('[Dayline] Could not report mobile mode switch failure:', reportError);
        }
      });
    });
  }
  if (options?.onReturn) {
    const button = controls.createEl('button', { cls: 'dayline-mobile-mode-button dayline-mobile-return-button', attr: { type: 'button', 'aria-label': 'Back to note', title: 'Back to note' } });
    options?.setIcon?.(button, 'arrow-left');
    button.addEventListener('click', () => Promise.resolve(options.onReturn?.()).catch((error) => console.warn('[Dayline] Mobile note return failed:', error)));
  }
  return controls;
}
