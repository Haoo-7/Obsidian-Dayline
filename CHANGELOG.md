# Changelog

## 2.10.0 (2026-10-08)

HEIC photos taken on an iPhone now appear on every device: the desktop converts each one once into a shared thumbnail cache inside the vault, and phones and tablets read that cache directly without decoding anything.

### Added
- **Cross-device HEIC thumbnails.** Every desktop conversion is persisted into a configurable vault folder (default `.dayline/thumbs`; empty disables the cache) as one JPEG per source file plus an `index.json` manifest. Calendar day cells, timeline covers, On This Day photos, and HEIC note embeds on phones and tablets all read that cache. Matching needs only the source path and byte size, because a phone filesystem may re-report modification times in seconds, in local time, or rounded. The shared folder is written by the desktop only; mobile devices are read-only.
- **Background pre-warm.** Once the journal index is ready, the desktop converts the HEICs the journal references (embeds, `media`/`photos` frontmatter, and the frontmatter `cover`) that the cache is still missing, up to 300 per session, through idle callbacks.
- **Generate everything now.** A desktop-only settings action under Media metadata and privacy converts every referenced HEIC in one run, with inline progress and no per-session cap.
- **Mobile diagnostics report the shared cache state**: enabled, entry count, and the reason the last read missed (`index-missing`, `index-empty`, `no-entry`, `size-mismatch`, `file-missing`, `no-url-api`), with no paths included.

### Fixed
- **A phone no longer deletes the shared cache.** Media events on a mobile device used to run the same "retire this entry" path as the desktop, so a phone deleted the shared thumbnail and its index entry and synced that deletion back upstream, breaking every device. Only the converting desktop may write the shared folder now.
- **An emptied cache folder rebuilds.** A thumbnail that is still in memory now restores the shared copy when the file has gone, and a cache file deleted on another device invalidates the in-memory index instead of being trusted as fresh.
- **Day cells with an unresolvable cover fall back to the no-image placeholder** instead of showing an empty tile that still claimed to have an image.

### Verification
- `npm run typecheck`, `npm test` (70 files / 800 tests, 39 of them new), `npm run build`, `npm run package:release`, `npm run verify:release`, `npm run verify:release:zip` and `git diff --check` pass. On this machine 47 tests in the jsdom-environment suites fail for a pre-existing reason (Node/Vite externalize `node:fs`/`node:path` there); the failing set is byte-identical before and after this change.
- Obsidian Sandbox: the built bundle deployed byte-identical and reloaded with no `dev:errors`. A real HEIC (947,758 bytes) converted to a 33,188-byte 900×675 JPEG, was served back as a blob URL, still matched after an 8-hour mtime shift, and the settings action rebuilt the cache from an emptied folder. `data.json` was rewritten by the plugin itself during the runs (weather cache only) and was restored from its byte-identical backup; `Calendar/journal-metadata.json` is unchanged.
- iPhone 13 mini (real device, Syncthing test vault): confirmed — the HEIC note, its calendar day cell, and the timeline show the photo once the phone ran the read-only build. Android and the Obsidian Sync hint stay open: hidden cache folders are not synced by Obsidian Sync, so those users should point the setting at a visible folder.

---

iPhone 拍的 HEIC 照片现在能在所有设备上显示：桌面端把每张照片转换一次、写入 vault 内的共享缩略图缓存，手机和平板直接读取缓存，完全不需要解码。

### 新增
- **跨设备 HEIC 缩略图。** 桌面端每次转换都会写进一个可配置的 vault 目录（默认 `.dayline/thumbs`，留空关闭），每张源文件一个 JPEG，外加 `index.json` 清单。手机和平板上的日历格子、时间线封面、"去年今日"照片、笔记内嵌 HEIC 都读这份缓存。命中判定只看源文件路径和字节大小——手机文件系统可能把修改时间报成秒、本地时间或取整值。共享目录只由桌面端写入，移动端只读。
- **后台预热。** 日记索引就绪后，桌面端会在空闲时把日记引用到（正文内嵌、frontmatter `media`/`photos`，以及 frontmatter `cover`）但缓存里还缺的 HEIC 逐张转换，每会话上限 300 张。
- **立即补齐全库缓存。** "媒体元数据与隐私"里的桌面端操作，一次跑完全部引用的 HEIC，行内显示进度，不受每会话上限限制。
- **移动端诊断新增共享缓存状态**：是否启用、条目数，以及上次读取失败的原因（`index-missing`、`index-empty`、`no-entry`、`size-mismatch`、`file-missing`、`no-url-api`），不含任何路径。

### 修复
- **手机不再删除共享缓存。** 以前移动端的媒体事件会走和桌面端相同的"注销条目"路径，于是手机删掉共享缩略图和索引条目，又把这次删除同步回上游，导致所有设备都坏掉。现在只有执行转换的桌面端可以写入共享目录。
- **缓存目录被清空后能重建。** 内存里仍持有的缩略图会在共享文件消失时重新补写；被其他设备删除的缓存文件会让内存索引失效，而不再被当作"仍然新鲜"。
- **无法解析封面的日格回退为"无图片"占位**，不再显示一块仍标记着"有图片"的空格子。

### 验证
- `npm run typecheck`、`npm test`（70 个文件 / 800 项测试，其中 39 项为本次新增）、`npm run build`、`npm run package:release`、`npm run verify:release`、`npm run verify:release:zip`、`git diff --check` 全部通过。本机有 47 项 jsdom 环境测试因既有原因失败（Node/Vite 在该环境下把 `node:fs`/`node:path` 外置），失败集合在本次改动前后逐字节一致。
- Obsidian Sandbox：构建产物逐字节部署并重载，`dev:errors` 无错误。一张真实 HEIC（947,758 字节）转换成 33,188 字节、900×675 的 JPEG，能作为 blob URL 读回；把 mtime 人为挪 8 小时后仍能命中；设置里的按钮能从被清空的目录重建缓存。运行期间 `data.json` 由插件自身改写（仅天气缓存），已用逐字节备份还原；`Calendar/journal-metadata.json` 未变。
- iPhone 13 mini（真机，Syncthing 测试库）：已确认——手机运行只读构建后，HEIC 笔记、日历格子和时间线都能显示照片。Android 与 Obsidian Sync 提示仍为待办：Obsidian Sync 不同步隐藏目录，这类用户应把设置指向可见目录。

---

## 2.9.4 (2026-10-06)

Reviewing old diary entries no longer registers weather for those past days under the current address, and weather already recorded for a past day stays pinned.

### Fixed
- **Browsing a past date no longer registers weather.** Opening an old daily note (weather overlay) or selecting an old date in the calendar (weather card) used to fetch that day's weather from Open-Meteo using the currently configured coordinates and persist it into the weather cache — so after moving, or enabling weather later, old entries quietly acquired "weather at the current address" that was never recorded there. Settled historical dates (older than the 7-day revisable window) are now served from the cache only on the passive path; they gain weather only through an explicit act: the card/overlay refresh button, the refresh command, or the settings backfill. Recent dates (today and the revisable window) keep their previous behavior. A past date without recorded weather now shows the card's "no data" state instead of the error state.
- **A historical record can no longer be overwritten from a different place.** The weather cache entry for a past day is the only remaining copy of that day, so persistence now refuses a snapshot that was fetched under different coordinates (a refresh or backfill run after moving) and keeps the pinned record. Same-place refetches — a units or timezone change, sub-kilometre drift — still update the entry.

### Verification
- `npm run typecheck`, `npm test` (69 files / 807 tests, including seven new regression tests), `npm run build`, `npm run build:tablet`, `npm run package:release`, `npm run verify:release`, `npm run verify:release:zip` and `git diff --check` all pass.
- Obsidian Sandbox: `main.js` and `manifest.json` deployed byte-identical and reloaded with no `dev:errors`. The running build reports `2.9.4`, its weather service carries both guards, and a live probe confirmed `getSnapshot` on a settled historical date resolves `null` with zero network requests and no cache write. `data.json` was rewritten once during the day — the legitimate TTL refresh of the `2026-10-06` (today) cache entry — and was restored from its byte-identical backup. `Calendar/journal-metadata.json` is unchanged.

---

回顾以前的日记时，不再按现在的地址为那些过去的日子登记天气；已经记录过的过去日期天气会被固定下来。

