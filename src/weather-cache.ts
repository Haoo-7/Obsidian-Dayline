import type { WeatherSettings, WeatherSnapshot } from './types';

export const WEATHER_API_VERSION = 'open-meteo-v1';

/**
 * Dates inside this window still follow the short TTL: the forecast endpoint can
 * revise the last few days, so those snapshots are not final yet. Older dates
 * come from the archive endpoint and never change once fetched.
 */
export const WEATHER_RECENT_DAYS = 7;

/** Upper bound for retained weather cache entries (about ten years of dailies). */
export const WEATHER_CACHE_MAX_ENTRIES = 3650;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Fields that never prove a record holds fetchable weather data. */
const NON_PAYLOAD_FIELDS = new Set(['cachedAt', 'configKey', 'stale', 'offline']);

export function weatherConfigKey(settings: WeatherSettings): string {
  const latitude = Number.parseFloat(String(settings.weatherLatitude));
  const longitude = Number.parseFloat(String(settings.weatherLongitude));
  return JSON.stringify({
    latitude: Number.isFinite(latitude) ? Number(latitude.toFixed(6)) : null,
    longitude: Number.isFinite(longitude) ? Number(longitude.toFixed(6)) : null,
    units: settings.weatherUnits === 'imperial' ? 'imperial' : 'metric',
    timezone: settings.weatherTimezone || 'auto',
    apiVersion: WEATHER_API_VERSION,
  });
}

export function migrateCompatibleSnapshot(
  snapshot: WeatherSnapshot | null | undefined,
  settings: WeatherSettings,
): WeatherSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const expected = weatherConfigKey(settings);
  if (snapshot.configKey === expected) return { ...snapshot };
  if (snapshot.configKey !== undefined && snapshot.configKey !== null) return null;

  const latitude = Number.parseFloat(String(settings.weatherLatitude));
  const longitude = Number.parseFloat(String(settings.weatherLongitude));
  const snapshotLatitude = Number.parseFloat(String(snapshot.latitude));
  const snapshotLongitude = Number.parseFloat(String(snapshot.longitude));
  const sameLocation = Number.isFinite(snapshotLatitude) && Number.isFinite(snapshotLongitude)
    && Math.abs(snapshotLatitude - latitude) < 0.000001
    && Math.abs(snapshotLongitude - longitude) < 0.000001;
  const sameUnits = snapshot.units === (settings.weatherUnits === 'imperial' ? 'imperial' : 'metric');
  if (!sameLocation || !sameUnits) return null;

  return { ...snapshot, configKey: expected };
}

export interface WeatherStalenessOptions {
  /** Calendar date (YYYY-MM-DD) the snapshot belongs to; defaults to `snapshot.date`. */
  date?: string | null;
  /** Current Dayline date (YYYY-MM-DD); required for the historical shortcut. */
  today?: string | null;
  /** Days before today that still follow the TTL. Defaults to `WEATHER_RECENT_DAYS`. */
  recentDays?: number;
}

