// @ts-nocheck
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as calendarDisplay from '../src/calendar-display';
import * as dateUtils from '../src/date-utils';
import * as i18n from '../src/i18n';
import * as mediaLinks from '../src/media-links';
import * as onThisDayEntry from '../src/on-this-day-entry';
import * as viewVisibility from '../src/view-visibility-controller';
import * as weatherCache from '../src/weather-cache';
import { subscribeJournalMetadataRefresh } from '../src/journal-metadata-refresh';

/* ------------------------------------------------------------------------ *
 * Minimal Obsidian harness (same pattern as tests/dayline-mobile.test.ts):
 * src/plugin.ts is CommonJS + TypeScript, so it is transpiled and evaluated
 * with a stub `require` that supplies the pure modules and a fake host.
 * ------------------------------------------------------------------------ */

const noticeMessages: string[] = [];

class HarnessPlugin {}
class HarnessItemView {}
class HarnessTFile {
  constructor(path: string) {
    this.path = path;
    this.extension = String(path).split('.').pop();
  }
  get name() { return String(this.path).split('/').pop(); }
}
class HarnessModal {}
class HarnessMenu {}
class HarnessNotice {
  constructor(message: unknown) {
    noticeMessages.push(String(message));
  }
}

const obsidianStub = {
  Plugin: HarnessPlugin,
  ItemView: HarnessItemView,
  TFile: HarnessTFile,
  Modal: HarnessModal,
  Menu: HarnessMenu,
  Notice: HarnessNotice,
  setIcon: () => undefined,
  Platform: { isMobile: false, isPhone: false, isDesktop: true },
  normalizePath: (path: string) => String(path).replace(/\\/g, '/').replace(/\/{2,}/g, '/'),
};

let transpiledPluginSource: string | null = null;
function pluginModuleSource(): string {
  if (transpiledPluginSource === null) {
    const source = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
    transpiledPluginSource = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
  }
  return transpiledPluginSource;
}

function loadPluginClass(overrides: Record<string, unknown> = {}): any {
  const module = { exports: {} as { default?: unknown } };
  const requireStub = (id: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
    if (id === 'obsidian') return obsidianStub;
    if (id === './i18n') return i18n;
    if (id === './date-utils') return dateUtils;
    if (id === './media-links') return mediaLinks;
    if (id === './calendar-display') return calendarDisplay;
    if (id === './on-this-day-entry') return onThisDayEntry;
    if (id === './view-visibility-controller') return viewVisibility;
    if (id === './weather-cache') return weatherCache;
    if (id.endsWith('?raw')) return '';
    return {};
  };
  const evaluate = new Function('require', 'module', 'exports', pluginModuleSource());
  evaluate(requireStub, module, module.exports);
  return module.exports.default;
}

function makePlugin(overrides: Record<string, unknown> = {}, settings: Record<string, unknown> = {}): any {
  const plugin: any = Object.create(loadPluginClass(overrides).prototype);
  plugin.settings = { dailyFolder: 'Daily', ...settings };
  plugin.app = { workspace: { getLeavesOfType: () => [] } };
  return plugin;
}

async function flush() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  noticeMessages.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as any).moment;
});

/* ------------------------------------------------------------------------ *
 * P-13: daily-note template tokens and concurrent creation
 * ------------------------------------------------------------------------ */

function templateHost() {
  const templatePath = 'Templates/Daily.md';
  const templateFile = new HarnessTFile(templatePath);
  templateFile.content = 'date={{date}} title={{title}} month={{date:YYYY/MM}} time={{time:HH:mm}}';
  const files = new Map<string, any>([[templatePath, templateFile]]);
  const created = new Map<string, string>();

  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) || null,
      createFolder: vi.fn(async () => undefined),
      read: vi.fn(async (file: any) => file.content),
      create: vi.fn(async (path: string, content: string) => {
        if (files.has(path)) throw new Error('File already exists.');
        const file = new HarnessTFile(path);
        file.content = content;
        files.set(path, file);
        created.set(path, content);
        return file;
      }),
    },
    internalPlugins: { getPluginById: () => ({ instance: { options: { template: templatePath } } }) },
    plugins: { getPlugin: () => null },
  };
  return { app, created, files };
}

function installFakeMoment() {
  (window as any).moment = vi.fn((input?: string, format?: string) => {
    const date = typeof input === 'string'
      ? new Date(`${input}T12:00:00`)
      : new Date('2026-08-05T09:30:00');
    return {
      isValid: () => !Number.isNaN(date.getTime()),
      format: (pattern?: string) => {
        if (pattern === 'YYYY/MM') return '2026/08';
        if (pattern === 'HH:mm') return '09:30';
        return '2026-08-05';
      },
    };
  });
}

