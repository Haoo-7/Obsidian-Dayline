import { describe, expect, it } from 'vitest';
import { buildJournalSearchText, normalizeJournalText, parseJournalTags } from '../src/journal-search';

describe('journal search and tags', () => {
  it('normalizes Unicode compatibility forms, case, and whitespace', () => {
    expect(normalizeJournalText('  ＡＢＣ\n  Café  ')).toBe('abc café');
  });

  it('parses frontmatter arrays, cached tags, and body tags without headings', () => {
    expect(parseJournalTags(
      { tags: ['#Travel', 'food, #travel'], Tag: ['Coffee'] },
      '# Heading\nA #Day/One and #coffee note',
      [{ tag: '#Metadata' }],
    )).toEqual(['travel', 'food', 'coffee', 'metadata']);
  });

  it('scans a cleaned body only when the metadata cache has no tags', () => {
    expect(parseJournalTags({}, 'A #Day/One and #coffee note', [])).toEqual(['day/one', 'coffee']);
  });

  it('ignores colors, quoted hex values, code blocks, and numeric tags in the fallback', () => {
    const body = [
      '---',
      'color: "#ff0000"',
      '---',
      'Set color: "#ff0000" here.',
      'Issue #123',
      '```sh',
      '#fff',
      '# install deps',
      '```',
      'Real #travel note.',
    ].join('\n');

    expect(parseJournalTags({}, body, [])).toEqual(['travel']);
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
