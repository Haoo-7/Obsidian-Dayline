import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  DISPLAY_LANGUAGE_LABEL_KEYS,
  DISPLAY_LANGUAGE_OPTIONS,
  formatCalendarMonth,
  formatJournalDate,
  getCalendarGridOffset,
  getCalendarWeekdays,
  getDisplayLanguage,
  LOCALE_TAGS,
  moodLabel,
  normalizeDisplayLanguageSetting,
  SUPPORTED_DISPLAY_LANGUAGES,
  t,
} from '../src/i18n';

describe('display language', () => {
  it('migrates weatherLanguage and localizes dates and mood labels', () => {
    expect(getDisplayLanguage({ weatherLanguage: 'zh' })).toBe('zh');
    expect(getDisplayLanguage({ weatherLanguage: 'en' })).toBe('en');
    expect(t({ displayLanguage: 'zh' }, 'searchJournal')).toBe('搜索日记');
    expect(t({ displayLanguage: 'en' }, 'searchJournal')).toBe('Search journal');
    expect(moodLabel({ displayLanguage: 'zh' }, 2)).toBe('很好');
    expect(formatJournalDate('2026-07-18', { displayLanguage: 'zh' })).toContain('7月18日');
    expect(formatCalendarMonth(2026, 8, { displayLanguage: 'zh' })).toBe('2026年8月');
    expect(formatCalendarMonth(2026, 8, { displayLanguage: 'en' })).toBe('August 2026');
    expect(getCalendarWeekdays({ displayLanguage: 'zh' })).toEqual(['日', '一', '二', '三', '四', '五', '六']);
    expect(getCalendarWeekdays({ displayLanguage: 'en' })).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(getCalendarWeekdays({ displayLanguage: 'en', weekStart: 'monday' })).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(getCalendarWeekdays({ displayLanguage: 'zh', weekStart: 'sunday' })).toEqual(['日', '一', '二', '三', '四', '五', '六']);
    expect(getCalendarGridOffset(2026, 7, { weekStart: 'sunday' })).toBe(6);
    expect(getCalendarGridOffset(2026, 7, { weekStart: 'monday' })).toBe(5);
    expect(['zh', 'en']).toContain(getDisplayLanguage({ displayLanguage: 'system' }));
  });

  it('localizes Dayline view menu titles', () => {
    expect(t({ displayLanguage: 'zh' }, 'calendarTitle')).toBe('日历');
    expect(t({ displayLanguage: 'en' }, 'calendarTitle')).toBe('Calendar');
    expect(t({ displayLanguage: 'zh' }, 'timelineTitle')).toBe('日记时间线');
    expect(t({ displayLanguage: 'en' }, 'timelineTitle')).toBe('Journal timeline');
    expect(t({ displayLanguage: 'zh' }, 'untitledJournalTitle')).toBe('标题');
    expect(t({ displayLanguage: 'en' }, 'untitledJournalTitle')).toBe('Title');
  });

  it('localizes asynchronous failure notices', () => {
    expect(t({ displayLanguage: 'zh' }, 'openNoteFailed', { error: '文件不存在' }))
      .toBe('打开笔记失败：文件不存在');
    expect(t({ displayLanguage: 'en' }, 'settingsSaveFailed', { error: 'permission denied' }))
      .toBe('Failed to save settings: permission denied');
  });
});

