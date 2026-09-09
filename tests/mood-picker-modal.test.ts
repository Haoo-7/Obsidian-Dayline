// @ts-nocheck
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const notices: string[] = [];

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
    constructor(message: string) { notices.push(message); }
  },
}));

import { MoodPickerModal, MoodRecoveryModal } from '../src/mood-picker-modal';

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
    notices.length = 0;
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
    expect(next.disabled).toBe(false);

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

  it('allows a fresh mood entry to continue with the neutral default', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-09-02.md',
      settings: { displayLanguage: 'en' },
      onSave,
    });
    modal.onOpen();

    const next = modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!;
    expect(next.disabled).toBe(false);
    next.click();
    expect(modal.score).toBe(0);
    expect(modal.contentEl.querySelector('.journal-mood-labels')).not.toBeNull();
    modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-actions .mod-cta')!.click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      filePath: 'Daily/2026-09-02.md',
      score: 0,
      labels: [],
      note: null,
      customLabels: [],
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
    expect(date.tabIndex).toBe(-1);
    date.value = '2026-08-29';
    date.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-08-29'));
    await vi.waitFor(() => {
      expect(modal.contentEl.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('-2');
    });
    modal.close();
  });

  function openLabelStep(modal: InstanceType<typeof MoodPickerModal>): void {
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
    slider.dispatchEvent(pointerEvent('pointerdown', 390));
    slider.dispatchEvent(pointerEvent('pointerup', 390));
    modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!.click();
  }

  it('keeps Back, ARIA, and custom feeling behavior on step two', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-09-01.md',
      settings: { displayLanguage: 'en' },
      customLabels: [],
      onSave,
    });
    modal.onOpen();
    expect(modal.contentEl.querySelector('[role="slider"]')?.getAttribute('aria-label')).toBe('How did today feel?');

    openLabelStep(modal);
    const group = modal.contentEl.querySelector<HTMLElement>('.journal-mood-labels')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Add feelings');
    const joyful = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>('.journal-mood-label'))
      .find((button) => button.textContent === 'Joyful')!;
    expect(joyful.getAttribute('aria-pressed')).toBe('false');
    joyful.click();
    expect(joyful.getAttribute('aria-pressed')).toBe('true');

    const customInput = modal.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(customInput.getAttribute('aria-label')).toBe('Custom feeling');
    customInput.value = 'walked';
    modal.contentEl.querySelectorAll<HTMLButtonElement>('.journal-mood-custom-label-field button')[0].click();
    expect(Array.from(modal.contentEl.querySelectorAll('.journal-mood-label')).some((button) => button.textContent === 'walked')).toBe(true);

    modal.contentEl.querySelectorAll<HTMLButtonElement>('.journal-mood-actions button')[0].click();
    expect(modal.contentEl.querySelector('.journal-fluid-mood-control')).not.toBeNull();
    expect(modal.contentEl.querySelector('.journal-mood-labels')).toBeNull();

    openLabelStep(modal);
    expect(Array.from(modal.contentEl.querySelectorAll('.journal-mood-label')).some((button) => button.textContent === 'walked')).toBe(true);
    modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-actions .mod-cta')!.click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      filePath: 'Daily/2026-09-01.md',
      score: 2,
      labels: ['walked', 'joyful'],
      note: null,
      customLabels: ['walked'],
    });
  });
});

describe('MoodRecoveryModal failure handling', () => {
  it('re-enables restore after a confirmed replacement retry also fails', async () => {
    const restoreOrphan = vi.fn()
      .mockRejectedValueOnce(new Error('Mood restore target already has a record: target.md'))
      .mockRejectedValueOnce(new Error('retry failed'));
    const modal = new MoodRecoveryModal({}, {
      settings: { displayLanguage: 'en' },
      store: {
        getOrphans: () => ({
          'deleted.md': {
            record: { score: 1, labels: [], recordedAt: 'now', updatedAt: 'now' },
            orphanedAt: 'now',
          },
        }),
        restoreOrphan,
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    modal.onOpen();
    const destination = modal.contentEl.querySelector<HTMLInputElement>('input')!;
    destination.value = 'target.md';
    const restore = modal.contentEl.querySelector<HTMLButtonElement>('button')!;

    restore.click();
    await vi.waitFor(() => expect(restoreOrphan).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(restore.disabled).toBe(false));
    expect(notices.at(-1)).toContain('retry failed');
  });
});
