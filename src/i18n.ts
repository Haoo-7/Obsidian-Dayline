import type { MoodScore } from './mood';

export type DisplayLanguage = 'zh' | 'en';

const STRINGS: Record<DisplayLanguage, Record<string, string>> = {
  zh: {
    calendarTitle: '日历',
    timelineTitle: '日记时间线',
    searchJournal: '搜索日记',
    openFilters: '打开筛选',
    closeFilters: '关闭筛选',
    clearFilters: '清除筛选',
    fromDate: '开始日期',
    toDate: '结束日期',
    allMoods: '全部心情',
    favoritesOnly: '仅收藏',
    favorite: '收藏',
    media: '张图片',
    noResults: '没有符合条件的日记',
    currentStreak: '当前连续',
    longestStreak: '最长连续',
    thisMonth: '本月完成',
    moodTrend: '近七天心情',
    noMood: '暂无心情记录',
    recordMood: '记录当前日记心情',
    createDailyNote: '打开或创建今日笔记',
    moodTitle: '记录心情',
    moodQuestion: '今天的感受如何？',
    chooseLevel: '选择一个强度',
    addFeelings: '添加情绪标签',
    chooseFeelings: '选择所有符合的标签',
    back: '返回',
    save: '保存',
    selected: '已选择',
    veryLow: '很低',
    low: '较低',
    neutral: '平稳',
    good: '较好',
    veryGood: '很好',
    calm: '平静',
    grateful: '感激',
    anxious: '焦虑',
    tired: '疲惫',
    energized: '精力充沛',
    hopeful: '充满希望',
    sad: '难过',
    focused: '专注',
    overwhelmed: '不堪重负',
    lonely: '孤独',
    frustrated: '沮丧',
    thoughtful: '若有所思',
    content: '满足',
    joyful: '喜悦',
    proud: '自豪',
    inspired: '受到鼓舞',
    moodDate: '记录日期',
    moodDateDesc: '可以选择任意日期，添加或修改那一天的心情。',
    moodSaved: '心情已保存',
    metadataExported: '心情元数据已导出到 {path}',
    metadataExportFailed: '心情元数据导出失败：{error}',
    metadataRestored: '心情元数据备份已恢复',
    metadataRestoreFailed: '心情元数据恢复失败：{error}',
    metadataValid: '心情元数据完整',
    metadataIntegrityIssues: '心情元数据存在问题：结构 {metadata}，记录 {records}，孤立记录 {orphans}，缺少文件 {missing}',
    importedMoods: '已导入 {count} 条心情记录',
    dailyReminder: '今天还没有日记记录',
    language: '显示语言',
    languageDesc: '统一控制插件界面、提示、标签和辅助文本',
    chinese: '中文',
    english: 'English',
    journalSources: '日记来源目录',
    journalSourcesDesc: '配置每日笔记目录和可选外部导入目录。旧版独立条目来源不再默认启用。',
    moodMetadataPath: '心情元数据路径',
    moodMetadataPathDesc: 'vault 内 JSON 路径，JSON 是心情主数据源。',
    mirrorMood: '镜像心情到 frontmatter',
    mirrorMoodDesc: '开启后保存心情时才写入 Markdown 的 mood 和 mood_labels。',
    reminder: '每日提醒',
    reminderDesc: '今天没有日记记录时显示本地提醒。',
    journalTools: '日记工具',
    journalToolsDesc: '打开时间线或检测外部导入目录。',
    openTimeline: '打开时间线',
    detectImports: '检测导入',
    weatherTimezone: '天气时区',
    weatherTimezoneDesc: '日记日期比较和 Open-Meteo 使用的 IANA 时区。auto 使用系统时区。',
    calendarDisplay: '日历显示',
    showCalendarMood: '显示日历心情标记',
    showCalendarMoodDesc: '在日期格显示心情颜色标记；关闭后不会删除心情记录。',
    showCalendarWeatherCard: '显示日历天气卡片',
    showCalendarWeatherCardDesc: '显示月历顶部天气卡片；关闭后不影响日期格天气图标。',
    showCalendarWeatherBadge: '显示日期天气图标',
    showCalendarWeatherBadgeDesc: '显示日期格右上角天气图标；关闭后不影响顶部天气卡片。',
    openCalendar: '打开 Dayline',
    refreshWeather: '刷新当前日期天气',
    openOnThisDay: '打开去年今日',
    calendarMonthLoadFailed: '加载日历月份失败：{error}',
    openNoteFailed: '打开笔记失败：{error}',
    createNoteFailed: '创建日记失败：{error}',
    timelineOpenFailed: '打开时间线条目失败：{error}',
    onThisDayLoadFailed: '加载去年今日失败：{error}',
    settingsSaveFailed: '保存设置失败：{error}',
    viewRefreshFailed: '刷新视图失败：{error}',
    openTimelineCommand: '打开日记时间线',
    newDailyCommand: '打开或创建今日笔记',
    recordMoodCommand: '记录当前日记心情',
    exportMetadataCommand: '导出心情元数据 JSON',
    restoreMetadataCommand: '恢复心情元数据备份',
    integrityCommand: '检查心情元数据完整性',
    importFrontmatterCommand: '导入 frontmatter 心情元数据',
    detectImportsCommand: '检测日记导入目录',
  },
  en: {
    calendarTitle: 'Calendar',
    timelineTitle: 'Journal timeline',
    searchJournal: 'Search journal',
    openFilters: 'Open filters',
    closeFilters: 'Close filters',
    clearFilters: 'Clear filters',
    fromDate: 'From date',
    toDate: 'To date',
    allMoods: 'All moods',
    favoritesOnly: 'Favorites only',
    favorite: 'Favorite',
    media: ' media',
    noResults: 'No journal entries match the filters',
    currentStreak: 'Current streak',
    longestStreak: 'Longest streak',
    thisMonth: 'This month',
    moodTrend: 'Mood, last 7 days',
    noMood: 'No mood records',
    recordMood: 'Record current journal mood',
    createDailyNote: "Open or create today's note",
    moodTitle: 'Record mood',
    moodQuestion: 'How did today feel?',
    chooseLevel: 'Choose a level',
    addFeelings: 'Add feelings',
    chooseFeelings: 'Choose any that fit',
    back: 'Back',
    save: 'Save',
    selected: 'Selected',
    veryLow: 'Very low',
    low: 'Low',
    neutral: 'Steady',
    good: 'Good',
    veryGood: 'Very good',
    calm: 'Calm',
    grateful: 'Grateful',
    anxious: 'Anxious',
    tired: 'Tired',
    energized: 'Energized',
    hopeful: 'Hopeful',
    sad: 'Sad',
    focused: 'Focused',
    overwhelmed: 'Overwhelmed',
    lonely: 'Lonely',
    frustrated: 'Frustrated',
    thoughtful: 'Thoughtful',
    content: 'Content',
    joyful: 'Joyful',
    proud: 'Proud',
    inspired: 'Inspired',
    moodDate: 'Mood date',
    moodDateDesc: 'Choose any date to add or update its mood.',
    moodSaved: 'Mood saved',
    metadataExported: 'Mood metadata exported to {path}',
    metadataExportFailed: 'Mood metadata export failed: {error}',
    metadataRestored: 'Mood metadata backup restored',
    metadataRestoreFailed: 'Mood metadata restore failed: {error}',
    metadataValid: 'Mood metadata is valid',
    metadataIntegrityIssues: 'Mood metadata issues: structure {metadata}, records {records}, orphans {orphans}, missing files {missing}',
    importedMoods: 'Imported {count} mood records',
    dailyReminder: 'No note for today',
    language: 'Display language',
    languageDesc: 'Controls plugin views, notices, labels, and accessible text',
    chinese: '中文',
    english: 'English',
    journalSources: 'Journal source directories',
    journalSourcesDesc: 'Configure the daily-notes directory and optional external import directories.',
    moodMetadataPath: 'Mood metadata path',
    moodMetadataPathDesc: 'Vault-relative JSON path. JSON is the primary mood store.',
    mirrorMood: 'Mirror mood to frontmatter',
    mirrorMoodDesc: 'When enabled, saving a mood writes mood and mood_labels to Markdown.',
    reminder: 'Daily reminder',
    reminderDesc: 'Show a local reminder when today has no note.',
    journalTools: 'Journal tools',
    journalToolsDesc: 'Open the timeline or inspect external import directories.',
    openTimeline: 'Open timeline',
    detectImports: 'Detect imports',
    weatherTimezone: 'Weather timezone',
    weatherTimezoneDesc: 'IANA timezone used for diary dates and Open-Meteo. auto uses the system timezone.',
    calendarDisplay: 'Calendar display',
    showCalendarMood: 'Show mood markers on calendar',
    showCalendarMoodDesc: 'Show mood colors on date cells without deleting mood records when disabled.',
    showCalendarWeatherCard: 'Show the calendar weather card',
    showCalendarWeatherCardDesc: 'Show the weather card above the calendar; date-cell icons are unaffected.',
    showCalendarWeatherBadge: 'Show date weather icons',
    showCalendarWeatherBadgeDesc: 'Show weather icons in the top-right of date cells; the weather card is unaffected.',
    openCalendar: 'Open Dayline',
    refreshWeather: 'Refresh weather for active date',
    openOnThisDay: 'Open On This Day',
    calendarMonthLoadFailed: 'Failed to load the calendar month: {error}',
    openNoteFailed: 'Failed to open note: {error}',
    createNoteFailed: 'Failed to create note: {error}',
    timelineOpenFailed: 'Failed to open timeline entry: {error}',
    onThisDayLoadFailed: 'Failed to load On This Day: {error}',
    settingsSaveFailed: 'Failed to save settings: {error}',
    viewRefreshFailed: 'Failed to refresh the view: {error}',
    openTimelineCommand: 'Open journal timeline',
    newDailyCommand: "Open or create today's note",
    recordMoodCommand: 'Record current journal mood',
    exportMetadataCommand: 'Export mood metadata JSON',
    restoreMetadataCommand: 'Restore mood metadata backup',
    integrityCommand: 'Check mood metadata integrity',
    importFrontmatterCommand: 'Import frontmatter mood metadata',
    detectImportsCommand: 'Detect journal import directories',
  },
};

