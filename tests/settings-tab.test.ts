// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  notices: [] as string[],
  requestCurrentCoordinates: vi.fn(),
  settings: [] as any[],
}));

vi.mock('obsidian', () => ({
  PluginSettingTab: class {
    app: unknown;
    containerEl: HTMLElement;
    constructor(app: unknown) {
      this.app = app;
      this.containerEl = document.createElement('div');
    }
    hide() {}
  },
  // Fluent recorder that also builds the real row markup (info, name,
  // description, control), so `display()` can be rendered and inspected.
  // `addExifPersistMetadataSetting` builds a row through the same API.
  // There is deliberately no `addExtraButton`: the reminder row must not need one.
  Setting: class {
    constructor(containerEl: any) {
      const self = this as any;
      const div = (cls: string, parent?: HTMLElement) => {
        const el = document.createElement('div');
        el.className = cls;
        parent?.appendChild(el);
        return el;
      };
      self.containerEl = containerEl;
      self.settingEl = div('setting-item');
      self.infoEl = div('setting-item-info', self.settingEl);
      self.nameEl = div('setting-item-name', self.infoEl);
      self.descEl = div('setting-item-description', self.infoEl);
      self.controlEl = div('setting-item-control', self.settingEl);
      containerEl?.appendChild?.(self.settingEl);
      hoisted.settings.push(this);
    }
    setName(value: string) { (this as any).name = value; (this as any).nameEl.textContent = value; return this; }
    setDesc(value: string) { (this as any).desc = value; (this as any).descEl.textContent = value; return this; }
    setHeading() { (this as any).settingEl.classList.add('setting-item-heading'); return this; }
    addToggle(cb: (control: any) => void) {
      const wrapper = document.createElement('div');
      wrapper.className = 'checkbox-container';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      wrapper.appendChild(checkbox);
      (this as any).controlEl.appendChild(wrapper);
      const control: any = {
        toggleEl: wrapper,
        setValue(value: unknown) { control.value = value; checkbox.checked = Boolean(value); return control; },
        onChange(fn: (value: boolean) => Promise<void>) {
          control.onChange = fn;
          checkbox.addEventListener('change', () => { void fn(checkbox.checked); });
          return control;
        },
      };
      (this as any).toggle = control;
      cb(control);
      return this;
    }
    addDropdown(cb: (control: any) => void) {
      const selectEl = document.createElement('select');
      (this as any).controlEl.appendChild(selectEl);
      const control: any = {
        selectEl,
        addOption(value: string, label: string) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          selectEl.appendChild(option);
          return control;
        },
        addOptions(options: Record<string, string>) {
          for (const [value, label] of Object.entries(options)) control.addOption(value, label);
          return control;
        },
        setValue(value: unknown) { selectEl.value = String(value ?? ''); return control; },
        onChange(fn: (value: string) => Promise<void>) {
          control.onChange = fn;
          selectEl.addEventListener('change', () => { void fn(selectEl.value); });
          return control;
        },
      };
      (this as any).dropdown = control;
      cb(control);
      return this;
    }
    addText(cb: (control: any) => void) {
      const inputEl = document.createElement('input');
      inputEl.type = 'text';
      (this as any).controlEl.appendChild(inputEl);
      const control: any = {
        inputEl,
        getValue() { return inputEl.value; },
        setPlaceholder(value: string) { inputEl.placeholder = value; return control; },
        setValue(value: string) { inputEl.value = value; return control; },
        onChange(fn: (value: string) => Promise<void>) {
          inputEl.addEventListener('input', () => { void fn(inputEl.value); });
          return control;
        },
      };
      cb(control);
      return this;
    }
    addButton(cb: (control: any) => void) {
      const buttonEl = document.createElement('button');
      (this as any).controlEl.appendChild(buttonEl);
      const control: any = {
        buttonEl,
        setButtonText(value: string) { buttonEl.textContent = value; return control; },
        setDisabled(value: boolean) { control.disabled = value; return control; },
        onClick(fn: () => Promise<void>) {
          control.onClick = fn;
          buttonEl.addEventListener('click', () => { void fn(); });
          return control;
        },
      };
      cb(control);
      return this;
    }
  },
  Notice: class { constructor(message: string) { hoisted.notices.push(message); } },
  SuggestModal: class {},
  TFolder: class {},
  setIcon: (element: HTMLElement, name: string) => { element.dataset.icon = name; },
}));

vi.mock('../src/geolocation', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, requestCurrentCoordinates: hoisted.requestCurrentCoordinates };
});

import {
  DEFAULT_MOOD_METADATA_PATH,
  DaylineSettingsTab,
  SETTINGS_ACTION_ROWS,
  SETTINGS_ADVANCED_GROUP_IDS,
  SETTINGS_ADVANCED_GROUP_LABEL_KEYS,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTION_LABEL_KEYS,
  SETTINGS_TEXT_COMMIT_DELAY_MS,
  addExifPersistMetadataSetting,
  commitJournalSourceSettings,
  createSettingsLocalizer,
  fillDisplayLanguageDropdown,
  isScrollableSettingsPane,
  normalizeHeicThumbCachePath,
  normalizeMoodMetadataPath,
  parseCoordinateSettingValue,
  resolveSettingsScrollHost,
  restoreMoodMetadataBackup,
  restoreSettingsScroll,
  shouldPreserveSettingsScroll,
  shouldShowCalendarMoodStyle,
  shouldShowCalendarWeatherOptions,
  shouldShowExifGeocoding,
  shouldShowHeicThumbCacheGenerate,
  shouldShowOnThisDayExcerptSettings,
  shouldShowUseCurrentLocationButton,
  shouldShowWeatherLocationOption,
  shouldShowWeatherSettings,
} from '../src/settings-tab';
import {
  DISPLAY_LANGUAGE_ENDONYMS,
  DISPLAY_LANGUAGE_OPTIONS,
  SUPPORTED_DISPLAY_LANGUAGES,
  t,
} from '../src/i18n';
import { shouldShowTimelineMoodTrend, shouldShowTimelineTitles } from '../src/journal-timeline-display';

