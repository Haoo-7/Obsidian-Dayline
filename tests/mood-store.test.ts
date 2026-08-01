import { describe, expect, it } from 'vitest';
import { MoodStore } from '../src/mood-store';

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
  return {
    files,
    app: {
      vault: {
        adapter,
        getAbstractFileByPath(path: string) { return markdown.get(path); },
      },
      fileManager: {
        calls: 0,
        async processFrontMatter(_file: any, callback: (frontmatter: Record<string, unknown>) => void) {
          this.calls++;
          const frontmatter: Record<string, unknown> = {};
          callback(frontmatter);
        },
      },
    },
  };
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
