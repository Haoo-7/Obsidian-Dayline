/**
 * The spotlight overlay for Dayline's onboarding tour.
 *
 * It is a `document.body` layer, not part of a view: the tour dims the whole
 * Obsidian window, including the right-hand timeline and the settings modal,
 * which is impossible from inside the calendar view (it would be clipped by the
 * sidebar and painted under the timeline panel).
 *
 * Two rules shape the structure:
 *
 * - The dim is four panels around the highlight, not a full-screen sheet. Panels
 *   swallow clicks; the empty hole in the middle does not, so the highlighted
 *   control stays clickable and everything outside it is inert.
 * - The card is a sibling of the panels, never their child, so the card cannot
 *   be dimmed by its own mask and clamping it to the window cannot clip the
 *   highlight.
 */

import {
  OnboardingStep,
  OnboardingTourState,
  RectLike,
  SizeLike,
  TOUR_CARD_WIDTH,
  TOUR_HOLE_PADDING,
  computeTourBands,
  computeTourPlacement,
  tourHoleRect,
} from './onboarding-tour';

/**
 * A step target, resolved fresh every time it is measured.
 *
 * A plain element reference is not enough: Obsidian rebuilds the calendar grid
 * on almost every workspace event, so the node captured while waiting for a step
 * is often detached by the time the card is painted. Re-querying keeps the
 * highlight on whatever is on screen now — and returning `null` is how a step
 * reports that its target left the window.
 */
export type OnboardingAnchor = () => RectLike | null;

export interface OnboardingTourHost {
  /** `t()` bound to the live settings. */
  localize(key: string, values?: Record<string, unknown>): string;
  /**
   * Open whatever the step points at and wait for it to mount. Returning `null`
   * means this step cannot be shown now; the tour skips it instead of failing.
   */
  prepareStep(step: OnboardingStep): Promise<OnboardingAnchor | null>;
  /** Close what a step opened. Called when leaving it in either direction. */
  teardownStep(step: OnboardingStep): void | Promise<void>;
  /** "写今天": open today's note and leave the caret in the body. */
  onFinish(): void;
  /** The tour ended; `outcome` says how. Called once. */
  onEnd(outcome: import('./onboarding-tour').OnboardingOutcome): void;
  /** Clean up host state (close a modal the tour opened) on destroy. */
  destroy?(): void;
}

export interface OnboardingTourOverlayOptions {
  host: OnboardingTourHost;
  steps: readonly OnboardingStep[];
  /** Phones get a bottom drawer instead of a card beside the target. */
  sheet?: boolean;
  doc?: Document;
  win?: Window;
}

/** Card height used before it is measurable (first paint, and in DOM tests). */
export const TOUR_CARD_DEFAULT_HEIGHT = 132;
/** How long the card fades out before its text changes. */
const CARD_FADE_MS = 70;
/** Target/geometry poll while a step is open; catches view rerenders and inner scroll. */
const GEOMETRY_POLL_MS = 400;

type Timer = number;

let overlayCount = 0;

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function position(el: HTMLElement, rect: RectLike): void {
  el.style.left = `${Math.round(rect.left)}px`;
  el.style.top = `${Math.round(rect.top)}px`;
  el.style.width = `${Math.round(rect.width)}px`;
  el.style.height = `${Math.round(rect.height)}px`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameRect(a: RectLike | null, b: RectLike | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 0.5
    && Math.abs(a.top - b.top) < 0.5
    && Math.abs(a.width - b.width) < 0.5
    && Math.abs(a.height - b.height) < 0.5;
}

/**
 * Resolve a selector once it exists. The timeline, the mood picker and the
 * settings pane all mount asynchronously; a tour step must wait for its target
 * instead of measuring nothing. Gives up after `timeoutMs` so one slow view can
 * never wedge the tour.
 */
export function waitForElement(
  doc: Document,
  selector: string,
  options: { timeoutMs?: number; root?: ParentNode; intervalMs?: number } = {},
): Promise<HTMLElement | null> {
  const root = options.root ?? doc;
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 40;
  const existing = root.querySelector(selector);
  if (existing instanceof HTMLElement) return Promise.resolve(existing);

  const win = doc.defaultView;
  return new Promise((resolve) => {
    let timer: number | null = null;
    let poll: number | null = null;
    let observer: MutationObserver | null = null;
    let settled = false;

    const finish = (value: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) win?.clearTimeout(timer);
      if (poll !== null) win?.clearInterval(poll);
      observer?.disconnect();
      resolve(value);
    };

    if (win) timer = win.setTimeout(() => finish(null), Math.max(0, timeoutMs));
    else timer = window.setTimeout(() => finish(null), Math.max(0, timeoutMs));

    const MutationObserverCtor = win?.MutationObserver;
    if (MutationObserverCtor) {
      observer = new MutationObserverCtor(() => {
        const found = root.querySelector(selector);
        if (found instanceof HTMLElement) finish(found);
      });
      try {
        observer.observe(root === doc ? doc.documentElement : root, { childList: true, subtree: true });
      } catch {
        observer = null;
      }
    }
    // A MutationObserver installed after the view already mounted (or a root
    // that refuses observation) must not wait out the whole timeout.
    if (!observer) {
      const sample = () => {
        const found = root.querySelector(selector);
        if (found instanceof HTMLElement) finish(found);
      };
      poll = win ? win.setInterval(sample, intervalMs) : window.setInterval(sample, intervalMs);
    }
  });
}

