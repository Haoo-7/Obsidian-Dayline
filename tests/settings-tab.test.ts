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
  shouldShowCalendarWeatherOptions,
  shouldShowExifGeocoding,
  shouldShowOnThisDayExcerptSettings,
  shouldShowWeatherLocationOption,
  shouldShowWeatherSettings,
} from '../src/settings-tab';
import { t } from '../src/i18n';
import { shouldShowTimelineMoodTrend } from '../src/journal-timeline-display';

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
    expect(shouldShowExifGeocoding({ showExif: false })).toBe(false);
    expect(shouldShowExifGeocoding({ showExif: true })).toBe(true);
  });

  it('localizes and defaults the timeline mood trend setting', () => {
    expect(shouldShowTimelineMoodTrend({})).toBe(true);
    expect(shouldShowTimelineMoodTrend({ showTimelineMoodTrend: false })).toBe(false);
    expect(t({ displayLanguage: 'zh' }, 'showTimelineMoodTrend')).toBe('显示时间线心情趋势');
    expect(t({ displayLanguage: 'en' }, 'showTimelineMoodTrend')).toBe('Show timeline mood trend');
  });
});