describe('display language setting', () => {
  function fakeDropdown() {
    const dd: any = { options: [] as Array<[string, string]> };
    dd.addOption = (value: string, label: string) => { dd.options.push([value, label]); return dd; };
    return dd;
  }

  it('names every language in its own script so an unfamiliar UI is escapable', () => {
    expect(DISPLAY_LANGUAGE_ENDONYMS).toEqual({
      en: 'English',
      zh: '简体中文',
      'zh-tw': '繁體中文',
      ja: '日本語',
      ko: '한국어',
      fr: 'Français',
      de: 'Deutsch',
      es: 'Español',
      ru: 'Русский',
    });
  });

  it('renders system localized and every language as its endonym', () => {
    // A Russian UI must still list 简体中文 as 简体中文 — the translated
    // Упрощенный китайский used to leave no readable path back to Chinese.
    const dd = fakeDropdown();
    fillDisplayLanguageDropdown(dd, { displayLanguage: 'ru' });
    expect(dd.options).toEqual([
      ['system', 'Система'],
      ['en', 'English'],
      ['zh', '简体中文'],
      ['zh-tw', '繁體中文'],
      ['ja', '日本語'],
      ['ko', '한국어'],
      ['fr', 'Français'],
      ['de', 'Deutsch'],
      ['es', 'Español'],
      ['ru', 'Русский'],
    ]);
  });

  it('renders the same endonyms and no duplicate labels under every UI language', () => {
    for (const uiLanguage of SUPPORTED_DISPLAY_LANGUAGES) {
      const dd = fakeDropdown();
      fillDisplayLanguageDropdown(dd, { displayLanguage: uiLanguage });
      expect(dd.options[0][0], `${uiLanguage} UI keeps system first`).toBe('system');
      expect(t({ displayLanguage: uiLanguage }, 'system'), `${uiLanguage} system label`).not.toBe('');
      expect(dd.options.slice(1).map(([, label]: [string, string]) => label), `${uiLanguage} UI`)
        .toEqual(Object.values(DISPLAY_LANGUAGE_ENDONYMS));
      const labels = dd.options.map(([, label]: [string, string]) => label);
      expect(new Set(labels).size, `${uiLanguage} labels`).toBe(labels.length);
    }
  });
});

describe('Dayline settings information architecture', () => {
  it('keeps sections in task and maintenance order with localized labels', () => {
    expect(SETTINGS_SECTION_IDS).toEqual([
      'general',
      'calendar-journal',
      'mood',
      'weather',
      'media-privacy',
      'on-this-day',
      'advanced',
      'support',
    ]);
    expect(SETTINGS_SECTION_IDS.map((id) => t({ displayLanguage: 'en' }, SETTINGS_SECTION_LABEL_KEYS[id as keyof typeof SETTINGS_SECTION_LABEL_KEYS])))
      .toEqual(['General', 'Calendar and journal', 'Mood', 'Weather', 'Media metadata and privacy', 'On This Day', 'Advanced', 'Support']);
    expect(SETTINGS_SECTION_IDS.map((id) => t({ displayLanguage: 'zh' }, SETTINGS_SECTION_LABEL_KEYS[id as keyof typeof SETTINGS_SECTION_LABEL_KEYS])))
      .toEqual(['常规', '日历和日记', '心情', '天气', '媒体元数据与隐私', '去年今日', '高级', '支持']);
  });

  it('keeps the four former sections as labelled groups inside the Advanced fold', () => {
    expect(SETTINGS_ADVANCED_GROUP_IDS).toEqual(['calendar-journal', 'weather', 'media-privacy', 'data-maintenance']);
    expect(SETTINGS_ADVANCED_GROUP_IDS.map((id) => t({ displayLanguage: 'en' }, SETTINGS_ADVANCED_GROUP_LABEL_KEYS[id as keyof typeof SETTINGS_ADVANCED_GROUP_LABEL_KEYS])))
      .toEqual(['Calendar and journal', 'Weather', 'Media metadata and privacy', 'Data and maintenance']);
    for (const language of SUPPORTED_DISPLAY_LANGUAGES) {
      expect(t({ displayLanguage: language }, 'settingsAdvanced'), language).not.toBe('settingsAdvanced');
      expect(t({ displayLanguage: language }, 'settingsAdvancedDesc'), language).not.toBe('settingsAdvancedDesc');
    }
  });

  it('limits every maintenance action row to two actions', () => {
    expect(Object.values(SETTINGS_ACTION_ROWS).every((actions) => actions.length <= 2)).toBe(true);
    expect(SETTINGS_ACTION_ROWS).toEqual({
      journalTools: ['openTimeline', 'detectImports'],
      moodExport: ['exportMoodCsvCommand', 'exportMoodJsonCommand'],
      metadataBackup: ['exportMetadataCommand', 'restoreMetadataCommand'],
      dataMaintenance: ['integrityCommand', 'importFrontmatterCommand'],
    });
  });

  it('shows dependent options only when their parent feature is active', () => {
    expect(shouldShowWeatherSettings({ weatherEnabled: false })).toBe(false);
    expect(shouldShowWeatherSettings({ weatherEnabled: true })).toBe(true);
    expect(shouldShowCalendarWeatherOptions({ weatherEnabled: false })).toBe(false);
    expect(shouldShowWeatherLocationOption({ weatherEnabled: true, showCalendarWeatherCard: false })).toBe(false);
    expect(shouldShowWeatherLocationOption({ weatherEnabled: true, showCalendarWeatherCard: true })).toBe(true);
    expect(shouldShowOnThisDayExcerptSettings({ onThisDayButton: false })).toBe(true);
    expect(shouldShowOnThisDayExcerptSettings({ onThisDayButton: true })).toBe(true);
    expect(shouldShowOnThisDayExcerptSettings({ onThisDayEntry: 'off' })).toBe(true);
    expect(shouldShowOnThisDayExcerptSettings({ onThisDayEntry: 'merged' })).toBe(true);
    expect(shouldShowExifGeocoding({ showExif: false })).toBe(false);
    expect(shouldShowExifGeocoding({ showExif: true })).toBe(true);
    expect(shouldShowCalendarMoodStyle({})).toBe(true);
    expect(shouldShowCalendarMoodStyle({ showCalendarMood: false })).toBe(false);
  });

  it('localizes and defaults the timeline mood trend setting', () => {
    expect(shouldShowTimelineMoodTrend({})).toBe(true);
    expect(shouldShowTimelineMoodTrend({ showTimelineMoodTrend: false })).toBe(false);
    expect(t({ displayLanguage: 'zh' }, 'showTimelineMoodTrend')).toBe('显示时间线心情趋势');
    expect(t({ displayLanguage: 'en' }, 'showTimelineMoodTrend')).toBe('Show timeline mood trend');
    expect(shouldShowTimelineTitles({})).toBe(true);
    expect(t({ displayLanguage: 'zh' }, 'showTimelineTitles')).toBe('显示时间轴日记标题');
    expect(t({ displayLanguage: 'en' }, 'showTimelineTitles')).toBe('Show timeline journal titles');
    expect(t({ displayLanguage: 'zh' }, 'calendarMoodMarker')).toBe('日历心情样式');
    expect(t({ displayLanguage: 'en' }, 'calendarMoodMarkerBar')).toBe('Color bar');
  });
});

