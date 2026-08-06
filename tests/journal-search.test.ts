import { describe, expect, it } from 'vitest';
import { buildJournalSearchText, normalizeJournalText, parseJournalTags } from '../src/journal-search';

describe('journal search and tags', () => {
  it('normalizes Unicode compatibility forms, case, and whitespace', () => {
    expect(normalizeJournalText('  ＡＢＣ\n  Café  ')).toBe('abc café');
  });

  it('parses frontmatter arrays, # tags, metadata-cache tags, and body tags without headings', () => {
    expect(parseJournalTags(
      { tags: ['#Travel', 'food, #travel'], Tag: ['Coffee'] },
      '# Heading\nA #Day/One and #coffee note',
      [{ tag: '#Metadata' }],
    )).toEqual(['travel', 'food', 'coffee', 'metadata', 'day/one']);
  });

  it('builds a normalized searchable record once from all useful fields', () => {
    const text = buildJournalSearchText({
      path: 'Imports/day.md', title: 'Trip', excerpt: 'A note', body: 'Body text',
      sourceId: 'imports', sourcePath: 'Imports', sourceLabel: 'Imported notes',
      location: { name: 'Paris', latitude: 48.8, longitude: 2.3 }, tags: ['travel'],
    });
    expect(text).toContain('trip');
    expect(text).toContain('body text');
    expect(text).toContain('paris');
    expect(text).toContain('imported notes');
  });
});
