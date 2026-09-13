# Dayline 代码审查与 P1 修复记录

审查日期：2026-09-07。对象：当前工作区，包含审查前已有的未提交改动。以下位置按修复前源码记录；修复后行号可能移动。

这份代码的主要问题是持久化和异步状态的边界没有形成可靠契约。队列、缓存、token 和备份都已存在，但它们没有覆盖完整事务，某些保护措施反而制造了“看起来有保护”的错觉。最严重的后果是丢心情记录和卡住 Obsidian 主线程。

初始验证：`npm test` 全部通过，41 个测试文件、229 项测试；`npm run typecheck` 通过。下列多个失败场景通过执行当前源码的内存 adapter、可控 Promise 或 JSDOM 探针复现。没有用真实日记、真实同步服务或真实 Obsidian UI 做破坏性实验，也没有进行内存/CPU 的真实设备采样。不存在“已经找出所有可能缺陷”的保证。

## P1：本轮修复范围

### R1. 无天气数据时无限重试，可卡死主线程

- 位置：[plugin.ts:3951](src/plugin.ts:3951)、[plugin.ts:4001](src/plugin.ts:4001)。
- 打开没有可用天气的日记，浮层构建返回空；`finally` 发现没有浮层就立即调用 `_syncNoteOverlays()`，再次构建。WeatherService 的负缓存让后续 Promise 立即返回空，形成连续微任务循环。
- 已复现：下一轮事件循环之前调用 100 次 `getSnapshot`，由探针主动关掉天气才停止。生产路径没有次数限制或让出事件循环的退出条件。
- 坏味道：把“视图不存在”当成“需要立刻重试”，混淆正常空结果、过期请求和失败。
- 修复方向：一次同步最多完成一次请求；仅在请求过程中目标文件/配置真正变化时调度新同步，空结果等到外部事件或显式刷新；关闭视图时使在途请求失效。
- 状态：已修复。空结果停止当前同步；切换文件/日期后补载；关闭视图使迟到响应失效。新增 7 项生命周期测试，包含先在旧实现复现失败的回归测试，修复后全部通过。

### R2. 外部同步写入会被下一次本地保存静默覆盖

- 位置：[mood-store.ts:574](src/mood-store.ts:574)、[plugin.ts:743](src/plugin.ts:743)。
- store 一次加载后，只基于内存快照整文件覆写；plugin 的文件事件排除了 JSON，外部心情变更不会重新载入。
- 已复现：加载 `local.md`，模拟同步给磁盘 JSON 加入 `remote.md`，本地保存 `local.md` 后 `remote.md` 从主文件消失。
- 坏味道：把 vault 内、可能被同步的文件当成单进程私有数据库。进程内串行队列不能解决外部写入。
- 修复方向：写前验证磁盘版本，保留外部独立记录；同一记录发生冲突时拒绝静默覆盖。明确跨设备同时写入的保证边界；通用 adapter 没有跨设备 CAS，不能把简单 watcher 描述成分布式事务。
- 状态：已修复已复现的静默覆盖路径。写前读取并合并独立远端记录，同记录外部冲突拒绝覆盖；提交前再次校验文件。跨设备并发边界见文末。

### R3. 替换主文件中途退出后，有备份也会被当成空库

- 位置：[mood-store.ts:258](src/mood-store.ts:258)、[mood-store.ts:634](src/mood-store.ts:634)。
- 写入先把主文件 rename 到 `.bak`，再把 `.tmp` rename 为主文件。两步之间退出，下次 `load()` 发现主文件不存在便直接返回空数据，不检查备份。
- 已复现：仅有有效 `.bak` 的状态加载出空库；之后保存新记录形成只有新数据的主文件，再一次保存还会覆盖原备份。
- 坏味道：用两个 rename 命名为“原子写入”，恢复协议却没有覆盖中断状态。
- 修复方向：缺失和损坏主文件统一走恢复检查，验证 `.bak`/`.tmp`，保留最后一份有效数据；增加中断状态回归测试。
- 状态：已修复。缺失主文件会检查 `.bak` 和 `.tmp` 并恢复有效副本；迁移写失败不会把有效主文件当成损坏文件。

