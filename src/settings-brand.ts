/**
 * Dayline settings-page brand lockup.
 *
 * The logo and wordmark ship as raw SVG text (esbuild `loader: { '.svg': 'text' }`),
 * so they have to be parsed and injected into the settings pane rather than
 * referenced by URL. This module owns that injection: the sanitizing, the
 * rendered sizes, and the decorative-versus-labelled accessibility split. It is
 * separate from `settings-tab.ts` so the behavior is unit-testable, because the
 * settings tab itself is `// @ts-nocheck` and too large to mount in a test.
 *
 * Elements are created with Obsidian's `createDiv`/`createSpan` helpers on the
 * receiving element, and the test setup installs those helpers on `Node.prototype`
 * so the module can be driven from a bare JSDOM document.
 */
export const BRAND_CONTAINER_CLASS = 'dayline-settings-brand';
export const BRAND_MARK_CLASS = 'dayline-settings-brand-mark';
export const BRAND_WORDMARK_CLASS = 'dayline-settings-brand-wordmark';
/** Shown only when the wordmark SVG cannot be parsed, so the pane is never nameless. */
export const BRAND_FALLBACK_CLASS = 'dayline-settings-brand-text';

export const BRAND_DEFAULT_LABEL = 'Dayline';

/**
 * Rendered sizes. Both are explicit because the two files have very different
 * aspect ratios (the mark is 354x225, the compact wordmark 250x36); letting one
 * shared `height` rule size them letterboxes the wordmark inside its own box.
 *
 * The mark is taller than the wordmark's cap height so the icon reads as the
 * leading element, while the wordmark keeps the 132x32 box the settings header
 * has used since it was introduced.
 */
export const BRAND_MARK_SIZE: Readonly<{ width: number; height: number }> = Object.freeze({ width: 41, height: 26 });
export const BRAND_WORDMARK_SIZE: Readonly<{ width: number; height: number }> = Object.freeze({ width: 132, height: 32 });

export interface BrandSvgOptions {
  className: string;
  width: number;
  height: number;
  /** Accessible name. Omit for decorative art that a sibling element already names. */
  label?: string;
}

export interface BrandLockupOptions {
  markSvg: string;
  wordmarkSvg: string;
  /** Accessible name for the wordmark; defaults to `Dayline`. */
  label?: string;
  /** Injection target for tests that use their own JSDOM window. */
  doc?: Document;
}

const URL_ATTRIBUTES = ['href', 'xlink:href'];
const UNSAFE_URL = /^\s*(?:javascript:|data:text\/html)/i;
/** Elements that can execute or embed; a branding asset never needs them. */
const DROPPED_ELEMENTS = 'script, foreignObject';

/**
 * Parse an SVG document and return its root, or `null` when the markup is not a
 * usable `<svg>`. The sources are build-time bundled files rather than runtime
 * input, so this is defense-in-depth: it strips the vectors that would turn a
 * future asset swap into script execution inside the settings pane.
 */
function sanitizeSvgRoot(parsed: Document): Element | null {
  const root: Element | null = parsed.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  if (parsed.querySelector('parsererror')) return null;

  parsed.querySelectorAll(DROPPED_ELEMENTS).forEach((node) => node.remove());
  parsed.querySelectorAll('*').forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        node.removeAttribute(attribute.name);
      } else if (URL_ATTRIBUTES.includes(name) && UNSAFE_URL.test(attribute.value)) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return root;
}

/**
 * Resolve a `DOMParser` from the injection target's own window.
 *
 * `DOMParser` is not a Node global, so a bare `new DOMParser()` would throw
 * under Vitest and be swallowed by the parse guard below — silently dropping the
 * logo instead of failing loudly. Reading it off `defaultView` also keeps the
 * parse in the same window as `importNode`.
 */
function resolveDomParser(doc: Document): typeof DOMParser | null {
  const parser = doc.defaultView?.DOMParser;
  if (typeof parser === 'function') return parser;
  return typeof DOMParser === 'function' ? DOMParser : null;
}

/** Parse, sanitize, and size one branding SVG. Returns `null` if it is unusable. */
export function createBrandSvg(markup: string, options: BrandSvgOptions, doc: Document): SVGElement | null {
  if (typeof markup !== 'string' || markup.trim() === '') return null;

  const Parser = resolveDomParser(doc);
  if (!Parser) return null;

  let root: Element | null = null;
  try {
    root = sanitizeSvgRoot(new Parser().parseFromString(markup, 'image/svg+xml'));
  } catch {
    return null;
  }
  if (!root) return null;

  const clone = doc.importNode(root, true) as SVGElement;
  clone.setAttribute('class', options.className);
  clone.setAttribute('width', String(options.width));
  clone.setAttribute('height', String(options.height));
  // The source files label themselves via `aria-labelledby`; the injected clone
  // is labelled (or hidden) explicitly below, so drop the shipped reference.
  clone.removeAttribute('aria-labelledby');

  if (options.label) {
    clone.setAttribute('role', 'img');
    clone.setAttribute('aria-label', options.label);
  } else {
    clone.removeAttribute('role');
    clone.removeAttribute('aria-label');
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('focusable', 'false');
  }
  return clone;
}

/**
 * Render the lockup (logo mark + wordmark) into `container` and return the
 * created brand element.
 *
 * The mark is decorative and hidden from assistive tech; the wordmark carries
 * the accessible name, since the wordmark is outlined paths rather than text.
 */
export function renderSettingsBrand(container: HTMLElement, options: BrandLockupOptions): HTMLElement {
  const doc = options.doc ?? container.ownerDocument;
  const label = options.label ?? BRAND_DEFAULT_LABEL;

  const brand = container.createDiv({ cls: BRAND_CONTAINER_CLASS });

  const mark = createBrandSvg(options.markSvg, {
    className: BRAND_MARK_CLASS,
    width: BRAND_MARK_SIZE.width,
    height: BRAND_MARK_SIZE.height,
  }, doc);
  if (mark) brand.appendChild(mark);

  const wordmark = createBrandSvg(options.wordmarkSvg, {
    className: BRAND_WORDMARK_CLASS,
    width: BRAND_WORDMARK_SIZE.width,
    height: BRAND_WORDMARK_SIZE.height,
    label,
  }, doc);

  if (wordmark) {
    brand.appendChild(wordmark);
  } else {
    brand.createSpan({ cls: BRAND_FALLBACK_CLASS, text: label });
  }

  return brand;
}
