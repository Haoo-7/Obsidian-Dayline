import { describe, expect, it } from 'vitest';
import { cssUrl } from '../src/css-url';

describe('cssUrl', () => {
  it('quotes plain resource paths', () => {
    expect(cssUrl('app://local/photo.jpg')).toBe('url("app://local/photo.jpg")');
  });

  it('keeps parentheses, spaces and quotes inside a quoted string', () => {
    expect(cssUrl('app://local/IMG_1234 (1).jpg')).toBe('url("app://local/IMG_1234 (1).jpg")');
    expect(cssUrl('app://local/a"b.jpg')).toBe('url("app://local/a\\"b.jpg")');
  });

  it('escapes backslashes before quotes so the output cannot be re-escaped', () => {
    expect(cssUrl('app://local/a\\"b.jpg')).toBe('url("app://local/a\\\\\\"b.jpg")');
  });

  it('escapes raw newlines that would terminate the CSS string', () => {
    expect(cssUrl('app://local/a\nb.jpg')).toBe('url("app://local/a\\a b.jpg")');
    expect(cssUrl('app://local/a\rb.jpg')).toBe('url("app://local/a\\d b.jpg")');
  });

  it('tolerates missing values', () => {
    expect(cssUrl(undefined)).toBe('url("")');
    expect(cssUrl(null)).toBe('url("")');
  });
});
