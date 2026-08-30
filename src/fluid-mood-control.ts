import { MOOD_LEVELS, type MoodScore } from './mood';

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

export type FluidMoodControlOptions = {
  initialScore: MoodScore | null;
  accessibleLabel: string;
  emptyLabel: string;
  labelForScore: (score: MoodScore) => string;
  onPreview?: (value: number, color: string) => void;
  onCommit: (score: MoodScore) => void;
  onActivate?: (score: MoodScore) => void;
};

export function clampMoodValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-2, Math.min(2, value));
}

export function moodValueFromPosition(clientX: number, left: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return clampMoodValue(((clientX - left) / width) * 4 - 2);
}

export function snapMoodScore(value: number): MoodScore {
  return Math.round(clampMoodValue(value)) as MoodScore;
}

function parseHexColor(color: string): Rgb {
  const value = color.replace('#', '');
  const expanded = value.length === 3 ? value.split('').map((part) => `${part}${part}`).join('') : value;
  const parsed = Number.parseInt(expanded, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    h: hue,
    s: delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)),
    l: lightness,
  };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = l - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (hue < 60) [red, green] = [chroma, x];
  else if (hue < 120) [red, green] = [x, chroma];
  else if (hue < 180) [green, blue] = [chroma, x];
  else if (hue < 240) [green, blue] = [x, chroma];
  else if (hue < 300) [red, blue] = [x, chroma];
  else [red, blue] = [chroma, x];
  return {
    r: (red + offset) * 255,
    g: (green + offset) * 255,
    b: (blue + offset) * 255,
  };
}

function mixHsl(from: Rgb, to: Rgb, amount: number): Rgb {
  const start = rgbToHsl(from);
  const end = rgbToHsl(to);
  const t = Math.max(0, Math.min(1, amount));
  const hueDelta = ((end.h - start.h + 540) % 360) - 180;
  const saturationDip = Math.sin(Math.PI * t)
    * Math.min(0.24, Math.max(0, (Math.abs(hueDelta) - 60) / 360));
  return hslToRgb({
    h: start.h + hueDelta * t,
    s: Math.max(0, start.s + (end.s - start.s) * t - saturationDip),
    l: start.l + (end.l - start.l) * t,
  });
}

export function interpolateMoodColor(value: number): string {
  const clamped = clampMoodValue(value);
  const lowerScore = Math.floor(clamped) as MoodScore;
  const upperScore = Math.ceil(clamped) as MoodScore;
  const lower = MOOD_LEVELS.find((level) => level.score === lowerScore) ?? MOOD_LEVELS[0];
  const upper = MOOD_LEVELS.find((level) => level.score === upperScore) ?? MOOD_LEVELS[MOOD_LEVELS.length - 1];
  return rgbToHex(mixHsl(parseHexColor(lower.color), parseHexColor(upper.color), clamped - lowerScore));
}

