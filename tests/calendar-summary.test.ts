import { describe, expect, it } from 'vitest';
import { aggregateCalendarDays, withWeatherOnlyDays } from '../src/calendar-summary';
import { mediaAttachmentsFromLinks } from '../src/media-links';
import type { JournalEntry } from '../src/types';

function entry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    path: 'Imports/entry.md', date: '2026-08-06', title: 'entry', excerpt: '', sourceId: 'imports',
    sourcePath: 'Imports', sourceType: 'external', favorite: false, attachments: [], frontmatter: {},
    ...overrides,
  };
}

describe('calendar day aggregation', () => {
  it('keeps all entries and chooses daily as the primary entry', () => {
    const external = entry({ path: 'Imports/late.md', sourceId: 'imports', createdAt: '2026-08-06T12:00:00Z', media: mediaAttachmentsFromLinks(['other.jpg'], 'Imports/late.md') });
    const daily = entry({ path: 'Calendar/Daily/2026-08-06.md', sourceId: 'daily', sourceType: 'daily', media: mediaAttachmentsFromLinks(['daily.jpg'], 'Calendar/Daily/2026-08-06.md'), cover: 'daily.jpg', weather: { temperature: 20 } });
    const summary = aggregateCalendarDays([external, daily]).get('2026-08-06');
    expect(summary).toMatchObject({ entryCount: 2, primaryEntryPath: daily.path, hasRecord: true, hasWeather: true });
    expect(summary?.sourceIds).toEqual(['daily', 'imports']);
    expect(summary?.cover?.normalizedLink).toBe('daily.jpg');
    expect(summary?.media.map((item) => item.normalizedLink)).toEqual(['daily.jpg', 'other.jpg']);
  });

  it('falls back to the first displayable media when cover is invalid', () => {
    const item = entry({ media: mediaAttachmentsFromLinks(['note.pdf', 'clip.mp4'], 'Imports/entry.md'), cover: 'missing.pdf' });
    const summary = aggregateCalendarDays([item]).get(item.date);
    expect(summary?.cover?.normalizedLink).toBe('clip.mp4');
  });

  it('keeps case-sensitive external media distinct during calendar aggregation', () => {
    const urls = [
      'https://cdn.example.test/Photo.JPG',
      'https://cdn.example.test/photo.jpg',
    ];
    const item = entry({
      media: mediaAttachmentsFromLinks([urls[0]], 'Imports/entry.md'),
      cover: urls[1],
    });
    const summary = aggregateCalendarDays([item]).get(item.date);
    expect(summary?.media.map((media) => media.normalizedLink)).toEqual(urls.slice().reverse());
  });

  it('creates a weather-only summary for dates without journal entries', () => {
    const summaries = withWeatherOnlyDays(new Map(), ['2026-08-07', 'not-a-date'], 'Calendar/Daily');
    expect(summaries.get('2026-08-07')).toMatchObject({
      entryCount: 0,
      hasRecord: false,
      hasWeather: true,
      path: 'Calendar/Daily/2026-08-07.md',
    });
    expect(summaries.has('not-a-date')).toBe(false);
  });
});
