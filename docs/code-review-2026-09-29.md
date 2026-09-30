# Dayline 代码审查报告（2026-09-29）

> 用途：交给实现 agent 逐项修复。本报告只记录问题与建议，未改动任何源码。

## 0. 使用说明（实现 agent 必读）

- 基线：`HEAD = e8257ec (release 2.7.0)` + 未提交改动（`src/dayline-mobile.ts`、`src/i18n.ts`、`src/journal-timeline-view.ts`、`src/plugin.ts`、`src/settings-tab.ts`、新增 `src/geolocation.ts` 及对应测试）。
- 审查时基线状态：`npm run typecheck` 通过；`npm test` 62 文件 / 562 用例全绿；`npx eslint src` 6645 条（绝大多数为 `@ts-nocheck` 边界的 `any`，属 `docs/review-fix-roadmap.md` 已登记的 `DEFER`，本报告不重复）。
- 先读 `AGENTS.md` 和 `docs/review-fix-roadmap.md` 第 1、2 节。其中的 `KEEP`/`DEFER` 结论继续有效，本报告只收录有具体缺陷证据的条目。
- 每修一项：补回归测试（`tests/<feature>.test.ts`），然后跑 `npm run typecheck && npm test && npm run build`。UI 或生命周期相关的改动还需要在测试 vault 手工验证。
- 不要修改 `main.js`（构建产物）、`dayline.zip`、`data.json`、`Calendar/journal-metadata.json`。
- 置信度："确认" = 已读代码并用临时脚本或测试复现；"疑似" = 依赖 Obsidian 运行时或真机行为，修复前需先验证。
- ID 前缀：`P` 插件核心/日历，`J` 日记索引/时间线，`M` 心情，`W` 媒体/天气/定位，`U` UI/样式/i18n/设置/发布。

## 1. 优先级总览

### 第一批：合并未提交改动前必须处理

| ID | 级别 | 摘要 |
|---|---|---|
| P-01 | High | 手机端打开日记时把右抽屉里的 Dayline leaf 当作目标，日历被笔记替换，抽屉 leaf 越积越多 |
| P-02 | High | "返回笔记"在没有 markdown leaf 时把 Dayline leaf 自身 `setViewState` 成空 markdown |
| P-03 | Medium | `_mobileJournalLeaf` 长期持有，未检查是否已 detach |
| P-19 | Low | 新增移动端测试标题与断言不符，漏掉了 P-01/P-02 |
| W-07 | Medium | "使用当前位置"不会清除旧的地点名，显示的地点与数据坐标不一致 |
| W-08 | Low-Med | 定位功能未在 README 中披露；坐标精度偏高；桌面端错误信息未本地化 |
| U-06 | Medium | 定位按钮在所有平台都显示，桌面端大多会失败，错误信息是英文原文 |
| U-10 | Low | 手机按钮的提示文字只放在 `title` 里，触屏上看不到 |

### 第二批：数据丢失/损坏（最高优先）

| ID | 级别 | 摘要 |
|---|---|---|
| M-01 | High | 心情元数据只要有一条坏记录或出现未来 schema，就整份回退到 `.bak` 并覆盖主文件 |
| M-02 | High | 同步冲突后同一天的心情永久无法写入，界面显示过期数据 |
| J-01 | High | 日期字段为空或无法解析时不再回退到文件名，日记从日历和时间线消失 |
| W-01 | High | 每次 HEIC 转换泄漏一个 libheif WASM context |
| M-03 | Medium | `set()` 不校验分数，可写入字符串，叠加 M-01 会造成数据丢失 |
| M-05 | Medium | tombstone 永久遮蔽同路径新建笔记的 frontmatter 心情 |
| P-05 | Medium | 未实现 `onExternalSettingsChange`，保存时用内存旧值覆盖同步来的 data.json |
| W-04 | Medium | 历史天气按 2h TTL 重复请求，并且 90 天后被清理（它是唯一副本） |
| M-14 | Low | 删除心情时无条件改写笔记 frontmatter |

### 第三批：功能错误和明显的用户可见缺陷

| ID | 级别 | 摘要 |
|---|---|---|
| P-04 | Medium | `onunload` 先 await flush 再做 DOM 清理：flush 失败时清理被跳过；快速重载时可能误删新实例的状态 |
| P-06 | Medium | 手机端索引未就绪时误发"今天还没写日记"提醒，也可能重复提醒 |
| P-07 | Medium | 记录心情时创建空日记，绕过了 Daily Notes 模板和 Templater |
| P-08 | Medium | 日历格子无法用键盘或读屏操作 |
| P-09 | Medium | 天气卡片的 `isConnected` 分支永远不会执行：数据不刷新，失败后每次重绘都重复请求 |
| P-10 | Medium | EXIF 悬停和 frontmatter 持久化这一组方法没有任何调用方（产品约定未生效） |
| J-02 | Medium | 摘要模板用字符串形式的 `.replace`，正文里的 `$&`/`$$` 被当成替换模式 |
| J-03 | Medium | 搜索每次按键都重新做全量 NFKC 归一化，且没有防抖 |
| J-04 | Medium | 标题提取会命中代码块里的 `# 注释` |
| J-05 | Medium | 标签扫描把颜色值、`#123`、代码块内容误认成标签 |
| J-06 | Medium | 背景图 `url()` 没加引号，文件名含括号的图片不显示 |
| J-07 | Medium | 日记来源配置和 `dailyFolder` 冲突时不校验，嵌套来源永远不生效 |
| J-08 | Medium | "那年今日"弹窗没有焦点管理，全局 keydown 会抢方向键，卸载时也不清理 |
| M-04 | Medium | 心情 CSV 导出有公式注入风险 |
| M-06 | Medium | 心情 picker 切换日期后，未保存的草稿被静默丢弃 |
| M-07 | Medium | 原生日期输入框每改一段就触发切换，并锁住输入框 |
| W-02 | High（潜在） | 地名解析直接改写共享的 EXIF 数组；目前在死代码路径上，修 P-10 时必须一并处理 |
| W-03 | Medium | `requestUrl` 的 `timeout` 参数实际不生效 |
| W-05 | Medium | 最近几天的天气走 archive 接口，很可能没有数据 |
| W-06 | Medium | GPS 有理数分母为 0 时被解析成坐标 (0,0) |
| W-09 | Low-Med | 经纬度输入框每按一个键就保存并触发请求 |

