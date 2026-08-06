// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hasExistingImage } from '../src/heic-embed';
import { HeicCache, MAX_HEIC_BYTES } from '../src/image-metadata';

describe('HEIC embed conversion guard', () => {
  it('does not request a conversion when Obsidian already rendered an image', () => {
    const embed = document.createElement('span');
    embed.innerHTML = '<img src="app://image.heic">';

    expect(hasExistingImage(embed)).toBe(true);
  });

  it('skips HEIC files above the bounded conversion size', async () => {
    let factoryCalls = 0;
    const app = {
      vault: { readBinary: async () => ({ byteLength: MAX_HEIC_BYTES + 1 }) },
      plugins: { plugins: { dayline: { _libheifFactory: () => { factoryCalls++; return {}; } } } },
    };
    const cache = new HeicCache(app);
    await expect(cache.getThumbnail({ path: 'huge.heic', stat: { mtime: 1 } })).resolves.toBeNull();
    expect(factoryCalls).toBe(0);
  });

  it('does not read mobile HEIC binaries when the capability route is disabled', async () => {
    let reads = 0;
    let factoryCalls = 0;
    const app = {
      vault: { readBinary: async () => { reads += 1; return new ArrayBuffer(4); } },
      plugins: { plugins: { dayline: { _libheifFactory: () => { factoryCalls += 1; return {}; } } } },
    };
    const cache = new HeicCache(app, { routes: { heic: 'disabled' } });
    await expect(cache.getThumbnail({ path: 'mobile.heic', stat: { mtime: 1 } })).resolves.toBeNull();
    expect(reads).toBe(0);
    expect(factoryCalls).toBe(0);
  });

  it('checks for libheif before reading when no factory is available', async () => {
    let reads = 0;
    const app = {
      vault: { readBinary: async () => { reads += 1; return new ArrayBuffer(4); } },
      plugins: { plugins: { dayline: {} } },
    };
    const cache = new HeicCache(app);
    await expect(cache.getThumbnail({ path: 'unsupported.heic', stat: { mtime: 1 } })).resolves.toBeNull();
    expect(reads).toBe(0);
  });
});
