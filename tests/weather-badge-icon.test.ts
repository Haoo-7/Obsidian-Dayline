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

  it('maps WMO families to Phosphor glyphs for date cells', () => {
    expect(lookupWeatherCode(0).badgeIcon).toBe('sun-fill.svg');
    expect(lookupWeatherCode(1).badgeIcon).toBe('sun-fill.svg');
    expect(lookupWeatherCode(2).badgeIcon).toBe('cloud-fill.svg');
    expect(lookupWeatherCode(3).badgeIcon).toBe('cloud-fill.svg');
    expect(lookupWeatherCode(45).badgeIcon).toBe('cloud-fog-fill.svg');
    expect(lookupWeatherCode(51).badgeIcon).toBe('drop-simple-fill.svg');
    expect(lookupWeatherCode(61).badgeIcon).toBe('drop-fill.svg');
    expect(lookupWeatherCode(80).badgeIcon).toBe('drop-fill.svg');
    expect(lookupWeatherCode(71).badgeIcon).toBe('snowflake.svg');
    expect(lookupWeatherCode(95).badgeIcon).toBe('lightning-fill.svg');
  });

  it('derives the badge from weatherCode first, then the scene icon', () => {
    expect(weatherBadgeIcon({ weatherCode: 63, icon: 'overcast.svg' })).toBe('drop-fill.svg');
    expect(weatherBadgeIcon({ icon: 'drizzle.svg' })).toBe('drop-simple-fill.svg');
    expect(weatherBadgeIcon({ icon: 'unknown.svg' })).toBe('cloud-fill.svg');
    expect(weatherBadgeIcon(null)).toBe('cloud-fill.svg');
  });

  it('falls unknown WMO codes back to the overcast scene and cloud badge', () => {
    expect(lookupWeatherCode(1234)).toMatchObject({
      icon: 'overcast.svg',
      badgeIcon: 'cloud-fill.svg',
    });
  });
});
