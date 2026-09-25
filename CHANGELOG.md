# Changelog

## 2.5.0 (2026-09-25)

### Added
- Calendar date cells now use compact filled weather glyphs (Phosphor Icons, MIT) instead of the large Meteocons scene illustrations. The badge maps the weather family — sun, cloud, fog, drizzle, rain, snow, lightning — so a date cell reads at a glance, and the glyph mask replaces the old dark backdrop.

### Changed
- Timeline cards and calendar date cells now share one `bindOpenOnPointer` helper. Both open on `pointerdown` on desktop, so the first click after sidebar focus loss is no longer swallowed by Obsidian's leaf activation, and both wait for `pointerup` on coarse pointers and cancel when the movement exceeds the tap threshold.
- Opening a journal entry no longer splits the workspace on desktop. Calendar, timeline, and the daily-note open path now funnel through `openJournalFile`, which reuses the active or first Markdown leaf, then reveals it and focuses it. `getJournalOpenLeaf` replaces the mobile-only `getMobileMarkdownLeaf` and only creates a tab when the platform is mobile.
- Calendar weather badges shrank from 17px to 12px (10px and 9px in the two narrow-sidebar container queries), with a tighter drop shadow that no longer reads as a plate behind the glyph.

### Verification
- `npm test` passed: 53 test files and 457 tests.
- `npm run typecheck`, `npm run build` (byte-identical `main.js`), `npm run verify:release`, `npm run verify:release:zip`, and `git diff --check` passed.

---

## 2.5.0（2026-09-25）

### 新增
- 日历格子的天气改用紧凑的实心字形（Phosphor Icons，MIT），不再使用大尺寸的 Meteocons 场景插画。图标按天气类别映射（晴、云、雾、毛毛雨、雨、雪、雷），格子一眼可读，并且用字形本身取代了原来的深色底衬。

### 变更
- 时间线卡片和日历格子改为共用一个 `bindOpenOnPointer` helper。桌面端两者都在 `pointerdown` 打开，侧栏失焦后的第一次点击不再被 Obsidian 的 leaf 激活吞掉；粗指针下两者都等到 `pointerup`，移动超过点击阈值就取消。
- 打开日记条目在桌面端不再拆分工作区。日历、时间线和每日笔记打开路径统一走 `openJournalFile`：复用当前或第一个 Markdown leaf，然后 reveal 并聚焦。`getJournalOpenLeaf` 取代只在移动端生效的 `getMobileMarkdownLeaf`，仅在移动端新建标签页。
- 日历天气图标从 17px 缩小到 12px（两个窄侧栏容器查询下分别是 10px 和 9px），投影更紧，不再在字形后面形成一块底板。

### 验证
- `npm test` 通过：53 个测试文件、457 项测试。
- `npm run typecheck`、`npm run build`（`main.js` 字节一致）、`npm run verify:release`、`npm run verify:release:zip` 和 `git diff --check` 通过。

---

## 2.4.1 (2026-09-21)

### Fixed
- Dragging the mood slider to the left edge no longer cancels the gesture. Pointer move/up now follow the document, so overshooting the leftmost handle keeps tracking instead of dropping the drag, and the track keeps enough inset for the handle.

### Changed
- Untitled timeline cards now show a muted "Title"/"标题" placeholder in place of the previous pencil icon, matching Day One. The inline editor still opens empty until a real title is typed.

### Verification
- `npm test` passed: 52 test files and 444 tests.
- `npm run typecheck`, `npm run build`, `npm run verify:release`, `npm run verify:release:zip`, and `git diff --check` passed.

---

## 2.4.1（2026-09-21）

### 修复
- 心情滑块拖到最左端不再中断手势。指针的 move/up 改为跟随 document，越过最左侧圆点后仍继续跟踪，不会丢掉拖拽；轨道也为圆点留出了足够的左右内缩。

### 变更
- 无标题的时间线卡片不再显示铅笔图标，改为与 Day One 一致的灰色「标题」占位文字。行内编辑器打开时仍为空，直到用户输入真实标题。

### 验证
- `npm test` 通过：52 个测试文件、444 项测试。
- `npm run typecheck`、`npm run build`、`npm run verify:release`、`npm run verify:release:zip` 和 `git diff --check` 通过。