describe('journal source settings updates', () => {
  it('rebuilds the journal index before notifying views', async () => {
    const order: string[] = [];
    const plugin = {
      settings: { dailyFolder: 'New/Daily' },
      saveSettings: async () => { order.push('save'); },
      journalIndex: { refresh: async () => { order.push('index'); } },
      refreshJournalViews: () => { order.push('views'); },
    };

    await commitJournalSourceSettings(plugin);

    expect(order).toEqual(['save', 'index', 'views']);
  });
});

describe('coordinate field validation', () => {
  it('rejects the garbage parseFloat used to accept', () => {
    expect(parseCoordinateSettingValue('latitude', '39abc')).toEqual({ ok: false, messageKey: 'coordinateMustBeNumeric' });
    expect(parseCoordinateSettingValue('longitude', '116,4')).toEqual({ ok: false, messageKey: 'coordinateMustBeNumeric' });
    expect(parseCoordinateSettingValue('latitude', 'Infinity')).toEqual({ ok: false, messageKey: 'coordinateMustBeNumeric' });
    expect(parseCoordinateSettingValue('latitude', '1e2')).toEqual({ ok: false, messageKey: 'coordinateMustBeNumeric' });
  });

  it('accepts plain decimals, blank input, and the valid range edges', () => {
    expect(parseCoordinateSettingValue('latitude', ' 39.9042 ')).toEqual({ ok: true, value: '39.9042' });
    expect(parseCoordinateSettingValue('latitude', '-90')).toEqual({ ok: true, value: '-90' });
    expect(parseCoordinateSettingValue('longitude', '+180')).toEqual({ ok: true, value: '+180' });
    expect(parseCoordinateSettingValue('latitude', '')).toEqual({ ok: true, value: '' });
  });

  it('reports out-of-range coordinates with a range-specific message', () => {
    expect(parseCoordinateSettingValue('latitude', '90.5')).toEqual({ ok: false, messageKey: 'latitudeOutOfRange' });
    expect(parseCoordinateSettingValue('longitude', '-180.5')).toEqual({ ok: false, messageKey: 'longitudeOutOfRange' });
  });
});

describe('mood metadata backup restore', () => {
  function restorePlugin() {
    return {
      settings: { displayLanguage: 'en' },
      moodStore: { restoreBackup: vi.fn(async () => ({ entries: 1, orphans: 0 })) },
      journalIndex: { refresh: vi.fn(async () => {}) },
      refreshJournalViews: vi.fn(),
    };
  }

  it('asks before overwriting the live store and does nothing when declined', async () => {
    const plugin = restorePlugin();
    const confirm = vi.fn(() => false);

    expect(await restoreMoodMetadataBackup(plugin, confirm)).toBe(false);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('will be lost'));
    expect(plugin.moodStore.restoreBackup).not.toHaveBeenCalled();
    expect(plugin.journalIndex.refresh).not.toHaveBeenCalled();
  });

  it('restores and refreshes the views once confirmed', async () => {
    const plugin = restorePlugin();
    hoisted.notices.length = 0;

    expect(await restoreMoodMetadataBackup(plugin, () => true)).toBe(true);

    expect(plugin.moodStore.restoreBackup).toHaveBeenCalledTimes(1);
    expect(plugin.journalIndex.refresh).toHaveBeenCalledTimes(1);
    expect(plugin.refreshJournalViews).toHaveBeenCalledTimes(1);
    expect(hoisted.notices.at(-1)).toBe('Mood metadata backup restored');
  });
});

describe('mood metadata path validation', () => {
  it('only applies JSON paths and falls back to the default for blank input', () => {
    expect(normalizeMoodMetadataPath('Calendar/journal-metadata.json'))
      .toEqual({ ok: true, value: 'Calendar/journal-metadata.json' });
    expect(normalizeMoodMetadataPath('  Calendar/mood.JSON  ')).toEqual({ ok: true, value: 'Calendar/mood.JSON' });
    expect(normalizeMoodMetadataPath('')).toEqual({ ok: true, value: DEFAULT_MOOD_METADATA_PATH });
    expect(normalizeMoodMetadataPath('Calendar/journal-metadata.js'))
      .toEqual({ ok: false, messageKey: 'moodMetadataPathMustBeJson' });
  });
});

describe('HEIC thumbnail cache folder validation', () => {
  it('accepts a vault-relative folder and treats blank input as disabled', () => {
    expect(normalizeHeicThumbCachePath('')).toEqual({ ok: true, value: '' });
    expect(normalizeHeicThumbCachePath('  ')).toEqual({ ok: true, value: '' });
    // Hidden and visible folders are both valid: the choice is the user's.
    expect(normalizeHeicThumbCachePath('.dayline/thumbs')).toEqual({ ok: true, value: '.dayline/thumbs' });
    expect(normalizeHeicThumbCachePath(' .dayline\\thumbs/ ')).toEqual({ ok: true, value: '.dayline/thumbs' });
    expect(normalizeHeicThumbCachePath('dayline-thumbs')).toEqual({ ok: true, value: 'dayline-thumbs' });
  });

  it('rejects paths that would leave the vault or name a device', () => {
    const invalid = { ok: false, messageKey: 'heicThumbCachePathInvalid' };
    expect(normalizeHeicThumbCachePath('/absolute/path')).toEqual(invalid);
    expect(normalizeHeicThumbCachePath('~/thumbs')).toEqual(invalid);
    expect(normalizeHeicThumbCachePath('C:\\thumbs')).toEqual(invalid);
    expect(normalizeHeicThumbCachePath('Photos/../../outside')).toEqual(invalid);
    expect(normalizeHeicThumbCachePath('bad\u0000name')).toEqual(invalid);
  });
});

