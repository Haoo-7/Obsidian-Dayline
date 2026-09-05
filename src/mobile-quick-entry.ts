export const MOBILE_QUICK_ENTRY_ICON = 'calendar-range';
export const MOBILE_QUICK_ENTRY_TITLE = 'Dayline';
export const MOBILE_QUICK_ENTRY_VIEW_TYPE = 'markdown';

export type MobileQuickEntryCapabilities = {
  isMobileApp?: boolean;
  isPhone?: boolean;
};

export type MobileQuickEntryPlugin = {
  capabilities?: MobileQuickEntryCapabilities | null;
  app?: {
    workspace?: {
      activeLeaf?: unknown;
    };
  };
  _mobileDaylineLastMode?: unknown;
  _activateMobileMode?: (mode: unknown) => unknown;
};

type TrackedAction = {
  leaf: { view?: unknown };
  view: unknown;
  element: HTMLElement;
  seenConnected: boolean;
};

function isPhoneMobileApp(capabilities: MobileQuickEntryCapabilities | null | undefined): boolean {
  return Boolean(capabilities?.isMobileApp && capabilities?.isPhone);
}

function leafViewType(leaf: unknown): string | null {
  try {
    const value = (leaf as { view?: { getViewType?: () => unknown } } | null)?.view?.getViewType?.();
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function isRemovableElement(value: unknown): value is HTMLElement {
  if (!value || typeof value !== 'object') return false;
  const element = value as HTMLElement;
  return element.nodeType === 1 && typeof element.remove === 'function';
}

function isConnectedElement(element: HTMLElement): boolean {
  if (typeof element.isConnected === 'boolean') return element.isConnected;
  return Boolean(element.parentNode);
}

function removeTrackedElement(element: HTMLElement): void {
  try {
    element.remove();
  } catch {
    // The ribbon and commands remain the fallback if a view action cannot be removed.
  }
}

function openLastDaylineMode(plugin: MobileQuickEntryPlugin): void {
  try {
    plugin._activateMobileMode?.(plugin._mobileDaylineLastMode || 'calendar');
  } catch {
    // Keep Markdown editing available if Dayline fails to open from the view action.
  }
}

/** Phone-app Markdown header action that opens the last Dayline mode through public ItemView APIs. */
export function createMobileMarkdownQuickEntry(plugin: MobileQuickEntryPlugin) {
  const tracked: TrackedAction[] = [];

  function disposeEntry(entry: TrackedAction): void {
    const index = tracked.indexOf(entry);
    if (index >= 0) tracked.splice(index, 1);
    removeTrackedElement(entry.element);
  }

  function prune(): void {
    for (const entry of [...tracked]) {
      if (isConnectedElement(entry.element)) entry.seenConnected = true;
      const viewChanged = entry.leaf?.view !== entry.view;
      const viewTypeChanged = leafViewType(entry.leaf) !== MOBILE_QUICK_ENTRY_VIEW_TYPE;
      const disconnected = entry.seenConnected && !isConnectedElement(entry.element);
      if (viewChanged || viewTypeChanged || disconnected) disposeEntry(entry);
    }
  }

  function disposeAll(): void {
    for (const entry of [...tracked]) disposeEntry(entry);
  }

  function existingEntry(leaf: TrackedAction['leaf'], view: unknown): TrackedAction | undefined {
    return tracked.find((entry) => entry.leaf === leaf && entry.view === view);
  }

  function install(leaf: TrackedAction['leaf']): void {
    const view = leaf?.view as {
      addAction?: (icon: string, title: string, callback: (evt: MouseEvent) => unknown) => unknown;
    } | null;
    if (!view || existingEntry(leaf, view)) return;
    if (typeof view.addAction !== 'function') return;

    let element: unknown;
    try {
      element = view.addAction(MOBILE_QUICK_ENTRY_ICON, MOBILE_QUICK_ENTRY_TITLE, () => {
        openLastDaylineMode(plugin);
      });
    } catch {
      return;
    }
    if (!isRemovableElement(element)) return;
    tracked.push({
      leaf,
      view,
      element,
      seenConnected: isConnectedElement(element),
    });
  }

  function sync(): void {
    prune();
    if (!isPhoneMobileApp(plugin.capabilities)) {
      disposeAll();
      return;
    }

    let leaf: TrackedAction['leaf'] | null = null;
    try {
      leaf = (plugin.app?.workspace?.activeLeaf || null) as TrackedAction['leaf'] | null;
    } catch {
      return;
    }
    if (!leaf || leafViewType(leaf) !== MOBILE_QUICK_ENTRY_VIEW_TYPE) return;
    install(leaf);
  }

  function dispose(): void {
    disposeAll();
  }

  return { sync, dispose };
}