### 修复
- **浏览过去日期不再登记天气。** 以前打开旧日记（天气浮层）或在日历里选中过去的日期（天气卡片）时，插件会用当前配置的坐标向 Open-Meteo 请求那一天的天气并写入天气缓存——于是搬过家、或后来才开启天气的库，旧条目会悄悄多出一份"按现在地址登记"的天气。现在对于已定型的历史日期（早于 7 天可修订窗口），被动浏览路径只读缓存；要为过去的日子补天气，必须显式操作：卡片/浮层的刷新按钮、刷新命令，或设置里的批量补全。今天与 7 天窗口内的日期行为不变。没有天气记录的过去日期，卡片会显示"无数据"状态而不是错误状态。
- **历史记录不再被不同地点的数据覆盖。** 过去某天的天气缓存条目是那一天仅存的副本，因此持久化现在会拒绝一份用不同坐标取回的快照（搬家后的刷新或批量补全），保留已固定的记录。同一地点的重取——改温度单位或时区、亚公里级的漂移——仍会正常更新。

### 验证
- `npm run typecheck`、`npm test`（69 个文件 / 807 项测试，含 7 项新增回归测试）、`npm run build`、`npm run build:tablet`、`npm run package:release`、`npm run verify:release`、`npm run verify:release:zip`、`git diff --check` 全部通过。
- Obsidian Sandbox：`main.js` 与 `manifest.json` 逐字节部署并重载，`dev:errors` 无错误。运行中的构建报告 `2.9.4`，其天气服务带有两处修复，实测对历史日期调用 `getSnapshot` 返回 `null`、零网络请求、无缓存写入。运行期间 `data.json` 被改写过一次——`2026-10-06`（今天）缓存条目的正常 TTL 刷新——已用逐字节备份还原。`Calendar/journal-metadata.json` 未变。

---

## 2.9.3 (2026-10-05)

Three performance changes: full journal index rebuilds read entries concurrently, the timeline reuses its date formatters instead of building one per row, and calendar day backgrounds load lazily on mobile.

### Performance
- **Full journal index rebuilds read entries with bounded concurrency.** The rebuild walked every candidate markdown file one at a time, so vault-wide indexing paid the full serial cost of every read. It now fans out across four worker readers pulling from a shared candidate queue, keeping the same abort semantics — a refresh or mutation token change still stops every worker before anything is committed. A regression test drives overlapping reads and asserts the peak stays within the cap of four.
- **The timeline view reuses its Intl.DateTimeFormatters per locale.** Every entry row built a fresh formatter for its weekday/day glyph and its "Updated" stamp, and every month header built another for the month label. Formatter construction is one of the most expensive things Intl does, and long timelines paid it for every rendered node. The three call sites now share module-level caches keyed by locale.
- **Calendar day background images load lazily.** The per-day background node was created with `loading="eager"`, so opening a month asked the browser to fetch every day's background at once. Days now request theirs as they approach the viewport (`loading="lazy"`; `decoding="async"` unchanged).

### Verification
- `npm run typecheck`, `npm test` (69 files / 800 tests), `npm run build`, `npm run build:tablet`, `npm run package:release`, `npm run verify:release`, `npm run verify:release:zip` and `git diff --check` all pass.
- Obsidian Sandbox: `main.js` and `manifest.json` deployed byte-identical and reloaded with no `dev:errors` (`styles.css` is unchanged this release). The running build reports `2.9.3`, and the timeline rendered from it stays correct through the new formatter caches — 31 entries with month headers (2026年9月 / 2026年7月 / 2025年9月), weekday/day glyphs (周二29), and "Updated" stamps all intact. The deployed bundle contains the four-reader constant and `loading:"lazy"` with no `loading:"eager"`, while the 2.9.2 bundle has neither.
- `data.json` was rewritten once during the run — a weather-cache refresh plus the first persistence of the pre-existing `showCalendarWrittenMarker` default (`true`, behaviorally a no-op) — and was restored from its byte-identical backup. `Calendar/journal-metadata.json` is unchanged.

### Notes
- Sandbox only, and partly mobile-only: the lazy-background change lives in the mobile branch (desktop renders a CSS background div, so the Mac window cannot produce an `img`), and the concurrency win shows at vault scales the demo vault cannot stage. Both are covered by the unit suite and deployed-bundle inspection; real-phone behavior stays a residual risk.

---

三处性能改动：日记索引全量重建改为并发读取，时间线复用日期格式化器而不是每行新建一个，日历格子的背景图在移动端改为懒加载。

### 性能
- **日记索引全量重建改为有上限的并发读取。** 以前重建逐个串行遍历所有候选 markdown 文件，全库索引要付完整的串行读取成本。现在由 4 个 worker 从共享候选队列并发读取，并保留同样的中止语义——refresh 或 mutation token 一变，所有 worker 都会在提交任何结果前停止。新增回归测试驱动并发读取，并断言峰值不超过 4 的上限。
- **时间线视图按 locale 复用 Intl.DateTimeFormatter。** 以前每条目行都为星期/日期字符和"更新于"时间各新建一个 formatter，每个月标题再建一个。formatter 的构造成本是 Intl 里最贵的操作之一，长时间线在每个渲染节点上都要付一次。三处调用点现在共享以 locale 为键的模块级缓存。
- **日历格子背景图改为懒加载。** 以前每日背景节点用 `loading="eager"` 创建，打开一个月就要求浏览器立刻抓取整月的背景图。现在随滚动接近视口才加载（`loading="lazy"`；`decoding="async"` 不变）。

### 验证
- `npm run typecheck`、`npm test`（69 个文件 / 800 项测试）、`npm run build`、`npm run build:tablet`、`npm run package:release`、`npm run verify:release`、`npm run verify:release:zip`、`git diff --check` 全部通过。
- Obsidian Sandbox：`main.js` 与 `manifest.json` 逐字节部署并重载，`dev:errors` 无错误（本次 release 未改 `styles.css`）。运行中的构建报告 `2.9.3`，由它渲染的时间线经过新的 formatter 缓存后依旧正确——31 条条目，月份标题（2026年9月 / 2026年7月 / 2025年9月）、星期日期字符（周二29）、"更新于"时间全部完好。部署包里含 4-reader 常量与 `loading:"lazy"` 且没有 `loading:"eager"`，而 2.9.2 的包两者相反。
- 运行期间 `data.json` 被改写过一次——天气缓存刷新，外加既有的 `showCalendarWrittenMarker` 默认值（`true`，行为上无变化）首次被持久化——已用逐字节备份还原。`Calendar/journal-metadata.json` 未变。

### 备注
- 仅有 Sandbox 证据，且部分改动只在移动端生效：懒加载位于移动端分支（桌面端渲染 CSS 背景的 div，Mac 窗口产生不出 `img`），并发读取的收益也要在大库里才显现，演示库无法呈现。两者由单元测试套件与部署包比对证明；真机行为仍是残留风险。

---

## 2.9.2 (2026-10-05)

One fix: timeline entries written on the same day now read as one group instead of looking like two unrelated days.

### Fixed
- **Timeline entries written on the same day read as one group.** Every card drew a separator below it and repeated the weekday/day glyph in the left column, so two notes of one day looked like two unrelated days. Adjacent cards sharing a journal date now drop the separator between them, and only the group's first card shows the weekday and day; each card keeps its own mood dot and "Updated" time.

### Verification
- `npm run typecheck`, `npm test` (69 files / 799 tests), `npm run build`, `npm run build:tablet`, `npm run package:release`, `npm run verify:release`, `npm run verify:release:zip` and `git diff --check` all pass.
- Obsidian Sandbox: deployed byte-identical and reloaded with no `dev:errors`. The timeline rendered from the running build keeps the demo's same-day pair (`2026-07-05-evening` before `2026-07-05`) as one group — `dev:dom` counts exactly one `.journal-timeline-entry.has-same-day-next`, that card's computed `border-bottom-color` is transparent, and the following card renders no weekday/day glyph while keeping its mood dot; neighboring different days keep both separator and date.

### Notes
- Sandbox only: the grouped cards were verified in the Mac desktop window; phone and tablet layouts share the same renderer and CSS but were not exercised on a real device, which stays a residual risk.

---

一处修复：同一天写下的时间线条目现在归为一组，而不是看起来像互不相干的两天。

### 修复
- **同一天写下的时间线条目归为一组。** 以前每张卡片下方都画分隔线，左列还重复星期和日期，同一天的两条记录看起来像互不相干的两天。现在相邻的同日期卡片之间不再有分隔线，星期和日期只出现在该组第一张卡片上；每张卡片保留自己的心情圆点和"更新于"时间。

