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

export type BindOpenOnPointerOptions = {
  coarsePointer?: boolean;
  shouldOpen?: (target: EventTarget | null) => boolean;
  onOpen: (event: Event) => void;
};

/**
 * Desktop opens on pointerdown so the first click after sidebar focus loss is
 * not absorbed by Obsidian's leaf activation. Coarse pointers wait for release
 * and cancel when movement exceeds the tap threshold.
 */
export function bindOpenOnPointer(
  element: { addEventListener: (type: string, listener: (event: PointerEvent) => void, options?: AddEventListenerOptions) => void },
  options: BindOpenOnPointerOptions,
): void {
  const shouldOpen = options.shouldOpen ?? (() => true);
  const { onOpen } = options;

  if (options.coarsePointer) {
    let gesture: { pointerId: number; startX: number; startY: number; canceled: boolean } | null = null;
    const eventTarget = typeof window !== 'undefined' ? window : element as unknown as Window;
    const cleanup = () => {
      eventTarget.removeEventListener('pointermove', onMove);
      eventTarget.removeEventListener('pointerup', onUp);
      eventTarget.removeEventListener('pointercancel', onCancel);
      gesture = null;
    };
    const onMove = (event: Event) => {
      const pointer = event as PointerEvent;
      if (!gesture || pointer.pointerId !== gesture.pointerId) return;
      if (!isCalendarTapGesture(gesture.startX, gesture.startY, pointer.clientX, pointer.clientY)) {
        gesture.canceled = true;
      }
    };
    const onUp = (event: Event) => {
      const pointer = event as PointerEvent;
      if (!gesture || pointer.pointerId !== gesture.pointerId) return;
      const tap = !gesture.canceled
        && isCalendarTapGesture(gesture.startX, gesture.startY, pointer.clientX, pointer.clientY);
      cleanup();
      if (!tap) return;
      pointer.preventDefault();
      pointer.stopPropagation();
      onOpen(pointer);
    };
    const onCancel = (event: Event) => {
      const pointer = event as PointerEvent;
      if (!gesture || pointer.pointerId !== gesture.pointerId) return;
      cleanup();
    };
    element.addEventListener('pointerdown', (event) => {
      if (!shouldOpen(event.target)) return;
      if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      cleanup();
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        canceled: false,
      };
      eventTarget.addEventListener('pointermove', onMove, { passive: true });
      eventTarget.addEventListener('pointerup', onUp, { passive: false });
      eventTarget.addEventListener('pointercancel', onCancel, { passive: true });
    });
    return;
  }

  element.addEventListener('pointerdown', (event) => {
    if (!shouldOpen(event.target)) return;
    event.stopPropagation();
    onOpen(event);
  });
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
