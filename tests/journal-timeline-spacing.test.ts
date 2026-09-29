import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** The balanced CSS block that starts at `startToken`, braces included. */
function cssRule(source: string, startToken: string): string {
  const start = source.indexOf(startToken);
  expect(start, `missing CSS token: ${startToken}`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  expect(open).toBeGreaterThan(start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unclosed CSS rule for ${startToken}`);
}

/**
 * Every `@media (pointer: coarse)` block, in file order. There is more than one,
 * so tests must select the sweep they mean instead of the first match.
 */
function coarsePointerBlocks(source: string): string[] {
  const token = '@media (pointer: coarse) {';
  const blocks: string[] = [];
  for (let index = source.indexOf(token); index !== -1; index = source.indexOf(token, index + 1)) {
    blocks.push(cssRule(source.slice(index), token));
  }
  return blocks;
}

/** The block that sizes touch controls to 44px, rather than the mood-pip block. */
function touchTargetSweep(): string {
  const block = coarsePointerBlocks(styles).find((candidate) => candidate.includes('.journal-timeline-actions button'));
  expect(block, 'missing the coarse-pointer 44px sweep').toBeDefined();
  return block as string;
}

describe('journal timeline title spacing', () => {
  it('keeps the single-line title out of the coarse-pointer 44px sweep', () => {
    // The title is one 19.5px line whose next sibling sits 4px away. Giving it a
    // 44px box turned the surplus into 18px of dead space — the gap between the
    // title and the excerpt. The space cannot be reclaimed by an overlay or a
    // negative margin either, because the card and the entry body clip with
    // `overflow: hidden`, so the hit area would land on the excerpt instead.
    const sweep = touchTargetSweep().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sweep).not.toContain('.journal-timeline-entry-title');
  });

  it('still sizes the real timeline controls for touch', () => {
    const sweep = touchTargetSweep().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sweep).toContain('.journal-timeline-favorite-filter { min-height: 44px; }');
    expect(sweep).toContain('.journal-timeline-actions button, .journal-timeline-filter-row > button { width: 44px; height: 44px;');
  });

  it('sizes the title box to its text, leaving only its own margin below', () => {
    const title = cssRule(styles, '.journal-timeline-entry-title {');
    expect(title).toContain('margin: 0 0 4px');
    expect(title).toContain('padding: 0;');
    // Any reserved height here reopens the gap measured above.
    expect(title).not.toContain('min-height');
  });
});
