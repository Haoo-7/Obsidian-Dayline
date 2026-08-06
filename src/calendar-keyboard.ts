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
  } | null;
}

const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [contenteditable]';

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
