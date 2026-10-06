import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  TFile: class TFile {},
  requestUrl: vi.fn(),
}));

import {
  WeatherService,
  WEATHER_REQUEST_TIMEOUT_MS,
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

  it('does not relabel or persist an old request after the weather configuration changes', async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    const request = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const plugin = makePlugin({
      weatherLatitude: '31.2304',
      weatherLongitude: '121.4737',
      weatherTimezone: 'Asia/Shanghai',
      weatherLocationName: 'Shanghai',
    });
    const service = new WeatherService(plugin, { request, now: () => NOW });
    const pending = service.getSnapshot('2026-08-06');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    plugin.settings.weatherLatitude = '40.7128';
    plugin.settings.weatherLongitude = '-74.0060';
    plugin.settings.weatherTimezone = 'America/New_York';
    plugin.settings.weatherLocationName = 'New York';
    resolveRequest({ status: 200, json: { daily: dailyPayload() } });

    const result = await pending;
    expect(result).toMatchObject({ latitude: 31.2304, longitude: 121.4737, location: 'Shanghai' });
    expect(result.configKey).toContain('Asia/Shanghai');
    expect(result.configKey).not.toContain('America/New_York');
    expect(plugin.weatherCache['2026-08-06']).toBeUndefined();
    expect(plugin._saveWeatherCache).not.toHaveBeenCalled();
    expect(service.isSnapshotCompatible(result)).toBe(false);
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
    const oldDate = '2021-08-05';
    const archiveDaily = dailyPayload(oldDate);
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
    const result = await archiveService.forceRefresh(oldDate);
    const url = request.mock.calls[0][0].url as string;

    expect(result).toMatchObject({ precipitationProbability: null, windSpeed: 18.7 });
    expect(url).toContain('https://archive-api.open-meteo.com/v1/archive');
    expect(url).toContain('wind_speed_10m_max');
    expect(url).not.toContain('precipitation_probability_max');
  });

  it('aborts a hung weather request instead of leaving the card loading', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn().mockImplementation(() => new Promise(() => undefined));
      const plugin = makePlugin();
      const service = new WeatherService(plugin, {
        request,
        now: () => NOW,
        maxAttempts: 1,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const pending = service.getSnapshot('2026-08-06');
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(WEATHER_REQUEST_TIMEOUT_MS);
      await Promise.resolve();

      expect(settled).toBe(true);
      await expect(pending).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][0]).not.toHaveProperty('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not refetch an archive snapshot for a historical date', async () => {
    const historical = {
      fetchedAt: '2021-03-05T09:00:00.000Z',
      date: '2021-03-05',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 12,
      weatherCode: 3,
    };
    const request = vi.fn();
    const plugin = makePlugin({ weatherCache: { '2021-03-05': historical } });
    const service = new WeatherService(plugin, { request, now: () => NOW });

    await expect(service.getSnapshot('2021-03-05')).resolves.toMatchObject({ temperature: 12 });
    expect(request).not.toHaveBeenCalled();
    expect(service._shouldFetch(historical, 2)).toBe(false);
  });

  it('still refetches a stale snapshot for a recent date', async () => {
    const recent = {
      fetchedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
      date: '2026-08-05',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 12,
      weatherCode: 3,
    };
    const request = vi.fn().mockResolvedValue({ status: 200, json: { daily: dailyPayload('2026-08-05') } });
    const plugin = makePlugin({ weatherCache: { '2026-08-05': recent } });
    const service = new WeatherService(plugin, { request, now: () => NOW });

    await service.getSnapshot('2026-08-05');

    expect(request).toHaveBeenCalledTimes(1);
    expect(service._shouldFetch(recent, 2)).toBe(true);
  });

  it('keeps backfilled history when persisting a new day', async () => {
    const plugin = makePlugin({
      weatherCache: {
        '2021-03-05': {
          date: '2021-03-05',
          fetchedAt: '2021-03-05T09:00:00.000Z',
          latitude: 39.9042,
          longitude: 116.4074,
          units: 'metric',
          temperature: 12,
        },
      },
    });
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });

    await service._persistSnapshot('2026-08-06', {
      date: '2026-08-06',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 30,
    });

    expect(plugin.weatherCache['2021-03-05']).toMatchObject({ temperature: 12 });
    expect(plugin.weatherCache['2026-08-06']).toMatchObject({ temperature: 30 });
  });

  it('requests recent past days from the forecast host, not the archive host', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, json: { daily: dailyPayload('2026-08-05') } });
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request, now: () => NOW });

    await service.getSnapshot('2026-08-05');

    const url = request.mock.calls[0][0].url as string;
    expect(url).toContain('https://api.open-meteo.com/v1/forecast');
    expect(url).not.toContain('archive-api');
    expect(url).toContain('start_date=2026-08-05');
    expect(url).toContain('past_days=1');
  });

  it('routes settled history to the archive and the recent window to the forecast API', () => {
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request: vi.fn(), now: () => NOW });
    const context = service._requestContext();
    const build = (dateStr: string) => service._buildWeatherUrl(39.9042, 116.4074, dateStr, 'metric', context);
    expect(context.today).toBe('2026-08-06');

    expect(build('2026-08-02')).toContain('https://api.open-meteo.com/v1/forecast');
    expect(build('2026-08-02')).toContain('past_days=4');
    expect(build('2026-07-30')).toContain('https://api.open-meteo.com/v1/forecast');
    expect(build('2026-07-29')).toContain('https://archive-api.open-meteo.com/v1/archive');
    expect(build('2021-03-05')).not.toContain('past_days');
    expect(build('2021-03-05')).not.toContain('precipitation_probability_max');
    expect(build('2026-08-06')).not.toContain('past_days');
  });
});

