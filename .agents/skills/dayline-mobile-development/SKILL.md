---
name: dayline-mobile-development
description: Develop, debug, deploy, and regression-test mobile behavior in the Dayline Obsidian plugin. Use for Dayline iOS or Android adaptation, real-device UI debugging, iPhone Mirroring, Obsidian Sandbox deployment, mobile view lifecycle, or mobile UI regressions; do not use for unrelated Obsidian plugins or desktop-only Dayline work.
---

# Dayline Mobile Development

Updated: 2026-09-05

## Environment Boundary

- The Mac test Vault is the locally configured Obsidian Sandbox vault. Resolve it from the active Obsidian setup instead of hardcoding a user path.
- Its plugin directory is `<Sandbox Vault>/.obsidian/plugins/dayline`.
- That path deploys only the Mac test Vault. For each phone, use the already configured Dayline test-Vault install/transfer path; if it is unknown, stop and ask instead of improvising against a personal Vault.
- Never use a personal production vault as the development, deployment, reload, or QA target for this workflow.
- A narrow desktop window or responsive emulator is only a layout smoke test. It is not evidence that iOS or Android works.
- Do not commit, push, publish, tag, or release unless the user separately authorizes that action.

## Established Collaboration Path

Use this division for the Dayline mobile workflow unless the user explicitly changes it:

The user-confirmed role split below supersedes any older wording in this section: Luna owns visual diagnosis and implementation; the primary agent supplies evidence and performs final acceptance.

1. **Primary agent: real-device visual audit.** Operate the Mac through Computer Use and inspect \`com.apple.ScreenContinuity\` (iPhone Mirroring). Reproduce the exact phone flow, record orientation/theme/navigation path, and capture screenshots of the whole phone plus tight crops of the affected region. A Mac Sandbox window, narrow desktop window, or responsive emulator is not evidence of iPhone layout correctness.
2. **Luna Worker: implementation owner.** Delegate the scoped visual bug with the screenshot paths, reproduction steps, expected behavior, and relevant source files. Luna performs source edits, focused tests, \`npm test\`, typecheck, build, and diff-check. Do not use Grok or Luna Max for this workflow unless the user explicitly requests them.
3. **Screenshot handoff.** Worker contexts may not expose Computer Use or \`node_repl\`; this is a tool-context limitation, not proof that the phone is unavailable. Save primary-agent screenshots under \`/tmp/dayline-mobile-audit-YYYYMMDD/...\` and give Luna absolute paths so it can inspect them with \`view_image\`. Luna must label conclusions based on static screenshots and must not claim live-device inspection it could not perform.
4. **Primary agent: acceptance.** After Luna finishes, rebuild/deploy the generated runtime, reload the Sandbox serially, allow Syncthing to propagate the plugin/Vault to the phone, then repeat the exact iPhone flow. Accept only what is visibly confirmed on the iPhone; keep unverified items as residual risks.

### Current Phone Test Topology

### User-Confirmed Role Split

- Luna Worker is the owner of both visual diagnosis and implementation for mobile tasks. Give Luna the real iPhone reproduction, Computer Use/iPhone Mirroring evidence when available, or shared screenshots when the worker context cannot access the mirror.
- The primary agent supplies or captures device evidence and performs final acceptance only. Do not move visual diagnosis back to the primary agent merely because a worker tool context lacks live Computer Use.
- Shared screenshots are an evidence bridge, not a substitute for final iPhone acceptance: Luna must state whether each conclusion came from live interaction or a static image, then the primary agent replays the accepted fix on the iPhone.

- Syncthing connects the Mac Obsidian test library and the iPhone test library. Use this as the phone transfer path after deploying the plugin to the Mac Sandbox.
- The Mac Sandbox remains useful for plugin reload, error inspection, and data-preservation checks, but its layout is tablet-like and must not substitute for iPhone evidence.
- The preferred quick-entry probe is a normal Markdown note: verify one \`calendar-range\` Dayline action, click it, and confirm the expected calendar/timeline mode opens.
- For mood QA, inspect both steps in dark and light themes. Verify that the date picker opens only after an intentional date-field tap, not when the modal first appears.
- For navigation QA, enter Dayline from Markdown, switch calendar/timeline if relevant, use the mobile return control, and verify the original Markdown leaf is restored without duplicate or deleted tabs.

### P1 Stop Conditions

- Do not begin a new visual-polish sweep while a P1 blocks content visibility, intentional date interaction, or reliable return navigation.
- If the iPhone screenshot is too small, tilted, stale, or otherwise unreadable, stop the visual diagnosis and recapture a front-facing, enlarged or cropped image. Do not ask Luna to infer a layout bug from an unreadable image.
- If a worker cannot access Computer Use, do not treat that as a blocker for all implementation: hand off screenshots instead. But do not claim real-device acceptance until the primary agent has repeated the flow on iPhone.

## Platform And View Rules

- Consult the current Obsidian mobile-development and API documentation before relying on undocumented container behavior.
- Use `Platform.isMobileApp` for code that must run only in the actual iOS/Android app. `Platform.isMobile` also covers Obsidian's mobile layout/emulation and is useful for layout routing. Use `Platform.isPhone` and `Platform.isTablet` for form-factor choices; do not infer them from width or user-agent strings alone.
- Treat `WorkspaceLeaf.parent` as a platform-dependent workspace container. Mobile may not have the desktop split/container topology, so do not cast it to a desktop parent or assume `children`, DOM ancestry, or sizing behavior. Prefer public workspace/leaf APIs and feature detection.
- Let Obsidian own an `ItemView`'s `containerEl`, `contentEl`, and lifecycle. Build UI inside `contentEl` during `onOpen`; release listeners, observers, timers, object URLs, and subscriptions during `onClose`. Prefer a plain renderer/component when embedding content rather than manually nesting an `ItemView`.
- Keep mobile branching narrow and capability-based. Every mobile change must retain the existing desktop behavior unless the task explicitly changes both.

## Current Risk To Verify

This is a risk hypothesis, not a confirmed diagnosis: `MobileDaylineView` currently calls `bindMobileEmbeddedViewHost`, which redefines nested `ItemView.containerEl` and `contentEl` onto custom hosts and manually drives their lifecycle. That may bypass assumptions in Obsidian's managed mobile leaf lifecycle and may contribute to zero-height or black-screen rendering on real devices. Verify the call path in `src/plugin.ts` and `src/dayline-mobile.ts`, then compare controlled iPhone and Android runs before changing the design or claiming causality.

## Implementation And Verification

1. Reproduce on the affected real device first. Record orientation, Dayline mode, navigation path, visible result, and relevant logs. Confirm the device loaded the newly built plugin rather than a stale artifact.
2. Read the involved leaf/view lifecycle and layout code before editing. Add focused tests for platform routing, cleanup, sizing, and mode transitions; keep desktop tests intact.
3. Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`. Inspect `git status --short` and the focused diff so generated or unrelated changes do not slip into deployment.
4. Before deployment, back up and hash these Sandbox state files when present:
   - `<Sandbox plugin dir>/data.json`
   - `<Sandbox Vault>/Calendar/journal-metadata.json`
