import { describe, expect, it } from 'vitest';
import { MoodStore, migrateMoodMetadata, MOOD_SCHEMA_VERSION } from '../src/mood-store';
import { moodExportObject, serializeMoodCsv, serializeMoodJson } from '../src/mood-export';
import { buildMoodReports, buildMoodPeriodReport, summarizeMoodLabelTrends } from '../src/mood-reports';
import type { MoodMetadata } from '../src/types';

function makeApp() {
  const files = new Map<string, string>();
  const markdown = new Map<string, any>();
  const frontmatter = new Map<string, Record<string, unknown>>();
  const adapter = {
    async exists(path: string) { return files.has(path); },
    async read(path: string) { if (!files.has(path)) throw new Error('missing'); return files.get(path)!; },
    async write(path: string, value: string) { files.set(path, value); },
    async rename(from: string, to: string) { files.set(to, files.get(from)!); files.delete(from); },
    async remove(path: string) { files.delete(path); },
    async mkdir() {},
  };
  return {
    files,
    frontmatter,
    app: {
      vault: { adapter, getAbstractFileByPath(path: string) { return markdown.get(path) || { path }; } },
      fileManager: {
        async processFrontMatter(file: any, callback: (value: Record<string, unknown>) => void) {
          const value = frontmatter.get(file.path) || {};
          callback(value);
          frontmatter.set(file.path, value);
        },
      },
    },
  };
}