describe('weather history pinning on review', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('does not register weather for an old date while reviewing it', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, json: { daily: dailyPayload('2021-03-05') } });
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request, now: () => NOW });

    await expect(service.getSnapshot('2021-03-05')).resolves.toBeNull();

    expect(request).not.toHaveBeenCalled();
    expect(plugin.weatherCache).toEqual({});
    expect(plugin._saveWeatherCache).not.toHaveBeenCalled();
  });

  it('still puts weather on an old empty date when the user explicitly refreshes', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, json: { daily: dailyPayload('2021-03-05') } });
    const plugin = makePlugin();
    const service = new WeatherService(plugin, { request, now: () => NOW });

    const result = await service.forceRefresh('2021-03-05');

    expect(result).toMatchObject({ date: '2021-03-05', temperature: 31, weatherCode: 2 });
    expect(plugin.weatherCache['2021-03-05']).toMatchObject({ temperature: 31 });
    expect(plugin._saveWeatherCache).toHaveBeenCalled();
    const url = request.mock.calls[0][0].url as string;
    expect(url).toContain('https://archive-api.open-meteo.com/v1/archive');
  });

  it('keeps a pinned historical record when a refresh comes back from a different place', async () => {
    const pinned = {
      fetchedAt: '2021-03-05T09:00:00.000Z',
      date: '2021-03-05',
      latitude: 31.23,
      longitude: 121.47,
      units: 'metric',
      temperature: 9,
      weatherCode: 3,
    };
    const request = vi.fn().mockResolvedValue({ status: 200, json: { daily: dailyPayload('2021-03-05') } });
    const plugin = makePlugin({ weatherCache: { '2021-03-05': pinned } });
    const service = new WeatherService(plugin, { request, now: () => NOW });

    const result = await service.forceRefresh('2021-03-05');

    // The explicit refresh still answers with the requested day's forecast at
    // the configured place, but the only remaining copy of the old day stays.
    expect(result).toMatchObject({ temperature: 31 });
    expect(plugin.weatherCache['2021-03-05']).toMatchObject({ latitude: 31.23, temperature: 9 });
    expect(plugin._saveWeatherCache).not.toHaveBeenCalled();
  });

  it('lets a same-place refresh update a historical record', async () => {
    const pinned = {
      fetchedAt: '2021-03-05T09:00:00.000Z',
      date: '2021-03-05',
      latitude: 39.9042,
      longitude: 116.4074,
      units: 'metric',
      temperature: 9,
      weatherCode: 3,
    };
    const request = vi.fn().mockResolvedValue({ status: 200, json: { daily: dailyPayload('2021-03-05') } });
    const plugin = makePlugin({ weatherCache: { '2021-03-05': pinned } });
    const service = new WeatherService(plugin, { request, now: () => NOW });

    await service.forceRefresh('2021-03-05');

    expect(plugin.weatherCache['2021-03-05']).toMatchObject({ latitude: 39.9042, temperature: 31 });
    expect(plugin._saveWeatherCache).toHaveBeenCalled();
  });
});
