# Weather Badge — Verification, Correction, and the Icon Rework

Date: 2026-09-26. Scope: the calendar date-cell weather badge. Two rounds are
recorded here — the first chip-and-recolor change (round 1), and the icon-set
rework that replaced it (round 2). Round 2 is the current state.

## 0. Why round 1 was rejected

Round 1 kept the Phosphor glyph geometry byte-identical and only changed its
colour, then mounted it on a frosted-glass plate. The user's read was that this
treats the symptom: the real problem is that the icons are poorly drawn for the
size they are used at. Agreed, and the evidence backs it:

- `icons/*.svg` diff was only `fill="#64748B"` → `fill="currentColor"`; no path
  data changed. Nothing about the artwork improved.
- Enlarged, the seven glyphs are not a set: `sun`, `snowflake` and `lightning`
  are single-concept shapes, while drizzle and rain are **two bare water drops
  with no cloud** — and `drop-simple-fill` vs `drop-fill` differ only by an
  interior highlight that cannot survive 14px.
- At true 14px the fills read as solid blobs; `fog` is an unreadable grey smudge.
- The plate was a symptom: the glyph could not stand on its own, so a 14×14
  solid chip had to be added behind it — which increased ink and visual noise in
  every date cell rather than reducing it.

## 1. Correction: the round-1 contrast table was wrong

The round-1 record claimed every condition cleared 3:1 in both themes, with a
table showing near-identical light/dark columns (snow `14.40` / `14.48`). Those
numbers are invalid. Two unit systems were mixed: background channels were
composited on a 0–1 scale while foregrounds were compared on 0–255, so both
columns effectively measured "contrast against black".

Recomputed correctly (light chip composes to `249,249,249`, dark to `30,30,30`):

| condition | light chip | dark chip |
| --- | --- | --- |
| snow `#67E8F9` | **1.37** | 11.50 |
| storm `#FBBF24` | **1.58** | 9.99 |
| drizzle `#60A5FA` | **2.40** | 6.56 |
| sun `#D97706` | 3.01 | 5.23 |
| rain `#3B82F6` | 3.48 | 4.53 |
| cloud (`--text-muted`) | 6.32 | 7.95 |

So round 1 did not fix the contrast problem: it moved it from dark mode to light
mode, where snow, storm and drizzle were effectively invisible. The conclusion in
the round-1 record is retracted.

## 2. Round 2: Lucide outline glyphs, no plate

