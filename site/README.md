# Dayline website

A single static page that introduces Dayline Journal and links to installation. No build step: open `index.html` directly, or serve the folder with any static file server.

Published to GitHub Pages by `.github/workflows/pages.yml` whenever `site/` changes on `master`; it can also be run by hand from the Actions tab.

- `index.html`, `styles.css`, `main.js`: the page.
- `img/`: interface screenshots captured from a live Obsidian vault running Dayline, using the synthetic `showcase/Dayline Demo` journal (Northstar Cove, July 2026). Photos are from Unsplash, see `showcase/MEDIA_ATTRIBUTIONS.md`.
- `vendor/`: pinned GSAP 3.15.0 + ScrollTrigger and Lenis 1.3.27, see `THIRD_PARTY_NOTICES.md`.

When the plugin UI changes, recapture the screenshots from Obsidian rather than redrawing the interface. The mood-dot coordinates in `main.js` come from the same calendar capture; recapture both together.
