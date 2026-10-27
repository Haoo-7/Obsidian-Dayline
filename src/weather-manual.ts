import type { WeatherSnapshot, WeatherUnits } from './types';

/**
 * Manual weather readings.
 *
 * A user-entered temperature is not cache data: it is a journal observation
 * ("18°C at 15:30") that a background forecast refresh must never overwrite.
 * These helpers therefore stay independent of the weather cache and of
 * Obsidian, so both the service and the modal can share one parsing and
 * formatting rule.
 */

/** Sanity ceiling in Celsius; catches `9999` typos without rejecting real weather. */
export const MANUAL_TEMPERATURE_MAX_ABS_C = 100;

export interface ManualTemperatureRecord {
  /** Canonical value in Celsius, rounded to at most one decimal. */
  celsius: number;
  /** Wall-clock time the reading refers to (`HH:MM`). Never timezone-shifted. */
  time: string;
  /** ISO timestamp of when the record was saved; audit and tooltip only. */
  recordedAt: string;
}

export type ManualTemperatureMap = Record<string, unknown>;

export type TemperatureParseResult =
  | { ok: true; celsius: number }
  | { ok: false; messageKey: string };

const DISPLAY_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const WALL_CLOCK_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Coerce a form/model value to text without `String(object)` surprises. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function normalizeWeatherUnits(units: unknown): WeatherUnits {
  return units === 'imperial' ? 'imperial' : 'metric';
}

export function unitSymbolFor(units: unknown): string {
  return normalizeWeatherUnits(units) === 'imperial' ? '\u00b0F' : '\u00b0C';
}

/** Convert a value the user typed in the active unit into canonical Celsius. */
export function displayToCelsius(value: number, units: unknown): number {
  const numeric = Number(value);
  return normalizeWeatherUnits(units) === 'imperial' ? (numeric - 32) * 5 / 9 : numeric;
}

/** Convert a canonical Celsius value into the unit the UI is currently showing. */
export function celsiusToDisplay(celsius: number, units: unknown): number {
  const numeric = Number(celsius);
  return normalizeWeatherUnits(units) === 'imperial' ? numeric * 9 / 5 + 32 : numeric;
}

/** Integers stay bare; anything else keeps one decimal, and `-0` reads as `0`. */
export function formatTemperatureValue(value: number | null | undefined): string {
  const numeric = Number(value);
  if (value == null || !Number.isFinite(numeric)) return '';
  const rounded = Math.round(numeric * 10) / 10;
  if (rounded === 0) return '0';
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Parse the temperature field. The raw text is the value in `units`, so an
 * imperial entry is converted before validation and the range check always
 * compares Celsius.
 */
export function parseTemperatureInput(raw: unknown, units: unknown): TemperatureParseResult {
  const text = asText(raw).trim();
  if (text === '' || !DISPLAY_NUMBER_PATTERN.test(text)) {
    return { ok: false, messageKey: 'weatherTemperatureInvalid' };
  }
  const display = Number(text);
  if (!Number.isFinite(display)) return { ok: false, messageKey: 'weatherTemperatureInvalid' };
  const celsius = displayToCelsius(display, units);
  if (!Number.isFinite(celsius) || Math.abs(celsius) > MANUAL_TEMPERATURE_MAX_ABS_C) {
    return { ok: false, messageKey: 'weatherTemperatureInvalid' };
  }
  return { ok: true, celsius: Math.round(celsius * 10) / 10 };
}

/** `HH:MM` in the same wall clock the user typed; anything unusable falls back. */
export function normalizeManualTime(raw: unknown, fallback: string): string {
  const text = asText(raw).trim();
  const match = WALL_CLOCK_PATTERN.exec(text);
  if (!match) return fallback;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** Rendering helper: a valid `HH:MM` string, or empty when there is no usable time. */
export function formatManualTime(value: unknown): string {
  const text = asText(value).trim();
  const match = WALL_CLOCK_PATTERN.exec(text);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

/** Compose the `'HH:MM'` clock string from already-resolved dayline clock parts. */
export function clockTimeFromParts(parts: { hour?: number; minute?: number } | null | undefined): string {
  const hour = Number(parts?.hour);
  const minute = Number(parts?.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '00:00';
  const safeHour = ((hour % 24) + 24) % 24;
  const safeMinute = Math.min(59, Math.max(0, minute));
  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`;
}

/**
 * Read one date's manual record from plugin data, tolerating whatever an older
 * or newer build persisted. A record without a usable temperature is absent.
 */
export function manualTemperatureRecord(
  map: ManualTemperatureMap | null | undefined,
  dateStr: string,
): ManualTemperatureRecord | null {
  if (!map || typeof map !== 'object' || typeof dateStr !== 'string' || dateStr === '') return null;
  const entry = map[dateStr];
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const celsius = Number(record.celsius);
  if (!Number.isFinite(celsius)) return null;
  return {
    celsius,
    time: formatManualTime(record.time),
    recordedAt: typeof record.recordedAt === 'string' ? record.recordedAt : '',
  };
}

/**
 * The temperature the UI should print: the manual reading wins over the
 * forecast, and a missing manual reading falls back to the snapshot's own
 * (already unit-correct) value.
 */
export function resolveDisplayTemperature(
  snapshot: WeatherSnapshot | null | undefined,
  record: ManualTemperatureRecord | null | undefined,
  units: unknown,
): number | null {
  if (record && Number.isFinite(Number(record.celsius))) {
    return Math.round(celsiusToDisplay(Number(record.celsius), units) * 10) / 10;
  }
  const value = snapshot?.temperature;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** True when this date carries a user reading. */
export function hasManualTemperature(
  map: ManualTemperatureMap | null | undefined,
  dateStr: string,
): boolean {
  return manualTemperatureRecord(map, dateStr) !== null;
}

/**
 * Merge a manual-reading map across devices without resurrecting deletions.
 *
 * Plain `{...disk, ...local}` keeps a reading this instance just cleared,
 * because deleting a key locally cannot remove it from the on-disk copy; the
 * next load would then restore it. `deletedDates` carries those explicit
 * removals for the current session, and local writes still win over disk.
 */
export function mergeManualTemperatureMaps(
  diskValue: unknown,
  localValue: unknown,
  deletedDates?: Iterable<string> | null,
): Record<string, unknown> {
  const disk = diskValue && typeof diskValue === 'object'
    ? diskValue as Record<string, unknown> : {};
  const local = localValue && typeof localValue === 'object'
    ? localValue as Record<string, unknown> : {};
  const merged: Record<string, unknown> = { ...disk, ...local };
  if (deletedDates) {
    for (const date of deletedDates) delete merged[date];
  }
  return merged;
}
