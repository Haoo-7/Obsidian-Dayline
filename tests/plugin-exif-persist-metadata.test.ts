// @ts-nocheck
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as calendarDisplay from '../src/calendar-display';
import * as dateUtils from '../src/date-utils';
import * as i18n from '../src/i18n';
import * as mediaLinks from '../src/media-links';
import * as onThisDayEntry from '../src/on-this-day-entry';
import * as viewVisibility from '../src/view-visibility-controller';
import * as pluginIdentity from '../src/plugin-identity';
import * as weatherCache from '../src/weather-cache';

/* ------------------------------------------------------------------------ *
 * Minimal Obsidian harness (same pattern as tests/dayline-mobile.test.ts):
 * src/plugin.ts is CommonJS + TypeScript, so it is transpiled and evaluated
 * with a stub `require` that supplies the pure modules and a fake host.
 * ------------------------------------------------------------------------ */

class HarnessPlugin {}
class HarnessItemView {}
class HarnessTFile {
  constructor(path: string) {
    this.path = path;
  }
  get name() { return this.path.split('/').pop() as string; }
  get extension() { return this.path.split('.').pop() as string; }
}
class HarnessModal {}
class HarnessMenu {}
class HarnessNotice {}

const obsidianStub = {
  Plugin: HarnessPlugin,
  ItemView: HarnessItemView,
  TFile: HarnessTFile,
  Modal: HarnessModal,
  Menu: HarnessMenu,
  Notice: HarnessNotice,
  setIcon: () => undefined,
  Platform: { isMobile: false, isPhone: false },
  normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/{2,}/g, '/'),
};

function loadPluginClass(): any {
  const source = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} as { default?: unknown } };
  const requireStub = (id: string) => {
    if (id === 'obsidian') return obsidianStub;
    if (id === './i18n') return i18n;
    if (id === './date-utils') return dateUtils;
    if (id === './media-links') return mediaLinks;
    if (id === './calendar-display') return calendarDisplay;
    if (id === './on-this-day-entry') return onThisDayEntry;
    if (id === './view-visibility-controller') return viewVisibility;
    if (id === './plugin-identity') return pluginIdentity;
    if (id === './weather-cache') return weatherCache;
    if (id.endsWith('?raw')) return '';
    return {};
  };
  const evaluate = new Function('require', 'module', 'exports', outputText);
  evaluate(requireStub, module, module.exports);
  return module.exports.default;
}

let cachedPluginClass: any = null;
function PluginClass(): any {
  if (!cachedPluginClass) cachedPluginClass = loadPluginClass();
  return cachedPluginClass;
}

/* ------------------------------------------------------------------------ *
 * Fake vault: one journal note plus one embedded image.
 * ------------------------------------------------------------------------ */

function createHost() {
  const notes = new Map<string, any>();
  const images = new Map<string, any>();
  const writes: string[] = [];
  const changedHandlers: Array<(file: unknown, data: string, cache: unknown) => void> = [];

  function getFileCache(file: any) {
    const note = notes.get(file.path);
    return note ? { frontmatter: note.frontmatter, embeds: note.embeds } : null;
  }

  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => notes.get(path)?.file ?? images.get(path)?.file ?? null,
      adapter: {
        stat: async (path: string) => {
          const image = images.get(path);
          return image ? { mtime: image.mtime, size: image.size } : null;
        },
      },
    },
    metadataCache: {
      getFileCache,
      getFirstLinkpathDest: (link: string) => images.get(link)?.file ?? null,
      on: (_event: string, handler: (file: unknown, data: string, cache: unknown) => void) => {
        changedHandlers.push(handler);
        return { handler };
      },
    },
    fileManager: {
      processFrontMatter: async (file: any, mutate: (frontmatter: any) => void) => {
        const note = notes.get(file.path);
        writes.push(file.path);
        mutate(note.frontmatter);
        // Obsidian re-parses the note after a frontmatter write, which fires
        // `changed` again. Reproduce that here so a non-idempotent sync would
        // visibly loop instead of quietly passing.
        for (const handler of [...changedHandlers]) handler(file, '', getFileCache(file));
      },
    },
  };

  return { app, notes, images, writes, changedHandlers };
}

function addNote(host: any, path: string, embeds: string[]) {
  const file = new HarnessTFile(path);
  const note = { file, frontmatter: {}, embeds: embeds.map((link) => ({ link })) };
  host.notes.set(path, note);
  return note;
}

