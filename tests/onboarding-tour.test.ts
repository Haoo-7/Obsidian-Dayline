import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_TOUR_VERSION,
  OnboardingTourState,
  TOUR_CARD_GAP,
  TOUR_CARD_MIN_WIDTH,
  TOUR_CARD_WIDTH,
  TOUR_HOLE_PADDING,
  TOUR_VIEWPORT_EDGE,
  buildOnboardingSteps,
  computeTourBands,
  computeTourPlacement,
  isOnboardingSeen,
  pickFeaturedDay,
  resolveOnboardingStart,
  tourHoleRect,
} from '../src/onboarding-tour';

const desktopSteps = () => buildOnboardingSteps({ surface: 'desktop', hasEntries: true, weatherVisible: true });

describe('onboarding step sequence', () => {
  it('walks the nine desktop stops in the documented order', () => {
    const ids = desktopSteps().map((step) => step.id);
    expect(ids).toEqual([
      'calendar',
      'day',
      'mood',
      'weather',
      'timeline-entry',
      'timeline-list',
      'timeline-search',
      'settings',
      'today',
    ]);
  });

  it('points every desktop stop at a card side that exists', () => {
    for (const step of desktopSteps()) {
      expect(['right', 'left', 'below', 'above']).toContain(step.placement);
      expect(step.titleKey).toMatch(/^onboarding/);
      expect(step.bodyKey).toMatch(/^onboarding/);
    }
  });

  it('drops the ribbon, the search and the settings pane on a phone', () => {
    const ids = buildOnboardingSteps({ surface: 'mobile', hasEntries: true, weatherVisible: true }).map((step) => step.id);
    expect(ids).toEqual(['calendar', 'day', 'mood', 'timeline-list', 'today']);
  });

  it('uses the two-step version for an empty library', () => {
    const ids = buildOnboardingSteps({ surface: 'desktop', hasEntries: false, weatherVisible: false }).map((step) => step.id);
    expect(ids).toEqual(['calendar', 'today']);
  });

  it('tells the empty-library calendar step about the folder instead of photos', () => {
    const [first] = buildOnboardingSteps({ surface: 'desktop', hasEntries: false, weatherVisible: false });
    expect(first.titleKey).toBe('onboardingStepFolderTitle');
    expect(first.bodyKey).toBe('onboardingStepFolderBody');
  });

  it('swaps the weather copy when the card is not on screen', () => {
    const on = desktopSteps().find((step) => step.id === 'weather');
    const off = buildOnboardingSteps({ surface: 'desktop', hasEntries: true, weatherVisible: false })
      .find((step) => step.id === 'weather');
    expect(on?.titleKey).toBe('onboardingStepWeatherTitle');
    expect(off?.titleKey).toBe('onboardingStepWeatherOffTitle');
    expect(off?.bodyKey).toBe('onboardingStepWeatherOffBody');
  });

  it('keeps the weather stop out of the empty-library version, which has no day data', () => {
    const ids = buildOnboardingSteps({ surface: 'desktop', hasEntries: false, weatherVisible: true }).map((step) => step.id);
    expect(ids).not.toContain('weather');
  });
});