其余 Low 级条目见第 3 节各模块。UI/样式/i18n/设置/发布（`U-*`）见第 3.5 节。

## 2. 建议的任务拆分（写入集合互不重叠，可并行）

| 任务 | 条目 | 主要写入文件 |
|---|---|---|
| T1 移动端路由 | P-01, P-02, P-03, P-19 | `src/dayline-mobile.ts`，`src/plugin.ts`（移动端路由段 550–690 行），`tests/dayline-mobile.test.ts` |
| T2 心情存储可靠性 | M-01, M-02, M-03, M-05, M-14, M-09 | `src/mood-store.ts`，`src/mood.ts`，`tests/mood-store-reliability.test.ts` |
| T3 心情 UI 与导出 | M-04, M-06, M-07, M-11, M-12, M-13 | `src/mood-picker-modal.ts`，`src/mood-export.ts`，`src/fluid-mood-control.ts` |
| T4 日记索引与摘要 | J-01, J-02, J-04, J-05, J-09, J-10 | `src/journal-index.ts`，`src/excerpt.ts`，`src/journal-search.ts` |
| T5 时间线搜索与统计 | J-03, J-11, J-14 | `src/journal-timeline-filters.ts`，`src/journal-stats.ts`，`src/journal-timeline-view.ts` |
| T6 HEIC/EXIF 解析 | W-01, W-06, W-10, W-11, W-12, W-15 | `src/image-metadata.ts` |
| T7 天气服务 | W-03, W-04, W-05, W-13 | `src/weather-service.ts`，`src/weather-cache.ts` |
| T8 插件生命周期与数据 | P-04, P-05, P-06, P-18 | `src/plugin.ts`（onload/onunload/settings/提醒） |
| T9 日历渲染 | P-08, P-09, P-14, P-15, P-17, P-20, J-06, J-08, M-11 | `src/plugin.ts`（CalendarView 段），`src/on-this-day.ts` |
| T10 设置与定位 | W-07, W-08, W-09, U-06, U-13, M-08 | `src/settings-tab.ts`，`src/geolocation.ts`，三份 README |
| T11 i18n 与样式 | U-07, U-08, U-09, U-12 | `src/i18n.ts`，`src/locale.ts`，`styles.css` |

`src/plugin.ts` 由 T1、T8、T9 共用，这三个任务应串行执行，或按上面标注的行段严格划分。P-10 + W-02 + W-14 需要先由产品决定"EXIF 写入 frontmatter"是否继续保留（见 3.1 P-10）。

## 3. 详细条目

### 3.1 插件核心 / 日历（`src/plugin.ts` 等）

**P-01 · High · Bug（未提交改动）· 确认**
- 位置：`src/dayline-mobile.ts:175-179`，`src/plugin.ts:592-604`、`670-688`
- 问题：手机上 Dayline 放在右抽屉。`getJournalOpenLeaf` 在主区域没有 markdown leaf（只有 `empty`）时，会回退到传入的 `daylineLeaf`。判断条件 `typeof daylineLeaf.openFile === 'function'` 对任何 leaf 都成立。于是笔记在抽屉里打开，替换掉日历；`_mobileJournalLeaf` 记住的也是这个抽屉 leaf。下次打开 Dayline 时，`getRightLeaf(false)` 会再建一个 leaf，抽屉里的 leaf 越来越多。
- 复现：手机上关闭所有笔记，打开 Dayline，点击任意有日记的日期。已用 mock workspace 复现：`openJournalFile target: right-drawer-calendar`。
- 修复：不要把 Dayline leaf 作为打开笔记的兜底目标。优先复用主区域的 `empty` leaf（用 `leaf.getRoot() === workspace.rootSplit` 过滤），都没有时再 `workspace.getLeaf('tab')`。`_mobileJournalLeaf` 只记录主区域的 leaf。
- 测试：只有 empty 主 leaf 和抽屉 calendar leaf 时，返回主 leaf；连续打开两个日期后，抽屉 leaf 的类型仍是 `calendar-sidebar-view`。

**P-02 · High · 回归（未提交改动）· 确认**
- 位置：`src/plugin.ts:626-640`
- 问题：`_returnToMobileMarkdown` 在没有 `_mobileReturnLeaf` 时回退到 `daylineLeaf`，然后执行 `setViewState({ type: 'markdown', active: true })`，日历 leaf 就变成了一个空 markdown 视图。修改前这种情况是直接返回 `false`。
- 复现：从 ribbon 直接打开 Dayline，然后点"返回笔记"。
- 修复：目标是 Dayline 类型的 leaf 时直接返回 `false`。有 `_mobileReturnLeaf` 时只做 `revealLeaf`/`setActiveLeaf`，不要 `setViewState`（它会重置当前文件）。
- 测试：没有 markdown leaf 时返回 `false`，且不调用 Dayline leaf 的 `setViewState`。

**P-03 · Medium · Bug（未提交改动）· 疑似**
- 位置：`src/plugin.ts:559-565`、`682`
- 问题：`_mobileJournalLeaf` 只检查了 view type，没检查它是否已经 detach。用户关掉那个标签后，可能会往一个不可见的 leaf 里打开笔记。
- 修复：使用前确认它还在 `workspace.getLeavesOfType('markdown'|'empty')` 里，或者 `leaf.parent` 存在；不满足就清空。

**P-04 · Medium · Bug/泄漏 · 确认（竞态部分疑似）**
- 位置：`src/plugin.ts:343-364`
- 问题：`onunload` 先依次 await 各个 flush（天气缓存、地名缓存、写入队列、moodStore、visibility controller），之后才移除浮层、body 类名和 tooltip。(1) 任何一个 flush 抛错，后面的清理全部跳过。(2) Obsidian 不会 await `onunload`，快速禁用后再启用时，旧实例延迟执行的清理可能删掉新实例刚加上的类名和浮层。
- 修复：同步清理放在最前面。异步 flush 放后面，各自 try/catch，或者用 `Promise.allSettled`。
- 测试：`saveData` reject 时，`onunload` 之后 body 上不再有 `dayline-mobile`，浮层数量为 0。