Decision input was a rendered comparison of the old Phosphor fills against
[Lucide](https://github.com/lucide-icons/lucide) strokes at true 14px. Lucide
stroke **2.6** was the clear winner: stroke 2 read as wispy hairlines, 3.2 clogged
the small details, and the Phosphor fills read as blobs.

What changed:

- `icons/badge-{sun,cloud-sun,cloud,fog,drizzle,rain,snow,storm}.svg` — 8 Lucide
  glyphs, ISC. Replaces the 7 Phosphor badge icons, which were deleted.
- The family shares **one cloud silhouette**; each state adds its own element.
  Partly-cloudy now has its own glyph (`cloud-sun`) instead of reusing `cloud`.
- Drizzle vs rain are now structurally different (short dashes vs long streaks),
  not the same drop with a highlight.
- `src/plugin.ts` imports the SVGs as raw markup
  (`require('../icons/badge-x.svg?raw')`) and inlines them, so `currentColor`
  reaches the stroke. This is a **single source of truth**: the same files ship
  under `icons/`. The duplicated inline table is gone.
- `BADGE_ICON_CATEGORY` maps the 8 filenames to `weather-cat-*` classes.
- `styles.css`: the plate is removed entirely — no `background`, no
  `backdrop-filter`, no `border-radius`. Sizes: 14px at default, 12px at
  `≤360px` (with `stroke-width: 3` to keep fine detail from dissolving), and
  `display: none` at `≤240px`. Photo cells get a two-sided drop-shadow halo.
- `THIRD_PARTY_NOTICES.md`: Phosphor section replaced with Lucide.

Per-condition colours, each chosen to clear 3:1 on **both** a white and a
`#1e1e1e` cell, so no per-theme override is needed:

| condition | colour |
| --- | --- |
| sun | `#B7791F` |
| cloud-sun | `#7C8DA4` |
| cloud | `#64748B` |
| fog | `#7C8DA4` |
| drizzle | `#3B82F6` |
| rain | `#2563EB` |
| snow | `#0891B2` |
| storm | `#C2410C` |

## 3. Verified live in the Mac Sandbox

Deployed to `Obsidian Sandbox` → `dayline-journal`, reloaded, inspected via the
Obsidian CLI, and captured in both themes:

- Cells render `<span class="cal-weather-badge weather-cat-*">` containing an
  inline `<svg>` with `stroke-width="2.6"`; computed `background-color` is
  `rgba(0,0,0,0)` and `backdrop-filter` is `none` — the plate is genuinely gone.
- Breakpoints measured live: default → 14px badge / 14px glyph / stroke 2.6;
  `330px` → 12px / 12px / stroke 3; `230px` → `display: none`; restoring width
  returns 14px / 2.6.
- All 8 condition classes resolve to the intended computed RGB.
- A 16-badge month renders `sun` ×7, `cloud` ×3, `rain` ×3, `cloud-sun` ×2,
  `drizzle` ×1 — matching the cached snapshots, with no fallback to cloud.

Automated: `npm run typecheck` clean, **458/458** tests pass, `npm run build`
clean, `git diff --check` clean, `npm run verify:release:zip` OK.

`tests/calendar-layout.test.ts` no longer asserts the plate; it now asserts its
absence, checks the 12px `stroke-width: 3` rule, and computes the WCAG contrast
of all 8 condition colours against both `#ffffff` and `#1e1e1e`, failing below 3:1.

## 4. Still open (recorded, not fixed)

1. **No colour system for mood.** Five hex literals — `#7652c7 #4d6fb8 #55b6c9
   #f0b34f #ee6a54` — recur in `src/mood.ts`, `.cal-mood-button.mood-*`,
   `.journal-timeline-entry.mood-score-*`, the picker defaults, and the fluid
   spectrum gradient: 18 occurrences across two files, no shared token, no
   relationship to the user's accent. An OKLCH ramp as CSS custom properties
   would let the timeline, picker and calendar share one definition.
2. **EXIF tooltip ignores light mode.** `.cal-exif-tooltip` hardcodes
   `background: rgba(30, 30, 30, 0.88)` with `rgba(255,255,255,*)` text
   (≈ `styles.css:403–433`), so it stays dark glass on a light theme.
3. **Sub-perception text at small breakpoints.** `.cal-entry-count` still drops
   to `font-size: 8px` at `≤240px` (≈ line 1094).
4. **Type scale has no ratio.** Eleven sizes in use: 8, 10, 11, 12, 13, 14, 15,
   16, 18, 20, 24 px.
5. **`dayline.zip` is stale.** It was not rebuilt for this change (release
   artifacts are only refreshed when preparing a release), so it still contains
   the deleted `icons/sun-fill.svg` and friends. Rebuild it before publishing.

## 5. Operational note: Syncthing can silently revert a Sandbox deploy

The Sandbox is a Syncthing `sendreceive` folder (`config.xml`, folder id
`sandbox`). During round 1 the plugin directory was **overwritten back to the old
build within ~2 minutes** by a peer push, and the badge quietly reverted to the
old `<img>` with no error anywhere.

- Compare `shasum -a 256 <plugin dir>/main.js` against the repo artifact, and
  re-check **after a delay** — an at-once check passed and the revert still landed.
- Confirm a build-specific marker (e.g. `grep -c badge-cloud-sun main.js`) after
  reload before treating a Sandbox run as evidence.
- No revert occurred in round 2; the deploy was confirmed stable after 50s.

## 6. State files

- `Calendar/journal-metadata.json`: byte-identical to the pre-deployment backup
  (`3fefa763127fea0e5e4f5ea7f3ab4358bf8fd7bd94984b4c85c88d048f797b20`).
- `data.json`: intentionally differs from the pre-deployment baseline so the badge
  stays visible for review. `showCalendarWeatherBadge` `false` → `true` (set
  deliberately); `showCalendarView` and `showTimelineView` also flipped, which is
  normal persisted workspace state written when the sidebar was opened during QA.
  Baseline copy: `/tmp/dayline-deploy-20260926/data.json.baseline-restored`.
- `.obsidian/appearance.json`: switched to dark for verification and restored to
  `{"theme": "moonstone"}`; confirmed restored on disk.
- Deployed artifacts are byte-identical to the repo:
  `main.js` `04d50f5ab5d18d78bf9694121e747eed7ff34293152e28b3008406443de7a182`,
  `styles.css` `74c366ec44ff73851a6c4adca7660ce6758542443c84e39a7e31b5949db69e65`.
