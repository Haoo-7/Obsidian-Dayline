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

  it('keeps weather badges as a transparent glyph with a date-like halo', () => {
    const rule = cssRule(styles, '.cal-weather-badge {');
    expect(rule).toContain('background: transparent');
    expect(rule).toContain('background-color: transparent');
    expect(rule).toContain('border-radius: 0');
    expect(rule).toContain('drop-shadow');
    expect(rule).not.toContain('backdrop-filter');
  });

  it('pins date, weather, and mood to corners below 360px', () => {
    const rule = cssRule(styles, '@container dayline-calendar (max-width: 360px) {');
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('top: 3px');
    expect(rule).toContain('left: 4px');
    expect(rule).toContain('.cal-weather-badge');
    expect(rule).toContain('width: 10px');
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
    expect(rule).toContain('width: 9px');
    expect(rule).toContain('.cal-sidebar button.cal-mood-button');
    expect(rule).toContain('width: 14px');
    expect(rule).toContain('.cal-entry-count');
    expect(rule).toContain('font-size: 8px');
  });

  it('keeps the tablet mood pip compact so it cannot swallow the date cell', () => {
    // Obsidian's tablet chrome sets its own button padding, and the coarse-pointer
    // rule sizes the pip for roomy touch desktops. On a ~48px tablet cell that
    // 28px pip covered most of the date and intercepted its taps, so tablets must
    // be excluded from the enlarged variant.
    const coarse = cssRule(styles, '@media (pointer: coarse) {');
    expect(coarse).toContain(':not(.dayline-tablet)');
    expect(styles).toContain('body.dayline-tablet .cal-sidebar .cal-mood-empty');
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
