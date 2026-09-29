# Third-Party Notices

## Mediabunny 1.52.3

Dayline's distributed `main.js` bundles portions of [Mediabunny](https://github.com/Vanilagy/mediabunny), version 1.52.3, under the [Mozilla Public License, version 2.0](https://www.mozilla.org/MPL/2.0/).

The corresponding source code is available from the Dayline source repository and the [Mediabunny 1.52.3 npm package](https://www.npmjs.com/package/mediabunny/v/1.52.3). The upstream source repository is <https://github.com/Vanilagy/mediabunny>.

Mediabunny is not modified by Dayline. This notice applies only to the bundled Mediabunny portions; Dayline remains a larger work with its own source files in this repository.

## libheif-js (HEIC/HEIF decoder)

Dayline's distributed `main.js` bundles the prebuilt `libheif-js` browser bundle (`wasm-bundle` from `libheif-js` 1.23.2), an Emscripten build of [libheif](https://github.com/strukturag/libheif) that has the WebAssembly binary embedded as base64. `libheif-js` is distributed under the [GNU Lesser General Public License, version 3.0](https://github.com/catdad-experiments/libheif-js/blob/master/LICENSE); libheif itself is licensed under the LGPL-3.0 as well.

The corresponding source is available from the [libheif-js repository](https://github.com/catdad-experiments/libheif-js) and the [libheif-js npm package](https://www.npmjs.com/package/libheif-js). Dayline ships the `wasm-bundle` build unmodified as `libheif-bundle.js` in this repository and bundles it into `main.js` at build time; rebuilding Dayline with a different `libheif-bundle.js` replaces the library. The decoder is loaded lazily on the first conversion and is disabled on mobile by `src/platform-capabilities.ts`.

## Lucide Icons

Calendar date-cell weather badges use a small subset of [Lucide](https://github.com/lucide-icons/lucide) (icons from `lucide-static` 1.48.0) under the [ISC License](https://github.com/lucide-icons/lucide/blob/main/LICENSE): sun, cloud-sun, cloud, cloud-fog, cloud-drizzle, cloud-rain, snowflake, and cloud-lightning.

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

The SVGs are placed at `icons/badge-*.svg`. Each is inlined into a date cell as `<svg>` markup so it inherits `currentColor`; only the root `stroke-width` is tuned (2.6 at 14px, 3 at 12px) for small-size legibility. Path geometry is otherwise unmodified. This notice applies only to those badge SVGs; weather-card illustrations remain Meteocons.
