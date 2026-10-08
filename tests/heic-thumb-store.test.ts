// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HEIC_THUMB_CACHE_DIR,
  HEIC_THUMB_CACHE_INDEX,
  HEIC_THUMB_CACHE_MAX_BYTES,
  HEIC_THUMB_CACHE_MAX_ENTRIES,
  HEIC_THUMB_PRUNE_INTERVAL_MS,
  HeicThumbStore,
  isUnderCacheDir,
  normalizeHeicThumbCacheDir,
  sourceKey,
} from '../src/heic-thumb-store';

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01];
const JPEG_DATA_URL = `data:image/jpeg;base64,${btoa(String.fromCharCode(...JPEG_BYTES))}`;

let objectUrlSeq = 0;

// jsdom ships no object-URL implementation; the store resolves it through the
// host window exactly like Obsidian does, so the test host provides one.
beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as any).createObjectURL = () => `blob:thumb-${++objectUrlSeq}`;
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as any).revokeObjectURL = () => undefined;
  }
});

function createHarness({ dir = DEFAULT_HEIC_THUMB_CACHE_DIR, writeAllowed = true }: { dir?: string; writeAllowed?: boolean } = {}) {
  const files = new Map<string, string | ArrayBuffer>();
  const folders = new Set<string>();
  const sources = new Map<string, any>();
  const adapter = {
    async exists(path: string) { return files.has(path) || folders.has(path); },
    async read(path: string) {
      const value = files.get(path);
      if (typeof value !== 'string') throw new Error(`not a text file: ${path}`);
      return value;
    },
    async write(path: string, content: string) { files.set(path, content); },
    async readBinary(path: string) {
      const value = files.get(path);
      return value instanceof ArrayBuffer ? value : null;
    },
    async writeBinary(path: string, data: ArrayBuffer) { files.set(path, data); },
    async mkdir(path: string) { folders.add(path); },
    async remove(path: string) { files.delete(path); folders.delete(path); },
    async rename(from: string, to: string) {
      const value = files.get(from);
      if (value === undefined) throw new Error(`missing file: ${from}`);
      files.set(to, value);
      files.delete(from);
    },
    async list(path: string) {
      const children = (collection: Iterable<string>) => [...collection]
        .filter((item) => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes('/'));
      return { files: children(files.keys()), folders: children(folders) };
    },
  };
  const app = {
    vault: {
      adapter,
      getAbstractFileByPath: (path: string) => sources.get(path) || null,
    },
  };
  let clock = 0;
  const setting = { value: dir };
  const store = new HeicThumbStore(app, {
    getDir: () => setting.value,
    allowWrites: () => writeAllowed,
    now: () => clock,
  });
  return {
    store,
    adapter,
    files,
    folders,
    sources,
    setting,
    tick(ms: number) { clock += ms; },
    /** Register a readable source file and return the TFile-like object. */
    source(path: string, { mtime = 1000, size = 42 }: { mtime?: number; size?: number } = {}) {
      const file = { path, extension: 'heic', stat: { mtime, size } };
      sources.set(path, file);
      return file;
    },
    seedIndex(dirPath: string, entries: Record<string, unknown>) {
      files.set(`${dirPath}/${HEIC_THUMB_CACHE_INDEX}`, JSON.stringify({ version: 1, entries }));
    },
    readIndex(dirPath: string) {
      const raw = files.get(`${dirPath}/${HEIC_THUMB_CACHE_INDEX}`);
      return typeof raw === 'string' ? JSON.parse(raw) : null;
    },
  };
}

