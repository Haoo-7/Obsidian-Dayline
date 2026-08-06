import { describe, expect, it } from 'vitest';

import { cachedMonthsReferencingMedia } from '../src/calendar-media-refresh';
import { mediaAttachmentsFromLinks } from '../src/media-links';

describe('calendar media refresh targeting', () => {
  it('invalidates only cached months that resolve to the changed file', () => {
    const augustMedia = mediaAttachmentsFromLinks(['photo-alias.jpg'], 'Calendar/Daily/2026-08-06.md');
    const septemberMedia = mediaAttachmentsFromLinks(['other.jpg'], 'Calendar/Daily/2026-09-01.md');
    const cache = new Map([
      ['2026-7', new Map([['2026-08-06', { date: '2026-08-06', media: augustMedia, images: augustMedia, entries: [], entryCount: 0, sourceIds: [], hasRecord: false, hasWeather: false }]])],
      ['2026-8', new Map([['2026-09-01', { date: '2026-09-01', media: septemberMedia, images: septemberMedia, entries: [], entryCount: 0, sourceIds: [], hasRecord: false, hasWeather: false }]])],
    ]);

    const affected = cachedMonthsReferencingMedia(cache, 'Photos/actual.jpg', (attachment) => (
      attachment.normalizedLink === 'photo-alias.jpg' ? 'Photos/actual.jpg' : 'Photos/other.jpg'
    ));

    expect(affected).toEqual(new Set(['2026-7']));
  });

  it('does not invalidate cached months for unrelated or external media', () => {
    const remoteMedia = mediaAttachmentsFromLinks(['https://cdn.example.test/photo.jpg'], 'Calendar/Daily/2026-08-06.md');
    const cache = new Map([
      ['2026-7', new Map([['2026-08-06', { date: '2026-08-06', media: remoteMedia, images: remoteMedia, entries: [], entryCount: 0, sourceIds: [], hasRecord: false, hasWeather: false }]])],
    ]);

    expect(cachedMonthsReferencingMedia(cache, 'Photos/photo.jpg', () => 'Photos/photo.jpg')).toEqual(new Set());
  });

  it('matches normalized and raw attachment paths when resolution is unavailable', () => {
    const media = mediaAttachmentsFromLinks(['![[./Photos/actual.jpg|cover]]'], 'Calendar/Daily/2026-08-06.md');
    const cache = new Map([
      ['2026-7', new Map([['2026-08-06', { date: '2026-08-06', media, images: media, entries: [], entryCount: 0, sourceIds: [], hasRecord: false, hasWeather: false }]])],
    ]);

    expect(cachedMonthsReferencingMedia(cache, './Photos/actual.jpg', () => undefined)).toEqual(new Set(['2026-7']));
  });

  it('invalidates unresolved local media conservatively when an alias has disappeared', () => {
    const media = mediaAttachmentsFromLinks(['photo-alias.jpg'], 'Calendar/Daily/2026-08-06.md');
    const cache = new Map([
      ['2026-7', new Map([['2026-08-06', { date: '2026-08-06', media, images: media, entries: [], entryCount: 0, sourceIds: [], hasRecord: false, hasWeather: false }]])],
    ]);

    expect(cachedMonthsReferencingMedia(cache, 'Photos/renamed.jpg', () => undefined)).toEqual(new Set(['2026-7']));
  });
});
