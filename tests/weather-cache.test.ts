import { describe, expect, it } from 'vitest';
import {
  isHistoricalWeatherDate,
  isSnapshotStale,
  migrateCompatibleSnapshot,
  pruneWeatherCache,
  weatherCacheEntryDate,
  weatherConfigKey,
} from '../src/weather-cache';

const settings = {
  weatherLatitude: '39.9042',
  weatherLongitude: '116.4074',
  weatherUnits: 'metric' as const,
  weatherTimezone: 'auto',
};

describe('weather cache', () => {
  it('creates a stable key for the weather configuration', () => {
    expect(weatherConfigKey(settings)).toContain('39.9042');
    expect(weatherConfigKey(settings)).toContain('open-meteo-v1');
    expect(weatherConfigKey({ ...settings, weatherUnits: 'imperial' })).not.toBe(weatherConfigKey(settings));
  });

  it('migrates compatible legacy snapshots and rejects another location', () => {
    const snapshot = { latitude: 39.9042, longitude: 116.4074, units: 'metric' };
    expect(migrateCompatibleSnapshot(snapshot, settings)?.configKey).toBe(weatherConfigKey(settings));
    expect(migrateCompatibleSnapshot({ ...snapshot, latitude: 1 }, settings)).toBeNull();
  });

  it('rejects snapshots with an explicit config key from another timezone or API generation', () => {
    const snapshot = {
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric' as const,
      configKey: weatherConfigKey({ ...settings, weatherTimezone: 'Asia/Shanghai' }),
    };

    expect(migrateCompatibleSnapshot(snapshot, { ...settings, weatherTimezone: 'America/New_York' })).toBeNull();
    expect(migrateCompatibleSnapshot({ ...snapshot, configKey: 'open-meteo-v0' }, settings)).toBeNull();
  });

  it('treats invalid and expired timestamps as stale', () => {
    expect(isSnapshotStale({ fetchedAt: 'invalid' }, 2)).toBe(true);
    expect(isSnapshotStale({ fetchedAt: '2026-07-18T00:00:00.000Z' }, 2, Date.parse('2026-07-18T01:00:00.000Z'))).toBe(false);
    expect(isSnapshotStale({ fetchedAt: '2026-07-18T00:00:00.000Z' }, 2, Date.parse('2026-07-18T03:00:00.000Z'))).toBe(true);
  });

  it('keeps a payload-bearing archive snapshot for a historical date permanently fresh', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const archive = { date: '2021-03-05', fetchedAt: '2021-03-05T09:00:00.000Z', temperature: 12 };
    const today = '2026-08-06';

    expect(isSnapshotStale(archive, 2, now, { today })).toBe(false);
    expect(isSnapshotStale({ ...archive, date: '2026-08-05' }, 2, now, { today })).toBe(true);
    expect(isSnapshotStale({ ...archive, date: '2026-08-06' }, 2, now, { today })).toBe(true);
    // The `date` option can supply the calendar date when the record lacks one.
    expect(isSnapshotStale({ fetchedAt: '2021-03-05T09:00:00.000Z', temperature: 12 }, 2, now, {
      date: '2021-03-05',
      today,
    })).toBe(false);
    // An empty negative-cache record must keep the short TTL so a failed old
    // fetch is retried instead of being treated as final history.
    expect(isSnapshotStale({ cachedAt: '2021-03-05T09:00:00.000Z' }, 2, now, { date: '2021-03-05', today })).toBe(true);
    expect(isSnapshotStale({ cachedAt: '2021-03-05T09:00:00.000Z', offline: true }, 2, now, {
      date: '2021-03-05',
      today,
    })).toBe(true);
    // Without a current date the historic shortcut cannot apply.
    expect(isSnapshotStale(archive, 2, now)).toBe(true);
  });

  it('only treats dates older than the recent window as historical', () => {
    expect(isHistoricalWeatherDate('2021-03-05', '2026-08-06')).toBe(true);
    expect(isHistoricalWeatherDate('2026-07-29', '2026-08-06')).toBe(true);
    expect(isHistoricalWeatherDate('2026-07-30', '2026-08-06')).toBe(false);
    expect(isHistoricalWeatherDate('2026-08-06', '2026-08-06')).toBe(false);
    expect(isHistoricalWeatherDate('2026-08-07', '2026-08-06')).toBe(false);
    expect(isHistoricalWeatherDate(undefined, '2026-08-06')).toBe(false);
    expect(isHistoricalWeatherDate('not-a-date', '2026-08-06')).toBe(false);
    expect(isHistoricalWeatherDate('2021-03-05', 'not-a-date')).toBe(false);
  });

  it('prunes the cache by entry count and date floor instead of fetch age', () => {
    const cache: Record<string, any> = {
      '2019-01-01': { date: '2019-01-01', fetchedAt: '2026-08-06T00:00:00.000Z', temperature: 1 },
      '2021-01-01': { date: '2021-01-01', fetchedAt: '2026-08-06T00:00:00.000Z', temperature: 2 },
      '2026-08-05': { date: '2026-08-05', fetchedAt: '2026-08-06T00:00:00.000Z', temperature: 3 },
      legacy: { temperature: 4 },
    };
    expect(weatherCacheEntryDate(cache.legacy)).toBeNull();
    expect(weatherCacheEntryDate(cache['2019-01-01'])).toBe('2019-01-01');

    // Undated legacy records are evicted first, then the oldest dates.
    expect(pruneWeatherCache(cache, { maxEntries: 3 })).toBe(1);
    expect(Object.keys(cache).sort()).toEqual(['2019-01-01', '2021-01-01', '2026-08-05']);
    expect(pruneWeatherCache(cache, { maxEntries: 3 })).toBe(0);

    expect(pruneWeatherCache(cache, { minDate: '2020-01-01' })).toBe(1);
    expect(Object.keys(cache).sort()).toEqual(['2021-01-01', '2026-08-05']);
  });

  it('never drops backfilled history whose fetch is older than 90 days', () => {
    const history: Record<string, any> = {};
    for (let day = 1; day <= 200; day += 1) {
      const month = String(Math.ceil(day / 28)).padStart(2, '0');
      const dayOfMonth = String(((day - 1) % 28) + 1).padStart(2, '0');
      const date = `2021-${month}-${dayOfMonth}`;
      history[date] = { date, fetchedAt: '2021-01-01T00:00:00.000Z', temperature: day };
    }

    expect(pruneWeatherCache(history)).toBe(0);
    expect(Object.keys(history)).toHaveLength(200);
  });
});
