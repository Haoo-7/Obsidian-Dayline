import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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

describe('calendar compact cell layout', () => {
  it('names the sidebar as a calendar container', () => {
    expect(cssRule(styles, '.cal-sidebar {')).toContain('container: dayline-calendar / inline-size');
  });

  it('strips native mood button chrome so the marker is only the color pip', () => {
    const rule = cssRule(styles, '.cal-sidebar button.cal-mood-button {');
    expect(rule).toContain('appearance: none');
    expect(rule).toContain('-webkit-appearance: none');
    expect(rule).toContain('background: transparent');
    expect(rule).toContain('background-color: transparent');
    expect(rule).toContain('box-shadow: none');
    expect(rule).toContain('border-radius: 0');
    expect(rule).toContain('min-width: 0');
    expect(rule).toContain('min-height: 0');
  });

  it('renders weather badges as bare condition-colored outlines, with no backing plate', () => {
    const rule = cssRule(styles, '.cal-weather-badge {');
    // The Lucide glyph family carries the state on its own; a plate is not needed.
    expect(rule).not.toContain('backdrop-filter');
    expect(rule).not.toContain('border-radius');
    expect(rule).not.toContain('background');
    // condition category classes
    expect(styles).toContain('weather-cat-sun');
    expect(styles).toContain('weather-cat-cloud-sun');
    expect(styles).toContain('weather-cat-rain');
    expect(styles).toContain('weather-cat-snow');
  });

  it('gives every condition hue at least 3:1 contrast on light and dark cells', () => {
    // A single hue per condition has to work in both themes, because the glyph is drawn
    // straight onto the cell with no plate behind it.
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]: number[]) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const contrast = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const parse = (hex: string) =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

    const cells = [parse('#ffffff'), parse('#1e1e1e')];
    const conditions = [
      'sun', 'cloud-sun', 'cloud', 'fog', 'drizzle', 'rain', 'snow', 'storm',
    ];
    for (const condition of conditions) {
      const match = styles.match(
        new RegExp(`\\.cal-weather-badge\\.weather-cat-${condition}\\s*\\{\\s*color:\\s*(#[0-9A-Fa-f]{6})`),
      );
      expect(match, `missing color for weather-cat-${condition}`).not.toBeNull();
      const rgb = parse(match![1]);
      for (const cell of cells) {
        expect(contrast(rgb, cell), `${condition} on ${cell}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('pins date, weather, and mood to corners below 360px', () => {
    const rule = cssRule(styles, '@container dayline-calendar (max-width: 360px) {');
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('top: 3px');
    expect(rule).toContain('left: 4px');
    expect(rule).toContain('.cal-weather-badge');
    expect(rule).toContain('width: 12px');
    // Detail (drizzle dashes, fog lines) needs a heavier relative stroke when shrunk.
    expect(rule).toContain('stroke-width: 3');
    expect(rule).toContain('.cal-sidebar button.cal-mood-button');
    expect(rule).toContain('width: 16px');
    expect(rule).toContain('left: 0');
    expect(rule).toContain('bottom: 0');
    expect(rule).toContain('width: 6px');
    expect(rule).toContain('border-width: 1px');
  });

  it('keeps a tighter 240px calendar cell layout', () => {
    const rule = cssRule(styles, '@container dayline-calendar (max-width: 240px) {');
    expect(rule).toContain('.cal-day-num');
    expect(rule).toContain('font-size: 10px');
    expect(rule).toContain('.cal-weather-badge');
    expect(rule).toContain('display: none');
    expect(rule).toContain('.cal-sidebar button.cal-mood-button');
    expect(rule).toContain('width: 14px');
    expect(rule).toContain('.cal-entry-count');
    expect(rule).toContain('font-size: 8px');
  });

  it('stacks the weather row above the on-this-day strip', () => {
    const card = cssRule(styles, '.cal-weather-card {');
    const main = cssRule(styles, '.cal-weather-main {');
    const strip = cssRule(styles, '.cal-otd-strip {');
    expect(card).toContain('flex-direction: column');
    expect(main).toContain('display: flex');
    expect(strip).toContain('border-top');
    expect(strip).toContain('min-height: 36px');
  });

  it('keeps dates centered and draws a bottom mood bar in bar style', () => {
    const dateRule = cssRule(styles, '.cal-sidebar.cal-mood-marker-bar .cal-day-num {');
    const buttonRule = cssRule(styles, '.cal-sidebar.cal-mood-marker-bar button.cal-mood-button,');
    const dotRule = cssRule(styles, '.cal-sidebar.cal-mood-marker-bar .cal-mood-dot,');
    expect(dateRule).toContain('position: relative');
    expect(dateRule).toContain('top: auto');
    expect(dateRule).toContain('left: auto');
    expect(buttonRule).toContain('width: 100%');
    expect(buttonRule).toContain('bottom: 0');
    expect(dotRule).toContain('height: 3px');
    expect(dotRule).toContain('border-radius: 999px');
  });
});
