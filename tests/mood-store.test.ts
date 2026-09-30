import { describe, expect, it } from 'vitest';
import { MoodMetadataReadOnlyError, MoodStore, MOOD_SCHEMA_VERSION, migrateMoodMetadata } from '../src/mood-store';
import type { MoodMetadata, MoodRecord } from '../src/types';

const primary = 'Calendar/journal-metadata.json';
const record = (score: MoodRecord['score']): MoodRecord => ({ score, labels: [], recordedAt: '2026-09-07', updatedAt: '2026-09-07' });
const metadata = (entries: Record<string, MoodRecord>, tombstones: Record<string, { deletedAt: string }> = {}): MoodMetadata => ({ schemaVersion: MOOD_SCHEMA_VERSION, entries, orphans: {}, customLabels: [], tombstones });

function makeApp() {
  const files = new Map<string, string>();
  const adapter = {
    async exists(path: string) { return files.has(path); },
    async read(path: string) { if (!files.has(path)) throw new Error('missing'); return files.get(path)!; },
    async write(path: string, value: string) { files.set(path, value); },
    async rename(from: string, to: string) { files.set(to, files.get(from)!); files.delete(from); },
    async remove(path: string) { files.delete(path); },
    async mkdir() {},
  };
  const markdown = new Map<string, any>();
  const frontmatterStore = new Map<string, Record<string, unknown>>();
  return {
    files,
    frontmatter: frontmatterStore,
    markdown,
    app: {
      vault: {
        adapter,
        getAbstractFileByPath(path: string) { return markdown.get(path); },
      },
      fileManager: {
        calls: 0,
        async processFrontMatter(file: any, callback: (value: Record<string, unknown>) => void) {
          this.calls++;
          const value = frontmatterStore.get(file.path) || {};
          callback(value);
          frontmatterStore.set(file.path, value);
        },
      },
    },
  };
}

function note(path: string, ctime?: number) {
  return { path, ...(ctime === undefined ? {} : { stat: { ctime } }) };
}

