# Nine-Language Display Support - Design Note

**Date**: 2026-09-29
**Status**: Implemented on `feat/on-this-day-polish`
**Plugin**: calendar-sidebar/main.js

## Overview

Dayline shipped an English/Chinese UI. The display language setting now offers
nine languages — Simplified Chinese (`zh`), Traditional Chinese (`zh-tw`),
English (`en`), Japanese (`ja`), Korean (`ko`), French (`fr`), German (`de`),
Spanish (`es`), and Russian (`ru`) — plus `system`, which resolves the host
locale at call time.

## String ownership

Two string tables coexist on purpose:

- `src/i18n.ts` `STRINGS` holds the current UI surface (views, notices, labels,
  accessible text) with one flat key per string and `{placeholder}` values. All
  nine languages carry the same key set; `en` is the fallback for missing keys.
- `src/locale.ts` `LOCALE` keeps the legacy key names (`s_*`, `exif_*`,
  `media_*`, `otd_*`) that weather, EXIF, media, and On This Day surfaces still
  look up through `localize()`. Same nine languages, same key set.

English text is never duplicated per language: the previous bilingual ternaries
(`getDisplayLanguage(...) === 'en' ? 'Show N more' : '再显示 N 条'`) are gone and
now resolve through `t()`.

## Resolution and migration

- `getDisplayLanguage(settings)` resolves `system` through `navigator.language`,
  then falls back to `en` (or `zh` when no locale can be read at all).
- `normalizeDisplayLanguageSetting(settings)` is the single migration entry
  point: a valid `displayLanguage` wins, otherwise a valid legacy
  `weatherLanguage` is promoted, otherwise the legacy `en`/`zh` default applies.
  Settings load uses this instead of the previous two-value allow-list, so a
  persisted `ja` or `zh-tw` survives a reload.
- `weatherLanguage` is retained as the resolved language so existing
  `localize(settings.weatherLanguage, ...)` call sites keep working.

## Locale-aware formatting

`LOCALE_TAGS` maps each language to a BCP-47 tag (`zh-CN`, `zh-TW`, `ja-JP`,
...). Calendar month labels, the calendar week header, timeline date parts, month
group headings, and the timeline entry timestamp all format through that tag, so
weekday and month names come from `Intl` instead of a hardcoded English/Chinese
branch.

## Reverse geocoding

`ReverseGeocoder` requests place names from Nominatim with an `Accept-Language`
tag:

- `normalizeGeocoderLanguage()` reduces any incoming value (settings code,
  `zh-Hant-TW`, `zh_TW`, `ja-JP`, unknown locale) to one of the nine canonical
  codes, falling back to `en`.
- `geocoderLanguageTag()` maps that code to the request tag, reusing
  `LOCALE_TAGS` so formatting and geocoding cannot drift apart.
- Cache keys (`"lat,lon|language"`) keep the canonical code, so persisted names
  from the previous `|en` / `|zh` keys stay valid and one coordinate can hold a
  name per language.

## Settings surface

`DISPLAY_LANGUAGE_OPTIONS` and `DISPLAY_LANGUAGE_LABEL_KEYS` in `src/i18n.ts` are
the single source of truth for the dropdown: `system` first, then the nine
languages with their names rendered in their own script. A new language takes
effect immediately — the tab re-renders and both the calendar and timeline views
refresh.

## Verification

- `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass.
- `npm test` passes: 57 test files, 522 tests. New coverage asserts the nine
  language list, locale tags, system-locale resolution, `zh-tw`/`ja`/`ko` date
  and weekday output, the localize-everything load-more label, dropdown label
  uniqueness per locale, and geocoder language normalization, tags, and
  per-language caching.
- Key parity between all nine language blocks is checked while editing
  (269 keys in `i18n.ts`, 129 in `locale.ts` per language).