### R4. 写盘失败后内存仍提交，失败修改会悄悄落盘

- 位置：[mood-store.ts:576](src/mood-store.ts:576)。
- `this.data` 在持久化成功前替换。adapter 抛错后 API 返回失败，但内存没有回滚。
- 已复现：score 从 `1` 改成 `-2` 写入失败，磁盘仍为 `1`，`get()` 返回 `-2`；随后保存另一条记录会把先前失败的 `-2` 一起写入。
- 坏味道：事务提交点定义错误，界面和磁盘具有不同的事实。
- 修复方向：在局部变量构造 next，成功持久化之后发布内存状态与通知；失败不得进入后续快照。
- 状态：已修复。内存状态只在写入成功后发布，失败修改不会污染后续保存。

### R5. 队列外读取让删除丢失新记录，也能绕过恢复冲突检查

- 位置：[mood-store.ts:371](src/mood-store.ts:371)、[mood-store.ts:413](src/mood-store.ts:413)。
- 删除前抓取 record、恢复前检查目标都发生在排队之外。等操作实际执行，判断依据已经过时。
- 已复现：并发 `set(a, 2)` 与 `removeToOrphan(a)`，恢复区保存旧 `1`，新 `2` 丢失；两个 orphan 同时恢复到同一个空目标，两个 Promise 都成功，但第二条覆盖第一条且两个 orphan 都删除。
- 坏味道：只串行化写入，没有串行化“读取、检查、修改”整个事务。`rename` 的存在性判断也有同类缺陷。
- 修复方向：所有前置读取和冲突检查进入事务闭包；恢复、路径切换和 load 也需要明确的队列边界。
- 状态：已修复。删除、恢复、rename 的读取和冲突判断已移入串行事务；失败队列不会阻断后续恢复，路径切换不会把旧操作写到新文件。

## P2：逻辑与交互缺陷

### R6. 单文件刷新序号复用，旧内容覆盖新内容

位置：[journal-index.ts:291](src/journal-index.ts:291)。A(token 1) 未完成，B(token 2) 完成并删除序号，C 再次分配 token 1；A 随后通过检查写入旧结果并删除 C 的 token，C 被丢弃。探针最终得到最旧标题。应使用全局单调序号或唯一对象身份，不能从可删除的 map 项推导下一代。

状态：已修复，并有 ABA 顺序回归测试。

### R7. 全量索引刷新可以静默失败，来源设置与数据脱节

位置：[journal-index.ts:279](src/journal-index.ts:279)、[journal-index.ts:382](src/journal-index.ts:382)。重建时任意 `refreshFile`，包括来源外文件，都会递增 mutationToken 并取消重建；普通 `refresh()` 不重试也不报告取消。已复现 sources 为 `New/` 而 entries 仍为 `Old/`，`isReady=true`。应排除无关事件，确保显式刷新返回时提交目标配置，或者返回明确取消状态并重试。

状态：已修复；全量刷新会针对相关变更重试，并等待请求的 source snapshot 提交。

### R8. 修改 dailyFolder 只刷新界面，没有重建索引

位置：[settings-tab.ts:196](src/settings-tab.ts:196)、[settings-tab.ts:95](src/settings-tab.ts:95)。输入框和文件夹选择器都保存设置后调用 `_refreshViews`，后者只清理月缓存再从旧 JournalIndex 取数据。旧目录记录继续显示，新目录既有记录不出现，直到另一个入口触发全量重建或重启。应把来源变更集中成一个更新服务，完成配置提交和索引重建后再通知视图。

状态：已修复；来源设置提交现在等待索引重建完成后再通知视图。

### R9. Journal sources 的替换语义与“添加外部目录”契约不一致

