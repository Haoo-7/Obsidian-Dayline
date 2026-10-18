import { isCalendarTapGesture } from './touch-targets';

/** Hold that qualifies as "ask about this photo" rather than "place my cursor". */
export const NOTE_MEDIA_LONG_PRESS_MS = 450;
export const NOTE_MEDIA_PRESS_TOLERANCE_PX = 10;

/** The pointer fields the gesture reads, so a stub event is enough in tests. */
export type NoteMediaPressEvent = {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  isPrimary?: boolean;
  button?: number;
};

export type NoteMediaPressTarget = {
  addEventListener: (type: string, listener: (event: NoteMediaPressEvent) => void, options?: AddEventListenerOptions | boolean) => void;
  removeEventListener: (type: string, listener: (event: NoteMediaPressEvent) => void) => void;
};

export type NoteMediaPressHost = { closest?: (selector: string) => unknown } | null | undefined;

type Press = { pointerId?: number; x: number; y: number };

/**
 * CodeMirror owns every node under `.cm-content` and reads unrecognised DOM
 * back as editor content. A control injected into a photo's line re-syncs that
 * line, which on iOS swallowed the Return key whenever the line below the
 * caret was an image.
 */
export function isInsideEditorContentDom(el: NoteMediaPressHost): boolean {
  return Boolean(el?.closest?.('.cm-content'));
}

/**
 * Phones get a gesture, because a gesture needs no DOM of its own. Reading
 * view is static and keeps the visible info button; fine pointers use hover.
 */
export function shouldUseNoteMediaLongPress(el: NoteMediaPressHost, coarsePointer?: boolean): boolean {
  return Boolean(coarsePointer) && isInsideEditorContentDom(el);
}

/**
 * Bind a long press that opens `onOpen`, cancelling on drag (page scroll) and
 * on release before the hold elapsed. Nothing is prevented, so a tap that is
 * not a long press still reaches the editor as cursor placement. Returns a
 * disposer that removes every listener it added.
 */
export function bindNoteMediaLongPress(
  target: NoteMediaPressTarget,
  onOpen: () => void,
  {
    delayMs = NOTE_MEDIA_LONG_PRESS_MS,
    moveTolerance = NOTE_MEDIA_PRESS_TOLERANCE_PX,
  }: { delayMs?: number; moveTolerance?: number } = {},
): () => void {
  let press: Press | null = null;
  let timer: number | null = null;

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    press = null;
  };
  const onPointerDown = (event: NoteMediaPressEvent) => {
    if (event.isPrimary === false) return;
    if (event.button !== undefined && event.button !== 0) return;
    cancel();
    press = { pointerId: event.pointerId, x: event.clientX ?? 0, y: event.clientY ?? 0 };
    timer = window.setTimeout(() => {
      timer = null;
      press = null;
      onOpen();
    }, delayMs);
  };
  const onPointerMove = (event: NoteMediaPressEvent) => {
    if (!press || timer === null || event.pointerId !== press.pointerId) return;
    if (!isCalendarTapGesture(press.x, press.y, event.clientX ?? 0, event.clientY ?? 0, moveTolerance)) cancel();
  };
  const onPointerUp = (event: NoteMediaPressEvent) => {
    if (press && event.pointerId === press.pointerId) cancel();
  };

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove, { passive: true });
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', cancel);

  return () => {
    cancel();
    target.removeEventListener('pointerdown', onPointerDown);
    target.removeEventListener('pointermove', onPointerMove);
    target.removeEventListener('pointerup', onPointerUp);
    target.removeEventListener('pointercancel', cancel);
  };
}