describe('nine-language display support', () => {
  it('ships nine languages behind the system option', () => {
    expect(SUPPORTED_DISPLAY_LANGUAGES).toEqual(['en', 'zh', 'zh-tw', 'ja', 'ko', 'fr', 'de', 'es', 'ru']);
    expect(DISPLAY_LANGUAGE_OPTIONS).toEqual(['system', ...SUPPORTED_DISPLAY_LANGUAGES]);
    expect(new Set(DISPLAY_LANGUAGE_OPTIONS).size).toBe(DISPLAY_LANGUAGE_OPTIONS.length);
    expect(Object.keys(DISPLAY_LANGUAGE_LABEL_KEYS).sort()).toEqual([...DISPLAY_LANGUAGE_OPTIONS].sort());
    expect(DEFAULT_DISPLAY_LANGUAGE).toBe('en');
  });

  it('resolves every supported language and normalizes persisted settings', () => {
    for (const language of SUPPORTED_DISPLAY_LANGUAGES) {
      expect(getDisplayLanguage({ displayLanguage: language }), language).toBe(language);
      expect(LOCALE_TAGS[language], language).toBeTruthy();
      expect(normalizeDisplayLanguageSetting({ displayLanguage: language }), language).toBe(language);
    }
    expect(LOCALE_TAGS['zh-tw']).toBe('zh-TW');
    expect(LOCALE_TAGS.ja).toBe('ja-JP');
    expect(normalizeDisplayLanguageSetting({ displayLanguage: 'system' })).toBe('system');
    expect(normalizeDisplayLanguageSetting({ weatherLanguage: 'zh' })).toBe('zh');
    expect(normalizeDisplayLanguageSetting({ weatherLanguage: 'en' })).toBe('en');
    expect(normalizeDisplayLanguageSetting({ displayLanguage: 'klingon', weatherLanguage: 'en' })).toBe('en');
    expect(normalizeDisplayLanguageSetting({ displayLanguage: 'klingon' })).toBe('zh');
    expect(normalizeDisplayLanguageSetting({})).toBe('zh');
    expect(normalizeDisplayLanguageSetting()).toBe('zh');
  });

  it('resolves the system language, including traditional Chinese locales', () => {
    vi.stubGlobal('navigator', { language: 'zh-Hant-HK' });
    expect(getDisplayLanguage({ displayLanguage: 'system' })).toBe('zh-tw');
    vi.stubGlobal('navigator', { language: 'ja-JP' });
    expect(getDisplayLanguage({ displayLanguage: 'system' })).toBe('ja');
    vi.stubGlobal('navigator', { language: 'ru' });
    expect(getDisplayLanguage({ displayLanguage: 'system' })).toBe('ru');
    vi.stubGlobal('navigator', { language: 'pt-BR' });
    expect(getDisplayLanguage({ displayLanguage: 'system' })).toBe('en');
    vi.unstubAllGlobals();
  });

  it('formats calendar and journal dates with the language locale tag', () => {
    expect(formatCalendarMonth(2026, 8, { displayLanguage: 'ja' })).toBe('2026年8月');
    expect(formatCalendarMonth(2026, 8, { displayLanguage: 'zh-tw' })).toBe('2026年8月');
    expect(formatCalendarMonth(2026, 8, { displayLanguage: 'ko' })).toBe('2026년 8월');
    expect(formatCalendarMonth(2026, 8, { displayLanguage: 'de' })).toBe('August 2026');
    expect(formatCalendarMonth(2026, 8, { displayLanguage: 'ru' })).not.toBe(formatCalendarMonth(2026, 8, { displayLanguage: 'en' }));
    expect(formatJournalDate('2026-07-18', { displayLanguage: 'zh' })).toBe('7月18日 周六');
    expect(formatJournalDate('2026-07-18', { displayLanguage: 'zh-tw' })).toBe('7月18日 週六');
    expect(formatJournalDate('2026-07-18', { displayLanguage: 'ja' })).toBe('7月18日(土)');
    expect(getCalendarWeekdays({ displayLanguage: 'ja' })).toEqual(['日', '月', '火', '水', '木', '金', '土']);
    expect(getCalendarWeekdays({ displayLanguage: 'zh-tw' })).toEqual(['日', '一', '二', '三', '四', '五', '六']);
    expect(getCalendarWeekdays({ displayLanguage: 'ko' })).toEqual(['일', '월', '화', '수', '목', '금', '토']);
  });

  it('localizes the timeline load-more label in every script', () => {
    expect(t({ displayLanguage: 'zh' }, 'showMoreEntries', { count: 50 })).toBe('再显示 50 条');
    expect(t({ displayLanguage: 'zh-tw' }, 'showMoreEntries', { count: 50 })).toBe('再顯示 50 條');
    expect(t({ displayLanguage: 'en' }, 'showMoreEntries', { count: 50 })).toBe('Show 50 more');
    expect(t({ displayLanguage: 'ja' }, 'showMoreEntries', { count: 50 })).toBe('残り 50 件を表示');
    expect(t({ displayLanguage: 'ko' }, 'showMoreEntries', { count: 50 })).toBe('50개 더 보기');
    expect(t({ displayLanguage: 'de' }, 'showMoreEntries', { count: 50 })).toBe('50 weitere Einträge anzeigen');
    expect(t({ displayLanguage: 'fr' }, 'showMoreEntries', { count: 50 })).toBe('Afficher 50 entrées de plus');
    expect(t({ displayLanguage: 'es' }, 'showMoreEntries', { count: 50 })).toBe('Mostrar 50 entradas más');
    expect(t({ displayLanguage: 'ru' }, 'showMoreEntries', { count: 50 })).toBe('Показать ещё 50');
  });
});