export class OnboardingTourOverlay {
  private readonly host: OnboardingTourHost;
  private readonly state: OnboardingTourState;
  private readonly sheet: boolean;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly reduceMotion: boolean;

  private root: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private dotsEl: HTMLElement | null = null;
  private backButton: HTMLButtonElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private arrowEl: HTMLElement | null = null;
  private leaderEl: SVGSVGElement | null = null;
  private leaderPath: SVGPathElement | null = null;
  private leaderDot: SVGCircleElement | null = null;
  private bands = new Map<'top' | 'bottom' | 'left' | 'right', HTMLElement>();
  private holeEl: HTMLElement | null = null;

  private renderedIndex = 0;
  private renderedStep: OnboardingStep | null = null;
  private currentAnchor: OnboardingAnchor | null = null;
  private currentTarget: RectLike | null = null;
  private busy = false;
  /** Set when a target vanished mid-step; honoured once the current move ends. */
  private advancePending = false;
  private started = false;
  private closed = false;
  private restoreFocus: HTMLElement | null = null;
  private timers = new Set<Timer>();
  private geometryTimer: number | null = null;
  private frame: number | null = null;

  constructor(options: OnboardingTourOverlayOptions) {
    this.host = options.host;
    this.state = new OnboardingTourState(options.steps);
    this.sheet = options.sheet === true;
    this.doc = options.doc ?? document;
    this.win = options.win ?? this.doc.defaultView ?? window;
    this.reduceMotion = Boolean(this.win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  }

  get active(): boolean {
    return this.started && !this.closed;
  }

  get index(): number {
    return this.renderedIndex;
  }

  get total(): number {
    return this.state.total;
  }

  /** Mount the overlay and show the first step that can be prepared. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.mount();
    void this.moveTo(1, 0);
  }

  next(): void {
    if (!this.active || this.busy) return;
    if (this.renderedIndex >= this.state.total - 1) {
      this.finish();
      return;
    }
    void this.moveTo(1, this.renderedIndex + 1);
  }

  back(): void {
    if (!this.active || this.busy || this.renderedIndex <= 0) return;
    void this.moveTo(-1, this.renderedIndex - 1);
  }

  skip(): void {
    if (!this.active) return;
    this.state.skip();
    this.end();
  }

  /** Remove the overlay without reporting an outcome change (used by unload). */
  destroy(): void {
    if (this.closed) return;
    this.state.abandon();
    this.end({ notify: false });
  }

  private finish(): void {
    if (!this.active) return;
    this.state.finish();
    this.end();
  }

  /* ----- Step flow ----- */

  /**
   * Walk toward the requested step until one of them can actually be shown.
   * A step whose view is missing (weather card disabled, timeline refused to
   * open) is skipped rather than throwing the whole tour away.
   */
  private async moveTo(direction: 1 | -1, from: number): Promise<void> {
    if (!this.active || this.busy) return;
    this.busy = true;
    try {
      const steps = this.state.steps;
      let index = from;
      while (index >= 0 && index < steps.length) {
        const candidate = steps[index];
        const anchor = await this.host.prepareStep(candidate);
        if (this.closed) return;
        if (anchor) {
          const leaving = this.renderedStep;
          if (leaving && leaving !== candidate) await this.host.teardownStep(leaving);
          if (this.closed) return;
          this.state.goTo(index);
          this.renderedIndex = index;
          this.renderedStep = candidate;
          this.currentAnchor = anchor;
          this.updateChrome(candidate);
          await this.delay(CARD_FADE_MS);
          if (this.closed) return;
          this.place();
          this.reveal();
          return;
        }
        await this.host.teardownStep(candidate);
        if (this.closed) return;
        index += direction;
      }
      // Nothing in this direction can be shown. Forward from a step the user
      // has seen means the tour reached its end; forward from a tour that never
      // rendered anything is a failed start and must stay unmarked, so it can
      // be offered again next launch. Backward leaves the current step alone.
      if (direction <= 0) {
        this.state.goTo(this.renderedIndex);
      } else if (this.renderedStep) {
        this.finish();
      } else {
        this.state.abandon();
        this.end();
      }
    } finally {
      this.busy = false;
    }
    this.flushPendingAdvance();
  }

  /**
   * A step whose target disappeared must move on, but the poll that noticed can
   * fire while another step is still opening. Remember the request and run it
   * once the overlay is free instead of dropping it.
   */
  private flushPendingAdvance(): void {
    if (!this.advancePending || !this.active || this.busy) return;
    this.advancePending = false;
    this.next();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.win.setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  /* ----- Chrome ----- */

  private mount(): void {
    const doc = this.doc;
    const root = createElement(doc, 'div', 'dayline-tour');
    root.setAttribute('data-dayline-tour', 'root');
    if (this.sheet) root.classList.add('is-sheet');
    if (this.reduceMotion) root.classList.add('is-reduced-motion');
    root.style.zIndex = String(2000 + ++overlayCount);

    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const band = createElement(doc, 'div', `dayline-tour-band is-${side}`);
      band.setAttribute('aria-hidden', 'true');
      // A click outside the highlight must not reach the app underneath.
      band.addEventListener('pointerdown', this.swallow, true);
      band.addEventListener('click', this.swallow, true);
      root.appendChild(band);
      this.bands.set(side, band);
    }

    const hole = createElement(doc, 'div', 'dayline-tour-hole');
    hole.setAttribute('aria-hidden', 'true');
    root.appendChild(hole);
    this.holeEl = hole;

    const svgNs = 'http://www.w3.org/2000/svg';
    const leader = doc.createElementNS(svgNs, 'svg');
    leader.setAttribute('class', 'dayline-tour-leader');
    leader.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(svgNs, 'path');
    const dot = doc.createElementNS(svgNs, 'circle');
    dot.setAttribute('r', '2.5');
    leader.appendChild(path);
    leader.appendChild(dot);
    root.appendChild(leader);
    this.leaderEl = leader;
    this.leaderPath = path;
    this.leaderDot = dot;

    const card = createElement(doc, 'div', 'dayline-tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'dayline-tour-title');
    card.setAttribute('data-dayline-tour', 'card');
    const arrow = createElement(doc, 'span', 'dayline-tour-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    card.appendChild(arrow);
    this.arrowEl = arrow;

    const top = createElement(doc, 'div', 'dayline-tour-top');
    const dots = createElement(doc, 'span', 'dayline-tour-dots');
    dots.setAttribute('aria-hidden', 'true');
    top.appendChild(dots);
    this.dotsEl = dots;
    const skip = createElement(doc, 'button', 'dayline-tour-skip', this.host.localize('onboardingSkip'));
    skip.type = 'button';
    skip.addEventListener('click', () => this.skip());
    top.appendChild(skip);
    card.appendChild(top);

    const title = createElement(doc, 'h2', 'dayline-tour-title');
    title.id = 'dayline-tour-title';
    card.appendChild(title);
    this.titleEl = title;

    const body = createElement(doc, 'p', 'dayline-tour-body');
    card.appendChild(body);
    this.bodyEl = body;

    const actions = createElement(doc, 'div', 'dayline-tour-actions');
    const back = createElement(doc, 'button', 'dayline-tour-back', this.host.localize('onboardingBack'));
    back.type = 'button';
    back.addEventListener('click', () => this.back());
    actions.appendChild(back);
    this.backButton = back;
    const next = createElement(doc, 'button', 'dayline-tour-next', this.host.localize('onboardingNext'));
    next.type = 'button';
    next.addEventListener('click', () => this.next());
    actions.appendChild(next);
    this.nextButton = next;
    card.appendChild(actions);

    root.appendChild(card);
    this.card = card;

    // Keyboard: Escape leaves, arrows/Enter move. The listener sits on the
    // document because the tour owns the window while it runs.
    doc.addEventListener('keydown', this.onKeyDown, true);
    this.win.addEventListener('resize', this.onGeometryChange);
    doc.addEventListener('scroll', this.onGeometryChange, true);

    this.restoreFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    doc.body.appendChild(root);
    this.root = root;

    this.geometryTimer = this.win.setInterval(() => this.syncGeometry(), GEOMETRY_POLL_MS);
  }

  private readonly swallow = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.skip();
      return;
    }
    if (event.key !== 'Enter' && event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    // Never steal arrows or Enter from a field the user is typing in — the
    // highlighted timeline search is a real input inside the hole.
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowLeft') this.back();
    else this.next();
  };

  private readonly onGeometryChange = (): void => {
    if (!this.active || this.frame !== null) return;
    if (typeof this.win.requestAnimationFrame !== 'function') {
      this.syncGeometry();
      return;
    }
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = null;
      this.syncGeometry();
    });
  };

