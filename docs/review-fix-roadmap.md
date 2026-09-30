# Dayline Review Fix Roadmap

> Canonical handoff document for Obsidian review findings. Any agent continuing this work must read this file first and update it after each implementation or validation batch.

Last updated: 2026-09-29
Repository: `/Users/haoo/Desktop/Obsidian-Calendar-Sidebar`
Branch: `master`
HEAD at roadmap creation: `70c02ac release: publish Dayline Journal v2.3.3`
HEAD at the 2026-09-29 review round: `e8257ec release: publish Dayline Journal v2.7.0` + uncommitted work

## 1. Operating Rules

- Do not fix every scanner warning. Change code only when there is evidence of functional impact, data loss/corruption risk, review or release blockage, or a reproducible regression.
- Preserve product contracts unless the user explicitly changes them. In particular, EXIF/GPS persistence in journal frontmatter is intentional Day One-style behavior — **but since 2026-09-29 it is an opt-in insert-time sync (`exifPersistMetadata`, default `false`), not a hover side effect; the hover-driven path was deleted as dead code**; `getMarkdownFiles()` is the journal index contract; user-triggered diagnostic copy may use the clipboard.
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
| EXIF/GPS frontmatter persistence | `FIX` on 2026-09-29, then `KEEP` under a new contract | The maintainer confirmed the product intent is Day One-style photo location on the journal note, but at **insert time**, not on hover. The hover-only path (`_onExifEnter` → `_persistExifFields`) was dead code that never ran; it was deleted and replaced by an opt-in `metadataCache.changed` sync (`exifPersistMetadata`, default `false`) that writes only for newly embedded or changed images. The `KEEP` contract now applies to that insert-time feature. |
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
- HEIC packaging: **deferred by the maintainer on 2026-09-14**. HEIC is the iPhone camera default, so mobile users do need decoding; do not quietly drop the feature. Revisit later as either an inlined decoder inside `main.js` or a documented manual file. Do not implement a runtime download, which the developer policies forbid.
- `manifest.json` author field: still `Sisyphus` while `LICENSE` now credits `Haoo`. Changing the published author requires a new release, so this is queued for the next version rather than changed under the reviewed 2.3.4 tag.
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

### 2026-09-14: author name corrected, HEIC deferred

- Maintainer confirmed the author name is `Haoo`, not `Sisyphus`. The `LICENSE` copyright line was corrected to `2026 Haoo`.
- `manifest.json` was also set to `"author": "Haoo"` in commit `20bf7ef`. Obsidian's directory reads the default-branch HEAD manifest, so the listing picks this up without a new release; the already-published 2.3.4 release asset still carries the previous value and will match again at the next release.
- HEIC packaging was explicitly deferred rather than decided: the maintainer noted HEIC is the iPhone camera default and therefore matters for mobile. Leaving the decoder out of `main.js` remains a known gap, not a settled design.

### 2026-09-14: review passed on 2.3.4; warning cleanup round

