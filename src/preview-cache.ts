/**
 * Image preview cache.
 *
 * Timeline cards and calendar cells used to point their `<img>`/`background-image`
 * straight at the original photo. A journal with dozens of phone photos therefore
 * made Obsidian open by decoding dozens of 3–10 MB originals (and, for HEIC, by
 * running the bundled libheif WASM decoder again) only to paint them 120 px wide.
 *
 * This module turns a photo into a small JPEG once and reuses it on every later
 * open: the downscaled file lives in the same vault cache folder the HEIC
 * thumbnails already use (`heic-thumb-store.ts`), so a second launch paints from
 * a ~40 KB file instead of the original. The first sighting of an image still
 * pays one decode — that is the generation step — and every launch after it does
 * not.
 *
 * Generation is deliberately conservative: desktop-only (the same device that
 * may write the shared folder), two conversions at a time, skipped for images
 * that are already small, and never retried for a file that failed once.
 */

export const PREVIEW_MAX_EDGE = 640;
export const PREVIEW_JPEG_QUALITY = 0.8;
export const PREVIEW_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const PREVIEW_CONCURRENCY = 2;
export const PREVIEW_SKIP_LIMIT = 500;

/**
 * Formats the browser can decode through `createImageBitmap`/`<img>`. HEIC/HEIF
 * stay out: Chromium cannot decode them, and their thumbnails already come from
 * the libheif conversion that persists into the same store.
 */
export const PREVIEW_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif'];

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

export interface PreviewResult {
  url: string;
  width?: number;
  height?: number;
}

/** A decoded image that can be drawn into a canvas at any size. */
export interface PreviewSource {
  width: number;
  height: number;
  draw(context: any, width: number, height: number): void;
  close?(): void;
}

/** The subset of `HeicThumbStore` this cache needs. */
export interface PreviewStore {
  enabled?: boolean;
  read(file: any): Promise<{ url: string } | null>;
  write?(file: any, thumb: { dataUrl?: string; width?: number; height?: number }): Promise<boolean>;
}

export interface PreviewCacheOptions {
  /** Whether previews are enabled at all (the user's setting). */
  isEnabled?: () => boolean;
  /** Whether this host may spend CPU on a conversion (and write the shared folder). */
  allowGenerate?: () => boolean;
  decode?: (blob: Blob) => Promise<PreviewSource | null>;
  createCanvas?: () => any;
  concurrency?: number;
  maxEdge?: number;
  quality?: number;
  maxSourceBytes?: number;
}

export interface PreviewCacheLike {
  enabled?: boolean;
  read(file: any): Promise<PreviewResult | null>;
  generate?(file: any): Promise<PreviewResult | null>;
  invalidate?(path?: string): void;
}

/**
 * Fit `width`×`height` inside a `maxEdge` square without upscaling. Returns null
 * for dimensions that cannot describe an image.
 */
export function scalePreviewDimensions(
  width: unknown,
  height: unknown,
  maxEdge = PREVIEW_MAX_EDGE,
): { width: number; height: number } | null {
  const inputWidth = Number(width);
  const inputHeight = Number(height);
  const edge = Number(maxEdge);
  if (!Number.isFinite(inputWidth) || !Number.isFinite(inputHeight) || inputWidth <= 0 || inputHeight <= 0) return null;
  if (!Number.isFinite(edge) || edge <= 0) return null;
  const scale = Math.min(1, edge / Math.max(inputWidth, inputHeight));
  return {
    width: Math.max(1, Math.round(inputWidth * scale)),
    height: Math.max(1, Math.round(inputHeight * scale)),
  };
}

export function previewExtensionOf(file: any): string {
  return String(file?.extension || '').toLowerCase();
}

export function supportsPreviewExtension(extension: unknown): boolean {
  return PREVIEW_EXTENSIONS.includes(String(extension || '').toLowerCase());
}

/** Decode through the host's image pipeline, preferring the off-main-thread one. */
async function decodeImageBlob(blob: Blob): Promise<PreviewSource | null> {
  const host: any = typeof window !== 'undefined' ? window : (globalThis as any);
  if (typeof host?.createImageBitmap === 'function') {
    const bitmap = await host.createImageBitmap(blob);
    if (!bitmap) return null;
    return {
      width: Number(bitmap.width) || 0,
      height: Number(bitmap.height) || 0,
      draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
      close: () => bitmap.close?.(),
    };
  }
  // Older hosts (and JSDOM) have no createImageBitmap; an <img> decodes the same
  // blob, just on the main thread.
  const urlApi = host?.URL;
  if (typeof document === 'undefined' || typeof urlApi?.createObjectURL !== 'function') return null;
  const url = urlApi.createObjectURL(blob);
  const image = document.createElement('img');
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('preview decode failed'));
      image.src = url;
    });
    return {
      width: Number(image.naturalWidth) || 0,
      height: Number(image.naturalHeight) || 0,
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      close: () => urlApi.revokeObjectURL?.(url),
    };
  } catch (error) {
    urlApi.revokeObjectURL?.(url);
    throw error;
  }
}

function defaultCreateCanvas(): any {
  return typeof document === 'undefined' ? null : document.createElement('canvas');
}

/**
 * Read-through preview store with a bounded, desktop-only generation path.
 *
 * `read()` never decodes: it asks the vault cache folder, so it stays cheap on a
 * phone. `generate()` is what pays the one-time decode and persists the result.
 */