### 验证
- `npm run typecheck`、`npm test`（69 个文件 / 799 项测试）、`npm run build`、`npm run build:tablet`、`npm run package:release`、`npm run verify:release`、`npm run verify:release:zip`、`git diff --check` 全部通过。
- Obsidian Sandbox：逐字节部署，重载后 `dev:errors` 无错误。运行中的构建把演示库里同一天的两条记录（`2026-07-05-evening` 在 `2026-07-05` 之前）归为一组——`dev:dom` 恰好数到一个 `.journal-timeline-entry.has-same-day-next`，该卡片的计算 `border-bottom-color` 为透明，后一张卡片不再渲染星期和日期但保留心情圆点；相邻的不同日期仍保留分隔线和日期。

### 备注
- 仅有 Sandbox 证据：分组卡片在 Mac 桌面窗口验证；手机与平板布局共用同一渲染器和 CSS，但未在真机上验证，仍是残留风险。

---

## 2.9.1 (2026-10-05)

Three fixes: editor placeholder images stop claiming media info controls, Windows desktops without touch hardware stop being treated as touch devices, and the language dropdown becomes readable no matter which UI language you landed in.

### Fixed
- **Editor placeholder images no longer get media info controls.** Live Preview scatters CodeMirror placeholder widgets (`img.cm-widgetBuffer`) through the editor, and the note-media scan instrumented every `<img>` it found — each line's placeholder carried an `aria-label`, a tabindex, hover listeners, and, on touch devices, a visible info button that flashed as lines activated. The scan now skips placeholder widgets and requires a real image source, the same extension validation the embed path already had; real `![[…]]` images keep hover EXIF and the touch button.
- **Windows desktops without touch hardware are no longer treated as touch devices.** Chromium on Windows reports `maxTouchPoints = 10` on machines with no touchscreen, and that alone flipped the plugin into its touch behavior — oversized targets and always-visible media info buttons. Touch now requires a coarse-pointer media query (primary or any pointer) or Obsidian's own mobile flag; touch-point counts only corroborate when no pointer query exists.
- **Every display language is listed under its own name.** The language dropdown translated language names into the active UI language, so a user facing an unfamiliar UI — Russian showing "Упрощенный китайский" — had no readable way back. Each language now appears as its endonym (English, 简体中文, 繁體中文, 日本語, 한국어, Français, Deutsch, Español, Русский) in every UI language; only the "system" entry stays localized, because it is an instruction rather than a language name.

### Verification
- `npm run typecheck`, `npm test` (69 files / 796 tests), `npm run build`, `npm run build:tablet`, `npm run package:release`, `npm run verify:release`, `npm run verify:release:zip` and `git diff --check` all pass.
- Obsidian Sandbox: deployed byte-identical and reloaded with no `dev:errors`. Before the fix, 91 of 91 `img.cm-widgetBuffer` placeholders in the live DOM carried the media `aria-label`; after, 46 of 46 are clean while a real `![[007.png]]` embed keeps its instrumentation. The language dropdown rendered from the running build lists endonyms under the Chinese, Russian, and Traditional Chinese UIs alike — `Система` stays localized, every language entry is its own name.
- `data.json` was rewritten once by a weather-cache fetch and nothing else; restored from its byte-identical backup. `Calendar/journal-metadata.json` is unchanged.

### Notes
- Sandbox only: it is a Mac desktop window with a fine pointer and `maxTouchPoints = 0`, so the Windows `coarsePointer` fix is proven by unit tests that simulate Chromium's reported values, not by a real Windows machine, and the touch info button flow was not exercised on a real phone. Both stay residual risks.

---

三处修复：编辑器占位图片不再冒领媒体信息按钮，没有触屏硬件的 Windows 桌面不再被当成触屏设备，语言下拉不管落在哪种界面语言里都读得懂。

### 修复
- **编辑器占位图片不再冒领媒体信息控件。** Live Preview 会在编辑器里散布 CodeMirror 占位 widget（`img.cm-widgetBuffer`），而笔记媒体扫描见 `<img>` 就处理——每一行的占位符都带着 `aria-label`、tabindex、悬停监听，触屏设备上还会出现随行激活闪现的可见 info 按钮。现在扫描跳过占位 widget，并要求真实的图片 src，与 embed 路已有的扩展名校验对齐；真正的 `![[…]]` 图片保留悬停 EXIF 和触屏按钮。
- **没有触屏硬件的 Windows 桌面不再被当成触屏设备。** Windows 上的 Chromium 在无触屏的机器上也报 `maxTouchPoints = 10`，仅这一条就把插件切进触屏行为——放大的点击目标和常驻的媒体信息按钮。现在触屏判定要求 coarse 指针媒体查询（主指针或任意指针）命中，或 Obsidian 自己的移动端标志；触点数只在指针查询完全不可用时作为回退。
- **每种语言都用它自己的名字列出。** 语言下拉会把语言名翻译成当前界面语言，面对陌生界面的人（俄语界面显示"Упрощенный китайский"）找不到回去的路。现在每种语言在所有界面语言下都以本族语名出现（English、简体中文、繁體中文、日本語、한국어、Français、Deutsch、Español、Русский）；只有"系统"一项保持本地化，因为它是指令而不是语言名。

### 验证
- `npm run typecheck`、`npm test`（69 个文件 / 796 项测试）、`npm run build`、`npm run build:tablet`、`npm run package:release`、`npm run verify:release`、`npm run verify:release:zip`、`git diff --check` 全部通过。
- Obsidian Sandbox：逐字节部署，重载后 `dev:errors` 无错误。修复前真实 DOM 里 91 个 `img.cm-widgetBuffer` 占位符全部带着媒体 `aria-label`；修复后 46 个全部干净，而真实的 `![[007.png]]` 嵌入保留完整仪表。用运行中的构建渲染语言下拉，中文、俄语、繁中三种界面下列出的都是本族语名——`Система` 保持本地化，语言项全部用自己的名字。
- 运行期间 `data.json` 被改写过一次，内容仅为天气缓存抓取，别无改动；已用逐字节备份还原。`Calendar/journal-metadata.json` 未变。

### 备注
- 仅有 Sandbox 证据：那是 Mac 桌面窗口，精确指针、`maxTouchPoints = 0`，所以 Windows 的 `coarsePointer` 修复由模拟 Chromium 上报值的单元测试证明，而不是真实 Windows 机器；触屏 info 按钮流程也没有在真手机上走过。这两项都还是残留风险。

---

## 2.9.0 (2026-10-04)

Three things: a journaled date now fills its whole calendar cell with the accent color, mood marks survive file sync and finally appear on phones, and the phone cell row lost one control.

### Added
- **Written days fill with the accent color** (`showCalendarWrittenMarker`, on by default). A journaled date without a photo fills its entire cell with the theme accent, so a month of writing reads at a glance; photo dates already fill with the image itself. The toggle sits in the calendar display group and is localized in all nine languages. Today changes from an accent fill to an accent ring for the same reason: the fill now means *written*, so an unwritten today must not claim otherwise.
- **The calendar mood pip on phones.** The phone layout suppressed every in-cell control, which left a phone's month grid with no mood marker at all. The pip claims its own press, so it never starts the date gesture; entry count and media controls stay outside the cell. It keeps the compact tablet sizing — a roomy touch-desktop pip would swallow most of a 48px cell — and the empty state stays faintly visible, since neither a phone nor a tablet has hover to reveal it.

### Fixed
- **Mood marks survive file sync.** The metadata file was committed by writing a temporary file and renaming it over the original, which a sync engine can observe as the primary file going missing and propagate as a deletion to other devices. Commits now happen in place behind a `.bak` copy.
- **A stale synced copy heals instead of overwriting.** Every real deletion leaves a tombstone, so a record that exists in the merge base, is unchanged locally and is simply absent on disk was lost to an older synced file rather than deleted: the next write re-seeds it, and a reconcile pass on load does the same, so two devices converge instead of clobbering each other. Tombstones are deliberately excluded — a recreated note must stay able to expose a fresh record even while this session still holds the old deletion.
- **An orphaned mood returns when its note does.** Sync engines replace files as delete + recreate, which moved the mood to the recovery list and hid it until the user restored it by hand; it now restores itself once the file reappears at the same path. A live record at the destination always wins, and a file created before the orphaning is not a recreation.

### Removed
- **The phone return-to-note arrow.** Phone navigation is swipe-first — the panel and the note are one swipe apart — so the arrow, its always-visible hint, the return-leaf plumbing and the nine-language strings came out; the cell row is one control shorter.

