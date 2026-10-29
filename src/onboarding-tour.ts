/**
 * Dayline's first-run onboarding tour: the `九步` spotlight from
 * `docs/2026-10-29-onboarding-tour-handoff.md`.
 *
 * This module is deliberately free of Obsidian and DOM APIs. It owns the three
 * decisions that are easy to get wrong and easy to test without an app:
 *
 * - which steps a given install walks (desktop, phone, and the two-step
 *   empty-library version),
 * - where the tour is in that sequence, and what ending it reached,
 * - where the explanation card sits so it never covers the highlight and never
 *   leaves the window.
 *
 * The overlay (`onboarding-tour-overlay.ts`) does the measuring and painting.
 */

/** Written to `data.json` once the tour has been shown, skipped, or finished. */
export const ONBOARDING_TOUR_VERSION = 1;

/** Desktop keeps the ribbon and the right-hand timeline; the phone does not. */
export type OnboardingSurface = 'desktop' | 'mobile';

export type OnboardingStepId =
  | 'calendar'
  | 'day'
  | 'mood'
  | 'weather'
  | 'timeline-entry'
  | 'timeline-list'
  | 'timeline-search'
  | 'settings'
  | 'today';

/** Preferred side of the target for the card. */
export type OnboardingPlacement = 'right' | 'left' | 'below' | 'above';

/** What the card actually ended up doing. `sheet` is the phone drawer. */
export type OnboardingCardMode = OnboardingPlacement | 'sheet';

export interface OnboardingStep {
  readonly id: OnboardingStepId;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly placement: OnboardingPlacement;
}

export interface OnboardingSequenceOptions {
  readonly surface: OnboardingSurface;
  readonly hasEntries: boolean;
  /** Weather card is on screen, not merely enabled: a hidden card gets other copy. */
  readonly weatherVisible: boolean;
}

function step(
  id: OnboardingStepId,
  placement: OnboardingPlacement,
  titleKey: string,
  bodyKey: string,
): OnboardingStep {
  return { id, placement, titleKey, bodyKey };
}

/**
 * The order is deliberate: look at what is already on screen (calendar, a day,
 * the mood picker, the weather card), then leave the sidebar to meet the entry
 * point and the views it opens (timeline, search, settings), then come back to
 * today and start writing.
 */
export function buildOnboardingSteps(options: OnboardingSequenceOptions): OnboardingStep[] {
  if (!options.hasEntries) {
    // An empty library has nothing to point at in the grid, so the tour keeps
    // only the two things this user can act on: connect the folder, write today.
    return [
      step('calendar', 'right', 'onboardingStepFolderTitle', 'onboardingStepFolderBody'),
      step('today', 'below', 'onboardingStepTodayTitle', 'onboardingStepTodayBody'),
    ];
  }

  const weatherStep = options.weatherVisible
    ? step('weather', 'right', 'onboardingStepWeatherTitle', 'onboardingStepWeatherBody')
    : step('weather', 'right', 'onboardingStepWeatherOffTitle', 'onboardingStepWeatherOffBody');

  if (options.surface === 'mobile') {
    // No ribbon and no second pane on a phone, so the timeline entry point and
    // the settings pane are not separate stops; the drawer simply switches.
    return [
      step('calendar', 'right', 'onboardingStepCalendarTitle', 'onboardingStepCalendarBody'),
      step('day', 'below', 'onboardingStepDayTitle', 'onboardingStepDayBody'),
      step('mood', 'left', 'onboardingStepMoodTitle', 'onboardingStepMoodBody'),
      step('timeline-list', 'left', 'onboardingStepTimelineListTitle', 'onboardingStepTimelineListBody'),
      step('today', 'below', 'onboardingStepTodayTitle', 'onboardingStepTodayBody'),
    ];
  }

  return [
    step('calendar', 'right', 'onboardingStepCalendarTitle', 'onboardingStepCalendarBody'),
    step('day', 'below', 'onboardingStepDayTitle', 'onboardingStepDayBody'),
    step('mood', 'left', 'onboardingStepMoodTitle', 'onboardingStepMoodBody'),
    weatherStep,
    step('timeline-entry', 'right', 'onboardingStepTimelineEntryTitle', 'onboardingStepTimelineEntryBody'),
    step('timeline-list', 'left', 'onboardingStepTimelineListTitle', 'onboardingStepTimelineListBody'),
    step('timeline-search', 'left', 'onboardingStepSearchTitle', 'onboardingStepSearchBody'),
    step('settings', 'left', 'onboardingStepSettingsTitle', 'onboardingStepSettingsBody'),
    step('today', 'below', 'onboardingStepTodayTitle', 'onboardingStepTodayBody'),
  ];
}