describe('onboarding state machine', () => {
  it('starts on the first step with no way back', () => {
    const state = new OnboardingTourState(desktopSteps());
    expect(state.index).toBe(0);
    expect(state.total).toBe(9);
    expect(state.isFirst).toBe(true);
    expect(state.isLast).toBe(false);
    expect(state.step.id).toBe('calendar');
    expect(state.back()).toBe(false);
    expect(state.index).toBe(0);
    expect(state.done).toBe(false);
  });

  it('advances with next and returns with back', () => {
    const state = new OnboardingTourState(desktopSteps());
    expect(state.next()).toBe(true);
    expect(state.index).toBe(1);
    expect(state.step.id).toBe('day');
    expect(state.next()).toBe(true);
    expect(state.index).toBe(2);
    expect(state.back()).toBe(true);
    expect(state.index).toBe(1);
    expect(state.back()).toBe(true);
    expect(state.index).toBe(0);
    expect(state.back()).toBe(false);
  });

  it('finishes when next runs off the last step', () => {
    const state = new OnboardingTourState(desktopSteps());
    while (state.next()) {
      // walk to the end
    }
    expect(state.index).toBe(8);
    expect(state.isLast).toBe(true);
    expect(state.result).toBe('finished');
    expect(state.done).toBe(true);
    expect(state.next()).toBe(false);
    expect(state.back()).toBe(false);
  });

  it('records skip and finish as the two user endings', () => {
    const skipped = new OnboardingTourState(desktopSteps());
    expect(skipped.skip()).toBe(true);
    expect(skipped.result).toBe('skipped');
    expect(skipped.done).toBe(true);
    expect(skipped.skip()).toBe(false);

    const finished = new OnboardingTourState(desktopSteps());
    expect(finished.finish()).toBe(true);
    expect(finished.result).toBe('finished');
    expect(finished.next()).toBe(false);
  });

  it('reports the last-step label through isLast, and keeps goTo bounded', () => {
    const state = new OnboardingTourState(desktopSteps());
    expect(state.goTo(8)).toBe(true);
    expect(state.isLast).toBe(true);
    expect(state.goTo(9)).toBe(false);
    expect(state.goTo(-1)).toBe(false);
    expect(state.goTo(1.5)).toBe(false);
    expect(state.index).toBe(8);
  });

  it('abandons without pretending the user finished', () => {
    const state = new OnboardingTourState(desktopSteps());
    expect(state.abandon()).toBe(true);
    expect(state.result).toBe('abandoned');
  });

  it('refuses an empty sequence', () => {
    expect(() => new OnboardingTourState([])).toThrow();
  });
});

describe('onboarding first-launch decision', () => {
  it('shows the tour only for a brand-new install', () => {
    expect(resolveOnboardingStart({ hasPersistedSettings: false })).toBe('show');
    expect(resolveOnboardingStart({ seenVersion: undefined, hasPersistedSettings: false })).toBe('show');
  });

  it('marks an upgrade seen without interrupting it', () => {
    expect(resolveOnboardingStart({ hasPersistedSettings: true })).toBe('mark-seen');
    expect(resolveOnboardingStart({ seenVersion: 0, hasPersistedSettings: true })).toBe('mark-seen');
  });

  it('never shows itself twice', () => {
    expect(resolveOnboardingStart({ seenVersion: ONBOARDING_TOUR_VERSION, hasPersistedSettings: false })).toBe('skip');
    expect(resolveOnboardingStart({ seenVersion: '1', hasPersistedSettings: false })).toBe('skip');
  });

  it('accepts a numeric or string marker and rejects junk', () => {
    expect(isOnboardingSeen(1)).toBe(true);
    expect(isOnboardingSeen(2)).toBe(true);
    expect(isOnboardingSeen('1')).toBe(true);
    expect(isOnboardingSeen('2.11.0')).toBe(true);
    expect(isOnboardingSeen(0)).toBe(false);
    expect(isOnboardingSeen(-1)).toBe(false);
    expect(isOnboardingSeen('')).toBe(false);
    expect(isOnboardingSeen('   ')).toBe(false);
    expect(isOnboardingSeen(null)).toBe(false);
    expect(isOnboardingSeen(undefined)).toBe(false);
    expect(isOnboardingSeen({})).toBe(false);
  });
});