### Verification
- `npm run typecheck`, `npm test` (69 files / 791 tests), `npm run build`, `npm run build:tablet`, `npm run package:release`, `npm run verify:release`, `npm run verify:release:zip` and `git diff --check` all pass.
- Obsidian Sandbox: 2.9.0 deployed byte-identical (`main.js` `6201135f…`, `manifest.json` `aa896e07…`, `styles.css` `cc4eb753…`), reloaded with no `dev:errors`. The loaded manifest reports `2.9.0` and `showCalendarWrittenMarker` is a boolean `true`. In the live DOM, September 2026 renders 7 `.cal-written` cells with the accent background and white day numbers, while today in October — unwritten — carries the inset accent ring and no fill.
- `data.json` was rewritten during the run by a weather-cache fetch of 2026-10-04 and nothing else; restored from its byte-identical backup. `Calendar/journal-metadata.json` is unchanged.

### Notes
- Sandbox only: it is a tablet-like desktop window, so the phone mood pip, the compact sizing, and the swipe-first row without the arrow were not exercised on a real device, and the sync fixes need two devices behind a real sync engine. All four stay residual risks.
- The fill ships on by default, so an existing install changes appearance the moment it updates: written days fill, today becomes a ring.

---

三件事：写了日记的日期会用主题色填满整个日历格子，心情标记扛得住文件同步并终于在手机上出现，手机端的格子行少掉一个控件。

### 新增
- **已写日期用主题色填满**（`showCalendarWrittenMarker`，默认开启）。有日记但没有照片的日期用主题强调色填满整个格子，一个月的书写量一眼可读；有照片的日期本来就用照片填满。开关在日历显示设置组里，九种语言都已翻译。今天也因此从填充改成描边：填充现在表示"已写"，没写的今天不能谎称写了。
- **手机端显示日历心情小圆点。** 手机布局此前屏蔽了所有格子内控件，结果手机的月视图压根没有心情标记。小圆点自己接管按压，不会触发起日期手势；条目数和媒体控件仍然放在格子外。它沿用平板的紧凑尺寸——桌面那种大圆点在 48px 的格子里会占掉大半、还会抢掉想点日期的手势——并且因为手机和平板都没有 hover，空状态保持隐约可见。

### 修复
- **心情标记不再被同步吃掉。** 元数据原先是"写临时文件再 rename 覆盖"提交的，同步引擎可能把主文件短暂缺失当成删除，并传播到其他设备。现在改为原地提交，并留一份 `.bak`。
- **过期的同步副本会自愈，而不是覆盖。** 真正的删除都会留下 tombstone，所以"合并基准里有、本地没改、磁盘上却不见了"的记录是被旧副本冲掉，而不是被删除：下一次写入会重新补回，加载时也多了一次对账做同样的事，两台设备因此收敛而不是互相抹掉。tombstone 故意不对账——本次会话仍持有旧删除时，重建的笔记依然要能带出一条新记录。
- **笔记回来，孤儿心情也回来。** 同步引擎用"删除 + 重建"替换文件，这会把心情挪进恢复列表、藏起来等用户手动恢复；现在文件在同一位置重新出现就自动恢复。目标位置已有有效记录时以它为准，创建时间早于孤儿化时刻的文件不算重建。

### 移除
- **手机端的"返回笔记"箭头。** 手机导航以滑动为主——面板与笔记之间就一次滑动——按钮、常驻提示、return-leaf 相关代码和九种语言的文案一起去掉，格子行少一个控件。

### 验证
- `npm run typecheck`、`npm test`（69 个文件 / 791 项测试）、`npm run build`、`npm run build:tablet`、`npm run package:release`、`npm run verify:release`、`npm run verify:release:zip`、`git diff --check` 全部通过。
- Obsidian Sandbox：2.9.0 已逐字节部署（`main.js` `6201135f…`、`manifest.json` `aa896e07…`、`styles.css` `cc4eb753…`），插件重载后 `dev:errors` 无错误。运行中的 manifest 报 `2.9.0`，`showCalendarWrittenMarker` 是布尔 `true`。真实 DOM 里九月 2026 渲染出 7 个 `.cal-written` 格子，主题色背景配白色数字；十月没写的今天只有内嵌强调色圆环、没有填充。
- 运行期间 `data.json` 被改写，内容仅为新增 2026-10-04 的天气缓存，别无改动；已用逐字节备份还原。`Calendar/journal-metadata.json` 未变。

### 备注
- 仅有 Sandbox 证据：那是接近平板形态的桌面窗口，手机心情小圆点、紧凑尺寸、去掉箭头后的滑动路径都没在真机上走过；同步相关的修复需要两台设备加真实同步引擎。这四项都还是残留风险。
- 填充默认开启，所以老版本用户一更新，日历外观立刻变化：已写的填满，今天变成描边。

---

## 2.8.1 (2026-10-02)

A one-bug patch: a title that happens to read like journal-template filler was silently replaced by the empty placeholder, so the title looked unsaved.

### Fixed
- **A title you type is always shown.** The timeline's inline title editor writes frontmatter `title`, but a title that matched the generic list — `freewrite`, `daily note`, `journal entry`, `entry`, `untitled` — was treated as template filler and replaced by the "Title" placeholder, so typing `Freewrite` looked like the title had never been saved; any other wording displayed normally. That list exists to hide daily-template headings, not a deliberate choice, so only an inferred title (the note's first `# Heading`, or its filename) is screened against it now. A frontmatter title is what the user wrote and always renders, and On This Day's title split follows the same rule, so a memory card keeps such a title too. The list itself is unchanged, so template headings are still hidden as before.

### Verification
- `npm run typecheck`, `npm test` (69 files / 779 tests), `npm run build`, `npm run build:tablet`, `npm run package:release`, `npm run verify:release:zip` and `git diff --check` all pass.
- Obsidian Sandbox: the new build was deployed and reloaded with no `dev:errors`. A demo note whose frontmatter is `title: Freewrite` rendered its card title as `Freewrite` instead of the placeholder, while the empty notes beside it — whose titles fall back to their filename dates — kept the placeholder.

### Notes
- Sandbox only: it is a tablet-like desktop window, so the timeline title area was not exercised on a real phone, and the fix's mobile behaviour stays a residual risk.
- Titles are read through the journal index, so the fix applies wherever `explicitTitle` travels: the timeline card and the On This Day card and modal.

---

一个只有一处修复的补丁版：看起来像日记模板填充文字的标题会被悄悄换成空占位符，于是标题像是没保存上。

### 修复
- **你输入的标题一定会显示。** 时间线的行内标题编辑器写的是 frontmatter `title`，但命中通用词表的标题会被当成模板填充文字，替换成"标题"占位符——所以输入 `Freewrite` 看起来像根本没保存，而换任何别的字词都正常。这张词表（`freewrite`、`daily note`、`journal entry`、`entry`、`untitled`）是为了隐藏日记模板自带的标题，而不是否定用户的明确选择，因此现在只对推断出来的标题（笔记的第一个 `# 标题`，或文件名）做过滤。frontmatter 标题是用户写下的内容，一律照常显示；「往年今日」的标题拆分遵循同一规则，回忆卡片里的这类标题也会保留。词表本身没有改动，模板标题依旧被隐藏。

### 验证
- `npm run typecheck`、`npm test`（69 个文件 / 779 项测试）、`npm run build`、`npm run build:tablet`、`npm run package:release`、`npm run verify:release:zip`、`git diff --check` 全部通过。
- Obsidian Sandbox：新构建已部署并重载，`dev:errors` 无错误。frontmatter 为 `title: Freewrite` 的示例笔记，卡片标题渲染为 `Freewrite` 而不再是占位符；它旁边那些空笔记（标题回退到文件名日期）仍显示占位符。

### 备注
- 仅 Sandbox 证据：那是接近平板形态的桌面窗口，标题区未在真机上验证，移动端表现仍属残留风险。
- 标题统一经日记索引读取，因此修复覆盖所有携带 `explicitTitle` 的界面：时间线卡片，以及「往年今日」卡片与弹窗。

## 2.8.0 (2026-10-01)

The 2026-09-29 review round lands in full, and the calendar's past-year dot marker is removed. The marker was read as "this day has been written" often enough — by users and by the maintainer — that keeping it was worse than dropping it; the reasoning is recorded under **Removed**.

