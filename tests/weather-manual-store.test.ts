import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  TFile: class TFile {},
  requestUrl: vi.fn(),
}));

import { WeatherService } from '../src/weather-service';

const NOW = Date.parse('2026-10-26T07:30:00.000Z');

function makePlugin(overrides: Record<string, unknown> = {}) {
  const { weatherCache, weatherManualTemperature, ...settingsOverrides } = overrides;
  return {
    settings: {
      weatherEnabled: true,
      weatherLatitude: '39.9042',
      weatherLongitude: '116.4074',
      weatherUnits: 'metric',
      weatherTimezone: 'UTC',
      weatherTtlHours: 2,
      dailyFolder: 'Calendar/Daily',
      weatherLocationName: 'Beijing',
      ...settingsOverrides,
    },
    weatherCache: weatherCache || {},
    ...(weatherManualTemperature === undefined ? {} : { weatherManualTemperature }),
    _weatherManualDeleted: new Set(),
    app: {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getFileCache: () => null },
    },
    _saveWeatherCache: vi.fn(),
  } as any;
}

describe('manual weather reading storage', () => {
  it('stores a reading with its wall clock and save timestamp', () => {
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    const record = service.setManualTemperature('2026-10-26', 18, '15:30');

    expect(record).toEqual({
      celsius: 18,
      time: '15:30',
      recordedAt: new Date(NOW).toISOString(),
    });
    expect(plugin.weatherManualTemperature['2026-10-26']).toEqual(record);
    expect(plugin._saveWeatherCache).toHaveBeenCalledTimes(1);
    expect(service.getManualTemperature('2026-10-26')).toEqual(record);
    expect(service.hasManualTemperature('2026-10-26')).toBe(true);
    expect(plugin._weatherManualDeleted.has('2026-10-26')).toBe(false);
  });

  it('creates the plugin-owned map when an older data.json has none', () => {
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    expect(plugin.weatherManualTemperature).toBeUndefined();
    service.setManualTemperature('2026-10-26', 18, '12:00');

    expect(plugin.weatherManualTemperature).toEqual({
      '2026-10-26': expect.objectContaining({ celsius: 18, time: '12:00' }),
    });
  });

  it('falls back to the current wall clock when the time is unusable', () => {
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    service.setManualTemperature('2026-10-26', 18, '');
    expect(service.getManualTemperature('2026-10-26')?.time).toBe('07:30');

    service.setManualTemperature('2026-10-27', 18, '25:99');
    expect(service.getManualTemperature('2026-10-27')?.time).toBe('07:30');
  });

  it('deletes the record when cleared', () => {
    const plugin = makePlugin({
      weatherManualTemperature: {
        '2026-10-26': { celsius: 18, time: '15:30', recordedAt: '2026-10-26T15:30:00.000Z' },
      },
    });
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    expect(service.setManualTemperature('2026-10-26', null)).toBeNull();

    expect(plugin.weatherManualTemperature).toEqual({});
    expect(service.hasManualTemperature('2026-10-26')).toBe(false);
    expect(plugin._saveWeatherCache).toHaveBeenCalledTimes(1);
    // The removal must survive the additive on-disk merge, or a reload would
    // restore the reading the user just cleared.
    expect(plugin._weatherManualDeleted.has('2026-10-26')).toBe(true);
  });

  it('ignores a non-numeric reading and writes nothing', () => {
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    expect(service.setManualTemperature('2026-10-26', Number.NaN, '15:30')).toBeNull();
    expect(plugin.weatherManualTemperature).toEqual({});
    expect(plugin._saveWeatherCache).not.toHaveBeenCalled();
  });

  it('rounds stored Celsius to one decimal', () => {
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    const record = service.setManualTemperature('2026-10-26', 18.26, '15:30');

    expect(record).toMatchObject({ celsius: 18.3 });
  });
});

describe('manual reading display resolution', () => {
  it('prefers the manual reading over the snapshot in the active unit', () => {
    const plugin = makePlugin({
      weatherManualTemperature: {
        '2026-10-26': { celsius: 20, time: '15:30', recordedAt: '2026-10-26T15:30:00.000Z' },
      },
    });
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    expect(service.resolveDisplayTemperature('2026-10-26', { temperature: 31 })).toBe(20);
  });

  it('converts the reading when the user switches to imperial', () => {
    const plugin = makePlugin({
      weatherUnits: 'imperial',
      weatherManualTemperature: {
        '2026-10-26': { celsius: 20, time: '15:30', recordedAt: '2026-10-26T15:30:00.000Z' },
      },
    });
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    expect(service.resolveDisplayTemperature('2026-10-26', { temperature: 70 })).toBe(68);
  });

  it('falls back to the snapshot when the date has no reading', () => {
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    expect(service.resolveDisplayTemperature('2026-10-26', { temperature: 31 })).toBe(31);
    expect(service.resolveDisplayTemperature('2026-10-26', null)).toBeNull();
  });
});

describe('manual readings survive the forecast cache lifecycle', () => {
  const reading = { celsius: 18, time: '15:30', recordedAt: '2026-10-26T15:30:00.000Z' };

  it('is not overwritten when a refresh persists a new snapshot', async () => {
    const plugin = makePlugin({
      weatherCache: {},
      weatherManualTemperature: { '2026-10-26': { ...reading } },
    });
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    await service._persistSnapshot('2026-10-26', {
      date: '2026-10-26',
      fetchedAt: new Date(NOW).toISOString(),
      temperature: 24,
      weatherCode: 1,
      units: 'metric',
      latitude: 39.9042,
      longitude: 116.4074,
      configKey: undefined,
    });

    expect(plugin.weatherCache['2026-10-26']).toMatchObject({ temperature: 24 });
    expect(plugin.weatherManualTemperature['2026-10-26']).toEqual(reading);
    expect(service.resolveDisplayTemperature('2026-10-26', plugin.weatherCache['2026-10-26'])).toBe(18);
  });

  it('is not overwritten when the cache is pruned', async () => {
    const { pruneWeatherCache } = await import('../src/weather-cache');
    const plugin = makePlugin({
      weatherCache: {},
      weatherManualTemperature: { '2026-10-26': { ...reading } },
    });
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    pruneWeatherCache(plugin.weatherCache, { maxEntries: 1, minDate: '2030-01-01' });

    expect(plugin.weatherCache).toEqual({});
    expect(service.getManualTemperature('2026-10-26')).toEqual(reading);
  });
});

describe('manual reading deletion survives the disk merge', () => {
  it('removes the date from the map that would be written back to data.json', async () => {
    const { mergeManualTemperatureMaps } = await import('../src/weather-manual');
    const reading = { celsius: 18, time: '15:30', recordedAt: '2026-10-26T15:30:00.000Z' };
    const plugin = makePlugin({ weatherManualTemperature: { '2026-10-26': reading } });
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    service.setManualTemperature('2026-10-26', null);

    const onDisk = { '2026-10-26': reading };
    const merged = mergeManualTemperatureMaps(
      onDisk,
      plugin.weatherManualTemperature,
      plugin._weatherManualDeleted,
    );
    expect(merged).toEqual({});
  });
});
