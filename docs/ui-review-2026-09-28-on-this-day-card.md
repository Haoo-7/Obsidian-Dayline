# On This Day — Title/Body Separation and Card Polish

Date: 2026-09-28. Scope: the 去年今日 memory card in the On This Day modal
(`src/on-this-day.ts`, `.cal-otd-*` in `styles.css`). Branch:
`feat/on-this-day-polish`, cut from `master` (`caf863f`).

## 0. The report

The card rendered a diary's title and its body as one run-on paragraph:

> Low Tide Last Year / 去年低潮线 Same calendar date, previous year. Used to
> preview the merged weather-car…

with no seam between the title and the body — the title read as the body's first
sentence. The user's note was that the 「标题区」 and 「正文区」 were not
distinguished, and that the feature as a whole felt 简陋.

The sandbox reproduces it with a single file:

`Dayline Demo/Daily/2025-07-18.md`

```yaml
title: Low Tide Last Year / 去年低潮线
```

```markdown
# Low Tide Last Year / 去年低潮线

Same calendar date, previous year. Used to preview the merged weather-card entry.

![[Dayline Demo/Media/dayline-01-tide.png]]
```

Evidence: `output/on-this-day-review/before.png`.

## 1. Root cause

Two causes, one per layer.

**Data.** `OnThisDayProvider.getEntries` built the excerpt from the raw note
body with a private helper that duplicated `src/excerpt.ts` and capped at 100
characters. `journal-index.ts` had already promoted the note's frontmatter
`title` (or its opening `# Heading`) to `entry.title` — but that same heading
line stayed inside the body text, and `getEntries` then threw the title field
away entirely. The card could not separate two things it had merged and
discarded.

**Rendering.** The card drew one `.cal-otd-wall-text` / `.cal-otd-wall-excerpt`
node, so there was no element boundary to style even if the data had been split.
The 100-character cap is why the visible text ended mid-word at
`weather-car…` while the note ends at `weather-card entry.`

## 2. The fix

### Data (`src/on-this-day.ts`)

| Before | After | Why |
| --- | --- | --- |
| private `extractExcerpt` (100 chars, Markdown-only) | shared `extractExcerpt` from `src/excerpt.ts` (160 chars, also drops fenced blocks, task lines, dataview and callouts) | One excerpt definition for the index, the timeline and the card; the local copy was a weaker fork |
| private `renderExcerptTemplate` | shared `renderExcerptTemplate` | Byte-identical duplicate |
| `entry.title` dropped | `splitTitleFromBody()` returns `{ title, body }` | The card needs both halves |
| heading kept in the body | body drops a leading heading, or one whose text equals the resolved title | `titleFromContent` already treats a leading heading as the note's title, so it is not body text |
| — | a date-only or placeholder title resolves to `null` | `2025-07-18` / `Daily note` carry no information in a memory card |

`splitTitleFromBody` is exported and unit-tested directly. It deliberately keeps
an `## Afternoon`-style heading that follows the opening paragraph, because that
one is a section, not the note's title.

### Card markup

`_renderGrid` now emits a meta row, the photo, then a title row and a body row
as siblings:

```html
<div class="cal-otd-wall-card" role="button" tabindex="0"
     title="打开笔记" aria-label="1年前 · 2025 · … · 打开笔记">
  <div class="cal-otd-wall-meta"><span class="cal-otd-wall-badge">1年前 · 2025</span>
    <span class="cal-otd-wall-count">+2</span></div>
  <div class="cal-otd-wall-photo"></div>
  <div class="cal-otd-wall-text">
    <div class="cal-otd-wall-title">Low Tide Last Year / 去年低潮线</div>
    <div class="cal-otd-wall-excerpt">Same calendar date, previous year. …</div>
  </div>
</div>
```

Cards became keyboard-reachable (`role="button"`, `tabindex="0"`, Enter/Space),
which they were not before: only a click listener existed. The header's three
controls are real `<button>` elements with Lucide icons instead of the `◀ ▶ ✕`
text glyphs, so they are tabbable and render like the rest of the plugin.

### Chrome and states (`styles.css`)