export class PreviewCache implements PreviewCacheLike {
  private readonly app: any;
  private readonly store: PreviewStore | null;
  private readonly isEnabled: () => boolean;
  private readonly allowGenerate: () => boolean;
  private readonly decode: (blob: Blob) => Promise<PreviewSource | null>;
  private readonly createCanvas: () => any;
  private readonly concurrency: number;
  private readonly maxEdge: number;
  private readonly quality: number;
  private readonly maxSourceBytes: number;
  private readonly pending = new Map<string, Promise<PreviewResult | null>>();
  /** Files this session already decided not to preview, keyed by path and size. */
  private readonly skipped = new Set<string>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private disposed = false;

  constructor(app: any, store: PreviewStore | null | undefined, options: PreviewCacheOptions = {}) {
    this.app = app;
    this.store = store || null;
    this.isEnabled = options.isEnabled || (() => true);
    this.allowGenerate = options.allowGenerate || (() => true);
    this.decode = options.decode || decodeImageBlob;
    this.createCanvas = options.createCanvas || defaultCreateCanvas;
    this.concurrency = Math.max(1, Number(options.concurrency) || PREVIEW_CONCURRENCY);
    this.maxEdge = Math.max(1, Number(options.maxEdge) || PREVIEW_MAX_EDGE);
    this.quality = Number.isFinite(Number(options.quality)) ? Number(options.quality) : PREVIEW_JPEG_QUALITY;
    this.maxSourceBytes = Math.max(1, Number(options.maxSourceBytes) || PREVIEW_MAX_SOURCE_BYTES);
  }

  get enabled(): boolean {
    if (!this.store?.enabled) return false;
    try {
      return this.isEnabled() !== false;
    } catch {
      return false;
    }
  }

  /** A stored preview for this file, or null. Never decodes the original. */
  async read(file: any): Promise<PreviewResult | null> {
    if (this.disposed || !this.enabled || !file?.path) return null;
    if (typeof this.store?.read !== 'function') return null;
    try {
      const result = await this.store.read(file);
      return result?.url ? { url: result.url } : null;
    } catch {
      return null;
    }
  }

  /** Whether `generate()` would actually try for this file. */
  canGenerate(file: any): boolean {
    return Boolean(this.store?.write)
      && this.enabled
      && supportsPreviewExtension(previewExtensionOf(file))
      && (Number(file?.stat?.size) || 0) <= this.maxSourceBytes
      && !this.skipped.has(this.skipKey(file));
  }

  /**
   * Produce and persist a downscaled preview. Returns null when the file cannot
   * be previewed (unsupported format, already small, decode failure) — callers
   * then fall back to the original resource URL.
   */
  async generate(file: any): Promise<PreviewResult | null> {
    if (this.disposed || !file?.path || !this.canGenerate(file)) return null;
    if (!this.allowsGeneration()) return null;
    const key = this.skipKey(file);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.withSlot(() => this.build(file, key));
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(key) === task) this.pending.delete(key);
    }
  }

  /** Drop in-memory decisions, for one file or every file. */
  invalidate(path?: string): void {
    if (!path) {
      this.skipped.clear();
      this.pending.clear();
      return;
    }
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(`${path}\u0000`)) this.pending.delete(key);
    }
    for (const key of [...this.skipped]) {
      if (key.startsWith(`${path}\u0000`)) this.skipped.delete(key);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.skipped.clear();
    this.waiters.length = 0;
  }

  private allowsGeneration(): boolean {
    try {
      return Boolean(this.allowGenerate?.());
    } catch {
      return false;
    }
  }

  private skipKey(file: any): string {
    return `${file?.path || ''}\u0000${Number(file?.stat?.size) || 0}`;
  }

  private markSkipped(key: string): void {
    this.skipped.add(key);
    while (this.skipped.size > PREVIEW_SKIP_LIMIT) {
      const oldest = this.skipped.values().next().value;
      if (oldest === undefined) break;
      this.skipped.delete(oldest);
    }
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> | void {
    if (this.active < this.concurrency) {
      this.active += 1;
      return undefined;
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve)).then(() => {
      this.active += 1;
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  private async build(file: any, key: string): Promise<PreviewResult | null> {
    try {
      // Another pane, tab, or the pre-warm may have produced it meanwhile.
      const stored = await this.read(file);
      if (stored) return stored;
      const buffer = await this.app?.vault?.readBinary?.(file);
      if (!buffer) {
        this.markSkipped(key);
        return null;
      }
      const extension = previewExtensionOf(file);
      const blob = new Blob([buffer], { type: MIME_TYPES[extension] || 'application/octet-stream' });
      const source = await this.decode(blob);
      if (!source || !source.width || !source.height) {
        this.markSkipped(key);
        return null;
      }
      try {
        // An image that already fits the thumbnail budget is shown as-is: one
        // lossy re-encode would buy nothing and cost a decode.
        if (Math.max(source.width, source.height) <= this.maxEdge) {
          this.markSkipped(key);
          return null;
        }
        const target = scalePreviewDimensions(source.width, source.height, this.maxEdge);
        if (!target) {
          this.markSkipped(key);
          return null;
        }
        const canvas = this.createCanvas();
        const context = canvas?.getContext?.('2d');
        if (!canvas || !context) {
          this.markSkipped(key);
          return null;
        }
        canvas.width = target.width;
        canvas.height = target.height;
        source.draw(context, target.width, target.height);
        const dataUrl = canvas.toDataURL?.('image/jpeg', this.quality);
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
          this.markSkipped(key);
          return null;
        }
        try {
          await this.store?.write?.(file, { dataUrl, width: target.width, height: target.height });
        } catch {
          // Persistence is best effort: the preview still serves this session.
        }
        return { url: dataUrl, width: target.width, height: target.height };
      } finally {
        source.close?.();
      }
    } catch {
      this.markSkipped(key);
      return null;
    }
  }
}
