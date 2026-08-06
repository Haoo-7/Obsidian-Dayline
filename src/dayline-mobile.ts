export type DaylineMobileMode = 'calendar' | 'timeline';

export const MOBILE_DAYLINE_VIEW = 'dayline-mobile-view';

export function normalizeDaylineMobileMode(value: unknown): DaylineMobileMode {
  return value === 'timeline' ? 'timeline' : 'calendar';
}

/** Return the one existing Dayline tab, or create a new main-workspace tab. */
export function getMobileDaylineLeaf(workspace: any, viewType = MOBILE_DAYLINE_VIEW): any | null {
  const existing = workspace?.getLeavesOfType?.(viewType)?.[0];
  if (existing) return existing;
  return workspace?.getLeaf?.('tab') || workspace?.getLeaf?.(true) || null;
}

/** Open notes beside Dayline, never by replacing its tab or using a split. */
export function getMobileMarkdownLeaf(workspace: any): any | null {
  const activeLeaf = workspace?.activeLeaf;
  if (activeLeaf?.view?.getViewType?.() === 'markdown') return activeLeaf;
  return workspace?.getLeavesOfType?.('markdown')?.[0]
    || workspace?.getLeaf?.('tab')
    || workspace?.getLeaf?.(true)
    || null;
}

export function isDaylineMobileMode(value: unknown, mode: DaylineMobileMode): boolean {
  return normalizeDaylineMobileMode(value) === mode;
}

/** Keep mode lifecycle work ordered so subscriptions cannot overlap. */
export function createSerialDaylineModeSwitcher(
  apply: (mode: DaylineMobileMode) => Promise<void> | void,
): (mode: unknown) => Promise<void> {
  let pending = Promise.resolve();
  return (mode: unknown) => {
    const normalized = normalizeDaylineMobileMode(mode);
    pending = pending.catch(() => undefined).then(() => apply(normalized));
    return pending;
  };
}

/** Bind the two embedded renderers to the one mobile tab and verify it worked. */
export function bindMobileEmbeddedViewHost(view: any, host: any): void {
  if (!view || !host) throw new Error('embedded Dayline view requires a host');
  Object.defineProperties(view, {
    containerEl: { configurable: true, writable: true, value: host },
    contentEl: { configurable: true, writable: true, value: host },
  });
  if (view.containerEl !== host || view.contentEl !== host) {
    throw new Error('could not bind embedded Dayline view host');
  }
}
