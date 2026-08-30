# Changelog

## 2.2.0 (2026-08-30)

### Added
- Added a desktop fluid mood control to the first step of the mood picker, with continuous pointer dragging, animated Canvas shapes, five-level snapping, keyboard navigation, accessible slider semantics, and reduced-motion support.
- Added focused coverage for fluid value mapping, color interpolation, pointer cancellation and capture failures, keyboard activation, two-step navigation, and saved mood payloads.

### Changed
- The mood picker now tints the full modal surface as the mood changes, using a semantic spectrum from purple and deep blue through calm cyan to warm amber and coral red.
- The second step now carries the selected color forward and presents a compact fluid preview alongside the selected mood, labels, custom feelings, and note fields.
- Calendar mood markers and timeline mood colors now use the same five-color spectrum as the picker.

### Fixed
- Body-only and task-only journal updates no longer rebuild the calendar, preventing visible day-cell flicker while preserving refreshes for date, media, mood, and weather changes.
- Guarded pointer capture and release when synthetic or cancelled pointer events no longer have an active native pointer, preventing `NotFoundError` entries in Obsidian's error buffer.

### Verification
- `npm test` passed: 38 test files and 182 tests.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.
- Verified in Obsidian 1.13.7 with dark and light themes: pointer dragging, five-level snapping, keyboard activation, full-modal color transitions, second-step color inheritance, repeated open/close, and clean error-level console output.
- Deployed the release build to the Main_Topic vault; repository and Vault runtime hashes matched, while `data.json` and `Calendar/journal-metadata.json` remained byte-identical to their pre-deployment state.

---

## 2.2.0（2026-08-30）

### 新增
- 在心情选择器第一步加入桌面端流体心情控件，支持连续指针拖动、Canvas 动态形变、五档吸附、键盘导航、无障碍滑杆语义和减少动态效果设置。
- 增加针对流体数值映射、颜色插值、指针取消与捕获失败、键盘确认、两步流程和心情保存载荷的聚焦测试。

### 变更
- 心情变化现在会为整个弹窗表面同步染色，色谱从紫色、深蓝色经过冷静青蓝色，逐步升温至暖琥珀色和珊瑚红色。
- 第二步会继续继承已选颜色，并用紧凑的流体预览展示已选心情，同时保留标签、自定义感受和备注字段。
- 日历心情标记和时间线心情颜色现在与选择器使用同一套五色色谱。

### 修复
- 仅正文或任务发生变化时不再重建日历，避免日期格可见闪烁；日期、媒体、心情和天气变化仍会正常刷新。
- 当合成或已取消的指针事件不再具有原生活跃指针时，安全处理指针捕获与释放，避免 Obsidian 错误缓冲出现 `NotFoundError`。

### 验证
- `npm test` 通过：38 个测试文件、182 项测试。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。
- 已在 Obsidian 1.13.7 的深色与浅色主题中验证：指针拖动、五档吸附、键盘确认、整窗颜色过渡、第二步颜色继承、反复开关和错误级别控制台均正常。
- 已将发布构建部署到 Main_Topic Vault；仓库与 Vault 的运行时文件哈希一致，`data.json` 和 `Calendar/journal-metadata.json` 与部署前逐字节一致。

---

## 2.1.3 (2026-08-15)

### Changed
- Journal index initialization now runs in the background, so calendar and timeline views do not block workspace restoration in larger vaults.
- Calendar and timeline views now show an explicit loading state while the journal index is being built.

### Fixed
- Re-indexed journal entries after Obsidian metadata-cache updates, so newly parsed image embeds appear without requiring a plugin or vault reload.

### Verification
- `npm test` passed: 36 test files and 170 tests.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.
- Verified in the Main_Topic vault: Dayline reloaded cleanly, the journal index reached 305 entries, and no runtime errors were captured.

---

## 2.1.3（2026-08-15）

### 变更
- 日记索引初始化改为后台运行，日历和时间线不再阻塞较大 Vault 的工作区恢复。
- 日历和时间线在日记索引构建期间显示明确的加载状态。

### 修复
- 在 Obsidian 元数据缓存更新后重新索引日记，使新解析出的图片嵌入无需插件或 Vault 重载即可显示。

### 验证
- `npm test` 通过：36 个测试文件、170 个测试。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。
- 已在 Main_Topic Vault 中验证：Dayline 重载正常，日记索引达到 305 条，未捕获运行时错误。

---

## 2.1.2 (2026-08-11)

