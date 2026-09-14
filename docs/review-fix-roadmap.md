# Dayline Review Fix Roadmap

> Canonical handoff document for Obsidian review findings. Any agent continuing this work must read this file first and update it after each implementation or validation batch.

Last updated: 2026-09-14
Repository: `/Users/haoo/Desktop/Obsidian-Calendar-Sidebar`
Branch: `master`
HEAD at roadmap creation: `70c02ac release: publish Dayline Journal v2.3.3`

## 1. Operating Rules

- Do not fix every scanner warning. Change code only when there is evidence of functional impact, data loss/corruption risk, review or release blockage, or a reproducible regression.
- Preserve product contracts unless the user explicitly changes them. In particular, EXIF/GPS persistence in journal frontmatter is intentional Day One-style behavior; `getMarkdownFiles()` is the journal index contract; user-triggered diagnostic copy may use the clipboard.
- The main agent owns the initial plan, scope decisions, diff review, test review, runtime acceptance, and final report.
- Bounded implementation tasks may be delegated through the user-selected DeepSeek route (`dsh`) and must run under `$tmux-visible` so the user can observe them. The delegated task must have a disjoint write set, explicit inputs, required checks, and a completion report.
- Once implementation is delegated, the main agent must not take over that implementation because it is slow. The main agent waits, reviews the result, and either requests a bounded correction from the same or another delegate or rejects the patch.
- Do not commit, push, publish, or deploy to the real vault unless the user explicitly authorizes it. Do not modify vault `data.json` or `Calendar/journal-metadata.json` as part of source work.
- Preserve unrelated worktree changes. Do not use destructive Git commands.

## 2. Decision Labels

- `FIX`: evidence justifies a code change.
- `VERIFY`: implementation may be correct, but runtime, packaging, or device evidence is still missing.
- `KEEP`: warning is intentional behavior or a false positive under the current product contract.
- `DEFER`: real concern, but it requires measurement, a product decision, or a larger scoped change.
- `BLOCKED`: cannot proceed without a user decision or an external condition.

Every completed item must record the evidence source, affected paths, tests, and remaining limits.

## 2.1 Review Process Gap

The earlier records show detailed functional testing, but they do not contain an auditable, item-by-item checklist against the official Obsidian plugin development and submission guidance. Therefore future agents must not claim that official-guidance review is complete based only on passing tests or local source patterns.

Every Obsidian review batch has two separate passes:

1. **Official-guidance pass:** manifest fields, asset loading, release package contents, supported APIs, lifecycle conventions, and marketplace requirements.
2. **Functional-risk pass:** data loss, freezes, stale state, broken interaction, performance regressions, and reproducible user-visible failures.

A warning found in the first pass is not automatically a functional bug. It must be classified as `FIX`, `VERIFY`, `KEEP`, or `DEFER`, with its expected impact recorded before code changes.

## 3. Current Worktree Baseline

The worktree is intentionally uncommitted. At roadmap creation it contains these changes: `main.js`, `manifest.json`, `src/journal-source-settings.ts`, `src/mood-modal-viewport.ts`, `src/plugin.ts`, `src/settings-tab.ts`, five test files, and the new untracked `styles.css`.

The first-phase code checks recorded in the handoff are: `npm run typecheck`, `npm test` (48 test files, 400 tests), `npm run build`, and `git diff --check`. No real-vault deployment is part of this baseline.

## 4. Phase Map