describe('HEIC thumbnail generation action', () => {
  it('only appears where the desktop converter exists', () => {
    expect(shouldShowHeicThumbCacheGenerate({ isDesktop: true })).toBe(true);
    expect(shouldShowHeicThumbCacheGenerate({ isDesktop: false })).toBe(false);
    expect(shouldShowHeicThumbCacheGenerate(undefined)).toBe(false);
  });

  it('runs the full sweep and reports progress and the final count', async () => {
    hoisted.notices.length = 0;
    const plugin: any = makePlugin({ displayLanguage: 'en' });
    plugin.heicThumbStore = { enabled: true };
    plugin.fillHeicThumbCache = vi.fn(async (onProgress: any) => {
      onProgress?.({ done: 1, total: 2, converted: 1 });
      onProgress?.({ done: 2, total: 2, converted: 1 });
      return { converted: 1, total: 2, skipped: false };
    });
    const tab = makeTab(plugin);
    const setting = { setDesc: vi.fn() };
    const button = { setDisabled: vi.fn() };

    await tab._fillHeicThumbCache(setting, button);

    expect(plugin.fillHeicThumbCache).toHaveBeenCalledTimes(1);
    expect(setting.setDesc).toHaveBeenCalledWith('Generating 1/2');
    expect(setting.setDesc).toHaveBeenLastCalledWith(expect.stringContaining('Scan every HEIC'));
    expect(button.setDisabled).toHaveBeenNthCalledWith(1, true);
    expect(button.setDisabled).toHaveBeenLastCalledWith(false);
    expect(hoisted.notices.at(-1)).toBe('Generated 1 HEIC thumbnails');
  });

  it('explains when the cache folder is empty instead of running', async () => {
    hoisted.notices.length = 0;
    const plugin: any = makePlugin({ displayLanguage: 'en' });
    plugin.heicThumbStore = { enabled: false };
    const tab = makeTab(plugin);

    await tab._fillHeicThumbCache({ setDesc: vi.fn() }, { setDisabled: vi.fn() });

    expect(plugin.fillHeicThumbCache).toBeUndefined();
    expect(hoisted.notices.at(-1)).toBe('The cache folder is empty, so the HEIC thumbnail cache is off');
  });

  it('reports a concurrent run instead of starting a second one', async () => {
    hoisted.notices.length = 0;
    const plugin: any = makePlugin({ displayLanguage: 'en' });
    plugin.heicThumbStore = { enabled: true };
    plugin.fillHeicThumbCache = vi.fn(async () => ({ converted: 0, total: 0, skipped: true }));
    const tab = makeTab(plugin);
    const button = { setDisabled: vi.fn() };

    await tab._fillHeicThumbCache({ setDesc: vi.fn() }, button);

    expect(hoisted.notices.at(-1)).toBe('HEIC thumbnail generation is already running');
    expect(button.setDisabled).toHaveBeenLastCalledWith(false);
  });
});

describe('one-tap locate availability', () => {
  it('only offers the button on platforms that provide a location service', () => {
    expect(shouldShowUseCurrentLocationButton({ isMobileApp: true })).toBe(true);
    expect(shouldShowUseCurrentLocationButton({ isIos: true })).toBe(true);
    expect(shouldShowUseCurrentLocationButton({ isAndroid: true })).toBe(true);
    expect(shouldShowUseCurrentLocationButton({ isMobileApp: false, isIos: false, isAndroid: false })).toBe(false);
    expect(shouldShowUseCurrentLocationButton(undefined)).toBe(false);
    expect(shouldShowUseCurrentLocationButton(null)).toBe(false);
  });
});

