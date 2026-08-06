import { describe, expect, it } from 'vitest';
import {
  buildWeatherExtraParts,
  buildWeatherStatus,
  formatWeatherTime,
} from '../src/weather-display';
import { t } from '../src/i18n';
import { localize } from '../src/locale';

describe('weather card display details', () => {
  const labels = {
    precipitation: 'Rain chance',
    wind: 'Wind',
    sunrise: 'Sunrise',
    sunset: 'Sunset',
    cached: 'Cached',
    stale: 'Stale',
    offline: 'Offline',
  };

  it('keeps Open-Meteo local times stable across host timezones', () => {
    expect(formatWeatherTime('2026-08-06T05:18', 'en', 'Pacific/Kiritimati')).toBe('05:18');
    expect(formatWeatherTime('2026-08-06T19:32', 'zh', 'America/Los_Angeles')).toBe('19:32');
  });

  it('formats metric and imperial extended values', () => {
    expect(buildWeatherExtraParts({
      units: 'metric',
      precipitationProbability: 35,
      windSpeed: 18.7,
      sunrise: '2026-08-06T05:18',
      sunset: '2026-08-06T19:32',
    }, labels)).toEqual([
      'Rain chance 35%',
      'Wind 19 km/h',
      'Sunrise 05:18',
      'Sunset 19:32',
    ]);
    expect(buildWeatherExtraParts({ units: 'imperial', windSpeed: 12.4 }, labels)).toEqual(['Wind 12 mph']);
  });

  it('exposes cached, stale, and offline status together only for fallback snapshots', () => {
    expect(buildWeatherStatus({ stale: true, offline: true }, labels)).toEqual(['Cached', 'Stale', 'Offline']);
    expect(buildWeatherStatus({}, labels)).toEqual([]);
  });

  it('keeps weather and journal location labels distinct', () => {
    expect(localize('en', 'weatherLocation')).toBe('Weather location');
    expect(t({ displayLanguage: 'en' }, 'journalLocation')).toBe('Journal location');
    expect(localize('zh', 'weatherLocation')).not.toBe(t({ displayLanguage: 'zh' }, 'journalLocation'));
  });
});