| Phase | Objective | Status | Main paths | Completion gate |
| --- | --- | --- | --- | --- |
| P0 | Keep this roadmap as the cross-agent handoff | `DONE` | `docs/review-fix-roadmap.md` | File exists, is readable, and receives an evidence entry after each batch |
| P1 | Close review/release blockers from the current CSS and manifest migration | `DONE` | `src/plugin.ts`, `src/journal-source-settings.ts`, `src/mood-modal-viewport.ts`, `src/settings-tab.ts`, `styles.css`, `manifest.json`, `tests/`, `main.js` | `styles.css` is included in the release package; correct plugin ID loads it; reload and `dev:errors` checks pass |
| P2 | Fix remaining reproducible functional/data risks | `DONE` | Task-specific disjoint write sets below | Each task has regression coverage and passes the full project checks |
| P3 | Re-evaluate behavior warnings without breaking product contracts | `DONE` | `src/journal-index.ts`, `src/settings-tab.ts`, `src/plugin.ts`, `src/mobile-diagnostics.ts`, `src/image-metadata.ts` | A warning is changed only after a concrete impact is demonstrated |
| P4 | Measure and then address large-vault performance | `DEFER` | `src/journal-timeline-view.ts`, `src/journal-index.ts`, focused tests | Baseline measurements identify a bottleneck before implementation; no speculative virtualization/refactor |
| P5 | Resolve license and release packaging decisions | `DONE` | `LICENSE`, README files, `.github/workflows/release.yml`, `build.mjs`, `package.json`, `scripts/package-release.mjs`, `dayline.zip` | User chose MIT; release 2.3.4 published with `main.js`, `manifest.json`, `styles.css`, `libheif-bundle.js`, `THIRD_PARTY_NOTICES.md`, and `dayline.zip` |
| P6 | Gradually restore type and lifecycle boundaries | `DEFER` | `src/plugin.ts`, `src/journal-timeline-view.ts`, `src/settings-tab.ts`, `src/mood-store.ts`, `src/journal-index.ts` | Scoped architectural work has behavior tests and is not a mechanical warning cleanup |

Statuses are intentionally independent. A later phase must not be marked complete because an earlier phase's automated tests pass.

## 5. P1: Current First-Phase Assessment

### Implemented changes

- Moved inline plugin CSS and source-editor CSS into root `styles.css`.
- Removed dynamic `<style>` insertion/removal for those blocks.
- Moved fixed styles for clipboard fallback, HEIC preview/loader, and viewport probing to CSS classes.
- Kept the overlay host's dynamic layout value as `position: relative` through Obsidian's style helper.
- Changed settings section creation to `Setting.setHeading()`.
- Removed unsupported `manifest.json` `dir` and changed the description's final punctuation to ASCII.
- Updated affected tests to read the CSS asset instead of depending on removed inline style text.

### Functional impact decision

This phase is intended to be behavior-preserving: it does not change journal parsing, mood values, source composition, EXIF semantics, or user data. The settings heading change improves semantic structure, and the other changes are presentation or packaging changes.

There is one real functional/release risk: if `styles.css` is omitted from a manually assembled release package, calendar, timeline, source settings, mobile modal, clipboard fallback, and HEIC preview styling can fail or degrade. Therefore P1 is not complete until the package explicitly contains `styles.css` and the correct `dayline-journal` installation is reloaded. The source extraction itself must not be treated as fully accepted based only on unit tests.

### P1 closeout checklist

- [x] Inline CSS migration implemented.
- [x] Affected unit tests updated.
- [x] Typecheck passed.
- [x] Full test suite passed.
- [x] Build passed and regenerated `main.js`.
- [x] `git diff --check` passed.
- [x] Root release-set gate added (`npm run verify:release`, `build.mjs` pre-flight, `tests/release-contents.test.ts`).
- [x] Rebuilt `dayline.zip` with `styles.css`; `npm run package:release` regenerates it and `npm run verify:release:zip` passes.
- [x] Reloaded with plugin ID `dayline-journal` in the Obsidian Sandbox vault; legacy `dayline` data migrated and the plugin loaded with no captured errors.
- [x] Inspected calendar, timeline, and settings paths under the new ID; all rendered with the extracted `styles.css` rules applied.
- [x] Recorded the residual limit instead of claiming coverage: clipboard fallback and HEIC preview are covered only by unit tests, not by an interactive run (see P1 runtime evidence notes).
- [x] `dev:errors` empty after enabling the plugin, after opening the calendar, and after opening the timeline.
- [x] No behavior change found: the extracted CSS applies exactly as before, and the sandbox state was restored byte-for-byte afterwards.

