import { describe, expect, it } from 'vitest';
import { CALENDAR_POINTER_MOVE_THRESHOLD, COARSE_POINTER_MIN, calendarCellTouchRouting, hasTouchTargetSize, isCalendarTapGesture, touchTargetSize } from '../src/touch-targets';

describe('touch targets', () => {
  it('uses 44px controls for coarse pointers and preserves desktop sizing', () => {
    expect(touchTargetSize(true, 28)).toBe(COARSE_POINTER_MIN);
    expect(touchTargetSize(false, 28)).toBe(28);
    expect(hasTouchTargetSize(44, 44, true)).toBe(true);
    expect(hasTouchTargetSize(28, 28, true)).toBe(false);
    expect(hasTouchTargetSize(28, 28, false)).toBe(true);
  });

  it('keeps one date-open primary surface on coarse calendar cells', () => {
    const coarse = calendarCellTouchRouting(true);
    const desktop = calendarCellTouchRouting(false);
    expect(coarse).toMatchObject({
      primary: 'date-open',
      secondary: 'external-surface',
      showMoodControl: false,
      showEntryCountControl: false,
      showMediaInfoControl: false,
      focusMediaBackground: false,
    });
    expect(desktop).toMatchObject({
      primary: 'date-open',
      secondary: 'in-cell',
      showMoodControl: true,
      showEntryCountControl: true,
      focusMediaBackground: true,
    });
  });

  it('distinguishes a tap from a scroll gesture without device-specific branches', () => {
    expect(isCalendarTapGesture(10, 10, 10 + CALENDAR_POINTER_MOVE_THRESHOLD, 10)).toBe(true);
    expect(isCalendarTapGesture(10, 10, 10 + CALENDAR_POINTER_MOVE_THRESHOLD + 1, 10)).toBe(false);
    expect(isCalendarTapGesture(10, 10, 10, 10 + CALENDAR_POINTER_MOVE_THRESHOLD)).toBe(true);
    expect(isCalendarTapGesture(10, 10, 10, 10, -1)).toBe(false);
  });
});