位置：[journal-index.ts:358](src/journal-index.ts:358)。只要配置数组非空，默认 daily source 就完全消失。仅添加一个外部目录，daily 记录会退出索引；仅有一项 disabled 外部来源时结果为空数组。README 描述的是加入额外来源。应明确选定“完整替换”或“附加”一种契约，并让设置页、默认 dailyFolder、新建日记入口遵循同一个来源模型。

状态：已修复；daily source 始终存在，启用的外部 source 作为附加项并去重。

### R10. 天气旧请求被打上新配置标识，污染新地点/单位缓存

位置：[weather-service.ts:429](src/weather-service.ts:429)、[weather-service.ts:465](src/weather-service.ts:465)。请求参数在发出时捕获，快照的 `configKey` 却在响应后读取可变 settings。已复现纬度从 31 改到 40 后，31 的响应使用 40 的 configKey 持久化，并通过 `isSnapshotCompatible()`。应捕获完整不可变请求上下文；响应只能写回相同配置世代。

状态：已修复；请求上下文冻结 config key，旧响应不能写入新配置缓存。

### R11. 缓存迁移绕过时区/API 版本失效

位置：[weather-cache.ts:24](src/weather-cache.ts:24)。已有 configKey 不匹配时仍按经纬度和单位“迁移”为新 key，忽略时区和 API 版本。已复现 Shanghai 的 key 被改写成 New_York 并接受旧快照。应只对没有 configKey 的旧数据做兼容迁移；明确有不同 key 的记录应失效。

状态：已修复；仅无 configKey 的旧缓存允许迁移，显式不匹配的配置缓存失效。

### R12. 悬停查看 EXIF 会修改日记，图片 GPS 被提升成日记位置

位置：[plugin.ts:3139](src/plugin.ts:3139)、[plugin.ts:3151](src/plugin.ts:3151)。默认开启 EXIF 后，悬停日期缩略图会 fire-and-forget 调用 `processFrontMatter`，写入元数据及 latitude/longitude。日记内一张旧照片的拍摄地点会成为整篇日记的位置，并触发同步和索引更新；该行为并不受心情镜像开关控制。坏味道是读操作产生隐式业务写入。应把 EXIF 缓存放到缓存服务，导入日记位置必须是显式操作，持久化 Promise 必须处理错误。

复核结论：这不是本项目要禁止的行为。用户明确要求 Day One 式“图片 EXIF 成为日记条目信息”，因此 frontmatter 持久化和 GPS 提升属于产品契约。剩余工程要求是处理写入失败与版本一致性；本轮保留该设计，并将媒体版本校验纳入 R13 修复。

### R13. 持久化 EXIF 没有媒体版本键，替换图片仍显示旧数据

位置：[plugin.ts:3135](src/plugin.ts:3135)。frontmatter EXIF 仅按 normalizedLink 命中就直接返回；媒体 modify 虽然清理内存缓存，却没有删除这份 frontmatter 缓存。相同路径换图片后旧镜头、时间和 GPS 可以永久保留。应移除这条独立缓存路径，或统一使用真实文件路径、mtime、size 和解析器版本的键。

状态：已修复；持久化记录携带媒体 `mtime`/`size`，同路径替换或修改图片后旧记录失效并重新解析。

### R14. 一次失败的写入会阻断之后的备份恢复

位置：[mood-store.ts:562](src/mood-store.ts:562)、[mood-store.ts:654](src/mood-store.ts:654)。写队列保持 rejected Promise；显式恢复先 flush，于是磁盘已恢复正常也会被历史错误挡住。探针已复现。应把“队列已排空”和“某次操作失败”分开；恢复进入可以从失败后继续执行的串行事务。

本轮状态：随 R5 的队列修复一并解决，已有回归测试。

### R15. 恢复到已删除的笔记路径会让记录再次不可见

位置：[mood-store.ts:415](src/mood-store.ts:415)、[mood-picker-modal.ts:315](src/mood-picker-modal.ts:315)。UI 默认使用原路径，但 store 不检查 Markdown 文件是否存在，也不创建文件。记录从 orphan 消失，索引又因文件缺失不能显示它。应要求选择真实目标或先恢复/创建笔记，再提交记录迁移。