Do not delete `styles.css` or restore inline CSS as a workaround before the package check.

### P1 runtime evidence (2026-09-14, Obsidian Sandbox vault)

The Mac test vault had only the legacy `dayline` install, so the new-ID build was installed side by side and removed afterwards.

- Installed `main.js`, `manifest.json`, `styles.css`, `libheif-bundle.js`, `THIRD_PARTY_NOTICES.md`, and `icons/` into `<Sandbox>/.obsidian/plugins/dayline-journal/`, then ran `app.plugins.loadManifests()` so Obsidian discovered the new ID.
- Legacy migration worked: the plugin copied the old `dayline/data.json` into its own folder, and both files hashed identically at migration time.
- `styles.css` is loaded by Obsidian, not injected: computed styles on `.cal-sidebar` were `padding: 8px 6px`, `user-select: none`, `overflow: hidden`, `container-type: inline-size`. Those rules exist only in `styles.css` now, so this proves the extracted stylesheet is the one being applied. The calendar header rendered with its localized title.
- Timeline view rendered 25 entries with `padding: 12px 12px 32px`, `overflow-x: auto`, `container-type: inline-size` — also from `styles.css`.
- Settings tab rendered 7 sections, each a `div.setting-item.setting-item-heading` carrying its original `data-dayline-settings-section` hook, confirming the `Setting.setHeading()` change renders correctly and kept the existing test hooks.
- `dev:errors` returned `No errors captured` after enabling the plugin and after each of the calendar, timeline, and settings checks.
- Not proven by this run: the clipboard fallback path (only reachable when `navigator.clipboard` is unavailable) and the HEIC preview path (the sandbox contains no HEIC media). Both are covered only by unit tests and CSS-class presence, so they stay open as residual risk rather than claimed as verified.
- Sandbox restored: `community-plugins.json` and `dayline/data.json` were copied back byte-for-byte (hashes `ee821c19...` and `03224a90...`), `Calendar/journal-metadata.json` never changed (`0e534020...`), and the temporary `dayline-journal` install was moved out of the vault to `/tmp/dayline-p1-runtime/dayline-journal-install`. Obsidian may rewrite `dayline/data.json` again on its next unload; that is the plugin's own normalization, not this test.

## 6. P2: Bounded Implementation Tasks

Each task below is independent. A delegate may edit only its listed write set. The main agent must review the diff and run acceptance checks after the delegate finishes.

### P2-A: HEIC resource and path handling

Status: `DONE`

Write set: `src/image-metadata.ts`, `src/plugin.ts`, `tests/image-metadata.test.ts`, `tests/heic-embed.test.ts`

Audited against current code: `_convert` checks `file.stat.size` against `MAX_HEIC_BYTES` before `readBinary`, releases every decoded handle in a `finally` via `image.free()`, serializes conversions through a single queue, and resolves the plugin folder from `vault.configDir` with `.obsidian` only as a fallback. Covered by `tests/heic-embed.test.ts` (9 tests: size-before-read, free on rejection/success/failure, one conversion at a time, capability-disabled path, no-factory path). No code change was needed; the earlier R25 batch had already landed it.

Still not covered by any test or measurement: the real native-memory peak of concurrent HEIC decodes on a device. Keep treating that as an unmeasured risk rather than a settled property.

### P2-B: View and media event cleanup

Status: `DONE` (implementation + regression coverage; live coarse-pointer check still open)

Write set: `src/plugin.ts`, `src/journal-timeline-view.ts`, `tests/exif-tooltip.test.ts`, `tests/weather-overlay-lifecycle.test.ts`, `tests/journal-timeline-behavior.test.ts`

