import { describe, expect, it } from 'vitest';
import { calendarDayFocusStep, shouldHandleCalendarMonthShortcut } from '../src/calendar-keyboard';

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

  it('leaves arrows on a focused day cell to day navigation', () => {
    // Day cells are div[role=button]; the tag check alone let them turn the month.
    const dayCell = target('div', {
      closest: (selector: string) => selector.includes('[role="button"]') ? {} : null,
    });
    expect(shouldHandleCalendarMonthShortcut({ key: 'ArrowRight', target: dayCell })).toBe(false);
  });
});

describe('calendar day focus steps', () => {
  const day = (focusKey: string | null = 'day-2026-10-15') => target('div', {
    getAttribute: (name: string) => (name === 'data-calendar-focus' ? focusKey : null),
  });

  it('moves one day sideways and one week vertically', () => {
    expect(calendarDayFocusStep({ key: 'ArrowLeft', target: day() })).toBe(-1);
    expect(calendarDayFocusStep({ key: 'ArrowRight', target: day() })).toBe(1);
    expect(calendarDayFocusStep({ key: 'ArrowUp', target: day() })).toBe(-7);
    expect(calendarDayFocusStep({ key: 'ArrowDown', target: day() })).toBe(7);
  });

  it('ignores other keys, modifiers, and anything that is not a day cell', () => {
    expect(calendarDayFocusStep({ key: 'Enter', target: day() })).toBeNull();
    expect(calendarDayFocusStep({ key: 'ArrowRight', shiftKey: true, target: day() })).toBeNull();
    expect(calendarDayFocusStep({ key: 'ArrowRight', target: day('previous') })).toBeNull();
    expect(calendarDayFocusStep({ key: 'ArrowRight', target: day(null) })).toBeNull();
    expect(calendarDayFocusStep({ key: 'ArrowRight', target: target() })).toBeNull();
    expect(calendarDayFocusStep({ key: 'ArrowRight', target: null })).toBeNull();
  });
});
