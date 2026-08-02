# Changelog

## 2.0.1 (2026-08-02)

### Fixed
- Fixed weather and note overlays interfering with each other across multiple calendar views.
- Restored host container positioning when overlays are removed or the plugin unloads.
- Serialized mood metadata updates for note rename/delete events and waited for pending writes on unload.
- Filtered incompatible mood labels when changing mood intensity.
- Hardened metadata export, backup recovery, malformed restore rejection, and integrity diagnostics.

### Changed
- Added independent calendar display switches for mood markers, the weather card, and date-cell weather icons; all default to visible and do not affect stored data or the timeline.

## 2.0.0 (2026-07-19)

### Branding
- Renamed the plugin from Calendar Sidebar to **Dayline**, reflecting its calendar, timeline, mood, memory, weather, and photo workflows.
- Changed the Obsidian plugin ID and install directory to `dayline`.
- Added one-time migration of the old `calendar-sidebar/data.json` into the new plugin directory without overwriting existing new data.

### Added
- Added a TypeScript journal index with multiple source directories and Day One/Apple Journal metadata aliases.
- Added a journal timeline view with search, date, source, mood, and favorite filters.
- Added a vault JSON mood store with atomic writes, backups, rename synchronization, orphan recovery, import/export, and integrity commands.
- Added a two-step five-level mood picker, optional labels, calendar markers, streak statistics, monthly completion, and a local reminder.
- Added explicit frontmatter mood import and opt-in frontmatter mirroring.

### Fixed
- Fixed timeline cards overflowing narrow leaves by constraining grid tracks, text content, and thumbnail columns.
- Fixed daily-note excerpts that retained calendar navigation and icon-prefixed `Freewrite` headings.
- Fixed timeline thumbnails to resolve relative links, defer loading, and fall back to text-only cards when media is unavailable.
- Added a visible-range fallback for deferred thumbnails in Obsidian leaves whose observer callbacks are delayed during initial layout.
- Prevented EXIF metadata from being interpreted as HTML in the shared tooltip.
- Fixed stale On This Day results after daily-note edits.
- Fixed date-prefixed thumbnails inside asset subfolders.
- Fixed weather overlay icons not loading on first render.
- Fixed stale weather cache reuse after location, unit, or timezone changes.
- Fixed local-date/weather timezone mismatches and stale async UI updates.

### Changed
- Simplified the timeline to daily notes by default. `Calendar/Entries` is no longer a default source, and external imports appear as ordinary journal notes without a source filter.
- Replaced timeline mood icons with an accessible five-level color scale and compact seven-day trend cells.
- Added serialized plugin-data writes and unload flushing for weather cache updates.
- Added an opt-in setting for EXIF GPS reverse geocoding.
- Added TypeScript core modules, Vitest tests, and an esbuild build facade.
- The release artifact is now built from `src/` into the root `main.js`; the entry no longer imports the previous JavaScript runtime.

## 1.2.0 (2026-07-18)

### Added
- **On This Day (去年今日)**: Browse past years' diary entries on the same calendar date. Photo-wall grid with 2-column layout, click any card to open that day's note.
- **Date navigation**: Left/right arrows for ±1 day, plus a native date picker in the modal header for jumping to any date.
- **Excerpt system**: Four modes — auto-extract from note body, read from frontmatter field, custom template with variables (`{body}`, `{year}`, `{date}`, plus any frontmatter key), or disable entirely.
- **Reverse geocoding**: GPS coordinates in EXIF tooltips now resolve to place names (e.g. "广州市 · 天河区") via free Nominatim API.
- **Calendar cell markers**: Small accent dots on dates with past-year entries (toggleable, off by default).
- **Sidebar button**: Quick-access "On This Day" button below the weather card (toggleable).
- **Command palette**: `Open On This Day / 打开去年今日` command.
- **Bulk weather backfill**: One-click button in settings to fetch historical weather for all dates without cached data.
- **OnThisDayProvider**: Efficient data layer with single-scan date index, per-MM-DD caching, automatic invalidation.

### Changed
- **Settings page overhaul**: Reorganized into 4 clear sections (📓 Diary / 🌤️ Weather / 📅 On This Day / ⚙️ Other) with conditional field visibility.
- **Weather storage**: Moved from diary YAML (`_calendar_weather`) to plugin `data.json` — zero frontmatter pollution.
- **OTD modal**: Redesigned from carousel pagination to 2-column photo wall — all years visible at once.
- **Sidebar button**: Updated to `pointerdown` event for single-click responsiveness.

### Fixed
- **Multi-tab navigation**: Calendar clicks now open the diary in the active tab instead of always the first tab.
- **Empty cache race condition**: Newly created diary files no longer blocked by stale empty cache.
- **Text-only cards**: When excerpt mode is "none" and no image exists, card now shows only year badge instead of misleading empty text.

---

