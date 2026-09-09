# Index and timeline review fixes

## Fixed findings

- **R6**: File refresh generations now come from one monotonic counter. Completing a newer refresh can no longer let an older pending refresh reuse its generation and overwrite the newest entry.
- **R7**: Explicit full refreshes retry after relevant file mutations and only return after their requested source snapshot commits. Changes outside both the configured sources and the existing index do not cancel a rebuild. A committed full snapshot invalidates file reads that started during the rebuild, so an old-settings read cannot change the sources afterward.
- **R8**: Daily folder and JSON source edits use `commitJournalSourceSettings()`, which saves settings, awaits `journalIndex.refresh(settings)`, and only then notifies journal views. Calendar cache invalidation remains after the committed index update.
- **R9**: `resolveSources()` always supplies one daily source. The default comes from `dailyFolder`; an enabled explicit `daily` source remains compatible as its override. Enabled external sources are appended, and normalized duplicate paths are removed.
- **R18**: The title editor's keyboard activation handler only handles events targeted at the title control itself. Space events bubbling from the nested text input retain normal input behavior.
- **R19**: The shared thumbnail `IntersectionObserver` resolves each observation target through a loader map. Intersecting the second thumbnail now loads the second entry instead of the first closure.
- **R20**: `JournalIndex` caches one frozen, sorted snapshot until indexed data changes. The timeline renders 50 entries initially and adds 50 per explicit load action while all filters still operate on the complete index. Index notifications in the same task are collapsed into one scheduled render. Thumbnail loader and visibility maps discard started work.
- **P3 diagnostics**: Diagnostics are keyed by path, built transactionally for full refreshes, replaced during file refreshes, and removed when a file becomes valid, is deleted, or is renamed.

## Regression coverage

`tests/journal-index.test.ts` exercises ABA ordering, full refresh cancellation and retry, stale old-settings file reads, source composition, diagnostic cleanup, sorted snapshot invalidation, and mood deletion tombstones with controlled promises and actual index output.

`tests/journal-timeline-behavior.test.ts` renders the real `JournalTimelineView` into JSDOM and dispatches keyboard, observer, pagination, and notification events. `tests/settings-tab.test.ts` verifies the source update commit order through the exported settings boundary.

Fresh verification on 2026-09-07:

- `npm test`: 44 test files passed, 283 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Integration contracts

No new plugin method is required for source settings. `commitJournalSourceSettings(plugin)` uses the existing `plugin.saveSettings()`, `plugin.journalIndex.refresh(plugin.settings)`, and `plugin.refreshJournalViews()` methods. Its optional save callback lets `DaylineSettingsTab` preserve its existing save error notice behavior.

Mood lookup is now explicitly three-state at the index boundary:

- `MoodRecord`: use the primary mood record.
- `undefined`: no primary decision exists, so legacy frontmatter fallback is allowed.
- `null`: a deletion tombstone exists, so frontmatter fallback is suppressed and the indexed mood is absent.

The plugin constructor now wires `new JournalIndex(this.app, path => this.moodStore.getForIndex(path))`, preserving the three-state contract instead of collapsing tombstones into ordinary missing values.