**P-05 · Medium · 数据丢失 · 确认（代码层面）**
- 位置：`src/plugin.ts:1096-1132`；没有实现 `onExternalSettingsChange`
- 问题：`saveSettings` 和缓存 flush 会用内存里的 `settings`/`weatherCache`/`geocoderCache` 整体覆盖 data.json。Obsidian Sync 或其他设备的修改会在下一次保存时丢失（天气缓存 2s 防抖，所以很快就会触发）。
- 修复：实现 `onExternalSettingsChange()`，重新 `loadSettings()` 并刷新视图；缓存写入改为按 key 合并。
- 测试：load 后外部修改 data.json，再 `_flushWeatherCache()`，外部的修改应当保留。

**P-06 · Medium · Bug · 确认**
- 位置：`src/plugin.ts:819-827`、`167-176`
- 问题：手机端的索引是懒加载的。`_maybeRemind` 没检查 `journalIndex.isReady`，所以当天没打开过 Dayline 的用户，即使写了日记也会被提醒"还没写"。同时没有"今天已经提醒过"的标记，`setInterval` 被节流后可能重复提醒，也可能错过提醒。
- 修复：索引未就绪时，直接用 `vault.getAbstractFileByPath` 查当天的日记文件；记录 `_lastReminderDate`；触发条件改为"已过设定时间且今天没提醒过"。

**P-07 · Medium · 功能缺陷 · 确认**
- 位置：`src/plugin.ts:759-766`、`829-852`、`862-869`
- 问题：保存心情时，如果当天的日记不存在，会调用 `ensureJournalFile(path, '')` 创建一个空文件，绕过了 `createDailyNoteForDate` 里的模板和 Templater。之后"新建今日日记"打开的就是这个空白文件。
- 修复：`targetPath` 在 `dailyFolder` 下且文件名是日期时，调用 `createDailyNoteForDate(date)`。

**P-08 · Medium · 无障碍 · 确认**
- 位置：`src/plugin.ts:1768-1917`，`src/touch-targets.ts` 的 `bindOpenOnPointer`
- 问题：日期格子是普通 `div`，只响应 `pointerdown`，没有 `tabindex`/`role`，Enter/Space 也不起作用。`aria-label` 挂在无 role 的 div 上，读屏会忽略。月份跳转面板的年份输入框不响应 Enter。
- 修复：格子加 `role="button"`（或 grid/gridcell 加 roving tabindex）、`tabindex`，以及 Enter/Space 处理；加 `data-calendar-focus` 以便重绘后恢复焦点；年份输入框按 Enter 执行 apply。
- 测试：JSDOM 中对格子派发 Enter，`openJournalFile` 被调用；重绘后焦点仍在原格子上。

**P-09 · Medium · Bug · 确认（重复请求部分疑似）**
- 位置：`src/plugin.ts:1642`、`2131-2134`、`2297-2327`
- 问题：`_renderCalendar` 先 `el.empty()` 再渲染天气卡片，所以 `this._weatherCardEl.isConnected` 永远为 false，`_revalidateConnectedWeatherCard` 这条分支走不到。结果是：已有快照时永远不按 TTL 刷新；上次请求失败时，每次重绘都重新请求，卡片闪"加载中"。
- 修复：保留天气卡片节点、重新插入，或者去掉 `isConnected` 条件，日期相同时走 revalidate。

**P-10 · Medium · 功能缺失/死代码 · 确认（主 agent 已 grep 复核）**
- 位置：`src/plugin.ts:1992-2095`
- 问题：`_onExifEnter`、`_getPersistedExifFields`、`_persistExifFields` 三个方法只互相调用，仓库中没有其他调用方。日历悬停实际走的是 `_onMediaEnter` → `mediaService.getMetadata`。所以 roadmap 里标为 `KEEP` 的"EXIF/GPS 写入 frontmatter"产品约定，在当前代码里并没有执行。
- 需要产品决定：保留该约定，就在 `_onMediaEnter` 的图片分支接上，同时修复 W-02 和 W-14；放弃该约定，就删除这三个方法，并更新 roadmap 和 README。
- 测试：按所选方案，要么断言悬停后调用了 `processFrontMatter`，要么断言这几个方法已不存在。

**P-11 · Low · Bug · 确认**：`src/plugin.ts:2785-2791`。`_convertHeicEmbed` 先插入"转换中"的 loader，但在 `!(file instanceof TFile)` 时直接 return，loader 永远不会消失。修复：该分支里移除 loader 或显示失败文案，也可以统一放到 `finally` 里处理。

**P-12 · Low · 内存 · 确认**：`src/plugin.ts:2873-2904`。`_exifNoteDisposers` 是一个只增不减的 Set，Live Preview 每次重建节点都往里加一个闭包，闭包持有已脱离 DOM 的节点，直到视图关闭才释放。修复：改为 `Map<Element, dispose>`，在 MutationObserver 的 `removedNodes` 回调里释放，或者定期清理 `!isConnected` 的条目。

**P-13 · Low · 功能缺失 · 确认**：`src/plugin.ts:829-848`。内置模板只替换 `{{date}}`/`{{title}}`，不支持 `{{time}}`/`{{date:FORMAT}}`。`createDailyNoteForDate` 是先检查后创建，并发触发时第二次会报 "File already exists"。修复：用 `window.moment` 支持格式化；按 path 缓存进行中的 Promise，或者 create 失败后再查一次文件。

**P-14 · Low · Bug · 确认**：`src/plugin.ts:1867-1898`。格子显示心情用 `moodStore.get(dailyPath)`，编辑时却用 `moodPath`（主条目）。配置了多个来源时两者可能不一致。修复：统一用 `moodPath`。

