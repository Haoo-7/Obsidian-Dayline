import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import {
  GEOCODER_CACHE_MAX_ENTRIES,
  GEOCODER_CACHE_TTL_MS,
  ReverseGeocoder,
} from '../src/image-metadata';

describe('persistent reverse geocoder', () => {
  it('uses effective language in the request and reuses persisted names by language', async () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const store: Record<string, unknown> = {};
    const request = vi.fn(({ url }: { url: string }) => {
      const language = new URL(url).searchParams.get('accept-language');
      return Promise.resolve({ status: 200, json: { address: { city: language === 'zh' ? '北京' : 'Beijing' } } });
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