状态：已修复；恢复目标在事务内校验，失败重试路径由 `finally` 恢复 UI 状态。

### R16. 主 JSON 与 frontmatter 镜像部分成功时没有可靠状态

位置：[mood-store.ts:344](src/mood-store.ts:344)、[mood-store.ts:398](src/mood-store.ts:398)。JSON 提交后镜像失败会跳过 emit 和调用方的索引刷新。删除时旧 frontmatter mood 还可被 fallback 读回，看起来删除无效。应明确主存储成功、镜像失败的分别状态；镜像异步重试，删除用 tombstone 防止 fallback 复活。

状态：已修复已复现路径；主 JSON 提交与 frontmatter 镜像状态分离，镜像可重试，删除 tombstone 会阻止索引 fallback 复活。

### R17. 导入把 null、false、空串伪造成中性心情

位置：[mood-store.ts:436](src/mood-store.ts:436)、[settings-tab.ts:700](src/settings-tab.ts:700)。`Number(frontmatter.mood)` 把这些空值变成合法 0。内存探针确认 null/false 会被导入，生产设置页直接调用该 API。应复用严格的 score 解析，只接受定义过的数字/文本表示。

状态：已修复；导入复用严格 score 解析，`null`、`false`、空串不再变成 0。

### R18. 时间线标题编辑无法输入空格

位置：[journal-timeline-view.ts:443](src/journal-timeline-view.ts:443)。标题容器的 keydown 处理器收到内部 input 冒泡的空格，并执行 preventDefault。实际 renderEntry + JSDOM 探针确认 `defaultPrevented=true`。这是当前未提交修改带来的回归。应限定事件目标为标题按钮本身，编辑输入沿用标准键盘行为。

状态：已修复，并有真实 DOM 键盘回归测试。

### R19. 缩略图 observer 捕获了第一张图片的 loader

位置：[journal-timeline-view.ts:540](src/journal-timeline-view.ts:540)。所有图片共享第一次调用创建的 IntersectionObserver，但其 callback 内 `load()` 绑定的是第一项。第二张图进入视口会触发第一张加载并被 unobserve。实际方法探针确认这一点；滚动/resize 的补偿逻辑掩盖部分情况。应按 `observation.target` 从 Map 获取对应 loader。

状态：已修复；observer 按 target 查找对应 loader，并有行为测试。

### R20. 时间线全量 DOM 重建和重复排序没有规模上限

位置：[journal-timeline-view.ts:118](src/journal-timeline-view.ts:118)、[journal-timeline-view.ts:400](src/journal-timeline-view.ts:400)、[journal-index.ts:245](src/journal-index.ts:245)。每次索引通知重建整个页面；每次搜索输入又重建全部匹配条目。只有图片加载懒执行，卡片 DOM 并没有虚拟化。同一次 render 多处 getEntries 都复制并排序全库，修改日记还可能同时产生 vault 和 metadata 通知。复杂度可由代码直接确认，但未宣称具体设备帧率。应缓存有版本的排序快照、合并通知、只重算受影响派生数据，并对时间线分页或虚拟化。

状态：已部分修复；索引排序快照、通知合并和时间线分页已加入。完整虚拟化和真实大库设备剖析仍未完成。

### R21. 正文变化不会使“那年今日”的摘要失效

位置：[plugin.ts:2596](src/plugin.ts:2596)、[on-this-day.ts:91](src/on-this-day.ts:91)。日历不需重绘就提前 return，连 OTD 缓存也不失效。联合探针中正文从 old prose 改为 new prose，provider 仍返回旧摘要。应把 OTD 内容失效与日历视觉变化分离。

状态：已修复；正文/frontmatter 变化单独使 OTD 摘要失效，不触发无关日历重绘。

### R22. OTD 缓存跨年后漏掉刚成为历史的记录

