import { describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_EXTENSIONS,
  PREVIEW_MAX_EDGE,
  PreviewCache,
  previewExtensionOf,
  scalePreviewDimensions,
  supportsPreviewExtension,
} from '../src/preview-cache';

interface StoreWrite {
  file: any;
  thumb: { dataUrl?: string; width?: number; height?: number };
}

function createStore(overrides: Partial<{ enabled: boolean; read: any; write: any }> = {}) {
  const writes: StoreWrite[] = [];
  const store = {
    enabled: true,
    writes,
    read: vi.fn(async () => null as { url: string } | null),
    write: vi.fn(async (file: any, thumb: StoreWrite['thumb']) => {
      writes.push({ file, thumb });
      return true;
    }),
    ...overrides,
  };
  return store;
}

function createCanvasFactory(dataUrl = 'data:image/jpeg;base64,preview') {
  const canvases: any[] = [];
  const createCanvas = () => {
    const canvas: any = {
      width: 0,
      height: 0,
      toDataURL: vi.fn(() => dataUrl),
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    };
    canvases.push(canvas);
    return canvas;
  };
  return { createCanvas, canvases };
}

function createDecoder(size: { width: number; height: number } = { width: 4000, height: 3000 }) {
  const decode = vi.fn(async () => ({
    width: size.width,
    height: size.height,
    draw: vi.fn(),
    close: vi.fn(),
  }));
  return decode;
}

function createFile(overrides: Record<string, unknown> = {}) {
  return { path: 'Photos/IMG_0001.jpg', extension: 'jpg', stat: { size: 4_000_000, mtime: 1 }, ...overrides };
}

function createApp(file: any = createFile(), buffer: ArrayBuffer | null = new ArrayBuffer(8)) {
  return { vault: { readBinary: vi.fn(async () => buffer) }, file };
}

describe('preview scaling', () => {
  it('fits the long edge inside the budget without upscaling', () => {
    expect(scalePreviewDimensions(4000, 3000, 640)).toEqual({ width: 640, height: 480 });
    expect(scalePreviewDimensions(3000, 4000, 640)).toEqual({ width: 480, height: 640 });
    expect(scalePreviewDimensions(320, 200, 640)).toEqual({ width: 320, height: 200 });
  });

  it('rejects dimensions that cannot describe an image', () => {
    expect(scalePreviewDimensions(0, 100, 640)).toBeNull();
    expect(scalePreviewDimensions(Number.NaN, 100, 640)).toBeNull();
    expect(scalePreviewDimensions(100, 100, 0)).toBeNull();
  });

  it('knows which formats it can decode', () => {
    expect(PREVIEW_EXTENSIONS).toContain('jpg');
    expect(supportsPreviewExtension('JPEG')).toBe(true);
    expect(supportsPreviewExtension('png')).toBe(true);
    expect(supportsPreviewExtension('gif')).toBe(false);
    expect(supportsPreviewExtension('svg')).toBe(false);
    expect(supportsPreviewExtension('heic')).toBe(false);
    expect(previewExtensionOf({ extension: 'WEBP' })).toBe('webp');
    expect(previewExtensionOf({})).toBe('');
  });
});

describe('preview cache reads', () => {
  it('returns a stored preview without touching the original photo', async () => {
    const file = createFile();
    const app = createApp(file);
    const store = createStore({ read: vi.fn(async () => ({ url: 'blob:preview' })) });
    const decode = createDecoder();
    const cache = new PreviewCache(app, store, { decode, ...createCanvasFactory() });

    await expect(cache.read(file)).resolves.toEqual({ url: 'blob:preview' });
    await expect(cache.generate(file)).resolves.toEqual({ url: 'blob:preview' });
    expect(app.vault.readBinary).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });

  it('stays disabled when the store is disabled or the user turned previews off', async () => {
    const file = createFile();
    const app = createApp(file);
    const disabledStore = createStore({ enabled: false });
    expect(new PreviewCache(app, disabledStore).enabled).toBe(false);
    await expect(new PreviewCache(app, disabledStore).read(file)).resolves.toBeNull();

    const store = createStore({ read: vi.fn(async () => ({ url: 'blob:preview' })) });
    const cache = new PreviewCache(app, store, { isEnabled: () => false });
    expect(cache.enabled).toBe(false);
    await expect(cache.read(file)).resolves.toBeNull();
    expect(store.read).not.toHaveBeenCalled();
  });

  it('treats a throwing store as a miss', async () => {
    const store = createStore({ read: vi.fn(async () => { throw new Error('adapter unavailable'); }) });
    const cache = new PreviewCache(createApp(), store);
    await expect(cache.read(createFile())).resolves.toBeNull();
  });
});

