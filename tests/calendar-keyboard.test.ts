import { describe, expect, it } from 'vitest';
import { shouldHandleCalendarMonthShortcut } from '../src/calendar-keyboard';

function target(tagName = 'div', options: Record<string, unknown> = {}) {
  return { tagName, ...options };
}

describe('calendar month keyboard shortcuts', () => {
  it('accepts only unmodified arrows on non-interactive content', () => {
    expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowLeft', target: target() })).toBe(true);
    expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowRight', target: target() })).toBe(true);
    expect(shouldHandleCalendarMonthShortcut({ key: 'Enter', target: target() })).toBe(false);
    expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowLeft', altKey: true, target: target() })).toBe(false);
    expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowLeft', ctrlKey: true, target: target() })).toBe(false);
    expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowLeft', metaKey: true, target: target() })).toBe(false);
    expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowLeft', shiftKey: true, target: target() })).toBe(false);
  });

  it('ignores interactive targets and descendants', () => {
    for (const tagName of ['button', 'a', 'input', 'select', 'textarea']) {
      expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowRight', target: target(tagName) })).toBe(false);
    }
    expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowRight', target: target('div', { isContentEditable: true }) })).toBe(false);
    expect(shouldHandleCalendarMonthShortcut({
      key: 'ArrowLeft',
      target: target('span', { closest: (selector: string) => selector.includes('button') ? {} : null }),
    })).toBe(false);
  });
});