---

## 2.4.0 (2026-09-15)

### Added
- On This Day now has a calendar entry setting: off, merged into the weather card, or a header icon. The merged strip shows a past-year thumbnail and date; the header icon sits beside the month controls.
- Calendar mood markers can stay as a corner dot or draw as a bottom color bar with a centered date. Narrow sidebars pin date, weather, and mood to corners so the date stays readable.

### Changed
- Opening On This Day from the calendar uses the selected date, not always today.
- The header “today” jump appears only when the visible month is not the current month, so the slot stays free on this month.

### Verification
- `npm test` passed: 52 test files and 440 tests.
- `npm run typecheck`, `npm run build`, `npm run verify:release`, `npm run verify:release:zip`, and `git diff --check` passed.
- Runtime check in the Obsidian Sandbox vault under plugin ID `dayline-journal`: the merged strip and header icon opened On This Day for the selected date, the today jump stayed hidden on the current month, and no errors were captured.


---

## 2.4.0（2026-09-15）

### 新增
- 「去年今日」增加日历入口设置：关闭、合并进天气卡、或放到顶栏图标。合并条带显示往年封面和日期；顶栏图标放在月份控件旁。
- 日历心情标记可继续用角落圆点，也可改成底部色条并让日期居中。窄侧栏会把日期、天气和心情钉在格子四角，保证日期可读。

### 变更
- 从日历打开「去年今日」时使用当前选中的日期，而不再总是跳到今天。
- 顶栏「今天」按钮只在月历不在本月时出现，本月不再占着那个位置。

### 验证
- `npm test` 通过：52 个测试文件、440 项测试。
- `npm run typecheck`、`npm run build`、`npm run verify:release`、`npm run verify:release:zip` 和 `git diff --check` 通过。
- Obsidian Sandbox 测试库以插件 ID `dayline-journal` 完成运行时检查：合并条带和顶栏图标都会打开选中日期的「去年今日」，本月不显示「今天」按钮，未捕获到错误。

## 2.3.6 (2026-09-15)

### Changed
- Cleared the mechanical warnings from the community review. Timer calls now go through `window` so timers stay correct in popout windows, the capability probes and the Mediabunny bridge cache use a guarded `window` lookup instead of `globalThis`, and both hardcoded `.obsidian` fallbacks were replaced by `vault.configDir` with an early skip when it is empty, so neither site can build an `undefined/plugins/...` path.
- Intentionally ignored promises are now marked with `void`, and the five `setTimeout(async () => ...)` callbacks were wrapped so the timer callback itself stays synchronous. No error handling changed; those bodies already caught internally.

No user-visible behaviour change is intended by this release.

### Verification
- `npm test` passed: 50 test files and 423 tests.
- `npm run typecheck`, `npm run build`, `npm run verify:release`, and `git diff --check` passed.
- Runtime check in an Obsidian vault under plugin ID `dayline-journal`: the optional HEIC decoder still loads from the resolved config directory, device capability probes report desktop correctly, the reminder timer returns a numeric id, the timeline rendered 25 entries, and no errors were captured.


---

## 2.3.6（2026-09-15）

### 变更
- 清除社区审核提出的机械类警告：计时器统一通过 `window` 调用，保证弹出窗口下的计时正确；能力探测与 Mediabunny 桥接缓存改用带保护的 `window` 查找，不再使用 `globalThis`；两处硬编码的 `.obsidian` 兜底改为 `vault.configDir`，取不到时直接跳过，因此不会再拼出 `undefined/plugins/...` 这类路径。
- 明确忽略的 Promise 现以 `void` 标记；5 处 `setTimeout(async () => ...)` 改为让计时器回调本身保持同步。错误处理逻辑未变，这些代码块本来就在内部捕获异常。

本版本不包含有意的界面行为变化。

### 验证
- `npm test` 通过：50 个测试文件、423 项测试。
- `npm run typecheck`、`npm run build`、`npm run verify:release` 和 `git diff --check` 通过。
- Obsidian 测试库以插件 ID `dayline-journal` 完成运行时检查：可选的 HEIC 解码器仍能从解析后的配置目录加载，设备能力探测正确识别桌面端，提醒计时器返回数字 id，时间线渲染 25 条记录，未捕获到错误。
## 2.3.5 (2026-09-14)