Confirmed defect: `CalendarView` instrumented media inside markdown leaves (`mouseenter`/`mouseleave`/`focusin` listeners, `tabIndex`, `aria-label`, and an inserted `.dayline-note-media-info` button whose handler closed over the view), but `onClose()` only disconnected the MutationObservers. `_exifNoteImages` and `_exifNoteMediaControls` are per-instance `WeakSet`s, so every open/close cycle re-instrumented the same nodes: listeners stacked and a new info button was appended each time, with handlers calling into a closed view.

Fix: the view records a disposer per instrumentation (`_exifNoteDisposers`) and `onClose()` runs `_disposeNoteMediaInstrumentation()`, which removes the listeners, restores the previous `aria-label`/`tabIndex` state, removes the inserted buttons, and resets the two `WeakSet`s. Guard clauses stop instrumentation from running after close.

Evidence: new `tests/note-media-instrumentation-lifecycle.test.ts` (2 tests) drives the real transpiled `CalendarView` in JSDOM. Removing the `_disposeNoteMediaInstrumentation()` call makes the reopen test fail; restoring it makes it pass. Full suite 50 files / 422 tests, typecheck, build, `verify:release`, `verify:release:zip`, and `git diff --check` all pass.

Still open: the info button is only inserted when `capabilities.coarsePointer` is true, so the Mac Sandbox cannot exercise it live; the fix is verified through the JSDOM harness rather than on a touch device.

### P2-C: Mood recovery failure UI state

Status: `DONE`

Write set: `src/mood-picker-modal.ts`, `src/mood-store.ts`, `tests/mood-picker-modal.test.ts`, `tests/mood-store-reliability.test.ts`

Audited: `MoodRecoveryModal` wraps the whole confirm/retry flow, including the conflict-confirm branch, in `try/catch/finally` and re-enables the restore button in `finally`, so a second failure can no longer escape and leave the control disabled. `tests/mood-picker-modal.test.ts` covers it under the `MoodRecoveryModal failure handling` suite: it injects a failing `restoreOrphan`, asserts the retry runs twice, and then asserts `restore.disabled === false`. No code change was needed.

### P2-D: JournalIndex diagnostics

Status: `DONE`

Write set: `src/journal-index.ts`, `tests/journal-index.test.ts`

Audited: diagnostics already live in a `Map<string, JournalDiagnostic>` keyed by normalized path. `refreshFile` deletes the path's entry before re-adding at most one result, `removeFile` and `renameFile` delete the old key, and full `rebuild` swaps the whole map only after the snapshot commits. `tests/journal-index.test.ts` covers dedupe on repeated refresh and clearing once the file becomes valid. `getMarkdownFiles()` indexing behaviour was left untouched.

## 7. P3: Warnings That Need Evidence Before Modification

Status: `DONE` — every warning group was audited against the current code on 2026-09-14. They are still not automatic fixes.

