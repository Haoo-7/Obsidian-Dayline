# Image preview cache (2026-10-28)

## The problem

Opening Obsidian with the Dayline timeline (or calendar) restored was slow once a
journal had many entries with photos. Two different costs were being paid on
every launch:

1. **Every ordinary photo was painted from the original file.** A timeline card
   is roughly 120 px wide and a calendar cell smaller, yet `MediaService` returned
   `app://…/IMG_0001.jpeg` — a 2–8 MB phone photo. The browser decodes the full
   resolution before scaling it down, dozens of times per page.
2. **Every HEIC was re-converted.** `HeicCache.getThumbnail()` only looked at its
   in-memory map. A fresh launch had an empty map, so the bundled libheif WASM
   decoder ran again for every visible HEIC — serialized through a single
   conversion queue, on the main thread — even though the converted JPEG was
   already sitting in the shared cache folder from the previous session.

The index itself is not the bottleneck. Rebuilding a synthetic journal of daily
notes (2 KB each, one embed, frontmatter mood/location) measured:

| entries | rebuild |
|---------|---------|
| 100     | 16 ms   |
| 400     | 21 ms   |
| 1000    | 42 ms   |

Persisting the index would have added a second copy of every note body to disk
for a saving well under 100 ms, so that was rejected.

## What ships

`src/preview-cache.ts` — a read-through preview cache on top of the existing
`HeicThumbStore` (`.dayline/thumbs` by default).

- `read(file)` asks the store for a fresh preview by path and size. It never
  decodes: a hit is one small file read turned into a blob URL.
- `generate(file)` decodes the original once (`createImageBitmap`, falling back
  to an `<img>`), draws it into a 640 px JPEG at quality 0.8, and persists it into
  the same store the HEIC conversions use. Two conversions run at a time; an
  image already inside 640 px, an unsupported format (gif/svg/tiff), an oversized
  file (> 64 MiB), or a failed decode is remembered and never retried in the
  session.
- Generation is desktop-only, matching the store's write rule: a phone never
  writes the shared folder, but it reads whatever a desktop produced.

`MediaService.createCover()` now asks for a stored preview **before** the HEIC
decoder and before the original resource URL, then converts an ordinary photo on
first sighting. `ThumbnailService.load()` (On This Day strip and note-image
preview) shares the same read-through. The store is the same folder, so the caps
(4000 entries / 200 MB) and the prune sweep cover previews too.

The folder setting is now labelled "Image cache folder" in all nine UI
languages, and a new **Cache image previews** toggle (default on) sits under it.
Turning it off restores the old behavior exactly: originals in the views, no
preview writes, HEIC conversion unchanged.

## Verification

- `npm run typecheck`, `npm test` (77 files / 965 tests, 21 new), `npm run build`
  all pass.
- Obsidian Sandbox: `main.js` deployed byte-identical
  (`7d9692dd…cf9da8a`), `manifest.json` and `styles.css` unchanged, `plugin:reload`
  followed by `dev:errors` reporting no errors.
- The store's folder creation is now idempotent, because two preview
  conversions can race to create `.dayline/thumbs` on a fresh vault; a queued
  regression test makes `mkdir` throw `EEXIST` and asserts both writes survive.
- Live, first render of the demo timeline (32 entries): previews were generated
  and persisted — `dayline-03-table.png` 685,910 → 39,301 bytes (900×600 →
  640×427) and `IMG_9690 1.jpeg` 2,667,066 → 47,678 bytes (→ 480×640).
- Live, second render after `mediaService.invalidate()`: `previewCache.generate`
  was called **0** times, and every loaded thumbnail resolved through a `blob:`
  URL from the store. With the toggle forced off and the caches invalidated, the
  same cards fell back to `app://` originals; re-enabling returned them to the
  cached previews without regenerating anything.
- `Calendar/journal-metadata.json` unchanged. `data.json` was rewritten by the
  plugin's own weather cache during the runs (a product effect), copied to the
  evidence folder and restored byte-identically.

## Known limits

- The first sighting of a photo still decodes it once. Only the images a view
  actually shows are converted; there is no full-vault preview sweep.
- On a phone, previews are read-only: a vault that has never been opened on a
  desktop has no previews to read.
- Real-device (iPhone/Android) acceptance is still open; the Sandbox is a
  tablet-like desktop host.