- Obsidian completed the review of 2.3.4: **0 errors**. The three source errors, the license warning, and both manifest warnings are gone. Remaining: 37 warnings (30 unchanged source warnings + 7 new CSS warnings, because `styles.css` is now linted as a real stylesheet) and 17 recommendations.
- Triaged the new CSS warnings: five were worth fixing, and the `!important` (27 refs / 17 lines) plus `all: initial` warnings were accepted as deliberate overrides of Obsidian's own styles and of inherited styles on the viewport probe.
- Fixed those five in `styles.css`: `column-gap` → `gap` in a grid rule (the multicolumn warning was a false positive on the property name), duplicate `background`/`border` and duplicate `max-height` moved into `@supports` blocks so the fallback and the enhancement are no longer duplicate declarations, and the two `:has()` selectors replaced with a `has-title-placeholder` class that `JournalTimelineView` toggles. Delegated to Grok Build in tmux session `codex-grok-css-round2`.
- Cleared the unused-code recommendations in a second delegated pass (dsh headless DeepSeek): 39 `catch (_)` bindings converted to optional catch bindings across 14 files, two named catch bindings converted where the error was unread, and the dead `SCORES`, `_isImageLink`, `_calendarWeatherIconUrl`, `IMAGE_EXTS`, `CALENDAR_BADGE_MARKUP`, and `CALENDAR_BADGE_ICONS` removed after `rg` proved no references. Unused locals (`images`, `overlay`, `num`, `detailEl`, `extraEl`, `statusEl`, `err`) lost only their bindings; the DOM-creating calls were preserved.
- Deliberately left: unused function parameters (`_onNoteImageEnter`, `_onNoteMediaEnter`, `_createDailyNote`), because dropping a positional parameter can silently shift meaning, and the `execCommand` clipboard fallback.
- Verification: typecheck, 50 files / 423 tests, build, `verify:release`, and `diff --check` pass; a script check confirms no rule in `styles.css` declares a property twice. Runtime check in the Obsidian Sandbox under plugin ID `dayline-journal`: 25 timeline entries rendered, the three title-less entries carried `has-title-placeholder` with computed `padding-bottom: 24px`, both `@supports` blocks were present and active (`CSS.supports` true for `color-mix` and `100dvh`), and `dev:errors` stayed empty. Sandbox state restored byte-for-byte afterwards.
- Not yet decided: whether to ship this cleanup as a new release. The 2.3.4 review already passed, so a new release would restart the review cycle.

### 2026-09-14: 2.3.5 published with the warning cleanup

- Maintainer approved shipping the cleanup. Version bumped to `2.3.5` in `manifest.json`, `package.json`, and both root entries of `package-lock.json`; bilingual 2.3.5 sections added to `CHANGELOG.md`.
- Gates before publishing: typecheck, 50 files / 423 tests, build, `verify:release`, `verify:release:zip`, and `diff --check` all passed. `main.js` did not change, because the version is not embedded in the bundle.
- Commit `9123ad2` and tag `2.3.5` pushed; GitHub release `Dayline Journal v2.3.5` published as a non-draft, non-prerelease release with six assets. Two transient GitHub API/SSL failures occurred during push and release creation and both succeeded on retry.
- Every remote asset digest was compared with the local file through the GitHub API and matched: `main.js` `f88244e2...`, `manifest.json` `9861278c...`, `styles.css` `85eafd47...`, `libheif-bundle.js` `793b36c9...`, `THIRD_PARTY_NOTICES.md` `37434cae...`, `dayline.zip` `2ca91957...`. Tag `2.3.5` matches the manifest version, so Obsidian's installer can resolve the release.
- Next step is external: wait for the community directory to re-run its checks against 2.3.5 and review the remaining warning list.

### 2026-09-15: review risk report triaged; mechanical warnings cleared

- The review page changed format: it now counts every occurrence instead of grouping rules, so the same findings read as 7,456 issues. Per-category counts match the local source exactly (`require()` 37, `!important` 27, `globalThis` 7, `confirm`+`prompt` 3), confirming this is a presentation change rather than a code regression. About 7,244 of the 7,456 are the `any`/unsafe family bound to the nine `@ts-nocheck` files, which is the P6 type-restoration project.
- Delegated the mechanical batch to dsh headless DeepSeek: 47 timer calls prefixed with `window.`, 7 `globalThis` probes replaced with a guarded `window` lookup, both hardcoded `'.obsidian'` fallbacks replaced by `vault.configDir` with an early skip when empty, and the floating-promise sites marked with `void` (the five async timer callbacks were wrapped so the timer callback stays synchronous).
- Three test files needed a `window` global because of the prefix change: the two `node:vm` `CalendarView` sandboxes and the Node-environment `media-service` test. No assertions or test counts changed.
- Verification: `rg` shows zero remaining bare timers, zero `globalThis`, and zero `'.obsidian'` literals; typecheck, 50 files / 423 tests, build, `verify:release`, and `diff --check` pass. Runtime check in the Obsidian Sandbox under plugin ID `dayline-journal`: `_libheifFactory` still resolves to a function (proving the `configDir` path still loads the HEIC decoder), capability probes report desktop/mobile correctly, the reminder timer id is numeric, the timeline rendered 25 entries with 3 placeholder bodies, and `dev:errors` stayed empty. Sandbox restored byte-for-byte afterwards.
- Still open: the `document.createElement` → `createEl` batch (33 occurrences, deliberately split out because it touches DOM construction and needs test stubs), the type-restoration work that owns the bulk of the remaining count, and the deferred HEIC packaging decision.

