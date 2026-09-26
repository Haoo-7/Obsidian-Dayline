/**
 * Inline weather-badge glyphs.
 *
 * The calendar badge markup is a set of build-time constants from
 * `icons/badge-*.svg`. They used to be written with `badge.innerHTML = ...`,
 * which the Obsidian review rejects — and rightly so, since an HTML-string sink
 * turns any future asset change into an injection point.
 *
 * `appendBadgeSvg` parses the markup as XML and imports the resulting node, so
 * the glyph renders identically with zero I/O while the sink stays inert.
 */

/** Elements the parser keeps; anything executable is stripped before import. */
function stripExecutableContent(root: ParentNode): void {
  root.querySelectorAll('script').forEach((script) => script.remove());
  root.querySelectorAll('*').forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name);
    }
  });
}

/**
 * Append one badge glyph to `parent` as live DOM.
 *
 * Returns the imported `<svg>` element, or `null` when `markup` is empty or is
 * not a well-formed `<svg>` document. A malformed glyph therefore renders
 * nothing rather than injecting a partial tree.
 */
export function appendBadgeSvg(parent: HTMLElement, markup: string | undefined): SVGElement | null {
  if (!markup) return null;
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return null;
  const svg = parsed.documentElement;
  if (svg?.tagName?.toLowerCase() !== 'svg') return null;
  stripExecutableContent(parsed);
  const imported = parent.ownerDocument.importNode(svg, true) as unknown as SVGElement;
  parent.appendChild(imported);
  return imported;
}
