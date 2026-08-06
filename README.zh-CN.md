<p align="right">
  <a href="README.md">English</a> | <strong>中文</strong>
</p>

---

# Dayline — Obsidian 插件

<p align="center">
  <img src="assets/dayline-wordmark.svg" alt="Dayline 标识" width="250">
</p>

Dayline 是一个集日历、时间线、心情、回顾、天气和照片于一体的可视化日记工具。月历和时间线共同组成主要工作界面；设置页也会显示 Dayline 标识，保持一致的品牌入口。

![Dayline 预览](screenshots/calendar-sidebar-preview.png)

## 功能

- **月历视图** — 显示在左侧侧边栏文件管理器上方
- **图片缩略图** — 自动提取日记中嵌入的图片作为日期格子背景
- **今日高亮** — 今天的日期用全色块填充标识
- **浏览中日期** — 当前在查看的日记用彩色边框标识
- **单击打开** — 点击日期一键打开对应日记
- **自动创建** — 点击没有日记的日期 → 弹出确认框 → 从 Daily Notes 模板自动创建（支持 Templater）
- **可配置日记文件夹** — 支持搜索+浏览选择路径
- **缩略图过滤** — 可选择仅显示文件名以 `YYYY-MM-DD_` 开头的图片
- **EXIF 信息** — 在日历格子和日记图片上查看拍摄信息
- **HEIC/HEIF 支持** — 桌面端自动生成缩略图
- **去年今日** — 查看往年同日的图片和摘要
- **日历条目状态** — 日期格会区分日记记录和仅有缓存天气的日期。多个日记会显示可配置的 `+n` 徽标，点击日期会打开主日记
- **媒体条目** — 图片、视频和音频链接会被规范化并去重。frontmatter 中的 `cover` 会优先作为封面，否则使用第一条可显示媒体；平台支持时可截取视频封面，并可从日历和日记媒体浮层查看图片/视频/音频元数据
- **日记时间线** — 默认显示每日笔记，支持全文搜索，以及日期范围、来源、心情、收藏、位置、标签和媒体类型筛选，并在相邻 Markdown leaf 打开
- **可视化心情** — 五级感受刻度，支持自由备注、内置或自定义标签，默认保存到 vault 内 `Calendar/journal-metadata.json`。删除或重命名的笔记记录可恢复，并提供备份恢复、完整性检查、frontmatter 导入和 JSON/CSV 导出

## 天气功能（可选）