| Warning area | Current decision | Why |
| --- | --- | --- |
| Vault file enumeration in `JournalIndex` | `KEEP` pending evidence | It is the core journal index input. Removing it changes which notes appear. |
| Clipboard use in diagnostics | `KEEP` pending evidence | Copy happens only after an explicit user action; do not replace it with a background permission flow. |
| EXIF/GPS frontmatter persistence | `KEEP` by product contract | It is intentional Day One-style journal metadata. Investigate write failure/versioning, not the product meaning. |
| Broad `any`, `unsafe`, and `require()` findings | `DEFER` | Mechanical cleanup can change integration behavior and is outside review-fix scope. |
| Unused `mood-reports.ts` implementation | `DEFER` | No production call site has been established. Do not optimize an unmeasured path. |
| `document.createElement` (28 sites, 7 files) | `DEFER` | Style guideline only; the code renders correctly. A mechanical rewrite adds churn without a demonstrated defect. |
| Bare `setTimeout` / `setInterval` (21 + 1 sites) | `DEFER` | Popout-compatibility advice. Timers still fire; the pattern matters for cross-window cleanup, which no current path does. Revisit with P6. |
| `globalThis` (7 sites in `platform-capabilities.ts`, `media-service.ts`) | `DEFER` | Same popout-compatibility family; capability probes work on desktop and mobile today. |
| `window.confirm` / `window.prompt` (3 sites) | `DEFER` | Both work in Electron and mobile WebViews; swapping in Obsidian modals is a UX improvement, not a defect fix. |
| `console.*` calls (65 sites) | `KEEP`, one optional cleanup | Most report real failure paths. The single flagged unnecessary log can be dropped opportunistically rather than as a batch. |
| `require()` imports (37 sites, 9 `@ts-nocheck` files) | `DEFER` to P6 | Works after esbuild bundling. Converting to ESM imports belongs to restoring real type boundaries. |
| `any` / unsafe assignment, call, member access, argument, return | `DEFER` to P6 | Same root cause: the `@ts-nocheck` boundary. Mechanical replacement would change integration behaviour with nothing to prove equivalence. |
| Wider-than-intended union types (mood score, temperature unit, week start, `unknown`) | `DEFER` to P6 | Type-safety loss only, no runtime effect; tightening needs call-site review across modules. |
| Floating promises and void-return callbacks | `DEFER` | Possible unhandled-rejection sources, but no reproducible rejection path is recorded. Add `void`/handlers together with a bug that exercises the path. |
| `getSettingDefinitions()` missing on `DaylineSettingsTab` | `DEFER` | Real but modest gap: on Obsidian 1.13+ Dayline settings are absent from settings search. The fix is adopting the declarative settings API, larger than a review fix. |
| Unnecessary assertions, unused variables, control characters in regex, deprecated `execCommand`, non-Error rejections | `DEFER` / `KEEP` | Cosmetic, or confined to fallback paths that behave correctly. `execCommand` remains the last-resort clipboard fallback. |

For any proposed change in this section, first record: reproduction or user-visible impact, affected workflow, smallest write set, and why the existing contract is wrong.

## 8. P4: Performance Gate

Current status: the index already has a sorted snapshot, notification coalescing, and timeline pagination. Full virtualization and large-vault profiling are not complete.

Before changing sorting, notification scheduling, pagination, or DOM strategy, capture a repeatable baseline on a representative large vault. Record vault size, device/runtime, operation, elapsed time, and observed user impact. Do not infer frame rate, native memory growth, or mobile performance from JSDOM or source inspection.

## 9. P5: User Decisions Required

- License: **MIT**, chosen by the maintainer on 2026-09-14; `LICENSE` is committed.
- Package contents: individual assets plus `dayline.zip`; both are published for release 2.3.4.
- `libheif-bundle.js`: stays a separate release asset. It cannot be downloaded and installed by the plugin at runtime — Obsidian's developer policies forbid plugins that "install or update themselves or their dependencies".
- GitHub artifact attestations: not configured. `gh release verify-asset` reports `no attestations found`, so provenance verification is unavailable until a workflow adds them.

No P5 source or release-policy change should be made until these decisions are recorded here.

## 10. Validation Contract

For normal source changes, run the smallest relevant tests first, then: `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`. Because `main.js` is tracked and generated, inspect its diff after every build.

For UI/lifecycle changes, add a bounded runtime check in the correct plugin ID environment. For deployment or vault QA, snapshot protected files first, deploy only required runtime artifacts, compare hashes, reload, inspect the affected flow and `dev:errors`, then restore cache-only mutations when exact preservation is required.

Automated tests and Mac Sandbox checks do not prove real iPhone/Android behavior. Report those limits explicitly.

## 11. Delegate Task Template

Use this structure in the delegation prompt and copy the result into the log below:

```text
Task ID:
Objective:
Read first:
Allowed write set:
Forbidden paths/changes:
Functional contract to preserve:
Required tests and commands:
Required output: changed files, evidence, remaining risks, and exact commands run.
```