describe('mood metadata store', () => {
  it('writes JSON without frontmatter by default and keeps rename/delete recoverable', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    const record = await store.set('Calendar/Daily/2026-07-18.md', 1, ['calm']);
    expect(record.score).toBe(1);
    expect(fixture.app.fileManager.calls).toBe(0);
    expect(JSON.parse(fixture.files.get('Calendar/journal-metadata.json')!).entries['Calendar/Daily/2026-07-18.md'].labels).toEqual(['calm']);
    await store.rename('Calendar/Daily/2026-07-18.md', 'Calendar/Daily/renamed.md');
    await store.removeToOrphan('Calendar/Daily/renamed.md');
    expect(store.get('Calendar/Daily/renamed.md')).toBeUndefined();
    expect(store.getOrphans()?.['Calendar/Daily/renamed.md']).toBeTruthy();
    await store.restoreOrphan('Calendar/Daily/renamed.md', 'Calendar/Daily/restored.md');
    expect(store.get('Calendar/Daily/restored.md')?.score).toBe(1);
    expect(fixture.files.has('Calendar/journal-metadata.json.bak')).toBe(true);
  });

  it('mirrors only on explicit opt-in', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    await store.set('note.md', -2, ['anxious'], { mirrorMoodToFrontmatter: true });
    expect(fixture.app.fileManager.calls).toBe(1);
  });

  it('repairs a corrupt primary file without losing the good backup', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    await store.set('note.md', 1, ['calm']);
    await store.set('note.md', 2, ['joyful']);
    const expectedBackup = JSON.parse(fixture.files.get('Calendar/journal-metadata.json.bak')!);
    fixture.files.set('Calendar/journal-metadata.json', '{broken');

    const recovered = new MoodStore(fixture.app);
    await recovered.load();
    expect(recovered.get('note.md')?.score).toBe(1);
    expect(JSON.parse(fixture.files.get('Calendar/journal-metadata.json')!).entries['note.md'].score).toBe(1);

    await recovered.set('other.md', -1, ['sad']);
    expect(JSON.parse(fixture.files.get('Calendar/journal-metadata.json.bak')!).entries['note.md']).toEqual(expectedBackup.entries['note.md']);
  });

  it('rejects malformed restores instead of silently dropping records', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    await store.set('note.md', 1, ['calm']);
    const before = fixture.files.get('Calendar/journal-metadata.json');

    await expect(store.restoreFrom(JSON.stringify({
      schemaVersion: 1,
      entries: { 'note.md': { score: 9, labels: [], recordedAt: 'now', updatedAt: 'now' } },
      orphans: {},
    }))).rejects.toThrow('Invalid mood metadata');
    expect(fixture.files.get('Calendar/journal-metadata.json')).toBe(before);
  });

  it('reports malformed orphan records and missing journal files', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => path === 'note.md' ? { path } : undefined;
    const store = new MoodStore(fixture.app);
    await store.set('note.md', 1, ['calm']);
    fixture.files.set('Calendar/journal-metadata.json', JSON.stringify({
      schemaVersion: 1,
      entries: {
        'note.md': { score: 1, labels: ['calm'], recordedAt: 'now', updatedAt: 'now' },
        'missing.md': { score: 0, labels: [], recordedAt: 'now', updatedAt: 'now' },
      },
      orphans: { 'orphan.md': { record: { score: 1 }, orphanedAt: 'now' } },
    }));
    const result = await store.checkIntegrity();
    expect(result.valid).toBe(false);
    expect(result.invalidOrphans).toEqual(['orphan.md']);
    expect(result.missingFiles).toEqual(['missing.md']);
  });

  it('does not overwrite unrecoverable metadata on the next write', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    fixture.files.set('Calendar/journal-metadata.json', '{broken');
    const store = new MoodStore(fixture.app);
    await expect(store.set('note.md', 1, ['calm'])).rejects.toThrow();
    expect(fixture.files.get('Calendar/journal-metadata.json')).toBe('{broken');
  });

  it('marks an unreadable backup as an integrity issue', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    await store.set('note.md', 1, ['calm']);
    fixture.files.set('Calendar/journal-metadata.json.bak', '{broken');
    const result = await store.checkIntegrity();
    expect(result.valid).toBe(false);
    expect(result.backupAvailable).toBe(false);
    expect(result.invalidMetadata).toContain('backup');
  });
});

describe('mood metadata record-level validation', () => {
  it('skips one invalid record instead of rolling the whole file back to an older backup', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    await store.set('a.md', 1, ['calm']);
    await store.set('b.md', 2, ['joyful']);
    const backup = JSON.parse(fixture.files.get(`${primary}.bak`)!);
    expect(Object.keys(backup.entries)).toEqual(['a.md']);

    const damaged = JSON.parse(fixture.files.get(primary)!);
    damaged.entries['bad.md'] = { score: '1', labels: [], recordedAt: 'now', updatedAt: 'now' };
    fixture.files.set(primary, JSON.stringify(damaged, null, 2));

    const reloaded = new MoodStore(fixture.app);
    await reloaded.load();

    expect(reloaded.get('a.md')?.score).toBe(1);
    expect(reloaded.get('b.md')?.score).toBe(2);
    expect(reloaded.get('bad.md')).toBeUndefined();
    expect(reloaded.getWarnings().join(' ')).toContain('bad.md');
    expect(JSON.parse(fixture.files.get(primary)!).entries['b.md'].score).toBe(2);
  });

  it('keeps a future-schema primary byte-identical and refuses every write', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const future = JSON.stringify({ ...metadata({ 'a.md': record(1) }), schemaVersion: 3 }, null, 2);
    fixture.files.set(primary, future);
    fixture.files.set(`${primary}.bak`, JSON.stringify(metadata({ 'old.md': record(1) })));

    const store = new MoodStore(fixture.app);
    await store.load();

    expect(store.readOnly).toBe(true);
    expect(store.get('a.md')?.score).toBe(1);
    expect(store.getWarnings().join(' ')).toContain('schema 3');
    await expect(store.set('b.md', 0, [])).rejects.toBeInstanceOf(MoodMetadataReadOnlyError);
    await expect(store.importFrontmatter(['a.md'], { getFileCache: () => ({ frontmatter: { mood: 1 } }) })).rejects.toBeInstanceOf(MoodMetadataReadOnlyError);
    expect(fixture.files.get(primary)).toBe(future);
    expect(migrateMoodMetadata(JSON.parse(future)).warnings.join(' ')).toContain('Unknown mood metadata schema 3');
  });

  it('saves a .corrupt copy of the damaged primary before repairing from the backup', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    await store.set('note.md', 1, ['calm']);
    await store.set('note.md', 2, ['joyful']);
    const damaged = '{broken';
    fixture.files.set(primary, damaged);

    const recovered = new MoodStore(fixture.app);
    await recovered.load();

    const corruptPaths = Array.from(fixture.files.keys()).filter((path) => path.startsWith(`${primary}.corrupt-`));
    expect(corruptPaths).toHaveLength(1);
    expect(fixture.files.get(corruptPaths[0])).toBe(damaged);
    expect(recovered.get('note.md')?.score).toBe(1);
  });
});