describe('HEIC thumbnail cache directory handling', () => {
  it('normalizes a user-entered folder into the canonical vault-relative form', () => {
    expect(normalizeHeicThumbCacheDir(' .dayline\\thumbs/ ')).toBe('.dayline/thumbs');
    expect(normalizeHeicThumbCacheDir('./Photos//HEIC/')).toBe('Photos/HEIC');
    expect(normalizeHeicThumbCacheDir('Photos/./HEIC')).toBe('Photos/HEIC');
    expect(normalizeHeicThumbCacheDir('')).toBe('');
    expect(normalizeHeicThumbCacheDir('   ')).toBe('');
    expect(normalizeHeicThumbCacheDir('.')).toBe('');
  });

  it('rejects absolute or escaping folders instead of reinterpreting them', () => {
    expect(normalizeHeicThumbCacheDir('/absolute')).toBe('');
    expect(normalizeHeicThumbCacheDir('~/photos')).toBe('');
    expect(normalizeHeicThumbCacheDir('C:\\photos')).toBe('');
    expect(normalizeHeicThumbCacheDir('Photos/../../etc')).toBe('');
    expect(normalizeHeicThumbCacheDir(42)).toBe('');
  });

  it('recognizes files below the configured cache folder only', () => {
    expect(isUnderCacheDir('.dayline/thumbs/ab.jpg', '.dayline/thumbs')).toBe(true);
    expect(isUnderCacheDir('.dayline/thumbs', '.dayline/thumbs')).toBe(true);
    expect(isUnderCacheDir('.dayline/thumbs/ab.jpg', './.dayline/thumbs/')).toBe(true);
    expect(isUnderCacheDir('.dayline/other/ab.jpg', '.dayline/thumbs')).toBe(false);
    expect(isUnderCacheDir('x.dayline/thumbs/ab.jpg', '.dayline/thumbs')).toBe(false);
    expect(isUnderCacheDir('.dayline/thumbs/ab.jpg', '')).toBe(false);
  });

  it('derives a stable key from the vault-relative path', () => {
    expect(sourceKey('Photos/a.heic')).toBe(sourceKey('Photos/a.heic'));
    expect(sourceKey('Photos/a.heic')).not.toBe(sourceKey('Photos/b.heic'));
    expect(sourceKey('Photos/a.heic')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('shared HEIC thumbnail store', () => {
  it('writes the converted JPEG and serves it back with index metadata', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic', { mtime: 1111, size: 2222 });

    await expect(harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 900, height: 675 })).resolves.toBe(true);
    await harness.store.flush();

    const key = sourceKey('Photos/IMG_1.heic');
    const bytes = harness.files.get(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${key}.jpg`);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(bytes as ArrayBuffer)]).toEqual(JPEG_BYTES);

    const index = harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR);
    expect(index.entries[key]).toMatchObject({
      path: 'Photos/IMG_1.heic', mtime: 1111, size: 2222, width: 900, height: 675, bytes: JPEG_BYTES.length,
    });

    const read = await harness.store.read(file);
    expect(read?.url).toMatch(/^blob:/);
  });

  it('stays a no-op while the folder setting is empty', async () => {
    const harness = createHarness({ dir: '' });
    const file = harness.source('Photos/IMG_1.heic');

    await expect(harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 })).resolves.toBe(false);
    await expect(harness.store.read(file)).resolves.toBeNull();
    expect(harness.files.size).toBe(0);
  });

  it('matches by source size and ignores an untrustworthy cross-device mtime', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic', { mtime: 1000, size: 10 });
    await harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.flush();

    // A phone filesystem may re-report the mtime in seconds, in local time, or
    // rounded; an old thumbnail still beats no thumbnail at all.
    await expect(harness.store.read({ ...file, stat: { mtime: 1000 + 8 * 60 * 60 * 1000, size: 10 } })).resolves.not.toBeNull();
    await expect(harness.store.read({ ...file, stat: { mtime: 1000 + 2, size: 10 } })).resolves.not.toBeNull();
    // A different source size, or a path that has no entry, is still a miss.
    await expect(harness.store.read({ ...file, stat: { mtime: 1000, size: 11 } })).resolves.toBeNull();
    await expect(harness.store.read({ path: 'Photos/IMG_2.heic', stat: { mtime: 1000, size: 10 } })).resolves.toBeNull();
  });

  it('reports why the last read missed without leaking any path', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic', { mtime: 1000, size: 10 });

    // The shared index has not arrived on this device yet.
    await harness.store.read(file);
    expect(harness.store.lastReadMiss).toMatchObject({ reason: 'index-missing' });

    await harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.flush();
    await expect(harness.store.read(file)).resolves.not.toBeNull();
    expect(harness.store.lastReadMiss).toBeNull();

    await harness.store.read({ path: 'Photos/other.heic', stat: { mtime: 1000, size: 10 } });
    expect(harness.store.lastReadMiss).toMatchObject({ reason: 'no-entry', entries: 1 });

    await harness.store.read({ ...file, stat: { mtime: 1000, size: 11 } });
    expect(harness.store.lastReadMiss).toMatchObject({ reason: 'size-mismatch', mtimeDeltaMs: 0, entries: 1 });

    // The thumbnail file itself disappeared (deleted by hand, partial sync).
    const key = sourceKey('Photos/IMG_1.heic');
    harness.files.delete(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${key}.jpg`);
    await harness.store.read(file);
    expect(harness.store.lastReadMiss).toMatchObject({ reason: 'file-missing' });

    harness.setting.value = '';
    await harness.store.read(file);
    expect(harness.store.lastReadMiss).toMatchObject({ reason: 'disabled' });
  });

  it('recovers from a corrupt index instead of failing every read', async () => {
    const harness = createHarness();
    harness.files.set(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${HEIC_THUMB_CACHE_INDEX}`, '{ not json');
    const file = harness.source('Photos/IMG_1.heic');

    await expect(harness.store.read(file)).resolves.toBeNull();

    await expect(harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 })).resolves.toBe(true);
    await harness.store.flush();
    expect(Object.keys(harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries)).toHaveLength(1);
  });

  it('debounces the index flush and keeps every entry written in between', async () => {
    const harness = createHarness();
    const first = harness.source('Photos/IMG_1.heic', { mtime: 1, size: 1 });
    const second = harness.source('Photos/IMG_2.heic', { mtime: 1, size: 1 });

    await harness.store.write(first, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.write(second, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    expect(harness.files.has(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${HEIC_THUMB_CACHE_INDEX}`)).toBe(false);

    await harness.store.flush();
    expect(Object.keys(harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries)).toHaveLength(2);
  });

  it('reports freshness only for a stored up-to-date entry', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic', { mtime: 5, size: 6 });

    await expect(harness.store.hasFresh(file)).resolves.toBe(false);
    await harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await expect(harness.store.hasFresh(file)).resolves.toBe(true);
    await expect(harness.store.hasFresh({ ...file, stat: { mtime: 5, size: 7 } })).resolves.toBe(false);
  });

  it('forget retires the entry and its thumbnail file', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic');
    await harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.flush();
    const key = sourceKey('Photos/IMG_1.heic');

    harness.store.forget('Photos/IMG_1.heic');
    await vi.waitFor(() => expect(harness.files.has(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${key}.jpg`)).toBe(false));
    await harness.store.flush();

    expect(harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries[key]).toBeUndefined();
    expect(harness.files.has(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${key}.jpg`)).toBe(false);
  });

  it('never modifies the shared folder on a read-only device', async () => {
    const harness = createHarness({ writeAllowed: false });
    const file = harness.source('Photos/IMG_1.heic');
    const key = sourceKey('Photos/IMG_1.heic');
    harness.seedIndex(DEFAULT_HEIC_THUMB_CACHE_DIR, {
      [key]: {
        path: 'Photos/IMG_1.heic', mtime: 1000, size: 42, file: `${key}.jpg`,
        width: 1, height: 1, bytes: 6, createdAt: 0,
      },
    });
    harness.files.set(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${key}.jpg`, new ArrayBuffer(6));

    // A read-only device still reads the shared cache…
    await expect(harness.store.read(file)).resolves.toMatchObject({ url: expect.stringMatching(/^blob:/) });

    // …but never writes, forgets, prunes, or flushes it. A phone that deleted
    // an entry used to sync that deletion back and destroy the desktop copy.
    await expect(harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 })).resolves.toBe(false);
    harness.store.forget('Photos/IMG_1.heic');
    await harness.store.prune();
    await harness.store.flush();

    expect(harness.files.has(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${key}.jpg`)).toBe(true);
    expect(harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries[key]).toMatchObject({ path: 'Photos/IMG_1.heic' });
  });

  it('keeps a thumbnail written in the same session, before the index flush', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic');
    // Make the first-write prune due, the way it is at the start of a session.
    harness.tick(HEIC_THUMB_PRUNE_INTERVAL_MS + 1);

    // The write itself triggers the throttled prune. That prune must see the
    // in-memory index, not a stale disk copy: otherwise the fresh entry is
    // dropped and its file deleted as an orphan.
    await harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await vi.waitFor(() => expect(harness.store.entryCount).toBe(1));
    await harness.store.flush();

    const key = sourceKey('Photos/IMG_1.heic');
    expect(harness.files.has(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${key}.jpg`)).toBe(true);
    expect(harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries[key]).toMatchObject({ path: 'Photos/IMG_1.heic' });
  });

  it('prune removes stale entries and orphaned thumbnails', async () => {
    const harness = createHarness();
    const fresh = harness.source('Photos/fresh.heic', { mtime: 10, size: 1 });
    const stale = harness.source('Photos/stale.heic', { mtime: 10, size: 1 });
    const mtimeOnly = harness.source('Photos/mtime-only.heic', { mtime: 10, size: 1 });
    await harness.store.write(fresh, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.write(stale, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.write(mtimeOnly, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.flush();

    // The file content changed (size differs) after the thumbnail was written.
    stale.stat = { mtime: 10, size: 2 };
    // An mtime-only difference is not a reason to drop a usable thumbnail.
    mtimeOnly.stat = { mtime: 10 + 24 * 60 * 60 * 1000, size: 1 };
    harness.sources.delete('Photos/removed.heic');
    const removedKey = sourceKey('Photos/removed.heic');
    harness.files.set(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${removedKey}.jpg`, new ArrayBuffer(2));
    const orphanPath = `${DEFAULT_HEIC_THUMB_CACHE_DIR}/orphan.jpg`;
    harness.files.set(orphanPath, new ArrayBuffer(2));

    await harness.store.prune();

    const entries = harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries;
    expect(Object.keys(entries)).toEqual([sourceKey('Photos/fresh.heic'), sourceKey('Photos/mtime-only.heic')]);
    expect(harness.files.has(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${sourceKey('Photos/stale.heic')}.jpg`)).toBe(false);
    expect(harness.files.has(orphanPath)).toBe(false);
  });

  it('prune evicts the oldest thumbnails past the entry cap', async () => {
    const harness = createHarness();
    const entries: Record<string, unknown> = {};
    for (let index = 0; index < HEIC_THUMB_CACHE_MAX_ENTRIES + 2; index++) {
      const path = `Photos/IMG_${index}.heic`;
      harness.source(path, { mtime: 1, size: 1 });
      entries[sourceKey(path)] = {
        path, mtime: 1, size: 1, file: `${sourceKey(path)}.jpg`,
        width: 1, height: 1, bytes: 1, createdAt: index,
      };
    }
    harness.seedIndex(DEFAULT_HEIC_THUMB_CACHE_DIR, entries);

    await harness.store.prune();

    const kept = harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries;
    expect(Object.keys(kept)).toHaveLength(HEIC_THUMB_CACHE_MAX_ENTRIES);
    expect(kept[sourceKey('Photos/IMG_0.heic')]).toBeUndefined();
    expect(kept[sourceKey('Photos/IMG_1.heic')]).toBeUndefined();
    expect(kept[sourceKey(`Photos/IMG_${HEIC_THUMB_CACHE_MAX_ENTRIES + 1}.heic`)]).toBeDefined();
  });

  it('prune evicts by total bytes as well', async () => {
    const harness = createHarness();
    const big = Math.floor(HEIC_THUMB_CACHE_MAX_BYTES * 0.75);
    const entries: Record<string, unknown> = {};
    for (const [index, path] of ['Photos/old.heic', 'Photos/new.heic'].entries()) {
      harness.source(path, { mtime: 1, size: 1 });
      entries[sourceKey(path)] = {
        path, mtime: 1, size: 1, file: `${sourceKey(path)}.jpg`,
        width: 1, height: 1, bytes: big, createdAt: index,
      };
    }
    harness.seedIndex(DEFAULT_HEIC_THUMB_CACHE_DIR, entries);

    await harness.store.prune();

    const kept = harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries;
    expect(Object.keys(kept)).toEqual([sourceKey('Photos/new.heic')]);
  });

  it('contains write failures without throwing', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic');
    const writeBinary = vi.spyOn(harness.adapter, 'writeBinary').mockRejectedValue(new Error('disk full'));

    await expect(harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 })).resolves.toBe(false);
    writeBinary.mockRestore();

    // A malformed data URL is rejected before any file is touched.
    await expect(harness.store.write(file, { dataUrl: 'not-a-data-url', width: 1, height: 1 })).resolves.toBe(false);
  });

  it('falls back to a direct index write when rename cannot replace the file', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic');
    vi.spyOn(harness.adapter, 'rename').mockRejectedValue(new Error('rename not supported'));

    await harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.flush();

    expect(Object.keys(harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries)).toHaveLength(1);
    expect(harness.files.has(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${HEIC_THUMB_CACHE_INDEX}.tmp`)).toBe(false);
  });

  it('revokes parked object URLs when the store is disposed', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic');
    await harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });

    const first = await harness.store.read(file);
    const second = await harness.store.read(file);
    expect(first?.url).not.toBe(second?.url);

    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    harness.store.dispose();
    expect(revoke).toHaveBeenCalledWith(first?.url);
    expect(revoke).toHaveBeenCalledWith(second?.url);
    revoke.mockRestore();
  });

  it('re-reads the index after an external writer changed it', async () => {
    const harness = createHarness();
    const file = harness.source('Photos/IMG_1.heic');
    await harness.store.write(file, { dataUrl: JPEG_DATA_URL, width: 1, height: 1 });
    await harness.store.flush();

    const otherPath = 'Photos/IMG_2.heic';
    harness.source(otherPath, { mtime: 2, size: 2 });
    const entries = harness.readIndex(DEFAULT_HEIC_THUMB_CACHE_DIR).entries;
    entries[sourceKey(otherPath)] = {
      path: otherPath, mtime: 2, size: 2, file: `${sourceKey(otherPath)}.jpg`,
      width: 1, height: 1, bytes: 1, createdAt: 1,
    };
    harness.seedIndex(DEFAULT_HEIC_THUMB_CACHE_DIR, entries);
    harness.files.set(`${DEFAULT_HEIC_THUMB_CACHE_DIR}/${sourceKey(otherPath)}.jpg`, new ArrayBuffer(2));

    harness.store.invalidateIndex();
    await expect(harness.store.read(harness.sources.get(otherPath))).resolves.toMatchObject({ url: expect.stringMatching(/^blob:/) });
  });
});