describe('settings descriptions follow the live display language', () => {
  it('resolves the locale at call time instead of the frozen weatherLanguage', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    try {
      const _s = createSettingsLocalizer({ displayLanguage: 'system', weatherLanguage: 'zh' });
      expect(_s('s_latitude')).toBe('Latitude');
      vi.stubGlobal('navigator', { language: 'ja-JP' });
      expect(_s('s_latitude')).toBe('緯度');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

type FakePlugin = ReturnType<typeof makePlugin>;

function makePlugin(settings: Record<string, unknown> = {}) {
  return {
    settings,
    saveSettings: vi.fn(async () => {}),
    journalIndex: { refresh: vi.fn(async () => {}) },
    refreshJournalViews: vi.fn(),
    moodStore: { configure: vi.fn(), load: vi.fn(async () => {}) },
  };
}

function makeTab(plugin: FakePlugin) {
  const app = { workspace: { getLeavesOfType: () => [] } };
  const tab = new DaylineSettingsTab(app, plugin) as unknown as {
    display: () => void;
    hide: () => void;
    _bindValidatedTextField: (text: unknown, options: Record<string, unknown>) => void;
    _reloadMoodMetadataStore: () => Promise<void>;
    _fillHeicThumbCache: (setting: unknown, button: unknown) => Promise<void>;
    _fillWeatherCoordinatesFromDevice: (button: unknown) => Promise<void>;
  };
  tab.display = vi.fn();
  return tab;
}

function makeText(initial = '') {
  const inputEl = document.createElement('input');
  const text = {
    inputEl,
    getValue: () => inputEl.value,
    setValue: (value: string) => { inputEl.value = value; },
  };
  text.setValue(initial);
  return text;
}

describe('settings text fields commit without hammering the network', () => {
  beforeEach(() => {
    hoisted.notices.length = 0;
    hoisted.requestCurrentCoordinates.mockReset();
  });

  it('debounces a burst of keystrokes into one save and one refresh', async () => {
    vi.useFakeTimers();
    try {
      const plugin = makePlugin({ weatherLatitude: '' });
      const tab = makeTab(plugin);
      const text = makeText();
      const apply = vi.fn(async () => {});
      tab._bindValidatedTextField(text, {
        field: 'weatherLatitude',
        parse: (raw: string) => parseCoordinateSettingValue('latitude', raw),
        showError: vi.fn(),
        clearError: vi.fn(),
        apply,
      });

      for (const value of ['3', '39', '39.9', '39.9042']) {
        text.setValue(value);
        text.inputEl.dispatchEvent(new Event('input'));
      }
      expect(plugin.settings.weatherLatitude).toBe('');
      expect(plugin.saveSettings).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(SETTINGS_TEXT_COMMIT_DELAY_MS - 1);
      expect(plugin.saveSettings).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(plugin.settings.weatherLatitude).toBe('39.9042');
      expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps garbage out of the settings and reports it inline', async () => {
    vi.useFakeTimers();
    try {
      const plugin = makePlugin({ weatherLatitude: '39.9042' });
      const tab = makeTab(plugin);
      const text = makeText();
      const showError = vi.fn();
      const apply = vi.fn(async () => {});
      tab._bindValidatedTextField(text, {
        field: 'weatherLatitude',
        parse: (raw: string) => parseCoordinateSettingValue('latitude', raw),
        showError,
        clearError: vi.fn(),
        apply,
      });

      text.setValue('39abc');
      text.inputEl.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(SETTINGS_TEXT_COMMIT_DELAY_MS);

      expect(plugin.settings.weatherLatitude).toBe('39.9042');
      expect(plugin.saveSettings).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('coordinateMustBeNumeric');
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits on blur without waiting for the typing pause', async () => {
    vi.useFakeTimers();
    try {
      const plugin = makePlugin({ weatherLongitude: '' });
      const tab = makeTab(plugin);
      const text = makeText();
      const apply = vi.fn(async () => {});
      tab._bindValidatedTextField(text, {
        field: 'weatherLongitude',
        parse: (raw: string) => parseCoordinateSettingValue('longitude', raw),
        showError: vi.fn(),
        clearError: vi.fn(),
        apply,
      });

      text.setValue('116.4074');
      text.inputEl.dispatchEvent(new Event('input'));
      text.inputEl.dispatchEvent(new Event('blur'));
      await vi.advanceTimersByTimeAsync(0);

      expect(plugin.settings.weatherLongitude).toBe('116.4074');
      expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(SETTINGS_TEXT_COMMIT_DELAY_MS * 3);
      expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending edit when the settings pane closes', async () => {
    vi.useFakeTimers();
    try {
      const plugin = makePlugin({ moodMetadataPath: '' });
      const tab = makeTab(plugin);
      const text = makeText();
      tab._bindValidatedTextField(text, {
        field: 'moodMetadataPath',
        parse: (raw: string) => normalizeMoodMetadataPath(raw),
        showError: vi.fn(),
        clearError: vi.fn(),
        apply: vi.fn(async () => {}),
      });

      text.setValue('Calendar/mood.json');
      text.inputEl.dispatchEvent(new Event('input'));
      tab.hide();
      await vi.advanceTimersByTimeAsync(0);

      expect(plugin.settings.moodMetadataPath).toBe('Calendar/mood.json');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never reconfigures the mood store for a non-JSON path', async () => {
    vi.useFakeTimers();
    try {
      const plugin = makePlugin({ moodMetadataPath: 'Calendar/journal-metadata.json' });
      const tab = makeTab(plugin);
      const text = makeText();
      const showError = vi.fn();
      tab._bindValidatedTextField(text, {
        field: 'moodMetadataPath',
        parse: (raw: string) => normalizeMoodMetadataPath(raw),
        showError,
        clearError: vi.fn(),
        apply: () => tab._reloadMoodMetadataStore(),
      });

      text.setValue('Calendar/journal-metadata.js');
      text.inputEl.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(SETTINGS_TEXT_COMMIT_DELAY_MS);

      expect(plugin.settings.moodMetadataPath).toBe('Calendar/journal-metadata.json');
      expect(plugin.moodStore.configure).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('moodMetadataPathMustBeJson');

      text.setValue('Calendar/other-metadata.json');
      text.inputEl.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(SETTINGS_TEXT_COMMIT_DELAY_MS);

      expect(plugin.settings.moodMetadataPath).toBe('Calendar/other-metadata.json');
      expect(plugin.moodStore.configure).toHaveBeenCalledTimes(1);
      expect(plugin.journalIndex.refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed mood metadata load instead of rejecting', async () => {
    const plugin = makePlugin({ moodMetadataPath: 'Calendar/journal-metadata.json' });
    plugin.moodStore.load.mockRejectedValueOnce(new Error('bad json'));
    const tab = makeTab(plugin);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(tab._reloadMoodMetadataStore()).resolves.toBeUndefined();
      expect(hoisted.notices).toHaveLength(1);
      expect(hoisted.notices[0]).not.toContain('bad json');
      expect(warn).toHaveBeenCalledWith('[Dayline] Mood metadata path change failed:', 'bad json');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('using the device location', () => {
  beforeEach(() => {
    hoisted.notices.length = 0;
    hoisted.requestCurrentCoordinates.mockReset();
  });

  it('stores two decimals and clears the stale place name', async () => {
    hoisted.requestCurrentCoordinates.mockResolvedValue({ latitude: 31.2304, longitude: 121.4737 });
    const plugin = makePlugin({ weatherLatitude: '39.9042', weatherLongitude: '116.4074', weatherLocationName: 'Beijing' });
    const tab = makeTab(plugin);

    await tab._fillWeatherCoordinatesFromDevice({ setDisabled: vi.fn(), setButtonText: vi.fn() });

    expect(plugin.settings.weatherLatitude).toBe('31.23');
    expect(plugin.settings.weatherLongitude).toBe('121.47');
    expect(plugin.settings.weatherLocationName).toBe('');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(hoisted.notices).toHaveLength(1);
  });

  it('lets the device reading win over text still pending in the coordinate field', async () => {
    vi.useFakeTimers();
    try {
      hoisted.requestCurrentCoordinates.mockResolvedValue({ latitude: 31.2304, longitude: 121.4737 });
      const plugin = makePlugin({ weatherLatitude: '39.9042', weatherLongitude: '116.4074', weatherLocationName: 'Beijing' });
      const tab = makeTab(plugin);
      const text = makeText();
      tab._bindValidatedTextField(text, {
        field: 'weatherLatitude',
        parse: (raw: string) => parseCoordinateSettingValue('latitude', raw),
        showError: vi.fn(),
        clearError: vi.fn(),
        apply: vi.fn(async () => {}),
      });

      text.setValue('12.34');
      text.inputEl.dispatchEvent(new Event('input'));
      await tab._fillWeatherCoordinatesFromDevice({ setDisabled: vi.fn(), setButtonText: vi.fn() });
      await vi.advanceTimersByTimeAsync(SETTINGS_TEXT_COMMIT_DELAY_MS * 2);

      expect(plugin.settings.weatherLatitude).toBe('31.23');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a localized notice and keeps the English provider message out of it', async () => {
    hoisted.requestCurrentCoordinates.mockRejectedValue(new Error('Position unavailable: no provider'));
    const plugin = makePlugin({ weatherLatitude: '39.9042', weatherLongitude: '116.4074', weatherLocationName: 'Beijing' });
    const tab = makeTab(plugin);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      await tab._fillWeatherCoordinatesFromDevice({ setDisabled: vi.fn(), setButtonText: vi.fn() });
      expect(plugin.settings.weatherLocationName).toBe('Beijing');
      expect(hoisted.notices).toHaveLength(1);
      expect(hoisted.notices[0]).not.toContain('Position unavailable');
      expect(debug).toHaveBeenCalledWith('[Dayline] Geolocation failed:', 'Position unavailable: no provider');
    } finally {
      debug.mockRestore();
    }
  });
});

describe('insert-time EXIF persistence setting', () => {
  it('adds an opt-in row that persists exifPersistMetadata', async () => {
    hoisted.settings.length = 0;
    const plugin = makePlugin({ displayLanguage: 'en', exifPersistMetadata: false });
    const saveSettings = vi.fn(async () => true);
    addExifPersistMetadataSetting(document.createElement('div'), plugin, saveSettings);

    const setting = hoisted.settings.at(-1) as any;
    // The key is resolved through `t` (i18n); until the nine translations land
    // it falls back to the raw key, and both sides move together afterwards.
    expect(setting.name).toBe(t(plugin.settings as any, 's_exifPersist'));
    expect(setting.desc).toBe(t(plugin.settings as any, 's_exifPersistDesc'));
    expect(setting.toggle.value).toBe(false);

    await setting.toggle.onChange(true);

    expect(plugin.settings.exifPersistMetadata).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('defaults the toggle off when the stored value is missing', () => {
    hoisted.settings.length = 0;
    const plugin = makePlugin({ displayLanguage: 'en' });
    addExifPersistMetadataSetting(document.createElement('div'), plugin, vi.fn(async () => true));
    expect((hoisted.settings.at(-1) as any).toggle.value).toBe(false);
  });
});

describe('settings scroll position survives a rebuild', () => {
  function scrollable(tag = 'div', overflow = 'auto', overflowPx = 600) {
    const el = document.createElement(tag);
    el.style.overflowY = overflow;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 900 - overflowPx });
    return el;
  }

  afterEach(() => document.body.replaceChildren());

  it('walks out to the pane that actually scrolls', () => {
    const pane = scrollable();
    const wrapper = document.createElement('div');
    const containerEl = document.createElement('div');
    pane.append(wrapper);
    wrapper.append(containerEl);
    document.body.append(pane);

    expect(resolveSettingsScrollHost(containerEl)).toBe(pane);
    expect(resolveSettingsScrollHost(document.createElement('div'))).toBeNull();
  });

  it('skips an ancestor that overflows but cannot scroll', () => {
    const clipped = scrollable('div', 'visible');
    const pane = scrollable();
    const containerEl = document.createElement('div');
    clipped.append(containerEl);
    pane.append(clipped);
    document.body.append(pane);

    expect(isScrollableSettingsPane(clipped)).toBe(false);
    expect(resolveSettingsScrollHost(containerEl)).toBe(pane);
  });

  it('only preserves a position for a rebuild of an open pane', () => {
    const pane = scrollable();
    const containerEl = document.createElement('div');
    pane.append(containerEl);
    document.body.append(pane);

    // First open: nothing was on screen yet, so the pane has to start at the top.
    expect(shouldPreserveSettingsScroll(false, pane, containerEl)).toBe(false);
    // A re-render while open, with rows already built.
    containerEl.append(document.createElement('div'));
    expect(shouldPreserveSettingsScroll(true, pane, containerEl)).toBe(true);
    // Without a scrollable host there is nothing to restore.
    expect(shouldPreserveSettingsScroll(true, null, containerEl)).toBe(false);
  });

  it('re-asserts the position while the rebuilt rows lay out, then gives up', () => {
    // A browser that clamps the position to 0 until the new rows are laid out.
    let written = 0;
    let layoutFrames = 0;
    const host = {
      get scrollTop() { return layoutFrames >= 2 ? written : 0; },
      set scrollTop(value: number) { written = value; },
    };
    restoreSettingsScroll(host, 240, {
      maxFrames: 4,
      frame: (callback: () => void) => { layoutFrames += 1; callback(); },
    });

    expect(written).toBe(240);
    expect(layoutFrames).toBe(2);

    // A pane that ends up shorter than the remembered position must not spin.
    let stubbornWrites = 0;
    const stubborn = {
      get scrollTop() { return 0; },
      set scrollTop(_value: number) { stubbornWrites += 1; },
    };
    restoreSettingsScroll(stubborn, 240, {
      maxFrames: 3,
      frame: (callback: () => void) => callback(),
    });

    expect(stubbornWrites).toBe(4);
  });

  it('keeps a position that the browser already honoured without extra frames', () => {
    let frames = 0;
    const host = { scrollTop: 0 };
    restoreSettingsScroll(host, 120, { frame: (callback: () => void) => { frames += 1; callback(); } });

    expect(host.scrollTop).toBe(120);
    expect(frames).toBe(0);
  });

  it('stays at the top on the next open after the pane closes', () => {
    const plugin = makePlugin({ displayLanguage: 'en' });
    const tab = new DaylineSettingsTab({ workspace: { getLeavesOfType: () => [] } }, plugin) as any;
    tab._settingsVisible = true;

    tab.hide();

    expect(tab._settingsVisible).toBe(false);
  });
});

describe('rendered settings tab', () => {
  const en = { displayLanguage: 'en' };
  // The `s_*` strings live in locale.ts and resolve through the settings localizer.
  const localize = createSettingsLocalizer(en);
  const label = (key: string) => (key.startsWith('s_') ? localize(key) : t(en as any, key));

  function renderTab(overrides: Record<string, unknown> = {}, extras: Record<string, unknown> = {}) {
    hoisted.settings.length = 0;
    const plugin: any = {
      ...makePlugin({ displayLanguage: 'en', weatherEnabled: false, ...overrides }),
      manifest: { version: '2.11.0' },
      capabilities: { isDesktop: true },
      ...extras,
    };
    const tab: any = new DaylineSettingsTab({ workspace: { getLeavesOfType: () => [] } }, plugin);
    tab.display();
    return { tab, plugin, containerEl: tab.containerEl as HTMLElement };
  }

  const advancedBody = (containerEl: HTMLElement) =>
    containerEl.querySelector('.dayline-settings-advanced-body') as HTMLElement;
  const advancedToggle = (containerEl: HTMLElement) =>
    containerEl.querySelector('.dayline-settings-advanced-toggle') as HTMLButtonElement;
  const rowNames = (root: ParentNode) =>
    Array.from(root.querySelectorAll('.setting-item:not(.setting-item-heading) > .setting-item-info > .setting-item-name'))
      .map((el) => el.textContent);
  /** Names of the rows that sit between a section heading and the next one. */
  const sectionRowNames = (containerEl: HTMLElement, id: string) => {
    const names: Array<string | null> = [];
    let started = false;
    for (const child of Array.from(containerEl.children) as HTMLElement[]) {
      if (child.dataset.daylineSettingsSection) {
        if (started) break;
        started = child.dataset.daylineSettingsSection === id;
        continue;
      }
      if (started && child.classList.contains('setting-item')) {
        names.push(child.querySelector('.setting-item-name')?.textContent ?? null);
      }
    }
    return names;
  };

  it('renders the sections in order with Advanced right before Support', () => {
    const { containerEl } = renderTab();
    const ids = Array.from(containerEl.querySelectorAll('[data-dayline-settings-section]'))
      .map((el) => (el as HTMLElement).dataset.daylineSettingsSection);
    expect(ids).toEqual(SETTINGS_SECTION_IDS);
    expect(ids.at(-2)).toBe('advanced');
  });

  it('collapses the Advanced fold by default with its rows inside the hidden container', () => {
    const { containerEl } = renderTab({ weatherEnabled: true });
    const body = advancedBody(containerEl);
    const toggle = advancedToggle(containerEl);

    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    expect(toggle.textContent).toContain(label('supportExpand'));

    // The heading row says what is inside, and stays outside the hidden container.
    const heading = containerEl.querySelector('[data-dayline-settings-section="advanced"]') as HTMLElement;
    expect(heading.querySelector('.setting-item-name')?.textContent).toBe('Advanced');
    expect(heading.querySelector('.setting-item-description')?.textContent).toBe(label('settingsAdvancedDesc'));
    expect(body.contains(heading)).toBe(false);

    const folded = rowNames(body);
    expect(folded).toEqual([
      label('s_thumbnailFilter'),
      label('journalTools'),
      label('weatherTimezone'),
      label('s_cacheTtl'),
      label('s_backfill'),
      label('heicThumbCachePath'),
      label('heicThumbCacheGenerate'),
      label('moodMetadataPath'),
      label('moodExport'),
      label('metadataBackup'),
      label('dataMaintenance'),
    ]);
    // Nothing from the fold leaks into the visible part of the pane.
    const visible = rowNames(containerEl).filter((name) => !folded.includes(name));
    for (const name of folded) expect(visible).not.toContain(name);
  });

  it('opens and closes the fold from the toggle and flips aria-expanded', () => {
    const { containerEl, plugin } = renderTab();
    const body = advancedBody(containerEl);
    const toggle = advancedToggle(containerEl);

    toggle.click();
    expect(body.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain(label('supportCollapse'));

    toggle.click();
    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain(label('supportExpand'));
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('keeps the fold open across a re-render and does not persist the open state', () => {
    const { tab, containerEl, plugin } = renderTab();
    advancedToggle(containerEl).click();

    tab.display();

    expect(advancedBody(containerEl).hidden).toBe(false);
    expect(advancedToggle(containerEl).getAttribute('aria-expanded')).toBe('true');
    expect(containerEl.querySelectorAll('.dayline-settings-advanced-body')).toHaveLength(1);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(JSON.stringify(plugin.settings)).not.toContain('dvanced');

    // A fresh tab starts collapsed again.
    expect(renderTab().containerEl.querySelector('.dayline-settings-advanced-body')).toHaveProperty('hidden', true);
  });

  it('labels each non-empty group inside the fold and skips weather while it is off', () => {
    const groups = (containerEl: HTMLElement) => Array.from(advancedBody(containerEl).children)
      .map((group) => ({
        id: (group as HTMLElement).dataset.daylineSettingsGroup,
        label: group.querySelector('.dayline-settings-advanced-group-label')?.textContent,
        rows: rowNames(group),
      }));

    expect(groups(renderTab({ weatherEnabled: false }).containerEl)).toEqual([
      { id: 'calendar-journal', label: label('settingsCalendarJournal'), rows: [label('s_thumbnailFilter'), label('journalTools')] },
      { id: 'media-privacy', label: label('settingsMediaPrivacy'), rows: [label('heicThumbCachePath'), label('heicThumbCacheGenerate')] },
      { id: 'data-maintenance', label: label('settingsDataMaintenance'), rows: [label('moodMetadataPath'), label('moodExport'), label('metadataBackup'), label('dataMaintenance')] },
    ]);

    const withWeather = groups(renderTab({ weatherEnabled: true }).containerEl);
    expect(withWeather.map((group) => group.id)).toEqual(['calendar-journal', 'weather', 'media-privacy', 'data-maintenance']);
    expect(withWeather[1]).toEqual({
      id: 'weather',
      label: label('settingsWeather'),
      rows: [label('weatherTimezone'), label('s_cacheTtl'), label('s_backfill')],
    });
  });

  it('drops the HEIC generate row, and nothing else, where the desktop converter is missing', () => {
    const { containerEl } = renderTab({}, { capabilities: { isDesktop: false } });
    const media = advancedBody(containerEl).querySelector('[data-dayline-settings-group="media-privacy"]') as HTMLElement;
    expect(rowNames(media)).toEqual([label('heicThumbCachePath')]);
  });

  it('styles the group labels as plain muted text, not as another heading', () => {
    const { containerEl } = renderTab({ weatherEnabled: true });
    const labels = advancedBody(containerEl).querySelectorAll('.dayline-settings-advanced-group-label');
    expect(labels).toHaveLength(4);
    for (const el of Array.from(labels)) {
      expect(el.closest('.setting-item-heading')).toBeNull();
      expect(el.hasAttribute('data-dayline-settings-section')).toBe(false);
    }
    // Only the section headings use setHeading().
    expect(containerEl.querySelectorAll('.setting-item-heading')).toHaveLength(SETTINGS_SECTION_IDS.length);
  });

  it('shows the mood recovery row at the end of the Mood section only when orphans exist', () => {
    const none = renderTab();
    expect(sectionRowNames(none.containerEl, 'mood')).toEqual([label('mirrorMood'), label('reminder')]);
    expect(rowNames(none.containerEl)).not.toContain(label('moodRecoveryTitle'));

    const orphaned = renderTab({}, {
      moodStore: {
        configure: vi.fn(),
        load: vi.fn(async () => {}),
        getOrphans: () => ({ 'Calendar/Daily/gone.md': { mood: 2 } }),
      },
      openMoodRecovery: vi.fn(),
    });
    expect(sectionRowNames(orphaned.containerEl, 'mood'))
      .toEqual([label('mirrorMood'), label('reminder'), label('moodRecoveryTitle')]);
    // It needs attention, so it must not be tucked into the collapsed fold.
    expect(rowNames(advancedBody(orphaned.containerEl))).not.toContain(label('moodRecoveryTitle'));

    const recovery = hoisted.settings.find((setting: any) => setting.name === label('moodRecoveryTitle')) as any;
    recovery.controlEl.querySelector('button').click();
    expect(orphaned.plugin.openMoodRecovery).toHaveBeenCalledTimes(1);
  });

  it('uses an hour dropdown before the toggle instead of the unsupported prompt', async () => {
    const prompt = vi.fn(() => { throw new Error('prompt() is not supported.'); });
    vi.stubGlobal('prompt', prompt);
    try {
      const { containerEl, plugin } = renderTab({ reminderHour: 8 });
      const row = hoisted.settings.find((setting: any) => setting.name === label('reminder')) as any;
      const control = row.controlEl as HTMLElement;

      const select = control.querySelector('select') as HTMLSelectElement;
      expect(Array.from(select.options).map((option) => option.value)).toEqual(Array.from({ length: 24 }, (_, hour) => String(hour)));
      expect(Array.from(select.options).map((option) => option.textContent)).toEqual(
        Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`),
      );
      expect(select.value).toBe('8');
      expect(select.getAttribute('aria-label')).toBe(label('reminderHour'));

      // Dropdown first, toggle last, and no extra clock button.
      expect(Array.from(control.children).map((child) => child.tagName + '.' + child.className))
        .toEqual(['SELECT.', 'DIV.checkbox-container']);
      expect(control.querySelector('button')).toBeNull();

      select.value = '6';
      select.dispatchEvent(new Event('change'));
      await Promise.resolve();
      expect(plugin.settings.reminderHour).toBe(6);
      expect(typeof plugin.settings.reminderHour).toBe('number');
      expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

      (control.querySelector('input[type=checkbox]') as HTMLInputElement).checked = true;
      control.querySelector('input[type=checkbox]')!.dispatchEvent(new Event('change'));
      await Promise.resolve();
      expect(plugin.settings.reminderEnabled).toBe(true);
      expect(prompt).not.toHaveBeenCalled();
      expect(containerEl.querySelector('.extra-setting-button')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defaults the reminder hour to 21:00 when nothing valid is stored', () => {
    for (const reminderHour of [undefined, 99, -1, 'late']) {
      renderTab({ reminderHour });
      const row = hoisted.settings.find((setting: any) => setting.name === label('reminder')) as any;
      expect((row.controlEl.querySelector('select') as HTMLSelectElement).value, String(reminderHour)).toBe('21');
    }
  });

  it('mounts the journal source editor inside the journal sources setting', () => {
    const { tab, containerEl } = renderTab();
    const sources = hoisted.settings.find((setting: any) => setting.name === label('journalSources')) as any;

    expect(sources.settingEl.classList.contains('dayline-source-setting')).toBe(true);
    const editor = sources.settingEl.querySelector(':scope > .dayline-source-editor') as HTMLElement;
    expect(editor).not.toBeNull();
    expect(editor).toBe(tab.sourceEditor.root);
    // The folder field, status line and Apply/Discard all live in that card.
    expect(editor.querySelector('.dayline-source-folder input')).not.toBeNull();
    expect(editor.querySelector('.dayline-source-add')).not.toBeNull();
    expect(editor.querySelector('.dayline-source-advanced')).not.toBeNull();
    expect(editor.querySelector('.dayline-source-status')).not.toBeNull();
    expect(editor.querySelectorAll('.dayline-source-actions button')).toHaveLength(2);
    // Nothing of the editor is left loose below the card.
    expect(Array.from(containerEl.children).some((child) => child.classList.contains('dayline-source-editor'))).toBe(false);
    expect(containerEl.querySelectorAll('.dayline-source-editor')).toHaveLength(1);
  });

  it('remounts the source editor in the new card on a re-render and keeps unsaved edits', () => {
    const { tab, containerEl } = renderTab();
    const firstInput = tab.sourceEditor.root.querySelector('.dayline-source-folder input') as HTMLInputElement;
    firstInput.value = 'Edited/Daily';
    firstInput.dispatchEvent(new Event('input'));

    tab.display();

    const sources = hoisted.settings.find((setting: any) => setting.name === label('journalSources')) as any;
    const editor = sources.settingEl.querySelector(':scope > .dayline-source-editor') as HTMLElement;
    expect(containerEl.querySelectorAll('.dayline-source-editor')).toHaveLength(1);
    expect((editor.querySelector('.dayline-source-folder input') as HTMLInputElement).value).toBe('Edited/Daily');
  });

  it('gives the mood metadata and HEIC cache path inputs the wide path class', () => {
    renderTab();
    for (const key of ['moodMetadataPath', 'heicThumbCachePath']) {
      const row = hoisted.settings.find((setting: any) => setting.name === label(key)) as any;
      expect(row.controlEl.classList.contains('dayline-settings-path-control'), key).toBe(true);
      expect(row.controlEl.querySelector('input[type=text]'), key).not.toBeNull();
    }
    // Other text inputs keep Obsidian's default width.
    const cache = hoisted.settings.find((setting: any) => setting.name === label('s_cacheTtl'));
    expect(cache).toBeUndefined();
    renderTab({ weatherEnabled: true });
    const ttl = hoisted.settings.find((setting: any) => setting.name === label('s_cacheTtl')) as any;
    expect(ttl.controlEl.classList.contains('dayline-settings-path-control')).toBe(false);
  });
});
