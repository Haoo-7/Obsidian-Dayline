import { describe, expect, it } from 'vitest';
import { lookupWeatherCode, weatherBadgeIcon } from '../src/weather-service';

describe('calendar weather badge icons', () => {
  it('keeps scene illustrations on the weather card mapping', () => {
    expect(lookupWeatherCode(0).icon).toBe('clear-day.svg');
    expect(lookupWeatherCode(2).icon).toBe('partly-cloudy-day.svg');
    expect(lookupWeatherCode(3).icon).toBe('overcast.svg');
    expect(lookupWeatherCode(61).icon).toBe('rain.svg');
    expect(lookupWeatherCode(95).icon).toBe('thunderstorms.svg');
  });

  it('maps WMO families to Lucide glyphs for date cells', () => {
    expect(lookupWeatherCode(0).badgeIcon).toBe('badge-sun.svg');
    expect(lookupWeatherCode(1).badgeIcon).toBe('badge-sun.svg');
    expect(lookupWeatherCode(2).badgeIcon).toBe('badge-cloud-sun.svg');
    expect(lookupWeatherCode(3).badgeIcon).toBe('badge-cloud.svg');
    expect(lookupWeatherCode(45).badgeIcon).toBe('badge-fog.svg');
    expect(lookupWeatherCode(51).badgeIcon).toBe('badge-drizzle.svg');
    expect(lookupWeatherCode(61).badgeIcon).toBe('badge-rain.svg');
    expect(lookupWeatherCode(80).badgeIcon).toBe('badge-rain.svg');
    expect(lookupWeatherCode(71).badgeIcon).toBe('badge-snow.svg');
    expect(lookupWeatherCode(95).badgeIcon).toBe('badge-storm.svg');
  });

  it('derives the badge from weatherCode first, then the scene icon', () => {
    expect(weatherBadgeIcon({ weatherCode: 63, icon: 'overcast.svg' })).toBe('badge-rain.svg');
    expect(weatherBadgeIcon({ icon: 'drizzle.svg' })).toBe('badge-drizzle.svg');
    expect(weatherBadgeIcon({ icon: 'unknown.svg' })).toBe('badge-cloud.svg');
    expect(weatherBadgeIcon(null)).toBe('badge-cloud.svg');
  });

  it('falls unknown WMO codes back to the overcast scene and cloud badge', () => {
    expect(lookupWeatherCode(1234)).toMatchObject({
      icon: 'overcast.svg',
      badgeIcon: 'badge-cloud.svg',
    });
  });
});