  /** Re-measure and repaint; a target that left the window skips its step. */
  private syncGeometry(): void {
    if (!this.active || !this.currentAnchor) return;
    const target = this.measure(this.currentAnchor);
    if (!target) {
      // The view behind this step was rerendered or closed: skip forward rather
      // than explaining a target that is no longer on screen.
      this.currentAnchor = null;
      this.advancePending = true;
      this.flushPendingAdvance();
      return;
    }
    if (!this.busy && !sameRect(target, this.currentTarget)) this.place();
  }

  private measure(anchor: OnboardingAnchor): RectLike | null {
    let rect: RectLike | null = null;
    try {
      rect = anchor();
    } catch (error) {
      console.warn('[Dayline] Onboarding target could not be measured:', errorText(error));
      return null;
    }
    if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;
    // Clip to the window: the timeline list is thousands of pixels tall, and a
    // highlight that runs past the edge would leave the dim panels with nothing
    // to paint.
    const viewport = this.viewport();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(viewport.width, rect.left + rect.width);
    const bottom = Math.min(viewport.height, rect.top + rect.height);
    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
  }

  private viewport(): SizeLike {
    const view = this.win as Window & { visualViewport?: { width: number; height: number } };
    const width = view.visualViewport?.width || this.win.innerWidth || this.doc.documentElement?.clientWidth || 0;
    const height = view.visualViewport?.height || this.win.innerHeight || this.doc.documentElement?.clientHeight || 0;
    return { width, height };
  }

