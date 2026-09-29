import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { installObsidianDomShim } from './setup/obsidian-dom';

import {
  BRAND_CONTAINER_CLASS,
  BRAND_DEFAULT_LABEL,
  BRAND_FALLBACK_CLASS,
  BRAND_MARK_CLASS,
  BRAND_MARK_SIZE,
  BRAND_WORDMARK_CLASS,
  BRAND_WORDMARK_SIZE,
  createBrandSvg,
  renderSettingsBrand,
} from '../src/settings-brand';

// `?raw` resolves to the file source under both Vitest and esbuild's `text`
// loader (see src/assets.d.ts), so the tests exercise the assets that actually
// ship rather than a copy that could drift from them.
import daylineLogoSvg from '../assets/dayline-logo.svg?raw';
import compactWordmarkSvg from '../assets/dayline-wordmark-compact.svg?raw';
import readmeMarkSvg from '../assets/readme/dayline-mark.svg?raw';

function mount() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  // The module builds its elements with Obsidian's `createDiv`/`createSpan`,
  // which JSDOM does not provide.
  installObsidianDomShim(dom.window as unknown as Parameters<typeof installObsidianDomShim>[0]);
  const doc = dom.window.document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  return { dom, doc, container };
}

describe('Dayline settings brand lockup', () => {
  it('renders the logo mark ahead of the wordmark, each at its own size', () => {
    const { doc, container } = mount();

    const brand = renderSettingsBrand(container, {
      markSvg: daylineLogoSvg,
      wordmarkSvg: compactWordmarkSvg,
      doc,
    });

    expect(brand.className).toBe(BRAND_CONTAINER_CLASS);
    expect(brand.parentElement).toBe(container);

    const mark = brand.querySelector(`.${BRAND_MARK_CLASS}`);
    const wordmark = brand.querySelector(`.${BRAND_WORDMARK_CLASS}`);
    expect(mark).not.toBeNull();
    expect(wordmark).not.toBeNull();

    // Order is the whole point of the lockup: mark first, then the wordmark.
    expect(brand.firstElementChild).toBe(mark);
    expect(brand.lastElementChild).toBe(wordmark);

    // Explicit per-element sizes; a single shared height letterboxes the
    // wordmark because the two sources have different aspect ratios.
    expect(mark?.getAttribute('width')).toBe(String(BRAND_MARK_SIZE.width));
    expect(mark?.getAttribute('height')).toBe(String(BRAND_MARK_SIZE.height));
    expect(wordmark?.getAttribute('width')).toBe(String(BRAND_WORDMARK_SIZE.width));
    expect(wordmark?.getAttribute('height')).toBe(String(BRAND_WORDMARK_SIZE.height));
  });

  it('leaves the wordmark as the only accessible name', () => {
    const { doc, container } = mount();

    renderSettingsBrand(container, { markSvg: daylineLogoSvg, wordmarkSvg: compactWordmarkSvg, doc });

    const mark = container.querySelector(`.${BRAND_MARK_CLASS}`);
    const wordmark = container.querySelector(`.${BRAND_WORDMARK_CLASS}`);

    // The mark is decorative: naming it too would announce "Dayline" twice.
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.hasAttribute('aria-label')).toBe(false);
    expect(wordmark?.getAttribute('role')).toBe('img');
    expect(wordmark?.getAttribute('aria-label')).toBe(BRAND_DEFAULT_LABEL);
  });

  it('honours a custom accessible name', () => {
    const { doc, container } = mount();

    renderSettingsBrand(container, {
      markSvg: daylineLogoSvg,
      wordmarkSvg: compactWordmarkSvg,
      label: 'Dayline Journal',
      doc,
    });

    expect(container.querySelector(`.${BRAND_WORDMARK_CLASS}`)?.getAttribute('aria-label')).toBe('Dayline Journal');
  });

  it('keeps the injected SVGs inert', () => {
    const { doc } = mount();

    const hostile = [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
      '<script>alert(1)</script>',
      '<foreignObject><body onload="alert(2)"/></foreignObject>',
      '<a href="javascript:alert(3)"><rect width="1" height="1"/></a>',
      '</svg>',
    ].join('');

    const svg = createBrandSvg(hostile, { className: BRAND_MARK_CLASS, width: 10, height: 10 }, doc);

    expect(svg).not.toBeNull();
    expect(svg?.querySelector('script')).toBeNull();
    expect(svg?.querySelector('foreignObject')).toBeNull();
    expect(svg?.querySelector('[href^="javascript:"]')).toBeNull();
    for (const node of Array.from(svg?.querySelectorAll('*') ?? [])) {
      for (const attribute of Array.from(node.attributes)) {
        expect(attribute.name.toLowerCase().startsWith('on')).toBe(false);
      }
    }
    expect(svg?.hasAttribute('onload')).toBe(false);
  });

  it('falls back to a text label when the wordmark cannot be parsed', () => {
    const { doc, container } = mount();

    renderSettingsBrand(container, { markSvg: daylineLogoSvg, wordmarkSvg: '<svg><unclosed>', doc });

    const fallback = container.querySelector(`.${BRAND_FALLBACK_CLASS}`);
    expect(fallback?.textContent).toBe(BRAND_DEFAULT_LABEL);
    expect(container.querySelector(`.${BRAND_WORDMARK_CLASS}`)).toBeNull();
    // The logo still renders, so a broken wordmark does not empty the header.
    expect(container.querySelector(`.${BRAND_MARK_CLASS}`)).not.toBeNull();
  });

  it('renders the wordmark without the mark when the logo is unusable', () => {
    const { doc, container } = mount();

    expect(() => renderSettingsBrand(container, { markSvg: '', wordmarkSvg: compactWordmarkSvg, doc })).not.toThrow();

    expect(container.querySelector(`.${BRAND_MARK_CLASS}`)).toBeNull();
    expect(container.querySelector(`.${BRAND_WORDMARK_CLASS}`)).not.toBeNull();
  });
});

describe('Dayline logo asset', () => {
  // Only the `fill` attributes matter here: the file's own comments mention the
  // README ink by name, so matching the raw source would assert on prose.
  const fillsOf = (svg: string) => (svg.match(/fill="([^"]+)"/g) ?? []).map((match) => match.slice(6, -1));

  it('follows the theme instead of baking in the light-theme ink', () => {
    // The README mark hardcodes #0D1318, which is near-invisible on a dark
    // theme; the settings asset must not regress to that.
    const fills = fillsOf(daylineLogoSvg);
    expect(fills).not.toContain('#0D1318');
    expect(fills.filter((fill) => fill === 'currentColor').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the coral lens as the one fixed brand colour', () => {
    expect(fillsOf(daylineLogoSvg)).toContain('#F1694D');
  });

  it('stays geometrically identical to the README mark', () => {
    // Guards the copy-paste: if the source mark is redrawn, this fails until the
    // settings asset is refreshed too.
    const pathData = (svg: string) =>
      (svg.match(/ d="([^"]+)"/g) ?? []).map((match) => match.slice(4, -1)).sort();

    expect(pathData(daylineLogoSvg)).toEqual(pathData(readmeMarkSvg));
  });
});