### 新增
- **去年今日（On This Day）**：翻阅往年同一天的照片和日记摘要。2 列照片墙布局，点击卡片即可打开对应日记。
- **日期导航**：← → 箭头按天翻页，点击日期弹出系统日历选择器，可跳到任意日期。
- **摘要系统**：四种模式——自动提取正文、读取 frontmatter 字段、自定义模板（支持 `{body}` `{year}` `{date}` 及任意 frontmatter 键）、不显示。
- **逆地理编码**：EXIF 浮窗中的 GPS 坐标自动解析为地名（如"广州市 · 天河区"），使用免费 Nominatim API。
- **日历格子标记**：有往年记录的日期右下角显示小圆点（默认关闭，可在设置中开启）。
- **侧边栏按钮**：天气卡片下方的一键「去年今日」按钮（可开关）。
- **命令面板**：`Open On This Day / 打开去年今日` 命令。
- **批量回填天气**：设置中一键拉取所有缺失历史日期的天气数据。

### 变更
- **设置页重构**：分为 4 个清晰区块（📓 日记 / 🌤️ 天气 / 📅 去年今日 / ⚙️ 其他），条件字段按模式显隐。
- **天气数据存储**：从日记 YAML（`_calendar_weather`）迁移到插件 `data.json`，不再污染 frontmatter。
- **去年今日弹窗**：从翻页轮播改为 2 列照片墙——所有年份一览无余。
- **侧边栏按钮**：改用 `pointerdown` 事件，单击即可响应。

### 修复
- **多标签页导航**：日历点击现在会在当前活跃标签页打开日记，而不是总是第一个标签页。
- **空缓存竞争条件**：新建日记文件不再被过期空缓存阻挡。
- **纯文字卡片**：无摘要且无图片时，只显示年份标签，不再显示误导性的空文本。

## 1.1.0 (2026-07-18)

### Added
- **EXIF Metadata Display**: Hover over images in daily notes or calendar cells to see camera info (make, model, lens, aperture, shutter, ISO, focal length, GPS, software).
- **Multi-format EXIF Support**: Parses EXIF from JPEG, PNG, WebP, and HEIC images. Zero external dependencies — custom lightweight parser.
- **HEIC Image Display**: Auto-converts HEIC photos to displayable JPEG thumbnails using libheif-js (WASM). Calendar sidebar backgrounds and note embeds both supported.
- **Locale System**: Full Chinese/English localization for EXIF labels and settings via the existing language selector.
- **Settings Toggle**: "Show image EXIF metadata" option in plugin settings.

### Changed
- Tooltip style: frosted glass design matching the weather overlay.
- Image resolution in notes: uses Obsidian's wikilink resolver (`getFirstLinkpathDest`) for reliable file lookup regardless of vault structure.
- EXIF cache shared across calendar sidebar and note-image features for consistency.

### Fixed
- MutationObserver replaces fixed-delay scanning for note images — tooltip now appears instantly when navigating to a note.

---

### 新增
- **EXIF 元数据展示**：将鼠标悬停在日记或日历中的图片上，即可查看相机信息（厂商、型号、镜头、光圈、快门、ISO、焦距、GPS、软件）。
- **多格式 EXIF 解析**：支持解析 JPEG、PNG、WebP 与 HEIC 图片的 EXIF 信息。零外部依赖，纯自研轻量解析器。
- **HEIC 图片显示**：使用 libheif-js（WASM）自动将 HEIC 照片转换为可显示的 JPEG 缩略图。日历侧边栏背景与笔记内的图片嵌入均支持。
- **多语言系统**：通过既有的语言选择器，为 EXIF 标签与设置提供完整的中英文本地化。
- **设置开关**：在插件设置中新增「显示图片 EXIF 元数据」选项。

### 变更
- 浮窗样式：改为与天气卡片一致的毛玻璃风格。
- 笔记内图片解析：改用 Obsidian 的 wikilink 解析器（`getFirstLinkpathDest`），无论仓库目录结构如何都能可靠定位文件。
- EXIF 缓存：日历侧边栏与笔记图片功能共享同一缓存，行为保持一致。

### 修复
- 笔记图片改用 MutationObserver 替代固定延迟扫描，切换到笔记后浮窗可立即出现。

## 1.0.0 (Initial Release)

- Monthly calendar in left sidebar
- Image thumbnails from daily notes as date cell backgrounds
- Today highlight + browsing-date highlight
- One-click open / auto-create daily notes
- Weather card with Open-Meteo integration
- Configurable daily folder, thumbnail filter, weather settings

### 功能
- 左侧侧边栏月历视图
- 自动提取日记图片作为日期格子背景缩略图
- 今日高亮 + 浏览中日期高亮
- 单击一键打开 / 自动创建日记
- 天气卡片（Open-Meteo 集成）
- 可配置日记文件夹、缩略图过滤、天气设置