### Changed
- Cleared the CSS warnings the community review raised against 2.3.4. The `column-gap`-in-a-grid rule now uses `gap`, the duplicate `background`, `border`, and `max-height` declarations moved into `@supports` blocks so the fallback and the enhancement are no longer duplicates, and the two `:has()` selectors became a `has-title-placeholder` class the timeline view toggles.
- Removed code the review flagged as unused: 39 `catch (_)` bindings became optional catch bindings, two more catch bindings lost their unread error variable, and the unreferenced `SCORES`, `_isImageLink`, `_calendarWeatherIconUrl`, `IMAGE_EXTS`, `CALENDAR_BADGE_MARKUP`, and `CALENDAR_BADGE_ICONS` were deleted. Unused local bindings such as `overlay`, `num`, `detailEl`, `extraEl`, and `statusEl` lost only their names; the calls that create those elements are unchanged.
- The `!important` declarations, the `all: initial` viewport probe, and the deprecated `execCommand` clipboard fallback are intentionally kept.

No user-visible behaviour change is intended by this release.

### Verification
- `npm test` passed: 50 test files and 423 tests.
- `npm run typecheck`, `npm run build`, `npm run verify:release`, and `git diff --check` passed.
- Runtime check in an Obsidian vault under plugin ID `dayline-journal`: 25 timeline entries rendered, the three title-less entries carried `has-title-placeholder` with a computed `padding-bottom` of 24px, both `@supports` blocks were active, and no errors were captured.


---

## 2.3.5（2026-09-14）

### 变更
- 清除社区审核对 2.3.4 提出的 CSS 警告：grid 规则中的 `column-gap` 改用 `gap`；重复的 `background`、`border`、`max-height` 移入 `@supports` 块，使兜底值与增强值不再重复声明；两处 `:has()` 改为由时间线视图切换的 `has-title-placeholder` class。
- 清理审核标记为未使用的代码：39 处 `catch (_)` 改为可选 catch 绑定，另有 2 处不再声明未被读取的错误变量；删除无任何引用的 `SCORES`、`_isImageLink`、`_calendarWeatherIconUrl`、`IMAGE_EXTS`、`CALENDAR_BADGE_MARKUP` 和 `CALENDAR_BADGE_ICONS`。`overlay`、`num`、`detailEl`、`extraEl`、`statusEl` 等未使用的局部变量只去掉变量名，创建对应元素的调用保持不变。
- `!important` 声明、视口探测节点的 `all: initial`、以及已弃用的 `execCommand` 剪贴板兜底均有意保留。

本版本不包含有意的界面行为变化。

### 验证
- `npm test` 通过：50 个测试文件、423 项测试。
- `npm run typecheck`、`npm run build`、`npm run verify:release` 和 `git diff --check` 通过。
- Obsidian 测试库以插件 ID `dayline-journal` 完成运行时检查：时间线渲染 25 条记录，3 条无标题条目的 body 带 `has-title-placeholder`，计算出的 `padding-bottom` 为 24px；两个 `@supports` 块均生效；未捕获到错误。
## 2.3.4 (2026-09-14)

### Fixed
- Obsidian review error: the plugin no longer creates and attaches `<style>` elements at runtime. The plugin and source-editor styles now live in a root `styles.css` that Obsidian loads itself, and the remaining fixed inline styles use CSS classes.
- Obsidian review error: settings sections now use `new Setting(...).setName(...).setHeading()` instead of creating heading elements directly.
- Obsidian review warning: removed the unsupported `dir` field from `manifest.json`.
- Closing the Dayline calendar no longer leaves note-media listeners, `tabIndex`/`aria-label` overrides, or info buttons behind in Markdown notes, so reopening it cannot stack duplicate buttons or call into a closed view.

### Changed
- Added an MIT `LICENSE`.
- `npm run verify:release` and `build.mjs` now fail when `main.js`, `manifest.json`, or `styles.css` is missing or empty, and `npm run package:release` rebuilds `dayline.zip` from the verified runtime set. The archive now ships `styles.css`.

