// 三个方向共用的示例数据：showcase/Dayline Demo 的 2026 年 7 月虚构日记。
window.DAYLINE = {
  install: 'obsidian://show-plugin?id=dayline-journal',
  github: 'https://github.com/Haoo-7/Obsidian-Dayline',
  moods: { 2: '#ee6a54', 1: '#f0b34f', 0: '#55b6c9', '-1': '#4d6fb8', '-2': '#7652c7' },
  // 2026-07-01 是周三；周一为一周起点时前面空两格。
  leadingBlanks: 2,
  daysInMonth: 31,
  days: [
    { d: 1, title: '第一道光', mood: 1, cover: '02-field', wx: 'sun' },
    { d: 2, title: '田野札记', mood: 2, cover: '02-field', wx: 'cloud-sun' },
    { d: 3, title: '共用的桌子', mood: 0, cover: '03-table', wx: 'cloud' },
    { d: 4, title: '信号花园', mood: 2, cover: '04-garden', wx: 'drizzle' },
    { d: 5, title: '夜间通行证', mood: 1, cover: '05-night', wx: 'cloud', extra: 1 },
    { d: 6, title: '水线', mood: 1, cover: '06-water', wx: 'rain' },
    { d: 7, title: '发布一个小想法', mood: 2, cover: '01-tide', wx: 'sun' },
    { d: 8, title: '更清晰的信号', mood: 1, cover: '03-table', wx: 'cloud-sun' },
    { d: 9, title: '安静缓冲', mood: 0, cover: '05-night', wx: 'cloud' },
    { d: 10, title: '绿色房间', mood: 2, cover: '04-garden', wx: 'rain' },
    { d: 11, title: '松散线索', mood: -1, cover: '03-table', wx: 'storm' },
    { d: 12, title: '下一页', mood: 2, cover: '04-garden', wx: 'cloud-sun' },
    { d: 13, title: '一小段远方', mood: 1, cover: '01-tide', wx: 'sun' },
    { d: 14, title: '现场指南', mood: 2, cover: '02-field', wx: 'sun' },
    { d: 15, title: '工作台', mood: 0, cover: '03-table', wx: 'cloud' },
    { d: 16, title: '绿色间隙', mood: 1, cover: '04-garden', wx: 'drizzle' },
    { d: 17, title: '夜间信号', mood: -1, cover: '05-night', wx: 'cloud' },
    { d: 18, title: '低潮线', mood: 2, cover: '06-water', wx: 'rain' },
    { d: 19, title: '开放回路', mood: 1, cover: '01-tide', wx: 'sun' },
    { d: 20, title: '长线视野', mood: 2, cover: '02-field', wx: 'cloud-sun' },
    { d: 21, title: '收束回路', mood: 2, cover: '03-table', wx: 'cloud' },
  ],
};

// 插件自带的日期格天气图标（icons/badge-*.svg 的内部路径）。
window.DAYLINE.wx = {
  "sun": "<circle cx=\"12\" cy=\"12\" r=\"4\"/> <path d=\"M12 2v2\"/> <path d=\"M12 20v2\"/> <path d=\"m4.93 4.93 1.41 1.41\"/> <path d=\"m17.66 17.66 1.41 1.41\"/> <path d=\"M2 12h2\"/> <path d=\"M20 12h2\"/> <path d=\"m6.34 17.66-1.41 1.41\"/> <path d=\"m19.07 4.93-1.41 1.41\"/>",
  "cloud-sun": "<path d=\"M12 2v2\"/> <path d=\"m4.93 4.93 1.41 1.41\"/> <path d=\"M20 12h2\"/> <path d=\"m19.07 4.93-1.41 1.41\"/> <path d=\"M15.947 12.65a4 4 0 0 0-5.925-4.128\"/> <path d=\"M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z\"/>",
  "cloud": "<path d=\"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z\"/>",
  "drizzle": "<path d=\"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242\"/> <path d=\"M8 19v1\"/> <path d=\"M8 14v1\"/> <path d=\"M16 19v1\"/> <path d=\"M16 14v1\"/> <path d=\"M12 21v1\"/> <path d=\"M12 16v1\"/>",
  "rain": "<path d=\"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242\"/> <path d=\"M16 14v6\"/> <path d=\"M8 14v6\"/> <path d=\"M12 16v6\"/>",
  "storm": "<path d=\"M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973\"/> <path d=\"m13 12-3 5h4l-3 5\"/>"
};
window.DAYLINE.wxSvg = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.DAYLINE.wx[k]}</svg>`;
