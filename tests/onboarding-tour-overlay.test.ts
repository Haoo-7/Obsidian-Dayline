// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { buildOnboardingSteps, TOUR_HOLE_PADDING } from '../src/onboarding-tour';
import {
  OnboardingAnchor,
  OnboardingTourHost,
  OnboardingTourOverlay,
  waitForElement,
} from '../src/onboarding-tour-overlay';

const TARGET = { left: 20, top: 40, width: 200, height: 300 };

function rectOf(rect: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  } as DOMRect;
}

function targetElement(rect = TARGET): HTMLElement {
  const element = document.createElement('div');
  element.className = 'fake-target';
  element.getBoundingClientRect = () => rectOf(rect);
  document.body.appendChild(element);
  return element;
}

function steps() {
  return buildOnboardingSteps({ surface: 'desktop', hasEntries: true, weatherVisible: true });
}

interface Recorder {
  host: OnboardingTourHost;
  prepared: string[];
  tornDown: string[];
  endings: string[];
  finishes: number;
}

function makeHost(overrides: Partial<OnboardingTourHost> = {}): Recorder {
  const prepared: string[] = [];
  const tornDown: string[] = [];
  const endings: string[] = [];
  let finishes = 0;
  const host: OnboardingTourHost = {
    localize: (key) => key,
    prepareStep: async (step): Promise<OnboardingAnchor | null> => {
      prepared.push(step.id);
      return () => TARGET;
    },
    teardownStep: (step) => {
      tornDown.push(step.id);
    },
    onFinish: () => {
      finishes += 1;
    },
    onEnd: (outcome) => {
      endings.push(outcome);
    },
    ...overrides,
  };
  return {
    host,
    prepared,
    tornDown,
    endings,
    get finishes() {
      return finishes;
    },
  };
}

const settle = (ms = 130) => new Promise((resolve) => setTimeout(resolve, ms));
const card = () => document.querySelector('.dayline-tour-card') as HTMLElement | null;
const root = () => document.querySelector('.dayline-tour') as HTMLElement | null;
const currentDot = () => document.querySelector('.dayline-tour-dots .is-current');

afterEach(() => {
  document.body.replaceChildren();
});

describe('onboarding overlay mounting', () => {
  it('mounts one document-level layer with the hole, the dim panels and the card', async () => {
    const recorder = makeHost();
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    const layer = root();
    expect(layer).not.toBeNull();
    expect(layer?.parentElement).toBe(document.body);
    expect(layer?.querySelectorAll('.dayline-tour-band')).toHaveLength(4);

    const hole = layer?.querySelector('.dayline-tour-hole') as HTMLElement;
    expect(hole.style.left).toBe(`${TARGET.left - TOUR_HOLE_PADDING}px`);
    expect(hole.style.top).toBe(`${TARGET.top - TOUR_HOLE_PADDING}px`);
    expect(hole.style.width).toBe(`${TARGET.width + TOUR_HOLE_PADDING * 2}px`);
    expect(hole.style.height).toBe(`${TARGET.height + TOUR_HOLE_PADDING * 2}px`);

    // The card sits in the dim area to the right, not over the highlight.
    const panel = card() as HTMLElement;
    expect(panel.style.left).toBe('243px');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepCalendarTitle');
    expect(document.querySelector('.dayline-tour-body')?.textContent).toBe('onboardingStepCalendarBody');
    expect(document.querySelectorAll('.dayline-tour-dots i')).toHaveLength(9);
    expect(currentDot()).not.toBeNull();
    expect(document.querySelector('.dayline-tour-next')?.textContent).toBe('onboardingNext');
    expect(document.querySelector('.dayline-tour-back')?.hasAttribute('hidden')).toBe(true);

    overlay.destroy();
  });

  it('describes an empty library and a missing weather card with their own copy', async () => {
    const recorder = makeHost();
    const empty = new OnboardingTourOverlay({
      host: recorder.host,
      steps: buildOnboardingSteps({ surface: 'desktop', hasEntries: false, weatherVisible: false }),
    });
    empty.start();
    await settle();
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepFolderTitle');
    empty.destroy();
  });
});

describe('onboarding overlay geometry limits', () => {
  it('keeps a highlight inside the window when the target is larger than it', async () => {
    const recorder = makeHost({
      prepareStep: async () => () => ({ left: -40, top: -30, width: 5000, height: 5000 }),
    });
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    // The highlight may hang its 7px padding past the edge; it must not be
    // thousands of pixels tall the way the raw target rect is.
    const hole = document.querySelector('.dayline-tour-hole') as HTMLElement;
    const left = Number.parseFloat(hole.style.left);
    const top = Number.parseFloat(hole.style.top);
    const width = Number.parseFloat(hole.style.width);
    const height = Number.parseFloat(hole.style.height);
    expect(left).toBeGreaterThanOrEqual(-TOUR_HOLE_PADDING);
    expect(top).toBeGreaterThanOrEqual(-TOUR_HOLE_PADDING);
    expect(left + width).toBeLessThanOrEqual(window.innerWidth + TOUR_HOLE_PADDING);
    expect(top + height).toBeLessThanOrEqual(window.innerHeight + TOUR_HOLE_PADDING);
    overlay.destroy();
  });
});

