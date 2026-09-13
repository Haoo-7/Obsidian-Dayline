// @ts-nocheck
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const notices: string[] = [];

vi.mock('obsidian', () => ({
  Modal: class {
    app: unknown;
    modalEl = document.createElement('div');
    contentEl = document.createElement('div');
    scope = { register: vi.fn() };

    constructor(app: unknown) {
      this.app = app;
      this.contentEl.classList.add('modal-content');
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
  setIcon: (element: HTMLElement, name: string) => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('data-icon', name);
    element.replaceChildren(icon);
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
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
    document.body.className = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps phone mood content padded and scrollable on the shared modal-content root in both steps', () => {
    document.body.classList.add('dayline-mobile', 'dayline-phone');
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-09-11.md',
      settings: { displayLanguage: 'en' },
      onSave: vi.fn(),
    });
    modal.onOpen();
    const selector = 'body.dayline-mobile.dayline-phone .journal-mood-picker-modal .modal-content.journal-mood-picker';
    const source = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
    const start = source.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const style = document.createElement('style');
    style.textContent = source.slice(start, source.indexOf('}', start) + 1);
    document.body.append(style);
    for (const step of [1, 2]) {
      if (step === 2) modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!.click();
      expect(modal.contentEl.matches(selector)).toBe(true);
      const computed = window.getComputedStyle(modal.contentEl);
      expect(computed.paddingLeft).toBe('16px');
      expect(computed.paddingRight).toBe('16px');
      expect(computed.paddingBottom).toBe('16px');
      expect(computed.boxSizing).toBe('border-box');
      expect(computed.overflowY).toBe('auto');
      expect(computed.overflowX).toBe('hidden');
    }
    modal.close();
  });

  it('preserves the live phone form through keyboard and rotation changes and disposes viewport work', () => {
    document.body.classList.add('dayline-mobile', 'dayline-phone');
    const viewport = Object.assign(new window.EventTarget(), {
      height: 780, width: 390, offsetTop: 0, offsetLeft: 0,
    });
    const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    let scheduled: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { scheduled = callback; return 42; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const modal = new MoodPickerModal({}, { filePath: 'Daily/2026-09-11.md' });
    try {
      modal.onOpen();
      modal.contentEl.scrollTop = 200;
      modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!.click();
      expect(modal.contentEl.scrollTop).toBe(0);
      const note = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
      const custom = modal.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
      note.value = 'Draft survives rotation';
      note.dispatchEvent(new Event('input', { bubbles: true }));
      custom.value = 'Unfinished custom feeling';
      custom.dispatchEvent(new Event('input', { bubbles: true }));
      note.focus();
      note.setSelectionRange(6, 14);
      Object.assign(viewport, { height: 170, width: 844, offsetTop: 20 });
      viewport.dispatchEvent(new Event('resize'));
      scheduled!(0);
      expect(modal.modalEl.style.getPropertyValue('--journal-mood-viewport-height')).toBe('170px');
      expect(modal.modalEl.classList.contains('is-compact-viewport')).toBe(true);
      expect(modal.contentEl.querySelector('textarea')).toBe(note);
      expect(document.activeElement).toBe(note);
      expect([note.selectionStart, note.selectionEnd]).toEqual([6, 14]);
      expect(modal.note).toBe('Draft survives rotation');
      expect(modal.customText).toBe('Unfinished custom feeling');
      expect(modal.step).toBe(2);
      viewport.dispatchEvent(new Event('scroll'));
      modal.close();
      expect(cancel).toHaveBeenCalledWith(42);
      expect(modal.modalEl.style.getPropertyValue('--journal-mood-viewport-height')).toBe('');
      scheduled!(0);
      expect(modal.modalEl.classList.contains('has-mood-viewport')).toBe(false);
    } finally {
      if (!modal.closed) modal.close();
      if (originalViewport) Object.defineProperty(window, 'visualViewport', originalViewport);
      else delete window.visualViewport;
    }
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

    expect(modal.score).toBe(0);
    expect(modal.contentEl.querySelector('[role="slider"]')?.getAttribute('aria-valuetext')).toBe('Steady');
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
    expect(date.tabIndex).toBe(0);
    await vi.waitFor(() => expect(document.activeElement).toBe(modal.contentEl.querySelector('[role="slider"]')));
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

  it('focuses step two content and adds checked feelings without replacing the form', async () => {
    const modal = new MoodPickerModal({}, { filePath: 'Daily/2026-09-01.md' });
    modal.onOpen();
    modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!.click();
    const heading = modal.contentEl.querySelector('h3');
    const firstLabel = modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-label')!;
    expect([heading, firstLabel]).toContain(document.activeElement);
    const check = firstLabel.querySelector('.journal-mood-label-check')!;
    expect(check).not.toBeNull();
    expect(check.getAttribute('aria-hidden')).toBe('true');
    expect(check.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(firstLabel.querySelector('.journal-mood-label-text')?.textContent).toBe(firstLabel.textContent);
    expect(firstLabel.getAttribute('aria-pressed')).toBe('false');
    firstLabel.click();
    expect(firstLabel.querySelector('.journal-mood-label-check')).toBe(check);
    expect(firstLabel.getAttribute('aria-pressed')).toBe('true');
    firstLabel.click();
    expect(firstLabel.querySelector('.journal-mood-label-check')).toBe(check);
    expect(firstLabel.getAttribute('aria-pressed')).toBe('false');

    const note = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
    note.value = 'Unfinished note';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    const custom = modal.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    custom.focus();
    custom.value = 'walked';
    custom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    expect(document.activeElement).toBe(custom);
    expect(modal.contentEl.querySelector('textarea')).toBe(note);
    expect(note.value).toBe('Unfinished note');
    expect(modal.contentEl.querySelector('h3')).toBe(heading);
    const added = modal.contentEl.querySelector('[data-custom-label="true"]')!;
    expect(added.textContent).toBe('walked');
    expect(added.getAttribute('aria-pressed')).toBe('true');
    expect(added.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it.each(['  Saved B  ', '   '])('closes after saving %j even when another date has an unsaved draft', async (savedNote) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-09-01.md', allowDateSelection: true, onSave,
      onDateChange: async (date) => ({ filePath: `Daily/${date}.md`, initial: null }),
    });
    modal.onOpen();
    const editNote = (value) => {
      modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')?.click();
      const note = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
      note.value = value;
      note.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const change = (date) => modal.changeDate(date, modal.contentEl.querySelector('input[type="date"]'));
    editNote('Draft A');
    await change('2026-09-02');
    editNote(savedNote);
    await modal.save();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'Daily/2026-09-02.md', note: savedNote.trim() || null,
    }));
    expect(modal.modalEl.isConnected).toBe(false);
  });

  it('restores each file draft including unfinished custom input after date round trips', async () => {
    const onDateChange = vi.fn(async (date) => ({
      filePath: `Daily/${date}.md`,
      initial: { score: -2, labels: ['sad'], note: 'Stored note' },
      customLabels: [],
    }));
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-09-01.md', allowDateSelection: true, onDateChange,
    });
    modal.onOpen();
    openLabelStep(modal);
    const note = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
    note.value = 'Draft A';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    const custom = modal.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    custom.value = 'walked';
    custom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    custom.value = 'unfinished';
    custom.dispatchEvent(new Event('input', { bubbles: true }));
    const change = async (date) => {
      const input = modal.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!;
      input.value = date;
      await modal.changeDate(date, input);
    };
    await change('2026-09-02');
    expect(modal.note).toBe('Stored note');
    modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!.click();
    const secondNote = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
    secondNote.value = 'Draft B';
    secondNote.dispatchEvent(new Event('input', { bubbles: true }));
    await change('2026-09-01');
    expect(modal.score).toBe(2);
    expect(modal.note).toBe('Draft A');
    expect(Array.from(modal.labels)).toContain('walked');
    expect(modal.customLabels).toContain('walked');
    modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!.click();
    expect(modal.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('unfinished');
    await change('2026-09-02');
    expect(modal.note).toBe('Draft B');
  });

  it('locks switching and saving while a date request is pending and restores failures in place', async () => {
    const pending = deferred();
    const onDateChange = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      filePath: 'Daily/2026-09-02.md', initial: null,
    });
    const onSave = vi.fn();
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-09-01.md', allowDateSelection: true, onDateChange, onSave,
    });
    modal.onOpen();
    const input = modal.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!;
    const slider = modal.contentEl.querySelector<HTMLElement>('[role="slider"]')!;
    input.value = '2026-09-02';
    const changing = modal.changeDate(input.value, input);
    const locked = Array.from(modal.contentEl.querySelectorAll('button, input, textarea')).every((control) => control.disabled);
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const scoreWhilePending = modal.score;
    await modal.changeDate('2026-09-03', input);
    await modal.save();
    const escape = modal.scope.register.mock.calls[0][2];
    const escapeResult = escape(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    modal.close();
    const stayedOpen = modal.modalEl.isConnected;
    pending.reject(new Error('Date unavailable'));
    await changing;
    expect(locked).toBe(true);
    expect(scoreWhilePending).toBe(0);
    expect(onDateChange).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(escapeResult).toBe(false);
    expect(stayedOpen).toBe(true);
    expect(input.value).toBe('2026-09-01');
    expect(input.disabled).toBe(false);
    expect(modal.filePath).toBe('Daily/2026-09-01.md');
    expect(modal.contentEl.querySelector('[role="slider"]')).toBe(slider);
    expect(modal.contentEl.querySelector('.journal-mood-error')?.textContent).toContain('Date unavailable');
    input.value = '2026-09-02';
    await modal.changeDate(input.value, input);
    expect(modal.filePath).toBe('Daily/2026-09-02.md');
    expect(modal.score).toBe(0);
    expect(modal.contentEl.querySelector('.journal-mood-error')).toBeNull();
  });

  it('saves a detached snapshot once, locks all edits, and retries failures without losing the form', async () => {
    const pending = deferred();
    const onSave = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const onDateChange = vi.fn();
    const launcher = document.body.appendChild(document.createElement('button'));
    launcher.focus();
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-09-01.md', allowDateSelection: true, customLabels: ['walked'],
      onSave, onDateChange,
    });
    modal.onOpen();
    openLabelStep(modal);
    const note = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
    note.value = '  Keep this draft  ';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    const save = modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-actions .mod-cta')!;
    const saving = modal.save(save);
    const locked = Array.from(modal.contentEl.querySelectorAll('button, input, textarea')).every((control) => control.disabled);
    const snapshot = onSave.mock.calls[0][0];
    const detachedCustomLabels = snapshot.customLabels !== modal.customLabels;
    const feeling = modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-label')!;
    const dateInput = modal.contentEl.querySelector('input[type="date"]');
    modal.contentEl.querySelector<HTMLButtonElement>('.journal-mood-actions button')!.click();
    feeling.click();
    const escape = modal.scope.register.mock.calls[0][2];
    const escapeResult = escape(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    modal.close();
    const stayedOpen = modal.modalEl.isConnected;
    await modal.save(save);
    await modal.changeDate('2026-09-02', dateInput);
    pending.reject(new Error('Disk full'));
    await saving;
    expect(locked).toBe(true);
    expect(detachedCustomLabels).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDateChange).not.toHaveBeenCalled();
    expect(escapeResult).toBe(false);
    expect(stayedOpen).toBe(true);
    expect(snapshot).toEqual({
      filePath: 'Daily/2026-09-01.md', score: 2, labels: [], note: 'Keep this draft', customLabels: ['walked'],
    });
    expect(modal.contentEl.querySelector('textarea')).toBe(note);
    expect(note.value).toBe('  Keep this draft  ');
    expect(modal.contentEl.querySelector('.journal-mood-error')?.textContent).toContain('Disk full');
    expect(save.disabled).toBe(false);
    await modal.save(save);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toEqual(snapshot);
    expect(modal.modalEl.isConnected).toBe(false);
    expect(document.activeElement).toBe(launcher);
  });

  it('closes immediately with unsaved drafts and restores launcher focus', async () => {
    const launcher = document.body.appendChild(document.createElement('button'));
    launcher.focus();
    const modal = new MoodPickerModal({}, {
      filePath: 'Daily/2026-09-01.md', allowDateSelection: true,
      onDateChange: async () => ({ filePath: 'Daily/2026-09-02.md', initial: null }),
    });
    modal.onOpen();
    openLabelStep(modal);
    const note = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
    note.value = 'Draft on first date';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    await modal.changeDate('2026-09-02', modal.contentEl.querySelector('input[type="date"]'));
    const escape = modal.scope.register.mock.calls[0][2];
    expect(escape(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))).toBe(false);
    expect(modal.modalEl.isConnected).toBe(false);
    expect(modal.contentEl.querySelector('.journal-mood-discard-confirm')).toBeNull();
    expect(document.activeElement).toBe(launcher);

    const dirty = new MoodPickerModal({}, { filePath: 'Daily/2026-09-01.md' });
    dirty.onOpen();
    dirty.contentEl.querySelector<HTMLButtonElement>('.journal-mood-continue')!.click();
    const input = dirty.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.value = 'not yet added';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dirty.close();
    expect(dirty.modalEl.isConnected).toBe(false);
    expect(dirty.contentEl.querySelector('.journal-mood-discard-confirm')).toBeNull();
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
