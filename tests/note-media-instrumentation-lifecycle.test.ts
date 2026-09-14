// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMediaControlOwner, shouldAddMediaInfoControl } from '../src/media-interaction';
import { MEDIA_EXTENSIONS, IMAGE_EXTENSIONS as MEDIA_IMAGE_EXTENSIONS, classifyMediaLink, normalizeMediaLink } from '../src/media-links';

// Execute the actual view class without booting Obsidian or loading optional codecs.
const source = ts.createSourceFile('plugin.ts', readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'CalendarView');
if (!declaration) throw new Error('CalendarView declaration was not found');

class TFile {
  constructor(public path: string) {}
  get name() { return this.path.split('/').pop()!; }
}

function element(tag = 'div', options: any = {}): any {
  const node: any = document.createElement(tag);
  if (options.cls) node.className = options.cls;
  for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, String(value));
  node.createEl = (name: string, attrs: any) => node.appendChild(element(name, attrs));
  node.createDiv = (attrs: any) => node.createEl('div', attrs);
  node.setText = (value: string) => { node.textContent = value; };
  node.addClass = (value: string) => node.classList.add(value);
  node.removeClass = (value: string) => node.classList.remove(value);
  return node;
}

const CalendarView = runInNewContext(ts.transpileModule(`${declaration.getText()}; CalendarView;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, {
  ItemView: class {}, TFile, console, setTimeout, clearTimeout, document,
  t: (_settings: unknown, key: string) => key,
  setIcon: () => {},
  getMediaControlOwner, shouldAddMediaInfoControl,
  normalizeMediaLink, classifyMediaLink, MEDIA_EXTENSIONS, MEDIA_IMAGE_EXTENSIONS,
  HEIC_EXTS: ['heic', 'heif'],
  hasExistingImage: () => false,
});

function probeListeners(node: HTMLElement) {
  const counts = new Map<string, number>();
  const originalAdd = node.addEventListener.bind(node);
  const originalRemove = node.removeEventListener.bind(node);
  node.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    counts.set(type, (counts.get(type) || 0) + 1);
    return originalAdd(type, listener, options);
  }) as typeof node.addEventListener;
  node.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    counts.set(type, Math.max(0, (counts.get(type) || 0) - 1));
    return originalRemove(type, listener, options);
  }) as typeof node.removeEventListener;
  return {
    count(type: string) {
      return counts.get(type) || 0;
    },
  };
}

function fixture() {
  const note = element();
  const embed = element('span', { cls: 'internal-embed', attr: { src: 'photo.jpg', 'aria-label': 'existing-embed' } });
  const img = element('img', { attr: { src: 'photo.jpg' } });
  embed.append(img);
  note.append(embed);
  document.body.append(note);
  const imgListeners = probeListeners(img);
  const embedListeners = probeListeners(embed);

  function createView() {
    const view = Object.create(CalendarView.prototype);
    Object.assign(view, {
      closed: false,
      plugin: {
        settings: { showExif: true },
        capabilities: { coarsePointer: true, isMobile: false },
        _endExifHover() {},
        _syncDaylineRibbon() {},
      },
      app: { workspace: { getLeavesOfType: () => [] } },
      contentEl: element(),
      containerEl: element(),
      _exifNoteImages: new WeakSet(),
      _exifNoteMediaControls: new WeakSet(),
      _exifNoteDisposers: new Set(),
      _overlayContainers: new Set(),
      _hostPositionMarkers: new Set(),
      _calendarKeydownHandler: null,
      _unsubscribeIndex: null,
      _refreshTimer: null,
      _exifNoteTimer: null,
      _overlayGeneration: 0,
      _fetchToken: 0,
    });
    return view;
  }

  function instrument(view: any) {
    view._processImageEls([img]);
    view._processEmbedEls([embed]);
  }

  return { note, embed, img, imgListeners, embedListeners, createView, instrument };
}

afterEach(() => document.body.replaceChildren());

describe('note media instrumentation lifecycle', () => {
  it('instruments one embed plus one image and inserts a single info button', () => {
    const { embed, img, imgListeners, embedListeners, createView, instrument } = fixture();
    const view = createView();
    instrument(view);

    expect(document.querySelectorAll('.dayline-note-media-info')).toHaveLength(1);
    expect(img.tabIndex).toBe(0);
    expect(embed.tabIndex).toBe(0);
    expect(img.getAttribute('aria-label')).toBe('mediaMetadata');
    expect(embed.getAttribute('aria-label')).toBe('mediaMetadata');
    expect(imgListeners.count('mouseenter')).toBe(1);
    expect(imgListeners.count('mouseleave')).toBe(1);
    expect(imgListeners.count('focusin')).toBe(1);
    expect(embedListeners.count('mouseenter')).toBe(1);
    expect(embedListeners.count('mouseleave')).toBe(1);
    expect(embedListeners.count('focusin')).toBe(1);
  });

  it('removes the first view listeners and keeps a single info button after reopen', () => {
    const { embed, img, imgListeners, embedListeners, createView, instrument } = fixture();
    const first = createView();
    instrument(first);
    expect(document.querySelectorAll('.dayline-note-media-info')).toHaveLength(1);

    first._onNoteImageEnter = vi.fn();
    first._onNoteMediaEnter = vi.fn();
    first._onExifLeave = vi.fn();
    first.onClose();

    expect(document.querySelectorAll('.dayline-note-media-info')).toHaveLength(0);
    expect(imgListeners.count('mouseenter')).toBe(0);
    expect(imgListeners.count('mouseleave')).toBe(0);
    expect(imgListeners.count('focusin')).toBe(0);
    expect(embedListeners.count('mouseenter')).toBe(0);
    expect(embedListeners.count('mouseleave')).toBe(0);
    expect(embedListeners.count('focusin')).toBe(0);
    expect(img.hasAttribute('tabindex')).toBe(false);
    expect(img.hasAttribute('aria-label')).toBe(false);
    expect(embed.hasAttribute('tabindex')).toBe(false);
    expect(embed.getAttribute('aria-label')).toBe('existing-embed');

    img.dispatchEvent(new Event('mouseenter'));
    embed.dispatchEvent(new Event('mouseenter'));
    expect(first._onNoteImageEnter).not.toHaveBeenCalled();
    expect(first._onNoteMediaEnter).not.toHaveBeenCalled();

    const second = createView();
    instrument(second);

    expect(document.querySelectorAll('.dayline-note-media-info')).toHaveLength(1);
    expect(imgListeners.count('mouseenter')).toBe(1);
    expect(embedListeners.count('mouseenter')).toBe(1);
    expect(img.getAttribute('aria-label')).toBe('mediaMetadata');
    expect(embed.getAttribute('aria-label')).toBe('mediaMetadata');
  });
});