function colorWithAlpha(color: string, alpha: number): string {
  const { r, g, b } = parseHexColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function traceFluidPath(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  value: number,
  phase: number,
  layer: number,
): void {
  const positive = (value + 2) / 4;
  const energy = 0.045 + Math.abs(value) * 0.018;
  const count = 96;
  context.beginPath();
  for (let index = 0; index <= count; index += 1) {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const fourLobe = Math.sin(angle * 4 + phase * 0.72 + layer * 0.48);
    const fiveLobe = Math.sin(angle * 5 - phase * 0.58 + layer * 0.31);
    const drift = Math.sin(angle * 2 + phase * 0.36 + layer) * 0.018;
    const modulation = (fourLobe * (1 - positive) + fiveLobe * positive) * energy + drift;
    const localRadius = radius * (1 + modulation);
    const x = centerX + Math.cos(angle) * localRadius;
    const y = centerY + Math.sin(angle) * localRadius * (0.96 + positive * 0.04);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

export function drawFluidMood(
  canvas: HTMLCanvasElement,
  value: number,
  phase = 0,
  dimensions?: { width: number; height: number; pixelRatio?: number },
): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(dimensions?.width ?? rect.width ?? canvas.clientWidth));
  const height = Math.max(1, Math.round(dimensions?.height ?? rect.height ?? canvas.clientHeight));
  const pixelRatio = Math.max(1, Math.min(2, dimensions?.pixelRatio ?? window.devicePixelRatio ?? 1));
  const targetWidth = Math.round(width * pixelRatio);
  const targetHeight = Math.round(height * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const clamped = clampMoodValue(value);
  const color = interpolateMoodColor(clamped);
  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = Math.min(width, height) * (0.225 + ((clamped + 2) / 4) * 0.025);
  const glow = context.createRadialGradient(centerX, centerY, baseRadius * 0.1, centerX, centerY, baseRadius * 1.72);
  glow.addColorStop(0, colorWithAlpha(color, 0.45));
  glow.addColorStop(0.55, colorWithAlpha(color, 0.2));
  glow.addColorStop(1, colorWithAlpha(color, 0));
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  for (let layer = 0; layer < 4; layer += 1) {
    const radius = baseRadius * (1.42 - layer * 0.23);
    traceFluidPath(context, centerX, centerY, radius, clamped, phase, layer);
    const fill = context.createRadialGradient(
      centerX - radius * 0.28,
      centerY - radius * 0.34,
      radius * 0.08,
      centerX,
      centerY,
      radius * 1.18,
    );
    fill.addColorStop(0, colorWithAlpha('#ffffff', 0.58 - layer * 0.08));
    fill.addColorStop(0.44, colorWithAlpha(color, 0.22 + layer * 0.08));
    fill.addColorStop(1, colorWithAlpha(color, 0.05 + layer * 0.09));
    context.fillStyle = fill;
    context.fill();
    context.lineWidth = Math.max(1, 1.35 - layer * 0.12);
    context.strokeStyle = colorWithAlpha(layer === 0 ? '#ffffff' : color, 0.58 - layer * 0.07);
    context.stroke();
  }

  const coreRadius = Math.max(3, baseRadius * 0.075);
  context.beginPath();
  context.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
  context.fillStyle = colorWithAlpha('#ffffff', 0.82);
  context.fill();
  return true;
}

export class FluidMoodControl {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly valueLabel: HTMLElement;
  private readonly liveRegion: HTMLElement;
  private readonly handle: HTMLElement;
  private readonly track: HTMLElement;
  private readonly options: FluidMoodControlOptions;
  private readonly mediaQuery: MediaQueryList | null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrame: number | null = null;
  private activePointerId: number | null = null;
  private dragStartScore: MoodScore | null = null;
  private dragStartValue = 0;
  private selectedScore: MoodScore | null;
  private displayValue: number;
  private targetValue: number;
  private phase = 0;
  private lastFrame = 0;
  private lastPreviewColor: string | null = null;
  private destroyed = false;

  constructor(root: HTMLElement, options: FluidMoodControlOptions) {
    this.root = root;
    this.options = options;
    this.selectedScore = options.initialScore;
    this.displayValue = options.initialScore ?? 0;
    this.targetValue = this.displayValue;
    this.mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

    root.classList.add('journal-fluid-mood-control');
    root.tabIndex = 0;
    root.setAttribute('role', 'slider');
    root.setAttribute('aria-label', options.accessibleLabel);
    root.setAttribute('aria-valuemin', '-2');
    root.setAttribute('aria-valuemax', '2');
    root.setAttribute('aria-orientation', 'horizontal');

    const visual = document.createElement('div');
    visual.className = 'journal-fluid-visual';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'journal-fluid-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    visual.append(this.canvas);

    const readout = document.createElement('div');
    readout.className = 'journal-fluid-readout';
    this.valueLabel = document.createElement('strong');
    this.valueLabel.className = 'journal-fluid-value';
    readout.append(this.valueLabel);

    this.track = document.createElement('div');
    this.track.className = 'journal-fluid-track';
    this.track.setAttribute('aria-hidden', 'true');
    const spectrum = document.createElement('span');
    spectrum.className = 'journal-fluid-track-spectrum';
    this.handle = document.createElement('span');
    this.handle.className = 'journal-fluid-handle';
    this.track.append(spectrum, this.handle);

    const endpoints = document.createElement('div');
    endpoints.className = 'journal-fluid-endpoints';
    const low = document.createElement('span');
    low.textContent = options.labelForScore(-2);
    const high = document.createElement('span');
    high.textContent = options.labelForScore(2);
    endpoints.append(low, high);

    this.liveRegion = document.createElement('span');
    this.liveRegion.className = 'journal-visually-hidden';
    this.liveRegion.setAttribute('aria-live', 'polite');
    root.append(visual, readout, this.track, endpoints, this.liveRegion);

    root.addEventListener('pointerdown', this.handlePointerDown);
    root.addEventListener('pointermove', this.handlePointerMove);
    root.addEventListener('pointerup', this.handlePointerUp);
    root.addEventListener('pointercancel', this.handlePointerCancel);
    root.addEventListener('keydown', this.handleKeydown);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.mediaQuery?.addEventListener?.('change', this.handleMotionChange);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.renderFrame());
      this.resizeObserver.observe(this.canvas);
    }

    this.updatePresentation(false);
    this.startAnimation();
  }

  focus(): void {
    this.root.focus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopAnimation();
    this.resizeObserver?.disconnect();
    this.root.removeEventListener('pointerdown', this.handlePointerDown);
    this.root.removeEventListener('pointermove', this.handlePointerMove);
    this.root.removeEventListener('pointerup', this.handlePointerUp);
    this.root.removeEventListener('pointercancel', this.handlePointerCancel);
    this.root.removeEventListener('keydown', this.handleKeydown);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.mediaQuery?.removeEventListener?.('change', this.handleMotionChange);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.activePointerId !== null) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.dragStartScore = this.selectedScore;
    this.dragStartValue = this.displayValue;
    this.root.classList.add('is-dragging');
    this.capturePointer(event.pointerId);
    this.updateFromPointer(event.clientX);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    this.updateFromPointer(event.clientX);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    this.updateFromPointer(event.clientX);
    this.releasePointer(event.pointerId);
    this.activePointerId = null;
    this.root.classList.remove('is-dragging');
    this.commitScore(snapMoodScore(this.displayValue));
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.releasePointer(event.pointerId);
    this.activePointerId = null;
    this.root.classList.remove('is-dragging');
    this.selectedScore = this.dragStartScore;
    this.displayValue = this.dragStartValue;
    this.targetValue = this.dragStartScore ?? this.dragStartValue;
    if (this.prefersReducedMotion()) this.displayValue = this.targetValue;
    this.updatePresentation(false);
  };

  private capturePointer(pointerId: number): void {
    try {
      this.root.setPointerCapture?.(pointerId);
    } catch {
      // Synthetic pointer events do not have a native active pointer to capture.
    }
  }

  private releasePointer(pointerId: number): void {
    try {
      if (this.root.hasPointerCapture?.(pointerId) === false) return;
      this.root.releasePointerCapture?.(pointerId);
    } catch {
      // The browser may already have released capture during cancellation.
    }
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    let next: MoodScore | null = null;
    const current = this.selectedScore ?? 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = snapMoodScore(current + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = snapMoodScore(current - 1);
    else if (event.key === 'Home') next = -2;
    else if (event.key === 'End') next = 2;
    else if ((event.key === 'Enter' || event.key === ' ') && this.selectedScore !== null) {
      event.preventDefault();
      this.options.onActivate?.(this.selectedScore);
      return;
    } else return;

    event.preventDefault();
    this.commitScore(next);
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.stopAnimation();
    else this.startAnimation();
  };

  private readonly handleMotionChange = (): void => {
    if (this.prefersReducedMotion()) {
      this.displayValue = this.targetValue;
      this.stopAnimation();
      this.renderFrame();
    } else {
      this.startAnimation();
    }
  };

  private updateFromPointer(clientX: number): void {
    const rect = this.track.getBoundingClientRect();
    this.displayValue = moodValueFromPosition(clientX, rect.left, rect.width);
    this.targetValue = this.displayValue;
    this.updatePresentation(false);
  }

  private commitScore(score: MoodScore): void {
    this.selectedScore = score;
    this.targetValue = score;
    if (this.prefersReducedMotion()) this.displayValue = score;
    this.updatePresentation(true);
    this.options.onCommit(score);
  }

  private updatePresentation(announce: boolean, render = true): void {
    const nearest = snapMoodScore(this.displayValue);
    const presentedScore = this.activePointerId === null && this.selectedScore !== null
      ? this.selectedScore
      : nearest;
    const label = this.selectedScore === null && this.activePointerId === null
      ? this.options.emptyLabel
      : this.options.labelForScore(presentedScore);
    const color = interpolateMoodColor(this.displayValue);
    const position = ((this.displayValue + 2) / 4) * 100;
    this.root.style.setProperty('--journal-mood-active', color);
    this.root.style.setProperty('--journal-mood-position', `${position}%`);
    if (color !== this.lastPreviewColor) {
      this.lastPreviewColor = color;
      this.options.onPreview?.(this.displayValue, color);
    }
    this.root.classList.toggle('is-empty', this.selectedScore === null && this.activePointerId === null);
    this.root.setAttribute('aria-valuenow', String(this.selectedScore ?? 0));
    this.root.setAttribute('aria-valuetext', label);
    this.valueLabel.textContent = label;
    this.handle.setAttribute('data-label', label);
    if (announce) this.liveRegion.textContent = label;
    if (render) this.renderFrame();
  }

  private prefersReducedMotion(): boolean {
    return this.mediaQuery?.matches === true;
  }

  private startAnimation(): void {
    if (this.destroyed || this.prefersReducedMotion() || document.hidden || this.animationFrame !== null) return;
    this.lastFrame = performance.now();
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  private stopAnimation(): void {
    if (this.animationFrame === null) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  private readonly animate = (time: number): void => {
    if (this.destroyed || document.hidden || this.prefersReducedMotion() || !this.root.isConnected) {
      this.animationFrame = null;
      return;
    }
    const elapsed = Math.min(48, Math.max(0, time - this.lastFrame));
    this.lastFrame = time;
    if (this.activePointerId === null) {
      const distance = this.targetValue - this.displayValue;
      this.displayValue = Math.abs(distance) < 0.002 ? this.targetValue : this.displayValue + distance * 0.18;
      this.updatePresentation(false, false);
    }
    this.phase += elapsed * 0.00042;
    this.renderFrame();
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private renderFrame(): void {
    drawFluidMood(this.canvas, this.displayValue, this.phase);
  }
}