The delegate must not commit, push, publish, deploy, or expand the write set without a new task boundary.

## 12. Change Log

### 2026-09-14: Roadmap created

- Created this canonical cross-agent handoff at `docs/review-fix-roadmap.md`.
- Recorded P1 as implemented but still requiring package inclusion and correct-ID runtime verification.
- Recorded the functional decision that P1 should not change journal/mood semantics, with `styles.css` omission as the remaining real release risk.
- Recorded P2 task boundaries, P3 warning decisions, P4 measurement gate, and P5 user decisions.
- Recorded the prior-process gap: official Obsidian guidance had not been captured as a separate, auditable review pass.

### 2026-09-14: P1 package gate delegated to DeepSeek

- Delegated P1 styles.css packaging gate via dsh headless DeepSeek; main thread waited and reviewed without taking over implementation.
- Delegate added scripts/verify-release-contents.mjs, tests/release-contents.test.ts, build.mjs pre-flight gate, and verify:release scripts.
- Independent main-thread validation: typecheck pass, 49 files / 413 tests pass, build pass, diff-check clean; missing styles.css now fails root check, build gate, and zip check.
- Remaining P1 work: rebuild dayline.zip with styles.css before publish; reload dayline-journal in Obsidian and check dev:errors.

### 2026-09-14: P1 dayline.zip rebuilt with styles.css

