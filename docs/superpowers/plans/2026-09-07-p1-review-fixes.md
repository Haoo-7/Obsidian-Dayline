# P1 Review Fixes Implementation Plan

> **For agentic workers:** Use the existing review findings and regression-first implementation workflow. Do not revert existing user changes. Steps below track this turn's authorized fixes.

**Goal:** 修复审查报告 R1-R5，防止天气空结果无限重试及心情数据在故障/并发下被覆盖。

**Architecture:** 保留既有模块和存储格式。MoodStore 内统一事务读取、验证、持久化和发布顺序；外部文件变更采用显式冲突检测或保留独立记录。浮层只因真实目标变化重新同步，空结果终止当前请求。

**Tech Stack:** TypeScript, Obsidian adapter, Vitest, JSDOM, esbuild.

**Spec:** [审查报告](../../code-review-2026-09-07.md)，R1-R5。

## Constraints

- 保留当前未提交改动，不提交、不部署到真实 vault。
- 先完成报告，再修复 P1；P2/P3 只在修复 P1 必须经过同一事务代码时一并处理并记录。
- 测试真实行为，使用内存文件 adapter 和可控 Promise；不以源码字符串包含作为新测试依据。
- 不宣称通用 vault adapter 具备跨设备原子比较交换。

## Task 1: Storage Transactions

Files: `src/mood-store.ts`, `tests/mood-store.test.ts` 或独立的 `tests/mood-store-reliability.test.ts`。

- [x] 添加失败测试：主文件缺失但备份有效；磁盘失败后内存不变；远端加入记录后本地保存；同时编辑同一记录时拒绝覆盖；set/delete 交错；两个 orphan 恢复到相同目标。
- [x] 运行测试确认失败原因对应 R2-R5；初始 11 项全部失败。
- [x] 在队列内读取当前磁盘/记录并检查冲突，next 持久化成功后才发布；缺失主文件恢复有效备份；把恢复检查放入队列。
- [x] 跑心情相关回归测试；新增 19 项全部通过，心情相关 4 个测试文件共 41 项通过。

## Task 2: Weather Overlay Lifecycle

Files: `src/plugin.ts`, `tests/weather-overlay-lifecycle.test.ts`。

- [x] 执行真实 CalendarView 的空结果路径，断言一次同步不会无限请求；增加请求途中关闭/换文件场景。
- [x] 运行测试，确认旧实现的重复请求故障（4 项失败）。
- [x] 去掉“未挂载就重试”的条件；仅在文件/请求世代变化时重同步；onClose 增加世代失效，拒绝关闭后的挂载。
- [x] 跑浮层及天气相关测试；最终补足 7 项生命周期测试，包含同文件日期变更、设置失效、关闭后重开。

## Task 3: Integration

- [x] 审查所有本轮 diff，确认无覆盖用户改动。
- [x] 运行 `npm test`（255 项通过）、`npm run typecheck`、`npm run build` 和 `git diff --check`。
- [x] 更新审查报告中的修复状态、测试数量和剩余风险。
- [x] 检查本轮没有遗留无用临时文件；保留报告、计划和回归测试作为交付物。
