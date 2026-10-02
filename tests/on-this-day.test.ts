import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnThisDayProvider, splitTitleFromBody } from '../src/on-this-day';

function createProvider(entries: any[], settings: Record<string, unknown> = {}) {
  return new OnThisDayProvider({
    settings: { weatherTimezone: 'UTC', ...settings },
    journalIndex: { getEntries: () => entries },
  });
}

describe('OnThisDayProvider', () => {
  it('indexes past entries and excludes the current year', async () => {
    const currentYear = new Date().getUTCFullYear();
    const provider = createProvider([
      { date: `${currentYear - 1}-08-05`, path: 'old.md', attachments: [] },
      { date: `${currentYear}-08-05`, path: 'current.md', attachments: [] },
    ]);

    expect(await provider.hasEntries(8, 5)).toBe(true);
    expect(provider.dateIndexSnapshot?.has('08-05')).toBe(true);
    expect(await provider.getEntries(8, 5)).toEqual([
      { year: currentYear - 1, dateStr: `${currentYear - 1}-08-05`, path: 'old.md', title: null, images: [], excerpt: null },
    ]);
  });

  it('renders configured excerpts and filters non-image attachments', async () => {
    const currentYear = new Date().getUTCFullYear();
    const provider = createProvider([
      {
        date: `${currentYear - 1}-02-03`,
        path: 'old.md',
        title: 'Heading',
        attachments: ['photo.jpg', 'document.pdf'],
        searchText: '# Heading\n\nA short [[linked]] entry.',
        frontmatter: { mood: 'good' },
      },
    ], { onThisDayExcerptMode: 'template', onThisDayExcerptTemplate: '{year}: {mood} {body}' });

    await expect(provider.getEntries(2, 3)).resolves.toEqual([
      {
        year: currentYear - 1,
        dateStr: `${currentYear - 1}-02-03`,
        path: 'old.md',
        title: 'Heading',
        images: ['photo.jpg'],
        excerpt: `${currentYear - 1}: good A short linked entry.`,
      },
    ]);
  });

  it('invalidates both the date index and entry cache', async () => {
    const currentYear = new Date().getUTCFullYear();
    const provider = createProvider([
      { date: `${currentYear - 1}-08-05`, path: 'old.md', attachments: [] },
    ]);

    await provider.getEntries(8, 5);
    provider.invalidate();

    expect(provider.dateIndexSnapshot).toBeNull();
  });
});

describe('OnThisDayProvider February 29 in a common year', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges February 29 memories into the February 28 view of a common year', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));

    const provider = createProvider([
      { date: '2024-02-29', path: 'leap.md', attachments: [] },
      { date: '2023-02-28', path: 'common.md', attachments: [] },
    ]);

    const entries = await provider.getEntries(2, 28);

    // Year order is preserved across the merged keys.
    expect(entries.map((entry) => entry.dateStr)).toEqual(['2024-02-29', '2023-02-28']);
    expect(await provider.hasEntries(2, 28)).toBe(true);
    // The calendar dot marker reads the date index directly.
    expect(provider.dateIndexSnapshot?.has('02-28')).toBe(true);
    // The explicit February 29 view still resolves.
    expect((await provider.getEntries(2, 29)).map((entry) => entry.dateStr)).toEqual(['2024-02-29']);
  });

  it('keeps February 28 and February 29 separate in a leap year', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00Z'));

    const provider = createProvider([
      { date: '2023-02-29', path: 'leap.md', attachments: [] },
      { date: '2023-02-28', path: 'common.md', attachments: [] },
    ]);

    expect((await provider.getEntries(2, 28)).map((entry) => entry.dateStr)).toEqual(['2023-02-28']);
    expect((await provider.getEntries(2, 29)).map((entry) => entry.dateStr)).toEqual(['2023-02-29']);
  });
});

describe('splitTitleFromBody', () => {
  it('lifts the note title out of the body it used to be spliced into', () => {
    // The exact note that produced the run-on card: a frontmatter title that is
    // repeated as the opening heading, followed by a normal paragraph.
    const content = [
      '# Low Tide Last Year / 去年低潮线',
      '',
      'Same calendar date, previous year. Used to preview the merged weather-card entry.',
      '',
      '![[Dayline Demo/Media/dayline-01-tide.png]]',
    ].join('\n');

    const { title, body } = splitTitleFromBody(content, 'Low Tide Last Year / 去年低潮线', '2025-07-18');

    expect(title).toBe('Low Tide Last Year / 去年低潮线');
    expect(body).not.toContain('Low Tide Last Year');
    expect(body).toContain('Same calendar date, previous year.');
  });

  it('drops a leading heading even when the index title differs from its text', () => {
    const { title, body } = splitTitleFromBody('# Low Tide / 低潮线\n\nThe water was still.\n', 'Low Tide', '2025-07-18');

    expect(title).toBe('Low Tide');
    expect(body.trim()).toBe('The water was still.');
  });

  it('keeps a section heading that sits after the opening paragraph', () => {
    const { body } = splitTitleFromBody('Morning rain.\n\n## Afternoon\n\nCleared up.\n', 'Rainy day', '2025-07-18');

    expect(body).toContain('## Afternoon');
  });

  it('hides a date-only or placeholder title', () => {
    expect(splitTitleFromBody('Body only.\n', '2025-07-18', '2025-07-18').title).toBeNull();
    expect(splitTitleFromBody('Body only.\n', 'Daily note', '2025-07-18').title).toBeNull();
    expect(splitTitleFromBody('Body only.\n', 'Freewrite', '2025-07-18').title).toBeNull();
  });

  it('keeps a generic-looking title the user wrote into frontmatter', () => {
    expect(splitTitleFromBody('Body only.\n', 'Freewrite', '2025-07-18', true).title).toBe('Freewrite');
    expect(splitTitleFromBody('Body only.\n', 'Daily note', '2025-07-18', true).title).toBe('Daily note');
  });

  it('falls back to the opening heading when the index has no title', () => {
    expect(splitTitleFromBody('# A real title\n\nBody.\n', undefined, '2025-07-18').title).toBe('A real title');
  });
});