  private place(): void {
    if (!this.card || !this.holeEl) return;
    const target = this.currentAnchor ? this.measure(this.currentAnchor) : null;
    if (!target) return;
    this.currentTarget = target;

    const viewport = this.viewport();
    const cardHeight = this.card.offsetHeight || this.card.getBoundingClientRect?.().height || TOUR_CARD_DEFAULT_HEIGHT;
    const placement = computeTourPlacement({
      target,
      viewport,
      card: { width: TOUR_CARD_WIDTH, height: cardHeight },
      preferred: this.renderedStep?.placement ?? 'right',
      sheet: this.sheet,
    });
    const hole = tourHoleRect(target);
    const bands = computeTourBands(hole, viewport);
    for (const [side, band] of this.bands) position(band, bands[side]);
    position(this.holeEl, hole);

    this.card.style.width = `${Math.round(placement.width)}px`;
    this.card.classList.toggle('is-sheet', placement.mode === 'sheet');
    this.card.style.left = `${Math.round(placement.left)}px`;
    this.card.style.top = `${Math.round(placement.top)}px`;

    const arrow = this.arrowEl;
    if (arrow) {
      const showArrow = placement.mode === 'below' || placement.mode === 'above';
      arrow.style.display = showArrow ? 'block' : 'none';
      if (showArrow && placement.arrow !== undefined) {
        arrow.style.left = `${Math.round(placement.arrow) - 5}px`;
        arrow.classList.toggle('is-above', placement.mode === 'above');
      }
    }

    const leader = this.leaderEl;
    if (leader && this.leaderPath && this.leaderDot) {
      const show = Boolean(placement.leader);
      leader.style.display = show ? 'block' : 'none';
      if (placement.leader) {
        const { x1, y1, x2, y2 } = placement.leader;
        this.leaderPath.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
        this.leaderDot.setAttribute('cx', String(x1));
        this.leaderDot.setAttribute('cy', String(y1));
      }
    }
  }

