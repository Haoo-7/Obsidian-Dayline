import { describe, expect, it } from 'vitest';
import {
  MANUAL_TEMPERATURE_MAX_ABS_C,
  celsiusToDisplay,
  clockTimeFromParts,
  displayToCelsius,
  formatManualTime,
  formatTemperatureValue,
  hasManualTemperature,
  manualTemperatureRecord,
  mergeManualTemperatureMaps,
  normalizeManualTime,
  parseTemperatureInput,
  resolveDisplayTemperature,
  unitSymbolFor,
} from '../src/weather-manual';

describe('manual temperature parsing', () => {
  it('accepts metric values including negatives and one decimal', () => {
    expect(parseTemperatureInput('18', 'metric')).toEqual({ ok: true, celsius: 18 });
    expect(parseTemperatureInput(' -2.5 ', 'metric')).toEqual({ ok: true, celsius: -2.5 });
    expect(parseTemperatureInput('+.5', 'metric')).toEqual({ ok: true, celsius: 0.5 });
  });

  it('converts imperial input before validating it', () => {
    expect(parseTemperatureInput('68', 'imperial')).toEqual({ ok: true, celsius: 20 });
    expect(parseTemperatureInput('32', 'imperial')).toEqual({ ok: true, celsius: 0 });
  });

  it('rejects empty, malformed, and out-of-range input', () => {
    for (const raw of ['', '   ', 'abc', '--3', '1e3', 'NaN', 'Infinity', '18c']) {
      expect(parseTemperatureInput(raw, 'metric')).toEqual({
        ok: false,
        messageKey: 'weatherTemperatureInvalid',
      });
    }
    expect(parseTemperatureInput(String(MANUAL_TEMPERATURE_MAX_ABS_C + 1), 'metric').ok).toBe(false);
  });

  it('keeps the range check in Celsius for both unit systems', () => {
    // 212°F is 100°C, the boundary; 220°F is above it.
    expect(parseTemperatureInput('212', 'imperial').ok).toBe(true);
    expect(parseTemperatureInput('220', 'imperial').ok).toBe(false);
  });

  it('rounds stored values to one decimal', () => {
    expect(parseTemperatureInput('18.26', 'metric')).toEqual({ ok: true, celsius: 18.3 });
  });
});

describe('manual temperature unit conversion', () => {
  it('round-trips Celsius and Fahrenheit', () => {
    expect(celsiusToDisplay(20, 'imperial')).toBe(68);
    expect(displayToCelsius(68, 'imperial')).toBe(20);
    expect(celsiusToDisplay(20, 'metric')).toBe(20);
    expect(displayToCelsius(20, 'metric')).toBe(20);
  });

  it('treats unknown units as metric', () => {
    expect(unitSymbolFor(undefined)).toBe('\u00b0C');
    expect(unitSymbolFor('imperial')).toBe('\u00b0F');
    expect(celsiusToDisplay(10, 'kelvin')).toBe(10);
  });
});

describe('manual temperature formatting', () => {
  it('prints integers bare and other values with one decimal', () => {
    expect(formatTemperatureValue(18)).toBe('18');
    expect(formatTemperatureValue(18.25)).toBe('18.3');
    expect(formatTemperatureValue(18.04)).toBe('18');
    expect(formatTemperatureValue(-2.5)).toBe('-2.5');
  });

  it('renders zero, negative zero, and missing values predictably', () => {
    expect(formatTemperatureValue(0)).toBe('0');
    expect(formatTemperatureValue(-0)).toBe('0');
    expect(formatTemperatureValue(null)).toBe('');
    expect(formatTemperatureValue(Number.NaN)).toBe('');
  });
});

