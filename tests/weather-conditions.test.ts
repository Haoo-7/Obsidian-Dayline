import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import { SUPPORTED_DISPLAY_LANGUAGES } from '../src/i18n';
import { lookupWeatherCode } from '../src/weather-service';
import { WEATHER_CONDITION_CODES, weatherConditionLabel } from '../src/weather-conditions';

describe('localized weather conditions', () => {
  it('labels every code the weather service resolves', () => {
    // Ties the localized table to the WMO list: adding a code to weather-service
    // without a label would fall back to "Weather code N" and fail here.
    for (const language of SUPPORTED_DISPLAY_LANGUAGES) {
      const unknownLabel = weatherConditionLabel({ weatherCode: 999 }, { displayLanguage: language });
      for (const code of WEATHER_CONDITION_CODES) {
        const label = weatherConditionLabel({ weatherCode: code }, { displayLanguage: language });
        expect(label, `${language} label for ${code}`).not.toBe('');
        expect(label, `${language} label for ${code}`).not.toBe(unknownLabel);
      }
    }
    for (const code of WEATHER_CONDITION_CODES) {
      expect(weatherConditionLabel({ weatherCode: code }, { displayLanguage: 'en' }), String(code))
        .toBe(lookupWeatherCode(code).condition);
    }
  });

  it('names each condition in the display language', () => {
    const clearSky = (displayLanguage: string) => weatherConditionLabel({ weatherCode: 0 }, { displayLanguage });
    expect(clearSky('en')).toBe('Clear sky');
    expect(clearSky('zh')).toBe('晴');
    expect(clearSky('zh-tw')).toBe('晴');
    expect(clearSky('ja')).toBe('快晴');
    expect(clearSky('ko')).toBe('맑음');
    expect(clearSky('fr')).toBe('Ciel dégagé');
    expect(clearSky('de')).toBe('Klarer Himmel');
    expect(clearSky('es')).toBe('Cielo despejado');
    expect(clearSky('ru')).toBe('Ясно');
    expect(weatherConditionLabel({ weatherCode: 48 }, { displayLanguage: 'zh' })).toBe('雾凇');
    expect(weatherConditionLabel({ weatherCode: 95 }, { displayLanguage: 'ja' })).toBe('雷雨');
    expect(weatherConditionLabel({ weatherCode: 65 }, { displayLanguage: 'de' })).toBe('Starker Regen');
    // The language setting reaches the table through the shared resolver.
    expect(weatherConditionLabel({ weatherCode: 3 }, { weatherLanguage: 'ru' })).toBe('Пасмурно');
    expect(weatherConditionLabel({ weatherCode: 3 }, { displayLanguage: 'system' })).not.toBe('');
  });

  it('falls back to a stored label and localizes an unknown code', () => {
    // Snapshots cached before multi-language support carry only English text.
    expect(weatherConditionLabel({ condition: 'Clear sky' }, { displayLanguage: 'ja' })).toBe('Clear sky');
    expect(weatherConditionLabel({ weatherCode: 'not-a-code', condition: 'Legacy' }, { displayLanguage: 'ja' })).toBe('Legacy');
    expect(weatherConditionLabel(null, { displayLanguage: 'ja' })).toBe('');
    expect(weatherConditionLabel({}, { displayLanguage: 'ja' })).toBe('');
    expect(weatherConditionLabel({ weatherCode: 999 }, { displayLanguage: 'zh' })).toBe('天气代码 999');
    expect(weatherConditionLabel({ weatherCode: 999 }, { displayLanguage: 'ru' })).toBe('Код погоды 999');
  });

  it('ships a complete table for every language without duplicate labels', () => {
    for (const language of SUPPORTED_DISPLAY_LANGUAGES) {
      const labels = WEATHER_CONDITION_CODES.map((code) => weatherConditionLabel({ weatherCode: code }, { displayLanguage: language }));
      expect(labels.filter((label) => !label.trim()), language).toEqual([]);
      expect(new Set(labels).size, `${language} labels`).toBe(WEATHER_CONDITION_CODES.length);
    }
  });
});