### 2026-09-15: 2.3.6 published with the mechanical cleanups

- Maintainer asked to ship the batch. Version bumped to `2.3.6` in `manifest.json`, `package.json`, and both root entries of `package-lock.json`; bilingual 2.3.6 sections added to `CHANGELOG.md`. `main.js` did not change, because the version is not embedded in the bundle.
- Gates before publishing: typecheck, 50 files / 423 tests, build, `verify:release`, `verify:release:zip`, and `diff --check` all passed.
- Commit `b612ca1` and tag `2.3.6` pushed; GitHub release `Dayline Journal v2.3.6` published as a non-draft, non-prerelease release with six assets. Tag `2.3.6` matches the manifest version.
- Every remote asset digest was compared with the local file and matched: `main.js` `517e8695...`, `manifest.json` `7c254c60...`, `styles.css` `85eafd47...`, `libheif-bundle.js` `793b36c9...`, `THIRD_PARTY_NOTICES.md` `37434cae...`, `dayline.zip` `0e7decf3...`.
- The 2.3.6 release also carries the maintainer's README and visual-identity refresh (`d4ad795`), which landed between 2.3.5 and this release.

### Decision recorded 2026-09-15: the remaining warnings are optional

- Maintainer asked whether the remaining `createEl` and type-safety batches are mandatory. Answer: no. Obsidian's submission documentation states that a plugin is installable unless the automated review reports **errors** (`your plugin won't be installable ... until any errors ... are resolved`); the current review reports zero.
- What is genuinely mandatory lives in the Developer policies (no obfuscation, no ads, no self-install or dependency self-update, a LICENSE, third-party licence compliance, disclosure of network use). All of those are satisfied.
- The page that reports 7,456 findings also states its own status: `While the guidelines on this page are recommendations, depending on their severity, we may still require you to address any violations.` So the two remaining batches are recommendation-level and can be revisited only if a reviewer asks or when those files are edited for another reason.
### 2026-09-29: full review round implemented (`docs/code-review-2026-09-29.md`)

**Scope and method**

- Source of truth: `docs/code-review-2026-09-29.md` (385 lines, every finding: `P-01..P-20`, `J-01..J-14`, `M-01..M-14`, `W-01..W-16`, `U-01..U-13`).
- Baseline before the work: `npm run typecheck` exit 0; `npm test` 62 files / 562 tests green.
- The maintainer asked the main agent to land the fixes directly. Work was split into disjoint write sets (with a single ordered `src/plugin.ts` track so the 3,400-line hotspot never had two concurrent writers) and delegated to native DSH subagents rather than the `dsh` + `$tmux-visible` route used by earlier batches. The main agent wrote every brief, reviewed the diffs, and ran the final gates. This deviation from §1 is recorded deliberately.
- Product decisions taken by the maintainer this round:
  1. **P-10**: delete the hover-driven dead code and implement EXIF/GPS persistence at **image-insert time** instead (day-one style, but not on hover), **default off**.
  2. **U-07**: default `'system'` only for fresh installs; never rewrite an existing stored language.
  3. **J-12**: merge February 29 memories into the February 28 view in common years.
  4. **M-02**: an explicit `set()` is last-writer-wins by `updatedAt`.

**Items landed** (each with a regression test proven red before the change and green after, by temporary revert with byte-verified restore)

- Mobile routing/lifecycle: P-01, P-02, P-03, P-19, P-04, P-05, P-06, P-07, P-18, U-10, J-13, M-02 (plugin-side listener).
- Calendar/rendering: P-08 (incl. U-02), P-09, P-11, P-12, P-14, P-15, P-16, P-17, P-20, M-11, J-06.
- EXIF: P-10, W-02, W-14 — `_onExifEnter` deleted; opt-in insert-time sync on `metadataCache.changed`; shared frontmatter/`exifCache` arrays are never aliased or mutated; the place name goes to a separate `exif_place` field.
- Mood store: M-01, M-02, M-03, M-05, M-10, M-14 plus the plugin-side M-05/M-01 wiring and read-only surfacing.
- Mood UI/export: M-04, M-06, M-07, M-12, M-13.
- Journal index/excerpt/search: J-01, J-02, J-04, J-05, J-07, J-09, J-10, M-09.
- Timeline: J-03, J-11, J-14.
- Media/EXIF parsing: W-01, W-06, W-10, W-11, W-12, W-13, W-15, plus the geocoder half of W-03.
- Weather: W-03, W-04, W-05 plus the plugin-side W-04 wiring.
- Settings/geolocation: W-07, W-08, W-09, U-06, U-08 (settings half), U-13, M-08.
- i18n/styles/modal/a11y: U-03, U-08 (on-this-day half), U-09, U-12, J-08, J-12, P-20 (i18n half).
- Mobile platform: U-11 (quick entry follows the live phone layout; capabilities are re-detected on `resize`/`css-change`).

**Contracts that changed (read this before touching the same modules)**

- `moodStore`: `readOnly`, `getWarnings()`, `reloadFromDisk()`, `clearStaleTombstone(path, ctime?)`, `pruneTombstones(maxAgeMs?)`; `set()` validates through `parseMoodScore` and rejects invalid scores; `MoodMetadataReadOnlyError`; `MOOD_TOMBSTONE_TTL_MS`. `MoodIntegrityReport` gained `readable`/`futureSchema`/`warnings`.
- `weather-cache` / `weather-service`: `pruneWeatherCache(cache, { maxEntries, minDate })`, `WEATHER_CACHE_MAX_ENTRIES`, `WEATHER_RECENT_DAYS`, `isSnapshotStale(..., options)`; dates within `WEATHER_RECENT_DAYS` now use the forecast host with `past_days` instead of `archive-api` (W-05). `withTimeout` is exported from `media-service`.
- `image-metadata`: `HeicCache` reuses one libheif decoder and frees each WASM context; `ReverseGeocoder` gained optional `userAgent`/`pluginVersion`/`app`/`negativeTtlMs`/`requestTimeoutMs`, rounds to 3 decimals and negatively caches failures; new `GEOCODER_*` exports and `resolveGeocoderUserAgent()`.
- `on-this-day`: module-level `closeOnThisDayModal()`, `OnThisDayProvider#closeModal()`, `OnThisDayModal#close()/#dispose()`.
- New file `src/css-url.ts` (`cssUrl()`), used by `plugin.ts` and `on-this-day.ts`; `src/geolocation.ts` gained `applyDeviceLocation()` and `geolocationFailureKey()`.
- New setting `exifPersistMetadata` (default `false`) with its own settings row.
- i18n: `STRINGS` is exported for the parity test; `t()` uses `replaceAll` and selects the CLDR plural category for numeric `count` values; every catalogue has **304** keys and every `LOCALE` table 129; the unused `locateFailed` key was removed.

