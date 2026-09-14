export type MobileDiagnosticEvent = {
  name: string;
  at: string;
};

export type MobileDiagnosticsSnapshot = {
  pluginVersion: string;
  platform: {
    isMobile: boolean;
    isIos: boolean;
    isAndroid: boolean;
    isDesktop: boolean;
    coarsePointer: boolean;
    memoryConstrained: boolean;
  };
  routes: Record<string, string>;
  activeViewType: string | null;
  daylineLeaves: {
    calendar: number;
    timeline: number;
    legacy: number;
    total: number;
  };
  activeContent: {
    clientHeight: number | null;
    scrollHeight: number | null;
    childElementCount: number | null;
  } | null;
  journalEntryCount: number | null;
  events: MobileDiagnosticEvent[];
};

function bool(value: unknown): boolean {
  return value === true;
}

const SAFE_EVENT_NAMES = new Set([
  'plugin-loaded',
  'mobile-view-open-failed',
  'legacy-mobile-view-redirect',
  'mode-request:calendar',
  'mode-request:timeline',
]);

const SAFE_VIEW_TYPES = new Set([
  'calendar-sidebar-view',
  'journal-timeline-view',
  'dayline-mobile-view',
  'markdown',
  'empty',
]);

function nonNegativeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function leavesOfType(workspace: any, viewType: string): any[] {
  try {
    const leaves = workspace?.getLeavesOfType?.(viewType);
    return Array.isArray(leaves) ? leaves : [];
  } catch {
    return [];
  }
}

function safeViewType(leaf: any): string | null {
  let viewType: unknown;
  try {
    viewType = leaf?.view?.getViewType?.();
  } catch {
    viewType = undefined;
  }
  if (typeof viewType !== 'string') return null;
  return SAFE_VIEW_TYPES.has(viewType) ? viewType : 'other';
}

function activeContentMetrics(leaf: any, activeViewType: string | null) {
  if (!['calendar-sidebar-view', 'journal-timeline-view', 'dayline-mobile-view'].includes(activeViewType || '')) return null;
  const content = leaf?.view?.contentEl;
  if (!content) return null;
  return {
    clientHeight: nonNegativeNumber(content.clientHeight),
    scrollHeight: nonNegativeNumber(content.scrollHeight),
    childElementCount: nonNegativeNumber(content.childElementCount),
  };
}

function safeEvent(value: unknown): MobileDiagnosticEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as { name?: unknown; at?: unknown };
  const name = String(event.name ?? '');
  // Keep the snapshot privacy-safe even if a future caller records a path or note title.
  const safeName = SAFE_EVENT_NAMES.has(name) ? name : 'unknown';
  const at = typeof event.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at)
    ? event.at
    : 'unknown';
  return { name: safeName, at };
}

/** Build a privacy-safe snapshot for mobile troubleshooting. */
export function collectMobileDiagnostics(plugin: any): MobileDiagnosticsSnapshot {
  const capabilities = plugin?.capabilities || {};
  const workspace = plugin?.app?.workspace;
  const activeLeaf = workspace?.activeLeaf;
  const activeViewType = safeViewType(activeLeaf);
  const calendarLeaves = leavesOfType(workspace, 'calendar-sidebar-view');
  const timelineLeaves = leavesOfType(workspace, 'journal-timeline-view');
  const legacyLeaves = leavesOfType(workspace, 'dayline-mobile-view');
  let entries: unknown;
  try {
    entries = plugin?.journalIndex?.getEntries?.();
  } catch {
    entries = undefined;
  }
  const events = Array.isArray(plugin?._mobileDiagnosticEvents)
    ? plugin._mobileDiagnosticEvents.slice(-20).map(safeEvent).filter(Boolean) as MobileDiagnosticEvent[]
    : [];
  return {
    pluginVersion: String(plugin?.manifest?.version || 'unknown'),
    platform: {
      isMobile: bool(capabilities.isMobile),
      isIos: bool(capabilities.isIos),
      isAndroid: bool(capabilities.isAndroid),
      isDesktop: bool(capabilities.isDesktop),
      coarsePointer: bool(capabilities.coarsePointer),
      memoryConstrained: bool(capabilities.memoryConstrained),
    },
    routes: Object.fromEntries(Object.entries(capabilities.routes || {}).map(([key, value]) => [key, String(value)])),
    activeViewType,
    daylineLeaves: {
      calendar: calendarLeaves.length,
      timeline: timelineLeaves.length,
      legacy: legacyLeaves.length,
      total: calendarLeaves.length + timelineLeaves.length + legacyLeaves.length,
    },
    activeContent: activeContentMetrics(activeLeaf, activeViewType),
    journalEntryCount: Array.isArray(entries) ? entries.length : null,
    events,
  };
}

export function formatMobileDiagnostics(snapshot: MobileDiagnosticsSnapshot): string {
  return JSON.stringify({
    dayline: snapshot.pluginVersion,
    platform: snapshot.platform,
    routes: snapshot.routes,
    activeViewType: snapshot.activeViewType,
    daylineLeaves: snapshot.daylineLeaves,
    activeContent: snapshot.activeContent,
    journalEntryCount: snapshot.journalEntryCount,
    events: snapshot.events,
  }, null, 2);
}