describe('mood score validation', () => {
  it.each([Number.NaN, 3, 1.5])('rejects the invalid score %s before touching the file', async (score) => {
    const fixture = makeApp();
    const store = new MoodStore(fixture.app);
    await expect(store.set('c.md', score, [])).rejects.toThrow(/invalid mood score/i);
    expect(fixture.files.has(primary)).toBe(false);
  });

  it('normalizes a numeric string score instead of writing a string', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);

    const saved = await store.set('c.md', '2', []);

    expect(saved.score).toBe(2);
    expect(JSON.parse(fixture.files.get(primary)!).entries['c.md'].score).toBe(2);
    const reloaded = new MoodStore(fixture.app);
    await reloaded.load();
    expect(reloaded.get('c.md')?.score).toBe(2);
  });

  it('rejects an invalid fallback score during deletion instead of persisting it', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);

    await expect(store.deleteRecord('note.md', true, { score: 1.5 as unknown as 1, labels: [], recordedAt: 'now', updatedAt: 'now' }))
      .rejects.toThrow(/invalid mood score/i);
    expect(fixture.files.has(primary)).toBe(false);
    expect(store.getForIndex('note.md')).toBeUndefined();
  });
});

describe('mood tombstone lifecycle', () => {
  it('clears a tombstone whose deletion predates the recreated file', async () => {
    const fixture = makeApp();
    fixture.markdown.set('note.md', note('note.md', Date.parse('2026-09-10T00:00:00.000Z')));
    fixture.files.set(primary, JSON.stringify(metadata({}, { 'note.md': { deletedAt: '2026-09-01T00:00:00.000Z' } })));
    const store = new MoodStore(fixture.app);
    await store.load();
    expect(store.getForIndex('note.md')).toBeNull();

    await expect(store.clearStaleTombstone('note.md')).resolves.toBe(true);

    expect(store.getForIndex('note.md')).toBeUndefined();
    expect(JSON.parse(fixture.files.get(primary)!).tombstones['note.md']).toBeUndefined();
  });

  it('keeps a tombstone that is newer than the recreated file', async () => {
    const fixture = makeApp();
    fixture.markdown.set('note.md', note('note.md', Date.parse('2026-09-01T00:00:00.000Z')));
    fixture.files.set(primary, JSON.stringify(metadata({}, { 'note.md': { deletedAt: '2026-09-20T00:00:00.000Z' } })));
    const store = new MoodStore(fixture.app);
    await store.load();

    await expect(store.clearStaleTombstone('note.md')).resolves.toBe(false);
    await expect(store.clearStaleTombstone('note.md', Date.parse('2026-09-10T00:00:00.000Z'))).resolves.toBe(false);

    expect(store.getForIndex('note.md')).toBeNull();
  });

  it('sweeps tombstones older than the TTL and prunes on demand', async () => {
    const fixture = makeApp();
    const old = '2020-01-01T00:00:00.000Z';
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    fixture.files.set(primary, JSON.stringify(metadata({}, { 'old.md': { deletedAt: old }, 'yesterday.md': { deletedAt: yesterday } })));
    const store = new MoodStore(fixture.app);
    await store.load();

    expect(JSON.parse(fixture.files.get(primary)!).tombstones).toEqual({ 'yesterday.md': { deletedAt: yesterday } });
    await expect(store.pruneTombstones(24 * 60 * 60 * 1000)).resolves.toBe(1);
    expect(JSON.parse(fixture.files.get(primary)!).tombstones).toEqual({});
  });

  it('imports frontmatter for a path whose tombstone predates the recreated file', async () => {
    const fixture = makeApp();
    fixture.markdown.set('note.md', note('note.md', Date.parse('2026-09-10T00:00:00.000Z')));
    fixture.files.set(primary, JSON.stringify(metadata({}, { 'note.md': { deletedAt: '2026-09-01T00:00:00.000Z' } })));
    const metadataCache = { getFileCache: () => ({ frontmatter: { mood: 2, mood_labels: ['joyful'] } }) };
    const store = new MoodStore(fixture.app);

    await expect(store.importFrontmatter(['note.md'], metadataCache)).resolves.toBe(1);

    expect(store.get('note.md')?.score).toBe(2);
    expect(JSON.parse(fixture.files.get(primary)!).tombstones['note.md']).toBeUndefined();
  });

  it('still skips frontmatter for a path with a fresh tombstone', async () => {
    const fixture = makeApp();
    fixture.markdown.set('note.md', note('note.md', Date.now() - 10 * 24 * 60 * 60 * 1000));
    fixture.files.set(primary, JSON.stringify(metadata({}, { 'note.md': { deletedAt: new Date().toISOString() } })));
    const metadataCache = { getFileCache: () => ({ frontmatter: { mood: 2 } }) };
    const store = new MoodStore(fixture.app);

    await expect(store.importFrontmatter(['note.md'], metadataCache)).resolves.toBe(0);
    expect(store.get('note.md')).toBeUndefined();
  });
});

