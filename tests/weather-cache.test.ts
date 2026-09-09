import { describe, expect, it } from 'vitest';
import { isSnapshotStale, migrateCompatibleSnapshot, weatherConfigKey } from '../src/weather-cache';

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
});