describe('daily-note template tokens (P-13)', () => {
  it('substitutes time and formatted date tokens through window.moment', async () => {
    installFakeMoment();
    const host = templateHost();
    const plugin = makePlugin();
    plugin.app = host.app;

    await plugin.createDailyNoteForDate('2026-08-05');

    expect(host.created.get('Daily/2026-08-05.md')).toBe(
      'date=2026-08-05 title=2026-08-05 month=2026/08 time=09:30',
    );
  });

  it('creates one file when two callers request the same date concurrently', async () => {
    const host = templateHost();
    const plugin = makePlugin();
    plugin.app = host.app;

    const first = plugin.createDailyNoteForDate('2026-08-05');
    const second = plugin.createDailyNoteForDate('2026-08-05');
    const [firstFile, secondFile] = await Promise.all([first, second]);

    expect(host.app.vault.create).toHaveBeenCalledTimes(1);
    expect(firstFile).toBe(secondFile);
    expect(firstFile).toBeInstanceOf(HarnessTFile);
  });
});

/* ------------------------------------------------------------------------ *
 * P-16: silent commands and frozen command names
 * ------------------------------------------------------------------------ */

describe('localized commands (P-16)', () => {
  it('shows a Notice when the weather command has no calendar view open', async () => {
    const plugin = makePlugin({}, { weatherEnabled: true, weatherLatitude: '1', weatherLongitude: '2' });
    plugin.app = { workspace: { getLeavesOfType: () => [] } };

    await plugin.refreshActiveWeather();

    expect(noticeMessages).toEqual([i18n.t(plugin.settings, 'calendarViewRequired')]);
  });

  it('shows a Notice when On This Day has no calendar view open', () => {
    const plugin = makePlugin();
    plugin.app = { workspace: { getLeavesOfType: () => [] } };

    plugin.openOnThisDay(8, 5);

    expect(noticeMessages).toEqual([i18n.t(plugin.settings, 'calendarViewRequired')]);
  });

  it('refreshes command names after a language change instead of needing a restart', async () => {
    const plugin = makePlugin();
    plugin._localizedCommands = {
      refreshWeather: { name: 'stale' },
      openOnThisDay: { name: 'stale' },
    };
    plugin.settings.displayLanguage = 'zh';
    plugin.moodStore = { configure: vi.fn() };
    plugin._enqueueDataWrite = vi.fn(async () => undefined);

    await plugin.saveSettings();

    expect(plugin._localizedCommands.refreshWeather.name).toBe(i18n.t(plugin.settings, 'refreshWeather'));
    expect(plugin._localizedCommands.openOnThisDay.name).toBe(i18n.t(plugin.settings, 'openOnThisDay'));
    expect(plugin._localizedCommands.refreshWeather.name).toBe('刷新当前日期天气');
  });
});

/* ------------------------------------------------------------------------ *
 * P-17: duplicate work
 * ------------------------------------------------------------------------ */

describe('duplicate refresh work (P-17)', () => {
  it('refreshes the journal index once for a markdown save (modify no longer duplicates changed)', async () => {
    const plugin = makePlugin();
    plugin.journalIndex = { refreshFile: vi.fn(async () => undefined) };
    const changedHandlers: Array<(file: unknown) => Promise<void>> = [];
    subscribeJournalMetadataRefresh({
      metadataCache: {
        on: (_event: string, handler: (file: unknown) => Promise<void>) => {
          changedHandlers.push(handler);
          return {};
        },
      },
      registerEvent: () => undefined,
      journalIndex: plugin.journalIndex,
      getSettings: () => plugin.settings,
      onError: () => undefined,
    });
    const file = new HarnessTFile('Daily/2026-08-05.md');

    plugin._handleVaultModify(file);
    for (const handler of changedHandlers) await handler(file);

    expect(plugin.journalIndex.refreshFile).toHaveBeenCalledTimes(1);
  });

  it('lets the index subscription own the calendar redraw after a title save', async () => {
    const file = new HarnessTFile('Daily/2026-08-05.md');
    const renders: string[] = [];
    const plugin = makePlugin();
    plugin.app = {
      workspace: { getLeavesOfType: () => [] },
      vault: { getAbstractFileByPath: () => file },
      fileManager: { processFrontMatter: vi.fn(async (_file: unknown, mutate: (frontmatter: any) => void) => mutate({})) },
    };
    plugin.journalIndex = {
      resolveSources: () => [{ path: 'Daily' }],
      refreshFile: vi.fn(async () => { renders.push('index'); }),
    };
    plugin.refreshJournalViews = vi.fn(() => { renders.push('views'); });

    await plugin.saveJournalTitle('Daily/2026-08-05.md', 'Hello');

    expect(plugin.journalIndex.refreshFile).toHaveBeenCalledWith('Daily/2026-08-05.md', plugin.settings);
    expect(renders).toEqual(['index']);
  });
});