describe('manual reading time', () => {
  it('normalizes a wall-clock time to HH:MM', () => {
    expect(normalizeManualTime('15:30', '00:00')).toBe('15:30');
    expect(normalizeManualTime('9:05', '00:00')).toBe('09:05');
  });

  it('falls back instead of inventing a time', () => {
    expect(normalizeManualTime('', '07:15')).toBe('07:15');
    expect(normalizeManualTime('25:00', '07:15')).toBe('07:15');
    expect(normalizeManualTime('15:3', '07:15')).toBe('07:15');
    expect(normalizeManualTime(undefined, '07:15')).toBe('07:15');
  });

  it('formats only usable times', () => {
    expect(formatManualTime('9:05')).toBe('09:05');
    expect(formatManualTime('15:30')).toBe('15:30');
    expect(formatManualTime('')).toBe('');
    expect(formatManualTime('noon')).toBe('');
  });

  it('builds the clock string from resolved dayline parts', () => {
    expect(clockTimeFromParts({ hour: 9, minute: 5 })).toBe('09:05');
    expect(clockTimeFromParts({ hour: 0, minute: 0 })).toBe('00:00');
    expect(clockTimeFromParts(null)).toBe('00:00');
    expect(clockTimeFromParts({ hour: Number.NaN, minute: 5 })).toBe('00:00');
  });
});

describe('manual temperature records', () => {
  const map = {
    '2026-10-26': { celsius: 18, time: '15:30', recordedAt: '2026-10-26T15:30:00.000Z' },
    '2026-10-27': { celsius: 'broken' },
  };

  it('reads a stored record', () => {
    expect(manualTemperatureRecord(map, '2026-10-26')).toEqual({
      celsius: 18,
      time: '15:30',
      recordedAt: '2026-10-26T15:30:00.000Z',
    });
  });

  it('treats malformed or missing records as absent', () => {
    expect(manualTemperatureRecord(map, '2026-10-27')).toBeNull();
    expect(manualTemperatureRecord(map, '2026-10-28')).toBeNull();
    expect(manualTemperatureRecord(null, '2026-10-26')).toBeNull();
    expect(hasManualTemperature(map, '2026-10-26')).toBe(true);
    expect(hasManualTemperature(map, '2026-10-28')).toBe(false);
  });
});

describe('display temperature resolution', () => {
  it('prefers the manual reading and converts it to the active unit', () => {
    const record = { celsius: 20, time: '15:30', recordedAt: '' };
    expect(resolveDisplayTemperature({ temperature: 31 }, record, 'metric')).toBe(20);
    expect(resolveDisplayTemperature({ temperature: 88 }, record, 'imperial')).toBe(68);
  });

  it('falls back to the snapshot temperature', () => {
    expect(resolveDisplayTemperature({ temperature: 31 }, null, 'metric')).toBe(31);
    expect(resolveDisplayTemperature({ temperature: 31 }, undefined, 'imperial')).toBe(31);
  });

  it('returns null when neither source has a usable value', () => {
    expect(resolveDisplayTemperature(null, null, 'metric')).toBeNull();
    expect(resolveDisplayTemperature({}, null, 'metric')).toBeNull();
    expect(resolveDisplayTemperature({ temperature: Number.NaN }, null, 'metric')).toBeNull();
  });
});

describe('manual map merging across devices', () => {
  const reading = { celsius: 18, time: '15:30', recordedAt: '2026-10-26T15:30:00.000Z' };

  it('keeps a reading another device wrote', () => {
    expect(mergeManualTemperatureMaps(
      { '2026-10-25': reading },
      { '2026-10-26': reading },
    )).toEqual({ '2026-10-25': reading, '2026-10-26': reading });
  });

  it('lets the local write win for the same date', () => {
    const updated = { ...reading, celsius: 20 };
    expect(mergeManualTemperatureMaps({ '2026-10-26': reading }, { '2026-10-26': updated }))
      .toEqual({ '2026-10-26': updated });
  });

  it('does not resurrect a reading this session cleared', () => {
    const merged = mergeManualTemperatureMaps(
      { '2026-10-25': reading, '2026-10-26': reading },
      {},
      new Set(['2026-10-26']),
    );

    expect(merged).toEqual({ '2026-10-25': reading });
  });

  it('tolerates missing or malformed maps', () => {
    expect(mergeManualTemperatureMaps(null, undefined)).toEqual({});
    expect(mergeManualTemperatureMaps('nope', 42, null)).toEqual({});
  });
});