### Verification
- `npm test` passed: 50 test files and 422 tests.
- `npm run typecheck`, `npm run build`, `npm run verify:release`, `npm run verify:release:zip`, and `git diff --check` passed.
- Runtime check in the Obsidian Sandbox vault under plugin ID `dayline-journal`: legacy settings migrated, `styles.css` was confirmed as the applied stylesheet, and calendar, timeline, and settings rendered with no captured errors.


---

## 2.3.4（2026-09-14）

### 修复
- 修复 Obsidian 审核报错：不再在运行时创建并插入 `<style>` 元素。插件与来源编辑器的样式改由根目录 `styles.css` 承载，由 Obsidian 自行加载；其余固定内联样式改用 CSS class。
- 修复 Obsidian 审核报错：设置分区改用 `new Setting(...).setName(...).setHeading()`，不再手工创建标题元素。
- 修复审核警告：从 `manifest.json` 移除不支持的 `dir` 字段。
- 关闭 Dayline 日历时，不再把笔记里的媒体监听、`tabIndex`/`aria-label` 覆盖和媒体信息按钮留在 Markdown 笔记中，重复开关不会累积重复按钮，也不会再触发已关闭视图的回调。

### 变更
- 新增 MIT `LICENSE`。
- `npm run verify:release` 与 `build.mjs` 现在会在 `main.js`、`manifest.json`、`styles.css` 缺失或为空时直接失败；`npm run package:release` 从已验证的运行文件集重新生成 `dayline.zip`，压缩包现在包含 `styles.css`。

### 验证
- `npm test` 通过：50 个测试文件、422 项测试。
- `npm run typecheck`、`npm run build`、`npm run verify:release`、`npm run verify:release:zip` 和 `git diff --check` 通过。
- Obsidian Sandbox 测试库以插件 ID `dayline-journal` 完成运行时验证：旧设置成功迁移，确认实际生效的样式表就是 `styles.css`，日历、时间线与设置页均正常渲染，未捕获到错误。
## 2.3.3 (2026-09-13)

### Changed
- Published a maintenance release to force the Obsidian Community directory to re-evaluate the repository after the release tag format correction. No plugin runtime behavior changed.

### Verification
- `npm test` passed: 48 test files and 400 tests.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.

---

## 2.3.3（2026-09-13）

### 变更
- 发布维护版本，用于在修正 Release 标签格式后强制 Obsidian 社区目录重新检查仓库；插件运行时行为没有变化。

### 验证
- `npm test` 通过：48 个测试文件、400 项测试。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

---

## 2.3.2 (2026-09-13)

### Changed
- Renamed the community directory listing from **Dayline** to **Dayline Journal** to satisfy the directory's unique display-name requirement. Dayline remains the product brand, and the plugin ID remains `dayline-journal`.

### Verification
- `npm test` passed: 48 test files and 400 tests.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.

---

## 2.3.2（2026-09-13）

### 变更
- 为满足社区目录的展示名唯一性要求，条目名称从 **Dayline** 调整为 **Dayline Journal**；产品品牌仍为 Dayline，插件 ID 保持 `dayline-journal`。

### 验证
- `npm test` 通过：48 个测试文件、400 项测试。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

---

## 2.3.1 (2026-09-13)

### Changed
- Changed the internal community plugin ID from `dayline` to `dayline-journal` to avoid the existing marketplace entry. The public plugin name remains **Dayline**.
- Existing settings and weather cache migrate automatically from the previous `dayline` directory when the new plugin data file is absent; Calendar Sidebar 1.x migration remains supported.

### Verification
- `npm test` passed: 48 test files and 400 tests.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.

---

## 2.3.1（2026-09-13）

### 变更
- 为避免与市场中已有条目冲突，内部社区插件 ID 从 `dayline` 改为 `dayline-journal`；发布名仍保持 **Dayline**。
- 新插件数据文件不存在时，旧 `dayline` 目录中的设置和天气缓存会自动迁移；Calendar Sidebar 1.x 的迁移仍然受支持。