function addImage(host: any, link: string, fields: any[], mtime = 100, size = 200) {
  const file = new HarnessTFile(link);
  const image = { file, fields, mtime, size };
  host.images.set(link, image);
  return image;
}

function makePlugin(host: any, settings: Record<string, unknown> = {}) {
  const plugin: any = Object.create(PluginClass().prototype);
  plugin.app = host.app;
  plugin.settings = { dailyFolder: 'Daily', ...settings };
  plugin.journalIndex = { isReady: true, resolveSources: () => [{ path: 'Daily' }] };
  plugin.exifCache = { get: vi.fn(async (file: any) => host.images.get(file.path)?.fields ?? []) };
  plugin.geocoder = null;
  plugin._exifPersistInFlight = new Map();
  plugin._exifPersistPending = new Set();
  return plugin;
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

afterEach(() => {
  cachedPluginClass = null;
});

describe('EXIF insert-time persistence (P-10)', () => {
  it('writes nothing while the setting is off', async () => {
    const host = createHost();
    const note = addNote(host, 'Daily/2026-08-05.md', ['photo.jpg']);
    addImage(host, 'photo.jpg', [{ key: 'exif_camera', value: 'X' }, { key: 'exif_gps', value: '48.8566, 2.3522' }]);
    const plugin = makePlugin(host, { exifPersistMetadata: false });

    await plugin._syncJournalEmbedExif(note.file, host.app.metadataCache.getFileCache(note.file));
    await flush();

    expect(host.writes).toEqual([]);
    expect(note.frontmatter._dayline_media_metadata).toBeUndefined();
    expect(note.frontmatter.latitude).toBeUndefined();
  });

  it('records one new image and its top-level coordinates', async () => {
    const host = createHost();
    const note = addNote(host, 'Daily/2026-08-05.md', ['photo.jpg']);
    addImage(host, 'photo.jpg', [
      { key: 'exif_camera', value: 'X' },
      { key: 'exif_gps', value: '48.8566, 2.3522' },
    ]);
    const plugin = makePlugin(host, { exifPersistMetadata: true });

    await plugin._syncJournalEmbedExif(note.file, host.app.metadataCache.getFileCache(note.file));
    await flush();

    const records = note.frontmatter._dayline_media_metadata;
    expect(records).toHaveLength(1);
    expect(records[0].normalizedLink).toBe('photo.jpg');
    expect(records[0].mtime).toBe(100);
    expect(records[0].size).toBe(200);
    expect(records[0].fields).toEqual([
      { key: 'exif_camera', value: 'X' },
      { key: 'exif_gps', value: '48.8566, 2.3522' },
    ]);
    expect(note.frontmatter.latitude).toBeCloseTo(48.8566);
    expect(note.frontmatter.longitude).toBeCloseTo(2.3522);
    expect(host.writes).toEqual(['Daily/2026-08-05.md']);
  });

  it('is idempotent: a second sync writes nothing and the write cannot loop', async () => {
    const host = createHost();
    const note = addNote(host, 'Daily/2026-08-05.md', ['photo.jpg']);
    addImage(host, 'photo.jpg', [{ key: 'exif_gps', value: '48.8566, 2.3522' }]);
    const plugin = makePlugin(host, { exifPersistMetadata: true });
    const cache = host.app.metadataCache.getFileCache(note.file);

    await plugin._syncJournalEmbedExif(note.file, cache);
    await flush();
    expect(host.writes).toHaveLength(1);

    // The frontmatter write above already re-fired `changed` into
    // `_syncJournalEmbedExif` while the first run was in flight. That coalesced
    // rerun (plus any further event) must observe a current record and stop —
    // without even re-reading the EXIF.
    plugin.exifCache.get.mockClear();
    await plugin._syncJournalEmbedExif(note.file, cache);
    await plugin._syncJournalEmbedExif(note.file, cache);
    await flush();

    expect(host.writes).toHaveLength(1);
    expect(plugin.exifCache.get).not.toHaveBeenCalled();
    expect(note.frontmatter._dayline_media_metadata).toHaveLength(1);
  });

  it('re-reads EXIF when the file version changed', async () => {
    const host = createHost();
    const note = addNote(host, 'Daily/2026-08-05.md', ['photo.jpg']);
    const image = addImage(host, 'photo.jpg', [{ key: 'exif_camera', value: 'X' }]);
    const plugin = makePlugin(host, { exifPersistMetadata: true });
    const cache = host.app.metadataCache.getFileCache(note.file);

    await plugin._syncJournalEmbedExif(note.file, cache);
    await flush();
    expect(host.writes).toHaveLength(1);

    image.mtime = 300;
    image.size = 400;
    plugin.exifCache.get.mockClear();
    await plugin._syncJournalEmbedExif(note.file, cache);
    await flush();

    expect(plugin.exifCache.get).toHaveBeenCalledTimes(1);
    const record = note.frontmatter._dayline_media_metadata[0];
    expect(record.mtime).toBe(300);
    expect(record.size).toBe(400);
    expect(host.writes).toHaveLength(2);
  });
});

describe('EXIF copy safety (W-02/W-14)', () => {
  it('never replaces the exif_gps coordinate with the resolved place name', async () => {
    const host = createHost();
    const note = addNote(host, 'Daily/2026-08-05.md', ['photo.jpg']);
    const sharedFields = [
      { key: 'exif_camera', value: 'X' },
      { key: 'exif_gps', value: '48.8566, 2.3522' },
    ];
    addImage(host, 'photo.jpg', sharedFields);
    const plugin = makePlugin(host, { exifPersistMetadata: true, exifReverseGeocode: true });
    plugin.geocoder = { lookup: async () => 'Paris' };
    const cache = host.app.metadataCache.getFileCache(note.file);

    await plugin._syncJournalEmbedExif(note.file, cache);
    await flush();

    const record = note.frontmatter._dayline_media_metadata[0];
    expect(record.fields.find((field: any) => field.key === 'exif_gps').value).toBe('48.8566, 2.3522');
    expect(record.fields.find((field: any) => field.key === 'exif_place').value).toBe('Paris');
    // The exifCache array is shared state: neither it nor its field objects may
    // be the ones written to frontmatter, and it must not have gained a place.
    expect(record.fields).not.toBe(sharedFields);
    expect(record.fields[0]).not.toBe(sharedFields[0]);
    expect(sharedFields.some((field) => field.key === 'exif_place')).toBe(false);
    expect(sharedFields.find((field: any) => field.key === 'exif_gps').value).toBe('48.8566, 2.3522');
  });

  it('returns copies of a stored record and never mutates the cached frontmatter', async () => {
    const host = createHost();
    const note = addNote(host, 'Daily/2026-08-05.md', ['photo.jpg']);
    const image = addImage(host, 'photo.jpg', [{ key: 'exif_gps', value: '1.0000, 2.0000' }]);
    const stored = [{ key: 'exif_gps', value: '1.0000, 2.0000' }];
    note.frontmatter._dayline_media_metadata = [{ normalizedLink: 'photo.jpg', fields: stored, mtime: 100, size: 200 }];
    const plugin = makePlugin(host, { exifPersistMetadata: true });

    const fields = await plugin._getPersistedExifFields(image.file, note.file.path, 'photo.jpg');

    expect(fields).toEqual(stored);
    expect(fields).not.toBe(stored);
    expect(fields[0]).not.toBe(stored[0]);

    fields[0].value = 'mutated';
    expect(stored[0].value).toBe('1.0000, 2.0000');
  });

  it('handles a rejected frontmatter write without an unhandled rejection', async () => {
    const host = createHost();
    const note = addNote(host, 'Daily/2026-08-05.md', ['photo.jpg']);
    const image = addImage(host, 'photo.jpg', [{ key: 'exif_camera', value: 'X' }]);
    const plugin = makePlugin(host, { exifPersistMetadata: true });
    host.app.fileManager.processFrontMatter = async () => {
      throw new Error('invalid yaml');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(plugin._getPersistedExifFields(image.file, note.file.path, 'photo.jpg'))
        .resolves.toEqual([{ key: 'exif_camera', value: 'X' }]);
      expect(warn).toHaveBeenCalledWith(
        '[Dayline] EXIF frontmatter persist failed:',
        note.file.path,
        'invalid yaml',
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('exifPersistMetadata default (P-10)', () => {
  it('is off for a fresh install and honours an explicit value', async () => {
    const host = createHost();
    const fresh: any = Object.create(PluginClass().prototype);
    fresh.app = host.app;
    fresh.loadData = async () => null;
    await fresh.loadSettings();
    expect(fresh.settings.exifPersistMetadata).toBe(false);

    const existing: any = Object.create(PluginClass().prototype);
    existing.app = host.app;
    existing.loadData = async () => ({ exifPersistMetadata: true });
    await existing.loadSettings();
    expect(existing.settings.exifPersistMetadata).toBe(true);
  });
});
