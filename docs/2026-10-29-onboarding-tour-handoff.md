# Dayline 新手引导（聚光灯）· 交接文档

日期：2026-10-29
交接对象：接手实现的 AI / 工程师
原型：`docs/ui-explorations/onboarding-first-run/explore/spotlight.html`（可 `?step=1..9` 直达）
截图：`docs/ui-explorations/onboarding-first-run/shots/g1..g10`
设计取舍记录：`docs/ui-explorations/onboarding-first-run/README.md`

---

## 0. 一句话

在插件第一次启用后，用一层盖住整个 Obsidian 窗口的遮罩，把注意力依次引到「月历 → 一天 → 心情 → 天气 → 时间线入口 → 时间线列表 → 搜索 → 设置 → 今天」，最后打开今天的日记并留下光标。用户随时可以跳过，走完后不再出现。

## 1. 背景与判断

- **用户**：已经在 Obsidian 里写日记、带着几百篇旧笔记来装插件的人（主流）。他们最想看到的是「我的日子出现在日历上」，不是读一段说明。
- **现状**：启用后日历侧栏会自动打开（`showCalendarView` 默认 true），但没有任何说明；默认目录 `Calendar/Daily` 不对时要自己翻到设置；心情点在格子里默认透明，新用户不知道能点。
- **目标**：让用户在一次 30–60 秒的引导里看到「日历里有我的日子 → 一天上有照片和心情 → 心情可以点开记录 → 时间线能翻旧日子 → 设置在哪 → 从今天开始写」。
- **不做**：功能轮播、假数据演示、视频、必须走完的强制向导、完成徽章。

## 2. 引导流程（九步）

顺序是刻意的：先看屏幕上已有的东西（1–4），再离开侧栏去认入口和视图（5–8），最后把注意力收回今天（9）。

| # | 表面 | 高亮目标 | 标题 | 正文 |
| --- | --- | --- | --- | --- |
| 1 | 日历侧栏 | 整月格子 `.cal-grid` | 你的日子，都在这一格格里 | Dayline 已连上 Calendar/Daily，找到 214 天。写过的日子会亮起来，有照片的会铺满整格。 |
| 2 | 日历侧栏 | 25 号格子（有照片 + 多篇角标） | 照片是封面，圆点是心情 | 有照片的日子会铺满整格；左下角的小圆点是那天的心情，点一下就能记。同一天写了多篇，右下角会出现 +1。 |
| 3 | 心情选择器（弹窗） | MoodPickerModal 整体 | 心情，可以记到颜色里 | 五个颜色，从很低到很好；还能补一句备注。日记格子左下角那个点，就是它。 |
| 4 | 日历侧栏 | 天气卡 `.wx` | 天气是可选的 | 打开后这里显示当天的气温、体感和湿度；坐标、单位和时区都在设置里。默认是关闭的。 |
| 5 | 左侧 ribbon | Dayline 图标 | 翻旧日子，用日记时间线 | 点这个 Dayline 图标，打开日记时间线。下一步就带你进去。 |
| 6 | 右侧时间线 | 列表区域 | 同一批笔记，按天排成一条线 | 左边是星期和日期，中间是标题、摘要和更新时间，右边是当天的封面。 |
| 7 | 右侧时间线 | 搜索框 | 先搜，再筛 | 搜索会同时找标题、正文和心情备注；输入时结果会跟着变。 |
| 8 | 设置弹窗 | 设置 → Dayline 内容区 | 语言、目录、天气、隐私都在设置里 | 设置 → Dayline：目录已经自动连上 Calendar/Daily；天气默认关闭；EXIF 的 GPS 地名解析也默认关闭。 |
| 9 | 日历侧栏 | 今天的格子 | 从今天开始 | 今天有描边。点它写下今天的事；写过的日子会立刻亮起来。按钮：**写今天** |