5. Deploy only required runtime artifacts to the Sandbox plugin directory, normally `main.js`, `manifest.json`, and `styles.css` when it is part of the change. Do not copy the repository or replace the whole plugin directory. Never deploy source, tests, screenshots, caches, or user-data files.
6. Reload only the Sandbox Vault. Run Obsidian CLI operations serially; for example, `obsidian vault="Obsidian Sandbox" plugin:reload id=dayline`. Inspect Obsidian errors and console output after reproducing.
7. Compare the two state files byte-for-byte with their backups. If either changed, preserve evidence, restore the exact backup before finishing, and report the write; absence must also remain absence.
8. When real-device QA changes \`data.json\` or \`Calendar/journal-metadata.json\`, copy the changed files to an evidence directory, restore the pre-QA backups, and re-hash both files before pausing or reporting completion. Do not delete test notes created during QA without explicit approval.

## Real-Device Acceptance

- **iPhone/iPad:** use Computer Use with iPhone Mirroring (`com.apple.ScreenContinuity`) for visual interaction and screenshots. Check initial render, full-height layout, calendar/timeline switching, scroll/touch, opening a note and returning, rotation, safe areas, and relaunch/reload. A desktop screenshot cannot replace this pass.
- **Android:** confirm the target with `adb devices -l`, clear or mark the log boundary, reproduce on-device, and capture `adb logcat -v time`. Resolve the installed Obsidian package/process from the device rather than assuming it. Check the same flows as iOS and retain the relevant exception/WebView/layout lines.
- **Desktop:** repeat the primary Dayline calendar and timeline flows in the Mac Sandbox at normal desktop width. Confirm no visual, navigation, settings, or command regression.
- Accept the work only after the automated checks, Sandbox data comparison, desktop pass, iPhone/iPad real-device pass, and Android real-device pass all succeed. If a device is unavailable, state that acceptance is incomplete rather than substituting an emulator or narrow viewport.
- For this project's current iPhone-only batches, Android and tablet work remain out of scope unless explicitly requested. Report phone acceptance and residual tablet/Android risk separately.

## Official References

- [Mobile development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)
- [Platform API](https://docs.obsidian.md/Reference/TypeScript+API/Platform)
- [WorkspaceLeaf API](https://docs.obsidian.md/Reference/TypeScript+API/WorkspaceLeaf)
- [ItemView API](https://docs.obsidian.md/Reference/TypeScript+API/ItemView)
- [View API](https://docs.obsidian.md/Reference/TypeScript+API/View)