### Added
- **Use current location** in the weather settings reads the device location once, only when the button is tapped, fills the coordinates rounded to two decimals (about 1 km) and clears a location name that no longer matches the coordinates. It is shown on Obsidian mobile only, because desktop Electron usually has no location service; desktop users enter coordinates by hand. Denied, timed-out, unavailable, and failed reads each report in the display language. The stored coordinates travel to Open-Meteo with the weather request, which all three READMEs now state.
- **Insert-time EXIF/GPS persistence** (`exifPersistMetadata`, off by default) writes location metadata to the journal note when an image is newly embedded or changed. The previous hover-driven path had no call site and never ran; the resolved place name now goes to a separate `exif_place` field instead of overwriting the shared EXIF data.
- **Keyboard and screen-reader access for the calendar grid.** Day cells are focusable buttons carrying the localized date instead of the raw ISO string, and focus returns to the same date after a re-render.
- **CLDR plural forms** for count labels. Languages that need more than an English two-form rule select their own category through `Intl.PluralRules`, with a fallback for older embedded Chromium.
- Sixteen previously English-only settings, validation and error strings are localized: coordinate parsing and range checks, the mood metadata path errors, the journal-source/daily-folder mismatch, a mood save timeout, and the mobile back-to-note hint.

### Changed
- **Recent weather reads the forecast endpoint.** Days inside the recent window request `past_days` from the forecast host rather than the archive API, which lags by days and often had nothing for them.
- **The weather cache no longer deletes its own history.** The sweep used to drop entries by `fetchedAt` at 90 days, which was the only copy of that weather, and it now bounds the cache by entry count instead; recent records keep the short TTL so a failed fetch is still retried.
- **Coordinate fields save on blur or after about 0.8 s** instead of on every keystroke, and invalid or out-of-range input is reported inline and never saved.
- **External settings changes are honoured.** `onExternalSettingsChange` re-reads `data.json`, so a value synced from another device is no longer overwritten by the stale in-memory copy on the next save.
- **Mood metadata is last-writer-wins by `updatedAt`,** scores are validated on `set()`, a single unreadable record or a newer schema no longer rolls the whole file back to `.bak`, and a read-only store surfaces a warning instead of silently showing stale values.
- **February 29 memories appear in the February 28 view** of a common year, on every On This Day surface.
- A fresh install defaults the display language to `system`; a stored language is never rewritten.

### Fixed
- **Mobile.** Opening a journal no longer replaces the calendar in the right drawer, and no longer leaves an extra drawer leaf behind on each open; "Back to note" no longer turns the calendar leaf into an empty markdown view; a leaf the user has closed is not reused; the daily reminder waits for the journal index instead of firing early, and does not repeat; recording a mood no longer creates an empty daily note that bypasses the Daily Notes or Templater template; unload cleanup runs before the asynchronous flushes, so a flush that fails cannot skip the DOM teardown.
- **Calendar.** The weather card revalidates instead of never refreshing after its first failure and refetching on every redraw; the On This Day modal no longer orphans containers after a reload or leaves a global keydown handler behind; duplicate redraws, grid rebuilds, and EXIF-cache wipes were removed; the mood control appears only where a mood or a journal entry exists, instead of drawing an empty target on every date and stealing the date tap.
- **Journal index, search and excerpts.** An empty or unparsable date field falls back to the filename again, so those notes stay in the calendar and timeline; summary templates no longer treat `$&` and `$$` in the note body as replacement patterns; search normalizes and debounces instead of re-normalizing the whole index on every keystroke; titles no longer come from a `#` inside a code block; tag scanning no longer reads colours, `#123`, or code-block content as tags; nested journal sources are validated against the daily folder; thumbnails whose filename contains parentheses render.
- **Media and EXIF.** Each HEIC conversion no longer leaks a libheif WASM context; a GPS rational with a zero denominator no longer decodes as `(0, 0)`; `requestUrl` timeouts are actually applied; a resolved place name no longer mutates the shared EXIF arrays.
- **Mood.** CSV export neutralizes cells that a spreadsheet would evaluate as a formula; deleting a mood no longer rewrites frontmatter unconditionally; a tombstone no longer hides the frontmatter mood of a note re-created at the same path; the native date input no longer locks mid-edit.
- **Accessibility and i18n.** Several hints that lived only in a `title` are reachable without hovering, and the strings listed under **Added** are no longer English-only.

### Removed
- **The calendar past-year dot marker.** It drew a 4px accent dot in the bottom-right corner of every date whose `MM-DD` has an entry in an earlier year. That is the vocabulary calendars use for "this day has an entry", and because the index only covers years before the current one the signal read backwards: a date written this year drew nothing, a date never written this year drew a dot, and today's cell was suppressed on top of it — so "a dot means written, and today is not written yet" was a self-consistent misreading. For someone who writes every day every past cell qualifies, so the marker carried no information either, and a count in its place would only have made the crowding visible. Removed with it: the `onThisDayDot` setting, the render block, its nine translations, the `styles.css` rule, and the two README rows. The merged On This Day strip, the header entry mode with its badge, and the memory modal are unchanged; a stale `onThisDayDot: true` in an existing `data.json` is inert, which a regression test covers.

### Verification
- `npm run typecheck`, `npm test` (69 files / 774 tests), `npm run build`, `npm run build:tablet`, `npm run package:release`, `npm run verify:release:zip` and `git diff --check` all pass.
- Obsidian Sandbox: the new build was deployed and reloaded with no `dev:errors`. The calendar rendered 35 day cells for October 2026 with zero dot markers, and a September 2026 view — whose past-year index still contains `09-14`, the date the previous build marked — rendered zero as well.

### Notes
- The review's M-11 finding, a non-colour cue for the calendar mood level, stays open **by product decision**: two encodings of the level in the marker's geometry were rejected in Sandbox acceptance, and at 6–10px the difference is imperceptible. The level remains carried by colour and the tooltip. If colour-blind legibility ever matters, the answer is a separate non-visual channel, not a marker tweak.
- The mood picker's cross-date draft queue was deleted by the same kind of decision; changing the date discards that date's unsaved edit, and Save is the only commit point.
- Not verified here: real phone and iPad leaf topology, native per-segment date input behaviour, device geolocation on iOS and Android, and HEIC `infe`/`iloc` versions other than the synthetic containers the tests build.
- `exif_place` is written to frontmatter but nothing renders it yet; the EXIF tooltip still reads the media metadata.

---

2026-09-29 那一轮审查的修复全部落地，同时移除了日历上的"往年今日"小圆点。那个标记被当成"这天已写"的次数太多了（用户和作者本人都中招过），留着不如拿掉；理由记在 **移除** 一节。

### 新增
- 天气设置新增 **使用当前位置**：只在你点击按钮时读取一次设备定位，填入保留两位小数（约 1 km 精度）的坐标，并在坐标变化后清掉不再匹配的地点名。该按钮只在 Obsidian 手机端显示，因为桌面端 Electron 通常没有定位服务，桌面用户手动输入坐标。被拒绝、超时、不可用和读取失败都按当前显示语言就地提示。填入的坐标会随天气请求发送到 Open-Meteo，三份 README 都已写明。
- **插入时写入 EXIF/GPS**（`exifPersistMetadata`，默认关闭）：图片被新嵌入或发生变化时，把位置元数据写进日记。此前"悬停触发"的那条路径没有任何调用点，从未真正执行；解析出的地名现在写入独立的 `exif_place` 字段，不再覆盖共享的 EXIF 数据。
- **日历格子支持键盘与读屏操作。** 日期格子是可聚焦的按钮，标签使用本地化日期而不是原始 ISO 字符串；重绘后焦点回到同一天。
- **计数标签支持 CLDR 复数形式。** 需要超过英语双形式规则的语言通过 `Intl.PluralRules` 选择自己的复数类别，并为较旧的 Chromium 内核保留回退。
- 补本地化十六处此前只有英文的设置、校验与错误文案：坐标解析与范围校验、心情元数据路径错误、日记来源与日记目录冲突、心情保存超时，以及移动端"返回笔记"提示。

### 变更
- **近几天的天气改走预报接口。** 最近窗口内的日期改用预报主机的 `past_days`，不再请求滞后数天、往往没有数据的归档接口。
- **天气缓存不再删除自己的历史。** 旧逻辑按 `fetchedAt` 在 90 天后清理条目，而那是该天气的唯一副本；现在改为按条目上限约束缓存，近期记录仍保留短 TTL，以便失败的请求之后重试。
- **坐标输入改为失焦或停止输入约 0.8 秒后保存**，不再每按一个键就保存一次；不合法或超出范围的输入就地提示且不会保存。
- **外部设置变更会被采纳。** `onExternalSettingsChange` 会重新读取 `data.json`，从其他设备同步来的值不再被内存中的旧副本在下次保存时覆盖。
- **心情元数据按 `updatedAt` 后写者胜**，`set()` 会校验分数，单条无法解析的记录或更新的 schema 不再导致整份文件回退到 `.bak`，只读状态会给出警告而不是静默显示过期数据。
- **平年的 2 月 28 日会显示 2 月 29 日的回忆**，在所有"往年今日"界面一致。
- 全新安装的默认显示语言为「跟随系统」；已存储的语言永不被改写。