第 9 步是终点：点「写今天」关闭引导、打开 `Calendar/Daily/<今天>.md`（不存在则按 Daily Notes 模板创建），把光标放进正文。走完后时间线保持打开，右侧保留今天的时间线。

**已决定不要的**：筛选面板单独一步（信息太细，砍掉）；把时间线/设置「只指入口不打开」（用户明确要求打开并展示内部功能）。

> **实现时省略了第 8 步（设置）**。Obsidian 1.14 起设置打开在独立的系统窗口（`app.setting.win !== window`），挂在主窗口上的遮罩既盖不住它、也指不了它；维护者决定整步省略，而不是打开一个引导无法解释的窗口。桌面流程因此是 8 步：月历 → 一天 → 心情 → 天气 → 时间线入口 → 时间线列表 → 搜索 → 今天。设置仍可从侧栏与命令面板进入，空库版本的第 1 步文案里还留着「设置 → Dayline」的指引。

## 3. 视觉与交互规格

### 3.1 遮罩与高亮

- 遮罩盖住**整个 Obsidian 窗口**（不是只盖侧栏），颜色 `rgba(0,0,0,.55)`，亮色主题；暗色主题建议 `.45`。
- 高亮区是遮罩上的一个「洞」：目标矩形四周留 7px，圆角 10px，1px 白色描边（`rgba(255,255,255,.9)`）。
- 洞的范围跟随当前步骤，移动时用 280–300ms `cubic-bezier(.2,.8,.2,1)` 过渡。
- 洞内内容可点击；洞外遮罩拦截点击。
- 目标元素要随步骤先「就位」：打开时间线要等视图挂载（约 380–420ms），打开设置弹窗要等 modal 插入 DOM（约 250–300ms），再测量矩形并落洞。

### 3.2 说明卡

- 尺寸 300px 宽，白底，圆角 10，`box-shadow: 0 18px 44px rgba(0,0,0,.32)`，内边距 13/15/12。
- 结构：进度点（5px 圆点，当前步深色）+「跳过」文字按钮；标题 13.5px/600；正文 13px/1.68；底部「上一步」（首步隐藏）+「下一步 / 写今天」（深色 `#232323` 圆角 6，文字 12px）。
- 位置规则（按目标类型选）：
  - **右侧**：目标在侧栏里、右侧有空间时，卡片放在视图右缘 + 18px（如月历、天气）。
  - **左侧**：目标在右半区（时间线、设置、心情弹窗）时，放目标左侧 16px。
  - **下方**：小目标（格子）且上下都有空间时，贴在目标下方 16px，带一个 10px 的白色箭头指向目标。
  - 卡片永远不要压住高亮区；窄窗口（右侧放不下）时回退到下方/左侧。
- 连接：左侧/右侧模式画一条 1px `rgba(255,255,255,.4)` 的引线，从目标边缘连到卡片边缘；下方模式用箭头。
- 卡片切换：内容换、位置移动，透明度 180ms 淡入淡出；卡片自身不参与遮罩压暗（z 在遮罩之上）。

### 3.3 交互

- 「下一步 / 上一步」、进度点、「跳过」；`Esc` 跳过；`→ / Enter` 下一步，`←` 上一步。
- 每步进入时焦点放到主按钮；卡片 `role="dialog"`、`aria-modal="true"`，标题用 `aria-labelledby`。
- 系统 `prefers-reduced-motion: reduce` 时取消洞和卡片的过渡。
- 跳过与完成都记一次「已看过」；完成后今天格子闪两下（`box-shadow` 脉冲两次，约 1.1s）。

### 3.4 结束状态

- 遮罩与卡片消失，光标进入今天的笔记正文。
- 顶部保留「已连接 Calendar/Daily · 找到 214 天」那一行（可换目录、可关闭）。
- 时间线留在右侧。
- 提供一个重看入口：命令「显示新手引导」+ 设置页里一行「重看新手引导」。

## 4. 技术落点（Obsidian 插件）

### 4.1 触发与持久化