export type OnboardingOutcome = 'finished' | 'skipped' | 'abandoned';

/**
 * Cursor over one built sequence. `next()` past the last step finishes the
 * tour, so every caller that walks forward ends in exactly one state.
 */
export class OnboardingTourState {
  private readonly stepList: OnboardingStep[];
  private cursor = 0;
  private outcome: OnboardingOutcome | null = null;

  constructor(steps: readonly OnboardingStep[]) {
    if (!steps.length) throw new Error('An onboarding tour needs at least one step');
    this.stepList = [...steps];
  }

  get steps(): readonly OnboardingStep[] {
    return this.stepList;
  }

  get total(): number {
    return this.stepList.length;
  }

  get index(): number {
    return this.cursor;
  }

  get step(): OnboardingStep {
    return this.stepList[this.cursor];
  }

  get isFirst(): boolean {
    return this.cursor === 0;
  }

  get isLast(): boolean {
    return this.cursor === this.stepList.length - 1;
  }

  get result(): OnboardingOutcome | null {
    return this.outcome;
  }

  get done(): boolean {
    return this.outcome !== null;
  }

  /** Move forward; moving past the last step finishes the tour. */
  next(): boolean {
    if (this.done) return false;
    if (this.isLast) {
      this.outcome = 'finished';
      return false;
    }
    this.cursor += 1;
    return true;
  }

  /** Move back; the first step has nowhere to go. */
  back(): boolean {
    if (this.done || this.isFirst) return false;
    this.cursor -= 1;
    return true;
  }

  /** Jump to a step index. Returns false for an out-of-range index. */
  goTo(index: number): boolean {
    if (this.done) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.stepList.length) return false;
    this.cursor = index;
    return true;
  }

  /** "写今天": the last step's primary button ends the tour here. */
  finish(): boolean {
    if (this.done) return false;
    this.outcome = 'finished';
    return true;
  }

  skip(): boolean {
    if (this.done) return false;
    this.outcome = 'skipped';
    return true;
  }

  /** Closed by the host (plugin unload, a vanished target, an unexpected error). */
  abandon(): boolean {
    if (this.done) return false;
    this.outcome = 'abandoned';
    return true;
  }
}

export type OnboardingStartDecision = 'show' | 'mark-seen' | 'skip';

/**
 * Whether this launch should show the tour.
 *
 * A brand-new install has no `data.json` at all, which is the only state that
 * may interrupt the user. An install that already carries settings but no
 * `onboardingSeenVersion` is an upgrade: the marker is written silently so the
 * tour never appears for someone who already knows the calendar.
 */
export function resolveOnboardingStart(options: {
  seenVersion?: unknown;
  hasPersistedSettings: boolean;
}): OnboardingStartDecision {
  if (isOnboardingSeen(options.seenVersion)) return 'skip';
  return options.hasPersistedSettings ? 'mark-seen' : 'show';
}

/** The marker is written as the tour version, so a future round can ask again. */
export function isOnboardingSeen(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 1;
  if (typeof value === 'string') return value.trim().length > 0;
  return false;
}

/* ============================================================
   Card placement
   ============================================================ */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SizeLike {
  width: number;
  height: number;
}

/** Breathing room between the highlighted rectangle and its target element. */
export const TOUR_HOLE_PADDING = 7;
/** Distance between the highlight and the explanation card. */
export const TOUR_CARD_GAP = 16;
/** Closest the card may come to the window edge. */
export const TOUR_VIEWPORT_EDGE = 14;
/** The card's designed width; narrow windows get less. */
export const TOUR_CARD_WIDTH = 300;
/**
 * How narrow the card may get before it is better to overlap the highlight.
 * A 620px modal in a 1249px window leaves 308px on each side: the 300px card
 * does not fit, but a 278px one does, and covering the modal's own buttons is
 * worse than losing 22px of text width.
 */