**Verification (main thread, final state)**

- `npm run typecheck` → exit 0.
- `npm test` → **69 files / 773 tests, all passing** (baseline 62/562).
- `npm run build` → exit 0; `main.js` regenerated (3,063,737 bytes) and `node --check main.js` passes; `npm run verify:release` → OK.
- Independent key audit: all 9 `i18n.ts` tables identical at 304 keys, all 9 `LOCALE` tables identical at 129 keys, and zero keys referenced from `src/` are missing from both tables.
- `git diff --check` clean. `main.js`, `dayline.zip`, `data.json`, `manifest.json`, `package.json`, `package-lock.json`, `CHANGELOG.md` and `Calendar/journal-metadata.json` were outside every worker's write set; `dayline.zip` is intentionally left stale because it is a release-time artifact.

**Remaining limits (recorded, not claimed as verified)**

- No real vault, phone, or Obsidian runtime was exercised. Still runtime-verification items: P-01/P-02/P-03/J-13 (real leaf topology and metadataCache timing), P-04 (fast disable/enable race), M-07 (native per-segment date `change`), M-12 (canvas/rAF/popout), M-13 (the real 15 s timeout), J-06 (`getResourcePath` encoding of `(` / `)`), J-08 (focus trap and screen reader), U-06/W-07/W-08 (Electron/iOS/Android geolocation), U-10/U-12 (device rendering), U-11 (iPad narrow split), P-16 (live command-palette rename), P-20 (the midnight timer fires at local midnight, not at the configured `weatherTimezone` boundary), M-05 (`stat.ctime` semantics per OS), W-05 (real ERA5 lag; `past_days` + `start_date` was never sent to the live API).
- W-12's HEIC item parser is exercised only against synthetic ISOBMFF containers — the repo has no real HEIC file — so the `infe` v0/v1/v3 and `iloc` v2 branches are reasoned, not covered.
- `exif_place` is written to frontmatter but nothing renders it yet; the EXIF tooltip still reads `exifCache`/`mediaService`.
- W-13 changed the geocoder cache key from 5 to 3 decimals, so pre-existing `data.json` entries miss once and age out through the normal TTL.
- P-05's merge-by-key cache write means a locally pruned weather-cache key can reappear from `data.json`; exact local deletion would need per-session "keys at load" bookkeeping.
- P-06's `_lastReminderDate` is in-memory only, so a plugin reload after the reminder hour can remind once more that day.
- U-07 defaults a fresh install to `'system'`; users who never opened the settings keep that new default, which is the intended change.
- The 14 translations added this round are model-authored and have not been reviewed by native speakers.
- `styles.css:416` (`.cal-exif-tooltip`) still uses `z-index: 9999`; it is a tooltip that deliberately floats above Notices, so it stays `KEEP` while `.cal-otd-modal` (U-03) was lowered to `var(--layer-modal, 50)`.
- eslint was not re-run as a gate. The `@ts-nocheck` `any`/unsafe families remain the registered `DEFER` work for P6, and `plugin.ts` grew, so the raw warning count will have moved.
- P4 (large-vault performance) is still not closed: P-17 removed four specific duplicate-work paths (double index refresh per save, double redraw per refresh, double grid rebuild per date click, EXIF-cache wipe on `refresh()`), but the measured large-vault baseline gate in §8 remains unmet.

