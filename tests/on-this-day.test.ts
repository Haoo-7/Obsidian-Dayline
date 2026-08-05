import { describe, expect, it } from 'vitest';
import { OnThisDayProvider } from '../src/on-this-day';

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
      { year: currentYear - 1, dateStr: `${currentYear - 1}-08-05`, path: 'old.md', images: [], excerpt: null },
    ]);
  });

  it('renders configured excerpts and filters non-image attachments', async () => {
    const currentYear = new Date().getUTCFullYear();
    const provider = createProvider([
      {
        date: `${currentYear - 1}-02-03`,
        path: 'old.md',
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
        images: ['photo.jpg'],
        excerpt: `${currentYear - 1}: good Heading A short linked entry.`,
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