- 在 `onLayoutReady` 之后、日历视图渲染完成后启动；只在**全新安装**出现：`data.json` 里没有 `onboardingSeenVersion` 时。
- 新增设置：`onboardingSeenVersion: number | string`，值用插件版本或 `1`；写完走 `saveSettings()`（`src/plugin.ts:1719`）。
- 升级不触发：已有 `data.json` 但没有该字段时，写入当前版本但**不弹**。
- 语言跟随 `getDisplayLanguage(this.settings)`；顺手把新安装默认值从 `'zh'` 改为 `'system'`（现在英文用户第一次进来是中文界面）。

### 4.2 覆盖层

- `document.body` 下插入一个 fixed 覆盖层，`z-index` 高于 Obsidian 弹窗（设置 modal 约 90 级，取 2000+）；不要插在视图容器里，否则遮不住时间线面板和设置弹窗。
- 用 `getBoundingClientRect()` 量目标；`resize` 和 `scroll` 时重算（节流）。
- 清理：所有事件监听、`setTimeout` 在关闭/卸载时移除；插件 `unload` 时强制关闭。
- 多窗口（popout）先只支持主窗口，其他窗口直接跳过引导。

### 4.3 每一步要做的事

| # | 动作 |
| --- | --- |
| 1 | `activateView()` 确保日历侧栏可见；目标 `.cal-sidebar .cal-grid`（注意视图容器类名以实际 DOM 为准） |
| 2 | 目标当天格子：`[data-date="YYYY-MM-DD"]` 或现有 `.cal-day` 的位置；优先选一个有照片且有 `+1` 的日期，没有就退回今天 |
| 3 | `openMoodPicker(todayPath, { allowDateSelection: true, ensureFile: false })`（`src/plugin.ts:950`）；目标 `.journal-mood-picker-modal`；下一步前关闭 |
| 4 | 目标天气卡；如果 `weatherEnabled=false` 且没有卡片，就把这一步改成「空槽 + 文案：天气默认关闭，想要就在设置里打开」，或直接跳过该步（二选一，推荐空槽） |
| 5 | 目标 ribbon 上的 Dayline 图标 `[aria-label="Dayline"]`；ribbon 在左侧，图标由 `addRibbonIcon` 生成 |
| 6 | 先 `activateTimeline()`（`src/plugin.ts:683` → `_openTimelineView` 会开到右 leaf）；等 `.journal-timeline-view` 挂载后量列表 `.journal-timeline-list` |
| 7 | 目标 `.journal-timeline-filter-row input[type="search"]` |
| 8 | `app.setting.open(); app.setting.openTabById('dayline-journal')`；等 `.vertical-tab-content` 里的品牌区出现，量内容区；下一步关闭：`app.setting.close()` |
| 9 | 目标今天格子；点「写今天」→ `createDailyNoteForToday()`（`src/plugin.ts:873`），它内部会创建并打开笔记 |

### 4.4 文案与国际化

- 所有字符串走 `t(settings, key)`，key 加进 `src/i18n.ts` 的 9 个语言块（zh / zh-tw / en / ja / ko / fr / de / es / ru）以及 `src/locale.ts` 的类型。
- 建议 key：`onboardingStep1Title` … `onboardingStep9Body`、`onboardingNext`、`onboardingBack`、`onboardingSkip`、`onboardingFinish`、`onboardingReplay`。
- 中文原文见第 2 节；其余语言先给出与现有风格一致的译文，再请母语者过一遍。
- 数字（214 天、+1）要按当前索引真实计算，不要写死；引导里没有数据时用空库版本（见 5.3）。

### 4.5 移动端

- 手机视图是整屏（`dayline-mobile-view`），没有侧栏和 ribbon：改为底部抽屉 + 全屏遮罩，步骤收敛为：月历 → 今天 → 心情 → 时间线（如手机端有）→ 写今天。
- 平板按桌面处理，但卡片要可以贴边收缩。

### 4.6 主题