### 2026-09-29 (later): corrections made during Sandbox acceptance

The maintainer reviewed the batch in the Mac Sandbox and rejected three of its outcomes. They are recorded here because the earlier entries in this file describe superseded behavior, and because two of them are product decisions that are easy to undo by accident.

**1. M-11 is NOT implemented — attempted twice, reverted twice; do not re-attempt it without a design decision.**

- First attempt (the M-11 fix): encode the level with an inline one-axis height (`moodDot.style.height = 8 + (score + 2) * 2 + 'px'`). The maintainer rejected it in Sandbox acceptance: it overrode the designed marker geometry (the dot's `6px × 6px` circle, the bar's `3px`-tall pill) and rendered every level as a different-sized ellipse — "标记变异".
- Second attempt (the correction): drop the inline size and drive a **uniform** `transform: scale()` (`0.7 / 0.85 / 1 / 1.2 / 1.4`) from `data-mood-level`, so the dot stayed circular and the bar kept its proportions. Geometrically correct, but the maintainer rejected it too on usability grounds: at 6–10px a 0.7×–1.4× size difference is imperceptible, so "做了等于没做" — the cue helped nobody while adding another rule that could distort the pip.
- **Final state (maintainer decision): M-11 is dropped.** The marker is the original uniform coloured pip; the level is carried by colour and the hover `title` only. The mood button's `aria-label` is `recordMood: <localized date>` (the localized date is kept because U-02 requires it for labels; the *day cell* label also uses `formatJournalDate`). The `data-mood-level` attribute and every per-level marker rule were removed, and `styles.css` now carries a comment saying explicitly not to scale or re-shape this marker without a design decision.
- Verified live after deploy: 7 markers, **0** carrying `data-mood-level`, **0** with inline styles, and all 7 reporting an identical rendered `6px × 6px` box with `transform: none`.
- Guard test: `tests/plugin-calendar-content.test.ts` asserts the marker has no per-level attribute and no inline size/transform, that the level is still in the `title`, and that `styles.css` contains no `data-mood-level` selector at all. Proven to fail when the cue is reintroduced (1 failure), then pass after a byte-verified restore.
- Consequence recorded honestly: the review's M-11 finding stays open **by product decision**. If colour-blind legibility of the calendar mood ever matters, the answer is not a marker-shape tweak — the marker is simply too small — but a redundant non-visual channel (the label/tooltip, or a legend/filter in the timeline).