export function getDisplayLanguage(settings: { displayLanguage?: string; weatherLanguage?: string } = {}): DisplayLanguage {
  return (settings.displayLanguage || settings.weatherLanguage) === 'en' ? 'en' : 'zh';
}

export function t(settings: { displayLanguage?: string; weatherLanguage?: string }, key: string, values: Record<string, unknown> = {}): string {
  let value = STRINGS[getDisplayLanguage(settings)][key] ?? STRINGS.en[key] ?? key;
  for (const [name, replacement] of Object.entries(values)) value = value.replace(`{${name}}`, String(replacement));
  return value;
}

export function moodLabelKey(score: MoodScore): string {
  return score === -2 ? 'veryLow' : score === -1 ? 'low' : score === 0 ? 'neutral' : score === 1 ? 'good' : 'veryGood';
}

export function moodLabel(settings: { displayLanguage?: string; weatherLanguage?: string }, score: MoodScore): string {
  return t(settings, moodLabelKey(score));
}

export function feelingLabel(settings: { displayLanguage?: string; weatherLanguage?: string }, id: string): string {
  return t(settings, id);
}

export function formatJournalDate(date: string, settings: { displayLanguage?: string; weatherLanguage?: string }): string {
  const value = new Date(`${date}T12:00:00`);
  if (getDisplayLanguage(settings) === 'en') {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', weekday: 'short' }).format(value);
  }
  const parts = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(value);
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const weekday = (parts.find((part) => part.type === 'weekday')?.value ?? '').replace('周', '');
  return `${month}月${day}日 周${weekday}`;
}

export function formatCalendarMonth(
  year: number,
  month: number,
  settings: { displayLanguage?: string; weatherLanguage?: string },
): string {
  const locale = getDisplayLanguage(settings) === 'en' ? 'en-US' : 'zh-CN';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function getCalendarWeekdays(
  settings: { displayLanguage?: string; weatherLanguage?: string },
): string[] {
  const locale = getDisplayLanguage(settings) === 'en' ? 'en-US' : 'zh-CN';
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, index) => {
    const label = formatter.format(new Date(Date.UTC(2021, 7, 1 + index)));
    return locale === 'zh-CN' ? label.replace(/^(?:星期|周)/, '') : label;
  });
}