### 修复
- **移动端。** 打开日记不再把右抽屉里的日历替换掉，也不会每打开一次就多留一个抽屉 leaf；「返回笔记」不再把日历 leaf 变成一个空的 markdown 视图；用户已关闭的 leaf 不会被复用；每日提醒会等索引就绪再发，且不会重复；记录心情不再创建绕过 Daily Notes / Templater 模板的空日记；卸载清理改到异步 flush 之前，flush 失败不会连带跳过 DOM 清理。
- **日历。** 天气卡片恢复重校验，不再首次失败后永不刷新、也不再每次重绘都重复请求；「往年今日」弹窗重载后不再残留容器，也不再留下全局 keydown 监听；移除了重复的重绘、网格重建和 EXIF 缓存清空；心情控件只在已有心情或已有日记的日期出现，不再在每个日期上画一个空目标抢走日期点击。
- **日记索引、搜索与摘要。** 日期字段为空或无法解析时重新回退到文件名，这些笔记会继续出现在日历与时间线；摘要模板不再把正文里的 `$&`、`$$` 当作替换模式；搜索改为归一化 + 防抖，不再每次按键都重新归一化整个索引；标题不再取自代码块里的 `#`；标签扫描不再把颜色值、`#123`、代码块内容当成标签；嵌套日记来源会与日记目录做校验；文件名含括号的缩略图可以显示。
- **媒体与 EXIF。** 每次 HEIC 转换不再泄漏一个 libheif WASM context；分母为 0 的 GPS 有理数不再被解析成 `(0, 0)`；`requestUrl` 的超时真正生效；解析出的地名不再改写共享的 EXIF 数组。
- **心情。** CSV 导出会中和可被表格软件当作公式求值的单元格；删除心情不再无条件改写 frontmatter；tombstone 不再永久遮蔽同路径新建笔记的 frontmatter 心情；原生日期输入框不再在输入中途被锁住。
- **无障碍与 i18n。** 若干只放在 `title` 里的提示在触屏上也能获得，**新增** 一节列出的文案不再只有英文。

### 移除
- **日历上的「往年今日」小圆点。** 它会在所有"往年同月日有记录"的日期右下角画一个 4px 的 accent 色圆点。这正好是日历产品表达"这天有内容"的通用写法，而它的数据只取今年之前的年份，于是信号是反的：今年写过的日期什么都不显示，今年没写、往年写过的日期反而有点，今天那格又被额外排除——"有点表示已写、今天还没写"因此成了一个自洽的误读。对每天写作的人来说，每个历史格子都符合条件，标记也就没有任何信息量，换成数字只会让拥挤变得可见。一并移除：`onThisDayDot` 设置项、渲染代码、九种语言的文案、`styles.css` 规则和两行 README。合并进天气卡的往年条带、顶栏入口及其角标、回忆弹窗均未改动；旧 `data.json` 里残留的 `onThisDayDot: true` 不会生效，已有回归测试覆盖。

### 验证
- `npm run typecheck`、`npm test`（69 个文件 / 774 项测试）、`npm run build`、`npm run build:tablet`、`npm run package:release`、`npm run verify:release:zip`、`git diff --check` 全部通过。
- Obsidian Sandbox：新构建已部署并重载，`dev:errors` 无错误。2026 年 10 月的日历渲染出 35 个日期格子、0 个圆点标记；2026 年 9 月——其往年索引里仍存在 `09-14`，正是旧构建会标记的那一天——同样渲染出 0 个。

### 备注
- 审查中的 M-11（为日历心情等级提供非颜色线索）**按产品决定保持未实现**：两次把等级编码进标记几何形状的尝试都在 Sandbox 验收被否，而在 6–10px 尺度上这种差异根本看不出来。等级仍由颜色和提示承载。若将来色盲可读性真的重要，答案是另加一条非视觉通道，而不是改标记。
- 心情选择器的跨日期草稿队列也按同类决定删除：切换日期会丢弃该日期未保存的编辑，Save 是唯一的提交点。
- 本次未验证：真机上的手机/平板 leaf 拓扑、原生日期输入的分段行为、iOS/Android 的设备定位，以及测试用合成容器之外的 HEIC `infe`/`iloc` 版本。
- `exif_place` 已写入 frontmatter，但尚无任何界面渲染它；EXIF 悬停仍读取媒体元数据。

## 2.7.0 (2026-09-29)

### Added
- The display language setting offers nine languages — Simplified Chinese, Traditional Chinese, English, Japanese, Korean, French, German, Spanish, and Russian — plus `system`, which resolves the host locale at call time. `src/i18n.ts` exports the supported list so the settings dropdown, the migration path, and the tests read one source instead of repeating it; the legacy weather key column still names the resolved language for the weather, EXIF, media, and On This Day surfaces.
- Weather conditions are localized. `src/weather-service.ts` keeps one English `condition` per WMO code because cached snapshots already store that text, so `src/weather-conditions.ts` maps 24 conditions plus a "Weather code N" fallback into all nine languages and `weatherConditionLabel()` resolves a snapshot from its `weatherCode`. A snapshot without a code keeps its stored text, and an unlisted code degrades to the localized fallback rather than throwing.
- The settings header shows the Dayline brand mark ahead of the wordmark.

### Changed
- The HEIC decoder ships inside `main.js`. It used to be `libheif-bundle.js` next to the plugin, loaded with a runtime `require()` of an absolute path inside the plugin folder. Obsidian's installer only downloads `main.js`, `manifest.json`, and `styles.css`, so community-store installs never received that file and HEIC thumbnails fell back to the raw attachment silently. The decoder is now a lazy `import()` in `src/heic-codec.ts` that calls the bundled Emscripten factory on the first conversion, the sidecar leaves the release set, and `THIRD_PARTY_NOTICES.md` plus the bundle banner cover the bundled libheif-js (LGPL-3.0). `main.js` grows from 1.18 MB to about 2.9 MB.
- Ten user-visible strings that were still hardcoded English — the copy-mobile-diagnostics command and its two notices, the calendar-leaf and mood notices, the weather timezone placeholder, the unknown-error fallback, the date-overlay title, and the mobile view group and back-button aria-labels — now resolve through `t()`. What deliberately stays English is recorded in `docs/2026-09-29-nine-language-display.md`: console diagnostics, the mobile-diagnostics report body, error detail inside `{error}`, vault paths, and the canonical WMO labels.

### Fixed
- The vault root works as a journal source. Picking the root in the folder picker stored `/`, which path normalization collapsed to an empty string, and validation then rejected it with "enter a default daily-note folder" — the picker offered a folder the plugin refused to save. A root source now matches the files directly at the top level only (an empty folder used as a prefix would claim every note in the vault), and an empty folder setting still means "unset" and keeps resolving to the default, so vaults that stored an empty string are not flipped to the root. Every `${dailyFolder}/${date}.md` join goes through `joinVaultPath`, so a root folder no longer produces a leading slash that `getAbstractFileByPath` does not resolve, and `ensureJournalFile` derives parents with `parentVaultPath` instead of turning a root-level `note.md` into `note.m`.
- On This Day opens a memory in the journal leaf instead of splitting a new pane, and the card's title and body are separate rows rather than one run-on excerpt.
- "How long ago" is measured from today on every On This Day surface, so opening a past-year memory no longer reads "0年前 · 7月18日".
- The timeline title keeps its text height on touch devices; the 44px tap box it had been given left 18px of dead space above the excerpt.

### Verification
- `npm run typecheck`, `npm test` (61 files, 555 tests), `npm run build`, `npm run build:tablet`, `npm run verify:release:zip`, and `git diff --check` pass on the merged tree.
- The bundled HEIC decoder decoded a real sample end to end under the same esbuild settings the plugin uses: one image, 850x236, 200,600 opaque RGBA pixels, and a second load returned the same decoder. Loading the bundle costs about 5 ms and instantiates no WASM, so the payload is only touched on the first conversion.
- Both merges were re-tested as a combination, not just per branch: the nine-language tables, the weather-condition table, the On This Day rewrites, the HEIC decoder, and the vault-root path helpers all pass together.