### Fixed
- Fixed the seven-day mood trend to render one slot per calendar day, preserving empty days instead of compressing the latest seven mood records.

### Verification
- `npm test` passed: 35 test files and 168 tests.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.

---

## 2.1.2（2026-08-11）

### 修复
- 修复近七天心情趋势按最近七条记录压缩显示的问题；现在每天对应一个固定位置，缺少记录的日期会保留为空槽。

### 验证
- `npm test` 通过：35 个测试文件、168 个测试。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

---

## 2.1.1 (2026-08-11)

### Added
- Added the `showTimelineMoodTrend` setting under Calendar and journal; it controls the recent seven-day mood trajectory in the journal timeline and stays enabled for existing configurations by default.

### Changed
- Restored the timeline summary area with streak statistics and compact mood trend cells.
- Calendar and journal image metadata now keep the complete image EXIF field set in the shared media tooltip.

### Fixed
- Fixed the journal timeline losing its seven-day mood trajectory after the timeline layout simplification.

### Verification
- `npm test` passed: 35 test files and 167 tests.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.

---

## 2.1.1（2026-08-11）

### 新增
- 在“日历和日记”设置中增加 `showTimelineMoodTrend`，可控制日记时间线中的近七天心情轨迹；旧配置默认保持开启。

### 变更
- 恢复时间线顶部的连续记录统计和紧凑心情趋势色块。
- 日历和日记中的图片元数据现在在共享媒体浮窗中保留完整的图片 EXIF 字段。

### 修复
- 修复时间线布局简化后七天心情轨迹消失的问题。

### 验证
- `npm test` 通过：35 个测试文件、167 个测试。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

---

## 2.1.0 (2026-08-07)

### Added
- Desktop-only release scope is explicit in the manifest; mobile support and Quick Capture are not part of this release.
- Reorganized settings into seven focused sections: General; Calendar and journal; Mood; Weather; Media metadata and privacy; On This Day; and Data and maintenance.
- Calendar dates distinguish journal records from weather-only dates, show a configurable `+n` badge for extra entries, display cover/media, and open the primary journal on click.
- Added video and audio media metadata with capability-aware cover fallbacks alongside image metadata.
- Added timeline full-text search and date, source, mood, favorite, location, tag, and media filters.
- Added mood notes, custom labels, recovery, exports, integrity checks, and local trend reports.

### Changed
- Weather defaults to feels-like temperature and humidity. Wind, precipitation, sunrise, sunset, and location are optional settings and default off.
- Weather refresh reliability now retries eligible Open-Meteo failures and keeps compatible stale/offline cache data visible without persisting transient status flags.
- Added the Mediabunny third-party notice for the bundled video/audio metadata runtime.

### Fixed
- Fixed a journal-index startup race that could leave the calendar with a stale empty result after vault restore or early file mutations.
- Removed the dormant calendar filter implementation so calendar behavior matches 2.0.2; filtering remains a timeline feature.

### Verification
- `npm test`, `npm run typecheck`, and `npm run build` passed.
- `git diff --check` and the targeted interface detector passed.
- Desktop Obsidian QA covered settings layout, Dayline logo, calendar covers, `+n` badges, timeline mood entry, and absence of calendar filter UI; plugin reload and error console checks were clean.

---

## 2.1.0（2026-08-07）

### 新增
- 在 manifest 中明确桌面端专属范围；本版本不支持移动端，也不包含 Quick Capture。
- 将设置重组为七个清晰区块：通用、日历与日记、心情、天气、媒体元数据与隐私、去年今日、数据与维护。
- 日历日期区分日记记录和仅有天气的日期；多篇记录显示可配置的 `+n` 徽标，支持封面/媒体显示，点击打开主日记。
- 在图片元数据之外，增加具备能力降级的视频和音频元数据与封面回退。
- 时间线新增全文搜索，以及日期、来源、心情、收藏、位置、标签和媒体筛选。
- 增加心情备注、自定义标签、恢复、导出、完整性检查和本地趋势报告。

### 变更
- 天气默认显示体感温度和湿度；风速、降水、日出、日落和位置为可选设置，默认关闭。
- 天气刷新可靠性增强：对可重试的 Open-Meteo 故障重试，并在刷新失败时继续显示兼容的过期/离线缓存，不写入临时状态标记。
- 为内置视频/音频元数据运行时加入 Mediabunny 第三方许可声明。

