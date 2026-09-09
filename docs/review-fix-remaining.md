# Remaining review fixes (2026-09-07)

- R13: retained explicit EXIF persistence in journal frontmatter, adding media `mtime` and `size` version fields so replacing a file at the same link forces reparsing.
- R21: invalidated On This Day excerpt caches independently from calendar projection updates, so prose-only edits refresh excerpts without calendar redraw.
- R22: tracked the year used to build the On This Day date index and cleared entry caches when the year changes.
- R23: unified daily-note creation through `createDailyNoteForDate`, including parent-folder creation, Daily Notes template selection, Templater handling, and a deterministic fallback for `{{date}}`/`{{title}}`.

Validation: targeted On This Day and JournalIndex tests pass; TypeScript check passes. Real Obsidian desktop/mobile E2E and large-vault performance profiling remain outside this change.
