// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  notices: [] as string[],
  requestCurrentCoordinates: vi.fn(),
  settings: [] as any[],
}));

vi.mock('obsidian', () => ({
  PluginSettingTab: class {
    app: unknown;
    constructor(app: unknown) { this.app = app; }
    hide() {}
  },
  // Fluent recorder: `addExifPersistMetadataSetting` builds a row through the
  // real Obsidian `Setting` API, so the mock exposes the chain it uses.
  Setting: class {
    constructor(containerEl: unknown) {
      (this as any).containerEl = containerEl;
      (this as any).settingEl = document.createElement('div');
      hoisted.settings.push(this);
    }
    setName(value: string) { (this as any).name = value; return this; }
    setDesc(value: string) { (this as any).desc = value; return this; }
    setHeading() { return this; }
    addToggle(cb: (control: any) => void) {
      const control: any = {
        setValue(value: unknown) { control.value = value; return control; },
        onChange(fn: (value: boolean) => Promise<void>) { control.onChange = fn; return control; },
      };
      (this as any).toggle = control;
      cb(control);
      return this;
    }
    addDropdown(cb: (control: any) => void) {
      const control: any = { addOption() { return control; }, setValue() { return control; }, onChange() { return control; } };
      cb(control);
      return this;
    }
    addText(cb: (control: any) => void) {
      const control: any = { setPlaceholder() { return control; }, setValue() { return control; }, onChange() { return control; } };
      cb(control);
      return this;
    }
    addButton(cb: (control: any) => void) {
      const control: any = { setButtonText() { return control; }, onClick() { return control; } };
      cb(control);
      return this;
    }
    addExtraButton(cb: (control: any) => void) {
      const control: any = { setIcon() { return control; }, setTooltip() { return control; }, onClick() { return control; } };
      cb(control);
      return this;
    }
  },
  Notice: class { constructor(message: string) { hoisted.notices.push(message); } },
  SuggestModal: class {},
  TFolder: class {},
}));

vi.mock('../src/geolocation', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, requestCurrentCoordinates: hoisted.requestCurrentCoordinates };
});

import {
  DEFAULT_MOOD_METADATA_PATH,
  DaylineSettingsTab,
  SETTINGS_ACTION_ROWS,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTION_LABEL_KEYS,
  SETTINGS_TEXT_COMMIT_DELAY_MS,
  addExifPersistMetadataSetting,
  commitJournalSourceSettings,
  createSettingsLocalizer,
  normalizeMoodMetadataPath,
  parseCoordinateSettingValue,
  shouldShowCalendarMoodStyle,
  shouldShowCalendarWeatherOptions,
  shouldShowExifGeocoding,
  shouldShowOnThisDayExcerptSettings,
  shouldShowUseCurrentLocationButton,
  shouldShowWeatherLocationOption,
  shouldShowWeatherSettings,
} from '../src/settings-tab';
import {
  DISPLAY_LANGUAGE_LABEL_KEYS,
  DISPLAY_LANGUAGE_OPTIONS,
  SUPPORTED_DISPLAY_LANGUAGES,
  t,
} from '../src/i18n';
import { shouldShowTimelineMoodTrend, shouldShowTimelineTitles } from '../src/journal-timeline-display';

describe('display language setting', () => {
  it('offers system plus every supported language with a localized label', () => {
    expect(DISPLAY_LANGUAGE_OPTIONS).toEqual(['system', ...SUPPORTED_DISPLAY_LANGUAGES]);
    for (const option of DISPLAY_LANGUAGE_OPTIONS) {
      const labelKey = DISPLAY_LANGUAGE_LABEL_KEYS[option];
      expect(labelKey, `label key for ${option}`).toBeTruthy();
      for (const language of SUPPORTED_DISPLAY_LANGUAGES) {
        const label = t({ displayLanguage: language }, labelKey);
        expect(label, `${language} label for ${option}`).not.toBe('');
        expect(label, `${language} label for ${option}`).not.toBe(labelKey);
      }
    }
  });

  it('lists each language once per locale without duplicate labels', () => {
    for (const language of SUPPORTED_DISPLAY_LANGUAGES) {
      const labels = DISPLAY_LANGUAGE_OPTIONS.map((option) => t({ displayLanguage: language }, DISPLAY_LANGUAGE_LABEL_KEYS[option]));
      expect(new Set(labels).size, `${language} labels`).toBe(DISPLAY_LANGUAGE_OPTIONS.length);
    }
  });

  it('keeps language names recognizable across translations', () => {
    expect(t({ displayLanguage: 'en' }, DISPLAY_LANGUAGE_LABEL_KEYS.ja)).toBe('Japanese');
    expect(t({ displayLanguage: 'ja' }, DISPLAY_LANGUAGE_LABEL_KEYS.ja)).toBe('日本語');
    expect(t({ displayLanguage: 'ja' }, DISPLAY_LANGUAGE_LABEL_KEYS.zh)).toBe('中国語（簡体字）');
    expect(t({ displayLanguage: 'ko' }, DISPLAY_LANGUAGE_LABEL_KEYS.zh)).toBe('중국어 간체');
    expect(t({ displayLanguage: 'zh' }, DISPLAY_LANGUAGE_LABEL_KEYS['zh-tw'])).toBe('繁体中文');
    expect(t({ displayLanguage: 'zh-tw' }, DISPLAY_LANGUAGE_LABEL_KEYS['zh-tw'])).toBe('繁體中文');
    expect(t({ displayLanguage: 'ru' }, DISPLAY_LANGUAGE_LABEL_KEYS.system)).toBe('Система');
    // Non-Latin language names stay in their own script in every non-English locale.
    for (const language of SUPPORTED_DISPLAY_LANGUAGES.filter((item) => item !== 'en')) {
      expect(t({ displayLanguage: language }, DISPLAY_LANGUAGE_LABEL_KEYS.ja), language).toBe('日本語');
      expect(t({ displayLanguage: language }, DISPLAY_LANGUAGE_LABEL_KEYS.ko), language).toBe('한국어');
      expect(t({ displayLanguage: language }, DISPLAY_LANGUAGE_LABEL_KEYS.ru), language).toBe('Русский');
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
      'data-maintenance',
    ]);
    expect(SETTINGS_SECTION_IDS.map((id) => t({ displayLanguage: 'en' }, SETTINGS_SECTION_LABEL_KEYS[id as keyof typeof SETTINGS_SECTION_LABEL_KEYS])))
      .toEqual(['General', 'Calendar and journal', 'Mood', 'Weather', 'Media metadata and privacy', 'On This Day', 'Data and maintenance']);
    expect(SETTINGS_SECTION_IDS.map((id) => t({ displayLanguage: 'zh' }, SETTINGS_SECTION_LABEL_KEYS[id as keyof typeof SETTINGS_SECTION_LABEL_KEYS])))
      .toEqual(['常规', '日历和日记', '心情', '天气', '媒体元数据与隐私', '去年今日', '数据与维护']);
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