describe('onboarding card placement', () => {
  const viewport = { width: 1420, height: 860 };
  const card = { width: TOUR_CARD_WIDTH, height: 150 };
  const inside = (rect: { left: number; top: number; width: number; height: number }) => (
    rect.left >= TOUR_VIEWPORT_EDGE - 0.001
    && rect.top >= TOUR_VIEWPORT_EDGE - 0.001
    && rect.left + rect.width <= viewport.width - TOUR_VIEWPORT_EDGE + 0.001
    && rect.top + rect.height <= viewport.height - TOUR_VIEWPORT_EDGE + 0.001
  );
  const overlap = (a: { left: number; top: number; width: number; height: number }, b: typeof a) => (
    a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top
  );

  it('pads the highlight by 7px around the target', () => {
    expect(tourHoleRect({ left: 20, top: 40, width: 200, height: 100 })).toEqual({
      left: 13,
      top: 33,
      width: 214,
      height: 114,
    });
    expect(TOUR_HOLE_PADDING).toBe(7);
  });

  it('puts the card to the right of a sidebar target', () => {
    const target = { left: 40, top: 120, width: 300, height: 400 };
    const placement = computeTourPlacement({ target, viewport, card, preferred: 'right' });
    expect(placement.mode).toBe('right');
    expect(placement.left).toBe(40 + 300 + TOUR_HOLE_PADDING + TOUR_CARD_GAP);
    expect(placement.leader).toBeDefined();
    expect(inside({ left: placement.left, top: placement.top, width: placement.width, height: card.height })).toBe(true);
  });

  it('puts the card left of a right-hand target and connects it with a line', () => {
    const target = { left: 1040, top: 80, width: 360, height: 700 };
    const placement = computeTourPlacement({ target, viewport, card, preferred: 'left' });
    expect(placement.mode).toBe('left');
    expect(placement.left + placement.width).toBe(1040 - TOUR_HOLE_PADDING - TOUR_CARD_GAP);
    // The card is left of the target, so the connector runs right-to-left.
    expect(placement.leader?.x1).toBeGreaterThan(placement.leader?.x2 as number);
    expect(placement.leader?.x1).toBe(1040 - TOUR_HOLE_PADDING - 2);
  });

  it('attaches an arrow pointing at a small target below it', () => {
    const target = { left: 340, top: 300, width: 60, height: 60 };
    const placement = computeTourPlacement({ target, viewport, card, preferred: 'below' });
    expect(placement.mode).toBe('below');
    expect(placement.top).toBe(300 + 60 + TOUR_HOLE_PADDING + TOUR_CARD_GAP);
    expect(placement.arrow).toBeGreaterThan(0);
    expect(placement.arrow).toBeLessThan(placement.width);
  });

  it('never covers the highlight, for every target on a grid of positions and sizes', () => {
    const sizes = [24, 60, 180, 420, 900];
    let checked = 0;
    for (const width of sizes) {
      for (const height of sizes) {
        for (let left = 0; left <= viewport.width - width; left += 97) {
          for (let top = 0; top <= viewport.height - height; top += 83) {
            const target = { left, top, width, height };
            for (const preferred of ['right', 'left', 'below', 'above'] as const) {
              const placement = computeTourPlacement({ target, viewport, card, preferred });
              const placed = { left: placement.left, top: placement.top, width: placement.width, height: card.height };
              expect(inside(placed), `${preferred} ${width}x${height} at ${left},${top}`).toBe(true);
              // A highlight that fills the window cannot be avoided; every other
              // case must leave it uncovered.
              const hole = tourHoleRect(target);
              if (hole.width < viewport.width - 2 * TOUR_VIEWPORT_EDGE || hole.height < viewport.height - 2 * TOUR_VIEWPORT_EDGE) {
                expect(overlap(placed, hole), `${preferred} ${width}x${height} at ${left},${top}`).toBe(false);
              }
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('narrows the card into the margin instead of covering a large modal', () => {
    // The mood picker is 620x612 in a 1249x923 window: 308px of margin each side
    // is too little for the designed 300px card plus a gap and an edge.
    const wide = { width: 1249, height: 923 };
    const modal = { left: 315, top: 156, width: 620, height: 612 };
    const placement = computeTourPlacement({ target: modal, viewport: wide, card, preferred: 'left' });
    expect(placement.mode).toBe('left');
    expect(placement.width).toBeLessThan(TOUR_CARD_WIDTH);
    expect(placement.width).toBeGreaterThanOrEqual(TOUR_CARD_MIN_WIDTH);
    expect(overlap(
      { left: placement.left, top: placement.top, width: placement.width, height: card.height },
      tourHoleRect(modal),
    )).toBe(false);
  });

  it('keeps the designed width when the side has room', () => {
    const placement = computeTourPlacement({
      target: { left: 40, top: 120, width: 300, height: 400 },
      viewport,
      card,
      preferred: 'right',
    });
    expect(placement.width).toBe(TOUR_CARD_WIDTH);
  });

  it('falls back to the other side when the preferred one does not fit', () => {
    const narrow = { width: 420, height: 720 };
    const target = { left: 20, top: 200, width: 300, height: 200 };
    const placement = computeTourPlacement({ target, viewport: narrow, card: { width: 300, height: 150 }, preferred: 'right' });
    expect(placement.mode).not.toBe('right');
    expect(placement.left).toBeGreaterThanOrEqual(TOUR_VIEWPORT_EDGE);
    expect(placement.left + placement.width).toBeLessThanOrEqual(narrow.width - TOUR_VIEWPORT_EDGE);
    expect(overlap({ left: placement.left, top: placement.top, width: placement.width, height: 150 }, tourHoleRect(target))).toBe(false);
  });

  it('turns the card into a bottom sheet on a phone and keeps it off the highlight', () => {
    const phone = { width: 390, height: 844 };
    const target = { left: 16, top: 120, width: 340, height: 300 };
    const placement = computeTourPlacement({
      target,
      viewport: phone,
      card: { width: TOUR_CARD_WIDTH, height: 150 },
      preferred: 'right',
      sheet: true,
    });
    expect(placement.mode).toBe('sheet');
    expect(placement.left).toBe(10);
    expect(placement.width).toBe(370);
    expect(overlap({ left: placement.left, top: placement.top, width: placement.width, height: 150 }, tourHoleRect(target))).toBe(false);
  });

  it('loosens the sheet width to the window, not the designed card width', () => {
    const phone = { width: 390, height: 844 };
    const placement = computeTourPlacement({
      target: { left: 10, top: 10, width: 40, height: 40 },
      viewport: phone,
      card: { width: TOUR_CARD_WIDTH, height: 150 },
      preferred: 'below',
      sheet: true,
    });
    expect(placement.width).toBe(phone.width - 20);
  });
});

describe('onboarding dim bands', () => {
  it('leaves exactly the highlight uncovered and nothing else', () => {
    const viewport = { width: 1000, height: 800 };
    const hole = { left: 100, top: 200, width: 300, height: 250 };
    const bands = computeTourBands(hole, viewport);
    expect(bands.top).toEqual({ left: 0, top: 0, width: 1000, height: 200 });
    expect(bands.bottom).toEqual({ left: 0, top: 450, width: 1000, height: 350 });
    expect(bands.left).toEqual({ left: 0, top: 200, width: 100, height: 250 });
    expect(bands.right).toEqual({ left: 400, top: 200, width: 600, height: 250 });
  });

  it('clamps a highlight that runs past the window edge', () => {
    const viewport = { width: 800, height: 600 };
    const bands = computeTourBands({ left: -20, top: -10, width: 900, height: 700 }, viewport);
    expect(bands.top.height).toBe(0);
    expect(bands.bottom.height).toBe(0);
    expect(bands.left.width).toBe(0);
    expect(bands.right.width).toBe(0);
  });

  it('works with a zero-size highlight', () => {
    const viewport = { width: 800, height: 600 };
    const bands = computeTourBands({ left: 100, top: 100, width: 0, height: 0 }, viewport);
    expect(bands.left.width).toBe(100);
    expect(bands.right.left).toBe(100);
    expect(bands.bottom.top).toBe(100);
  });
});

describe('onboarding featured day', () => {
  const today = '2026-10-29';

  it('prefers a day with a photo and more than one note', () => {
    const picked = pickFeaturedDay([
      { date: '2026-10-03', hasPhoto: true, multipleEntries: false },
      { date: '2026-10-25', hasPhoto: true, multipleEntries: true },
      { date: '2026-10-18', hasPhoto: true, multipleEntries: false },
    ], today);
    expect(picked).toBe('2026-10-25');
  });

  it('falls back to any photo, then to today', () => {
    expect(pickFeaturedDay([
      { date: '2026-10-03', hasPhoto: false, multipleEntries: true },
      { date: '2026-10-18', hasPhoto: true, multipleEntries: false },
    ], today)).toBe('2026-10-18');
    expect(pickFeaturedDay([
      { date: '2026-10-03', hasPhoto: false, multipleEntries: true },
    ], today)).toBe(today);
    expect(pickFeaturedDay([], today)).toBe(today);
  });
});