describe('mood frontmatter deletion', () => {
  it('does not rewrite note frontmatter when deleting a stored mood with mirroring disabled', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    fixture.frontmatter.set('note.md', { mood: 1, mood_labels: ['calm'], title: 'keep' });
    const store = new MoodStore(fixture.app);
    await store.set('note.md', 1, ['calm']);
    expect(fixture.app.fileManager.calls).toBe(0);

    await store.deleteRecord('note.md');

    expect(fixture.app.fileManager.calls).toBe(0);
    expect(fixture.frontmatter.get('note.md')).toEqual({ mood: 1, mood_labels: ['calm'], title: 'keep' });
  });

  it('removes mood keys when the deleted record came from frontmatter', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    fixture.frontmatter.set('note.md', { mood: 0, mood_labels: ['calm'], mood_note: 'note', title: 'keep' });
    const store = new MoodStore(fixture.app);
    const visible = { score: 0 as const, labels: ['calm'], note: 'note', recordedAt: 'now', updatedAt: 'now' };

    await store.deleteRecord('note.md', true, visible);

    expect(fixture.frontmatter.get('note.md')).toEqual({ title: 'keep' });
  });

  it('removes mood keys when frontmatter mirroring is enabled', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    fixture.frontmatter.set('note.md', { mood: 1, mood_labels: ['calm'], title: 'keep' });
    const store = new MoodStore(fixture.app);
    await store.set('note.md', 1, ['calm']);
    store.configure({ mirrorMoodToFrontmatter: true });

    await store.deleteRecord('note.md');

    expect(fixture.frontmatter.get('note.md')).toEqual({ title: 'keep' });
  });
});
