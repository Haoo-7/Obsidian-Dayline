// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  ItemView: class {}, TFile, console, setTimeout, clearTimeout, window,
  OVERLAY_ATTR: 'data-cal-weather-overlay',
  validateWeatherCoordinates: () => true,
  _l: (_language: string, key: string) => key,
  _iconUrl: () => '', setIcon: () => {}, requestAnimationFrame: (callback: () => void) => callback(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(getSnapshot: (date: string) => Promise<any>) {
  const file = new TFile('Calendar/Daily/2026-09-01.md');
  const other = new TFile('Calendar/Daily/2026-09-02.md');
  const container = element();
  document.body.append(container);
  const leaf = { view: { file }, containerEl: container };
  const view = Object.create(CalendarView.prototype);
  Object.assign(view, {
    closed: false,
    plugin: {
      settings: { weatherEnabled: true, weatherLatitude: 31, weatherLongitude: 121 },
      capabilities: { isMobile: true },
      journalIndex: { getEntries: () => [file, other].map((item) => ({ path: item.path, date: item.name.slice(0, -3) })) },
      _endExifHover() {}, _syncDaylineRibbon() {}, _restoreHostPosition() {},
    },
    app: { workspace: { getLeavesOfType: () => [leaf] }, metadataCache: { getFileCache: () => ({}) } },
    contentEl: element(), containerEl: element(),
    _overlayInFlight: new WeakMap(), _overlayVersions: new WeakMap(), _overlayDates: new WeakMap(),
    _overlayContainers: new Set(), _hostPositionMarkers: new Set(),
    _scheduleExifNoteAttach() {}, _ensureHostPosition() {},
    weather: { getCachedSnapshot: () => null, getSnapshot, isSnapshotCompatible: () => true },
  });
  return { view, leaf, file, other, container };
}

async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

afterEach(() => document.body.replaceChildren());

describe('weather overlay request lifecycle', () => {
  it('mounts the mobile weather chip below the view header', async () => {
    const { view, container } = fixture(async () => ({ icon: 'sun.svg', temperature: 25, units: 'metric' }));
    const header = element('div', { cls: 'view-header' });
    container.append(header);
    container.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 390, width: 390, height: 400 });
    header.getBoundingClientRect = () => ({ top: 0, bottom: 96, left: 0, right: 390, width: 390, height: 96 });
    view._syncNoteOverlays();
    await settle();
    const overlay = container.querySelector('[data-cal-weather-overlay]');
    expect(overlay?.parentElement).toBe(container);
    expect(overlay?.style.top).toBe('104px');
  });

  it('keeps the desktop overlay placement unchanged', async () => {
    const { view, container } = fixture(async () => ({ icon: 'sun.svg', temperature: 25, units: 'metric' }));
    view.plugin.capabilities.isMobile = false;
    view._syncNoteOverlays();
    await settle();
    const overlay = container.querySelector('[data-cal-weather-overlay]');
    expect(overlay?.parentElement).toBe(container);
  });

  it('treats no weather as a terminal result until another sync is requested', async () => {
    const blocked = deferred<null>();
    const getSnapshot = vi.fn().mockResolvedValueOnce(null).mockImplementation(() => blocked.promise);
    const { view } = fixture(getSnapshot);
    view._syncNoteOverlays();
    await settle();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    view._syncNoteOverlays();
    await settle();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('loads the new leaf file after a superseded request returns empty', async () => {
    const first = deferred<null>();
    const blocked = deferred<null>();
    const getSnapshot = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(() => blocked.promise);
    const { view, leaf, other } = fixture(getSnapshot);
    view._syncNoteOverlays();
    leaf.view.file = other;
    view._syncNoteOverlays();
    first.resolve(null);
    await settle();
    expect(getSnapshot.mock.calls.map(([date]) => date)).toEqual(['2026-09-01', '2026-09-02']);
  });

  it('does not mount a late response after the calendar closes', async () => {
    const pending = deferred<any>();
    const { view, container } = fixture(() => pending.promise);
    view._syncNoteOverlays();
    view.onClose();
    pending.resolve({ icon: 'sun.svg', temperature: 25, units: 'metric' });
    await settle();
    expect(container.querySelector('[data-cal-weather-overlay]')).toBeNull();
  });

  it('discards old weather and loads a changed date on the same file', async () => {
    const first = deferred<any>();
    const blocked = deferred<null>();
    const getSnapshot = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(() => blocked.promise);
    const { view, file, container } = fixture(getSnapshot);
    view._syncNoteOverlays();
    view.plugin.journalIndex.getEntries = () => [{ path: file.path, date: '2026-09-03' }];
    view._syncNoteOverlays();
    first.resolve({ icon: 'sun.svg', temperature: 25, units: 'metric' });
    await settle();
    expect(container.querySelector('[data-cal-weather-overlay]')).toBeNull();
    expect(getSnapshot.mock.calls.map(([date]) => date)).toEqual(['2026-09-01', '2026-09-03']);
  });

  it('revalidates after settings invalidate an in-flight empty result', async () => {
    const first = deferred<null>();
    const blocked = deferred<null>();
    const getSnapshot = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(() => blocked.promise);
    const { view } = fixture(getSnapshot);
    view._syncNoteOverlays();
    view._invalidateOverlayRequests();
    view._syncNoteOverlays();
    first.resolve(null);
    await settle();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('discards responses from before a closed view is reopened', async () => {
    const first = deferred<any>();
    const blocked = deferred<null>();
    const getSnapshot = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(() => blocked.promise);
    const { view, container } = fixture(getSnapshot);
    view._syncNoteOverlays();
    view.onClose();
    view.closed = false;
    view._syncNoteOverlays();
    first.resolve({ icon: 'sun.svg', temperature: 25, units: 'metric' });
    await settle();
    expect(container.querySelector('[data-cal-weather-overlay]')).toBeNull();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not start new work after the calendar closes', async () => {
    const getSnapshot = vi.fn().mockResolvedValue(null);
    const { view } = fixture(getSnapshot);
    view.onClose();
    view._syncNoteOverlays();
    // End a faulty old loop without relying on timers getting a turn.
    view.plugin.settings.weatherEnabled = false;
    await settle();
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});
