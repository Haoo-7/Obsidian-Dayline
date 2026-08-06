const INTERACTIVE_TIMELINE_TARGETS = 'button, a, input, textarea, select, option, summary, [role="button"], [contenteditable="true"]';

export function isInteractiveTimelineTarget(target: unknown): boolean {
  return Boolean((target as { closest?: (selector: string) => unknown } | null)?.closest?.(INTERACTIVE_TIMELINE_TARGETS));
}

export function shouldOpenTimelineEntryFromKey(event: { key?: string; target?: unknown } | null | undefined): boolean {
  if (event?.key !== 'Enter' && event?.key !== ' ') return false;
  return !isInteractiveTimelineTarget(event.target);
}
