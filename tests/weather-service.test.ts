import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  TFile: class TFile {},
  requestUrl: vi.fn(),
}));

import {
  WeatherService,
  getWeatherRetryDelay,
  isRetryableWeatherFailure,
  requestWeatherWithRetry,
} from '../src/weather-service';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');

function makePlugin(overrides: Record<string, unknown> = {}) {
  const { weatherCache, ...settingsOverrides } = overrides;
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
    app: {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getFileCache: () => null },
    },
    _saveWeatherCache: vi.fn(),
  } as any;
}

function dailyPayload(date = '2026-08-06') {
  return {
    time: [date],
    temperature_2m_max: [31.2],
    temperature_2m_min: [23.4],
    weathercode: [2],
    relative_humidity_2m_max: [72],
    apparent_temperature_max: [33.1],
    precipitation_probability_max: [35],
    wind_speed_10m_max: [18.7],
    sunrise: [`${date}T05:18`],
    sunset: [`${date}T19:32`],
  };
}

describe('weather retry and cache reliability', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('does not refresh a fresh cache entry', async () => {
    const cached = {
      fetchedAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
      weatherCode: 2,
    };
    const request = vi.fn();
    const plugin = makePlugin({ weatherCache: { '2026-08-06': cached } });
    const service = new WeatherService(plugin, { request, now: () => NOW });

    const result = await service.getSnapshot('2026-08-06');

    expect(result).toMatchObject(cached);
    expect(result).not.toHaveProperty('stale');
    expect(result).not.toHaveProperty('offline');
    expect(request).not.toHaveBeenCalled();
  });

  it('returns a cloned stale offline snapshot after three network failures', async () => {
    const cached = {
      fetchedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
      weatherCode: 2,
    };
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const plugin = makePlugin({ weatherCache: { '2026-08-06': cached } });
    const service = new WeatherService(plugin, { request, sleep, now: () => NOW });

    const result = await service.getSnapshot('2026-08-06');

    expect(result).not.toBe(cached);
    expect(result).toMatchObject({ temperature: 28, stale: true, offline: true });
    expect(cached).not.toHaveProperty('offline');
    expect(plugin._saveWeatherCache).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([250, 500]);
  });

  it('returns stale offline data after exhausting retryable server failures', async () => {
    const cached = {
      fetchedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
      weatherCode: 2,
    };
    const request = vi.fn().mockResolvedValue({ status: 503 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const plugin = makePlugin({ weatherCache: { '2026-08-06': cached } });
    const service = new WeatherService(plugin, { request, sleep, now: () => NOW });

    const result = await service.getSnapshot('2026-08-06');

    expect(result).toMatchObject({ temperature: 28, stale: true, offline: true });
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([250, 500]);
    expect(plugin._saveWeatherCache).not.toHaveBeenCalled();
  });

  it('returns stale-only data after one ordinary 400 response', async () => {
    const cached = {
      fetchedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
      weatherCode: 2,
    };
    const request = vi.fn().mockResolvedValue({ status: 400, json: { reason: 'bad request' } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const plugin = makePlugin({ weatherCache: { '2026-08-06': cached } });
    const service = new WeatherService(plugin, { request, sleep, now: () => NOW });

    const result = await service.getSnapshot('2026-08-06');

    expect(result).toMatchObject({ temperature: 28, stale: true });
    expect(result).not.toHaveProperty('offline');
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(plugin.weatherCache['2026-08-06']).toEqual(cached);
    expect(plugin._saveWeatherCache).not.toHaveBeenCalled();
  });

  it('preserves null behavior for a failed refresh without usable cache', async () => {
    const request = vi.fn().mockResolvedValue({ status: 400 });
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request, now: () => NOW });

    await expect(service.getSnapshot('2026-08-06')).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('returns stale-only data after a structurally unusable 200 response', async () => {
    const cached = {
      fetchedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
      weatherCode: 2,
    };
    const request = vi.fn().mockResolvedValue({ status: 200, json: {} });
    const plugin = makePlugin({ weatherCache: { '2026-08-06': cached } });
    const service = new WeatherService(plugin, { request, now: () => NOW });

    const result = await service.getSnapshot('2026-08-06');

    expect(result).toMatchObject({ temperature: 28, stale: true });
    expect(result).not.toHaveProperty('offline');
    expect(request).toHaveBeenCalledTimes(1);
    expect(plugin.weatherCache['2026-08-06']).toEqual(cached);
    expect(plugin._saveWeatherCache).not.toHaveBeenCalled();
  });

  it('does not label a 200 parser exception as offline', async () => {
    const cached = {
      fetchedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
      weatherCode: 2,
    };
    const malformedJson = {
      get current() {
        throw new Error('malformed current payload');
      },
    };
    const request = vi.fn().mockResolvedValue({ status: 200, json: malformedJson });
    const plugin = makePlugin({ weatherCache: { '2026-08-06': cached } });
    const service = new WeatherService(plugin, { request, now: () => NOW });

    const result = await service.getSnapshot('2026-08-06');

    expect(result).toMatchObject({ temperature: 28, stale: true });
    expect(result).not.toHaveProperty('offline');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('revalidates the same date after an injected clock crosses the cache TTL', async () => {
    let now = NOW;
    const request = vi.fn().mockImplementation(() => Promise.resolve({
      status: 200,
      json: {
        current: {
          temperature_2m: 28,
          relative_humidity_2m: 61,
          apparent_temperature: 30,
          weather_code: 1,
          wind_speed_10m: 12,
        },
        daily: dailyPayload('2026-08-06'),
      },
    }));
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request, now: () => now });

    await expect(service.getSnapshot('2026-08-06')).resolves.toMatchObject({ date: '2026-08-06' });
    expect(request).toHaveBeenCalledTimes(1);

    now += 2 * 60 * 60 * 1000 + 1;
    await expect(service.getSnapshot('2026-08-06')).resolves.toMatchObject({ date: '2026-08-06' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never persists transient stale or offline flags', async () => {
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    await service._persistSnapshot('2026-08-06', {
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
      stale: true,
      offline: true,
    });

    expect(plugin.weatherCache['2026-08-06']).toMatchObject({ temperature: 28 });
    expect(plugin.weatherCache['2026-08-06']).not.toHaveProperty('stale');
    expect(plugin.weatherCache['2026-08-06']).not.toHaveProperty('offline');
  });

  it('deduplicates concurrent stale fallback requests', async () => {
    const cached = {
      fetchedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
    };
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    const plugin = makePlugin({ weatherCache: { '2026-08-06': cached } });
    const service = new WeatherService(plugin, { request, sleep: vi.fn(), now: () => NOW });

    const [first, second] = await Promise.all([
      service.getSnapshot('2026-08-06'),
      service.getSnapshot('2026-08-06'),
    ]);

    expect(first).toBe(second);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('retries only eligible failures and clamps attempts to three', async () => {
    expect(isRetryableWeatherFailure(new Error('network'))).toBe(true);
    expect(isRetryableWeatherFailure({ status: 408 })).toBe(true);
    expect(isRetryableWeatherFailure({ status: 429 })).toBe(true);
    expect(isRetryableWeatherFailure({ status: 500 })).toBe(true);
    expect(isRetryableWeatherFailure({ status: 404 })).toBe(false);
    expect(getWeatherRetryDelay(1)).toBe(250);
    expect(getWeatherRetryDelay(2)).toBe(500);
    expect(getWeatherRetryDelay(3)).toBe(1000);

    const request = vi.fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ status: 200, json: { ok: true } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(requestWeatherWithRetry(request, {
      maxAttempts: 99,
      sleep,
    })).resolves.toMatchObject({ status: 200 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const ordinaryClientError = vi.fn().mockResolvedValue({ status: 400 });
    await expect(requestWeatherWithRetry(ordinaryClientError, { sleep })).rejects.toMatchObject({ status: 400 });
    expect(ordinaryClientError).toHaveBeenCalledTimes(1);
  });

  it('parses extended fields for current and forecast responses', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      json: {
        current: {
          temperature_2m: 28.4,
          relative_humidity_2m: 61,
          apparent_temperature: 30.1,
          weather_code: 1,
          wind_speed_10m: 12.4,
        },
        daily: dailyPayload(),
      },
    });
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request, now: () => NOW });

    const result = await service.getSnapshot('2026-08-06');
    const url = request.mock.calls[0][0].url as string;

    expect(result).toMatchObject({
      precipitationProbability: 35,
      windSpeed: 12.4,
      sunrise: '2026-08-06T05:18',
      sunset: '2026-08-06T19:32',
    });
    expect(url).toContain('precipitation_probability_max');
    expect(url).toContain('wind_speed_10m_max');
    expect(url).toContain('sunrise');
    expect(url).toContain('sunset');
  });

  it('keeps old cache records compatible and avoids forecast-only fields in archive requests', async () => {
    const archiveDaily = dailyPayload('2026-08-05');
    delete (archiveDaily as any).precipitation_probability_max;
    const request = vi.fn().mockResolvedValue({
      status: 200,
      json: { daily: archiveDaily },
    });
    const oldCache = {
      fetchedAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 28,
    };
    const oldPlugin = makePlugin({ weatherCache: { '2026-08-06': oldCache } });
    const oldService = new WeatherService(oldPlugin, { request: vi.fn(), now: () => NOW });
    await expect(oldService.getSnapshot('2026-08-06')).resolves.toMatchObject(oldCache);
    expect(oldService.getCachedSnapshot('2026-08-06', undefined)).not.toHaveProperty('precipitationProbability');

    const archivePlugin = makePlugin();
    const archiveService = new WeatherService(archivePlugin, { request, now: () => NOW });
    const result = await archiveService.getSnapshot('2026-08-05');
    const url = request.mock.calls[0][0].url as string;

    expect(result).toMatchObject({ precipitationProbability: null, windSpeed: 18.7 });
    expect(url).toContain('wind_speed_10m_max');
    expect(url).not.toContain('precipitation_probability_max');
  });
});
