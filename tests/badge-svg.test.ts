// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendBadgeSvg } from '../src/badge-svg';

const BADGES = [
  'badge-sun', 'badge-cloud-sun', 'badge-cloud', 'badge-fog',
  'badge-drizzle', 'badge-rain', 'badge-snow', 'badge-storm',
];

function badgeMarkup(name: string): string {
  return readFileSync(join(__dirname, '..', 'icons', `${name}.svg`), 'utf8');
}

describe('appendBadgeSvg', () => {
  it('renders every shipped badge glyph as an inline svg', () => {
    for (const name of BADGES) {
      const host = document.createElement('span');
      const svg = appendBadgeSvg(host, badgeMarkup(name));

      expect(svg, name).not.toBeNull();
      expect(host.querySelector('svg'), name).not.toBeNull();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      // The glyph inherits its condition colour from the parent's CSS.
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
    }
  });

  it('keeps the drawing shapes so the glyph is not an empty box', () => {
    const host = document.createElement('span');
    appendBadgeSvg(host, badgeMarkup('badge-sun'));
    expect(host.querySelectorAll('path, circle').length).toBeGreaterThan(0);
  });

  it('cannot execute markup embedded in an asset', () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'
      + '<script>alert(2)</script><a onmouseover="alert(3)"/></svg>';
    const host = document.createElement('span');
    appendBadgeSvg(host, hostile);

    const svg = host.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(host.querySelectorAll('script')).toHaveLength(0);
    expect(svg?.getAttribute('onload')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('onmouseover')).toBeNull();
  });

  it('renders nothing for empty or malformed markup instead of a partial tree', () => {
    const empty = document.createElement('span');
    expect(appendBadgeSvg(empty, undefined)).toBeNull();
    expect(empty.childNodes).toHaveLength(0);

    const malformed = document.createElement('span');
    expect(appendBadgeSvg(malformed, '<svg><unclosed>')).toBeNull();
    expect(malformed.childNodes).toHaveLength(0);
  });

  it('appends into the live document rather than leaving the node detached', () => {
    const host = document.createElement('span');
    document.body.appendChild(host);
    const svg = appendBadgeSvg(host, badgeMarkup('badge-cloud'));
    expect(svg?.isConnected).toBe(true);
    host.remove();
  });
});
