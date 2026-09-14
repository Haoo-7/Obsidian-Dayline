import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { bindMoodModalViewport } from '../src/mood-modal-viewport';

describe('phone mood modal viewport', () => {
  let dom: JSDOM;
  let modal: HTMLElement;
  let content: HTMLElement;
  let viewport: EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number };
  let pending: Map<number, FrameRequestCallback>;
  let host: HTMLElement;
  let hostHeight: number;
  let layoutHeight: number;
  let layoutWidth: number;
  let notifyHostResize: () => void;
  let disconnectHostResize: ReturnType<typeof vi.fn>;
  let dispose: () => void;
  const flush = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(0));
  };
  const bounds = (top: number, height: number) => ({
    top, bottom: top + height, height, x: 0, y: top, left: 0, right: 360, width: 360,
    toJSON: () => ({}),
  });

  beforeEach(() => {
    // No global window: the owning document must supply all APIs and focus.
    dom = new JSDOM('<body class="dayline-mobile dayline-phone"></body>', { pretendToBeVisual: true });
    const doc = dom.window.document;
    layoutHeight = 780;
    layoutWidth = 390;
    vi.spyOn(dom.window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('journal-mood-viewport-probe')
        ? { ...bounds(0, layoutHeight), width: layoutWidth, right: layoutWidth }
        : bounds(0, 0);
    });
    host = doc.body.appendChild(doc.createElement('div'));
    host.className = 'app-container';
    hostHeight = 0;
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => bounds(0, hostHeight));
    disconnectHostResize = vi.fn();
    Object.defineProperty(dom.window, 'ResizeObserver', {
      configurable: true,
      value: class {
        constructor(callback: () => void) { notifyHostResize = callback; }
        observe = vi.fn();
        disconnect = disconnectHostResize;
      },
    });
    modal = doc.body.appendChild(doc.createElement('div'));
    content = modal.appendChild(doc.createElement('div'));
    content.className = 'modal-content journal-mood-picker';
    viewport = Object.assign(new dom.window.EventTarget(), {
      height: 780, width: 390, offsetTop: 0, offsetLeft: 0,
    });
    Object.defineProperty(dom.window, 'visualViewport', { configurable: true, value: viewport });
    pending = new Map();
    let nextFrame = 0;
    vi.spyOn(dom.window, 'requestAnimationFrame').mockImplementation((callback) => {
      pending.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(dom.window, 'cancelAnimationFrame').mockImplementation((id) => { pending.delete(id); });
    vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => bounds(60, viewport.height - 80));
    Object.defineProperty(content, 'clientHeight', { get: () => viewport.height - 80 });
  });

  afterEach(() => {
    dispose?.();
    dom.window.close();
    vi.restoreAllMocks();
  });

  it('syncs keyboard and rotation dimensions from the owner viewport in one animation frame', () => {
    dispose = bindMoodModalViewport(modal, content);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('780px');
    expect(modal.classList.contains('is-compact-viewport')).toBe(false);
    Object.assign(viewport, { height: 170, width: 844, offsetTop: 23, offsetLeft: 7 });
    layoutWidth = 900;
    layoutHeight = 390;
    viewport.dispatchEvent(new dom.window.Event('resize'));
    viewport.dispatchEvent(new dom.window.Event('scroll'));
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    expect(pending.size).toBe(1);
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('170px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-width')).toBe('844px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-top')).toBe('23px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-left')).toBe('7px');
    expect(modal.classList.contains('is-compact-viewport')).toBe(true);
    viewport.height = 780;
    layoutHeight = 803;
    viewport.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(modal.classList.contains('is-compact-viewport')).toBe(false);
  });

  it('reveals a focused note inside the native scroller after keyboard resize without replacing it', () => {
    const note = content.appendChild(dom.window.document.createElement('textarea'));
    note.value = 'Unfinished draft';
    note.setSelectionRange(4, 9);
    vi.spyOn(note, 'getBoundingClientRect').mockImplementation(() => bounds(500 - content.scrollTop, 90));
    const hostScroll = vi.spyOn(dom.window, 'scrollTo');
    dispose = bindMoodModalViewport(modal, content);
    note.focus();
    viewport.height = 350;
    viewport.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(content.scrollTop).toBe(268);
    expect(content.querySelector('textarea')).toBe(note);
    expect(dom.window.document.activeElement).toBe(note);
    expect(note.value).toBe('Unfinished draft');
    expect([note.selectionStart, note.selectionEnd]).toEqual([4, 9]);
    expect(hostScroll).not.toHaveBeenCalled();
    viewport.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(content.scrollTop).toBe(268);
  });

  it('does not fight a native scroll or viewport pan while a field remains focused', () => {
    const input = content.appendChild(dom.window.document.createElement('input'));
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(bounds(90, 44));
    dispose = bindMoodModalViewport(modal, content);
    input.focus();
    flush();
    content.scrollTop = 120;
    viewport.offsetTop = 80;
    viewport.dispatchEvent(new dom.window.Event('scroll'));
    content.dispatchEvent(new dom.window.Event('scroll'));
    flush();
    expect(content.scrollTop).toBe(120);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-top')).toBe('80px');
    const touch = new dom.window.Event('touchmove', { bubbles: true, cancelable: true });
    expect(content.dispatchEvent(touch)).toBe(true);
    expect(touch.defaultPrevented).toBe(false);
  });

  it('aligns an oversized textarea once and lets native text scrolling handle its caret', () => {
    viewport.height = 170;
    const note = content.appendChild(dom.window.document.createElement('textarea'));
    vi.spyOn(note, 'getBoundingClientRect').mockImplementation(() => bounds(300 - content.scrollTop, 100));
    dispose = bindMoodModalViewport(modal, content);
    note.focus();
    flush();
    expect(content.scrollTop).toBe(232);
    viewport.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(content.scrollTop).toBe(232);
  });

  it('reveals a newly focused save button but ignores focus outside the modal', () => {
    viewport.height = 350;
    const save = content.appendChild(dom.window.document.createElement('button'));
    vi.spyOn(save, 'getBoundingClientRect').mockReturnValue(bounds(500, 44));
    dispose = bindMoodModalViewport(modal, content);
    save.focus();
    flush();
    expect(content.scrollTop).toBe(222);
    const outside = dom.window.document.body.appendChild(dom.window.document.createElement('input'));
    outside.focus();
    flush();
    expect(content.scrollTop).toBe(222);
  });

  it('falls back to the owning window when VisualViewport is absent', () => {
    Object.defineProperty(dom.window, 'visualViewport', { value: undefined });
    dispose = bindMoodModalViewport(modal, content);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('768px');
    layoutHeight = 320;
    Object.defineProperty(dom.window, 'innerHeight', { value: 320 });
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('320px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-top')).toBe('0px');
  });

  it('uses the unshrunk layout baseline in overlay mode without a viewport event', () => {
    hostHeight = 780;
    dispose = bindMoodModalViewport(modal, content);
    hostHeight = 350;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '430px');
    notifyHostResize();
    flush();
    expect(viewport.height).toBe(780);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('350px');
    expect(modal.classList.contains('is-compact-viewport')).toBe(true);
    hostHeight = 780;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '0px');
    notifyHostResize();
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('780px');
  });

  it.each([45, 350, 780])('ignores a %ipx host when the visual viewport has already resized', (height) => {
    hostHeight = height;
    viewport.height = 350;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '430px');
    dispose = bindMoodModalViewport(modal, content);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('350px');
  });

  it('ignores a twice-shrunk modal container, including its misleading top offset', () => {
    const container = dom.window.document.body.appendChild(dom.window.document.createElement('div'));
    container.className = 'modal-container';
    container.appendChild(modal);
    hostHeight = 100;
    viewport.height = 440;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(bounds(20, 45));
    dispose = bindMoodModalViewport(modal, content);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-top')).toBe('0px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
  });

  it('responds to native style and animation-class updates when ResizeObserver is unavailable', async () => {
    Object.defineProperty(dom.window, 'ResizeObserver', { value: undefined });
    hostHeight = 780;
    dispose = bindMoodModalViewport(modal, content);
    hostHeight = 350;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '430px');
    dom.window.document.body.classList.add('keyboard-animating');
    await Promise.resolve();
    expect(pending.size).toBe(1);
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('350px');
    hostHeight = 45;
    dom.window.document.body.classList.remove('keyboard-animating');
    await Promise.resolve();
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('350px');
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '0px');
    hostHeight = 780;
    await Promise.resolve();
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('780px');
  });

  it('reveals a save button within the keyboard boundary and permits scrolling past a focused note', () => {
    const note = content.appendChild(dom.window.document.createElement('textarea'));
    vi.spyOn(note, 'getBoundingClientRect').mockImplementation(() => bounds(500 - content.scrollTop, 90));
    const save = content.appendChild(dom.window.document.createElement('button'));
    vi.spyOn(save, 'getBoundingClientRect').mockImplementation(() => bounds(650 - content.scrollTop, 44));
    hostHeight = 780;
    dispose = bindMoodModalViewport(modal, content);
    note.focus();
    flush();
    hostHeight = 350;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '430px');
    notifyHostResize();
    flush();
    expect(content.scrollTop).toBe(248);
    content.scrollTop = 352;
    notifyHostResize();
    flush();
    expect(content.scrollTop).toBe(352);
    save.focus();
    flush();
    expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(hostHeight - 8);
    expect(content.querySelector('textarea')).toBe(note);
  });

  it.each([780, 600, 440])('does not subtract the keyboard again from a %ipx layout probe', (height) => {
    dispose = bindMoodModalViewport(modal, content);
    layoutHeight = height;
    hostHeight = 100;
    viewport.height = 440;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '340px');
    notifyHostResize();
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
  });

  it.each([780, 600, 440])('uses the keyboard baseline with a %ipx probe and unchanged VisualViewport', (height) => {
    dispose = bindMoodModalViewport(modal, content);
    layoutHeight = height;
    hostHeight = 100;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '340px');
    notifyHostResize();
    flush();
    expect(viewport.height).toBe(780);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
  });

  it('takes the intersection with a panned visual viewport instead of subtracting from its height', () => {
    dispose = bindMoodModalViewport(modal, content);
    viewport.height = 440;
    viewport.offsetTop = 40;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '340px');
    viewport.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-top')).toBe('40px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('400px');
  });

  it('does not depend on host geometry or dynamic host safe-area values', () => {
    const measureHost = vi.mocked(host.getBoundingClientRect);
    hostHeight = 45;
    viewport.height = 440;
    dom.window.document.documentElement.style.setProperty('--safe-area-inset-bottom', '340px');
    dispose = bindMoodModalViewport(modal, content);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
    expect(measureHost).not.toHaveBeenCalled();
  });

  it('uses the owning window when the independent probe has no measurable box', () => {
    layoutHeight = 0;
    layoutWidth = 0;
    Object.defineProperty(dom.window, 'visualViewport', { value: undefined });
    dispose = bindMoodModalViewport(modal, content);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('768px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-width')).toBe('1024px');
  });

  it.each(['-340px', 'NaN', 'calc(100vh - 440px)', '900px'])('ignores an unusable native keyboard value (%s)', (keyboard) => {
    dispose = bindMoodModalViewport(modal, content);
    dom.window.document.documentElement.style.setProperty('--keyboard-height', keyboard);
    viewport.height = 440;
    viewport.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
  });

  it('keeps the original baseline through repeated layout-resizing keyboard cycles', () => {
    dispose = bindMoodModalViewport(modal, content);
    for (let cycle = 0; cycle < 3; cycle++) {
      layoutHeight = 440;
      viewport.height = 440;
      dom.window.document.documentElement.style.setProperty('--keyboard-height', '340px');
      notifyHostResize();
      flush();
      expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
      // The native inset can clear before the WebView finishes expanding.
      dom.window.document.documentElement.style.setProperty('--keyboard-height', '0px');
      notifyHostResize();
      flush();
      layoutHeight = 780;
      viewport.height = 780;
      notifyHostResize();
      flush();
      expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('780px');
    }
  });

  it('keeps the keyboard-free baseline when the viewport resizes before the native inset arrives', () => {
    dispose = bindMoodModalViewport(modal, content);
    layoutHeight = 440;
    viewport.height = 440;
    viewport.dispatchEvent(new dom.window.Event('resize'));
    flush();
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '340px');
    notifyHostResize();
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
  });

  it('does not record a focused, already-shrunk viewport as a keyboard-free baseline', () => {
    const input = content.appendChild(dom.window.document.createElement('input'));
    input.focus();
    layoutHeight = 440;
    viewport.height = 440;
    dispose = bindMoodModalViewport(modal, content);
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '340px');
    notifyHostResize();
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
  });

  it('does not invent an unshrunk baseline when opened over an existing keyboard', () => {
    layoutHeight = 440;
    viewport.height = 440;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '340px');
    dispose = bindMoodModalViewport(modal, content);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
  });

  it('does not reuse a portrait baseline after rotating with the keyboard open', () => {
    dispose = bindMoodModalViewport(modal, content);
    layoutWidth = 844;
    layoutHeight = 190;
    Object.assign(viewport, { height: 190, width: 844 });
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '200px');
    dom.window.dispatchEvent(new dom.window.Event('orientationchange'));
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('190px');
  });

  it('learns a landscape baseline after closing the keyboard and uses it on the next opening', () => {
    dispose = bindMoodModalViewport(modal, content);
    layoutWidth = 844;
    layoutHeight = 190;
    Object.assign(viewport, { height: 190, width: 844 });
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '200px');
    dom.window.dispatchEvent(new dom.window.Event('orientationchange'));
    flush();
    layoutHeight = 390;
    viewport.height = 390;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '0px');
    notifyHostResize();
    flush();
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '200px');
    notifyHostResize();
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('190px');
  });

  it('does not reuse a baseline or leave a probe behind across modal close and reopen', () => {
    dispose = bindMoodModalViewport(modal, content);
    dispose();
    layoutHeight = 440;
    viewport.height = 440;
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '340px');
    dispose = bindMoodModalViewport(modal, content);
    expect(dom.window.document.querySelectorAll('.journal-mood-viewport-probe')).toHaveLength(1);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('440px');
  });

  it('does not scroll back to a field when a viewport pan changes the intersection height', () => {
    const input = content.appendChild(dom.window.document.createElement('input'));
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(bounds(90, 44));
    dispose = bindMoodModalViewport(modal, content);
    input.focus();
    flush();
    content.scrollTop = 120;
    viewport.offsetTop = 80;
    viewport.dispatchEvent(new dom.window.Event('scroll'));
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('700px');
    expect(content.scrollTop).toBe(120);
    viewport.dispatchEvent(new dom.window.Event('resize'));
    flush();
    expect(content.scrollTop).toBe(120);
  });

  it('defers viewport geometry for the touch that transfers focus to a lower field', () => {
    const upper = content.appendChild(dom.window.document.createElement('input'));
    const lower = content.appendChild(dom.window.document.createElement('textarea'));
    vi.spyOn(upper, 'getBoundingClientRect').mockReturnValue(bounds(90, 44));
    vi.spyOn(lower, 'getBoundingClientRect').mockImplementation(() => bounds(500 - content.scrollTop, 44));
    dispose = bindMoodModalViewport(modal, content);
    upper.focus();
    flush();
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('780px');

    content.dispatchEvent(new dom.window.Event('touchstart', { bubbles: true }));
    Object.assign(viewport, { height: 360, offsetTop: 80 });
    viewport.dispatchEvent(new dom.window.Event('resize'));
    lower.focus();
    content.dispatchEvent(new dom.window.Event('focusin', { bubbles: true }));
    expect(pending.size).toBe(0);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('780px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-top')).toBe('0px');

    dom.window.document.dispatchEvent(new dom.window.Event('touchend', { bubbles: true }));
    expect(pending.size).toBe(1);
    flush();
    expect(dom.window.document.activeElement).toBe(lower);
    expect(modal.style.getPropertyValue('--journal-mood-viewport-height')).toBe('360px');
    expect(modal.style.getPropertyValue('--journal-mood-viewport-top')).toBe('80px');
    expect(content.scrollTop).toBeGreaterThan(0);
  });

  it('uses a noninteractive isolated probe and removes it on dispose', () => {
    dispose = bindMoodModalViewport(modal, content);
    const probe = dom.window.document.querySelector<HTMLElement>('.journal-mood-viewport-probe')!;
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const start = styles.indexOf('.journal-mood-viewport-probe {');
    const rule = styles.slice(start, styles.indexOf('}', start) + 1);
    expect(probe).not.toBeNull();
    expect(probe.parentElement).toBe(dom.window.document.body);
    expect(start).toBeGreaterThan(-1);
    expect(rule).toContain('height: 100vh;');
    expect(rule).toContain('position: fixed;');
    expect(rule).toContain('pointer-events: none;');
    expect(probe.style.cssText).toBe('');
    expect(probe.getAttribute('aria-hidden')).toBe('true');
    dispose();
    expect(probe.isConnected).toBe(false);
  });

  it('removes listeners, classes, dimensions and pending work on close', () => {
    const removeViewport = vi.spyOn(viewport, 'removeEventListener');
    const removeWindow = vi.spyOn(dom.window, 'removeEventListener');
    const removeContent = vi.spyOn(content, 'removeEventListener');
    const removeDocument = vi.spyOn(dom.window.document, 'removeEventListener');
    dispose = bindMoodModalViewport(modal, content);
    viewport.dispatchEvent(new dom.window.Event('resize'));
    expect(pending.size).toBe(1);
    dispose();
    expect(pending.size).toBe(0);
    expect(disconnectHostResize).toHaveBeenCalled();
    expect(modal.style.length).toBe(0);
    expect(modal.className).toBe('');
    expect(removeViewport.mock.calls.map(([type]) => type)).toEqual(['resize', 'scroll']);
    expect(removeWindow.mock.calls.map(([type]) => type)).toContain('resize');
    expect(removeContent.mock.calls.map(([type]) => type)).toEqual(['focusin', 'focusout', 'touchstart']);
    expect(removeDocument.mock.calls.map(([type]) => type)).toEqual(['touchend', 'touchcancel']);
    viewport.dispatchEvent(new dom.window.Event('resize'));
    viewport.dispatchEvent(new dom.window.Event('scroll'));
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    content.dispatchEvent(new dom.window.Event('focusin'));
    content.dispatchEvent(new dom.window.Event('focusout'));
    content.dispatchEvent(new dom.window.Event('touchstart'));
    dom.window.document.dispatchEvent(new dom.window.Event('touchend'));
    expect(pending.size).toBe(0);
  });

  it('disconnects native mutation observers and ignores late resize callbacks after close', async () => {
    dispose = bindMoodModalViewport(modal, content);
    dispose();
    dom.window.document.documentElement.style.setProperty('--keyboard-height', '430px');
    host.style.height = '350px';
    await Promise.resolve();
    notifyHostResize();
    expect(pending.size).toBe(0);
    expect(modal.style.length).toBe(0);
  });

  it.each(['', 'dayline-mobile'])('leaves desktop and tablet layout unchanged (%s)', (classes) => {
    dom.window.document.body.className = classes;
    const listen = vi.spyOn(viewport, 'addEventListener');
    dispose = bindMoodModalViewport(modal, content);
    expect(modal.style.length).toBe(0);
    expect(modal.className).toBe('');
    expect(listen).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });
});
