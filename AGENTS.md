# Repository Guidelines

## Project Structure & Module Organization

Dayline is a TypeScript Obsidian plugin. Implement product behavior in `src/`; `src/main.ts` is the esbuild entry point, while feature modules use lowercase kebab-case names such as `journal-timeline-view.ts`. Keep focused unit tests in `tests/` with the same feature stem, for example `src/weather-cache.ts` and `tests/weather-cache.test.ts`. Static branding and weather icons live in `assets/` and `icons/`. `showcase/` is a synthetic, privacy-safe demonstration vault; `docs/` contains design notes and review records.

Root metadata includes `manifest.json`, `README*.md`, and `CHANGELOG.md`. `main.js` is the tracked bundle produced by the build; do not edit it by hand. `dayline.zip` is a release artifact, so update it only when preparing a release.

## Build, Test, and Development Commands

- `npm install` installs the locked Node dependencies.
- `npm run typecheck` runs strict TypeScript checking without emitting files.
- `npm test` runs the complete Vitest suite once.
- `npm run test:watch` starts Vitest in watch mode for focused development.
- `npm run build` bundles `src/main.ts` with esbuild into root-level `main.js` for Obsidian.

Run `npm run typecheck`, `npm test`, and `npm run build` before requesting review. For UI or Obsidian lifecycle changes, also manually exercise the affected flow in a test vault.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, semicolons, single quotes, and explicit exported types at module boundaries. Follow surrounding code rather than reformatting unrelated files; legacy plugin integration may use CommonJS and `// @ts-nocheck`. Prefer small feature modules over expanding `plugin.ts`. Name functions and variables in `camelCase`, types/classes in `PascalCase`, constants in `UPPER_SNAKE_CASE`, and files in lowercase kebab-case.

## Testing Guidelines

Tests use Vitest and JSDOM. Name files `tests/<feature>.test.ts`, write behavior-oriented `describe` and `it` titles, and cover regressions alongside the changed path. Mock Obsidian APIs and external services; do not require a real vault or network access in unit tests.

## Commits & Pull Requests

Use concise Conventional Commit subjects seen in history: `feat: add ...`, `fix: avoid ...`, `chore: refresh ...`, or `release: publish ...`. Keep each commit scoped. Pull requests should state user-visible behavior, tests run, linked issue when applicable, and before/after screenshots for calendar, timeline, settings, or mobile UI changes. Do not include personal vault notes, `data.json`, or `Calendar/journal-metadata.json` in source changes unless the task explicitly requires data migration.