| Before | After | Why |
| --- | --- | --- |
| Header floated over the wall | `border-bottom: 1px solid var(--background-modifier-border)` | Separates the 标题区 from the 正文区 at the panel level too |
| `.cal-otd-wall-card:hover` ring | inside `@media (hover: hover) and (pointer: fine)` | On touch the ring fired on tap |
| no press feedback | `:active { transform: scale(0.99) }`, `:focus-visible` outline | Press and focus must be visible |
| `transition: box-shadow 0.15s` | `transition: box-shadow 150ms ease, transform 120ms ease` | No `all`, no untargeted properties |
| `width: 560px` appears instantly | `animation: cal-otd-panel-in 200ms cubic-bezier(0.23, 1, 0.32, 1)`, disabled under `prefers-reduced-motion` | Modals are occasional, so they may animate; the origin stays centred |
| square photo, 2 fixed columns | `aspect-ratio: 4 / 3`, `max-height: 320px`, `repeat(auto-fit, minmax(180px, 1fr))` | A single memory filled half the wall and left a hole; two or more still pair up |
| one centred sentence for empty/loading/error | icon + message (`.cal-otd-empty-state`) | The bare sentence read as a rendering failure |
| photo-only card rendered 18px of empty padding | no text row at all when there is neither title nor text | Nothing to show means nothing to render |

## 3. Verified live in the Mac Sandbox

Deployed to `Obsidian Sandbox` → `dayline-journal` (`main.js`
`39a8335a…`, `styles.css` `00679210…`), reloaded, and read back over the
Obsidian CLI. `data.json` was not part of the deploy.

DOM after opening On This Day for 2026-07-18 (the reported case):

- `.cal-otd-wall-title` = `Low Tide Last Year / 去年低潮线`;
  `.cal-otd-wall-excerpt` = `Same calendar date, previous year. Used to preview
  the merged weather-card entry.` — the title no longer appears in the body, and
  the 100-character cut is gone.
- `title.nextElementSibling === excerpt` (they are adjacent rows, not one node).
- card: `role="button"`, `tabindex="0"`, `aria-label="1年前 · 2025 · Low Tide
  Last Year / 去年低潮线 · 打开笔记"`.

Computed values measured on the rendered card:

| Measurement | Value |
| --- | --- |
| `.cal-otd-grid` columns, 1 memory | `526px 0px` (auto-fit collapsed the empty track) |
| card width, 1 memory | 526px, was 249px in a fixed 2-column grid |
| card width, 2 memories | `257px 257px` (clone-node probe) |
| photo | 526×320 (4/3, clamped at the cap) |
| title type | `font-weight: 600`, `rgb(34, 34, 34)` = `--text-normal` |
| body type | `font-weight: 400`, `rgb(92, 92, 92)` = `--text-muted` |
| header seam | `1px solid rgb(228, 228, 228)` = `--background-modifier-border` |

Screenshots: `output/on-this-day-review/before.png`,
`after-desktop.png` (1470×923 window) and `after-narrow.png` (460×880 window,
matching the original report's geometry and the `max-width: 480px`
single-column rule).

Reminder for the next Sandbox round: `dev:screenshot` returns a stale frame
while the Obsidian window is occluded — activate the app first, or the capture
shows a state that has already changed. `plugin:reload` also leaves any modal
that is already open in the DOM, so an old instance answers `querySelector`
until it is removed.

## 4. Automated evidence

- `tests/on-this-day.test.ts`: `splitTitleFromBody` cases (leading heading,
  differing index title, section heading kept, date-only and placeholder titles
  hidden), plus the updated provider shape.
- `tests/on-this-day-card.test.ts` (new): renders the modal in JSDOM and asserts
  the title and body are separate adjacent rows and that the title never leaks
  into any excerpt mode; the keyboard/aria contract; the `+N` photo count; the
  photo-only and empty-card cases; the empty state; and a `styles.css` contract
  (title vs body type, header seam, hover gated behind a fine pointer, reduced
  motion, single-memory wall).
- Mutation check: forcing `dropHeading = false` turns 5 of those tests red.

`npm run typecheck`, `npm test` (57 files, 505 tests), `npm run build` and
`git diff --check` all pass. `npm run lint` is red before and after this change
(repo-wide `no-unsafe-*` errors in `// @ts-nocheck` modules); this change adds 17
of that same family inside `src/on-this-day.ts`, whose plugin surface is typed
`any` throughout.

## 5. Still open (recorded, not fixed)

1. **The wall never shows more than one photo per year.** The first image is the
   card; extra photos are only counted (`+2`). A per-year gallery needs a
   viewer, not a card tweak.
2. **No way to tell from the wall which year is which beyond the badge.** With
   many years the descending order is the only signal; a year rail was out of
   scope for this pass.
3. **`.cal-otd-strip` (the merged weather-card entry) still writes its own
   single-line summary.** It reads `去年今日 / 1年前 · 7月18日` and never showed
   the run-on excerpt, so it was left alone.
4. **`docs/plans/2026-07-18-on-this-day-design.md` is stale.** It still describes
   the v1.2.0 carousel and a 100-character `excerptMode` table.
