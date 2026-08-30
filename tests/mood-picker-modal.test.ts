// @ts-nocheck
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('obsidian', () => ({
  Modal: class {
    app: unknown;
    modalEl = document.createElement('div');
    contentEl = document.createElement('div');
    scope = { register: vi.fn() };

    constructor(app: unknown) {
      this.app = app;
      this.modalEl.append(this.contentEl);
      document.body.append(this.modalEl);
    }

    close() {
      (this as { onClose?: () => void }).onClose?.();
      this.modalEl.remove();
    }
  },
  Notice: class {
    constructor(_message: string) {}
  },
}));

import { MoodPickerModal } from '../src/mood-picker-modal';

function installObsidianDomHelpers(): void {
  const prototype = HTMLElement.prototype as HTMLElement & Record<string, unknown>;
  prototype.empty = function empty(this: HTMLElement) {
    this.replaceChildren();
  };
  prototype.addClass = function addClass(this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes);
  };
  prototype.createEl = function createEl(
    this: HTMLElement,
    tag: string,
    options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
  ) {
    const element = document.createElement(tag);
    if (options.text !== undefined) element.textContent = options.text;
    if (options.cls) element.classList.add(...options.cls.split(/\s+/).filter(Boolean));
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
    this.append(element);
    return element;
  };
  prototype.createDiv = function createDiv(this: HTMLElement, options = {}) {
    return (this as HTMLElement & { createEl: Function }).createEl('div', options);
  };
  prototype.createSpan = function createSpan(this: HTMLElement, options = {}) {
    return (this as HTMLElement & { createEl: Function }).createEl('span', options);
  };
}

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

function pointerEvent(type: string, clientX: number, pointerId = 4): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    pointerId: { value: pointerId },
  });
  return event;
}

describe('MoodPickerModal fluid flow', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLCanvasElement: dom.window.HTMLCanvasElement,
      Event: dom.window.Event,
      KeyboardEvent: dom.window.KeyboardEvent,
    });
    installObsidianDomHelpers();
  });

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContextStub());
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps drag release in step one, then saves the compatible payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-08-30.md',
      settings: { displayLanguage: 'zh' },
      customLabels: ['散步'],
      onSave,
    });
    modal.onOpen();

    const slider = modal.contentEl.querySelector<HTMLElement>('[role="slider"]')!;
    const track = slider.querySelector<HTMLElement>('.journal-fluid-track')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 400,
      top: 0,
      bottom: 34,
      width: 400,
      height: 34,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    expect(slider.getAttribute('aria-label')).toBe('今天的感受如何？');
    const next = modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!;
    expect(next.disabled).toBe(true);

    slider.dispatchEvent(pointerEvent('pointerdown', 390));
    slider.dispatchEvent(pointerEvent('pointerup', 390));

    expect(next.disabled).toBe(false);
    expect(modal.contentEl.querySelector('.journal-fluid-mood-control')).not.toBeNull();
    expect(modal.contentEl.querySelector('.journal-mood-labels')).toBeNull();

    next.click();
    const joyful = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>('.journal-mood-label'))
      .find((button) => button.textContent === '喜悦')!;
    joyful.click();
    const note = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
    note.value = '  今天完成了重要工作。  ';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-actions .mod-cta')!.click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      filePath: 'Daily/2026-08-30.md',
      score: 2,
      labels: ['joyful'],
      note: '今天完成了重要工作。',
      customLabels: ['散步'],
    });
  });

  it('reloads the selected score when the date changes', async () => {
    const onDateChange = vi.fn().mockResolvedValue({
      filePath: 'Daily/2026-08-29.md',
      initial: { score: -2, labels: ['sad'], note: '低落' },
      customLabels: [],
    });
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-08-30.md',
      settings: { displayLanguage: 'en' },
      allowDateSelection: true,
      onDateChange,
    });
    modal.onOpen();
    const date = modal.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!;
    date.value = '2026-08-29';
    date.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-08-29'));
    await vi.waitFor(() => {
      expect(modal.contentEl.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('-2');
    });
    modal.close();
  });
});