/* ------------------------------------------------------------------------ *
 * M-05: a note recreated at a tombstoned path must expose its mood again
 * ------------------------------------------------------------------------ */

describe('stale mood tombstones (M-05)', () => {
  it('clears the tombstone for a markdown note created at that path', async () => {
    const plugin = makePlugin();
    const clearStaleTombstone = vi.fn(async () => false);
    plugin.moodStore = { clearStaleTombstone };
    plugin.journalIndex = { refreshFile: vi.fn(async () => undefined) };
    const file = new HarnessTFile('Daily/2026-08-05.md');
    file.stat = { ctime: 12345 };

    plugin._handleJournalCreate(file);
    await flush();

    expect(clearStaleTombstone).toHaveBeenCalledWith('Daily/2026-08-05.md', 12345);
    expect(plugin.journalIndex.refreshFile).not.toHaveBeenCalled();
  });

  it('republishes the journal entry when the tombstone actually blocked a mood', async () => {
    const plugin = makePlugin();
    plugin.moodStore = { clearStaleTombstone: vi.fn(async () => true) };
    plugin.journalIndex = { refreshFile: vi.fn(async () => undefined) };
    const file = new HarnessTFile('Daily/2026-08-05.md');
    file.stat = { ctime: 12345 };

    plugin._handleJournalCreate(file);
    await flush();

    expect(plugin.journalIndex.refreshFile).toHaveBeenCalledWith('Daily/2026-08-05.md', plugin.settings);
  });
});

/* ------------------------------------------------------------------------ *
 * A sync engine that replaces a note fires delete (mood -> orphans) then
 * create; the create must put the mood back instead of hiding it in the
 * recovery list until the user restores it by hand.
 * ------------------------------------------------------------------------ */