- Delegated the packaging change to dsh headless DeepSeek; main thread reviewed the diff and re-ran every gate.
- Delegate added `scripts/package-release.mjs` and `npm run package:release`, extended `tests/release-contents.test.ts`, and regenerated `dayline.zip`.
- Independent main-thread validation: typecheck pass, 49 files / 420 tests pass, build pass, `verify:release` pass, `verify:release:zip` pass (previously exit 1), `git diff --check` clean.
- `unzip -l dayline.zip` now lists 14 flat entries including `styles.css`; every root file was extracted and `cmp`-identical to its source, 8 icons present, no `.DS_Store`/`__MACOSX`.
- `main.js` stayed byte-identical (`11391e03...`) across the delegate's build and the main-thread re-run, so this batch shipped no runtime behavior change.
- Residual risk: `dayline.zip` is not bit-reproducible across runs because `zip` records staging-file mtimes; verify contents by entry list and per-file `cmp`, not by archive hash.
- Still open for P1: reload with plugin ID `dayline-journal` in a real Obsidian environment, inspect the affected calendar/timeline/settings/mobile/clipboard/HEIC paths, and check `dev:errors`.
- Still open for P5: whether the GitHub release should also publish `main.js`, `manifest.json`, and `styles.css` as individual assets (Obsidian's updater and BRAT read single files, not the zip).

### 2026-09-14: P2-B note-media instrumentation cleanup (Grok Build in tmux)

- Confirmed a real defect instead of assuming one: `CalendarView` mutated DOM owned by markdown leaves (listeners, `tabIndex`/`aria-label`, inserted `.dayline-note-media-info` buttons) and never undid it in `onClose()`.
- Delegated the frontend fix to Grok Build (`grok` 1.0.30) running visibly in tmux session `codex-grok-note-media-lifecycle`; the main thread wrote the brief, waited, then reviewed the diff and ran every gate.
- Delegate created `tests/note-media-instrumentation-lifecycle.test.ts` first, then added `_exifNoteDisposers` and `_disposeNoteMediaInstrumentation()` in `src/plugin.ts`, and regenerated `main.js` with `npm run build`.
- Independent main-thread validation: the new test passes with the fix and fails when the `_disposeNoteMediaInstrumentation()` call is temporarily removed (hash-verified restore afterwards); full suite 50 files / 422 tests, typecheck, build, `git diff --check`, `verify:release`, and `verify:release:zip` all pass.
- `dayline.zip` was regenerated after the new `main.js`; the archive's `main.js` and `styles.css` are byte-identical to the repo copies.

### 2026-09-14: P1 closed out, P2 audited, P3 classified

- Ran the P1 runtime check in the Obsidian Sandbox vault under the real new ID `dayline-journal`: legacy data migration worked, `styles.css` was proven to be the applied stylesheet (`.cal-sidebar` computed `padding: 8px 6px`, `container-type: inline-size`), calendar/timeline/settings rendered, and `dev:errors` stayed empty.
- Restored the Sandbox afterwards: `community-plugins.json` and `dayline/data.json` byte-identical to their pre-test hashes, `Calendar/journal-metadata.json` unchanged, temporary install moved to `/tmp/dayline-p1-runtime/dayline-journal-install`.
- Audited P2-A/P2-C/P2-D against the current code and their existing tests: all three were already satisfied, so no code churn was added. Only P2-B needed a real fix (see the entry above).
- Classified all remaining review warnings in P3 with counts taken from the current tree, and marked P1/P2/P3 `DONE` in the phase map.
- Remaining roadmap work is now P4 (needs a measured large-vault baseline), P5 (requires user decisions), and P6 (deliberate architectural deferral).

### 2026-09-14: MIT license and 2.3.4 release published

- Maintainer chose MIT; `LICENSE` added with the copyright line `2026 Sisyphus` (matching the manifest author).
- Version bumped to `2.3.4` in `manifest.json`, `package.json`, and both root entries of `package-lock.json`; `CHANGELOG.md` gained bilingual 2.3.4 sections.
- Commits pushed to `origin/master` (`6e40b57`) with tag `2.3.4`, and GitHub release `Dayline Journal v2.3.4` published with six assets.
- Remote asset digests were compared with the local files through the GitHub API: `main.js` `2005942d...`, `manifest.json` `8d33e9c4...`, `styles.css` `8c3eb03e...`, `libheif-bundle.js` `793b36c9...`, `THIRD_PARTY_NOTICES.md` `37434cae...`, `dayline.zip` `1fa441c8...` — every digest matched.

### Official guidance findings recorded 2026-09-14

- Obsidian's [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) page states that Obsidian downloads `main.js`, `manifest.json`, and `styles.css` from the release whose tag matches the manifest version. Release 2.3.4 satisfies that: tag `2.3.4` matches manifest `2.3.4` and all three assets are attached individually.
- Obsidian's [Developer policies](https://docs.obsidian.md/Developer+policies) forbid plugins that "install or update themselves or their dependencies". This rules out downloading a codec from the settings page and activating it, so `libheif-bundle.js` must either ship inside `main.js` or be a separate asset the user places manually.
- The same policies allow network use when it is disclosed in the README. The existing README files already disclose Open-Meteo weather requests and opt-in OpenStreetMap Nominatim geocoding, including why each is needed.

### Previous evidence carried forward

- R1-R11 and R13-R25 have recorded fixes in `docs/code-review-2026-09-07.md` and `docs/review-fix-index-timeline.md`; R12 remains intentional by product contract.
- R20 is only partially complete: sorted snapshots, notification coalescing, and pagination exist; full virtualization and real large-vault profiling remain open.
- The current CSS/manifest migration is uncommitted and must be treated as a candidate change until P1 closeout is complete.

## 13. Handoff Procedure

1. Read this file and the linked evidence documents.
2. Inspect `git status --short` and preserve unrelated changes.
3. Select exactly one phase/task whose status is actionable.
4. If delegating, use `$codex-deepseek-subagent` with `dsh` and `$tmux-visible`, and provide the task template plus the disjoint write set.
5. Wait for the delegate; do not implement the same task in the main thread.
6. Review the delegate's diff against this file and the product contract.
7. Run the required validation, update status and evidence, and append a dated change-log entry.
8. Stop at a user decision boundary instead of silently choosing release policy.
