import { describe, expect, it } from 'vitest';
import {
  formatCalendarMonth,
  formatJournalDate,
  getCalendarWeekdays,
  getDisplayLanguage,
  moodLabel,
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
  });

  it('localizes Dayline view menu titles', () => {
    expect(t({ displayLanguage: 'zh' }, 'calendarTitle')).toBe('日历');
    expect(t({ displayLanguage: 'en' }, 'calendarTitle')).toBe('Calendar');
    expect(t({ displayLanguage: 'zh' }, 'timelineTitle')).toBe('日记时间线');
    expect(t({ displayLanguage: 'en' }, 'timelineTitle')).toBe('Journal timeline');
  });

  it('localizes asynchronous failure notices', () => {
    expect(t({ displayLanguage: 'zh' }, 'openNoteFailed', { error: '文件不存在' }))
      .toBe('打开笔记失败：文件不存在');
    expect(t({ displayLanguage: 'en' }, 'settingsSaveFailed', { error: 'permission denied' }))
      .toBe('Failed to save settings: permission denied');
  });
});
