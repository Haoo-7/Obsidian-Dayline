import { classifyMediaLink, IMAGE_EXTENSIONS } from './media-links';
import type { MediaBunnyBridge } from './mediabunny-bridge';
import type { MediaAttachment, MediaKind, MediaMetadata } from './types';
import type { CapabilityRoute, PlatformCapabilities } from './platform-capabilities';

export const MEDIA_CACHE_LIMIT = 48;
export const METADATA_CACHE_LIMIT = 128;
export const VIDEO_COVER_TIMEOUT_MS = 8_000;
export const VIDEO_COVER_MAX_EDGE = 1_024;
export const AUDIO_ARTWORK_MAX_BYTES = 8 * 1024 * 1024;

const SAFE_ARTWORK_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

let mediaBunnyPromise: Promise<MediaBunnyBridge> | null = null;
const MEDIA_BUNNY_BRIDGE_SYMBOL = Symbol.for('dayline mediabunny bridge');

function loadMediaBunny(): Promise<MediaBunnyBridge> {
  const globalState = globalThis as Record<symbol, unknown>;
  const cached = globalState[MEDIA_BUNNY_BRIDGE_SYMBOL] as MediaBunnyBridge | undefined;
  if (cached) return Promise.resolve(cached);
  mediaBunnyPromise ??= import('./mediabunny-bridge').then(({ mediaBunnyBridge }) => {
    globalState[MEDIA_BUNNY_BRIDGE_SYMBOL] = mediaBunnyBridge;
    return mediaBunnyBridge;
  });
  return mediaBunnyPromise;
}

export interface CoverResult {
  url: string;
  attachment: MediaAttachment;
}