**P-15 · Low · Bug · 确认**：`src/plugin.ts:2457-2477`。`_performRefresh` 在 token 失效时直接 return，不重置 loading 也不提示；catch 分支没检查 token/日期，错误可能显示在别的日期上。修复：token 不匹配时仍然清理状态；catch 里加上相同的检查。

**P-16 · Low · UX · 确认**：`src/plugin.ts:240-251`、`974-977`。没有打开日历视图时，"刷新天气"和"打开那年今日"命令静默无效。命令名在 onload 时按当时语言固定，切换语言后需要重启。修复：把 provider 提升到 plugin 层，或者至少弹一个 Notice。

**P-17 · Low · 性能 · 确认**：
- md 保存时 `vault.modify` 和 `metadataCache.changed` 会各触发一次 `refreshFile`（`plugin.ts:329-339`，`journal-metadata-refresh.ts:24`）。
- `refreshJournalViews()` 和 index 订阅会导致重复重绘（`811-817`/`1361`）。
- 点击日期会经过 active-leaf-change 和 `openFileInLeaf` 两次整网格重建（`1450`/`2550-2552`）。
- `refresh()` 会清空全局 EXIF 缓存。

修复：md 文件只依赖 `changed` 事件；日历重绘交给订阅；render 用 rAF 合并；不要在 refresh 时清空 EXIF 缓存。

**P-18 · Low · Bug · 确认**：`src/plugin.ts:491-501`。迁移代码用 `${configDir}/plugins/${PLUGIN_ID}/data.json` 拼路径。手动安装时目录名可能和 id 不同（例如 `dayline-main`），数据会写到错误目录。修复：改为 `normalizePath(`${this.manifest.dir}/data.json`)`。

**P-19 · Low · 测试质量（未提交改动）· 确认**：`src/plugin.ts:152`/`556`/`584` 中的 `_mobileLastDaylineLeaf` 只写不读。`tests/dayline-mobile.test.ts:316-338` 的两个用例标题写的是"路由到右抽屉"，实际只断言了 `getPreferredDaylineLeaf`。`:434` 附近靠 `pluginSource.toContain(...)` 断言源码字符串。修复：删除无用字段，换成行为测试。

**P-20 · Low · Bug · 确认**：`src/plugin.ts:1961`，`src/i18n.ts:2805-2808`。跳转面板允许年份 1–99，但 `Date.UTC`/`new Date(y, …)` 会把 0–99 解释为 1900–1999，导致标题和格子不一致。另外过了午夜，"今天"的高亮要等下次重绘才更新。修复：`min` 设为 100 或用 `setUTCFullYear` 构造；加一个午夜定时重绘。

### 3.2 日记索引 / 时间线

已确认没有问题：范围内没有 `innerHTML`/`MarkdownRenderer`，不存在 XSS；rename 能正确移出、移入来源；日期计算锚定 `T12:00:00`，跨 DST 时连续天数正确；时间线的 observer 和定时器在 `onClose` 里都有清理。

**J-01 · High · Bug · 确认**
- 位置：`src/journal-index.ts:120-125`
- 问题：`if (value !== undefined) return { date: null, reason: 'invalid-date' };`。YAML 里写 `date:` 留空时解析为 `null`，也会走进这个分支，不会回退到文件名。
- 复现：`resolveJournalDate('2024-03-05.md', { date: X })` 中 X 为 `null`、`''`、未展开的 Templater `'<% tp.date.now() %>'`、`'[[2024-03-05]]'`、`'2024/03/05'` 时，都返回 invalid，这篇日记就从日历和时间线中消失了。
- 修复：通用字段（date/creationDate）解析失败后，继续尝试下一个字段和文件名，只记一条诊断信息；用户显式配置的 `dateField` 可以保持严格。`parseDateString` 先去掉 `[[…]]` 再解析。
- 测试：上述输入搭配文件名 `2024-03-05.md`，应得到 `2024-03-05`。

**J-02 · Medium · Bug · 确认**
- 位置：`src/excerpt.ts:64-73`
- 问题：`.replace(/\{body\}/g, body)` 用的是字符串替换，正文里的 `$&`、`$$`、`` $` `` 会被当作替换模式。替换完正文后又做 `{key}` 替换，正文里字面的 `{title}` 也会被换掉。
- 复现：模板 `'{year}: {body}'`，正文 `price $& and $$`，输出为 `"2024: price {body} and $ …"`。
- 修复：统一用函数替换 `() => value`，或者单次 `/\{(\w+)\}/g` 回调，正文不参与二次替换。

**J-03 · Medium · 性能 · 确认**
- 位置：`src/journal-timeline-filters.ts:90-91, 118-119`；`src/journal-timeline-view.ts:293-296`
- 问题：每次按键都对已经归一化过的 `normalizedSearchText` 再做一次 NFKC 加 `toLocaleLowerCase`，而且输入没有防抖。实测 3000 条、每条约 4KB，每次按键约 80ms，直接 `includes` 只要约 7.7ms。
- 修复：有 `normalizedSearchText` 时直接用它，只归一化 query；输入防抖 120–200ms。可以和 J-14 一起改。

**J-04 · Medium · Bug · 确认**：`src/journal-index.ts:181`。`/^#\s+(.+)$/m` 扫描的是原文，会命中代码块里的 `# install deps`。修复：优先取 `cache.headings` 中第一个 level 1 标题；兜底时先剥掉 frontmatter 和代码块。

**J-05 · Medium · Bug · 确认**：`src/journal-search.ts:57-60`。标签正则扫描全文，`color: "#ff0000"`、代码块里的 `#fff`、`Issue #123` 分别被识别为 `ff0000"`、`fff`、`123`，并出现在筛选下拉里。修复：有 `cache.tags` 时直接使用；兜底时剥离 frontmatter 和代码块，排除引号，并要求标签至少含一个非数字字符。