describe('mood orphan auto-recovery on note create', () => {
  it('restores the orphaned mood and republishes the entry after a sync-style replace', async () => {
    const plugin = makePlugin();
    const autoRecoverOrphan = vi.fn(async () => true);
    plugin.moodStore = {
      clearStaleTombstone: vi.fn(async () => false),
      autoRecoverOrphan,
    };
    plugin.journalIndex = { refreshFile: vi.fn(async () => undefined) };
    const file = new HarnessTFile('Daily/2026-08-05.md');
    file.stat = { ctime: 12345 };

    plugin._handleJournalCreate(file);
    await flush();

    expect(autoRecoverOrphan).toHaveBeenCalledWith('Daily/2026-08-05.md', 12345);
    expect(plugin.journalIndex.refreshFile).toHaveBeenCalledWith('Daily/2026-08-05.md', plugin.settings);
  });

  it('does not republish when neither the tombstone nor an orphan changed', async () => {
    const plugin = makePlugin();
    plugin.moodStore = {
      clearStaleTombstone: vi.fn(async () => false),
      autoRecoverOrphan: vi.fn(async () => false),
    };
    plugin.journalIndex = { refreshFile: vi.fn(async () => undefined) };
    const file = new HarnessTFile('Daily/2026-08-05.md');
    file.stat = { ctime: 12345 };

    plugin._handleJournalCreate(file);
    await flush();

    expect(plugin.journalIndex.refreshFile).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * W-04: the weather cache is the only copy of backfilled history
 * ------------------------------------------------------------------------ */

describe('weather cache pruning (W-04)', () => {
  it('keeps a 100-day-old backfilled entry when settings load', async () => {
    const plugin = makePlugin();
    const fetchedAt = new Date(Date.now() - 100 * DAY_MS).toISOString();
    plugin.loadData = async () => ({
      weatherCache: { '2026-01-01': { date: '2026-01-01', fetchedAt, temperature: 4, units: 'metric' } },
    });

    await plugin.loadSettings();

    expect(plugin.weatherCache['2026-01-01']).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------ *
 * U-07: a fresh install follows the system language
 * ------------------------------------------------------------------------ */

describe('fresh-install display language (U-07)', () => {
  it('defaults a fresh install to system and keeps a stored value', async () => {
    const fresh = makePlugin();
    fresh.loadData = async () => null;
    await fresh.loadSettings();
    expect(fresh.settings.displayLanguage).toBe('system');

    const empty = makePlugin();
    empty.loadData = async () => ({});
    await empty.loadSettings();
    expect(empty.settings.displayLanguage).toBe('system');

    const existing = makePlugin();
    existing.loadData = async () => ({ displayLanguage: 'ja' });
    await existing.loadSettings();
    expect(existing.settings.displayLanguage).toBe('ja');

    const legacy = makePlugin();
    legacy.loadData = async () => ({ weatherLanguage: 'zh' });
    await legacy.loadSettings();
    expect(legacy.settings.displayLanguage).toBe('zh');
  });
});

/* ------------------------------------------------------------------------ *
 * M-01: surface the read-only mood metadata state
 * ------------------------------------------------------------------------ */

describe('read-only mood metadata surfacing (M-01)', () => {
  it('shows a localized upgrade Notice and keeps read-only mood writes out', async () => {
    const opened: string[] = [];
    const plugin = makePlugin({
      './mood-picker-modal': {
        MoodPickerModal: class { open() { opened.push('picker'); } },
        MoodRecoveryModal: class { open() { opened.push('recovery'); } },
      },
    });
    plugin.moodStore = { readOnly: true, deleteRecord: vi.fn(async () => true) };
    plugin.journalIndex = { getEntries: () => [] };
    plugin._ensureMoodJournalFile = vi.fn();

    expect(plugin._warnIfMoodStoreReadOnly()).toBe(true);
    expect(noticeMessages).toEqual([i18n.t(plugin.settings, 'moodMetadataReadOnly')]);

    await plugin.openMoodPicker('Daily/2026-08-05.md', { ensureFile: true });
    expect(plugin._ensureMoodJournalFile).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
    expect(noticeMessages).toHaveLength(2);

    await expect(plugin.deleteMoodRecord('Daily/2026-08-05.md')).resolves.toBe(false);
    expect(plugin.moodStore.deleteRecord).not.toHaveBeenCalled();
  });

  it('does not warn while the mood store is writable', () => {
    const plugin = makePlugin();
    plugin.moodStore = { readOnly: false };

    expect(plugin._warnIfMoodStoreReadOnly()).toBe(false);
    expect(noticeMessages).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * J-08: the On This Day panel must not outlive the plugin
 * ------------------------------------------------------------------------ */

describe('On This Day teardown (J-08)', () => {
  it('closes an open On This Day panel when the plugin unloads', async () => {
    const closeOnThisDayModal = vi.fn();
    const plugin = makePlugin({
      './on-this-day': { OnThisDayProvider: class {}, OnThisDayModal: class {}, closeOnThisDayModal },
    });
    plugin._overlayRegistry = { clear: vi.fn() };
    plugin._overlayOriginalPositions = new Map();
    plugin._hostPositionMarkers = new Set();
    plugin._journalWriteQueue = { flush: vi.fn(async () => undefined) };
    plugin.viewVisibilityController = { unload: vi.fn(async () => undefined) };
    plugin.moodStore = { flush: vi.fn(async () => undefined) };
    plugin._flushWeatherCache = vi.fn(async () => undefined);
    plugin._flushGeocoderCache = vi.fn(async () => undefined);
    plugin._removeAllOverlays = vi.fn();
    plugin._endExifHover = vi.fn();
    plugin._removeExifDismissHandlers = vi.fn();
    plugin._unbindCapabilityRefresh = vi.fn();
    plugin.mediaService = { dispose: vi.fn() };

    await plugin.onunload();

    expect(closeOnThisDayModal).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------ *
 * U-11: capabilities must follow the live viewport
 * ------------------------------------------------------------------------ */

describe('live capability re-detection (U-11)', () => {
  it('re-detects capabilities and re-syncs the quick entry on resize and css-change', () => {
    const next = { isMobile: true, isMobileApp: true, isPhone: false, isPhoneLayout: true };
    const detectPlatformCapabilities = vi.fn(() => next);
    const plugin = makePlugin({
      './platform-capabilities': { detectPlatformCapabilities, usesPhoneLayout: () => true, resolveCapabilityRoute: () => 'full' },
    });
    plugin.capabilities = { isMobile: true, isMobileApp: true, isPhoneLayout: false };
    plugin._applyCapabilityClasses = vi.fn();
    plugin._mobileQuickEntry = { sync: vi.fn() };

    const listeners: Record<string, () => void> = {};
    const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: any) => {
      listeners[type] = listener;
    });

    plugin._bindCapabilityRefresh();
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith('css-change', expect.any(Function));

    listeners.resize();

    expect(detectPlatformCapabilities).toHaveBeenCalled();
    expect(plugin.capabilities.isPhoneLayout).toBe(true);
    expect(plugin._applyCapabilityClasses).toHaveBeenCalled();
    expect(plugin._mobileQuickEntry.sync).toHaveBeenCalled();
  });
});
