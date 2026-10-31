export interface CalendarKeyboardEventLike {
  key?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
    getAttribute?: (name: string) => string | null;
  } | null;
}

// Day cells are `div[role=button]`, so the role has to be listed explicitly.
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [contenteditable], [role="button"]';

const DAY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * Days to move focus by when an unmodified arrow is pressed on a focused day
 * cell (one day sideways, one week up or down), or null for any other event.
 * The month shortcut must not also fire for these: a focused date that jumped a
 * whole month per keypress was the reported keyboard trap.
 */
export function calendarDayFocusStep(event: CalendarKeyboardEventLike): number | null {
  const step = event.key ? DAY_STEPS[event.key] : undefined;
  if (step === undefined) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const focusKey = event.target?.getAttribute?.('data-calendar-focus');
  return typeof focusKey === 'string' && focusKey.startsWith('day-') ? step : null;
}

/** Return true only for unmodified month shortcuts on non-interactive content. */
export function shouldHandleCalendarMonthShortcut(event: CalendarKeyboardEventLike): boolean {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;

  const target = event.target;
  if (!target) return true;
  if (target.isContentEditable) return false;
  const tagName = String(target.tagName || '').toLowerCase();
  if (['button', 'a', 'input', 'select', 'textarea'].includes(tagName)) return false;
  if (typeof target.closest === 'function' && target.closest(INTERACTIVE_SELECTOR)) return false;
  return true;
}