**J-06 · Medium · Bug · 疑似（需真机确认）**：`src/on-this-day.ts:416`、`src/plugin.ts:2286`。``style.backgroundImage = `url(${url})` `` 没加引号（同文件 `:2513` 是加了引号的）。文件名含 `(`、`)`、空格或引号时 CSS 解析失败，"那年今日"卡片和日历条不显示图片，例如 `IMG_1234 (1).jpg`。修复：抽一个 `cssUrl()` 工具函数，输出 `url("…")` 并转义 `"` 和 `\`。

**J-07 · Medium · Bug/UX · 确认**：`src/journal-index.ts:185-187, 391-399`；`src/journal-source-settings.ts:31-36`。存在 `type:'daily'` 的来源时，`dailyFolder` 被忽略，但新建日记、记录心情、提醒仍然使用 `dailyFolder`（`plugin.ts:703/721/830`）。结果是新建的日记在时间线里看不到。`sourceForPath` 按顺序匹配，daily 排在第一位，嵌套在它下面的来源永远匹配不到。修复：校验时要求显式 daily 来源的路径等于 `dailyFolder`；匹配改为最长前缀，或者直接拒绝嵌套配置。

**J-08 · Medium · 无障碍/泄漏 · 确认**：`src/on-this-day.ts:190-293`。弹窗没有 `role="dialog"`/`aria-modal`，打开时不把焦点移进来，也没有焦点陷阱，关闭后不恢复焦点。`_onKeyDown` 挂在 `document` 上且不判断 `e.target`，在输入框里按 ←/→ 也会切换日期。快速点两次会叠出两个弹窗。插件 `onunload` 不关闭弹窗。修复：改用 Obsidian `Modal`，或者补齐以上语义；plugin 跟踪弹窗实例，重复打开时复用，卸载时关闭。

**J-09 · Low · 确认**：`src/excerpt.ts:1, 15-40`。摘要里残留 callout 标记 `[!note]`、`%%注释%%`、含 `>` 的 HTML 注释。frontmatter 正则遇到 `title: a---b` 会提前结束。修复：frontmatter 正则改为 `/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/`，并补充上述几种清理规则。

**J-10 · Low · 确认**：`src/excerpt.ts:50`。按 UTF-16 截断会把 emoji 切成孤立的代理对。修复：`Array.from(text).slice(0, max)`。

**J-11 · Low · 确认**：`src/journal-stats.ts:110, 126-129`；`src/journal-timeline-view.ts:248`。统计按宿主时区计算，没有用 `weatherTimezone`；本月完成率的分母是整月天数（5 月 3 日连续写 3 天，显示 10%）。修复：传入按设置时区计算的 today 和 `weekStart`，分母改为截至今天的天数。

**J-12 · Low · 功能缺失（产品决定）**：`src/on-this-day.ts:104, 112`。2 月 29 日的条目在平年永远不会自动出现。建议平年在 02-28 当天合并展示。

**J-13 · Low · 疑似**：`src/plugin.ts:167, 519-523`。只有桌面端首次建索引前会等 metadataCache `resolved`。移动端恢复布局时 `getFileCache` 可能返回 null，frontmatter 日期和嵌入图因此缺失。修复：移动端也 await `resolved`。

**J-14 · Low · 功能缺失 · 确认**：`src/journal-timeline-filters.ts:118-119`。多词查询按整句匹配，`tokyo walk` 匹配不到 `tokyo sunny walk`。修复：按空白拆词后 AND 匹配。

### 3.3 心情（`src/mood-*.ts` 等）

已确认没有问题的部分：
- `mood-modal-viewport.ts` 里的 visualViewport/window/document 监听器和 observer 都成对释放。
- 流体控件的 pointer capture 会释放，pointercancel 时回滚，用 `isPrimary` 屏蔽多指操作，slider 的 role/aria/键盘支持齐全。
- 保存有 `pendingOperation` 防止重复提交。
- `onunload` 会执行 `flush()`。
- `badge-svg` 的输入只来自构建期常量。

**M-01 · High · 数据丢失 · 确认（Vitest 复现）**
- 位置：`src/mood-store.ts:207`、`348-349`、`366-388`；`:186` 的"Unknown schema normalized"分支永远走不到
- 问题：`validateMoodMetadata` 只要发现一条坏记录，或 `schemaVersion ∉ {1,2}`，就判定整份主文件无效。随后读取 `.bak`（比主文件落后一次写入），直接 `writeJson` 覆盖主文件，覆盖前不保留原文件副本。
- 复现：
  - `set a`，再 `set b`，然后手动在主文件里加一条 `score: "1"`，重载后 `b.md` 丢失，主文件只剩 `a.md`。
  - 把 `schemaVersion` 改成 3（模拟新版本插件通过同步写入的数据），旧版本会把它降级覆盖，再同步回其他设备。
- 修复：
  - 校验改成逐条进行：坏记录跳过，并收集到 `warnings`。
  - `schemaVersion > MOOD_SCHEMA_VERSION` 时进入只读模式，禁止写入，并提示用户升级。
  - 从备份修复之前，先把损坏的主文件另存为 `${path}.corrupt-<ts>`。
- 测试：一条坏记录不影响其他记录；遇到未来 schema 时主文件字节不变；修复前生成 `.corrupt` 副本。

**M-02 · High · Bug · 确认（Vitest 复现）**
- 位置：`src/mood-store.ts:268-279`（`mergeMetadata`）、`731-747`；`src/plugin.ts:330` 的 modify 事件只处理 `.md`
- 问题：检测到冲突时 `mutate` 抛出异常，但不刷新合并基准 `this.data`，之后每次写同一个 key 都会冲突。插件不监听元数据 JSON 的外部修改，界面一直显示旧值。
- 复现：A 设备 `set d=1`；同步把磁盘上的值改成 `d=-1`；A 再 `set d=2`，连续 3 次都抛 `Mood metadata conflict`，必须重启插件才能恢复。
- 修复：冲突时用磁盘快照刷新 `this.data`/`primaryRaw` 并发出变更通知；`set` 这类显式覆盖操作按 `updatedAt` 以最后写入为准；为 `metadataPath` 注册外部修改监听，触发 `load()`。
- 测试：外部修改之后，第二次 `set` 能成功；`get()` 返回外部写入的新值。

**M-03 · Medium · 确认**：`src/mood-store.ts:448-471`。`set()` 和 `mergeMetadata` 都不校验分数，`set('c.md','2')` 会把字符串写到磁盘，下次加载时触发 M-01，整份文件被回退。修复：在入口处调用 `parseMoodScore`，拿到 `undefined` 就抛错；`restoreOrphan`/`deleteRecord` 的回退路径也要同样处理。测试覆盖 `'2'`、`NaN`、`3`、`1.5`。

**M-04 · Medium · 安全 · 确认**：`src/mood-export.ts:78-81`。`escapeMoodCsvCell` 只处理了 `" , \r \n`，`=HYPERLINK(...)`、`@SUM(1)` 这类内容在 Excel/Numbers 里仍会作为公式执行。修复：只针对字符串列（sourcePath/labels/note），以 `= + - @ \t \r` 开头时加前缀 `'`；score 列本来就可能是 `-2`，不能加。次要问题：label 里含 `; ` 时会和分隔符冲突；缺少 UTF-8 BOM，Excel 打开中文会乱码。