export interface MediaServiceOptions {
  imageMetadata?: { get(file: any): Promise<Array<{ key: string; value: string }> | null> };
  inputFactory?: (resourceUrl: string) => any | Promise<any>;
  capabilities?: PlatformCapabilities;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`media operation timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function fieldValue(fields: Array<{ key: string; value: string }> | null, key: string): string | undefined {
  return fields?.find((field) => field.key === key)?.value;
}

function parseGps(value: string | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((part) => Number.parseFloat(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : undefined;
}

function rawText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(value).replace(/\0+$/, '').trim() || undefined;
    } catch (_) {
      return undefined;
    }
  }
  return undefined;
}

function rawTagValue(raw: unknown, keys: string[]): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const key of keys) {
    const exact = entries.find(([name]) => name === key);
    if (exact) return exact[1];
  }
  const normalizedKeys = keys.map((key) => key.toLowerCase());
  const suffix = entries.find(([name]) => {
    const normalizedName = name.toLowerCase();
    return normalizedKeys.some((key) => normalizedName === key || normalizedName.endsWith(`.${key}`));
  });
  return suffix?.[1];
}

/** Parse an ISO 6709 location such as `+37.3318-122.0312+000.000/`. */
function parseIso6709(value: string | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\/+$/, '');
  if (!/^[+-]/.test(normalized)) return undefined;
  const secondSign = normalized.slice(1).search(/[+-]/);
  if (secondSign < 0) return undefined;
  const longitudeStart = secondSign + 1;
  const thirdSign = normalized.slice(longitudeStart + 1).search(/[+-]/);
  const longitudeEnd = thirdSign < 0 ? normalized.length : longitudeStart + 1 + thirdSign;
  const latitude = Number.parseFloat(normalized.slice(0, longitudeStart));
  const longitude = Number.parseFloat(normalized.slice(longitudeStart, longitudeEnd));
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? [latitude, longitude]
    : undefined;
}

function sanitizeArtwork(value: any): { data: Uint8Array; mimeType: string } | undefined {
  const mimeType = typeof value?.mimeType === 'string'
    ? value.mimeType.split(';', 1)[0].trim().toLowerCase()
    : '';
  const data = value?.data instanceof Uint8Array ? value.data : undefined;
  if (!data || data.byteLength <= 0 || data.byteLength > AUDIO_ARTWORK_MAX_BYTES) return undefined;
  if (!SAFE_ARTWORK_MIME_TYPES.has(mimeType)) return undefined;
  return { data: new Uint8Array(data), mimeType };
}

export function scaleVideoCoverDimensions(width: unknown, height: unknown, maxEdge = VIDEO_COVER_MAX_EDGE): { width: number; height: number } | null {
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

function canvasToObjectUrl(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 }).then((blob) => URL.createObjectURL(blob));
  }
  if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
    return new Promise<string>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('could not read video cover'));
          return;
        }
        try {
          resolve(URL.createObjectURL(blob));
        } catch (error) {
          reject(error);
        }
      }, 'image/jpeg', 0.8);
    });
  }
  return Promise.reject(new Error('canvas blob export is unavailable'));
}

function imageMetadataFromFields(fields: Array<{ key: string; value: string }> | null): MediaMetadata {
  const result: MediaMetadata = { kind: 'image' };
  const camera = fieldValue(fields, 'exif_camera');
  if (camera) {
    const parts = camera.trim().split(/\s+/);
    result.make = parts[0];
    result.model = parts.slice(1).join(' ') || parts[0];
  }
  result.lens = fieldValue(fields, 'exif_lens');
  result.capturedAt = fieldValue(fields, 'exif_date');
  result.aperture = fieldValue(fields, 'exif_aperture');
  result.shutter = fieldValue(fields, 'exif_shutter');
  result.iso = fieldValue(fields, 'exif_iso');
  result.focalLength = fieldValue(fields, 'exif_focal');
  result.software = fieldValue(fields, 'exif_software');
  const gps = parseGps(fieldValue(fields, 'exif_gps'));
  if (gps) { result.latitude = gps[0]; result.longitude = gps[1]; }
  return result;
}

export function formatMediaMetadataForDisplay(metadata: MediaMetadata | null): Array<{ key: string; value: string }> | null {
  if (!metadata) return null;
  const fields: Array<{ key: string; value: string }> = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    fields.push({ key, value: String(value) });
  };
  if (metadata.kind === 'video') {
    add('media_capturedAt', metadata.capturedAt);
    if (metadata.make || metadata.model) add('media_camera', [metadata.make, metadata.model].filter(Boolean).join(' '));
    add('media_software', metadata.software);
    if (metadata.width && metadata.height) add('media_resolution', `${metadata.width} × ${metadata.height}`);
    add('media_duration', metadata.duration !== undefined ? `${metadata.duration.toFixed(1)}s` : undefined);
    add('media_rotation', metadata.rotation !== undefined ? `${metadata.rotation}°` : undefined);
    add('media_codec', metadata.codec);
    add('media_frameRate', metadata.frameRate !== undefined ? `${metadata.frameRate.toFixed(2)} fps` : undefined);
    add('media_bitrate', metadata.bitrate !== undefined ? `${Math.round(metadata.bitrate / 1000)} kbps` : undefined);
    if (metadata.latitude !== undefined && metadata.longitude !== undefined) add('exif_gps', `${metadata.latitude.toFixed(4)}, ${metadata.longitude.toFixed(4)}`);
  } else if (metadata.kind === 'audio') {
    add('media_title', metadata.title);
    add('media_artist', metadata.artist);
    add('media_album', metadata.album);
    add('media_duration', metadata.duration !== undefined ? `${metadata.duration.toFixed(1)}s` : undefined);
    add('media_codec', metadata.codec);
    add('media_bitrate', metadata.bitrate !== undefined ? `${Math.round(metadata.bitrate / 1000)} kbps` : undefined);
    add('media_sampleRate', metadata.sampleRate !== undefined ? `${metadata.sampleRate} Hz` : undefined);
    add('media_channels', metadata.channels);
  } else {
    if (metadata.make || metadata.model) add('exif_camera', [metadata.make, metadata.model].filter(Boolean).join(' '));
    add('exif_lens', metadata.lens);
    add('exif_date', metadata.capturedAt);
    add('exif_aperture', metadata.aperture);
    add('exif_shutter', metadata.shutter);
    add('exif_iso', metadata.iso);
    add('exif_focal', metadata.focalLength);
    if (metadata.latitude !== undefined && metadata.longitude !== undefined) add('exif_gps', `${metadata.latitude.toFixed(4)}, ${metadata.longitude.toFixed(4)}`);
    add('exif_software', metadata.software);
  }
  return fields.length ? fields : null;
}

function toDateString(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function roundDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 1_000_000) / 1_000_000
    : undefined;
}

export class MediaService {
  private readonly app: any;
  private readonly heicCache: any;
  private readonly imageMetadata?: MediaServiceOptions['imageMetadata'];
  private readonly inputFactory: (resourceUrl: string) => any | Promise<any>;
  private readonly capabilities?: PlatformCapabilities;
  private readonly metadataCache = new Map<string, MediaMetadata | null>();
  private readonly metadataPending = new Map<string, Promise<MediaMetadata | null>>();
  private readonly coverCache = new Map<string, CoverResult | null>();
  private readonly coverPending = new Map<string, Promise<CoverResult | null>>();
  private disposed = false;

  constructor(app: any, heicCache?: any, options: MediaServiceOptions = {}) {
    this.app = app;
    this.heicCache = heicCache;
    this.imageMetadata = options.imageMetadata;
    this.capabilities = options.capabilities;
    this.inputFactory = options.inputFactory || ((resourceUrl) => this.createInput(resourceUrl));
  }

  classify(link: string): MediaKind {
    return classifyMediaLink(link).kind;
  }

  isImageLink(link: string): boolean {
    return classifyMediaLink(link).kind === 'image';
  }

  private resolvedPath(attachment: MediaAttachment): string {
    if (attachment.external) return '';
    const file = this.resolveFile(attachment);
    return typeof file?.path === 'string' ? file.path : '';
  }

  private key(attachment: MediaAttachment): string {
    return `${attachment.sourcePath}\u0000${attachment.normalizedLink}\u0000${this.resolvedPath(attachment)}`;
  }

  private touch<K, V>(map: Map<K, V>, key: K, value: V, limit: number, onEvict?: (value: V) => void): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) {
      const first = map.keys().next().value as K | undefined;
      if (first === undefined) break;
      const evicted = map.get(first);
      map.delete(first);
      if (evicted !== undefined) onEvict?.(evicted);
    }
  }

  private resolveFile(attachment: MediaAttachment): any | null {
    if (attachment.external) return null;
    const target = this.app.metadataCache?.getFirstLinkpathDest?.(attachment.normalizedLink, attachment.sourcePath);
    if (target) return target;
    return this.app.vault?.getAbstractFileByPath?.(attachment.normalizedLink) || null;
  }

  private async resourceUrl(attachment: MediaAttachment): Promise<string | null> {
    if (attachment.external) return attachment.kind === 'image' ? attachment.normalizedLink : null;
    const file = this.resolveFile(attachment);
    if (!file) return null;
    return this.app.vault?.getResourcePath?.(file) || null;
  }

  private async createInput(resourceUrl: string): Promise<any | null> {
    const mediaBunny = await loadMediaBunny();
    if (!mediaBunny) return null;
    const { Input, UrlSource, ADTS, QTFF, MP4, MATROSKA, MP3, WAVE, FLAC, OGG } = mediaBunny;
    return new Input({ source: new UrlSource(resourceUrl), formats: [QTFF, MP4, MATROSKA, MP3, WAVE, FLAC, OGG, ADTS] });
  }

  async getMetadata(attachment: MediaAttachment): Promise<MediaMetadata | null> {
    if (this.disposed || attachment.kind === 'unknown' || (attachment.external && attachment.kind !== 'image')) return null;
    if (attachment.kind !== 'image' && this.route('mediaMetadata') === 'disabled') return null;
    const key = this.key(attachment);
    const cached = this.metadataCache.get(key);
    if (cached !== undefined) return cached;
    const pending = this.metadataPending.get(key);
    if (pending) return pending;

    const promise = attachment.kind === 'image'
      ? this.readMetadata(attachment)
      : withTimeout(this.readMetadata(attachment), VIDEO_COVER_TIMEOUT_MS);
    this.metadataPending.set(key, promise);
    try {
      const value = await promise;
      if (this.metadataPending.get(key) === promise) this.touch(this.metadataCache, key, value, METADATA_CACHE_LIMIT);
      return value;
    } finally {
      if (this.metadataPending.get(key) === promise) this.metadataPending.delete(key);
    }
  }

  private async readMetadata(attachment: MediaAttachment): Promise<MediaMetadata | null> {
    if (attachment.external) return { kind: 'image' };
    const file = this.resolveFile(attachment);
    if (!file) return null;
    if (attachment.kind === 'image') {
      const fields = await this.imageMetadata?.get(file);
      return imageMetadataFromFields(fields || null);
    }

    const resource = await this.resourceUrl(attachment);
    if (!resource) return null;
    if (this.route('mediaMetadata') === 'fallback') {
      return attachment.kind === 'video' ? this.readNativeVideoMetadata(resource) : null;
    }
    let input: any;
    try {
      input = await this.inputFactory(resource);
    } catch (_) {
      input = null;
    }
    if (!input) return attachment.kind === 'video' ? this.readNativeVideoMetadata(resource) : null;
    try {
      const tags = await input.getMetadataTags?.() || {};
      const video = attachment.kind === 'video' ? await input.getPrimaryVideoTrack?.() : null;
      const audio = attachment.kind === 'audio' ? await input.getPrimaryAudioTrack?.() : null;
      const track = video || audio;
      if (!track) return { kind: attachment.kind };
      let duration = await track.getDurationFromMetadata?.();
      if (!(typeof duration === 'number' && Number.isFinite(duration))) {
        duration = await track.computeDuration?.();
      }
      const metadata: MediaMetadata = { kind: attachment.kind, duration: roundDuration(duration) };
      if (video) {
        const [width, height, rotation, codec] = await Promise.all([
          video.getDisplayWidth?.(), video.getDisplayHeight?.(), video.getRotation?.(), video.getCodec?.(),
        ]);
        metadata.width = Number.isFinite(width) ? width : undefined;
        metadata.height = Number.isFinite(height) ? height : undefined;
        metadata.rotation = Number.isFinite(rotation) ? rotation : undefined;
        metadata.codec = codec || undefined;
        try {
          const stats = await video.computePacketStats?.(30);
          metadata.frameRate = Number.isFinite(stats?.averagePacketRate) ? stats.averagePacketRate : undefined;
          metadata.bitrate = Number.isFinite(stats?.averageBitrate) ? stats.averageBitrate : undefined;
        } catch (_) { /* optional statistics */ }
      } else if (audio) {
        const [codec, bitrate, sampleRate, channels] = await Promise.all([
          audio.getCodec?.(), audio.getBitrate?.(), audio.getSampleRate?.(), audio.getNumberOfChannels?.(),
        ]);
        metadata.codec = codec || undefined;
        metadata.bitrate = Number.isFinite(bitrate) ? bitrate : undefined;
        metadata.sampleRate = Number.isFinite(sampleRate) ? sampleRate : undefined;
        metadata.channels = Number.isFinite(channels) ? channels : undefined;
      }
      metadata.title = typeof tags.title === 'string' ? tags.title : undefined;
      metadata.artist = typeof tags.artist === 'string' ? tags.artist : undefined;
      metadata.album = typeof tags.album === 'string' ? tags.album : undefined;

      // Mediabunny normalizes common tags, but iPhone MOV metadata such as
      // location, make, and model remains in the format-specific raw map.
      const raw = tags.raw;
      const make = rawText(rawTagValue(raw, ['com.apple.quicktime.make', 'make']));
      const model = rawText(rawTagValue(raw, ['com.apple.quicktime.model', 'model']));
      const software = rawText(rawTagValue(raw, ['com.apple.quicktime.software', 'software']));
      if (make) metadata.make = make;
      if (model) metadata.model = model;
      if (software) metadata.software = software;
      const location = parseIso6709(rawText(rawTagValue(raw, [
        'com.apple.quicktime.location.ISO6709',
        'location.ISO6709',
        'ISO6709',
      ])));
      if (location) {
        metadata.latitude = location[0];
        metadata.longitude = location[1];
      }
      const rawDate = rawText(rawTagValue(raw, [
        'com.apple.quicktime.creationdate',
        'creationdate',
      ]));
      metadata.capturedAt = toDateString(tags.date) || toDateString(rawDate);

      const images = Array.isArray(tags.images) ? tags.images : [];
      const artworkCandidates = [
        ...images.filter((image: any) => image?.kind === 'coverFront'),
        ...images.filter((image: any) => image?.kind !== 'coverFront'),
      ];
      for (const candidate of artworkCandidates) {
        const artwork = sanitizeArtwork(candidate);
        if (artwork) {
          metadata.artwork = artwork;
          break;
        }
      }
      return metadata;
    } catch (_) {
      return null;
    } finally {
      input.dispose?.();
    }
  }

  private async readNativeVideoMetadata(resource: string): Promise<MediaMetadata | null> {
    if (typeof document === 'undefined') return null;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = resource;
    let cleanup = () => undefined;
    try {
      await withTimeout(new Promise<void>((resolve, reject) => {
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('native video metadata unavailable')); };
        cleanup = () => {
          video.removeEventListener('loadedmetadata', loaded);
          video.removeEventListener('error', failed);
        };
        video.addEventListener('loadedmetadata', loaded, { once: true });
        video.addEventListener('error', failed, { once: true });
      }), VIDEO_COVER_TIMEOUT_MS);
      return {
        kind: 'video',
        duration: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      };
    } catch (_) {
      return null;
    } finally {
      cleanup();
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  async loadCover(attachment: MediaAttachment): Promise<CoverResult | null> {
    if (this.disposed || attachment.kind === 'unknown' || (attachment.external && attachment.kind !== 'image')) return null;
    if (attachment.kind !== 'image' && this.route('mediaCover') === 'disabled') return null;
    const key = this.key(attachment);
    const cached = this.coverCache.get(key);
    if (cached !== undefined) return cached;
    const pending = this.coverPending.get(key);
    if (pending) return pending;

    const promise = this.createCover(attachment);
    this.coverPending.set(key, promise);
    try {
      const result = await promise;
      if (this.coverPending.get(key) === promise) {
        this.touch(this.coverCache, key, result, MEDIA_CACHE_LIMIT, (evicted) => {
          this.revokeCoverResult(evicted);
        });
      } else {
        // Invalidation or disposal can clear the pending entry while an
        // asynchronous cover extraction is still running. Do not let a
        // resulting object URL escape without a matching revoke.
        this.revokeCoverResult(result);
        return null;
      }
      return result;
    } finally {
      if (this.coverPending.get(key) === promise) this.coverPending.delete(key);
    }
  }

  private async createCover(attachment: MediaAttachment): Promise<CoverResult | null> {
    if (attachment.kind === 'image') {
      if (attachment.external) return { url: attachment.normalizedLink, attachment };
      const file = this.resolveFile(attachment);
      if (!file) return null;
      if (attachment.extension && ['heic', 'heif'].includes(attachment.extension)) {
        if (this.route('heic') === 'disabled') return null;
        const result = await this.heicCache?.getThumbnail?.(file);
        return result?.dataUrl ? { url: result.dataUrl, attachment } : null;
      }
      const url = this.app.vault?.getResourcePath?.(file);
      return url ? { url, attachment } : null;
    }
    if (attachment.kind === 'audio') {
      if (this.route('audioArtwork') === 'disabled') return null;
      const metadata = await this.getMetadata(attachment);
      const artwork = sanitizeArtwork(metadata?.artwork);
      if (!artwork) return null;
      const artworkBuffer = artwork.data.buffer.slice(
        artwork.data.byteOffset,
        artwork.data.byteOffset + artwork.data.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([artworkBuffer], { type: artwork.mimeType });
      const url = URL.createObjectURL(blob);
      return { url, attachment };
    }
    if (attachment.kind === 'video') return this.createVideoCover(attachment);
    return null;
  }

  private async createVideoCover(attachment: MediaAttachment): Promise<CoverResult | null> {
    if (this.route('mediaCover') === 'disabled') return null;
    const resource = await this.resourceUrl(attachment);
    if (!resource) return null;
    return this.createNativeVideoCover(attachment, resource);
  }

  private async createNativeVideoCover(attachment: MediaAttachment, resource: string): Promise<CoverResult | null> {
    if (typeof document === 'undefined') return null;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = resource;
    let cleanupMetadata = () => undefined;
    let cleanupData = () => undefined;
    let cleanupSeek = () => undefined;
    try {
      await withTimeout(new Promise<void>((resolve, reject) => {
        const loaded = () => { cleanupMetadata(); resolve(); };
        const failed = () => { cleanupMetadata(); reject(new Error('native video metadata unavailable')); };
        cleanupMetadata = () => {
          video.removeEventListener('loadedmetadata', loaded);
          video.removeEventListener('error', failed);
        };
        video.addEventListener('loadedmetadata', loaded, { once: true });
        video.addEventListener('error', failed, { once: true });
      }), VIDEO_COVER_TIMEOUT_MS);
      const duration = Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;
      const timestamp = duration < 2 ? duration / 2 : 1;
      if (video.readyState < 2) {
        await withTimeout(new Promise<void>((resolve, reject) => {
          const loaded = () => { cleanupData(); resolve(); };
          const failed = () => { cleanupData(); reject(new Error('native video data unavailable')); };
          cleanupData = () => {
            video.removeEventListener('loadeddata', loaded);
            video.removeEventListener('error', failed);
          };
          video.addEventListener('loadeddata', loaded, { once: true });
          video.addEventListener('error', failed, { once: true });
        }), VIDEO_COVER_TIMEOUT_MS);
      }
      if (timestamp > 0 && Math.abs(video.currentTime - timestamp) > 0.01) {
        await withTimeout(new Promise<void>((resolve, reject) => {
          const seeked = () => { cleanupSeek(); resolve(); };
          const failed = () => { cleanupSeek(); reject(new Error('native video seek unavailable')); };
          cleanupSeek = () => {
            video.removeEventListener('seeked', seeked);
            video.removeEventListener('error', failed);
          };
          video.addEventListener('seeked', seeked, { once: true });
          video.addEventListener('error', failed, { once: true });
          video.currentTime = timestamp;
        }), VIDEO_COVER_TIMEOUT_MS);
      }
      const dimensions = scaleVideoCoverDimensions(video.videoWidth, video.videoHeight);
      if (!dimensions) return null;
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = await canvasToObjectUrl(canvas);
      return url ? { url, attachment } : null;
    } catch (_) {
      return null;
    } finally {
      cleanupMetadata();
      cleanupData();
      cleanupSeek();
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  async loadFirstCover(media: MediaAttachment[], explicit?: MediaAttachment): Promise<CoverResult | null> {
    const candidates = media.filter((item) => item?.kind !== 'unknown');
    const validExplicit = explicit?.kind === 'unknown' ? undefined : explicit;
    const ordered = validExplicit
      ? [validExplicit, ...candidates.filter((item) => this.key(item) !== this.key(validExplicit))]
      : candidates;
    for (const attachment of ordered) {
      try {
        const cover = await this.loadCover(attachment);
        if (cover) return cover;
      } catch (_) {
        // A broken/unsupported media item must not hide later attachments.
      }
    }
    return null;
  }

  invalidate(path?: string): void {
    if (!path) {
      this.clearMap(this.coverCache);
      this.metadataCache.clear();
      this.coverPending.clear();
      this.metadataPending.clear();
      return;
    }
    for (const [key, value] of this.coverCache) {
      if (this.cacheKeyMatchesPath(key, path)) {
        this.revokeCoverResult(value);
        this.coverCache.delete(key);
      }
    }
    for (const key of this.metadataCache.keys()) if (this.cacheKeyMatchesPath(key, path)) this.metadataCache.delete(key);
    for (const key of this.coverPending.keys()) if (this.cacheKeyMatchesPath(key, path)) this.coverPending.delete(key);
    for (const key of this.metadataPending.keys()) if (this.cacheKeyMatchesPath(key, path)) this.metadataPending.delete(key);
  }

  private cacheKeyMatchesPath(key: string, path: string): boolean {
    const parts = key.split('\u0000');
    if (parts.length < 2) return key === path;
    return parts[0] === path || parts[1] === path || parts[2] === path;
  }

  private revokeCoverResult(value: CoverResult | null | undefined): void {
    if (value?.url.startsWith('blob:')) URL.revokeObjectURL(value.url);
  }

  private route(feature: keyof PlatformCapabilities['routes']): CapabilityRoute {
    return this.capabilities?.routes?.[feature] || 'full';
  }

  private clearMap(map: Map<string, CoverResult | null>): void {
    for (const value of map.values()) this.revokeCoverResult(value);
    map.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.clearMap(this.coverCache);
    this.metadataCache.clear();
    this.coverPending.clear();
    this.metadataPending.clear();
  }
}

export { IMAGE_EXTENSIONS };