describe('Goal 4B mood schema and recovery', () => {
  it('migrates v1 deterministically while preserving unknown fields and labels', () => {
    const legacy = {
      schemaVersion: 1,
      futureMetadata: { keep: true },
      entries: {
        'Daily\\2026-08-01.md': {
          score: 2,
          labels: ['calm', 'my custom'],
          recordedAt: '2026-08-01T09:00:00.000Z',
          updatedAt: '2026-08-01T09:30:00.000Z',
          futureRecordField: { keep: 'yes' },
        },
      },
      orphans: {},
      customLabels: [' calm ', '', 'my custom', 'my custom'],
    };
    const first = migrateMoodMetadata(legacy);
    const second = migrateMoodMetadata(first.metadata);
    expect(first.migrated).toBe(true);
    expect(first.metadata.schemaVersion).toBe(MOOD_SCHEMA_VERSION);
    expect(first.metadata.entries['Daily/2026-08-01.md'].futureRecordField).toEqual({ keep: 'yes' });
    expect(first.metadata.futureMetadata).toEqual({ keep: true });
    expect(first.metadata.customLabels).toEqual(['my custom']);
    expect(second.metadata).toEqual(first.metadata);
  });

  it('keeps forward-compatible record fields when an existing record is edited', async () => {
    const fixture = makeApp();
    fixture.files.set('Calendar/journal-metadata.json', JSON.stringify({
      schemaVersion: 1,
      entries: { 'Daily/2026-08-04.md': { score: 0, labels: ['calm'], recordedAt: 'a', updatedAt: 'b', future: { keep: true } } },
      orphans: {},
    }));
    const store = new MoodStore(fixture.app);
    await store.set('Daily/2026-08-04.md', 1, ['focused']);
    expect(store.get('Daily/2026-08-04.md')?.future).toEqual({ keep: true });
  });

  it('loads an existing record before using a frontmatter fallback during deletion', async () => {
    const fixture = makeApp();
    const path = 'Daily/2026-08-04.md';
    fixture.files.set('Calendar/journal-metadata.json', JSON.stringify({
      schemaVersion: 2,
      entries: {
        [path]: {
          score: 2,
          labels: ['calm'],
          note: 'stored note',
          recordedAt: '2026-08-04T09:00:00.000Z',
          updatedAt: '2026-08-04T10:00:00.000Z',
        },
      },
      orphans: {},
      customLabels: [],
    }));
    const store = new MoodStore(fixture.app);
    const fallback = {
      score: -1 as const,
      labels: ['visible fallback'],
      recordedAt: '2026-08-04T11:00:00.000Z',
      updatedAt: '2026-08-04T11:00:00.000Z',
    };

    await expect(store.deleteRecord(path, true, fallback)).resolves.toMatchObject({
      score: 2,
      labels: ['calm'],
      note: 'stored note',
    });
    const storedOrphan = store.getOrphans()[path]?.record;
    if (!storedOrphan) throw new Error('expected stored orphan');
    expect(storedOrphan).toMatchObject({ score: 2, note: 'stored note' });
  });

  it('persists normalized v2 custom labels while preserving metadata extensions', async () => {
    const fixture = makeApp();
    fixture.files.set('Calendar/journal-metadata.json', JSON.stringify({
      schemaVersion: 2,
      futureMetadata: { keep: true },
      entries: {
        'Daily/2026-08-04.md': {
          score: 1,
          labels: ['calm', 'custom'],
          recordedAt: '2026-08-04T09:00:00.000Z',
          updatedAt: '2026-08-04T10:00:00.000Z',
          futureRecordField: 'keep',
        },
      },
      orphans: {},
      customLabels: [' custom ', 'calm', 'custom', ''],
    }));
    const store = new MoodStore(fixture.app);

    await store.load();

    const persisted = JSON.parse(fixture.files.get('Calendar/journal-metadata.json')!);
    expect(persisted.customLabels).toEqual(['custom']);
    expect(persisted.futureMetadata).toEqual({ keep: true });
    expect(persisted.entries['Daily/2026-08-04.md'].futureRecordField).toBe('keep');
  });

  it('normalizes custom labels on regular updates without duplicating built-ins', async () => {
    const fixture = makeApp();
    const store = new MoodStore(fixture.app);

    await store.set('Daily/2026-08-05.md', 1, [' calm ', ' deep work ', 'deep work', '']);

    expect(store.get('Daily/2026-08-05.md')?.labels).toEqual(['calm', 'deep work']);
    expect(store.getCustomLabels()).toEqual(['deep work']);
  });

  it('imports mood notes and normalized custom labels from frontmatter', async () => {
    const fixture = makeApp();
    fixture.frontmatter.set('Daily/2026-08-06.md', {
      mood: 2,
      mood_labels: [' calm ', 'calm', ' focus ', '', 'focus'],
      mood_comment: 'legacy note',
    });
    fixture.frontmatter.set('Daily/2026-08-07.md', {
      mood: -1,
      mood_labels: ' tired, custom , custom ',
      mood_note: 'current note',
      mood_comment: 'legacy note should lose',
    });
    const metadataCache = { getFileCache: (file: any) => ({ frontmatter: fixture.frontmatter.get(file.path) }) };
    const store = new MoodStore(fixture.app);

    await expect(store.importFrontmatter(['Daily/2026-08-06.md', 'Daily/2026-08-07.md'], metadataCache)).resolves.toBe(2);

    expect(store.get('Daily/2026-08-06.md')).toMatchObject({ labels: ['calm', 'focus'], note: 'legacy note' });
    expect(store.get('Daily/2026-08-07.md')).toMatchObject({ labels: ['tired', 'custom'], note: 'current note' });
    expect(store.getCustomLabels()).toEqual(['custom', 'focus']);
  });

  it('adopts frontmatter-only mood into recovery and clears all mood keys', async () => {
    const fixture = makeApp();
    const path = 'Daily/2026-08-08.md';
    fixture.frontmatter.set(path, {
      mood: 0,
      mood_labels: ['calm', 'custom'],
      mood_note: 'visible note',
      mood_comment: 'legacy copy',
      title: 'keep this',
    });
    const store = new MoodStore(fixture.app);
    const visible = {
      score: 0 as const,
      labels: ['calm', 'custom'],
      note: 'visible note',
      recordedAt: '2026-08-08T09:00:00.000Z',
      updatedAt: '2026-08-08T09:00:00.000Z',
    };

    await expect(store.deleteRecord(path, true, visible)).resolves.toMatchObject(visible);

    expect(store.get(path)).toBeUndefined();
    const visibleOrphan = store.getOrphans()[path]?.record;
    if (!visibleOrphan) throw new Error('expected visible orphan');
    expect(visibleOrphan).toEqual(visible);
    expect(fixture.frontmatter.get(path)).toEqual({ title: 'keep this' });
    const persisted = JSON.parse(fixture.files.get('Calendar/journal-metadata.json')!);
    expect(persisted.entries[path]).toBeUndefined();
    expect(persisted.orphans[path].record.note).toBe('visible note');

    await store.restoreOrphan(path);
    const restored = new MoodStore(fixture.app);
    await restored.load();
    expect(restored.get(path)?.note).toBe('visible note');
  });

  it('round-trips note/custom labels and guards restore conflicts', async () => {
    const fixture = makeApp();
    const store = new MoodStore(fixture.app);
    await store.set('Daily/2026-08-02.md', -1, ['tired', 'deep work'], {}, 'A note');
    expect(store.get('Daily/2026-08-02.md')?.note).toBe('A note');
    expect(store.getCustomLabels()).toContain('deep work');
    await store.deleteRecord('Daily/2026-08-02.md');
    await store.set('Daily/2026-08-03.md', 1, ['calm']);
    await expect(store.restoreOrphan('Daily/2026-08-02.md', 'Daily/2026-08-03.md')).rejects.toThrow('already has');
    await store.restoreOrphan('Daily/2026-08-02.md', 'Daily/2026-08-03.md', { replace: true });
    expect(store.get('Daily/2026-08-03.md')?.note).toBe('A note');
  });
});