**M-05 · Medium · 确认（代码推导）**：`src/mood-store.ts:401-406`、`488-489`、`509`；`src/journal-index.ts:475`。重命名或删除后，旧路径会留下 tombstone，同路径新建的笔记（比如模板生成的带 `mood:` 的日记）的 frontmatter 心情会被永久遮蔽，"导入 frontmatter"也会跳过它（`:574`）。tombstone 只增不减。修复：vault `create` 时，如果 tombstone 的 `deletedAt` 早于文件 `ctime` 就清除；给 tombstone 加 TTL 或 GC。

**M-06 · Medium · UX · 确认**：`src/mood-picker-modal.ts:50`、`265`、`398`。`drafts[].baseline` 写入后从未被读取，所以脏检查实际没有实现。在 A 日编辑后切到 B 日保存并关闭，A 日的编辑会静默丢失；按 Esc 或点击背景关闭时也不确认。修复：`close()` 时对比指纹，有未保存内容就提示，或者一并保存。

**M-07 · Medium · 疑似（依赖浏览器）**：`src/mood-picker-modal.ts:237`、`248-273`。原生日期输入框每改一段就触发 `change`，立即禁用所有输入并重建 DOM，桌面 Chromium 下逐段输入会被打断，还可能为一个中间日期建立草稿，保存时生成错误日期的日记文件。修复：日期完整且合法（年份 ≥ 1900）时才切换，并加 debounce；切换过程中不要禁用日期输入框本身。

**M-08 · Low · 确认**：`src/settings-tab.ts:652-660`。修改心情元数据路径时每按一个键就执行 `configure()` 和 `load()`，旧的 load 被 reject，形成未处理的 rejection；中途保存会写到半截路径（比如 `.js`）。修复：失焦时提交，或加 debounce；不以 `.json` 结尾时不应用；加 try/catch。

**M-09 · Low · 确认**：`src/journal-index.ts:142, 190` 用 `parseFloat`，而 `src/mood.ts:3-9` 的 `parseMoodScore` 是严格解析。`mood: "1 good"` 在日历上能显示，导入时却被跳过。修复：统一使用同一个解析函数。

**M-10 · Low · 潜在（目前没有生产调用方）**：`src/mood-reports.ts:100-130`。日期取自 UTC ISO 的 `recordedAt`，UTC+8 在 4/1 01:30 记录的会算进 3 月；字符串分数导致平均值被拼接（`['1',1]` 算出 5.5）；分母包含无效分数。修复：日期取笔记日期，分数先过 `parseMoodScore`。

**M-11 · Low · 无障碍 · 确认**：`src/plugin.ts:1879-1887`。心情按钮的 `aria-label` 不包含心情等级，视觉上也只靠颜色区分。修复：label 中加入心情名称，并补充形状或高度等非颜色提示。

**M-12 · Low · 性能 · 确认**：`src/fluid-mood-control.ts:545-561`、`155`、`288`、`469`。空闲时仍以 60fps 重绘，每帧调用 `getBoundingClientRect`；`visibilitychange` 绑在全局 `document` 上，在弹出窗口中不生效。修复：数值收敛后降帧或暂停；用 ResizeObserver 缓存尺寸；改用 `ownerDocument`。

**M-13 · Low · UX · 确认**：`src/mood-picker-modal.ts:149-150`、`386-392`。`onSave` 挂起时 `close()` 和 Esc 都会被吞掉，modal 关不掉。修复：保存设约 15s 超时，超时后恢复可关闭并提供重试。

**M-14 · Low · 确认调用无条件**：`src/mood-store.ts:534`、`787-795`。`deleteRecord` 不检查 `mirrorMoodToFrontmatter`，总会调用 `processFrontMatter`，删掉用户自己写的 `mood` 等字段，并可能重新序列化 YAML。修复：只在开启镜像，或确实从 frontmatter 来源删除时才调用。

### 3.4 媒体 / 天气 / 定位

已确认没有问题：天气、地名、EXIF 提示全部通过 `setText`/`createSpan({text})` 渲染，整个仓库没有 `innerHTML`，没有 XSS。S/W 半球的 GPS 符号处理正确。本节涉及网络的条目未联网实测。

**W-01 · High · 内存 · 确认（已读 libheif bundle 源码）**
- 位置：`src/image-metadata.ts:542-543`、`594-600`
- 问题：libheif 的 `HeifDecoder.decode()` 只在同一个实例下次调用 `decode` 时才释放上一个 context，`image.free()` 只释放 image handle。`HeicCache._convert` 每次都 `new libheif.HeifDecoder()`，所以每转换一次，WASM 堆就永久多出约一个文件大小的占用。滚动几十张 iPhone HEIC 就能涨到几百 MB，移动端可能因此 OOM。
- 修复：`HeicCache` 里复用同一个 decoder（转换本来就是串行的）；或者在 `finally` 里调用 `libheif.heif_context_free(decoder.decoder)` 并置空。
- 测试：mock libheif，统计 `heif_context_alloc` 和 `heif_context_free` 的调用次数，二者应相等。