**2. M-06 reversed further — the cross-date draft queue itself was removed (maintainer decision).**

- The maintainer's product call, taken after using the build: the "keep a draft per date and ask before discarding" mechanism is unnecessary, and its dirty comparison was demonstrably wrong (changing the date without touching the mood produced no prompt, because the new date's draft was seeded with a baseline equal to itself). Chosen scope: **delete the cross-date draft queue, keep the two defensive fixes** (date validation + debounce, save timeout) and every `mood-store` data-safety fix.
- What changed in `src/mood-picker-modal.ts`: the `drafts` map is gone, along with `cacheDraft`, the per-draft `baseline`/`draftFingerprint`, `snapshotDraft`, and the `onClose` clear. The modal now holds exactly one live editor state; `restoreState()` loads a date's stored mood, `changeDate()` calls it on every switch, and `save()` builds its payload inline. `close()` is a single silent action and `Save` is the only commit point. The mood **recovery** modal keeps its own overwrite confirmation (a genuinely destructive action), so `discardChanges` stays in the catalogues.
- Accepted residual: changing the date discards that date's unsaved edits, and pressing Save on one date does not save edits made on another. If that ever matters, the answer is to have Save flush every edited date — not to reintroduce a dialog.
- Tests: `tests/mood-picker-modal.test.ts` now asserts (a) a date round trip shows the **stored** mood and drops the unsaved edit, and (b) close/Escape never call `window.confirm` and the modal exposes no draft queue. Both new tests were proven to fail against the pre-simplification modal (2 failures) and pass after, with the restore verified byte-identical by md5.
- **Live verification in the real Obsidian runtime** (not just JSDOM), driven entirely through the CLI with `plugin:reload` on the deployed bundle: opened the picker for 2026-09-30 with `window.confirm` stubbed to count and decline, changed only the date field to 2026-09-25 (dispatching real `input`/`change` events), confirmed the picker reloaded that date, then sent **one** Escape. Result: `pickerStillOpen: false`, `confirmCalls: 0`. `dev:errors` reported no errors, both protected state files stayed byte-identical, and no journal file was created (the command path uses `ensureFile: false`).

**3. Standing process rule added to `AGENTS.md`.**

- New section **Sandbox Deployment & Acceptance**: any change that affects plugin runtime behavior must be deployed to the Mac Sandbox, reloaded, error-checked and state-compared automatically — without the maintainer having to ask — with the CLI pitfalls recorded so the next agent does not rediscover them.
- Correction recorded after first use: an earlier draft of that section claimed `obsidian eval` sees a detached `document`. It does not — `eval` runs in the live window and `document` is the real DOM (verified by matching 32 `.cal-day` nodes against `dev:dom`). The real trap is *timing*: a UI opened inside the same eval must be queried from a later eval, and `plugin:reload` can leave orphaned plugin modals in the DOM. `AGENTS.md` now states the verified behavior and how to drive the real UI from the CLI.
- Note: `AGENTS.md` is locally excluded via `.git/info/exclude`, so this rule is not tracked by Git; it must be re-applied or un-excluded if the file is ever committed.

**Final gates after the corrections**: `npm run typecheck` exit 0; `npm test` 69 files / 773 tests green; `npm run build` OK with `node --check main.js` passing; `npm run verify:release` OK; deployed `main.js` `d0322be1…` and `styles.css` `92e2ceb4…` byte-identical in the Sandbox.

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