### 修复
- 修复日记索引启动竞争：Vault 恢复或早期文件变更后，不再让过期的空结果覆盖日历。
- 移除休眠的日历筛选实现，使日历行为恢复到 2.0.2；筛选仍保留在时间线中。

### 验证
- `npm test`、`npm run typecheck` 和 `npm run build` 均通过。
- `git diff --check` 和定向界面检测通过。
- 已完成桌面端 Obsidian 设置布局、Dayline 标识、日历封面、`+n` 徽标、时间线心情条目及无日历筛选 UI 验证；插件重载和错误控制台检查均无异常。

---

## 2.0.2 (2026-08-05)

### Fixed
- Guarded journal index refreshes and file mutations against stale asynchronous reads, preserving the newest note state.
- Kept calendar and timeline view visibility consistent across workspace restore, close, and plugin unload.
- Added timezone-aware date and reminder handling plus user-facing failure notices for calendar, timeline, and settings operations.
- Isolated EXIF, HEIC, and reverse-geocoding services behind dedicated modules and caches without changing their existing behavior.
- Preserved the HEIC embed fallback when Obsidian has already rendered a native image.

### Changed
- Added a Dayline ribbon menu for independently opening and closing the calendar and timeline views.
- Added shared localization and date helpers, with regression coverage for async refresh, view state, and media handling.
- Added Dayline wordmark assets to the documentation.

### Verification
- 55 automated tests passed.
- TypeScript check and production build passed.
- Tested in a real Obsidian vault with `obsidian plugin:reload id=dayline`; no plugin errors or error-level console messages were captured, the calendar DOM rendered, and the media service instances initialized.

---

## 2.0.2（2026-08-05）

### 修复
- 为日记索引刷新和文件变更加上异步旧读保护，确保最新笔记状态不会被旧结果覆盖。
- 确保日历和时间线视图的可见性状态在工作区恢复、关闭和插件卸载时保持一致。
- 增加时区感知的日期与提醒处理，并为日历、时间线和设置操作增加面向用户的失败提示。
- 将 EXIF、HEIC 和反向地理编码服务隔离到独立模块与缓存中，同时保持原有行为不变。
- 当 Obsidian 已经渲染原生图片时，保留 HEIC 嵌入的回退处理。

### 变更
- 新增 Dayline 功能区菜单，可独立打开或关闭日历和时间线视图。
- 新增共享的本地化和日期辅助函数，并为异步刷新、视图状态和媒体处理增加回归覆盖。
- 在文档中加入 Dayline 标识资源。

### 验证
- 55 项自动化测试通过。
- TypeScript 检查和生产构建通过。
- 已在真实 Obsidian Vault 中执行 `obsidian plugin:reload id=dayline`；未捕获插件错误或错误级别 console 消息，日历 DOM 正常渲染，媒体服务实例正常初始化。

---

## 2.0.1 (2026-08-02)

### Fixed
- Fixed weather and note overlays interfering with each other across multiple calendar views.
- Restored host container positioning when overlays are removed or the plugin unloads.
- Serialized mood metadata updates for note rename/delete events and waited for pending writes on unload.
- Filtered incompatible mood labels when changing mood intensity.
- Hardened metadata export, backup recovery, malformed restore rejection, and integrity diagnostics.

### Changed
- Added independent calendar display switches for mood markers, the weather card, and date-cell weather icons; all default to visible and do not affect stored data or the timeline.

### Verification
- 36 automated tests passed.
- TypeScript check and production build passed.
- Tested in an Obsidian 1.13.4 sandbox with export, restore, corruption recovery, and integrity checks.

---

## 2.0.1（2026-08-02）

### 修复
- 修复多个日历视图之间天气浮层和日记浮层互相干扰的问题。
- 移除浮层或插件卸载时，恢复宿主容器的定位状态。
- 串行处理日记重命名/删除时的心情元数据更新，并在插件卸载前等待待处理写入完成。
- 切换心情强度时，自动过滤不兼容的心情标签。
- 加固心情元数据导出、备份恢复、损坏数据拒绝恢复和完整性诊断流程。

### 变更
- 新增独立的日历显示开关，可分别控制心情标记、天气卡片和日期格天气图标；默认全部显示，且不会影响已保存的数据或时间线。

### 验证
- 36 项自动化测试通过。
- TypeScript 检查和生产构建通过。
- 已在 Obsidian 1.13.4 沙盒中测试导出、恢复、损坏数据恢复和完整性检查。

---

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