### Notes
- HEIC conversion remains desktop-only. `src/platform-capabilities.ts` disables the route on mobile because a decode can allocate a large buffer; that is a memory decision, not a limitation of where the codec comes from.
- `dayline.zip` was rebuilt without `libheif-bundle.js`. An archive from an earlier release still lists the sidecar; it is simply unused now.
- The `libheif-js` notice points at the upstream source and the exact version, and replacing `libheif-bundle.js` before a rebuild replaces the library. Shipping the GPL/LGPL license texts themselves next to that notice is a known follow-up.

---

## 2.7.0（2026-09-29）

### 新增
- 显示语言设置提供九种语言——简体中文、繁體中文、English、日本語、한국어、Français、Deutsch、Español、Русский——外加 `system`，在调用时解析宿主语言。`src/i18n.ts` 导出受支持的语言列表，设置下拉框、迁移路径和测试都读同一份来源；旧的 weather 语言列仍为天气、EXIF、媒体和「去年今日」界面记录解析后的语言。
- 天气状况已本地化。`src/weather-service.ts` 为每个 WMO 代码保留一条英文 `condition`，因为缓存快照里存的就是那段文本，因此新增 `src/weather-conditions.ts`，把 24 种状况加上「Weather code N」回退翻译进九种语言，`weatherConditionLabel()` 通过快照的 `weatherCode` 解析标签。没有 code 的快照保留原文本，未收录的代码降级为本地化回退文案而不是抛错。
- 设置页头部在文字标识前显示 Dayline 品牌图标。

### 变更
- HEIC 解码器并入 `main.js`。它原本是插件目录里的 `libheif-bundle.js`，通过运行时 `require()` 绝对路径加载。Obsidian 安装器只下载 `main.js`、`manifest.json` 和 `styles.css`，所以商店安装的用户永远拿不到这个文件，HEIC 缩略图静默回退成原图。现在由 `src/heic-codec.ts` 里的懒加载 `import()` 在首次转换时调用内置的 Emscripten 工厂，旁挂文件退出发布集，`THIRD_PARTY_NOTICES.md` 与 bundle 头部注释覆盖了内置的 libheif-js（LGPL-3.0）。`main.js` 从 1.18 MB 增长到约 2.9 MB。
- 十处仍是硬编码英文的用户可见文案——复制移动端诊断命令及其两条提示、日历页失败提示、心情重命名与孤立记录迁移提示、天气时区占位符、未知错误回退、日期浮层标题，以及移动端视图分组与返回按钮的 aria-label——现在都经 `t()` 解析。刻意保留英文的部分记录在 `docs/2026-09-29-nine-language-display.md`：控制台诊断、移动端诊断报告正文、`{error}` 里的错误详情、笔记库路径，以及 WMO 规范标签。

### 修复
- 笔记库根目录可作为日记来源。在文件夹选择器里选根目录会得到 `/`，路径归一化把它压成空字符串，校验随即以「请填写笔记库内的默认日记目录」拒绝——选择器给出了一个插件却不肯保存的目录。现在根目录来源只匹配顶层文件（把空目录当目录前缀会把整个库都算作来源），而空目录设置依旧表示「未设置」并继续解析为默认目录，因此存过空字符串的库不会被翻成根目录。所有 `${dailyFolder}/${date}.md` 拼接都走 `joinVaultPath`，根目录不再产生 `getAbstractFileByPath` 无法解析的前导斜杠；`ensureJournalFile` 改用 `parentVaultPath` 推导父目录，不再把根目录下的 `note.md` 变成 `note.m`。
- 「去年今日」改为在日记页内打开回忆，不再分裂出新的面板；卡片标题与正文拆成两行，不再是一段连读摘要。
- 「多久以前」在所有「去年今日」界面都以今天为基准计算，打开往年的回忆不再显示「0年前 · 7月18日」。
- 触屏设备上时间线标题恢复文本高度；此前给它加的 44px 点击区在摘要上方留了 18px 空白。

### 验证
- 合并后的树上 `npm run typecheck`、`npm test`（61 个文件、555 项测试）、`npm run build`、`npm run build:tablet`、`npm run verify:release:zip`、`git diff --check` 全部通过。
- 内置 HEIC 解码器在插件同款 esbuild 设置下真实解码样本：1 张图、850x236、200,600 个不透明 RGBA 像素，第二次加载返回同一个解码器。加载 bundle 约 5 ms 且不实例化任何 WASM，因此只在首次转换时才触碰负载。
- 两次合并按组合重新验证，而非只看各自分支：九语言表、天气状况表、「去年今日」重写、HEIC 解码器与根目录路径辅助函数放在一起全部通过。

### 说明
- HEIC 转换仍为桌面端专属。`src/platform-capabilities.ts` 因单次解码可能分配大缓冲而在移动端禁用该路由；这是内存决定，与解码器来自哪里无关。
- `dayline.zip` 已重打，不再包含 `libheif-bundle.js`；更早版本的归档仍列出该旁挂文件，但它已不再被使用。
- libheif-js 的声明指向上游源码与确切版本，构建前替换 `libheif-bundle.js` 即可替换该库。随声明一并分发 GPL/LGPL 许可证全文是已知的后续事项。

---

## 2.6.1 (2026-09-27)

### Fixed
- Calendar weather badges are now appended as parsed DOM instead of being written with `innerHTML`. This was the one **error**-severity finding in the community-plugin review, and it was the only place in `src/` that built markup from a string. The glyphs are build-time constants from `icons/badge-*.svg`, but an HTML-string sink turns any future asset edit into an injection point. `appendBadgeSvg` parses the markup as XML, strips `<script>` and any `on*` attribute, then imports the node — same zero-I/O rendering, inert sink. All eight shipped glyphs produce DOM structurally identical to the previous output.

### Changed
- Every `document.createElement` call site now uses Obsidian's `createEl`/`createDiv`/`createSpan` helpers, resolving all 41 `obsidianmd/prefer-create-el` warnings. `on-this-day-entry.ts` builds its strip through host-relative helpers so the nodes stay in the owning document, and `mood-modal-viewport.ts` probes for the window helper because the measure probe must not depend on Obsidian's DOM augmentations existing.
- The filename sanitizer no longer matches literal control characters in its regex. The `\u0000-\u001f` range is applied by code point instead, which clears `no-control-regex`; an exhaustive check over all 65,536 BMP code points plus three astral samples confirms the output is unchanged.
- Legacy persisted settings that widen a literal union are typed `(string & {})` rather than `| string`, so `weekStart`, `weatherUnits`, and `calendarMoodMarker` keep their literal autocomplete instead of collapsing to `string`. This resolves all 16 `no-redundant-type-constituents` warnings and is a type-only change.
- `WeatherSnapshot` declares `feelsLike`, `humidity`, and `low` explicitly. They previously fell through the index signature as `unknown`, which forced untyped stringification in `weather-display.ts`.
- Promise rejections and thrown values are normalised to `Error` instances: `requestWeatherWithRetry` preserves a `status` property so HTTP retry eligibility is unchanged, and `MediaService` wraps non-Error rejection reasons. Two redundant type assertions and one unnecessary `console.info` (now `console.debug`, which the guidelines allow) were also removed.

### Verification
- `npm test` passed: 56 test files and 488 tests (up from 55/483, adding badge-injection coverage).
- `npm run typecheck`, `npm run build`, `git diff --check` passed.
- Weather badges verified in the Obsidian Sandbox: 17 badges, all 17 rendering inline `<svg>`, 103 shapes, `stroke` resolving through `currentColor` to the condition colour.
- `dev:errors` reported no errors after reload.

### Notes
- The `@typescript-eslint/no-unsafe-*` and `no-explicit-any` findings in the review are **not** addressed here. They trace to `require()`-style imports and `// @ts-nocheck` in nine files, which make imported symbols resolve to `any`. Those are warnings, and converting the affected modules to ESM is a behaviour-affecting refactor tracked separately.

---

## 2.6.1（2026-09-27）

### 修复
- 日历天气徽章改为以解析后的 DOM 追加，不再使用 `innerHTML` 写入。这是插件审查中唯一一条 **error** 级问题，也是 `src/` 中唯一一处用字符串拼接标记的地方。字形本身是来自 `icons/badge-*.svg` 的构建期常量，但 HTML 字符串注入点会让未来任何一次资源改动变成注入风险。`appendBadgeSvg` 以 XML 解析标记，剥离 `<script>` 与所有 `on*` 属性后再导入节点——保持零 I/O 渲染，同时让注入点变为惰性。8 个已发布字形产出的 DOM 与改动前结构完全一致。