在设置中启用来自 [Open-Meteo](https://open-meteo.com/) 的天气数据（无需 API Key）：

| 设置项 | 说明 |
|---------|------|
| **启用天气** | 切换侧边栏天气卡片显示 |
| **纬度 / 经度** | 用于获取本地天气的坐标 |
| **位置名称** | 显示标签（可选） |
| **温度单位** | 摄氏度或华氏度 |
| **自动获取** | 打开日记时自动获取天气 |
| **缓存时间** | 重新获取前的缓存小时数 |

天气快照保存在插件的 `data.json` 中，不会写入日记 frontmatter。为了兼容旧版本，插件仍会读取已有的 `_calendar_weather`，且仅在坐标和单位匹配时迁移。月历标题下方会显示紧凑的天气卡片，默认包含图标、温度、体感温度和湿度；风速、降水概率、日出、日落和位置均为默认关闭的可选字段。Open-Meteo 请求使用地点自动时区，并会对可重试故障最多重试三次。刷新失败时，兼容的缓存快照会继续显示，并在 UI 标注为过期/离线；这些临时状态不会写入正式缓存。使用 **"刷新当前日期天气"** 命令可强制更新。历史日期使用 Open-Meteo 归档接口，无法提供数据时属于尽力而为。

EXIF GPS 反向地理编码默认关闭。只有显式开启「解析 GPS 地点」后，坐标才会发送到 OpenStreetMap Nominatim 以显示地名。EXIF 解析受文件/区块大小限制；HEIC 转换、视频封面和音频专辑封面也都有资源上限与能力降级，遇到不支持或过大的媒体时会保留为普通附件，不会阻塞日记。外部媒体 URL 会原样保留，索引器不会请求它们。

## 日记索引与外部导入

日记正文仍然是 Markdown。时间线默认只索引每日笔记文件夹（默认 `Calendar/Daily`）。如需兼容 Day One 或 Apple Journal 的导入结果，可在 Journal sources 中添加外部目录；这些文件会作为普通日记显示，不产生独立的条目类型，可使用时间线来源筛选器缩小时间线范围，并可指定 `dateField`。索引按配置日期字段、`date`、`creationDate`、合法日期文件名的顺序识别日期；无法识别日期的文件只进入诊断列表，不使用修改时间猜测。

Day One 或 Apple Journal 导入请先使用专业导入插件，再把输出目录加入 Journal sources：

- [Day One Importer](https://github.com/MarcDonald/obsidian-day-one-importer)
- [Obsidian Importer](https://github.com/obsidianmd/obsidian-importer)

本插件不解析 Day One JSON/ZIP，也不重写导入文件，只在索引层兼容 `creationDate`、`date`、`uuid`、`starred`、`favorite`、`location`、`coordinates`、`latitude` 和 `longitude` 等字段。

心情 JSON 是主数据源，默认不会改动 Markdown。只有打开 Mirror mood to frontmatter 后，保存心情才会显式写入 `mood` 和 `mood_labels`；frontmatter 中已有但尚未导入 JSON 的旧心情允许显示，需运行 Import Frontmatter Mood Metadata 命令后才会写入主存储。重命名会同步键，删除会进入可恢复孤立记录区，导出、备份恢复和完整性检查均可从命令面板执行。

**限制**：归档接口没有覆盖时，历史日期可能没有天气数据。视频封面、HEIC 转换和音频专辑封面取决于浏览器和桌面环境能力；不支持的媒体可能只显示元数据或原始附件，不生成封面。

## 安装

- **BRAT**：在 BRAT 中添加 `Haoo-7/Obsidian-Dayline`
- **手动**：从 [Releases](https://github.com/Haoo-7/Obsidian-Dayline/releases) 下载 `dayline.zip`，解压到 vault 的 `.obsidian/plugins/dayline/`，在 Obsidian 设置中启用插件，运行命令「Open Dayline」

## 文件说明

| 文件 | 说明 |
|------|------|
| `manifest.json` | 插件元信息 |
| `main.js` | Obsidian 发布产物 |
| `src/` | TypeScript 核心模块 |
| `tests/` | 日期、缓存、摘要和安全 DOM 单元测试 |
| `build.mjs` | esbuild 构建脚本 |
| `libheif-bundle.js` | HEIC/HEIF 解码器 |
| `Dayline 插件设计方案.md` | 原始设计文档 |

## 配置

在 Obsidian 设置 → 第三方插件 → Dayline：

| 设置项 | 说明 |
|--------|------|
| **Daily notes folder** | 日记文件夹路径，支持搜索+浏览选择 |
| **Thumbnail filter** | `All embedded images` = 显示日记中所有嵌入图片（默认）；`Only date-prefixed` = 只显示文件名以 `YYYY-MM-DD_` 开头的图片（适合配合 Photo Journal 使用） |
| **Enable weather** | 启用天气功能 |
| **Latitude / Longitude** | 天气坐标（必填） |
| **Location name** | 位置名称（可选） |
| **Temperature units** | 温度单位：摄氏度/华氏度 |
| **Auto-fetch weather** | 打开日记时自动获取天气 |
| **Cache TTL (hours)** | 缓存有效期（小时） |
| **Journal sources** | 每日笔记目录之外的可选外部导入目录 JSON 配置 |
| **Mood metadata path** | vault 内心情 JSON 路径，默认 `Calendar/journal-metadata.json` |
| **Mirror mood to frontmatter** | 默认关闭的 frontmatter 镜像 |
| **Daily reminder** | 可关闭的本地记录提醒 |
| **Show mood markers on calendar** | 显示或隐藏日期格心情颜色标记 |
| **Show calendar weather card** | 显示或隐藏月历顶部天气卡片 |
| **Show date weather icons** | 显示或隐藏日期格右上角天气图标 |
| **Show extra-entry badge** | 显示或隐藏多篇日记日期的 `+n` 徽标 |
| **Weather fields** | 默认启用体感温度和湿度；风速、降水、日出、日落和位置需手动开启 |

## 与 Templater 配合

如果在 Obsidian 的 Daily Notes 插件中配置了模板路径，且安装了 Templater 插件，点击无日记日期创建新文件时会自动通过 Templater 解析模板变量（如 `tp.file.title`、日期、周数等），生成完整内容的日记文件。

## 要求

- Obsidian v1.5.0+
- 日记按 `YYYY-MM-DD.md` 命名
- 图片通过 `![[image.jpg]]` 嵌入到日记中
