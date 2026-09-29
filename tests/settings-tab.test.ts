import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  PluginSettingTab: class {},
  Setting: class {},
  Notice: class {},
  SuggestModal: class {},
  TFolder: class {},
}));

import {
  SETTINGS_ACTION_ROWS,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTION_LABEL_KEYS,
  shouldShowCalendarMoodStyle,
  shouldShowCalendarWeatherOptions,
  shouldShowExifGeocoding,
  shouldShowOnThisDayExcerptSettings,
  shouldShowWeatherLocationOption,
  shouldShowWeatherSettings,
  commitJournalSourceSettings,
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
