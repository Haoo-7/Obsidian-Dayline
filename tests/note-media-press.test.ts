// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOTE_MEDIA_LONG_PRESS_MS,
  bindNoteMediaLongPress,
  isInsideEditorContentDom,
  shouldUseNoteMediaLongPress,
} from '../src/note-media-press';

function pointerEvent(type: string, init: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  Object.assign(event, { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 }, init);
  return event;
}

function photoLine() {
  const content = document.createElement('div');
  content.className = 'cm-content';
  const line = document.createElement('div');
  line.className = 'cm-line';
  const embed = document.createElement('span');
  embed.className = 'internal-embed';
  line.append(embed);
  content.append(document.createElement('div'), line);
  document.body.append(content);
  return { content, line, embed };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('note media press routing', () => {
  it('recognises the DOM that CodeMirror owns', () => {
    const { embed, line } = photoLine();
    const reading = document.createElement('div');
    reading.className = 'markdown-reading-view';
    const readingEmbed = document.createElement('span');
    readingEmbed.className = 'internal-embed';
    reading.append(readingEmbed);
    document.body.append(reading);

    expect(isInsideEditorContentDom(embed)).toBe(true);
    expect(isInsideEditorContentDom(line)).toBe(true);
    expect(isInsideEditorContentDom(readingEmbed)).toBe(false);
    expect(isInsideEditorContentDom(null)).toBe(false);
  });

  it('long-presses only where an injected control would fight the editor', () => {
    const { embed } = photoLine();
    const readingEmbed = document.createElement('span');

    expect(shouldUseNoteMediaLongPress(embed, true)).toBe(true);
    expect(shouldUseNoteMediaLongPress(embed, false)).toBe(false);
    expect(shouldUseNoteMediaLongPress(readingEmbed, true)).toBe(false);
  });
});

describe('note media long press', () => {
  it('opens the metadata on a hold and fires once', () => {
    vi.useFakeTimers();
    const { embed } = photoLine();
    const onOpen = vi.fn();
    const dispose = bindNoteMediaLongPress(embed, onOpen);

    embed.dispatchEvent(pointerEvent('pointerdown'));
    expect(onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS);
    expect(onOpen).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS * 3);
    expect(onOpen).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('leaves a tap to the editor instead of opening metadata', () => {
    vi.useFakeTimers();
    const { embed } = photoLine();
    const onOpen = vi.fn();
    const dispose = bindNoteMediaLongPress(embed, onOpen);
    const down = pointerEvent('pointerdown');
    const up = pointerEvent('pointerup');

    embed.dispatchEvent(down);
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS - 100);
    embed.dispatchEvent(up);
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS);

    expect(onOpen).not.toHaveBeenCalled();
    // The gesture never claims the pointer, so the caret still lands.
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);

    dispose();
  });

  it('cancels when the finger moves, which is the page scrolling', () => {
    vi.useFakeTimers();
    const { embed } = photoLine();
    const onOpen = vi.fn();
    const dispose = bindNoteMediaLongPress(embed, onOpen);

    embed.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    embed.dispatchEvent(pointerEvent('pointermove', { clientX: 40, clientY: 12 }));
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS);

    expect(onOpen).not.toHaveBeenCalled();

    dispose();
  });

  it('stays quiet within the movement tolerance', () => {
    vi.useFakeTimers();
    const { embed } = photoLine();
    const onOpen = vi.fn();
    const dispose = bindNoteMediaLongPress(embed, onOpen);

    embed.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    embed.dispatchEvent(pointerEvent('pointermove', { clientX: 16, clientY: 13 }));
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS);

    expect(onOpen).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('ignores secondary pointers and cancels on pointercancel', () => {
    vi.useFakeTimers();
    const { embed } = photoLine();
    const onOpen = vi.fn();
    const dispose = bindNoteMediaLongPress(embed, onOpen);

    embed.dispatchEvent(pointerEvent('pointerdown', { isPrimary: false }));
    embed.dispatchEvent(pointerEvent('pointerdown', { button: 2 }));
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS);
    expect(onOpen).not.toHaveBeenCalled();

    embed.dispatchEvent(pointerEvent('pointerdown'));
    embed.dispatchEvent(pointerEvent('pointercancel'));
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS);
    expect(onOpen).not.toHaveBeenCalled();

    dispose();
  });

  it('releases every listener when the handle is disposed', () => {
    vi.useFakeTimers();
    const { embed } = photoLine();
    const onOpen = vi.fn();
    const dispose = bindNoteMediaLongPress(embed, onOpen);

    dispose();
    embed.dispatchEvent(pointerEvent('pointerdown'));
    vi.advanceTimersByTime(NOTE_MEDIA_LONG_PRESS_MS);

    expect(onOpen).not.toHaveBeenCalled();
  });
});
