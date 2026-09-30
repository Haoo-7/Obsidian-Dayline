// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import {
  GEOCODER_CACHE_MAX_ENTRIES,
  GEOCODER_CACHE_TTL_MS,
  GEOCODER_USER_AGENT,
  ReverseGeocoder,
  geocoderLanguageTag,
  normalizeGeocoderLanguage,
} from '../src/image-metadata';

describe('persistent reverse geocoder', () => {
  it('sends a localized Accept-Language tag and reuses persisted names by language', async () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const store: Record<string, unknown> = {};
    const request = vi.fn(({ url }: { url: string }) => {
      const language = new URL(url).searchParams.get('accept-language');
      return Promise.resolve({ status: 200, json: { address: { city: language === 'zh-CN' ? '北京' : 'Beijing' } } });
    });
    const first = new ReverseGeocoder({ cache: store, request, now: () => now, minRequestIntervalMs: 0 });

    await expect(first.lookup(39.9042001, 116.4074001, 'en')).resolves.toBe('Beijing');
    await expect(first.lookup(39.9042001, 116.4074001, 'zh')).resolves.toBe('北京');
    expect(request).toHaveBeenCalledTimes(2);
    expect(Object.keys(store).sort()).toEqual([
      '39.904,116.407|en',
      '39.904,116.407|zh',
    ]);

    const restoredRequest = vi.fn();
    const restored = new ReverseGeocoder({ cache: store, request: restoredRequest, now: () => now, minRequestIntervalMs: 0 });
    await expect(restored.lookup(39.9042, 116.4074, 'en')).resolves.toBe('Beijing');
    expect(restoredRequest).not.toHaveBeenCalled();
  });

  it('negatively caches failed lookups for a bounded window', async () => {
    let now = Date.parse('2026-08-06T12:00:00.000Z');
    const request = vi.fn().mockResolvedValue({ status: 503, json: null });
    const store: Record<string, unknown> = {};
    const geocoder = new ReverseGeocoder({
      cache: store,
      request,
      now: () => now,
      minRequestIntervalMs: 0,
      negativeTtlMs: 10 * 60 * 1000,
    });

    await expect(geocoder.lookup(1, 2, 'en')).resolves.toBeNull();
    now += 60 * 1000;
    await expect(geocoder.lookup(1, 2, 'en')).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    // A failure is never persisted as a successful place name.
    expect(store).toEqual({});

    now += 10 * 60 * 1000;
    await expect(geocoder.lookup(1, 2, 'en')).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('re-requests immediately when negative caching is disabled', async () => {
    const request = vi.fn().mockResolvedValue({ status: 503, json: null });
    const geocoder = new ReverseGeocoder({ request, minRequestIntervalMs: 0, negativeTtlMs: 0 });

    await expect(geocoder.lookup(1, 2, 'en')).resolves.toBeNull();
    await expect(geocoder.lookup(1, 2, 'en')).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('sends a versioned User-Agent with the repository URL and 3-decimal coordinates', async () => {
    const store: Record<string, unknown> = {};
    const request = vi.fn(({ url }: { url: string }) => Promise.resolve({
      status: 200,
      json: { display_name: `place-${new URL(url).searchParams.get('lat')}` },
    }));
    const geocoder = new ReverseGeocoder({ cache: store, request, minRequestIntervalMs: 0 });

    await expect(geocoder.lookup(39.9042001, 116.4074001, 'en')).resolves.toBe('place-39.904');

    const first = request.mock.calls[0][0] as { url: string; headers: Record<string, string> };
    const url = new URL(first.url);
    expect(url.searchParams.get('lat')).toBe('39.904');
    expect(url.searchParams.get('lon')).toBe('116.407');
    expect(first.headers['User-Agent']).toMatch(/ObsidianDayline\/\d+\.\d+\.\d+/);
    expect(first.headers['User-Agent']).toContain('https://github.com/Haoo-7/Obsidian-Dayline');
    expect(first.headers['User-Agent']).toBe(GEOCODER_USER_AGENT);
    expect(Object.keys(store)).toEqual(['39.904,116.407|en']);

    // A sub-3-decimal change reuses the same rounded location.
    await expect(geocoder.lookup(39.9044001, 116.4074, 'en')).resolves.toBe('place-39.904');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicit user agent and times out a hung request', async () => {
    const request = vi.fn((_request: { headers: Record<string, string> }) => new Promise(() => undefined));
    const geocoder = new ReverseGeocoder({
      request,
      minRequestIntervalMs: 0,
      userAgent: 'ObsidianDayline/test (+https://example.test)',
      requestTimeoutMs: 30,
    });

    const pending = geocoder.lookup(1, 2, 'en');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request.mock.calls[0][0].headers['User-Agent']).toBe('ObsidianDayline/test (+https://example.test)');

    await expect(pending).resolves.toBeNull();
    // A timed-out request must not block the serial queue for later lookups.
    await expect(geocoder.lookup(3, 4, 'en')).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  }, 2000);

  it('expires old records and bounds persistent cache size', async () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const store: Record<string, any> = {
      '1.000,2.000|en': { name: 'Expired', cachedAt: new Date(now - GEOCODER_CACHE_TTL_MS - 1).toISOString() },
      '3.000,4.000|en': { name: 'Keep', cachedAt: new Date(now - 100).toISOString() },
    };
    const request = vi.fn(({ url }: { url: string }) => Promise.resolve({
      status: 200,
      json: { display_name: new URL(url).searchParams.get('lat') },
    }));
    const geocoder = new ReverseGeocoder({
      cache: store,
      request,
      now: () => now,
      minRequestIntervalMs: 0,
      ttlMs: GEOCODER_CACHE_TTL_MS,
      maxEntries: 2,
    });

    expect(store).not.toHaveProperty('1.000,2.000|en');
    await geocoder.lookup(5, 6, 'en');
    await geocoder.lookup(7, 8, 'en');

    expect(Object.keys(store).length).toBeLessThanOrEqual(2);
    expect(Object.keys(store)).not.toContain('3.000,4.000|en');
    expect(GEOCODER_CACHE_MAX_ENTRIES).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates in-flight lookups and keeps the rate-limit delay injectable', async () => {
    let resolveRequest!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const geocoder = new ReverseGeocoder({
      request,
      minRequestIntervalMs: 1000,
      sleep,
      now: () => Date.parse('2026-08-06T12:00:00.000Z'),
    });

    const first = geocoder.lookup(1, 2, 'en');
    const second = geocoder.lookup(1, 2, 'en');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledTimes(1);
    resolveRequest({ status: 200, json: { display_name: 'A' } });
    await expect(Promise.all([first, second])).resolves.toEqual(['A', 'A']);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('reverse geocoder language support', () => {
  it('normalizes locale tags to one canonical code per supported language', () => {
    expect(normalizeGeocoderLanguage('en')).toBe('en');
    expect(normalizeGeocoderLanguage('en-GB')).toBe('en');
    expect(normalizeGeocoderLanguage('zh')).toBe('zh');
    expect(normalizeGeocoderLanguage('zh-Hans')).toBe('zh');
    expect(normalizeGeocoderLanguage('zh-Hant-TW')).toBe('zh-tw');
    expect(normalizeGeocoderLanguage('zh_TW')).toBe('zh-tw');
    expect(normalizeGeocoderLanguage('zh-HK')).toBe('zh-tw');
    expect(normalizeGeocoderLanguage('JA')).toBe('ja');
    expect(normalizeGeocoderLanguage('ja-JP')).toBe('ja');
    expect(normalizeGeocoderLanguage('ko-KR')).toBe('ko');
    expect(normalizeGeocoderLanguage('fr-FR')).toBe('fr');
    expect(normalizeGeocoderLanguage('de')).toBe('de');
    expect(normalizeGeocoderLanguage('es-ES')).toBe('es');
    expect(normalizeGeocoderLanguage('ru-RU')).toBe('ru');
    // Unknown languages fall back to English instead of guessing a locale.
    expect(normalizeGeocoderLanguage('pt-BR')).toBe('en');
    expect(normalizeGeocoderLanguage('')).toBe('en');
    expect(normalizeGeocoderLanguage(undefined)).toBe('en');
  });

  it('maps canonical codes to Nominatim Accept-Language tags', () => {
    expect(geocoderLanguageTag('en')).toBe('en-US');
    expect(geocoderLanguageTag('zh')).toBe('zh-CN');
    expect(geocoderLanguageTag('zh-TW')).toBe('zh-TW');
    expect(geocoderLanguageTag('ja')).toBe('ja-JP');
    expect(geocoderLanguageTag('ko')).toBe('ko-KR');
    expect(geocoderLanguageTag('fr')).toBe('fr-FR');
    expect(geocoderLanguageTag('de')).toBe('de-DE');
    expect(geocoderLanguageTag('es')).toBe('es-ES');
    expect(geocoderLanguageTag('ru')).toBe('ru-RU');
  });

  it('requests and caches one place name per language', async () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const store: Record<string, unknown> = {};
    const requested: string[] = [];
    const request = vi.fn(({ url }: { url: string }) => {
      const language = new URL(url).searchParams.get('accept-language') as string;
      requested.push(language);
      return Promise.resolve({ status: 200, json: { address: { city: `city-${language}` } } });
    });
    const geocoder = new ReverseGeocoder({ cache: store, request, now: () => now, minRequestIntervalMs: 0 });

    await expect(geocoder.lookup(1, 2, 'ja')).resolves.toBe('city-ja-JP');
    await expect(geocoder.lookup(1, 2, 'zh-TW')).resolves.toBe('city-zh-TW');
    await expect(geocoder.lookup(1, 2, 'pt-BR')).resolves.toBe('city-en-US');
    // The same language in another case or tag form reuses the cached name.
    await expect(geocoder.lookup(1, 2, 'zh-tw')).resolves.toBe('city-zh-TW');
    await expect(geocoder.lookup(1, 2, 'zh-Hant')).resolves.toBe('city-zh-TW');

    expect(requested).toEqual(['ja-JP', 'zh-TW', 'en-US']);
    expect(Object.keys(store).sort()).toEqual([
      '1.000,2.000|en',
      '1.000,2.000|ja',
      '1.000,2.000|zh-tw',
    ]);
  });

  it('uses the injected language provider as the default', async () => {
    const request = vi.fn(({ url }: { url: string }) => Promise.resolve({
      status: 200,
      json: { address: { city: new URL(url).searchParams.get('accept-language') } },
    }));
    const geocoder = new ReverseGeocoder({
      request,
      minRequestIntervalMs: 0,
      getLanguage: () => 'ru',
    });

    await expect(geocoder.lookup(1, 2)).resolves.toBe('ru-RU');
  });
});