位置：[on-this-day.ts:70](src/on-this-day.ts:70)。缓存只有 MM-DD，没有当前年份。长期打开跨年后，上一年记录仍未加入历史列表。探针已复现。应把年份纳入缓存身份，或跨年主动失效。

状态：已修复；date index 记录构建年份，跨年自动清理并重建缓存。

### R23. 新建日记入口分裂，模板行为不一致

位置：[plugin.ts:595](src/plugin.ts:595)、[plugin.ts:4136](src/plugin.ts:4136)。时间线新建、命令和保存心情通过 ensureJournalFile 创建空内容，日历点击另走模板逻辑；日历路径又直接 vault.create，未确保目录存在。仅使用 Daily Notes 模板、没有 Templater 时，fallback 原样复制模板，没有处理核心模板变量。应把“按日期获得/创建日记”变成唯一服务，统一目录创建、幂等性和模板处理。

状态：已修复；`createDailyNoteForDate` 统一目录、Daily Notes/Templater 模板和 `{{date}}`/`{{title}}` fallback，日历和今日入口均复用。

### R24. WebP 解析在图像数据处提前退出，丢弃其后的 EXIF

位置：[image-metadata.ts:226](src/image-metadata.ts:226)。代码假定 VP8 后不存在元数据，但 WebP EXIF 可以位于图像数据之后。内存探针把同一份 TIFF 放在 VP8 前得到 `{ make: 'CAM' }`，放在 VP8 后得到 null。应按 RIFF 块长度继续扫描，并仅对 EXIF 自身施加元数据块上限；PNG/WebP 目前还会因普通图像块超过 8 MiB 而提前终止元数据搜索。

状态：已修复；WebP 会继续扫描后续 RIFF 块，PNG FourCC 解析也已覆盖回归场景。

### R25. HEIC 解码句柄没有释放，资源上限也晚于文件读取

位置：[image-metadata.ts:503](src/image-metadata.ts:503)、[image-metadata.ts:497](src/image-metadata.ts:497)。每次 decode 返回的图片句柄都没有调用 free，正常返回、尺寸拒绝和异常路径均如此；仓库 libheif 包确实提供 `HeifImage.free()`，调用 native handle release。48 项 JS 缓存上限不能释放这些 native 句柄。尺寸/字节上限也在整文件读入之后检查，多张图并发转换仍可同时占用全尺寸 canvas。应在 finally 释放全部图片句柄、读取前先检查 stat.size，并给解码加并发/内存预算；native 内存增长量仍需真实 HEIC 和运行环境采样确认。

状态：已修复已复现资源释放和前置大小检查路径；并发 native 内存峰值仍未做真实设备 profile。

## 其他设计问题和低频缺陷