describe('Goal 4B mood exports and reports', () => {
  const metadata: MoodMetadata = {
    schemaVersion: 2,
    customLabels: ['deep work'],
    entries: {
      'Daily/2026-08-02.md': { score: 1, labels: ['deep work'], note: 'line 1\nline 2', recordedAt: '2026-08-02T09:00:00Z', updatedAt: '2026-08-02T10:00:00Z' },
    },
    orphans: {
      'Daily/2026-08-01.md': { record: { score: -2, labels: ['sad'], recordedAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-01T10:00:00Z' }, orphanedAt: '2026-08-03T00:00:00Z' },
    },
  };

  it('exports stable CSV and versioned JSON', () => {
    expect(serializeMoodCsv(metadata)).toBe(serializeMoodCsv(metadata));
    expect(serializeMoodCsv(metadata)).toContain('sourcePath,recordStatus,score,labels,note,recordedAt,updatedAt,orphanedAt,storeSchemaVersion');
    expect(serializeMoodCsv(metadata)).toContain('"line 1\nline 2"');
    const json = JSON.parse(serializeMoodJson(metadata));
    expect(json.exportSchemaVersion).toBe(1);
    expect(json.records.map((row: any) => row.sourcePath)).toEqual(['Daily/2026-08-01.md', 'Daily/2026-08-02.md']);
    expect(moodExportObject(metadata).records[0].recordStatus).toBe('orphan');
  });

  it('summarizes sparse custom-label trends and empty periods', () => {
    const entries = [
      { date: '2026-01-03', mood: { score: 2 as const, labels: ['focus'], recordedAt: '', updatedAt: '' } },
      { date: '2026-03-09', mood: { score: -1 as const, labels: ['focus', 'custom'], recordedAt: '', updatedAt: '' } },
    ];
    const labels = summarizeMoodLabelTrends(entries);
    expect(labels.find((item) => item.label === 'focus')?.count).toBe(2);
    const reports = buildMoodReports(entries, { from: '2026-01-01', to: '2026-03-31', includeEmpty: true });
    expect(reports.monthly.map((item) => item.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(reports.monthly.find((item) => item.key === '2026-02')?.recordCount).toBe(0);
    expect(buildMoodPeriodReport([], 'year')).toEqual([]);
  });

  it('honors Sunday and Monday week starts across year and month boundaries', () => {
    const entries = [
      { date: '2025-12-31', mood: { score: 1 as const, labels: [], recordedAt: '', updatedAt: '' } },
      { date: '2026-01-04', mood: { score: 2 as const, labels: [], recordedAt: '', updatedAt: '' } },
      { date: '2026-01-05', mood: { score: 0 as const, labels: [], recordedAt: '', updatedAt: '' } },
    ];
    expect(buildMoodPeriodReport(entries, 'week', { weekStartsOn: 0 }).map((item) => item.key)).toEqual(['2025-12-28', '2026-01-04']);
    expect(buildMoodPeriodReport(entries, 'week', { weekStartsOn: 1 }).map((item) => item.key)).toEqual(['2025-12-29', '2026-01-05']);
    expect(buildMoodPeriodReport(entries, 'week', {
      weekStartsOn: 0,
      from: '2025-12-31',
      to: '2026-01-05',
      includeEmpty: true,
    }).map((item) => item.key)).toEqual(['2025-12-28', '2026-01-04']);
    expect(buildMoodPeriodReport(entries, 'month', { from: '2025-12-31', to: '2026-01-05', includeEmpty: true }).map((item) => item.key)).toEqual(['2025-12', '2026-01']);
    expect(buildMoodPeriodReport(entries, 'year', { from: '2025-12-31', to: '2026-01-05', includeEmpty: true }).map((item) => item.key)).toEqual(['2025', '2026']);
  });
});