### 变更
- 所有 `document.createElement` 调用点改用 Obsidian 的 `createEl`/`createDiv`/`createSpan` 辅助方法，清掉全部 41 条 `obsidianmd/prefer-create-el` 警告。`on-this-day-entry.ts` 改为通过宿主相对辅助方法构建，使节点留在所属 document 内；`mood-modal-viewport.ts` 对 window 上的辅助方法做探测，因为测量探针不应依赖 Obsidian 的 DOM 扩展一定存在。
- 文件名净化不再在正则中匹配字面控制字符，`\u0000-\u001f` 改为按码点处理，从而清掉 `no-control-regex`。已穷举全部 65536 个 BMP 码点及 3 个星体面样本，确认输出完全不变。
- 为兼容旧版持久化值而放宽的字面量联合改用 `(string & {})` 而非 `| string`，使 `weekStart`、`weatherUnits`、`calendarMoodMarker` 保留字面量补全而不退化成 `string`。清掉全部 16 条 `no-redundant-type-constituents`，且纯属类型层面改动。
- `WeatherSnapshot` 显式声明 `feelsLike`、`humidity`、`low`。此前它们经索引签名落到 `unknown`，迫使 `weather-display.ts` 做无类型字符串化。
- Promise 拒绝与抛出值统一归一为 `Error`：`requestWeatherWithRetry` 保留 `status` 属性，HTTP 重试判定逻辑不变；`MediaService` 包装非 Error 的拒绝原因。另删除两处多余类型断言，并把一处不必要的 `console.info` 改为指南允许的 `console.debug`。

### 验证
- `npm test` 通过：56 个测试文件、488 项测试（原为 55/483，新增徽章注入相关覆盖）。
- `npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 已在 Obsidian Sandbox 实测天气徽章：17 个徽章、17 个均渲染出内联 `<svg>`、共 103 个图形，`stroke` 经 `currentColor` 正确解析为对应天气配色。
- 重新加载后 `dev:errors` 无任何错误。

### 说明
- 审查中的 `@typescript-eslint/no-unsafe-*` 与 `no-explicit-any` **未**在本次处理。它们源于 9 个文件中的 `require()` 导入与 `// @ts-nocheck`，导致导入符号退化为 `any`。这些属于 warning，将其改为 ESM 会影响行为，属独立的后续重构。

---

## 2.6.0 (2026-09-26)

### Added
- Dayline now adapts to Obsidian's tablet interface. Tablets were routed through the phone layout because every branch keyed off `isMobile`, so the calendar replaced the open note and the two views could not coexist. Tablets use the desktop sidebar paths (calendar left, timeline right, active note preserved), while the phone single-leaf swap, mode controls, and shared timeline filter stay gated on the phone layout. `isTabletLayout`/`isPhoneLayout` capabilities read the live viewport first and fall back to the Obsidian `Platform` flags, and `usesPhoneLayout()` keeps hosts that predate the flag on their previous behavior.
- `npm run build:tablet` emits an independently identified tablet verification build (`dayline-tablet`, namespaced view types) that can be installed next to a normal Dayline install. Obsidian's `registerView` throws on a duplicate view type, so both cannot share one.

### Changed
- Calendar date-cell weather badges were redrawn as Lucide outline glyphs (ISC) and are now drawn bare, with no backing plate and no `backdrop-filter`. The whole family shares one cloud silhouette that each state adds to, so the shape itself carries the condition: partly-cloudy gains its own glyph, and drizzle (short dashes) is structurally distinct from rain (long streaks) rather than the same drop with a highlight. The previous Phosphor filled sets differed only by details that did not survive badge size.
- Badge glyphs are inlined from `icons/badge-*.svg` as a single source of truth instead of a duplicated inline table; the seven unused Phosphor badge SVGs and their dead data-URI payload were removed.
- Condition colours are declared as `--cal-wx-*` custom properties and re-point to a bright set on dark surfaces. The previous single set assumed a light cell and sat at 1.1–2.7:1 on a dark-theme cell, the accent-filled today cell, or a photo cell. Photo cells — 21 of 34 in the demo month, always under a 35% black overlay, with background luminance from 0.0 to 0.92 — also get a dark halo so the stroke separates from the image.

### Fixed
- Calendar cells on tablets no longer show an empty mood control on every date, which littered the grid with targets that stole date taps; the control renders only where a mood or journal entry exists.
- The mood picker opens on `click` rather than `pointerdown`, so the tap's trailing click no longer lands on the modal backdrop and dismisses it unless the button is held.
- The tablet mood pip is sized for its ~48px cell, and tablets are excluded from the enlarged touch-desktop pip that covered most of the cell.
- Calendar and timeline icon buttons keep square padding and an 18px glyph on tablets. Obsidian's `.is-tablet button:not(.clickable-icon){padding:4px 20px}` outranked `.cal-icon-button` and squeezed 44px buttons into a 4px glyph slot.

### Verification
- `npm test` passed: 55 test files and 483 tests.
- `npm run typecheck`, `npm run build` (byte-identical `main.js`), `npm run verify:release`, `npm run verify:release:zip`, and `git diff --check` passed.
- Badge contrast measured on the rendered pixels of all 21 photo cells: worst case 5.66:1, up from ~1.0:1.

---

## 2.6.0（2026-09-26）

### 新增
- Dayline 适配 Obsidian 平板界面。此前所有分支都以 `isMobile` 判断，平板被错误地走手机布局，日历会顶掉正在阅读的笔记，两个视图无法共存。现在平板使用桌面侧栏路径（日历在左侧栏、时间线在右侧栏、当前笔记保留），手机的单 leaf 切换、模式切换按钮和共享时间线筛选仅在手机布局下生效。新增 `isTabletLayout`/`isPhoneLayout` 能力判断，优先读取实时视口，无媒体查询时回退到 Obsidian 的 `Platform` 标志；`usesPhoneLayout()` 让尚未支持新标志的宿主保持原有行为。
- `npm run build:tablet` 产出独立标识的平板验证包（`dayline-tablet`，视图类型加命名空间），可与正式 Dayline 同时安装。Obsidian 的 `registerView` 遇到重复视图类型会抛错，两者无法共用同一标识。

### 变更
- 日历格子的天气图标改用 Lucide 描边字形（ISC）并去掉底板与 `backdrop-filter`，直接绘制。整族共用同一朵云的轮廓、各天气在其上叠加元素，让形状本身承载语义：多云有了独立图标，毛毛雨（短虚线）与雨（长线条）在结构上真正区分开，不再靠放大后必然消失的高光细节区分。此前的 Phosphor 实心图标正是败在这一点。
- 徽章字形改为从 `icons/badge-*.svg` 内联，作为唯一数据源，取代原先重复的内联表；同时删除了 7 个已无引用的 Phosphor 徽章 SVG 及其失效的 data URI 负载。
- 天气配色改用 `--cal-wx-*` 自定义属性，并在深色底上整体切换到亮色集。原先的单套配色以"底色必然是浅色"为前提，在深色主题格子、accent 填充的今天格子和照片格子上的对比度只有 1.1–2.7:1。照片格子（演示月份 34 格中占 21 格，且都压着 35% 黑蒙版，背景亮度跨度 0.0–0.92）额外加一层深色 halo，让笔画与图像分离。

### 修复
- 平板日历不再在每个日期上显示空的心情控件。此前整片网格都布满会抢走日期点击的空白热区，现在仅在确有心情或日记条目时渲染。
- 心情选择器改为在 `click` 而非 `pointerdown` 打开。此前在按下时就弹出，会让同一次触摸的后续 click 落在弹窗遮罩上，除非一直按住，否则选择器会立刻被关掉。
- 平板心情圆点按其约 48px 的格子重新定尺寸，并将平板排除在"触控桌面放大圆点"之外（该样式会覆盖大半个格子）。
- 平板上的日历与时间线图标按钮保持方形内边距和 18px 字形。Obsidian 的 `.is-tablet button:not(.clickable-icon){padding:4px 20px}` 优先级高于 `.cal-icon-button`，会把 44px 按钮压成 4px 宽的字形槽。

### 验证
- `npm test` 通过：55 个测试文件、483 项测试。
- `npm run typecheck`、`npm run build`（`main.js` 字节一致）、`npm run verify:release`、`npm run verify:release:zip` 和 `git diff --check` 通过。
- 对全部 21 个照片格子的实际渲染像素实测徽章对比度：最坏 5.66:1，修复前约 1.0:1。

---

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
