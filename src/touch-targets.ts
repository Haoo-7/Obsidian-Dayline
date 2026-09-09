export const COARSE_POINTER_MIN = 44;
export const CALENDAR_POINTER_MOVE_THRESHOLD = 10;

export type CalendarCellTouchRouting = {
  primary: 'date-open';
  secondary: 'external-surface' | 'in-cell';
  showMoodControl: boolean;
  showEntryCountControl: boolean;
  showMediaInfoControl: boolean;
  focusMediaBackground: boolean;
};

export function touchTargetSize(coarsePointer: boolean, desktopSize = 28): number {
  return coarsePointer ? COARSE_POINTER_MIN : desktopSize;
}

export function hasTouchTargetSize(width: number, height: number, coarsePointer: boolean): boolean {
  return !coarsePointer || (width >= COARSE_POINTER_MIN && height >= COARSE_POINTER_MIN);
}

/** A coarse-pointer release is a tap only when it stayed within this radius. */
export function isCalendarTapGesture(
  startX: unknown,
  startY: unknown,
  endX: unknown,
  endY: unknown,
  threshold = CALENDAR_POINTER_MOVE_THRESHOLD,
): boolean {
  const values = [startX, startY, endX, endY, threshold].map(Number);
  if (!values.every(Number.isFinite) || values[4] < 0) return false;
  return Math.hypot(values[2] - values[0], values[3] - values[1]) <= values[4];
}

export function calendarCellTouchRouting(coarsePointer: boolean, isMobile = coarsePointer): CalendarCellTouchRouting {
  // Phone layouts keep one large date surface so scrolling never competes with
  // nested controls. Touch-capable desktop hosts (notably Windows) still need
  // the calendar mood affordance exposed in each cell.
  if (coarsePointer && isMobile) {
    return {
      primary: 'date-open',
      secondary: 'external-surface',
      showMoodControl: false,
      showEntryCountControl: false,
      showMediaInfoControl: false,
      focusMediaBackground: false,
    };
  }
  if (coarsePointer) {
    return {
      primary: 'date-open',
      secondary: 'in-cell',
      showMoodControl: true,
      showEntryCountControl: true,
      showMediaInfoControl: true,
      focusMediaBackground: true,
    };
  }
  return {
    primary: 'date-open',
    secondary: 'in-cell',
    showMoodControl: true,
    showEntryCountControl: true,
    showMediaInfoControl: true,
    focusMediaBackground: true,
  };
}
