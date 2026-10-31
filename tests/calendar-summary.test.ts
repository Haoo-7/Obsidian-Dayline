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

  it('makes the note that supplies the cover the one the cell stands for', () => {
    // Two notes on one day: the evening check-in sorts first but has no image.
    const evening = entry({
      path: 'Daily/2026-07-05-evening.md', date: '2026-07-05', sourceType: 'daily', createdAt: '2026-07-05T21:00:00Z',
      mood: { score: -1, labels: [], recordedAt: '', updatedAt: '' },
    });
    const night = entry({
      path: 'Daily/2026-07-05.md', date: '2026-07-05', sourceType: 'daily', createdAt: '2026-07-05T08:00:00Z',
      media: mediaAttachmentsFromLinks(['sky.jpg'], 'Daily/2026-07-05.md'), cover: 'sky.jpg',
      mood: { score: 1, labels: [], recordedAt: '', updatedAt: '' },
    });
    const summary = aggregateCalendarDays([evening, night]).get('2026-07-05');
    expect(summary?.entries.map((item) => item.path)).toEqual([evening.path, night.path]);
    expect(summary?.cover?.normalizedLink).toBe('sky.jpg');
    // Cover, mood and the note that opens all come from the same note.
    expect(summary?.primaryEntryPath).toBe(night.path);
    expect(summary?.path).toBe(night.path);
    expect(summary?.mood?.score).toBe(1);
  });

  it('takes the first note, and only its mood, when no note has an image', () => {
    const first = entry({ path: 'Daily/2026-07-06.md', date: '2026-07-06', sourceType: 'daily' });
    const second = entry({
      path: 'Imports/2026-07-06.md', date: '2026-07-06',
      mood: { score: 2, labels: [], recordedAt: '', updatedAt: '' },
    });
    const summary = aggregateCalendarDays([second, first]).get('2026-07-06');
    expect(summary?.primaryEntryPath).toBe(first.path);
    // The other note's mood no longer shows on a cell that opens this one.
    expect(summary?.mood).toBeUndefined();
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

  it('leaves out the folder separator when the daily notes live at the vault root', () => {
    const summaries = withWeatherOnlyDays(new Map(), ['2026-08-07'], '/');
    expect(summaries.get('2026-08-07')).toMatchObject({
      path: '2026-08-07.md',
      primaryEntryPath: '2026-08-07.md',
    });
  });
});
