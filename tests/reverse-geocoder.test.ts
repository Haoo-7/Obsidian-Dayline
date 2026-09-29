import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import {
  GEOCODER_CACHE_MAX_ENTRIES,
  GEOCODER_CACHE_TTL_MS,
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
      '39.90420,116.40740|en',
      '39.90420,116.40740|zh',
    ]);

    const restoredRequest = vi.fn();
    const restored = new ReverseGeocoder({ cache: store, request: restoredRequest, now: () => now, minRequestIntervalMs: 0 });
    await expect(restored.lookup(39.9042, 116.4074, 'en')).resolves.toBe('Beijing');
    expect(restoredRequest).not.toHaveBeenCalled();
  });

  it('does not cache transient failures or empty names', async () => {
    const request = vi.fn().mockResolvedValue({ status: 503, json: null });
    const store: Record<string, unknown> = {};
    const geocoder = new ReverseGeocoder({ cache: store, request, minRequestIntervalMs: 0 });

    await expect(geocoder.lookup(1, 2, 'en')).resolves.toBeNull();
    await expect(geocoder.lookup(1, 2, 'en')).resolves.toBeNull();

    expect(request).toHaveBeenCalledTimes(2);
    expect(store).toEqual({});
  });

  it('expires old records and bounds persistent cache size', async () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const store: Record<string, any> = {
      '1.00000,2.00000|en': { name: 'Expired', cachedAt: new Date(now - GEOCODER_CACHE_TTL_MS - 1).toISOString() },
      '3.00000,4.00000|en': { name: 'Keep', cachedAt: new Date(now - 100).toISOString() },
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

    expect(store).not.toHaveProperty('1.00000,2.00000|en');
    await geocoder.lookup(5, 6, 'en');
    await geocoder.lookup(7, 8, 'en');

    expect(Object.keys(store).length).toBeLessThanOrEqual(2);
    expect(Object.keys(store)).not.toContain('3.00000,4.00000|en');
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
      '1.00000,2.00000|en',
      '1.00000,2.00000|ja',
      '1.00000,2.00000|zh-tw',
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
