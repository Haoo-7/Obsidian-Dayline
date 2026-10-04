import { describe, expect, it } from 'vitest';
import { MoodStore } from '../src/mood-store';
import type { MoodMetadata, MoodRecord } from '../src/types';

const primary = 'Calendar/journal-metadata.json';
const record = (score: MoodRecord['score']): MoodRecord => ({ score, labels: [], recordedAt: '2026-09-07', updatedAt: '2026-09-07' });
const metadata = (entries: Record<string, MoodRecord>): MoodMetadata => ({ schemaVersion: 2, entries, orphans: {}, customLabels: [] });

function fixture() {
  const files = new Map<string, string>();
  let failWrites = false;
  let failFrontmatter = false;
  const markdown = new Set<string>();
  const adapter = {
    async exists(path: string) { return files.has(path); },
    async read(path: string) { if (!files.has(path)) throw new Error('missing'); return files.get(path)!; },
    async write(path: string, value: string) { if (failWrites) throw new Error('disk failure'); files.set(path, value); },
    async copy(from: string, to: string) {
      if (!files.has(from)) throw new Error('missing copy source');
      if (failWrites) throw new Error('disk failure');
      files.set(to, files.get(from)!);
    },
    async rename(from: string, to: string) {
      if (!files.has(from)) throw new Error('missing rename source');
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    async remove(path: string) { files.delete(path); },
    async mkdir() {},
  };
  const store = new MoodStore({
    vault: { adapter, getAbstractFileByPath: (path: string) => markdown.has(path) ? { path } : undefined },
    fileManager: {
      async processFrontMatter(_file: unknown, callback: (frontmatter: Record<string, unknown>) => void) {
        if (failFrontmatter) throw new Error('frontmatter failure');
        callback({});
      },
    },
  });
  return {
    store,
    files,
    adapter,
    markdown,
    failWrites: (fail: boolean) => { failWrites = fail; },
    failFrontmatter: (fail: boolean) => { failFrontmatter = fail; },
  };
}

describe('mood store reliability', () => {
  it('does not create metadata when deleting a note with no mood', async () => {
    const { store, files } = fixture();
    await store.removeToOrphan('unrelated.md');
    expect(files.has(primary)).toBe(false);
  });

  it('keeps the previous primary and does not publish when the commit write fails', async () => {
    const { store, files, adapter } = fixture();
    await store.set('a.md', 1, []);
    const write = adapter.write;
    adapter.write = async (path, value) => {
      if (path === primary) throw new Error('commit failure');
      return write(path, value);
    };
    await expect(store.set('a.md', -2, [])).rejects.toThrow('commit failure');
    expect(store.get('a.md')?.score).toBe(1);
    expect(JSON.parse(files.get(primary)!).entries['a.md'].score).toBe(1);
    expect(files.has(`${primary}.tmp`)).toBe(false);
    // The staged backup still holds the previous content as the recovery point.
    expect(JSON.parse(files.get(`${primary}.bak`)!).entries['a.md'].score).toBe(1);
  });

  it('replaces the primary in place so file sync never observes it missing', async () => {
    const { store, files, adapter } = fixture();
    await store.set('a.md', 1, []);
    let primaryExistedAtCommit = false;
    const write = adapter.write;
    adapter.write = async (path, value) => {
      if (path === primary) primaryExistedAtCommit = files.has(primary);
      return write(path, value);
    };
    await store.set('b.md', 0, []);
    expect(primaryExistedAtCommit).toBe(true);
    expect(files.has(`${primary}.tmp`)).toBe(false);
    expect(JSON.parse(files.get(`${primary}.bak`)!).entries['a.md'].score).toBe(1);
  });

  it('does not replace a valid primary with an older backup when migration cannot write', async () => {
    const { store, files, failWrites } = fixture();
    const current = { ...metadata({ 'a.md': record(2) }), schemaVersion: 1 };
    files.set(primary, JSON.stringify(current));
    files.set(`${primary}.bak`, JSON.stringify(metadata({ 'a.md': record(1) })));
    failWrites(true);
    await store.load();
    expect(store.get('a.md')?.score).toBe(2);
    failWrites(false);
    await store.set('b.md', 0, []);
    expect(JSON.parse(files.get(primary)!).entries['a.md'].score).toBe(2);
  });

  it('loads a valid staged file when no valid primary or backup remains', async () => {
    const { store, files } = fixture();
    files.set(`${primary}.bak`, '{broken');
    files.set(`${primary}.tmp`, JSON.stringify(metadata({ 'a.md': record(2) })));
    await store.load();
    expect(store.get('a.md')?.score).toBe(2);
  });

  it('does not turn unreadable recovery files into a writable empty store', async () => {
    const { store, files } = fixture();
    files.set(`${primary}.bak`, '{broken');
    await expect(store.set('a.md', 0, [])).rejects.toThrow();
    expect(files.has(primary)).toBe(false);
    expect(files.get(`${primary}.bak`)).toBe('{broken');
  });

  it('does not publish or commit an in-flight write after a path change during staging', async () => {
    const { store, files, adapter } = fixture();
    await store.set('a.md', 1, []);
    const write = adapter.write;
    adapter.write = async (path, value) => {
      await write(path, value);
      if (path === `${primary}.tmp`) store.configure({ moodMetadataPath: 'Other/moods.json' });
    };
    await expect(store.set('a.md', 2, [])).rejects.toThrow(/path.*changed/i);
    await store.load();
    expect(JSON.parse(files.get(primary)!).entries['a.md'].score).toBe(1);
    expect(files.has('Other/moods.json')).toBe(false);
    expect(store.getAll()).toEqual({});
  });

  it('serializes an explicit load between queued edits', async () => {
    const { store } = fixture();
    await store.set('a.md', 1, []);
    await Promise.all([store.set('a.md', 2, []), store.load(), store.set('b.md', 0, [])]);
    expect(store.get('a.md')?.score).toBe(2);
    expect(store.get('b.md')?.score).toBe(0);
  });

  it('recovers a missing primary from the backup before saving new records', async () => {
    const { store, files } = fixture();
    files.set(`${primary}.bak`, JSON.stringify(metadata({ 'old.md': record(2) })));
    await store.load();
    expect(store.get('old.md')?.score).toBe(2);
    await store.set('new.md', 0, []);
    expect(JSON.parse(files.get(primary)!).entries['old.md'].score).toBe(2);
  });

  it('does not publish or later persist a failed edit', async () => {
    const { store, files, failWrites } = fixture();
    await store.set('a.md', 1, []);
    failWrites(true);
    await expect(store.set('a.md', -2, [])).rejects.toThrow('disk failure');
    expect(store.get('a.md')?.score).toBe(1);
    failWrites(false);
    await store.set('b.md', 0, []);
    expect(JSON.parse(files.get(primary)!).entries['a.md'].score).toBe(1);
  });

  it('preserves externally added records and unknown fields on a local edit', async () => {
    const { store, files } = fixture();
    await store.set('local.md', 1, []);
    const remote = JSON.parse(files.get(primary)!);
    remote.entries['remote.md'] = { ...record(2), futureRecordField: { source: 'sync' } };
    remote.futureMetadata = { source: 'sync' };
    files.set(primary, JSON.stringify(remote));
    await store.set('local.md', 0, []);
    const saved = JSON.parse(files.get(primary)!);
    expect(saved.entries['remote.md']).toEqual(remote.entries['remote.md']);
    expect(saved.futureMetadata).toEqual(remote.futureMetadata);
  });

  it('re-seeds records that a stale synced copy lost instead of overwriting them', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    await store.set('b.md', 2, []);
    const stale = JSON.parse(files.get(primary)!);
    delete stale.entries['a.md'];
    files.set(primary, JSON.stringify(stale));

    await store.set('c.md', 0, []);

    const saved = JSON.parse(files.get(primary)!);
    expect(saved.entries['a.md'].score).toBe(1);
    expect(saved.entries['b.md'].score).toBe(2);
    expect(saved.entries['c.md'].score).toBe(0);
  });

  it('respects an external tombstone instead of re-seeding a deleted record', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    await store.set('b.md', 2, []);
    const deleted = JSON.parse(files.get(primary)!);
    delete deleted.entries['a.md'];
    deleted.tombstones = { 'a.md': { deletedAt: '2026-09-08T00:00:00.000Z' } };
    files.set(primary, JSON.stringify(deleted));

    await store.set('c.md', 0, []);

    const saved = JSON.parse(files.get(primary)!);
    expect(saved.entries['a.md']).toBeUndefined();
    expect(saved.tombstones['a.md']).toEqual({ deletedAt: '2026-09-08T00:00:00.000Z' });
    expect(saved.entries['c.md'].score).toBe(0);
  });

  it('restores records a stale synced copy dropped when reloading from disk', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    await store.set('b.md', 2, []);
    const stale = JSON.parse(files.get(primary)!);
    delete stale.entries['a.md'];
    files.set(primary, JSON.stringify(stale));

    await store.reloadFromDisk();

    expect(store.get('a.md')?.score).toBe(1);
    expect(store.get('b.md')?.score).toBe(2);
    const healed = JSON.parse(files.get(primary)!);
    expect(healed.entries['a.md'].score).toBe(1);
    expect(healed.entries['b.md'].score).toBe(2);
  });

  it('does not resurrect a record the synced copy deleted with a tombstone', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    const deleted = JSON.parse(files.get(primary)!);
    delete deleted.entries['a.md'];
    deleted.tombstones = { 'a.md': { deletedAt: new Date().toISOString() } };
    files.set(primary, JSON.stringify(deleted));

    await store.reloadFromDisk();

    expect(store.get('a.md')).toBeUndefined();
    expect(store.getForIndex('a.md')).toBeNull();
    expect(JSON.parse(files.get(primary)!).entries['a.md']).toBeUndefined();
  });

  it.each(['removeToOrphan', 'deleteRecord'] as const)('keeps the latest queued edit when %s follows it', async (method) => {
    const { store } = fixture();
    await store.set('a.md', 1, []);
    await Promise.all([store.set('a.md', 2, []), store[method]('a.md')]);
    expect(store.getOrphans()['a.md'].record.score).toBe(2);
  });

  it('refreshes the merge base and notifies listeners when a staged write conflicts', async () => {
    const { store, files, adapter } = fixture();
    await store.set('a.md', 1, []);
    const before = store.getMetadata();
    const published: Array<[string, number | undefined]> = [];
    store.subscribe((path, value) => published.push([path, value?.score]));
    const write = adapter.write;
    adapter.write = async (path, value) => {
      await write(path, value);
      if (path === `${primary}.tmp`) files.set(primary, JSON.stringify(metadata({ 'remote.md': record(2) })));
    };
    await expect(store.set('a.md', -2, [])).rejects.toThrow(/conflict/i);

    expect(published).toEqual([['a.md', undefined], ['remote.md', 2]]);
    expect(store.getMetadata().entries).toEqual({ 'remote.md': record(2) });
    expect(store.getMetadata()).not.toEqual(before);
    expect(Object.keys(JSON.parse(files.get(primary)!).entries)).toEqual(['remote.md']);
    expect(files.has(`${primary}.tmp`)).toBe(false);

    adapter.write = write;
    await expect(store.set('a.md', -1, [])).resolves.toMatchObject({ score: -1 });
    expect(Object.keys(JSON.parse(files.get(primary)!).entries).sort()).toEqual(['a.md', 'remote.md']);
  });

  it('lets an explicit set win over an externally changed record with an older update', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    const remote = JSON.parse(files.get(primary)!);
    remote.entries['a.md'].score = 2;
    files.set(primary, JSON.stringify(remote));

    await expect(store.set('a.md', -2, [])).resolves.toMatchObject({ score: -2 });

    expect(JSON.parse(files.get(primary)!).entries['a.md'].score).toBe(-2);
    expect(store.get('a.md')?.score).toBe(-2);
  });

  it('keeps a strictly newer external record when set loses the last-write-wins race', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    const remote = JSON.parse(files.get(primary)!);
    remote.entries['a.md'].score = 2;
    remote.entries['a.md'].updatedAt = '2999-01-01T00:00:00.000Z';
    files.set(primary, JSON.stringify(remote));

    await expect(store.set('a.md', -2, [])).resolves.toMatchObject({ score: 2 });

    expect(store.get('a.md')?.score).toBe(2);
    expect(JSON.parse(files.get(primary)!).entries['a.md'].score).toBe(2);
  });

  it('drops a tombstone added externally for the key an explicit set overwrites', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    const remote = JSON.parse(files.get(primary)!);
    remote.tombstones = { 'a.md': { deletedAt: '2026-09-01T00:00:00.000Z' } };
    files.set(primary, JSON.stringify(remote));

    await store.set('a.md', 2, []);

    expect(store.getForIndex('a.md')?.score).toBe(2);
    expect(JSON.parse(files.get(primary)!).tombstones['a.md']).toBeUndefined();
  });

  it('reloads externally changed metadata and notifies listeners', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    const remote = JSON.parse(files.get(primary)!);
    remote.entries['a.md'].score = 2;
    remote.entries['external.md'] = record(-1);
    files.set(primary, JSON.stringify(remote));
    const published: string[] = [];
    store.subscribe((path) => published.push(path));

    await store.reloadFromDisk();

    expect(store.get('a.md')?.score).toBe(2);
    expect(store.get('external.md')?.score).toBe(-1);
    expect(published.sort()).toEqual(['a.md', 'external.md']);
  });

  it('checks competing restore destinations inside the queue', async () => {
    const { store, markdown } = fixture();
    markdown.add('target.md');
    await store.set('a.md', 1, []);
    await store.set('b.md', 2, []);
    await store.removeToOrphan('a.md');
    await store.removeToOrphan('b.md');
    const results = await Promise.allSettled([store.restoreOrphan('a.md', 'target.md'), store.restoreOrphan('b.md', 'target.md')]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(store.get('target.md')?.score).toBe(1);
    expect(store.getOrphans()['b.md'].record.score).toBe(2);
  });

  it('renames a record created by an earlier queued write', async () => {
    const { store } = fixture();
    await store.load();
    await Promise.all([store.set('a.md', 1, []), store.rename('a.md', 'b.md')]);
    expect(store.get('a.md')).toBeUndefined();
    expect(store.get('b.md')?.score).toBe(1);
  });

  it('keeps an orphan recoverable when its restore target Markdown does not exist', async () => {
    const { store } = fixture();
    await store.set('deleted.md', 1, []);
    await store.removeToOrphan('deleted.md');

    await expect(store.restoreOrphan('deleted.md', 'missing.md')).rejects.toThrow(/target Markdown does not exist.*missing\.md/i);

    expect(store.get('missing.md')).toBeUndefined();
    expect(store.getOrphans()['deleted.md'].record.score).toBe(1);
  });

  it('publishes canonical saves when frontmatter mirroring fails and can retry the mirror', async () => {
    const { store, markdown, failFrontmatter } = fixture();
    markdown.add('note.md');
    failFrontmatter(true);
    const published: Array<number | undefined> = [];
    const failures: string[] = [];
    store.subscribe((_path, value) => published.push(value?.score));
    store.subscribeMirrorFailures((failure) => failures.push(failure?.message ?? 'resolved'));

    await expect(store.set('note.md', 2, [], { mirrorMoodToFrontmatter: true })).resolves.toMatchObject({ score: 2 });

    expect(store.get('note.md')?.score).toBe(2);
    expect(published).toEqual([2]);
    expect(failures).toEqual(['frontmatter failure']);
    failFrontmatter(false);
    await expect(store.retryMirror('note.md')).resolves.toBe(true);
    expect(failures).toEqual(['frontmatter failure', 'resolved']);
  });

  it('persists deletion tombstones before mirror cleanup and merges external tombstones', async () => {
    const { store, files, markdown, failFrontmatter } = fixture();
    markdown.add('note.md');
    await store.set('note.md', 1, []);
    store.configure({ mirrorMoodToFrontmatter: true });
    failFrontmatter(true);

    await expect(store.deleteRecord('note.md')).resolves.toMatchObject({ score: 1 });

    expect(store.getForIndex('note.md')).toBeNull();
    expect(store.getMirrorFailure('note.md')).toMatchObject({ path: 'note.md', operation: 'delete' });
    const afterDelete = JSON.parse(files.get(primary)!);
    expect(afterDelete.tombstones['note.md'].deletedAt).toEqual(expect.any(String));
    const remote = structuredClone(afterDelete);
    remote.tombstones['remote-deleted.md'] = { deletedAt: '2026-09-07T12:00:00.000Z', source: 'sync' };
    files.set(primary, JSON.stringify(remote));
    await store.set('other.md', 0, []);
    const saved = JSON.parse(files.get(primary)!);
    expect(saved.tombstones['remote-deleted.md']).toEqual({ deletedAt: '2026-09-07T12:00:00.000Z', source: 'sync' });

    const reloaded = new MoodStore((store as any).app);
    await reloaded.load();
    expect(reloaded.getForIndex('note.md')).toBeNull();
    expect(reloaded.getForIndex('unknown.md')).toBeUndefined();

    failFrontmatter(false);
    await expect(store.retryMirror('note.md')).resolves.toBe(true);
    expect(store.getMirrorFailure('note.md')).toBeUndefined();
  });

  it('allows backup restoration after a transient write failure', async () => {
    const { store, failWrites } = fixture();
    await store.set('a.md', 1, []);
    await store.set('a.md', 2, []);
    failWrites(true);
    await expect(store.set('a.md', 0, [])).rejects.toThrow('disk failure');
    failWrites(false);
    await expect(store.restoreBackup()).resolves.toEqual({ entries: 1, orphans: 0 });
    expect(store.get('a.md')?.score).toBe(1);
  });

  it('serializes a whole-store restore before a subsequent edit', async () => {
    const { store } = fixture();
    await store.set('a.md', 1, []);
    await Promise.all([store.restoreFrom(metadata({ 'restored.md': record(2) })), store.set('b.md', 0, [])]);
    expect(Object.keys(store.getAll()).sort()).toEqual(['b.md', 'restored.md']);
  });

  it('does not redirect queued writes when the metadata path changes', async () => {
    const { store, files } = fixture();
    await store.set('a.md', 1, []);
    const pending = store.set('a.md', 2, []);
    store.configure({ moodMetadataPath: 'Other/moods.json' });
    const loaded = store.load();
    await expect(pending).rejects.toThrow(/path.*changed/i);
    await loaded;
    expect(files.has('Other/moods.json')).toBe(false);
    expect(store.getAll()).toEqual({});
  });
});
