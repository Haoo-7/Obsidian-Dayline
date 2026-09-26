# Third-Party Notices

## Mediabunny 1.52.3

Dayline's distributed `main.js` bundles portions of [Mediabunny](https://github.com/Vanilagy/mediabunny), version 1.52.3, under the [Mozilla Public License, version 2.0](https://www.mozilla.org/MPL/2.0/).

The corresponding source code is available from the Dayline source repository and the [Mediabunny 1.52.3 npm package](https://www.npmjs.com/package/mediabunny/v/1.52.3). The upstream source repository is <https://github.com/Vanilagy/mediabunny>.

Mediabunny is not modified by Dayline. This notice applies only to the bundled Mediabunny portions; Dayline remains a larger work with its own source files in this repository.

## Lucide Icons

Calendar date-cell weather badges use a small subset of [Lucide](https://github.com/lucide-icons/lucide) (icons from `lucide-static` 1.48.0) under the [ISC License](https://github.com/lucide-icons/lucide/blob/main/LICENSE): sun, cloud-sun, cloud, cloud-fog, cloud-drizzle, cloud-rain, snowflake, and cloud-lightning.

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

The SVGs are placed at `icons/badge-*.svg`. Each is inlined into a date cell as `<svg>` markup so it inherits `currentColor`; only the root `stroke-width` is tuned (2.6 at 14px, 3 at 12px) for small-size legibility. Path geometry is otherwise unmodified. This notice applies only to those badge SVGs; weather-card illustrations remain Meteocons.