### 验证
- `npm test` 通过：48 个测试文件、400 项测试。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。

---

## 2.3.0 (2026-09-13)

### Added
- Added full phone support on iOS and Android: a native mobile Dayline view, calendar/timeline switching, a Markdown header quick-entry action, and return navigation to the original note.
- Added the structured Journal sources editor with folder browsing, source type/date-field controls, per-source enable/remove actions, validation, staged apply, and advanced JSON as a fallback.
- Added month grouping and compact statistics to the journal timeline.
- Added per-date mood drafts, explicit custom-label state, save locking/retry, and keyboard-accessible date and mood controls.
- Added privacy-safe mobile diagnostics and a mobile quick-entry action for Markdown notes.

### Changed
- Reworked the timeline and mood picker around theme variables, container queries, touch targets, visible field labels, stable filter nodes, and complete focus outlines.
- Improved the phone mood picker with keyboard-aware sizing, a compact landscape layout, reliable focus transfer between custom labels and notes, and direct close behavior without an unsaved-changes confirmation layer.
- Kept the note weather overlay as a frosted-glass chip and positioned it below the mobile view header so it no longer competes with toolbar buttons.
- Localized the new journal-source, timeline, mood, and empty/error states across English and Chinese.

### Fixed
- Fixed the mobile mood modal collapsing after keyboard animation and the first-tap failure when moving from a custom feeling to the mood note.
- Fixed mobile weather overlapping host controls, mobile toolbar/card spacing, and mood slider changes during vertical touch scrolling.
- Fixed journal-index mutation races, timeline draft/focus loss, holiday/date-context ambiguity, mood metadata recovery and atomic writes, weather-cache compatibility, and bounded EXIF/HEIC/media handling.

### Verification
- `npm test` passed: 47 test files and 399 tests.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.
- Mobile flows were exercised in Obsidian Sandbox and on an iPhone 13 mini, including mobile navigation, timeline filters, mood editing, keyboard focus transfer, landscape layout, and weather overlay placement.
- Release artifacts are built from the tagged source with no vault data or mood metadata included.

---

## 2.3.0（2026-09-13）

### 新增
- 正式支持 iOS 和 Android 手机端：原生 Dayline 手机视图、日历/时间线切换、Markdown 标题栏快速入口，以及返回原笔记。
- 新增结构化 Journal sources 编辑器，支持文件夹浏览、来源类型/日期字段配置、单条启用/删除、校验、分步应用，并保留高级 JSON 作为备用入口。
- 日记时间线新增按月份分组和紧凑统计。
- 心情编辑器新增按日期草稿、自定义标签状态、保存锁定/重试，以及可键盘操作的日期和心情控件。
- 新增隐私安全的手机诊断信息和 Markdown 笔记快速入口。

### 变更
- 时间线和心情弹窗围绕主题变量、容器查询、触控尺寸、可见字段名、稳定筛选节点和完整焦点轮廓进行了重构。
- 手机心情弹窗支持键盘自适应尺寸和横屏紧凑布局，自定义感受与备注之间可可靠切换焦点；关闭时不再弹出未保存更改确认层。
- 笔记天气浮层保留毛玻璃质感，并定位到手机视图 header 下方，不再与工具栏按钮争抢位置。
- 新增的 Journal sources、时间线、心情和空/错误状态均已接入中英文文案。

### 修复
- 修复手机心情弹窗在键盘动画后塌缩，以及从自定义感受切换到心情备注时首次点击失效的问题。
- 修复手机天气遮挡宿主控件、手机工具栏/卡片间距，以及纵向触摸滚动误调心情值的问题。
- 修复日记索引变更竞态、时间线草稿/焦点丢失、日期上下文不明确、心情元数据恢复与原子写入、天气缓存兼容性，以及 EXIF/HEIC/媒体处理缺少上限的问题。

### 验证
- `npm test` 通过：47 个测试文件、399 项测试。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。
- 已在 Obsidian Sandbox 和 iPhone 13 mini 上跑过手机导航、时间线筛选、心情编辑、键盘焦点切换、横屏布局和天气浮层定位等流程。
- 发布产物由打标签的源码构建，不包含 Vault 数据或心情元数据。

---

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
