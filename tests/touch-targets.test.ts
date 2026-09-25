// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_POINTER_MOVE_THRESHOLD, COARSE_POINTER_MIN, bindOpenOnPointer, calendarCellTouchRouting, hasTouchTargetSize, isCalendarTapGesture, touchTargetSize } from '../src/touch-targets';

function pointerEvent(type: string, clientX = 0, clientY = 0, pointerId = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: pointerId },
    isPrimary: { value: true },
  });
  return event;
}

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
    const windowsTouch = calendarCellTouchRouting(true, false);
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
    expect(windowsTouch).toMatchObject({
      primary: 'date-open',
      secondary: 'in-cell',
      showMoodControl: true,
      showEntryCountControl: true,
      showMediaInfoControl: true,
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

describe('bindOpenOnPointer', () => {
  it('opens immediately on desktop pointerdown', () => {
    const element = document.createElement('div');
    const onOpen = vi.fn();
    bindOpenOnPointer(element, { onOpen });
    element.dispatchEvent(pointerEvent('pointerdown'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('opens a coarse tap on pointerup and ignores a drag', () => {
    const element = document.createElement('div');
    const onOpen = vi.fn();
    bindOpenOnPointer(element, { coarsePointer: true, onOpen });
    element.dispatchEvent(pointerEvent('pointerdown', 8, 8));
    window.dispatchEvent(pointerEvent('pointermove', 8, 8 + CALENDAR_POINTER_MOVE_THRESHOLD + 1));
    window.dispatchEvent(pointerEvent('pointerup', 8, 8 + CALENDAR_POINTER_MOVE_THRESHOLD + 1));
    expect(onOpen).not.toHaveBeenCalled();
    element.dispatchEvent(pointerEvent('pointerdown', 8, 8));
    window.dispatchEvent(pointerEvent('pointerup', 8, 8));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('skips targets rejected by shouldOpen', () => {
    const element = document.createElement('div');
    const ignored = document.createElement('button');
    element.append(ignored);
    const onOpen = vi.fn();
    bindOpenOnPointer(element, { shouldOpen: (target) => target !== ignored, onOpen });
    ignored.dispatchEvent(pointerEvent('pointerdown'));
    expect(onOpen).not.toHaveBeenCalled();
    element.dispatchEvent(pointerEvent('pointerdown'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
