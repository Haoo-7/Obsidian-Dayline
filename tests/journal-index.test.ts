import { describe, expect, it } from 'vitest';
import { JournalIndex, normalizeLocation, resolveJournalDate, startJournalIndexLoad, waitForJournalIndexStartup } from '../src/journal-index';

function makeApp(files: any[]) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => byPath.get(path),
      cachedRead: async (file: any) => file.content,
    },
    metadataCache: {
      getFileCache: (file: any) => ({ frontmatter: file.frontmatter, embeds: file.embeds ?? [], tags: file.tags ?? [] }),
    },
  };
}

describe('journal index', () => {
  it('starts the initial rebuild in the background and reports completion later', async () => {
    let resolveLoad: (() => void) | undefined;
    let completed = false;
    let failed = false;
    const load = new Promise<void>((resolve) => { resolveLoad = resolve; });

    expect(startJournalIndexLoad(() => load, () => { completed = true; }, () => { failed = true; })).toBeUndefined();
    expect(completed).toBe(false);
    expect(failed).toBe(false);

    resolveLoad?.();
    await load;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(true);
    expect(failed).toBe(false);
  });

  it('does not wait for a resolved event after Obsidian has already initialized metadata', async () => {
    const app: any = makeApp([]);
    app.metadataCache.initialized = true;
    app.metadataCache.on = () => {
      throw new Error('an initialized metadata cache must not subscribe again');
    };
    app.workspace = {
      onLayoutReady: (callback: () => void) => callback(),
    };

    await expect(waitForJournalIndexStartup(app)).resolves.toBeUndefined();
  });

  it('waits for metadata and layout before the desktop startup rebuild reads embeds', async () => {
    const file: any = {
      path: 'Calendar/Daily/2026-07-23.md',
      name: '2026-07-23.md',
      frontmatter: {},
      content: '# July 23',
      embeds: [],
    };
    let resolveMetadata: (() => void) | undefined;
    let resolveLayout: (() => void) | undefined;
    const app: any = makeApp([file]);
    app.metadataCache.initialized = false;
    app.metadataCache.on = (_event: string, callback: () => void) => { resolveMetadata = callback; return { id: 'metadata-ready' }; };
    app.metadataCache.offref = () => undefined;
    app.workspace = { onLayoutReady: (callback: () => void) => { resolveLayout = callback; } };
    const index = new JournalIndex(app, () => undefined);

    const startup = waitForJournalIndexStartup(app).then(() => index.refresh({ dailyFolder: 'Calendar/Daily' }));
    await Promise.resolve();
    expect(index.getEntries()).toEqual([]);

    file.embeds = [{ link: '039A0033.jpg' }, { link: '039A0094.jpg' }];
    resolveMetadata?.();
    await Promise.resolve();
    expect(index.getEntries()).toEqual([]);

    resolveLayout?.();
    await startup;
    expect(index.getEntries()[0]?.attachments).toEqual(['039A0033.jpg', '039A0094.jpg']);
  });

  it('uses configured date fields before aliases and filename dates', () => {
    expect(resolveJournalDate('random.md', { importedAt: '2026-07-18T08:00:00+08:00', date: '2020-01-01' }, 'importedAt').date).toBe('2026-07-18');
    expect(resolveJournalDate('2026-07-18 note.md', {}).date).toBe('2026-07-18');
    expect(resolveJournalDate('2026-02-30.md', {}).reason).toBe('invalid-date');
  });

  it('prefers a non-empty frontmatter title, then H1, then the filename', async () => {
    const files = [
      {
        path: 'Calendar/Daily/2026-07-20.md',
        name: '2026-07-20.md',
        frontmatter: { title: 'Frontmatter title' },
        content: '# Heading title\nBody',
      },
      {
        path: 'Calendar/Daily/2026-07-21.md',
        name: '2026-07-21.md',
        frontmatter: { title: '   ' },
        content: '# Heading fallback\nBody',
      },
      {
        path: 'Calendar/Daily/2026-07-22.md',
        name: '2026-07-22.md',
        frontmatter: { title: '   ' },
        content: 'Body without a heading',
      },
    ];
    const index = new JournalIndex(makeApp(files), () => undefined);
    await index.refresh({ dailyFolder: 'Calendar/Daily' });

    expect(index.getEntries().map((entry) => entry.title)).toEqual([
      '2026-07-22',
      'Heading fallback',
      'Frontmatter title',
    ]);
  });

  it('maps external aliases, excludes undated files, and records diagnostics', async () => {
    const files = [
      {
        path: 'Imports/day.md',
        name: 'day.md',
        frontmatter: {
          creationDate: '2025-02-28T12:00:00Z',
          starred: true,
          uuid: 'abc',
          coordinates: '31.23, 121.47',
          tags: ['#Imported', 'travel'],
        },
        content: '# Imported day\nA useful memory. #Memory',
        embeds: [{ link: 'media/photo.jpg' }],
      },
      { path: 'Imports/no-date.md', name: 'no-date.md', frontmatter: {}, content: 'No date' },
      { path: 'Calendar/Daily/2024-02-29.md', name: '2024-02-29.md', frontmatter: {}, content: 'Leap day' },
    ];
    const index = new JournalIndex(makeApp(files), () => undefined);
    await index.refresh({
      journalSources: [
        { id: 'imports', path: 'Imports', type: 'external', dateField: 'creationDate' },
        { id: 'daily', path: 'Calendar/Daily', type: 'daily' },
      ],
    });
    const entries = index.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.path === 'Imports/day.md')).toMatchObject({
      date: '2025-02-28', favorite: true, uuid: 'abc',
      location: { latitude: 31.23, longitude: 121.47 },
      sourceType: 'external',
      tags: ['imported', 'travel', 'memory'],
    });
    const imported = entries.find((entry) => entry.path === 'Imports/day.md');
    expect(imported?.searchText).toBe('# Imported day\nA useful memory. #Memory');
    expect(imported?.normalizedSearchText).toContain('imported day a useful memory. #memory');
    expect(index.getDiagnostics()).toEqual([{ path: 'Imports/no-date.md', reason: 'missing-date' }]);
  });

  it('rejects out-of-range location coordinates', () => {
    expect(normalizeLocation({
      location: { latitude: 91, longitude: 181 },
      coordinates: '91, 181',
    })).toBeUndefined();
    expect(normalizeLocation({
      latitude: '31.23',
      longitude: '121.47',
    })).toEqual({ latitude: 31.23, longitude: 121.47 });
  });

  it('discards a stale single-file read when a newer refresh wins', async () => {
    const file = {
      path: 'Calendar/Daily/2026-07-18.md',
      name: '2026-07-18.md',
      frontmatter: {},
      content: '# first',
    };
    let reads = 0;
    let releaseFirst: (() => void) | undefined;
    const app = {
      vault: {
        getMarkdownFiles: () => [file],
        getAbstractFileByPath: (path: string) => path === file.path ? file : undefined,
        cachedRead: async (current: any) => {
          const content = current.content;
          reads += 1;
          if (reads === 1) {
            await new Promise<void>((resolve) => { releaseFirst = resolve; });
          }
          return content;
        },
      },
      metadataCache: {
        getFileCache: (current: any) => ({ frontmatter: current.frontmatter, embeds: [] }),
      },
    };
    const index = new JournalIndex(app, () => undefined);
    const settings = { dailyFolder: 'Calendar/Daily' };

    const first = index.refreshFile(file.path, settings);
    await Promise.resolve();
    file.content = '# second';
    const second = index.refreshFile(file.path, settings);
    await second;
    releaseFirst?.();
    await first;

    expect(index.getEntries()[0]?.title).toBe('second');
  });

  it('does not reuse a completed file refresh generation while older work is pending', async () => {
    const file = {
      path: 'Calendar/Daily/2026-07-18.md',
      name: '2026-07-18.md',
      frontmatter: {},
      content: '# oldest',
    };
    const releases: Array<() => void> = [];
    let reads = 0;
    const app = makeApp([file]);
    app.vault.cachedRead = async (current: any) => {
      const content = current.content;
      reads += 1;
      if (reads === 1 || reads === 3) await new Promise<void>((resolve) => releases.push(resolve));
      return content;
    };
    const index = new JournalIndex(app, () => undefined);
    const settings = { dailyFolder: 'Calendar/Daily' };

    const oldest = index.refreshFile(file.path, settings);
    await Promise.resolve();
    file.content = '# middle';
    await index.refreshFile(file.path, settings);
    file.content = '# newest';
    const newest = index.refreshFile(file.path, settings);
    await Promise.resolve();
    releases[0]?.();
    await oldest;
    releases[1]?.();
    await newest;

    expect(index.getEntries()[0]?.title).toBe('newest');
  });

  it('commits an explicit rebuild even when a file refresh arrives during the rebuild', async () => {
    const oldFile = { path: 'Old/2026-07-18.md', name: '2026-07-18.md', frontmatter: {}, content: '# old' };
    const newFile = { path: 'New/2026-07-19.md', name: '2026-07-19.md', frontmatter: {}, content: '# new' };
    const unrelated = { path: 'Other/readme.md', name: 'readme.md', frontmatter: {}, content: '# other' };
    const app = makeApp([oldFile, newFile, unrelated]);
    let releaseNewRead: (() => void) | undefined;
    app.vault.cachedRead = async (file: any) => {
      if (file === newFile && !releaseNewRead) await new Promise<void>((resolve) => { releaseNewRead = resolve; });
      return file.content;
    };
    const index = new JournalIndex(app, () => undefined);
    await index.refresh({ dailyFolder: 'Old' });

    const rebuild = index.refresh({ dailyFolder: 'New' });
    await Promise.resolve();
    await index.refreshFile(unrelated.path, { dailyFolder: 'New' });
    releaseNewRead?.();
    await rebuild;

    expect(index.sources).toMatchObject([{ id: 'daily', path: 'New' }]);
    expect(index.getEntries()).toMatchObject([{ path: newFile.path }]);
  });

  it('prevents an old-settings file refresh from overriding a completed rebuild', async () => {
    const oldFile = { path: 'Old/2026-07-18.md', name: '2026-07-18.md', frontmatter: {}, content: '# old' };
    const newFile = { path: 'New/2026-07-19.md', name: '2026-07-19.md', frontmatter: {}, content: '# new' };
    const app = makeApp([oldFile, newFile]);
    let releaseFirstNewRead: (() => void) | undefined;
    let releaseOldRefresh: (() => void) | undefined;
    let newReads = 0;
    app.vault.cachedRead = async (file: any) => {
      if (file === newFile && newReads++ === 0) {
        await new Promise<void>((resolve) => { releaseFirstNewRead = resolve; });
      } else if (file === oldFile && releaseFirstNewRead) {
        await new Promise<void>((resolve) => { releaseOldRefresh = resolve; });
      }
      return file.content;
    };
    const index = new JournalIndex(app, () => undefined);
    await index.refresh({ dailyFolder: 'Old' });

    const rebuild = index.refresh({ dailyFolder: 'New' });
    await Promise.resolve();
    const staleFileRefresh = index.refreshFile(oldFile.path, { dailyFolder: 'Old' });
    await Promise.resolve();
    releaseFirstNewRead?.();
    await rebuild;
    releaseOldRefresh?.();
    await staleFileRefresh;

    expect(index.sources).toMatchObject([{ id: 'daily', path: 'New' }]);
    expect(index.getEntries()).toMatchObject([{ path: newFile.path }]);
  });

  it('always includes the daily source and appends enabled external sources without duplicate paths', () => {
    const index = new JournalIndex(makeApp([]), () => undefined);

    expect(index.resolveSources({
      dailyFolder: 'Calendar/Daily',
      journalSources: [{ id: 'imports', path: 'Imports', type: 'external' }],
    })).toMatchObject([
      { id: 'daily', path: 'Calendar/Daily', type: 'daily' },
      { id: 'imports', path: 'Imports', type: 'external' },
    ]);
    expect(index.resolveSources({
      dailyFolder: 'Calendar/Daily',
      journalSources: [
        { id: 'custom-daily', path: 'Journal', type: 'daily' },
        { id: 'duplicate', path: 'Journal/', type: 'external' },
        { id: 'disabled', path: 'Disabled', type: 'external', enabled: false },
      ],
    })).toMatchObject([{ id: 'custom-daily', path: 'Journal', type: 'daily' }]);
  });

  it('deduplicates diagnostics by path and clears them when the file becomes valid', async () => {
    const file = { path: 'Calendar/Daily/no-date.md', name: 'no-date.md', frontmatter: {} as Record<string, unknown>, content: 'body' };
    const index = new JournalIndex(makeApp([file]), () => undefined);
    const settings = { dailyFolder: 'Calendar/Daily' };

    await index.refreshFile(file.path, settings);
    await index.refreshFile(file.path, settings);
    expect(index.getDiagnostics()).toEqual([{ path: file.path, reason: 'missing-date' }]);

    file.frontmatter.date = '2026-07-18';
    await index.refreshFile(file.path, settings);
    expect(index.getDiagnostics()).toEqual([]);
  });

  it('reuses the sorted entry snapshot until indexed data changes', async () => {
    const file = { path: 'Calendar/Daily/2026-07-18.md', name: '2026-07-18.md', frontmatter: {}, content: '# first' };
    const index = new JournalIndex(makeApp([file]), () => undefined);
    const settings = { dailyFolder: 'Calendar/Daily' };
    await index.refresh(settings);

    const first = index.getEntries();
    expect(index.getEntries()).toBe(first);

    file.content = '# changed';
    await index.refreshFile(file.path, settings);
    expect(index.getEntries()).not.toBe(first);
  });

  it('treats a null mood lookup as a deletion tombstone instead of reviving frontmatter', async () => {
    const file = {
      path: 'Calendar/Daily/2026-07-18.md',
      name: '2026-07-18.md',
      frontmatter: { mood: 2 },
      content: '# day',
    };
    const index = new JournalIndex(makeApp([file]), () => null);

    await index.refresh({ dailyFolder: 'Calendar/Daily' });

    expect(index.getEntries()[0]?.mood).toBeUndefined();
  });

  it('emits a file-scoped change with the previous and refreshed entries', async () => {
    const file = {
      path: 'Calendar/Daily/2026-07-18.md',
      name: '2026-07-18.md',
      frontmatter: {},
      content: '# first',
    };
    const index = new JournalIndex(makeApp([file]), () => undefined);
    const changes: any[] = [];
    index.subscribe((_, change) => changes.push(change));

    await index.refresh({ dailyFolder: 'Calendar/Daily' });
    file.content = '# second';
    await index.refreshFile(file.path, { dailyFolder: 'Calendar/Daily' });

    expect(changes).toMatchObject([
      { type: 'full' },
      { type: 'file', previous: { title: 'first' }, entry: { title: 'second', date: '2026-07-18' } },
    ]);
  });

  it('deduplicates concurrent initial refreshes for mobile activation', async () => {
    const file = {
      path: 'Calendar/Daily/2026-07-18.md',
      name: '2026-07-18.md',
      frontmatter: {},
      content: '# day',
    };
    let reads = 0;
    const app = makeApp([file]);
    app.vault.cachedRead = async (current: any) => {
      reads += 1;
      await Promise.resolve();
      return current.content;
    };
    const index = new JournalIndex(app, () => undefined);
    const settings = { dailyFolder: 'Calendar/Daily' };

    await Promise.all([index.ensureReady(settings), index.ensureReady(settings)]);

    expect(reads).toBe(1);
    expect(index.isReady).toBe(true);
    expect(index.getEntries()).toHaveLength(1);
  });

  it('retries initial readiness after a file mutation invalidates the first rebuild', async () => {
    const file = {
      path: 'Calendar/Daily/2026-07-18.md',
      name: '2026-07-18.md',
      frontmatter: {},
      content: '# updated during startup',
    };
    let reads = 0;
    let releaseFirstRead: (() => void) | undefined;
    const app = makeApp([file]);
    app.vault.cachedRead = async (current: any) => {
      reads += 1;
      if (reads === 1) await new Promise<void>((resolve) => { releaseFirstRead = resolve; });
      return current.content;
    };
    const index = new JournalIndex(app, () => undefined);
    const settings = { dailyFolder: 'Calendar/Daily' };

    const ready = index.ensureReady(settings);
    await Promise.resolve();
    const mutation = index.refreshFile(file.path, settings);
    releaseFirstRead?.();
    await Promise.all([ready, mutation]);

    expect(index.isReady).toBe(true);
    expect(index.getEntries()).toMatchObject([{ path: file.path, title: 'updated during startup' }]);
    expect(reads).toBeGreaterThanOrEqual(3);
  });

  it('waits for initial readiness and then applies the newest explicit settings refresh', async () => {
    const daily = { path: 'Calendar/Daily/2026-07-18.md', name: '2026-07-18.md', frontmatter: {}, content: '# daily' };
    const imported = { path: 'Imports/2026-07-19.md', name: '2026-07-19.md', frontmatter: {}, content: '# imported' };
    let releaseFirstRead: (() => void) | undefined;
    let reads = 0;
    const app = makeApp([daily, imported]);
    app.vault.cachedRead = async (file: any) => {
      reads += 1;
      if (reads === 1) await new Promise<void>((resolve) => { releaseFirstRead = resolve; });
      return file.content;
    };
    const index = new JournalIndex(app, () => undefined);
    const initial = index.ensureReady({ dailyFolder: 'Calendar/Daily' });
    await Promise.resolve();
    expect(index.isReady).toBe(false);
    const latest = index.refresh({ dailyFolder: 'Imports' });
    releaseFirstRead?.();
    await Promise.all([initial, latest]);

    expect(index.isReady).toBe(true);
    expect(index.sources).toMatchObject([{ path: 'Imports' }]);
    expect(index.getEntries()).toMatchObject([{ path: 'Imports/2026-07-19.md' }]);
  });

  it('keeps the renamed entry generation ahead of an in-flight refresh', async () => {
    const oldFile = {
      path: 'Calendar/Daily/2026-07-18.md',
      name: '2026-07-18.md',
      frontmatter: {},
      content: '# original',
    };
    const newFile = {
      path: 'Calendar/Daily/renamed.md',
      name: 'renamed.md',
      frontmatter: { date: '2026-07-18' },
      content: '# renamed',
    };
    const files = [oldFile];
    const byPath = new Map([[oldFile.path, oldFile as any]]);
    const app = {
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) => byPath.get(path),
        cachedRead: async (file: any) => file.content,
      },
      metadataCache: {
        getFileCache: (file: any) => ({ frontmatter: file.frontmatter, embeds: [] }),
      },
    };
    const index = new JournalIndex(app, () => ({
      score: 2,
      labels: [],
      recordedAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    }));
    await index.refresh({ dailyFolder: 'Calendar/Daily' });
    files.splice(0, 1, newFile);
    byPath.delete(oldFile.path);
    byPath.set(newFile.path, newFile);
    index.renameFile(oldFile.path, newFile.path);
    await index.refreshFile(newFile.path, { dailyFolder: 'Calendar/Daily' });

    expect(index.getEntries()[0]).toMatchObject({ path: newFile.path, mood: { score: 2 } });
  });
});
