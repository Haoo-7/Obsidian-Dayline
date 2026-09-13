// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
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
      plugins: { plugins: { 'dayline-journal': { _libheifFactory: () => { factoryCalls++; return {}; } } } },
    };
    const cache = new HeicCache(app);
    await expect(cache.getThumbnail({ path: 'huge.heic', stat: { mtime: 1 } })).resolves.toBeNull();
    expect(factoryCalls).toBe(0);
  });

  it('rejects an oversized HEIC from stat before reading it', async () => {
    const readBinary = vi.fn();
    const app = {
      vault: { readBinary },
      plugins: { plugins: { 'dayline-journal': { _libheifFactory: () => ({}) } } },
    };
    const cache = new HeicCache(app);

    await expect(cache.getThumbnail({ path: 'huge.heic', stat: { mtime: 1, size: MAX_HEIC_BYTES + 1 } }))
      .resolves.toBeNull();
    expect(readBinary).not.toHaveBeenCalled();
  });

  it('frees every decoded native image when dimensions are rejected', async () => {
    const images = [
      { get_width: () => MAX_HEIC_BYTES, get_height: () => 1, free: vi.fn() },
      { get_width: () => 1, get_height: () => 1, free: vi.fn() },
    ];
    const app = {
      vault: { readBinary: async () => new ArrayBuffer(4) },
      plugins: { plugins: { 'dayline-journal': { _libheifFactory: () => ({ HeifDecoder: class { decode() { return images; } } }) } } },
    };

    await expect(new HeicCache(app).getThumbnail({ path: 'wide.heic', stat: { mtime: 1, size: 4 } })).resolves.toBeNull();
    expect(images[0].free).toHaveBeenCalledTimes(1);
    expect(images[1].free).toHaveBeenCalledTimes(1);
  });

  it('frees every decoded native image after successful display', async () => {
    const images = [
      {
        get_width: () => 2,
        get_height: () => 2,
        display: (data: unknown, callback: (value: unknown) => void) => callback(data),
        free: vi.fn(),
      },
      { free: vi.fn() },
    ];
    const context = {
      createImageData: (width: number, height: number) => ({ width, height }),
      putImageData: vi.fn(),
      drawImage: vi.fn(),
    };
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return document.createElement(tagName);
      return {
        width: 0,
        height: 0,
        getContext: () => context,
        toDataURL: () => 'data:image/jpeg;base64,ok',
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
    const app = {
      vault: { readBinary: async () => new ArrayBuffer(4) },
      plugins: { plugins: { 'dayline-journal': { _libheifFactory: () => ({ HeifDecoder: class { decode() { return images; } } }) } } },
    };

    await expect(new HeicCache(app).getThumbnail({ path: 'ok.heic', stat: { mtime: 1, size: 4 } }))
      .resolves.toEqual({ dataUrl: 'data:image/jpeg;base64,ok', width: 2, height: 2 });
    expect(images[0].free).toHaveBeenCalledTimes(1);
    expect(images[1].free).toHaveBeenCalledTimes(1);
    createElement.mockRestore();
  });

  it('frees decoded native images when display fails', async () => {
    const image = {
      get_width: () => 2,
      get_height: () => 2,
      display: (_data: unknown, callback: (value: unknown) => void) => callback(null),
      free: vi.fn(),
    };
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ createImageData: () => ({}) }),
    } as unknown as HTMLCanvasElement);
    const app = {
      vault: { readBinary: async () => new ArrayBuffer(4) },
      plugins: { plugins: { 'dayline-journal': { _libheifFactory: () => ({ HeifDecoder: class { decode() { return [image]; } } }) } } },
    };

    await expect(new HeicCache(app).getThumbnail({ path: 'bad.heic', stat: { mtime: 1, size: 4 } })).resolves.toBeNull();
    expect(image.free).toHaveBeenCalledTimes(1);
    createElement.mockRestore();
  });

  it('runs at most one HEIC conversion at a time', async () => {
    let resolveFactory: (value: unknown) => void = () => undefined;
    const factoryPromise = new Promise((resolve) => { resolveFactory = resolve; });
    const readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(4));
    const app = {
      vault: { readBinary },
      plugins: { plugins: { 'dayline-journal': { _libheifFactory: () => factoryPromise } } },
    };
    const cache = new HeicCache(app);
    const first = cache.getThumbnail({ path: 'first.heic', stat: { mtime: 1, size: 4 } });
    const second = cache.getThumbnail({ path: 'second.heic', stat: { mtime: 1, size: 4 } });
    await vi.waitFor(() => expect(readBinary).toHaveBeenCalledTimes(1));

    resolveFactory({ HeifDecoder: class { decode() { return []; } } });
    await Promise.all([first, second]);
    expect(readBinary).toHaveBeenCalledTimes(2);
  });

  it('does not read mobile HEIC binaries when the capability route is disabled', async () => {
    let reads = 0;
    let factoryCalls = 0;
    const app = {
      vault: { readBinary: async () => { reads += 1; return new ArrayBuffer(4); } },
      plugins: { plugins: { 'dayline-journal': { _libheifFactory: () => { factoryCalls += 1; return {}; } } } },
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
      plugins: { plugins: { 'dayline-journal': {} } },
    };
    const cache = new HeicCache(app);
    await expect(cache.getThumbnail({ path: 'unsupported.heic', stat: { mtime: 1 } })).resolves.toBeNull();
    expect(reads).toBe(0);
  });
});
