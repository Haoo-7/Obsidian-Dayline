import { describe, expect, it } from 'vitest';
import { formatDate, formatDateInTimeZone, formatDateParts, getClockPartsInTimeZone, getTodayDate, matchesDatePrefixedImage, parseDateFromFilename, parseDateString, parseDiaryDate } from '../src/date-utils';

describe('date utilities', () => {
  it('accepts valid diary dates and rejects impossible dates', () => {
    expect(parseDiaryDate('2024-02-29.md')?.date).toBe('2024-02-29');
    expect(parseDiaryDate('2023-02-29.md')).toBeNull();
    expect(parseDiaryDate('2024-02-30.md')).toBeNull();
  });

  it('formats local dates without changing the calendar day', () => {
    expect(formatDate(new Date(2026, 6, 18))).toBe('2026-07-18');
  });

  it('checks date prefixes against the image basename', () => {
    expect(matchesDatePrefixedImage('Assets/2026-07-18_photo.jpg', '2026-07-18')).toBe(true);
    expect(matchesDatePrefixedImage('Assets/other-2026-07-18.jpg', '2026-07-18')).toBe(false);
    expect(matchesDatePrefixedImage('Assets/2026-07-180.jpg', '2026-07-18')).toBe(false);
    expect(matchesDatePrefixedImage('Assets/2026-07-18photo.jpg', '2026-07-18')).toBe(false);
  });

  it('parses ISO dates and bounded date-prefixed filenames', () => {
    expect(parseDateString('2026-07-18T21:30:00+08:00')).toBe('2026-07-18');
    expect(parseDateFromFilename('2026-07-18 evening.md')).toBe('2026-07-18');
    expect(parseDateFromFilename('2026-07-180.md')).toBeNull();
  });

  it('uses the configured timezone at a DST and UTC day boundary', () => {
    const instant = new Date('2026-07-18T23:30:00.000Z');
    expect(formatDateInTimeZone(instant, 'Asia/Shanghai')).toBe('2026-07-19');
    expect(formatDateInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-07-18');
    expect(formatDateInTimeZone(new Date('2026-03-08T08:30:00.000Z'), 'America/Los_Angeles')).toBe('2026-03-08');
  });

  it('shares date-only formatting across calendar and reminder callers', () => {
    expect(formatDateParts(2026, 7, 18)).toBe('2026-07-18');
    const instant = new Date('2026-07-18T23:30:00.000Z');
    expect(getTodayDate('Asia/Shanghai', instant)).toBe('2026-07-19');
    expect(getTodayDate('America/Los_Angeles', instant)).toBe('2026-07-18');
    expect(getClockPartsInTimeZone(instant, 'Asia/Shanghai')).toEqual({ hour: 7, minute: 30 });
    expect(getClockPartsInTimeZone(instant, 'America/Los_Angeles')).toEqual({ hour: 16, minute: 30 });
  });
});