describe('onboarding overlay stepping', () => {
  it('moves forward, back, and labels the last step', async () => {
    const recorder = makeHost();
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    const next = document.querySelector('.dayline-tour-next') as HTMLButtonElement;
    next.click();
    await settle();
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepDayTitle');
    expect(document.querySelector('.dayline-tour-back')?.hasAttribute('hidden')).toBe(false);
    expect(recorder.tornDown).toContain('calendar');

    const back = document.querySelector('.dayline-tour-back') as HTMLButtonElement;
    back.click();
    await settle();
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepCalendarTitle');

    // Walk to the end; the primary button becomes "写今天".
    for (let step = 1; step < steps().length; step += 1) {
      (document.querySelector('.dayline-tour-next') as HTMLButtonElement).click();
      await settle();
    }
    expect(document.querySelector('.dayline-tour-next')?.textContent).toBe('onboardingFinish');
    expect(document.querySelectorAll('.dayline-tour-dots .is-current')[0]).toBe(
      document.querySelectorAll('.dayline-tour-dots i')[8],
    );

    (document.querySelector('.dayline-tour-next') as HTMLButtonElement).click();
    await settle();
    expect(root()).toBeNull();
    expect(recorder.finishes).toBe(1);
    expect(recorder.endings).toEqual(['finished']);
  });

  it('skips a step whose target cannot be shown', async () => {
    const recorder = makeHost({
      prepareStep: async (step) => (step.id === 'day' ? null : () => TARGET),
    });
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    (document.querySelector('.dayline-tour-next') as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepMoodTitle');
    expect(recorder.tornDown).toContain('day');
  });

  it('treats an unshowable first step as a failed start, not a finish', async () => {
    const recorder = makeHost({ prepareStep: async () => null });
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    expect(root()).toBeNull();
    expect(recorder.finishes).toBe(0);
    expect(recorder.endings).toEqual(['abandoned']);
  });

  it('keeps the current step when nothing behind it can be shown', async () => {
    let allowCalendar = true;
    const recorder = makeHost({
      prepareStep: async (step) => {
        if (step.id === 'calendar' && !allowCalendar) return null;
        return () => TARGET;
      },
    });
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();
    (document.querySelector('.dayline-tour-next') as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepDayTitle');

    allowCalendar = false;
    (document.querySelector('.dayline-tour-back') as HTMLButtonElement).click();
    await settle();
    // Every earlier step failed, so the card stays on the day step rather than
    // disappearing.
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepDayTitle');
    expect(root()).not.toBeNull();
    overlay.destroy();
  });
});

describe('onboarding overlay dismissal', () => {
  it('skips on the Skip button and reports it once', async () => {
    const recorder = makeHost();
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    (document.querySelector('.dayline-tour-skip') as HTMLButtonElement).click();
    await settle();
    expect(root()).toBeNull();
    expect(recorder.endings).toEqual(['skipped']);
    expect(recorder.finishes).toBe(0);
    expect(recorder.tornDown).toContain('calendar');
  });

  it('skips on Escape and ignores arrow keys from a field inside the highlight', async () => {
    const recorder = makeHost();
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepCalendarTitle');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(root()).toBeNull();
    expect(recorder.endings).toEqual(['skipped']);
  });

  it('advances on the right arrow when focus is not in a field', async () => {
    const recorder = makeHost();
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    document.querySelector('.dayline-tour-title')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await settle();
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepDayTitle');
    overlay.destroy();
  });

  it('stops listening after destroy, so a late key cannot end a closed tour', async () => {
    const recorder = makeHost();
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();
    overlay.destroy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(recorder.endings).toHaveLength(0);
  });
});

describe('onboarding overlay input isolation', () => {
  it('swallows clicks on the dim panels so the app cannot be reached outside the hole', async () => {
    const recorder = makeHost();
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();

    let reached = 0;
    const listener = () => {
      reached += 1;
    };
    document.body.addEventListener('click', listener);
    const band = document.querySelector('.dayline-tour-band') as HTMLElement;
    band.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.body.removeEventListener('click', listener);

    expect(reached).toBe(0);
    overlay.destroy();
  });

  it('follows a target that disappears instead of pointing at nothing', async () => {
    const element = targetElement();
    const replacement = targetElement({ left: 300, top: 200, width: 120, height: 120 });
    const recorder = makeHost({
      prepareStep: async (step) => (step.id === 'calendar'
        // The resolver re-queries the node, so a removed target answers null.
        ? () => (element.isConnected ? element.getBoundingClientRect() : null)
        : () => replacement.getBoundingClientRect()),
    });
    const overlay = new OnboardingTourOverlay({ host: recorder.host, steps: steps() });
    overlay.start();
    await settle();
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepCalendarTitle');

    element.remove();
    window.dispatchEvent(new Event('resize'));
    await settle(200);
    expect(document.querySelector('.dayline-tour-title')?.textContent).toBe('onboardingStepDayTitle');
    overlay.destroy();
  });
});

describe('waitForElement', () => {
  it('resolves as soon as the element mounts', async () => {
    const pending = waitForElement(document, '.late-target', { timeoutMs: 500 });
    setTimeout(() => {
      const late = document.createElement('div');
      late.className = 'late-target';
      document.body.appendChild(late);
    }, 20);
    const found = await pending;
    expect(found).toBeInstanceOf(HTMLElement);
  });

  it('returns null instead of hanging when the element never appears', async () => {
    const started = Date.now();
    const found = await waitForElement(document, '.never-target', { timeoutMs: 60 });
    expect(found).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('finds an element that is already there', async () => {
    targetElement();
    const found = await waitForElement(document, '.fake-target', { timeoutMs: 50 });
    expect(found).not.toBeNull();
  });
});