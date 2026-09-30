export type DaylineMobileMode = 'calendar' | 'timeline';

/** Legacy view type kept only to migrate restored mobile workspace state. */
export const MOBILE_DAYLINE_VIEW = 'dayline-mobile-view';

export const DAYLINE_VIEW_TYPES = [
  'calendar-sidebar-view',
  'journal-timeline-view',
  MOBILE_DAYLINE_VIEW,
] as const;

export type DaylineLeafFilter = {
  getLeavesOfType?: (viewType: string) => Array<any>;
};

export type MobileDaylineModeLabels = {
  calendar: string;
  timeline: string;
};

export type MobileDaylineModeControlsOptions = {
  activeMode: unknown;
  labels: MobileDaylineModeLabels;
  /** Accessible name for the control group; callers pass a localized string. */
  groupLabel?: string;
  /** Accessible name for the "return to the note" button. */
  returnLabel?: string;
  /** Tooltip explaining where the return button goes. */
  returnHint?: string;
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

/** Unique ids for the visible return hint so aria-describedby stays unambiguous. */
let mobileReturnHintSequence = 0;

export type MobileDaylineModeControllerOptions = {
  getLeaf: () => any;
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

function leafRoot(leaf: any): any {
  if (!leaf || typeof leaf.getRoot !== 'function') return null;
  try {
    return leaf.getRoot();
  } catch {
    return null;
  }
}

/** Whether a view type belongs to Dayline itself. */
export function isDaylineViewType(viewType: unknown): boolean {
  return typeof viewType === 'string' && (DAYLINE_VIEW_TYPES as readonly string[]).includes(viewType);
}

/** Whether a leaf currently hosts one of Dayline's own views. */
export function isDaylineLeaf(leaf: any): boolean {
  return isDaylineViewType(leafViewType(leaf));
}

/** Whether a leaf can host a journal note. */
export function isJournalHostLeaf(leaf: any): boolean {
  const viewType = leafViewType(leaf);
  return viewType === 'markdown' || viewType === 'empty';
}

/**
 * Whether the leaf lives in the workspace's main area. The phone layout keeps
 * Dayline in a right drawer, so only main-area leaves may host a journal note
 * (and only they are worth remembering between dates).
 */
export function isMainAreaLeaf(workspace: any, leaf: any): boolean {
  if (!leaf) return false;
  const mainRoot = workspace?.rootSplit;
  if (!mainRoot || typeof leaf.getRoot !== 'function') return true;
  const root = leafRoot(leaf);
  return !root || root === mainRoot;
}

/**
 * Whether `leaf` is still attached to the workspace. A remembered leaf can
 * outlive a tab the user closed, and opening a note into a detached leaf would
 * silently lose it.
 */
export function isAttachedWorkspaceLeaf(workspace: any, leaf: any): boolean {
  if (!leaf) return false;
  if (leaf.parent) return true;
  for (const viewType of ['markdown', 'empty']) {
    let found: Array<any> = [];
    try {
      found = workspace?.getLeavesOfType?.(viewType) || [];
    } catch {
      found = [];
    }
    if (found.includes(leaf)) return true;
  }
  return false;
}

/** List every open Dayline leaf without making workspace-topology assumptions. */
export function getDaylineLeaves(workspace: DaylineLeafFilter | null | undefined): Array<any> {
  const leaves: Array<any> = [];
  if (!workspace || typeof workspace.getLeavesOfType !== 'function') return leaves;
  for (const viewType of DAYLINE_VIEW_TYPES) {
    let found: Array<any> = [];
    try {
      found = workspace.getLeavesOfType(viewType) || [];
    } catch {
      found = [];
    }
    for (const leaf of found) {
      if (leaf && !leaves.includes(leaf)) leaves.push(leaf);
    }
  }
  return leaves;
}

/** Find a single Dayline drawer leaf, preferring the user's last opened view. */
export function getPreferredDaylineLeaf(
  workspace: DaylineLeafFilter | null | undefined,
  lastViewType?: unknown,
): any {
  const leaves = getDaylineLeaves(workspace);
  if (leaves.length === 0) return null;
  if (typeof lastViewType === 'string' && lastViewType.length > 0) {
    const match = leaves.find((leaf) => leafViewType(leaf) === lastViewType);
    if (match) return match;
  }
  for (const viewType of DAYLINE_VIEW_TYPES) {
    const match = leaves.find((leaf) => leafViewType(leaf) === viewType);
    if (match) return match;
  }
  return leaves[0];
}

/** Find a real Dayline leaf without making any workspace-topology assumptions. */
export function getMobileDaylineLeaf(
  workspace: any,
  viewTypes: readonly string[] = [MOBILE_DAYLINE_VIEW],
): any {
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
export async function setMobileDaylineLeafView(leaf: any, viewType: string): Promise<any> {
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
 * Pick the leaf that should host a journal note. Notes reuse the active or first
 * Markdown leaf and never split the workspace. On phones Dayline lives in a
 * right drawer, so `journalLeaf` must be a main-area leaf that previously hosted
 * a note; the Dayline drawer leaf is never a valid fallback target, otherwise
 * the note would replace the calendar and a fresh drawer leaf would pile up on
 * every later open.
 */
export function getJournalOpenLeaf(workspace: any, isMobile = false, journalLeaf: any = null): any {
  const activeLeaf = workspace?.activeLeaf;
  if (activeLeaf?.view?.getViewType?.() === 'markdown') return activeLeaf;
  const existing = workspace?.getLeavesOfType?.('markdown')?.[0];
  if (existing) return existing;
  if (!isMobile) return workspace?.getLeaf?.(true) || null;
  if (journalLeaf && !isDaylineLeaf(journalLeaf) && isMainAreaLeaf(workspace, journalLeaf)) return journalLeaf;
  const empty = (workspace?.getLeavesOfType?.('empty') || [])
    .find((candidate: any) => !isDaylineLeaf(candidate) && isMainAreaLeaf(workspace, candidate));
  if (empty) return empty;
  return workspace?.getLeaf?.('tab') || workspace?.getLeaf?.(true) || null;
}

/** Resolve a remembered phone journal leaf, dropping detached or Dayline leaves. */
export function resolveMobileJournalLeaf(workspace: any, recorded: any): any {
  const reusable = recorded
    && isJournalHostLeaf(recorded)
    && isAttachedWorkspaceLeaf(workspace, recorded)
    && isMainAreaLeaf(workspace, recorded)
    ? recorded
    : null;
  return getJournalOpenLeaf(workspace, true, reusable);
}

/**
 * Resolve the leaf "return to note" should reveal. It never falls back to a
 * Dayline leaf: turning the calendar into an empty Markdown view is worse than
 * reporting that there is nothing to return to.
 */
export function resolveMobileReturnLeaf(workspace: any, candidate: any): any {
  if (candidate && isDaylineLeaf(candidate)) return null;
  if (candidate
    && isJournalHostLeaf(candidate)
    && isAttachedWorkspaceLeaf(workspace, candidate)
    && isMainAreaLeaf(workspace, candidate)) {
    return candidate;
  }
  const existing = (workspace?.getLeavesOfType?.('markdown') || [])
    .find((leaf: any) => !isDaylineLeaf(leaf) && isMainAreaLeaf(workspace, leaf));
  return existing || null;
}

/** Open notes beside Dayline, never by replacing its tab or using a split. */
export function getMobileMarkdownLeaf(workspace: any): any {
  return getJournalOpenLeaf(workspace, true);
}

/** Render the shared mobile mode control inside a real Dayline ItemView. */
export function renderMobileDaylineModeControls(parent: any, options: MobileDaylineModeControlsOptions): any {
  const controls = parent?.createDiv?.({
    cls: 'dayline-mobile-mode-controls dayline-mobile-native-mode-controls',
    attr: { role: 'group', 'aria-label': options?.groupLabel || 'Dayline view' },
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
    const returnLabel = options?.returnLabel || 'Back to note';
    const returnHint = typeof options?.returnHint === 'string' && options.returnHint.length > 0
      ? options.returnHint
      : returnLabel;
    // A `title` is invisible on a touch device, so the hint becomes real text
    // next to the button and the button points at it with aria-describedby.
    const hintId = `dayline-mobile-return-hint-${mobileReturnHintSequence++}`;
    const button = controls.createEl('button', {
      cls: 'dayline-mobile-mode-button dayline-mobile-return-button',
      attr: { type: 'button', 'aria-label': returnLabel, title: returnLabel, 'aria-describedby': hintId },
    });
    options?.setIcon?.(button, 'arrow-left');
    const hint = controls.createEl('span', {
      cls: 'dayline-mobile-return-hint',
      text: returnHint,
      attr: { id: hintId },
    });
    button.addEventListener('click', () => {
      // The guidance did its job once the user took the action.
      hint?.remove?.();
      Promise.resolve(options.onReturn?.()).catch((error) => console.warn('[Dayline] Mobile note return failed:', error));
    });
  }
  return controls;
}
