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

function pointerEvent(type: string, clientX: number, pointerId = 7, clientY = 0, pointerType = 'mouse'): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    pointerId: { value: pointerId },
    clientY: { value: clientY },
    pointerType: { value: pointerType },
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

  function touchFixture(initialScore: -1 | null = -1) {
    const root = document.createElement('div');
    document.body.append(root);
    root.setPointerCapture = vi.fn();
    root.releasePointerCapture = vi.fn();
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    const control = new FluidMoodControl(root, {
      initialScore,
      accessibleLabel: 'Mood scale',
      emptyLabel: 'Choose',
      labelForScore: (score) => `Mood ${score}`,
      onCommit,
      onPreview,
    });
    mockTrackRect(root, 0, 400);
    onPreview.mockClear();
    const touch = (target: Element, type: string, x: number, y: number, id = 7) => {
      const event = pointerEvent(type, x, id, y, 'touch');
      target.dispatchEvent(event);
      return event;
    };
    return { root, control, onCommit, onPreview, touch };
  }

  it.each(['.journal-fluid-canvas', '.journal-fluid-track', '.journal-fluid-handle'])(
    'leaves vertical touch scrolling from %s unchanged and unprevented',
    (selector) => {
      const { root, control, onCommit, onPreview, touch } = touchFixture(null);
      const target = root.querySelector(selector)!;
      expect(touch(target, 'pointerdown', 380, 30).defaultPrevented).toBe(false);
      expect(root.setPointerCapture).not.toHaveBeenCalled();
      expect(root.classList.contains('is-dragging')).toBe(false);
      expect(touch(target, 'pointermove', 383, 34).defaultPrevented).toBe(false);
      expect(touch(target, 'pointermove', 385, 60).defaultPrevented).toBe(false);
      // Once vertical, later horizontal movement must not reactivate the slider.
      expect(touch(target, 'pointermove', 100, 65).defaultPrevented).toBe(false);
      expect(touch(target, 'pointerup', 100, 65).defaultPrevented).toBe(false);
      expect(onCommit).not.toHaveBeenCalled();
      expect(onPreview).not.toHaveBeenCalled();
      expect(root.getAttribute('aria-valuetext')).toBe('Choose');
      expect(root.classList.contains('is-empty')).toBe(true);
      expect(root.setPointerCapture).not.toHaveBeenCalled();
      control.destroy();
    },
  );

  it.each(['.journal-fluid-canvas', '.journal-fluid-readout', '.journal-fluid-endpoints'])(
    'does not change mood when tapping %s',
    (selector) => {
      const { root, control, onCommit, onPreview, touch } = touchFixture();
      const target = root.querySelector(selector)!;
      touch(target, 'pointerdown', 380, 30);
      expect(touch(target, 'pointerup', 382, 32).defaultPrevented).toBe(false);
      expect(onCommit).not.toHaveBeenCalled();
      expect(onPreview).not.toHaveBeenCalled();
      expect(root.getAttribute('aria-valuenow')).toBe('-1');
      control.destroy();
    },
  );

  it.each(['.journal-fluid-track', '.journal-fluid-handle'])(
    'commits an explicit %s touch tap only on release',
    (selector) => {
      const { root, control, onCommit, onPreview, touch } = touchFixture();
      const target = root.querySelector(selector)!;
      touch(target, 'pointerdown', 380, 30);
      expect(onPreview).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      expect(root.setPointerCapture).not.toHaveBeenCalled();
      touch(target, 'pointerup', 380, 30);
      expect(onCommit.mock.calls).toEqual([[2]]);
      expect(root.releasePointerCapture).toHaveBeenCalledWith(7);
      expect(root.classList.contains('is-dragging')).toBe(false);
      control.destroy();
    },
  );

  it('captures only horizontal touch intent and ignores other pointers', () => {
    const { root, control, onCommit, touch } = touchFixture();
    const canvas = root.querySelector('canvas')!;
    touch(canvas, 'pointerdown', 200, 30);
    touch(canvas, 'pointerdown', 400, 30, 8);
    touch(canvas, 'pointermove', 400, 30, 8);
    touch(canvas, 'pointercancel', 400, 30, 8);
    expect(root.setPointerCapture).not.toHaveBeenCalled();
    expect(touch(canvas, 'pointermove', 320, 34).defaultPrevented).toBe(true);
    expect(root.setPointerCapture).toHaveBeenCalledWith(7);
    expect(root.getAttribute('aria-valuenow')).toBe('1.2');
    touch(canvas, 'lostpointercapture', 320, 34);
    expect(root.classList.contains('is-dragging')).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
    touch(canvas, 'pointerup', 380, 34);
    expect(onCommit.mock.calls).toEqual([[2]]);
    expect(root.releasePointerCapture).toHaveBeenCalledWith(7);
    control.destroy();
  });

  it('cleans up pending and active touch gestures on pointercancel', () => {
    const { root, control, onCommit, onPreview, touch } = touchFixture();
    const track = root.querySelector('.journal-fluid-track')!;
    touch(track, 'pointerdown', 200, 30);
    touch(track, 'pointercancel', 200, 30);
    touch(track, 'pointerup', 200, 30);
    expect(onPreview).not.toHaveBeenCalled();
    touch(track, 'pointerdown', 200, 30);
    touch(track, 'pointermove', 380, 32);
    touch(root, 'pointercancel', 380, 32);
    touch(track, 'pointerup', 380, 32);
    expect(onCommit).not.toHaveBeenCalled();
    expect(root.getAttribute('aria-valuenow')).toBe('-1');
    expect(root.classList.contains('is-dragging')).toBe(false);
    touch(track, 'pointerdown', 380, 30);
    touch(track, 'pointerup', 380, 30);
    expect(onCommit.mock.calls).toEqual([[2]]);
    control.destroy();
  });

  it('keeps an active drag after the control loses pointer capture', () => {
    const { root, control, onCommit, touch } = touchFixture();
    const track = root.querySelector('.journal-fluid-track')!;
    touch(track, 'pointerdown', 200, 30);
    touch(track, 'pointermove', 40, 32);
    root.dispatchEvent(pointerEvent('lostpointercapture', 40, 7, 32, 'touch'));
    expect(root.classList.contains('is-dragging')).toBe(true);
    document.dispatchEvent(pointerEvent('pointermove', -30, 7, 32, 'touch'));
    document.dispatchEvent(pointerEvent('pointerup', -30, 7, 32, 'touch'));
    expect(onCommit.mock.calls).toEqual([[-2]]);
    expect(root.classList.contains('is-dragging')).toBe(false);
    control.destroy();
  });

  it('continues a leftmost drag after the pointer leaves the control', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const onCommit = vi.fn();
    const control = new FluidMoodControl(root, {
      initialScore: 0,
      accessibleLabel: 'Mood scale',
      emptyLabel: 'Choose',
      labelForScore: (score) => `Mood ${score}`,
      onCommit,
    });
    mockTrackRect(root, 80, 400);

    root.dispatchEvent(pointerEvent('pointerdown', 80));
    document.dispatchEvent(pointerEvent('pointermove', 40));
    document.dispatchEvent(pointerEvent('pointerup', 20));
    expect(onCommit.mock.calls).toEqual([[-2]]);
    expect(root.getAttribute('aria-valuenow')).toBe('-2');
    control.destroy();
  });

  it('starts a drag from the leftmost handle after capture is lost', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const onCommit = vi.fn();
    const control = new FluidMoodControl(root, {
      initialScore: -2,
      accessibleLabel: 'Mood scale',
      emptyLabel: 'Choose',
      labelForScore: (score) => `Mood ${score}`,
      onCommit,
    });
    mockTrackRect(root, 80, 400);

    root.dispatchEvent(pointerEvent('pointerdown', 66));
    root.dispatchEvent(pointerEvent('lostpointercapture', 66));
    document.dispatchEvent(pointerEvent('pointermove', 280));
    document.dispatchEvent(pointerEvent('pointerup', 280));
    expect(onCommit.mock.calls).toEqual([[0]]);
    expect(root.getAttribute('aria-valuenow')).toBe('0');
    control.destroy();
  });

  it('resolves a touch that leaves the control before horizontal intent is clear', () => {
    const { root, control, onCommit, touch } = touchFixture(-1);
    const handle = root.querySelector('.journal-fluid-handle')!;
    touch(handle, 'pointerdown', 0, 30);
    document.dispatchEvent(pointerEvent('pointermove', -20, 7, 31, 'touch'));
    document.dispatchEvent(pointerEvent('pointermove', 200, 7, 32, 'touch'));
    document.dispatchEvent(pointerEvent('pointerup', 200, 7, 32, 'touch'));
    expect(onCommit.mock.calls).toEqual([[0]]);
    control.destroy();
  });

  it.each([[205, 60, null], [380, 32, 2]])(
    'resolves direction on pointerup without intervening moves (%s, %s)',
    (x, y, score) => {
      const { root, control, onCommit, touch } = touchFixture();
      const track = root.querySelector('.journal-fluid-track')!;
      touch(track, 'pointerdown', 200, 30);
      touch(track, 'pointerup', x!, y!);
      expect(onCommit.mock.calls).toEqual(score === null ? [] : [[score]]);
      control.destroy();
    },
  );

  it('releases capture and removes gesture listeners when destroyed mid-drag', () => {
    const { root, control, onCommit, touch } = touchFixture();
    touch(root, 'pointerdown', 200, 30);
    touch(root, 'pointermove', 380, 32);
    control.destroy();
    expect(root.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(root.classList.contains('is-dragging')).toBe(false);
    touch(root, 'pointerup', 380, 32);
    expect(onCommit).not.toHaveBeenCalled();
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

  it('tracks the pointer continuously and eases only the stored-score settle', () => {
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
    const root = document.createElement('div');
    document.body.append(root);
    const onCommit = vi.fn();
    const control = new FluidMoodControl(root, {
      initialScore: 0,
      accessibleLabel: 'Mood scale',
      emptyLabel: 'Choose',
      labelForScore: (score) => `Mood ${score}`,
      onCommit,
    });
    mockTrackRect(root, 0, 400);

    root.dispatchEvent(pointerEvent('pointerdown', 380));
    expect(Number(root.style.getPropertyValue('--journal-mood-position').replace('%', ''))).toBe(95);
    expect(root.getAttribute('aria-valuenow')).toBe('1.8');

    root.dispatchEvent(pointerEvent('pointerup', 220));
    expect(onCommit).toHaveBeenCalledWith(0);
    const beforeSettle = Number(root.style.getPropertyValue('--journal-mood-position').replace('%', ''));
    frameCallbacks.shift()?.(performance.now() + 16);
    const afterSettle = Number(root.style.getPropertyValue('--journal-mood-position').replace('%', ''));
    expect(beforeSettle).toBeCloseTo(55, 6);
    expect(afterSettle).toBeGreaterThan(50);
    expect(afterSettle).toBeLessThan(beforeSettle);
    control.destroy();
  });
});