describe('preview generation', () => {
  it('downscales the original and persists the preview', async () => {
    const file = createFile();
    const app = createApp(file);
    const store = createStore();
    const { createCanvas, canvases } = createCanvasFactory();
    const decode = createDecoder({ width: 4000, height: 3000 });
    const cache = new PreviewCache(app, store, { decode, createCanvas });

    const result = await cache.generate(file);

    expect(result).toEqual({ url: 'data:image/jpeg;base64,preview', width: 640, height: 480 });
    expect(canvases[0].width).toBe(640);
    expect(canvases[0].height).toBe(480);
    expect(store.write).toHaveBeenCalledWith(file, {
      dataUrl: 'data:image/jpeg;base64,preview',
      width: 640,
      height: 480,
    });
    expect(app.vault.readBinary).toHaveBeenCalledWith(file);
  });

  it('uses the configured edge and quality', async () => {
    const { createCanvas, canvases } = createCanvasFactory();
    const cache = new PreviewCache(createApp(), createStore(), {
      decode: createDecoder({ width: 2000, height: 1000 }),
      createCanvas,
      maxEdge: 320,
      quality: 0.6,
    });
    const result = await cache.generate(createFile());
    expect(result).toMatchObject({ width: 320, height: 160 });
    expect(canvases[0].toDataURL).toHaveBeenCalledWith('image/jpeg', 0.6);
  });

  it('leaves an image that already fits the budget alone', async () => {
    const store = createStore();
    const cache = new PreviewCache(createApp(), store, {
      decode: createDecoder({ width: 480, height: 320 }),
      ...createCanvasFactory(),
    });

    await expect(cache.generate(createFile())).resolves.toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('skips formats it cannot decode, oversized files, and unreadable files', async () => {
    const store = createStore();
    const cache = new PreviewCache(createApp(), store, { decode: createDecoder(), ...createCanvasFactory() });

    await expect(cache.generate(createFile({ extension: 'gif' }))).resolves.toBeNull();
    await expect(cache.generate(createFile({ stat: { size: 200 * 1024 * 1024 } }))).resolves.toBeNull();
    await expect(cache.generate(createFile({ path: 'Photos/heic.heic', extension: 'heic' }))).resolves.toBeNull();

    const unreadable = new PreviewCache(createApp(createFile(), null), store, {
      decode: createDecoder(),
      ...createCanvasFactory(),
    });
    await expect(unreadable.generate(createFile())).resolves.toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('does not retry a file that already failed or needed no preview', async () => {
    const file = createFile();
    const app = createApp(file, null);
    const cache = new PreviewCache(app, createStore(), { decode: createDecoder(), ...createCanvasFactory() });

    await expect(cache.generate(file)).resolves.toBeNull();
    await expect(cache.generate(file)).resolves.toBeNull();
    expect(app.vault.readBinary).toHaveBeenCalledTimes(1);

    cache.invalidate(file.path);
    await expect(cache.generate(file)).resolves.toBeNull();
    expect(app.vault.readBinary).toHaveBeenCalledTimes(2);
  });

  it('never generates when the host does not allow it', async () => {
    const app = createApp();
    const decode = createDecoder();
    const cache = new PreviewCache(app, createStore(), {
      allowGenerate: () => false,
      decode,
      ...createCanvasFactory(),
    });
    await expect(cache.generate(createFile())).resolves.toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(app.vault.readBinary).not.toHaveBeenCalled();
  });

  it('runs at most the configured number of conversions at once', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const decode = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { width: 4000, height: 3000, draw: () => undefined, close: () => undefined };
    });
    const cache = new PreviewCache(createApp(), createStore(), {
      decode,
      concurrency: 2,
      ...createCanvasFactory(),
    });

    const files = [1, 2, 3, 4].map((index) => createFile({ path: `Photos/${index}.jpg` }));
    const pending = files.map((file) => cache.generate(file));
    // Only two conversions may start; the rest wait for a slot.
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(decode).toHaveBeenCalledTimes(2);

    // Drain the queue one conversion at a time.
    const drain = (async () => {
      while (releases.length || decode.mock.calls.length < files.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        releases.shift()?.();
      }
    })();
    await Promise.all(pending.map((promise) => promise.catch(() => null)));
    await drain;

    expect(decode).toHaveBeenCalledTimes(4);
    expect(peak).toBe(2);
  });

  it('shares one conversion between concurrent callers for the same file', async () => {
    const file = createFile();
    const decode = createDecoder();
    const cache = new PreviewCache(createApp(file), createStore(), { decode, ...createCanvasFactory() });

    const [first, second] = await Promise.all([cache.generate(file), cache.generate(file)]);
    expect(first).toEqual(second);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('still serves the preview when persisting fails', async () => {
    const store = createStore({ write: vi.fn(async () => { throw new Error('disk full'); }) });
    const cache = new PreviewCache(createApp(), store, { decode: createDecoder(), ...createCanvasFactory() });
    await expect(cache.generate(createFile())).resolves.toMatchObject({ width: PREVIEW_MAX_EDGE });
  });
});
