import type { MoodScore } from './mood';

export type DisplayLanguage = 'zh' | 'en';
export type DisplayLanguageSetting = DisplayLanguage | 'system';
export type WeekStartSetting = 'system' | 'monday' | 'sunday';

const STRINGS: Record<DisplayLanguage, Record<string, string>> = {
  zh: {
    calendarTitle: '日历',
    timelineTitle: '日记时间线',
    journalIndexLoading: '正在加载日记…',
    journalIndexLoadFailed: '日记加载失败：{error}',
    searchJournal: '搜索日记',
    openFilters: '打开筛选',
    closeFilters: '关闭筛选',
    clearFilters: '清除筛选',
    today: '今天',
    previousMonth: '上个月',
    nextMonth: '下个月',
    jumpToMonth: '跳转到月份',
    year: '年份',
    month: '月份',
    apply: '应用',
    filters: '筛选',
    source: '来源',
    allSources: '全部来源',
    mood: '心情',
    mediaFilter: '媒体',
    mediaAll: '全部媒体',
    mediaAny: '有媒体',
    mediaImage: '图片',
    mediaVideo: '视频',
    mediaAudio: '音频',
    mediaNone: '无媒体',
    locationFilter: '位置',
    journalLocation: '日记位置',
    allLocations: '全部位置',
    noLocation: '无位置',
    tagFilter: '标签',
    allTags: '全部标签',
    monthly: '按月',
    weekly: '按周',
    quarterly: '按季度',
    yearly: '按年',
    recordedDays: '记录天数',
    entries: '条目',
    weekStart: '每周起始日',
    weekStartDesc: '设置日历每周从星期几开始。',
    weekStartSystem: '跟随系统',
    weekStartMonday: '周一',
    weekStartSunday: '周日',
    system: '系统',
    dailyNotes: '日记',
    fromDate: '开始日期',
    toDate: '结束日期',
    allMoods: '全部心情',
    favoritesOnly: '仅收藏',
    favorite: '收藏',
    media: ' 个媒体',
    noResults: '没有符合条件的日记',
    currentStreak: '当前连续',
    longestStreak: '最长连续',
    thisMonth: '本月完成',
    moodTrend: '近七天心情',
    noMood: '暂无心情记录',
    recordMood: '记录当前日记心情',
    createDailyNote: '打开或创建今日笔记',
    mediaMetadata: '媒体信息',
    heicConverting: '正在转换 HEIC……',
    heicConversionFailed: 'HEIC 转换失败',
    heicError: 'HEIC 处理失败',
    cancel: '取消',
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
    moodNote: '心情备注',
    moodNotePlaceholder: '可选：写下此刻的想法……',
    customFeeling: '自定义感受',
    customFeelingPlaceholder: '添加自定义感受',
    addCustomFeeling: '添加',
    noFeelings: '无感受标签',
    moodSaved: '心情已保存',
    moodDeleted: '心情记录已移入恢复列表',
    moodDeleteFailed: '心情记录已移入恢复列表，但笔记标签清理失败：{error}',
    deleteMood: '删除心情记录',
    editMood: '编辑心情记录',
    deleteMoodConfirm: '删除这条心情记录？记录会保留在恢复列表中。',
    moodRecoveryTitle: '恢复心情记录',
    moodRecoveryDescription: '检查被删除或移走的心情记录，并恢复到原始文件路径。',
    moodRecoveryEmpty: '没有可恢复的心情记录',
    moodRecoveryCommand: '打开心情恢复列表',
    moodRestoreDestination: '恢复目标文件',
    restoreMood: '恢复',
    moodRestoreConflict: '目标文件已有心情记录。替换它吗？',
    moodLabelTrends: '感受标签趋势',
    moodLabelUses: '次使用',
    moodAverage: '平均分',
    exportMoodCsvCommand: '导出心情 CSV',
    exportMoodJsonCommand: '导出心情 JSON',
    moodExported: '心情已导出到 {path}',
    moodExportFailed: '心情导出失败：{error}',
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
    settingsGeneral: '常规',
    settingsCalendarJournal: '日历和日记',
    settingsMood: '心情',
    settingsWeather: '天气',
    settingsMediaPrivacy: '媒体元数据与隐私',
    settingsOnThisDay: '去年今日',
    settingsDataMaintenance: '数据与维护',
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
    reminderHour: '提醒时间',
    reminderHourPrompt: '提醒时间（0-23）',
    invalidJournalSources: '日记来源必须是有效的 JSON 数组。',
    journalTools: '日记工具',
    journalToolsDesc: '打开时间线或检测外部导入目录。',
    openTimeline: '打开时间线',
    detectImports: '检测导入',
    detectImportsResult: '找到 {files} 个文件，其中 {noDate} 个没有日期。',
    showTimelineMoodTrend: '显示时间线心情趋势',
    showTimelineMoodTrendDesc: '在日记时间线顶部显示近七天的心情轨迹。',
    moodExport: '心情导出',
    moodExportDesc: '导出心情记录为 CSV 或 JSON。',
    metadataBackup: '元数据备份',
    metadataBackupDesc: '导出或恢复心情元数据备份。',
    dataMaintenance: '数据维护',
    dataMaintenanceDesc: '检查数据完整性或导入 frontmatter 记录。',
    weatherTimezone: '天气时区',
    weatherTimezoneDesc: '日记日期比较和 Open-Meteo 使用的 IANA 时区。auto 使用系统时区。',
    calendarDisplay: '日历显示',
    showCalendarMood: '显示日历心情标记',
    showCalendarMoodDesc: '在日期格显示心情颜色标记；关闭后不会删除心情记录。',
    showCalendarWeatherCard: '显示日历天气卡片',
    showCalendarWeatherCardDesc: '显示月历顶部天气卡片；关闭后不影响日期格天气图标。',
    showCalendarWeatherLocation: '显示天气位置',
    showCalendarWeatherLocationDesc: '在天气卡片中显示配置的地点名称；默认关闭。',
    showCalendarWeatherBadge: '显示日期天气图标',
    showCalendarWeatherBadgeDesc: '显示日期格右上角天气图标；关闭后不影响顶部天气卡片。',
    showCalendarEntryCount: '显示同日记录角标',
    showCalendarEntryCountDesc: '同一天有多篇记录时显示额外篇数，点击角标打开主日记。',
    weatherExtraFields: '天气字段',
    weatherExtraFieldsDesc: '选择天气卡片中显示的字段。体感和湿度默认开启。',
    weatherFieldFeels: '体感温度',
    weatherFieldHumidity: '湿度',
    weatherFieldHigh: '最高温度',
    weatherFieldLow: '最低温度',
    weatherFieldPrecipitation: '降水概率',
    weatherFieldWind: '风速',
    weatherFieldSunrise: '日出',
    weatherFieldSunset: '日落',
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
    journalIndexLoading: 'Loading journal…',
    journalIndexLoadFailed: 'Could not load the journal: {error}',
    searchJournal: 'Search journal',
    openFilters: 'Open filters',
    closeFilters: 'Close filters',
    clearFilters: 'Clear filters',
    today: 'Today',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    jumpToMonth: 'Jump to month',
    year: 'Year',
    month: 'Month',
    apply: 'Apply',
    filters: 'Filters',
    source: 'Source',
    allSources: 'All sources',
    mood: 'Mood',
    mediaFilter: 'Media',
    mediaAll: 'All media',
    mediaAny: 'Any media',
    mediaImage: 'Images',
    mediaVideo: 'Videos',
    mediaAudio: 'Audio',
    mediaNone: 'No media',
    locationFilter: 'Location',
    journalLocation: 'Journal location',
    allLocations: 'All locations',
    noLocation: 'No location',
    tagFilter: 'Tag',
    allTags: 'All tags',
    monthly: 'Monthly',
    weekly: 'Weekly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
    recordedDays: 'recorded days',
    entries: 'entries',
    weekStart: 'Week starts on',
    weekStartDesc: 'Choose the first weekday shown in the calendar.',
    weekStartSystem: 'System',
    weekStartMonday: 'Monday',
    weekStartSunday: 'Sunday',
    system: 'System',
    dailyNotes: 'Daily notes',
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
    mediaMetadata: 'Media metadata',
    heicConverting: 'Converting HEIC…',
    heicConversionFailed: 'HEIC conversion failed',
    heicError: 'HEIC processing failed',
    cancel: 'Cancel',
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
    moodNote: 'Mood note',
    moodNotePlaceholder: 'Optional: add a little context…',
    customFeeling: 'Custom feeling',
    customFeelingPlaceholder: 'Add a custom feeling',
    addCustomFeeling: 'Add',
    noFeelings: 'No feeling labels',
    moodSaved: 'Mood saved',
    moodDeleted: 'Mood moved to the recovery list',
    moodDeleteFailed: 'Mood moved to recovery, but note metadata could not be cleared: {error}',
    deleteMood: 'Delete mood record',
    editMood: 'Edit mood record',
    deleteMoodConfirm: 'Delete this mood record? It will remain in the recovery list.',
    moodRecoveryTitle: 'Recover mood records',
    moodRecoveryDescription: 'Inspect deleted or moved mood records and restore them to their original file path.',
    moodRecoveryEmpty: 'No mood records to recover',
    moodRecoveryCommand: 'Open mood recovery list',
    moodRestoreDestination: 'Restore target file',
    restoreMood: 'Restore',
    moodRestoreConflict: 'The target already has a mood record. Replace it?',
    moodLabelTrends: 'Feeling label trends',
    moodLabelUses: 'uses',
    moodAverage: 'average score',
    exportMoodCsvCommand: 'Export moods as CSV',
    exportMoodJsonCommand: 'Export moods as JSON',
    moodExported: 'Moods exported to {path}',
    moodExportFailed: 'Mood export failed: {error}',
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
    settingsGeneral: 'General',
    settingsCalendarJournal: 'Calendar and journal',
    settingsMood: 'Mood',
    settingsWeather: 'Weather',
    settingsMediaPrivacy: 'Media metadata and privacy',
    settingsOnThisDay: 'On This Day',
    settingsDataMaintenance: 'Data and maintenance',
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
    reminderHour: 'Reminder hour',
    reminderHourPrompt: 'Reminder hour (0-23)',
    invalidJournalSources: 'Journal sources must be a valid JSON array.',
    journalTools: 'Journal tools',
    journalToolsDesc: 'Open the timeline or inspect external import directories.',
    openTimeline: 'Open timeline',
    detectImports: 'Detect imports',
    detectImportsResult: 'Found {files} files; {noDate} have no date.',
    showTimelineMoodTrend: 'Show timeline mood trend',
    showTimelineMoodTrendDesc: 'Show the recent seven-day mood trajectory at the top of the journal timeline.',
    moodExport: 'Mood export',
    moodExportDesc: 'Export mood records as CSV or JSON.',
    metadataBackup: 'Metadata backup',
    metadataBackupDesc: 'Export or restore the mood metadata backup.',
    dataMaintenance: 'Data maintenance',
    dataMaintenanceDesc: 'Check data integrity or import frontmatter records.',
    weatherTimezone: 'Weather timezone',
    weatherTimezoneDesc: 'IANA timezone used for diary dates and Open-Meteo. auto uses the system timezone.',
    calendarDisplay: 'Calendar display',
    showCalendarMood: 'Show mood markers on calendar',
    showCalendarMoodDesc: 'Show mood colors on date cells without deleting mood records when disabled.',
    showCalendarWeatherCard: 'Show the calendar weather card',
    showCalendarWeatherCardDesc: 'Show the weather card above the calendar; date-cell icons are unaffected.',
    showCalendarWeatherLocation: 'Show weather location',
    showCalendarWeatherLocationDesc: 'Show the configured location in the weather card. Disabled by default.',
    showCalendarWeatherBadge: 'Show date weather icons',
    showCalendarWeatherBadgeDesc: 'Show weather icons in the top-right of date cells; the weather card is unaffected.',
    showCalendarEntryCount: 'Show same-day entry count',
    showCalendarEntryCountDesc: 'Show additional entries for a date; clicking it opens the primary daily note.',
    weatherExtraFields: 'Weather fields',
    weatherExtraFieldsDesc: 'Choose weather card fields. Feels-like and humidity are enabled by default.',
    weatherFieldFeels: 'Feels-like temperature',
    weatherFieldHumidity: 'Humidity',
    weatherFieldHigh: 'High temperature',
    weatherFieldLow: 'Low temperature',
    weatherFieldPrecipitation: 'Precipitation probability',
    weatherFieldWind: 'Wind speed',
    weatherFieldSunrise: 'Sunrise',
    weatherFieldSunset: 'Sunset',
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

type LanguageSettings = {
  displayLanguage?: string;
  weatherLanguage?: string;
  weekStart?: WeekStartSetting | string;
};

function systemLocale(): string | undefined {
  const navigatorLocale = typeof navigator !== 'undefined' ? navigator.language : undefined;
  if (navigatorLocale) return navigatorLocale;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch (_) {
    return undefined;
  }
}

function resolveSystemDisplayLanguage(): DisplayLanguage {
  const locale = systemLocale()?.toLowerCase() || '';
  if (locale.startsWith('zh')) return 'zh';
  if (locale.startsWith('en')) return 'en';
  // The plugin only ships Chinese and English. Use English for a known
  // non-Chinese system locale, while keeping the historical Chinese fallback
  // when no locale information is available at all.
  return locale ? 'en' : 'zh';
}

export function normalizeDisplayLanguageSetting(settings: LanguageSettings = {}): DisplayLanguageSetting {
  if (settings.displayLanguage === 'system' || settings.displayLanguage === 'zh' || settings.displayLanguage === 'en') {
    return settings.displayLanguage;
  }
  return settings.weatherLanguage === 'en' ? 'en' : 'zh';
}

export function getDisplayLanguage(settings: LanguageSettings = {}): DisplayLanguage {
  const language = settings.displayLanguage || settings.weatherLanguage;
  if (language === 'system') return resolveSystemDisplayLanguage();
  return language === 'en' ? 'en' : 'zh';
}

export function t(settings: LanguageSettings, key: string, values: Record<string, unknown> = {}): string {
  let value = STRINGS[getDisplayLanguage(settings)][key] ?? STRINGS.en[key] ?? key;
  for (const [name, replacement] of Object.entries(values)) value = value.replace(`{${name}}`, String(replacement));
  return value;
}

export function moodLabelKey(score: MoodScore): string {
  return score === -2 ? 'veryLow' : score === -1 ? 'low' : score === 0 ? 'neutral' : score === 1 ? 'good' : 'veryGood';
}

export function moodLabel(settings: LanguageSettings, score: MoodScore): string {
  return t(settings, moodLabelKey(score));
}

export function feelingLabel(settings: LanguageSettings, id: string): string {
  return t(settings, id);
}

export function formatJournalDate(date: string, settings: LanguageSettings): string {
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
  settings: LanguageSettings,
): string {
  const locale = getDisplayLanguage(settings) === 'en' ? 'en-US' : 'zh-CN';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function resolveWeekStart(settings: LanguageSettings = {}): 0 | 1 {
  if (settings.weekStart === 'sunday') return 0;
  if (settings.weekStart === 'monday') return 1;
  if (settings.weekStart !== 'system') return 0;

  const locale = systemLocale();
  try {
    const localeWithWeekInfo = locale ? new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay?: number } } : null;
    const firstDay = localeWithWeekInfo?.weekInfo?.firstDay;
    if (firstDay === 1) return 1;
    if (firstDay === 7) return 0;
  } catch (_) {
    // Older embedded Chromium versions may not expose Intl.Locale.weekInfo.
  }

  const region = locale?.match(/[-_]([A-Z]{2}|\d{3})$/i)?.[1]?.toUpperCase();
  return region && ['US', 'CA', 'AU', 'NZ', 'JP', 'PH', 'TW', 'HK', 'IL', 'MX'].includes(region) ? 0 : 1;
}

export function getCalendarGridOffset(year: number, monthIndex: number, settings: LanguageSettings = {}): number {
  const rawSundayIndex = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return (rawSundayIndex - resolveWeekStart(settings) + 7) % 7;
}

export function getCalendarWeekdays(settings: LanguageSettings = {}): string[] {
  const locale = getDisplayLanguage(settings) === 'en' ? 'en-US' : 'zh-CN';
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const sundayFirst = Array.from({ length: 7 }, (_, index) => {
    const label = formatter.format(new Date(Date.UTC(2021, 7, 1 + index)));
    return locale === 'zh-CN' ? label.replace(/^(?:星期|周)/, '') : label;
  });
  const start = resolveWeekStart(settings);
  return sundayFirst.slice(start).concat(sundayFirst.slice(0, start));
}