  private updateChrome(step: OnboardingStep): void {
    const card = this.card;
    if (!card) return;
    card.classList.remove('is-visible');
    if (this.titleEl) this.titleEl.textContent = this.host.localize(step.titleKey);
    if (this.bodyEl) this.bodyEl.textContent = this.host.localize(step.bodyKey);
    if (this.dotsEl) {
      this.dotsEl.replaceChildren();
      for (let index = 0; index < this.state.total; index += 1) {
        const dot = this.doc.createElement('i');
        if (index === this.renderedIndex) dot.className = 'is-current';
        if (index < this.renderedIndex) dot.className = dot.className ? `${dot.className} is-past` : 'is-past';
        this.dotsEl.appendChild(dot);
      }
    }
    if (this.backButton) this.backButton.hidden = this.renderedIndex === 0;
    if (this.nextButton) {
      this.nextButton.textContent = this.host.localize(
        this.renderedIndex >= this.state.total - 1 ? 'onboardingFinish' : 'onboardingNext',
      );
    }
  }

  private reveal(): void {
    const card = this.card;
    const next = this.nextButton;
    card?.classList.add('is-visible');
    const focus = () => next?.focus({ preventScroll: true });
    if (typeof this.win.requestAnimationFrame === 'function') this.win.requestAnimationFrame(focus);
    else focus();
  }

  private end(options: { notify?: boolean } = {}): void {
    const outcome = this.state.result ?? 'abandoned';
    const leaving = this.renderedStep;
    this.renderedStep = null;
    this.currentAnchor = null;
    this.close();
    try {
      if (leaving) void Promise.resolve(this.host.teardownStep(leaving)).catch(() => undefined);
    } catch {
      // A closing view that throws must not keep the tour on screen.
    }
    if (options.notify === false) {
      this.host.destroy?.();
      return;
    }
    try {
      this.host.destroy?.();
    } catch {
      // ignore
    }
    if (outcome === 'finished') {
      try {
        this.host.onFinish();
      } catch (error) {
        console.warn('[Dayline] Could not open today\'s note after the tour:', errorText(error));
      }
    }
    try {
      this.host.onEnd(outcome);
    } catch (error) {
      console.warn('[Dayline] Onboarding tour teardown failed:', errorText(error));
    }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.advancePending = false;
    for (const timer of this.timers) this.win.clearTimeout(timer);
    this.timers.clear();
    if (this.geometryTimer !== null) {
      this.win.clearInterval(this.geometryTimer);
      this.geometryTimer = null;
    }
    if (this.frame !== null) {
      this.win.cancelAnimationFrame?.(this.frame);
      this.frame = null;
    }
    this.doc.removeEventListener('keydown', this.onKeyDown, true);
    this.win.removeEventListener('resize', this.onGeometryChange);
    this.doc.removeEventListener('scroll', this.onGeometryChange, true);
    this.root?.remove();
    this.root = null;
    this.card = null;
    this.titleEl = null;
    this.bodyEl = null;
    this.dotsEl = null;
    this.backButton = null;
    this.nextButton = null;
    this.arrowEl = null;
    this.leaderEl = null;
    this.leaderPath = null;
    this.leaderDot = null;
    this.holeEl = null;
    this.bands.clear();
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore?.isConnected) {
      try {
        restore.focus({ preventScroll: true });
      } catch {
        // Focus restoration is a courtesy, never a requirement.
      }
    }
  }
}

/** Highlight padding, re-exported so the plugin can describe the hole in tests. */
export { TOUR_HOLE_PADDING };