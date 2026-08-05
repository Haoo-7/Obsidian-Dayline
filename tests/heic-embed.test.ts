// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hasExistingImage } from '../src/heic-embed';

describe('HEIC embed conversion guard', () => {
  it('does not request a conversion when Obsidian already rendered an image', () => {
    const embed = document.createElement('span');
    embed.innerHTML = '<img src="app://image.heic">';

    expect(hasExistingImage(embed)).toBe(true);
  });
});