- **类型检查覆盖是假象的一部分。** [plugin.ts:1](src/plugin.ts:1)、[journal-timeline-view.ts:1](src/journal-timeline-view.ts:1) 等 8 个源码文件关闭检查；plugin.ts 的 4,354 行混合插件生命周期、视图、持久化协调、DOM 和大量 CSS。不能用 typecheck 通过证明关键运行路径类型安全。应逐个边界引入真实 Obsidian 类型，再拆生命周期、日记应用服务、浮层和样式；不要只机械搬文件。
- **部分测试只断言源代码包含字符串。** [tests/dayline-mobile.test.ts:299](tests/dayline-mobile.test.ts:299)、[tests/mobile-quick-entry.test.ts:183](tests/mobile-quick-entry.test.ts:183)。它们能锁住实现文字，却放过上述无限循环和事件冒泡错误。设置测试也主要验证常量和开关，而非更新数据源的行为。需要 adapter 故障注入、乱序 Promise 和真实 DOM 事件测试。
- **状态管理协议重复且相互穿透。** UI 直接调用 store、index、vault 并手动 refresh；多层 queue 管不同片段，mutable settings 被异步闭包长期引用。应由少量应用服务承接“保存心情”“变更来源”“打开日期”，每次只发布一个已提交状态。
- **手写 HTML 生命周期清理不完整。** [plugin.ts:3709](src/plugin.ts:3709) 给 Obsidian 持有的图片绑定事件，但 CalendarView 关闭只断 observer，没有移除这些监听和插入的媒体按钮。反复开关日历可留下旧 view 闭包。应由 view 管理 disposer，恢复修改过的属性；需在真实 Obsidian 验证 DOM 复用频率。
- **固定 `.obsidian` 路径破坏自定义配置目录。** [plugin.ts:173](src/plugin.ts:173)、[plugin.ts:453](src/plugin.ts:453)。HEIC 依赖加载和旧配置迁移应基于 vault configDir/plugin manifest dir。
- **恢复覆盖失败缺少 finally。** [mood-picker-modal.ts:325](src/mood-picker-modal.ts:325) 在 catch 内再次 await，第二次失败逃出处理器，按钮保持 disabled。用外层 try/finally 包住完整确认重试流程。
- **诊断不断追加。** [journal-index.ts:404](src/journal-index.ts:404) 对同一无日期文件重复追加错误，修复/删除后也不清理，直到全量重建。改成按路径维护结果。当前未发现生产界面消费，优先级 P3。
- **未接入的统计模块仍有缺陷。** [mood-reports.ts:126](src/mood-reports.ts:126) 用普通对象累计自由标签，constructor/__proto__ 计数异常；每个标签重复扫描所有记录，存在 O(N×L) 同步工作。应使用 Map 并单次累计。当前没有生产调用，因此不把压力探针结果冒充当前 UI 的实测瓶颈。

## 修复顺序

先完成 R1-R5 的可执行回归测试和修复，再处理来源/索引一致性 R6-R9，随后处理 R10-R19 的错误数据、隐式写入和交互问题。性能重构应围绕排序快照、增量通知和时间线可见范围展开。当前不适合继续堆功能；新的功能只会增加需要手工同步的状态组合。

## 修复后验证

本轮已完成 R1-R11、R13-R25 的已复现路径修复；R12 经产品语义复核不再作为缺陷，EXIF 持久化按用户要求保留。R20 仅完成快照/分页/通知合并，完整虚拟化和真实设备性能数据仍缺失。

- `npm test`：44 个文件、283 项测试全部通过。
- `npm run typecheck`：通过。原有 `@ts-nocheck` 的覆盖缺口仍然存在。
- `npm run build`：通过，已更新工作区发布产物 `main.js`。
- `git diff --check`：通过。保留审查前的未提交改动，没有提交或部署到真实 vault。

修复后的存储在本地事务内串行执行读取/冲突检查/修改；先读取磁盘，与内存基线和本次修改做三方合并，保留独立远端记录，同记录冲突则拒绝；写临时文件后还会复核主文件。只有持久化成功才发布新的内存状态。主文件缺失时尝试恢复有效 `.bak`/`.tmp`，失败不会退化成可覆盖原数据的空库。路径世代防止排队中的旧操作被转向新 metadataPath。JournalIndex 现在通过 `getForIndex()` 区分有效记录、无记录和删除 tombstone。

同步边界：通用 Obsidian adapter 没有跨设备比较交换/事务锁，最终复核与 rename 之间仍有外部写入的竞争窗口；两个设备离线同时修改同一记录时仍依赖同步器的冲突文件。此次修复消除了已经落到磁盘上的远端数据被陈旧内存无条件覆盖的路径，不宣称实现了分布式无冲突数据库。外部 JSON 变化的即时 UI 刷新也未在本轮实现。持久存储协议若要进一步保证多端并发，应采用每记录存储或可合并操作日志，并保留冲突副本。

没有在真实 Obsidian 桌面/移动端做端到端验证；浮层测试执行真实 CalendarView 方法，使用 JSDOM 和受控天气 Promise。HEIC 内存风险和大库时间线的具体耗时仍需真实设备剖析。