**W-02 · High（潜在，当前在死代码上，见 P-10）· Bug/数据损坏**
- 位置：`src/plugin.ts:2008-2018`，配合 `2063-2093`
- 问题：`gpsField.value = place` 直接改写了 `_getPersistedExifFields` 返回的共享数组，这个数组来自 metadataCache 的 frontmatter 对象或 `exifCache`，并且已经传给了异步的 `_persistExifFields`。一旦这条路径接入，frontmatter 里的 `exif_gps` 会被写成地名，坐标随之丢失，`exifCache` 也会被污染。
- 修复：只在副本上修改（`fields.map(f => ({...f}))`），或者把地名写到单独的 `exif_place` 字段；`_getPersistedExifFields` 返回拷贝。

**W-03 · Medium · 确认**：`src/weather-service.ts:458`。Obsidian 的 `RequestUrlParam`（`obsidian.d.ts:5445`）没有 `timeout` 字段，传进去会被忽略。网络挂起时天气卡会一直显示"加载中"。Nominatim 的请求也没有超时，并且在 `_requestQueue` 里串行执行，一个请求挂住后面全部阻塞。修复：复用 `media-service.ts` 里的 `withTimeout`，用 `Promise.race` 包一层。测试：注入一个永不 resolve 的 request，配合 fake timers 验证。

**W-04 · Medium · 确认**：`src/weather-service.ts:288-293`、`388`；`src/plugin.ts:1166-1178`、`3063-3067`。`isSnapshotStale` 不区分日期，打开 2021 年的日记，只要距上次拉取超过 2 小时就会重新请求 archive。`_cleanupWeatherCache` 按 `fetchedAt` 删除 90 天前的条目，而天气已不再写入 frontmatter，缓存就是唯一的副本，"补齐历史天气"的结果 90 天后就会被删掉。修复：archive 来源的历史日期永久有效；清理改为按条目数或按日期设上限。

**W-05 · Medium · 疑似（未联网）**：`src/weather-service.ts:431`、`450-452`。只要 `date < today` 就请求 `archive-api`，而 ERA5 数据约有 5 天延迟，所以昨天到前几天通常查不到数据。修复：最近约 7 天用 forecast 接口的 `past_days`/`start_date` 参数。测试：用 URL 快照断言 `today-1` 请求的是 `api.open-meteo.com`。

**W-06 · Medium · 确认**：`src/image-metadata.ts:132-139`、`176`。有理数分母为 0 时返回分子，没有定位的相机写入的 0/0 会被解析成 `exif_gps: '0.0000, 0.0000'`，并发送给 Nominatim。修复：分母为 0 时返回 NaN；GPS 任一分量无效，或者经纬度都为 0 时丢弃；缺少 Ref 时同样视为无效。

**W-07 · Medium · 确认（关联未提交的定位功能）**：`src/settings-tab.ts:132-143`；`src/weather-service.ts:199`、`464`；`src/plugin.ts:2171`。`weatherLocationName` 的显示优先级高于坐标，所以定位到新位置后，界面仍显示旧的地点名。修复：坐标变化超过阈值时清空或更新地点名，也可以弹窗询问用户。

**W-08 · Low-Med · 隐私/文档**：`src/settings-tab.ts:138-139`；三份 README。
- README 没有说明"使用当前位置"会读取设备定位，Obsidian 审核要求披露这类行为。
- `toFixed(4)` 精度约 11m，天气只需要 2 位小数（约 1km）。
- 桌面 Electron（尤其是 Linux）通常返回 `POSITION_UNAVAILABLE`，原始的英文 `error.message` 被直接显示在 Notice 里（疑似，未实测）。

修复：三份 README 补充说明；坐标保留 2 位小数；错误码 2 映射到本地化文案；平台不支持时隐藏按钮。

**W-09 · Low-Med · 确认**：`src/settings-tab.ts:402-406`、`416-420`。经纬度输入框每按一个键就保存，输入过程中的每个中间值都是合法坐标，各自触发最多 3 次请求。修复：失焦时保存，或 debounce 约 800ms。

**W-10 · Low · 确认**：`src/image-metadata.ts:343-349`。快门速度显示有误：0.8 显示为 `1/1s`，0.6 显示为 `1/2s`，0 显示为 `1/Infinitys`。修复：`<= 0` 时跳过；`t >= 0.3` 或 `1/t` 不接近整数时显示小数。

**W-11 · Low · 确认**：`src/image-metadata.ts:281-286`。只检查了 `< 4` 字节，但之后会读 `getUint32(8)`，4 到 11 字节的输入会抛出 RangeError。修复：先检查 `byteLength >= 12`。

**W-12 · Low · 疑似**：`src/image-metadata.ts:261-277`。读取 HEIC 的 EXIF 时，在前 16MB 里暴力搜索 `II*\0`/`MM\0*`，可能误命中 mdat 里的数据。修复：通过 `iinf`/`iloc` 定位 Exif item，并跳过 4 字节的 offset 头。

**W-13 · Low · 确认**：`src/image-metadata.ts:659`、`767-786`。Nominatim 的 UA 是写死的 `ObsidianDayline/2.0`，没有联系方式；发送的是完整精度坐标，缓存键精确到 5 位小数；请求失败不做负缓存。修复：UA 带上 manifest 版本和仓库 URL；坐标和缓存键都取 3 位小数；失败结果负缓存 10 分钟。

**W-14 · Low（潜在，见 P-10）**：`src/plugin.ts:2073`。`void this._persistExifFields(...)` 没有 `.catch`，YAML 非法时会产生未处理的 rejection。悬停这个只读动作还会写笔记、触发 modify。

**W-15 · Low · 确认**：`src/image-metadata.ts:476-485`。`HeicCache._libheifReady` 会一直保存 rejected 的 promise，WASM 实例化失败一次，HEIC 在整个会话内都不可用。修复：在 catch 里先把它置为 null，再抛出错误。

