import { describe, expect, it, vi } from 'vitest';
import { buildJournalLocationOptions, buildJournalTagOptions, filterJournalEntries, journalEntryMatchesMediaFilter, locationFilterKey, MISSING_LOCATION_FILTER } from '../src/journal-timeline-filters';
import type { JournalEntry } from '../src/types';

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    path: 'Calendar/Daily/2026-08-06.md', date: '2026-08-06', title: 'A day', excerpt: 'Useful text',
    sourceId: 'daily', sourcePath: 'Calendar/Daily', sourceType: 'daily', favorite: false,
    attachments: [], frontmatter: {}, ...overrides,
  };
}

describe('journal timeline filters', () => {
  it('applies source, media, location, tag, date, mood, favorite, and query with AND semantics', () => {
    const matching = entry({
      sourceId: 'imports', sourcePath: 'Imports', tags: ['travel'], favorite: true,
      location: { name: 'Paris' }, searchText: 'paris travel', mood: { score: 2, labels: [], recordedAt: '', updatedAt: '' },
      media: [{ link: 'photo.jpg', normalizedLink: 'photo.jpg', sourcePath: 'Imports/a.md', kind: 'image', extension: 'jpg', external: false }],
    });
    const filters = { sourceId: 'imports', media: 'image' as const, location: locationFilterKey(matching.location), tag: 'travel', favoriteOnly: true, moodScore: 2, query: 'PARIS' };
    expect(filterJournalEntries([matching], filters)).toEqual([matching]);
    expect(filterJournalEntries([matching], { ...filters, location: MISSING_LOCATION_FILTER })).toEqual([]);
  });

  it('includes a frontmatter-only cover in media matching', () => {
    const cover = entry({ cover: 'voice.m4a' });
    expect(journalEntryMatchesMediaFilter(cover, 'audio')).toBe(true);
    expect(journalEntryMatchesMediaFilter(cover, 'none')).toBe(false);
  });

  it('keeps stable first-seen location and tag options, including missing locations', () => {
    const entries = [
      entry({ location: { name: 'Paris' }, tags: ['Travel', 'food'] }),
      entry({ path: 'b.md', location: { latitude: 31.23, longitude: 121.47 }, tags: ['travel', '#food'] }),
      entry({ path: 'c.md', location: undefined, tags: [] }),
    ];
    expect(buildJournalLocationOptions(entries).map((item) => item.label)).toEqual(['Paris', 'lat 31.23, lng 121.47', 'No location']);
    expect(buildJournalTagOptions(entries).map((item) => item.value)).toEqual(['travel', 'food']);
  });

  it('ANDs every whitespace-separated query term instead of matching the whole phrase', () => {
    const tokyo = entry({ normalizedSearchText: 'tokyo sunny walk' });

    expect(filterJournalEntries([tokyo], { query: 'tokyo walk' })).toEqual([tokyo]);
    expect(filterJournalEntries([tokyo], { query: '  tokyo   walk  ' })).toEqual([tokyo]);
    expect(filterJournalEntries([tokyo], { query: 'tokyo rain' })).toEqual([]);
  });

  it('reuses the normalized search index instead of normalizing it again per keystroke', () => {
    const normalize = vi.spyOn(String.prototype, 'normalize');
    const indexed = entry({
      normalizedSearchText: `tokyo ${'walk '.repeat(512)}`,
      searchText: `${'raw body '.repeat(512)}`,
      title: 'Ignored because the index is present',
    });

    const result = filterJournalEntries([indexed], { query: 'tokyo walk' });
    const normalizeCalls = normalize.mock.calls.length;
    normalize.mockRestore();

    expect(result).toEqual([indexed]);
    // Only the short query may be normalized; the indexed text is already NFKC.
    expect(normalizeCalls).toBe(1);
  });
});