/** Whole days from `date` to `today`; null when either is not a calendar date. */
export function weatherDateAgeDays(
  date: string | null | undefined,
  today: string | null | undefined,
): number | null {
  if (typeof date !== 'string' || typeof today !== 'string') return null;
  if (!ISO_DATE_PATTERN.test(date) || !ISO_DATE_PATTERN.test(today)) return null;
  const age = (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${date}T00:00:00.000Z`))
    / (24 * 60 * 60 * 1000);
  return Number.isFinite(age) ? age : null;
}

/**
 * True when `date` lies more than `recentDays` before `today`.
 *
 * Archive weather for such a date is final, so its snapshot stays valid no
 * matter how old `fetchedAt` is. Unparseable values are never historical.
 */
export function isHistoricalWeatherDate(
  date: string | null | undefined,
  today: string | null | undefined,
  recentDays = WEATHER_RECENT_DAYS,
): boolean {
  const age = weatherDateAgeDays(date, today);
  if (age === null) return false;
  const window = Number.isFinite(recentDays) && recentDays >= 0 ? recentDays : WEATHER_RECENT_DAYS;
  return age > window;
}

/** A record that only carries bookkeeping or transient status holds no weather. */
function hasSnapshotPayload(snapshot: WeatherSnapshot): boolean {
  return Object.keys(snapshot).some((key) => !NON_PAYLOAD_FIELDS.has(key));
}

export function isSnapshotStale(
  snapshot: WeatherSnapshot | null | undefined,
  ttlHours: number,
  now = Date.now(),
  options: WeatherStalenessOptions = {},
): boolean {
  if (!snapshot) return true;
  const rawTimestamp = snapshot.cachedAt ?? snapshot.fetchedAt;
  if (!rawTimestamp) return true;
  const timestamp = new Date(rawTimestamp).getTime();
  if (!Number.isFinite(timestamp)) return true;
  if (now - timestamp <= ttlHours * 60 * 60 * 1000) return false;
  // A fetched archive snapshot for a historical date is the final word for that
  // day: refetching it wastes a request and dropping it loses backfilled
  // history, because the cache is the only copy left. Empty negative-cache
  // records keep the short TTL so a failed old fetch is retried later.
  const date = options.date ?? snapshot.date;
  return !(isHistoricalWeatherDate(date, options.today, options.recentDays) && hasSnapshotPayload(snapshot));
}

export interface WeatherCachePruneOptions {
  /** Maximum retained entries. Defaults to `WEATHER_CACHE_MAX_ENTRIES`. */
  maxEntries?: number;
  /** Drop entries whose resolved date is strictly before this YYYY-MM-DD. */
  minDate?: string | null;
}

/** Resolve the calendar date a cache entry belongs to, when it carries one. */
export function weatherCacheEntryDate(entry: WeatherSnapshot | null | undefined): string | null {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.date === 'string' && ISO_DATE_PATTERN.test(entry.date)) return entry.date;
  const raw = entry.fetchedAt ?? entry.cachedAt;
  if (typeof raw === 'string') {
    const iso = raw.slice(0, 10);
    if (ISO_DATE_PATTERN.test(iso)) return iso;
  }
  return null;
}

/**
 * Bound the weather cache without discarding usable history.
 *
 * The previous sweep deleted entries by `fetchedAt` once they were 90 days old,
 * which destroyed backfilled history even though the cache is its only copy.
 * This keeps entries by date instead: undated legacy records go first, then the
 * oldest dates, with `minDate` available as a hard floor. Returns the number of
 * removed entries.
 */
export function pruneWeatherCache(
  cache: Record<string, WeatherSnapshot | null | undefined> | null | undefined,
  options: WeatherCachePruneOptions = {},
): number {
  if (!cache || typeof cache !== 'object') return 0;
  const requested = Number(options.maxEntries ?? WEATHER_CACHE_MAX_ENTRIES);
  const maxEntries = Number.isFinite(requested) && requested >= 1
    ? Math.floor(requested)
    : WEATHER_CACHE_MAX_ENTRIES;
  let removed = 0;
  const minDate = options.minDate;
  if (typeof minDate === 'string' && ISO_DATE_PATTERN.test(minDate)) {
    for (const key of Object.keys(cache)) {
      const date = weatherCacheEntryDate(cache[key]);
      if (date && date < minDate) {
        delete cache[key];
        removed++;
      }
    }
  }
  const keys = Object.keys(cache);
  if (keys.length <= maxEntries) return removed;
  const ordered = keys
    .map((key) => ({ key, date: weatherCacheEntryDate(cache[key]) }))
    .sort((left, right) => {
      const leftDate = left.date ?? '';
      const rightDate = right.date ?? '';
      if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
      return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
    });
  for (const entry of ordered.slice(0, keys.length - maxEntries)) {
    delete cache[entry.key];
    removed++;
  }
  return removed;
}

/** Clone a usable cache entry with status that is safe for the UI only. */
export function cloneStaleOfflineSnapshot(
  snapshot: WeatherSnapshot | null | undefined,
): WeatherSnapshot | null {
  return cloneStaleSnapshot(snapshot, true);
}

/** Clone a stale cache entry, optionally marking transport-level offline state. */
export function cloneStaleSnapshot(
  snapshot: WeatherSnapshot | null | undefined,
  offline = false,
): WeatherSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const clone = { ...snapshot };
  delete clone.stale;
  delete clone.offline;
  return offline ? { ...clone, stale: true, offline: true } : { ...clone, stale: true };
}

/** Remove transient status before writing a snapshot to plugin data. */
export function toCanonicalWeatherSnapshot(
  snapshot: WeatherSnapshot | null | undefined,
): WeatherSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const canonical = { ...snapshot };
  delete canonical.stale;
  delete canonical.offline;
  return canonical;
}