- 亮色：遮罩 `rgba(0,0,0,.55)`；暗色：`rgba(0,0,0,.45)`（避免整屏死黑）。
- 卡片用 `var(--background-primary)`、`var(--text-normal)`、`var(--text-muted)`，不要写死白底黑字，否则暗色主题下会瞎。

## 5. 已知问题与必须验证的点

### 5.1 时间线面板压在遮罩上（原型里没修）

原型里遮罩挂在视图内时，右侧时间线面板会盖在遮罩上面，导致第 8、9 步它不被压暗。实现时遮罩必须挂到 `document.body`，并且用足够高的 z-index；在设置弹窗（Obsidian modal 层）之上也要能盖住。

### 5.2 打开视图/弹窗的时序

时间线、设置、心情选择器都是异步挂载的。测量目标前要等 DOM 出现（`waitForElement` 轮询/ MutationObserver，上限 2s），超时就跳过该步而不是卡死。

### 5.3 空库（没有旧日记）

第 1、2 步会对着空格子讲。需要一个两步版本：选日记目录 → 写下今天；文案另写，复用同一套遮罩和卡片。

### 5.4 其他

- 引导过程中用户可能按热键打开别的视图：检测到目标消失就暂停/跳过，不要抛错。
- 设置页关闭时（`app.setting.close()`）要等 modal 移除再继续。
- 重看引导时如果时间线已经开着，不要重复打开。
- 引导不应写入任何笔记内容，只打开文件。

## 6. 验收清单

手动（Sandbox vault）：

1. 全新安装（无 `data.json`）→ 引导出现，九步都能走，Esc/跳过可用。
2. 第 3 步心情选择器打开、可关；第 6 步时间线从右侧打开；第 8 步设置弹窗停在 Dayline 页。
3. 第 9 步「写今天」→ 打开/创建今天的笔记，光标在正文。
4. 走完后刷新 Obsidian，不再出现；命令「显示新手引导」可以重看。
5. 亮色/暗色各走一遍，卡片文字可读，遮罩不吞掉设置弹窗。
6. 窄窗口（侧栏被拖窄到 300px 左右）卡片不溢出。
7. 手机端走一遍，底部抽屉不遮挡目标。

自动：

- 给「步骤状态机」写单测：`next/back/skip/finish`、边界（第一步没有上一步、最后一步按钮文案）、跳过与完成的持久化。
- 给「目标测量」写单测：给定目标矩形和窗口尺寸，卡片的落点不越界、不覆盖高亮区。
- 跑 `npm run typecheck`、`npm test`、`npm run build`；按仓库 AGENTS.md 部署到 Sandbox 并检查 `dev:errors`。

## 7. 参考物

- 原型：`docs/ui-explorations/onboarding-first-run/explore/spotlight.html`（1420×860，模拟 Obsidian 窗口；`?step=N` 直达）
- 截图：`docs/ui-explorations/onboarding-first-run/shots/g1..g10`（含心情、时间线、设置、完成态）
- 设计说明：`docs/ui-explorations/onboarding-first-run/README.md`
- 关键源码：
  - 插件入口、视图注册、命令：`src/plugin.ts:291-372`
  - 日历视图：`src/plugin.ts:1947+`
  - 时间线视图：`src/journal-timeline-view.ts`
  - 心情选择器：`src/mood-picker-modal.ts`
  - 设置页：`src/settings-tab.ts`
  - 国际化：`src/i18n.ts`、`src/locale.ts`

## 8. 建议实现顺序

1. 覆盖层 + 洞 + 卡片（静态，先用假目标验证坐标与层级）。
2. 状态机 + 持久化 + 命令重看。
3. 接前四步（日历内）。
4. 接时间线（打开/关闭、列表/搜索）。
5. 接心情弹窗与设置弹窗（等待挂载 + 关闭）。
6. 手机端抽屉、空库版本。
7. 修 5.1 的层级问题，跑验收清单。
