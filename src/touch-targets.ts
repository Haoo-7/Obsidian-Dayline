export const COARSE_POINTER_MIN = 44;

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

export function calendarCellTouchRouting(coarsePointer: boolean): CalendarCellTouchRouting {
  if (coarsePointer) {
    return {
      primary: 'date-open',
      secondary: 'external-surface',
      showMoodControl: false,
      showEntryCountControl: false,
      showMediaInfoControl: false,
      focusMediaBackground: false,
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