export const TOUR_CARD_MIN_WIDTH = 220;
/** Inset used when the card becomes a bottom sheet on a phone. */
export const TOUR_SHEET_INSET = 10;
/** Where the arrow/leader attaches, kept away from the card's rounded corners. */
const CONNECTOR_INSET = 18;

export interface TourLeader {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface TourPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly mode: OnboardingCardMode;
  /** Arrow centre, relative to the card's left edge (below/above modes). */
  readonly arrow?: number;
  /** 1px connector from the highlight to the card (left/right modes). */
  readonly leader?: TourLeader;
}

export interface TourPlacementInput {
  readonly target: RectLike;
  readonly viewport: SizeLike;
  readonly card: SizeLike;
  readonly preferred: OnboardingPlacement;
  /** Phones put the card in a bottom drawer instead of beside the target. */
  readonly sheet?: boolean;
}

/** The fallback order for each preference: stay beside the target if possible. */
const PLACEMENT_ORDER: Record<OnboardingPlacement, readonly OnboardingPlacement[]> = {
  right: ['right', 'below', 'left', 'above'],
  left: ['left', 'right', 'below', 'above'],
  below: ['below', 'above', 'right', 'left'],
  above: ['above', 'below', 'right', 'left'],
};

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function overlaps(a: RectLike, b: RectLike): boolean {
  return a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top;
}

/** The highlighted rectangle: the target with its padding. */
export function tourHoleRect(target: RectLike): RectLike {
  return {
    left: target.left - TOUR_HOLE_PADDING,
    top: target.top - TOUR_HOLE_PADDING,
    width: target.width + TOUR_HOLE_PADDING * 2,
    height: target.height + TOUR_HOLE_PADDING * 2,
  };
}

/**
 * Put the card beside the highlight, then below/above it, then anywhere that
 * fits. A placement is rejected when clamping to the window would push the card
 * back over the highlight, which is what makes a 300px sidebar in a 400px window
 * still readable.
 */
export function computeTourPlacement(input: TourPlacementInput): TourPlacement {
  const hole = tourHoleRect(input.target);
  const edge = TOUR_VIEWPORT_EDGE;
  const width = Math.max(0, Math.min(input.card.width, input.viewport.width - edge * 2));
  const height = Math.max(0, Math.min(input.card.height, input.viewport.height - edge * 2));
  const maxLeft = input.viewport.width - width - edge;
  const maxTop = input.viewport.height - height - edge;
  const centreX = input.target.left + input.target.width / 2;
  const centreY = input.target.top + input.target.height / 2;

  if (input.sheet) {
    const sheetLeft = TOUR_SHEET_INSET;
    const sheetWidth = Math.max(0, input.viewport.width - TOUR_SHEET_INSET * 2);
    const bottom = input.viewport.height - height - TOUR_SHEET_INSET;
    const top = overlaps(
      { left: sheetLeft, top: bottom, width: sheetWidth, height },
      hole,
    )
      ? TOUR_SHEET_INSET
      : bottom;
    return {
      left: sheetLeft,
      top: clamp(top, TOUR_SHEET_INSET, Math.max(TOUR_SHEET_INSET, input.viewport.height - height - TOUR_SHEET_INSET)),
      width: sheetWidth,
      mode: 'sheet',
    };
  }

  const attempt = (mode: OnboardingPlacement, cardWidth: number): TourPlacement | null => {
    const raw = rawPlacement(mode, {
      hole,
      width: cardWidth,
      height,
      centreX,
      centreY,
      gap: TOUR_CARD_GAP,
    });
    const candidateLeft = input.viewport.width - cardWidth - edge;
    const left = clamp(raw.left, edge, candidateLeft);
    const top = clamp(raw.top, edge, maxTop);
    const rect: RectLike = { left, top, width: cardWidth, height };
    if (overlaps(rect, hole)) return null;
    return decorate(mode, rect, hole, centreX, centreY);
  };

  // Prefer the designed width, side placement first.
  for (const mode of PLACEMENT_ORDER[input.preferred]) {
    const placement = attempt(mode, width);
    if (placement) return placement;
  }
  // Then let a side placement narrow itself into the margin it actually has.
  for (const mode of PLACEMENT_ORDER[input.preferred]) {
    if (mode !== 'left' && mode !== 'right') continue;
    const available = mode === 'left'
      ? hole.left - TOUR_CARD_GAP - edge
      : input.viewport.width - (hole.left + hole.width) - TOUR_CARD_GAP - edge;
    const narrowed = Math.min(width, Math.floor(available));
    if (narrowed < TOUR_CARD_MIN_WIDTH || narrowed >= width) continue;
    const placement = attempt(mode, narrowed);
    if (placement) return placement;
  }

  // Every side is blocked (a highlight that fills the window). Fall back to the
  // least-bad spot: the card fits the window and is merely over the highlight.
  const left = clamp(centreX - width / 2, edge, maxLeft);
  const top = clamp(hole.top + hole.height + TOUR_CARD_GAP, edge, maxTop);
  const rect: RectLike = { left, top, width, height };
  const mode: OnboardingPlacement = top <= hole.top ? 'above' : 'below';
  return decorate(mode, rect, hole, centreX, centreY);
}