**W-16 · Low · 疑似**：`src/media-service.ts:481-483`。LRU 上限 48，淘汰时会 `revokeObjectURL`，可能 revoke 掉 DOM 中仍在使用的 blob URL，导致图片变成裂图。修复：用引用计数，或者在视图卸载时统一 revoke。

### 3.5 UI / 样式 / i18n / 设置 / 发布

已确认没有问题的部分：
- 9 种语言的 `t()` 键集合完全一致（289 个）。没有空值，`{placeholder}` 与英文一致；代码中引用的键全部存在。
- 移动诊断对复制出去的内容做了白名单过滤，不会泄露路径或标题。
- manifest 字段和版本号一致（2.7.0），README 已经披露 Open-Meteo 和 Nominatim。

有 5 项与其他模块的审查独立命中同一问题，这里不重复展开，交叉验证后可信度更高：

| UI 条目 | 同一问题 |
|---|---|
| U-01 返回笔记把 Dayline leaf 变成空 markdown | P-02 |
| U-02 日期格子无法用键盘操作；另外 `aria-label` 用的是 ISO 日期，应改为 `formatJournalDate` | P-08 |
| U-03 那年今日弹层焦点和键盘问题；另外 `z-index: 9999`（`styles.css:884-889`）可能盖住 Notice | J-08 |
| U-04 经纬度逐键保存；另外 `parseFloat` 会放过 `39abc`，需要严格校验并就地提示 | W-09 |
| U-05 定位后地点名不更新 | W-07 |

**U-06 · Medium · 功能/i18n（未提交改动）· 疑似**
- 位置：`src/settings-tab.ts:143-145`、`423-431`，`src/geolocation.ts:84-87`
- 问题：
  - "使用当前位置"按钮在所有平台都显示，而且是 CTA 样式。桌面 Electron 通常没有定位服务 key，大多会失败。
  - `locateFailed` 把浏览器返回的原始英文 `error.message` 插进本地化文案。
  - 按钮文字和设置项名称重复。
  - iOS 上的授权表现取决于宿主 Info.plist，尚未验证。
- 修复：只在确认可用的平台显示按钮，或者先探测再显示；错误码映射到本地化文案，原始 message 只输出到 `console.debug`；按钮文字改成"定位"。和 W-08 一起处理。
- 验证：桌面、iOS、Android 各实测一次。

**U-07 · Medium · i18n/UX · 确认（需产品决定）**：`src/plugin.ts:103-104`，`src/i18n.ts:2712-2721`。新安装时 `displayLanguage` 默认是 `'zh'`，英文系统用户首次打开看到的是中文界面。README.en 里写明了这一点。建议只对新安装（`loadData()` 为 null）默认 `'system'`，已有用户保持不变。

**U-08 · Low · i18n · 确认**：`src/plugin.ts:1085-1088`，`src/settings-tab.ts:171`，`src/on-this-day.ts:191`。`LOCALE` 表读的是 load/save 时固定下来的 `settings.weatherLanguage`，`t()` 则是实时解析 `'system'`。跟随系统时，如果改了系统语言，界面会中英混排。修复：`_l` 统一传 `getDisplayLanguage(settings)`。

**U-09 · Low · i18n · 确认**：`src/plugin.ts:1773`。`calendarEntryCount` 只区分 1 和非 1，俄语会显示 "2 записей"。`locale.ts` 里已有 `formatEntriesCount`，直接复用或改用 `Intl.PluralRules`。另外 `t()` 用 `String.replace` 只替换第一个同名占位符，应改为 `replaceAll`。

**U-10 · Low · UX（未提交改动）· 确认**：`src/dayline-mobile.ts:227-230`。`backToNoteHint` 只放在手机按钮的 `title` 里，触屏设备上永远看不到。要么删掉，要么改成可见的一次性引导，并用 `aria-describedby` 关联。

**U-11 · Low · 移动 · 疑似**：`src/mobile-quick-entry.ts:30-32`，`src/platform-capabilities.ts:100-103`，`src/plugin.ts:157`。快捷入口按静态的 `Platform.isPhone` 判断，路由按实时视口的 `isPhoneLayout` 判断，iPad 窄分屏时两者不一致。`capabilities` 只在 onload 时检测一次。修复：快捷入口改用 `usesPhoneLayout`，在 `resize`/`css-change` 时重新检测。

**U-12 · Low · 样式/无障碍 · 确认**：`styles.css:204`、`229`、`996`。`.cal-title-button:focus-visible` 去掉了 outline；`.cal-otd-date-input` 设置了 `outline: none` 且没有替代样式；`.cal-icon-button` 获得焦点时只变背景色。修复：统一用 `outline: 2px solid var(--interactive-accent); outline-offset: 2px`（参考 `styles.css:1403`）。

**U-13 · Low · 发布 · 确认**：
- README 三份都还没提到设备定位（和 W-08 合并处理）。
- `scripts/package-release.mjs` 头部注释说运行时从 `icons/` 读取图标，实际已经内联进 `main.js`，注释过时。
- 仓库没有 `versions.json`，目前不需要；以后升级 `minAppVersion` 时要补上。

## 4. 需要产品决定的事项

1. P-10：EXIF/GPS 写入 frontmatter 的约定保留还是放弃？保留的话，W-02 和 W-14 必须一起修；放弃的话，删掉这段死代码，并更新 roadmap 里的 `KEEP` 条目。
2. U-07：新安装时默认语言是否改为跟随系统？
3. J-12：平年的 2 月 28 日是否也显示 2 月 29 日的回忆？
4. M-02：心情冲突采用最后写入者覆盖（last-writer-wins），还是保留冲突并提示用户选择？

## 5. 未验证项（修复前先确认）

- 手机真机：P-01、P-02、P-03、U-10、U-11 的实际表现，以及 J-13 的启动时序。
- 真实 Obsidian：J-06 中 `getResourcePath` 对括号的编码，M-07 中各平台 WebView 的日期输入行为。
- 联网：W-05 中 archive 接口的延迟天数，U-06/W-08 中 Electron 的定位能力。
- 本次审查没有运行 `npm run build`，因为它会重写已提交的 `main.js`。







