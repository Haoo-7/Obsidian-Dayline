/**
 * Cross-device HEIC thumbnail cache.
 *
 * The desktop build converts HEIC through the bundled libheif decoder; mobile
 * deliberately never decodes (see `platform-capabilities.ts`). The converted
 * JPEG used to live only in the in-memory `HeicCache`, so a phone syncing the
 * same vault had no way to show the image at all. This store writes every
 * conversion into a configurable vault folder (`index.json` plus one JPEG per
 * source file), and any device can read a thumbnail back through the vault
 * adapter without decoding anything.
 */

export const DEFAULT_HEIC_THUMB_CACHE_DIR = '.dayline/thumbs';
export const HEIC_THUMB_CACHE_INDEX = 'index.json';
export const HEIC_THUMB_CACHE_MAX_ENTRIES = 4000;
export const HEIC_THUMB_CACHE_MAX_BYTES = 200 * 1024 * 1024;
export const HEIC_THUMB_INDEX_WRITE_DELAY_MS = 1500;
export const HEIC_THUMB_INDEX_CACHE_TTL_MS = 60 * 1000;
export const HEIC_THUMB_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
export const HEIC_THUMB_PARKED_URL_LIMIT = 256;

export interface HeicThumbEntry {
  /** Vault-relative source path; a stored hash collision degrades to a miss. */
  path: string;
  mtime: number;
  size: number;
  /** Thumbnail file name inside the cache directory. */
  file: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

interface HeicThumbIndex {
  version: number;
  entries: Record<string, HeicThumbEntry>;
}

export type HeicThumbReadResult = { url: string };

/**
 * Why the last `read()` did not return a thumbnail. Kept path-free so it can be
 * surfaced in the mobile diagnostics and pasted back from a phone.
 */
export interface HeicThumbMiss {
  reason: 'disabled' | 'index-missing' | 'index-empty' | 'no-entry' | 'size-mismatch' | 'file-missing' | 'no-url-api' | 'error';
  /** Source mtime minus the index mtime, when both are finite. */
  mtimeDeltaMs: number | null;
  entries: number | null;
}

/** Normalize a user-entered directory into the canonical vault-relative form. */
export function normalizeHeicThumbCacheDir(value: unknown): string {
  const raw = toPathString(value).trim().replace(/\\/g, '/');
  if (!raw) return '';
  // A vault-relative folder only: absolute paths, home shortcuts, and drive
  // letters are rejected rather than silently reinterpreted.
  if (raw.startsWith('/') || raw.startsWith('~') || /^[a-zA-Z]:/.test(raw)) return '';
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (!segments.length || segments.some((segment) => segment === '..')) return '';
  return segments.join('/');
}

export function isUnderCacheDir(path: unknown, dir: unknown): boolean {
  const normalized = normalizeHeicThumbCacheDir(dir);
  if (!normalized) return false;
  const candidate = toPathString(path).replace(/\\/g, '/');
  return candidate === normalized || candidate.startsWith(`${normalized}/`);
}

/**
 * FNV-1a 64-bit over the vault-relative path. The index entry records the real
 * path and lookups verify it, so a hash collision degrades to a cache miss
 * rather than showing the wrong image.
 */
export function sourceKey(path: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < path.length; index++) {
    hash ^= BigInt(path.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function emptyIndex(): HeicThumbIndex {
  return { version: 1, entries: {} };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Only strings are meaningful path input; anything else reads as "not set". */
function toPathString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Resolve the URL API through the host window (popout-safe; some hosts lack one). */
function resolveUrlApi(): typeof URL | null {
  const host: any = typeof window !== 'undefined' ? window : undefined;
  if (host?.URL) return host.URL as typeof URL;
  return typeof URL !== 'undefined' ? URL : null;
}

function dataUrlToBytes(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== 'string') return null;
  const separator = dataUrl.indexOf(';base64,');
  if (!dataUrl.startsWith('data:') || separator < 0) return null;
  try {
    const binary = atob(dataUrl.slice(separator + 8));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function isValidEntry(value: unknown): value is HeicThumbEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HeicThumbEntry>;
  return typeof entry.path === 'string' && entry.path.length > 0
    && typeof entry.file === 'string' && entry.file.length > 0
    && Number.isFinite(entry.mtime) && Number.isFinite(entry.size)
    && Number.isFinite(entry.bytes) && Number.isFinite(entry.createdAt);
}

export interface HeicThumbStoreOptions {
  getDir: () => string;
  /**
   * Whether this device may modify the shared folder. Only the converting
   * device (desktop) writes: a phone that "forgot" an entry while offline used
   * to delete the shared thumbnail and sync that deletion back upstream.
   */
  allowWrites?: () => boolean;
  now?: () => number;
}

export class HeicThumbStore {
  private readonly app: any;
  private readonly getDir: () => string;
  private readonly allowWrites: () => boolean;
  private readonly now: () => number;
  private index: HeicThumbIndex | null = null;
  private indexLoadedAt = 0;
  private indexLoading: Promise<HeicThumbIndex> | null = null;
  private dirty = false;
  private flushTimer: number | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private pruning = false;
  private lastPruneAt = 0;
  private readonly parkedUrls = new Set<string>();
  private lastEntryCount: number | null = null;
  private lastMiss: HeicThumbMiss | null = null;
  private indexFileMissing = false;

  constructor(app: any, options: HeicThumbStoreOptions) {
    this.app = app;
    this.getDir = options.getDir;
    this.allowWrites = options.allowWrites || (() => true);
    this.now = options.now || (() => Date.now());
  }

  /** Read-only devices never touch the shared folder. */
  private get canWrite(): boolean {
    try {
      return this.allowWrites() !== false;
    } catch {
      return false;
    }
  }

  get enabled(): boolean {
    return this.dir !== '';
  }

  /** Entry count of the shared index; used by mobile diagnostics. */
  get entryCount(): number | null {
    if (this.index) return Object.keys(this.index.entries).length;
    return this.lastEntryCount;
  }

  /** Why the last read missed; used by mobile diagnostics. Path-free. */
  get lastReadMiss(): HeicThumbMiss | null {
    return this.lastMiss;
  }

  private get dir(): string {
    return normalizeHeicThumbCacheDir(this.getDir());
  }

  private get adapter(): any {
    return this.app?.vault?.adapter;
  }

  private indexPath(): string {
    return `${this.dir}/${HEIC_THUMB_CACHE_INDEX}`;
  }

  private canUseAdapter(): boolean {
    const adapter = this.adapter;
    return Boolean(adapter && typeof adapter.readBinary === 'function' && typeof adapter.writeBinary === 'function');
  }

  /** Whether a fresh thumbnail for this source file is already stored. */
  async hasFresh(file: any): Promise<boolean> {
    if (!this.enabled || !file?.path) return false;
    try {
      const index = await this.ensureIndex();
      const entry = index.entries[sourceKey(file.path)];
      return Boolean(entry && this.entryMatches(entry, file));
    } catch {
      return false;
    }
  }

  /** Read a stored thumbnail as an object URL, or null on any miss. */
  async read(file: any): Promise<HeicThumbReadResult | null> {
    if (!this.enabled || !file?.path || !this.canUseAdapter()) {
      this.recordMiss('disabled', null);
      return null;
    }
    try {
      const index = await this.ensureIndex();
      const entry = index.entries[sourceKey(file.path)];
      if (!entry) {
        // An in-memory index with entries means the file is simply unknown;
        // otherwise distinguish "no index yet" from a valid but empty one.
        const reason = this.entryCount
          ? 'no-entry'
          : (this.indexFileMissing ? 'index-missing' : 'index-empty');
        this.recordMiss(reason, null);
        return null;
      }
      if (!this.entryMatches(entry, file)) {
        this.recordMiss('size-mismatch', this.mtimeDelta(entry, file), entry);
        return null;
      }
      const data = await this.adapter.readBinary(`${this.dir}/${entry.file}`);
      if (!data || !data.byteLength) {
        this.recordMiss('file-missing', this.mtimeDelta(entry, file), entry);
        return null;
      }
      const urlApi = resolveUrlApi();
      if (!urlApi || typeof urlApi.createObjectURL !== 'function') {
        this.recordMiss('no-url-api', this.mtimeDelta(entry, file), entry);
        return null;
      }
      const url = urlApi.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
      this.parkUrl(url);
      this.lastMiss = null;
      return { url };
    } catch (error) {
      console.warn('[Dayline] HEIC thumbnail cache read failed:', errorMessage(error));
      this.recordMiss('error', null);
      return null;
    }
  }

  /** Persist a converted thumbnail and register it in the index. */
  async write(file: any, thumb: { dataUrl?: string; width?: number; height?: number } | null | undefined): Promise<boolean> {
    if (!this.canWrite || !this.enabled || !file?.path || !this.canUseAdapter()) return false;
    const bytes = dataUrlToBytes(thumb?.dataUrl);
    if (!bytes || !bytes.byteLength) return false;
    try {
      const dir = this.dir;
      await this.ensureDir(dir);
      const key = sourceKey(file.path);
      const file_ = `${key}.jpg`;
      // Obsidian's adapter contract is ArrayBuffer, not a typed-array view.
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      await this.adapter.writeBinary(`${dir}/${file_}`, buffer);
      const index = await this.ensureIndex();
      index.entries[key] = {
        path: file.path,
        mtime: Number(file?.stat?.mtime) || 0,
        size: Number(file?.stat?.size) || 0,
        file: file_,
        width: Number(thumb?.width) || 0,
        height: Number(thumb?.height) || 0,
        bytes: bytes.byteLength,
        createdAt: this.now(),
      };
      this.dirty = true;
      this.scheduleIndexFlush();
      this.maybePrune();
      return true;
    } catch (error) {
      console.warn('[Dayline] HEIC thumbnail cache write failed:', errorMessage(error));
      return false;
    }
  }

  /** Drop the entry for a source file that was deleted or renamed away. */
  forget(sourcePath: string): void {
    if (!this.canWrite || !this.enabled || !sourcePath) return;
    void (async () => {
      const index = await this.ensureIndex();
      const key = sourceKey(sourcePath);
      const entry = index.entries[key];
      if (!entry || entry.path !== sourcePath) return;
      delete index.entries[key];
      this.dirty = true;
      this.scheduleIndexFlush();
      await this.removeThumb(entry);
    })().catch((error) => {
      console.warn('[Dayline] HEIC thumbnail cache forget failed:', errorMessage(error));
    });
  }

  /** Drop stale, orphaned, and over-capacity entries. Desktop runs this. */
  async prune(): Promise<void> {
    if (!this.canWrite || !this.enabled || !this.canUseAdapter() || this.pruning) return;
    this.pruning = true;
    try {
      // Deliberately NOT forced: the in-memory index is authoritative while a
      // debounced flush is pending. Re-reading a stale disk copy here used to
      // drop entries written moments ago and delete their files as orphans.
      const index = await this.ensureIndex();
      for (const [key, entry] of Object.entries(index.entries)) {
        const source = this.app?.vault?.getAbstractFileByPath?.(entry.path) || null;
        const stat = source?.stat;
        // Size-only staleness, matching `entryMatches`: a cross-device mtime
        // is not trustworthy enough to delete a still-usable thumbnail.
        const stale = !stat
          || (Number.isFinite(Number(stat.size)) && Number(stat.size) !== entry.size);
        if (stale) {
          delete index.entries[key];
          await this.removeThumb(entry);
        }
      }
      await this.removeOrphans(index);
      this.evictOverCapacity(index);
      this.dirty = true;
      await this.flush();
      this.lastPruneAt = this.now();
    } catch (error) {
      console.warn('[Dayline] HEIC thumbnail cache prune failed:', errorMessage(error));
    } finally {
      this.pruning = false;
    }
  }

  /** Write the index immediately instead of waiting for the debounce. */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.canWrite || !this.dirty || !this.index || !this.enabled || !this.canUseAdapter()) return;
    const index = this.index;
    this.dirty = false;
    const write = this.writeQueue.then(() => this.writeIndexFile(index));
    this.writeQueue = write.catch(() => undefined);
    return write.catch((error) => {
      console.warn('[Dayline] HEIC thumbnail index write failed:', error?.message || error);
    });
  }

  /** Clearing the index cache re-reads it; keep object URLs (nodes may use them). */
  reconfigure(): void {
    this.index = null;
    this.indexLoadedAt = 0;
    this.lastPruneAt = 0;
    this.dirty = false;
  }

  /** Called when an external writer changed `index.json` (sync arrival). */
  invalidateIndex(): void {
    if (this.dirty) return;
    this.index = null;
    this.indexLoadedAt = 0;
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
    for (const url of this.parkedUrls) this.revoke(url);
    this.parkedUrls.clear();
    this.index = null;
  }

  /**
   * Match by source size only. The mtime is recorded for diagnostics, but a
   * cross-device filesystem may re-report it in seconds, in local time, or with
   * a rounded value, and a thumbnail that is merely old is far more useful than
   * no thumbnail at all. A same-size edit of a photo is not a real scenario.
   */
  private entryMatches(entry: HeicThumbEntry, file: any): boolean {
    if (entry.path !== file.path) return false;
    const size = Number(file?.stat?.size);
    return Number.isFinite(size) && size === entry.size;
  }

  private mtimeDelta(entry: HeicThumbEntry, file: any): number | null {
    const mtime = Number(file?.stat?.mtime);
    return Number.isFinite(mtime) ? mtime - entry.mtime : null;
  }

  private recordMiss(
    reason: HeicThumbMiss['reason'],
    mtimeDeltaMs: number | null,
    entry?: HeicThumbEntry | null,
  ): void {
    this.lastMiss = {
      reason,
      mtimeDeltaMs: Number.isFinite(mtimeDeltaMs) ? Number(mtimeDeltaMs) : null,
      entries: entry ? this.entryCount : (this.index ? Object.keys(this.index.entries).length : this.lastEntryCount),
    };
  }

  private async ensureIndex(force = false): Promise<HeicThumbIndex> {
    // Locally written entries must survive the TTL: re-reading disk while a
    // debounced flush is still pending would drop them.
    if (!force && this.index && (this.dirty || this.now() - this.indexLoadedAt < HEIC_THUMB_INDEX_CACHE_TTL_MS)) {
      return this.index;
    }
    if (this.indexLoading) return this.indexLoading;
    const load = this.readIndexFile().then((index) => {
      this.index = index;
      this.indexLoadedAt = this.now();
      this.lastEntryCount = Object.keys(index.entries).length;
      return index;
    });
    this.indexLoading = load;
    try {
      return await load;
    } finally {
      if (this.indexLoading === load) this.indexLoading = null;
    }
  }

  private async readIndexFile(): Promise<HeicThumbIndex> {
    try {
      if (!(await this.adapter.exists(this.indexPath()))) {
        this.indexFileMissing = true;
        return emptyIndex();
      }
      const raw = await this.adapter.read(this.indexPath());
      const parsed = JSON.parse(raw);
      const entries = parsed && typeof parsed === 'object' ? parsed.entries : null;
      if (!entries || typeof entries !== 'object') {
        this.indexFileMissing = true;
        return emptyIndex();
      }
      const clean: Record<string, HeicThumbEntry> = {};
      for (const [key, value] of Object.entries(entries)) {
        if (isValidEntry(value)) clean[key] = value;
      }
      this.indexFileMissing = false;
      return { version: 1, entries: clean };
    } catch (error) {
      console.warn('[Dayline] HEIC thumbnail index read failed:', errorMessage(error));
      this.indexFileMissing = true;
      return emptyIndex();
    }
  }

  private async writeIndexFile(index: HeicThumbIndex): Promise<void> {
    const dir = this.dir;
    await this.ensureDir(dir);
    const path = this.indexPath();
    const content = JSON.stringify(index);
    const temp = `${path}.tmp`;
    try {
      await this.adapter.write(temp, content);
      await this.adapter.rename(temp, path);
    } catch {
      // Some adapters refuse to overwrite through `rename`; fall back to a
      // direct write. Readers treat a torn read as an empty index.
      await this.adapter.write(path, content);
    } finally {
      try {
        if (await this.adapter.exists(temp)) await this.adapter.remove(temp);
      } catch {
        // A leftover temp file never blocks the cache.
      }
    }
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
  }

  private scheduleIndexFlush(): void {
    if (!this.canWrite) return;
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, HEIC_THUMB_INDEX_WRITE_DELAY_MS);
  }

  private maybePrune(): void {
    if (!this.canWrite) return;
    if (this.now() - this.lastPruneAt < HEIC_THUMB_PRUNE_INTERVAL_MS) return;
    void this.prune();
  }

  private async removeThumb(entry: HeicThumbEntry): Promise<void> {
    try {
      const path = `${this.dir}/${entry.file}`;
      if (await this.adapter.exists(path)) await this.adapter.remove(path);
    } catch {
      // Orphan sweeps clean up files that could not be removed here.
    }
  }

  private async removeOrphans(index: HeicThumbIndex): Promise<void> {
    let listing: any;
    try {
      listing = await this.adapter.list(this.dir);
    } catch {
      return;
    }
    const files: unknown = Array.isArray(listing) ? listing : listing?.files;
    if (!Array.isArray(files)) return;
    const referenced = new Set(Object.values(index.entries).map((entry) => `${this.dir}/${entry.file}`));
    for (const filePath of files) {
      if (typeof filePath !== 'string' || !/\.jpe?g$/i.test(filePath)) continue;
      if (referenced.has(filePath)) continue;
      try {
        await this.adapter.remove(filePath);
      } catch {
        // A locked file stays until the next sweep.
      }
    }
  }

  private evictOverCapacity(index: HeicThumbIndex): void {
    const entries = Object.entries(index.entries);
    let totalBytes = entries.reduce((sum, [, entry]) => sum + (Number(entry.bytes) || 0), 0);
    if (entries.length <= HEIC_THUMB_CACHE_MAX_ENTRIES && totalBytes <= HEIC_THUMB_CACHE_MAX_BYTES) return;
    const oldestFirst = entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [key, entry] of oldestFirst) {
      const count = Object.keys(index.entries).length;
      if (count <= HEIC_THUMB_CACHE_MAX_ENTRIES && totalBytes <= HEIC_THUMB_CACHE_MAX_BYTES) break;
      delete index.entries[key];
      totalBytes -= Number(entry.bytes) || 0;
      void this.removeThumb(entry);
    }
  }

  private parkUrl(url: string): void {
    this.parkedUrls.add(url);
    while (this.parkedUrls.size > HEIC_THUMB_PARKED_URL_LIMIT) {
      const oldest = this.parkedUrls.values().next().value;
      if (oldest === undefined) break;
      this.parkedUrls.delete(oldest);
      this.revoke(oldest);
    }
  }

  private revoke(url: string): void {
    try {
      resolveUrlApi()?.revokeObjectURL?.(url);
    } catch {
      // Revocation is best effort; a failed call must not break teardown.
    }
  }
}
