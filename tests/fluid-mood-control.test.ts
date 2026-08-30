// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FluidMoodControl,
  clampMoodValue,
  interpolateMoodColor,
  moodValueFromPosition,
  snapMoodScore,
} from '../src/fluid-mood-control';

function canvasContextStub(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
  } as unknown as CanvasRenderingContext2D;
}

function pointerEvent(type: string, clientX: number, pointerId = 7): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    pointerId: { value: pointerId },
  });
  return event;
}

function mockTrackRect(root: HTMLElement, left: number, width: number): void {
  const track = root.querySelector<HTMLElement>('.journal-fluid-track')!;
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left,
    right: left + width,
    top: 0,
    bottom: 34,
    width,
    height: 34,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
}

describe('fluid mood math', () => {
  it('maps horizontal positions into the continuous mood range', () => {
    expect(moodValueFromPosition(100, 100, 400)).toBe(-2);
    expect(moodValueFromPosition(300, 100, 400)).toBe(0);
    expect(moodValueFromPosition(500, 100, 400)).toBe(2);
    expect(moodValueFromPosition(800, 100, 400)).toBe(2);
    expect(moodValueFromPosition(300, 100, 0)).toBe(0);
  });

  it('clamps and snaps to the existing five stored scores', () => {
    expect(clampMoodValue(Number.NaN)).toBe(0);
    expect(snapMoodScore(-3)).toBe(-2);
    expect(snapMoodScore(-1.49)).toBe(-1);
    expect(snapMoodScore(0.5)).toBe(1);
    expect(snapMoodScore(4)).toBe(2);
  });

  it('interpolates a saturated cold-to-warm continuum between Dayline colors', () => {
    expect(interpolateMoodColor(-2)).toBe('#7652c7');
    expect(interpolateMoodColor(2)).toBe('#ee6a54');
    expect(interpolateMoodColor(-1.5)).toBe('#4f50c0');
    expect(interpolateMoodColor(-0.5)).toBe('#5191c1');
    expect(interpolateMoodColor(0.5)).toBe('#73c56a');
    expect(interpolateMoodColor(1.5)).toBe('#ef8e52');
  });
});

describe('FluidMoodControl interaction', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContextStub());
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('previews during drag and commits only the snapped release value', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const commits: number[] = [];
    const previews: Array<[number, string]> = [];
    const control = new FluidMoodControl(root, {
      initialScore: null,
      accessibleLabel: 'How did today feel?',
      emptyLabel: 'Choose a level',
      labelForScore: (score) => `Mood ${score}`,
      onPreview: (value, color) => previews.push([value, color]),
      onCommit: (score) => commits.push(score),
    });
    mockTrackRect(root, 120, 360);

    root.dispatchEvent(pointerEvent('pointerdown', 120));
    expect(root.getAttribute('aria-valuetext')).toBe('Mood -2');
    expect(root.classList.contains('is-empty')).toBe(false);
    root.dispatchEvent(pointerEvent('pointermove', 300));
    expect(root.getAttribute('aria-valuetext')).toBe('Mood 0');
    root.dispatchEvent(pointerEvent('pointermove', 480));
    expect(root.getAttribute('aria-valuetext')).toBe('Mood 2');
    root.dispatchEvent(pointerEvent('pointermove', 420));
    expect(root.getAttribute('aria-valuetext')).toBe('Mood 1');
    expect(commits).toEqual([]);
    root.dispatchEvent(pointerEvent('pointerup', 420));

    expect(commits).toEqual([1]);
    expect(root.getAttribute('aria-valuenow')).toBe('1');
    expect(root.getAttribute('aria-valuetext')).toBe('Mood 1');
    expect(previews.at(-1)?.[1]).toBe('#f0b34f');
    expect(root.getAttribute('aria-label')).toBe('How did today feel?');
    control.destroy();
  });

  it('restores the prior score when the pointer gesture is cancelled', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const onCommit = vi.fn();
    const control = new FluidMoodControl(root, {
      initialScore: -1,
      accessibleLabel: 'Mood scale',
      emptyLabel: 'Choose',
      labelForScore: (score) => `Mood ${score}`,
      onCommit,
    });
    mockTrackRect(root, 20, 400);

    root.dispatchEvent(pointerEvent('pointerdown', 400));
    root.dispatchEvent(pointerEvent('pointercancel', 400));

    expect(onCommit).not.toHaveBeenCalled();
    expect(root.getAttribute('aria-valuenow')).toBe('-1');
    expect(root.getAttribute('aria-valuetext')).toBe('Mood -1');
    control.destroy();
  });

  it('tolerates synthetic pointer events without native pointer capture', () => {
    const root = document.createElement('div');
    root.setPointerCapture = vi.fn(() => { throw new DOMException('No active pointer', 'NotFoundError'); });
    root.releasePointerCapture = vi.fn(() => { throw new DOMException('No active pointer', 'NotFoundError'); });
    document.body.append(root);
    const onCommit = vi.fn();
    const control = new FluidMoodControl(root, {
      initialScore: null,
      accessibleLabel: 'Mood scale',
      emptyLabel: 'Choose',
      labelForScore: (score) => `Mood ${score}`,
      onCommit,
    });
    mockTrackRect(root, 0, 400);

    expect(() => root.dispatchEvent(pointerEvent('pointerdown', 400))).not.toThrow();
    expect(() => root.dispatchEvent(pointerEvent('pointerup', 400))).not.toThrow();
    expect(onCommit).toHaveBeenCalledWith(2);
    control.destroy();
  });

  it('supports arrows, Home, End, and activation from the keyboard', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const onCommit = vi.fn();
    const onActivate = vi.fn();
    const control = new FluidMoodControl(root, {
      initialScore: null,
      accessibleLabel: 'Mood scale',
      emptyLabel: 'Choose',
      labelForScore: (score) => `Mood ${score}`,
      onCommit,
      onActivate,
    });

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onCommit.mock.calls.map(([score]) => score)).toEqual([1, -2, 2]);
    expect(onActivate).toHaveBeenCalledWith(2);
    control.destroy();
  });

  it('draws the canvas once per animation frame', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.mocked(matchMedia).mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const context = canvasContextStub();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    const root = document.createElement('div');
    document.body.append(root);
    const control = new FluidMoodControl(root, {
      initialScore: 0,
      accessibleLabel: 'Mood scale',
      emptyLabel: 'Choose',
      labelForScore: (score) => `Mood ${score}`,
      onCommit: vi.fn(),
    });
    const clearRect = vi.mocked(context.clearRect);
    const beforeFrame = clearRect.mock.calls.length;

    frameCallbacks.shift()?.(performance.now() + 16);

    expect(clearRect.mock.calls.length - beforeFrame).toBe(1);
    control.destroy();
  });
});