function rawPlacement(
  mode: OnboardingPlacement,
  geometry: {
    hole: RectLike;
    width: number;
    height: number;
    centreX: number;
    centreY: number;
    gap: number;
  },
): { left: number; top: number } {
  const { hole, width, height, centreX, centreY, gap } = geometry;
  if (mode === 'right') {
    return { left: hole.left + hole.width + gap, top: centreY - height / 2 };
  }
  if (mode === 'left') {
    return { left: hole.left - gap - width, top: centreY - height / 2 };
  }
  if (mode === 'below') {
    return { left: centreX - width / 2, top: hole.top + hole.height + gap };
  }
  return { left: centreX - width / 2, top: hole.top - gap - height };
}

function decorate(
  mode: OnboardingPlacement,
  rect: RectLike,
  hole: RectLike,
  centreX: number,
  centreY: number,
): TourPlacement {
  const base = { left: rect.left, top: rect.top, width: rect.width, mode };
  if (mode === 'left' || mode === 'right') {
    const cardEdge = mode === 'left' ? rect.left + rect.width + 2 : rect.left - 2;
    const targetEdge = mode === 'left' ? hole.left - 2 : hole.left + hole.width + 2;
    const attachY = clamp(centreY, rect.top + CONNECTOR_INSET, rect.top + rect.height - CONNECTOR_INSET);
    return {
      ...base,
      leader: { x1: targetEdge, y1: centreY, x2: cardEdge, y2: attachY },
    };
  }
  const arrow = clamp(centreX - rect.left, CONNECTOR_INSET, Math.max(CONNECTOR_INSET, rect.width - CONNECTOR_INSET));
  return { ...base, arrow };
}

/** The four dim panels that leave the highlight open and swallow outside clicks. */
export interface TourBands {
  readonly top: RectLike;
  readonly bottom: RectLike;
  readonly left: RectLike;
  readonly right: RectLike;
}

export function computeTourBands(hole: RectLike, viewport: SizeLike): TourBands {
  const left = clamp(hole.left, 0, viewport.width);
  const top = clamp(hole.top, 0, viewport.height);
  const right = clamp(hole.left + hole.width, left, viewport.width);
  const bottom = clamp(hole.top + hole.height, top, viewport.height);
  return {
    top: { left: 0, top: 0, width: viewport.width, height: top },
    bottom: { left: 0, top: bottom, width: viewport.width, height: Math.max(0, viewport.height - bottom) },
    left: { left: 0, top, width: left, height: bottom - top },
    right: { left: right, top, width: Math.max(0, viewport.width - right), height: bottom - top },
  };
}

/** Which date the "a day" step points at: photo and +1 first, then any photo, then today. */
export function pickFeaturedDay(
  candidates: readonly { date: string; hasPhoto: boolean; multipleEntries: boolean }[],
  today: string,
): string {
  const photoAndMore = candidates.find((candidate) => candidate.hasPhoto && candidate.multipleEntries);
  if (photoAndMore) return photoAndMore.date;
  const photo = candidates.find((candidate) => candidate.hasPhoto);
  if (photo) return photo.date;
  return today;
}