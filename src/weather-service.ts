// @ts-nocheck
import { getTodayDate, joinVaultPath } from './date-utils';
import { withTimeout } from './media-service';
import {
  weatherConfigKey,
  migrateCompatibleSnapshot,
  isSnapshotStale,
  isHistoricalWeatherDate,
  hasSnapshotPayload,
  weatherDateAgeDays,
  pruneWeatherCache,
  WEATHER_RECENT_DAYS,
  WEATHER_CACHE_MAX_ENTRIES,
  cloneStaleSnapshot,
  toCanonicalWeatherSnapshot,
} from './weather-cache';
import { coordinatesMovedBeyondThreshold } from './geolocation';

let _obsidianWeatherDeps;
function getObsidianWeatherDeps() {
  if (!_obsidianWeatherDeps) _obsidianWeatherDeps = require('obsidian');
  return _obsidianWeatherDeps;
}

export const WEATHER_MAX_ATTEMPTS = 3;
export const WEATHER_RETRY_BASE_DELAY_MS = 250;
export const WEATHER_RETRY_MAX_DELAY_MS = 2000;
/**
 * Obsidian's `requestUrl` ignores an unknown `timeout` field, so a hung socket
 * would leave the weather card on "loading" forever. Each attempt gets a real
 * deadline through `withTimeout` instead.
 */
export const WEATHER_REQUEST_TIMEOUT_MS = 10000;

function daylineDate(settings, date = new Date()) {
  return getTodayDate(settings?.weatherTimezone || 'auto', date);
}

function errorStatus(value) {
  if (typeof value === 'number') return value;
  const status = value?.status ?? value?.statusCode ?? value?.response?.status ?? value?.error?.status;
  return Number.isFinite(Number(status)) ? Number(status) : undefined;
}

/** Retry only transport failures, 408, 429, and server errors. */
export function isRetryableWeatherFailure(value) {
  const status = errorStatus(value);
  if (status === undefined || status === 0) return true;
  return status === 408 || status === 429 || status >= 500 && status <= 599;
}

/** Only transport failures and exhausted eligible HTTP statuses imply offline. */
export function isOfflineWeatherFailure(value) {
  const status = errorStatus(value);
  return status === undefined || status === 0 || status === 408 || status === 429
    || status >= 500 && status <= 599;
}

/** Exponential delay after a failed attempt; attempt is one-based. */
export function getWeatherRetryDelay(attempt, options = {}) {
  const base = Math.max(0, Number(options.baseDelayMs ?? WEATHER_RETRY_BASE_DELAY_MS));
  const max = Math.max(base, Number(options.maxDelayMs ?? WEATHER_RETRY_MAX_DELAY_MS));
  return Math.min(max, base * (2 ** Math.max(0, attempt - 1)));
}

/**
 * Normalise an arbitrary rejection reason into an Error.
 *
 * Error objects pass through untouched so `WeatherRequestError` keeps its
 * `status` for `isRetryableWeatherFailure` and its callers. Anything else is
 * wrapped, preserving a `status` property when the reason carried one so HTTP
 * eligibility checks still see it.
 */
export function toWeatherError(reason) {
  if (reason instanceof Error) return reason;
  const message = typeof reason === 'string'
    ? reason
    : `Weather request failed: ${String(reason)}`;
  const error = new Error(message);
  const status = errorStatus(reason);
  if (status !== undefined) error.status = status;
  return error;
}

export class WeatherRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'WeatherRequestError';
    this.status = status;
  }
}

/**
 * Run one Open-Meteo request with a hard upper bound of three total attempts.
 * The request, sleep function, and backoff values are injectable for tests.
 */
export async function requestWeatherWithRetry(request, options = {}) {
  const requestedAttempts = Number(options.maxAttempts ?? WEATHER_MAX_ATTEMPTS);
  const maxAttempts = Math.max(1, Math.min(
    WEATHER_MAX_ATTEMPTS,
    Number.isFinite(requestedAttempts) ? Math.floor(requestedAttempts) : WEATHER_MAX_ATTEMPTS,
  ));
  const sleep = options.sleep || ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await request(attempt);
      const status = errorStatus(response);
      if (status === undefined || status >= 200 && status < 300) return response;
      lastError = new WeatherRequestError(`Weather API returned status ${status}`, status);
      if (attempt >= maxAttempts || !isRetryableWeatherFailure(lastError)) throw lastError;
    } catch (error) {
      // A rejected `request()` can carry anything; wrap non-Error reasons so the
      // final `throw` below always hands callers a real Error instance.
      lastError = toWeatherError(error);
      if (attempt >= maxAttempts || !isRetryableWeatherFailure(lastError)) throw lastError;
    }
    await sleep(getWeatherRetryDelay(attempt, options));
  }

  throw lastError ?? new Error('Weather request failed');
}

/* ============================================================
   Weather Service — Open-Meteo integration
   ============================================================ */

// WMO Weather interpretation codes (Meteocons Filled SVG icons)
// Icon values are .svg filenames in the icons/ directory
const WMO_CODES = [
  { code: 0,   condition: 'Clear sky',               icon: 'clear-day.svg' },
  { code: 1,   condition: 'Mainly clear',             icon: 'clear-day.svg' },
  { code: 2,   condition: 'Partly cloudy',            icon: 'partly-cloudy-day.svg' },
  { code: 3,   condition: 'Overcast',                 icon: 'overcast.svg' },
  { code: 45,  condition: 'Foggy',                    icon: 'fog.svg' },
  { code: 48,  condition: 'Depositing rime fog',      icon: 'fog.svg' },
  { code: 51,  condition: 'Light drizzle',            icon: 'drizzle.svg' },
  { code: 53,  condition: 'Moderate drizzle',         icon: 'drizzle.svg' },
  { code: 55,  condition: 'Dense drizzle',            icon: 'drizzle.svg' },
  { code: 61,  condition: 'Slight rain',              icon: 'rain.svg' },
  { code: 63,  condition: 'Moderate rain',             icon: 'rain.svg' },
  { code: 65,  condition: 'Heavy rain',               icon: 'rain.svg' },
  { code: 71,  condition: 'Slight snow fall',         icon: 'snow.svg' },
  { code: 73,  condition: 'Moderate snow fall',       icon: 'snow.svg' },
  { code: 75,  condition: 'Heavy snow fall',          icon: 'snow.svg' },
  { code: 77,  condition: 'Snow grains',             icon: 'snow.svg' },
  { code: 80,  condition: 'Slight rain showers',      icon: 'rain.svg' },
  { code: 81,  condition: 'Moderate rain showers',    icon: 'rain.svg' },
  { code: 82,  condition: 'Violent rain showers',     icon: 'rain.svg' },
  { code: 85,  condition: 'Slight snow showers',      icon: 'snow.svg' },
  { code: 86,  condition: 'Heavy snow showers',       icon: 'snow.svg' },
  { code: 95,  condition: 'Thunderstorm',             icon: 'thunderstorms.svg' },
  { code: 96,  condition: 'Thunderstorm w/ hail',     icon: 'thunderstorms.svg' },
  { code: 99,  condition: 'Thunderstorm w/ heavy hail', icon: 'thunderstorms.svg' },
];

/**
 * Calendar-cell glyphs: Lucide (ISC), stroke-based, not the Meteocons scene illustrations.
 * These are the shared glyph family — the same cloud silhouette carries every sky state —
 * which is what lets them read at 14px without a backing plate.
 */
const SCENE_TO_BADGE = {
  'clear-day.svg': 'badge-sun.svg',
  'partly-cloudy-day.svg': 'badge-cloud-sun.svg',
  'overcast.svg': 'badge-cloud.svg',
  'fog.svg': 'badge-fog.svg',
  'drizzle.svg': 'badge-drizzle.svg',
  'rain.svg': 'badge-rain.svg',
  'snow.svg': 'badge-snow.svg',
  'thunderstorms.svg': 'badge-storm.svg',
};

function badgeIconFromScene(icon) {
  return SCENE_TO_BADGE[icon] || 'badge-cloud.svg';
}

/** Look up WMO code metadata; falls back to generic description. */
export function lookupWeatherCode(code) {
  const entry = WMO_CODES.find((w) => w.code === code);
  const resolved = entry || { condition: `Weather code ${code}`, icon: 'overcast.svg' };
  return { ...resolved, badgeIcon: badgeIconFromScene(resolved.icon) };
}

/** Date-cell icon; weather cards keep the scene illustration in `icon`. */
export function weatherBadgeIcon(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 'badge-cloud.svg';
  if (typeof snapshot.weatherCode === 'number') {
    return lookupWeatherCode(snapshot.weatherCode).badgeIcon;
  }
  if (typeof snapshot.icon === 'string') return badgeIconFromScene(snapshot.icon);
  return 'badge-cloud.svg';
}

/** Validate that lat/lng are within acceptable ranges. */
export function validateWeatherCoordinates(lat, lng) {
  const n = parseFloat(lat);
  const g = parseFloat(lng);
  return (
    typeof n === 'number' && !isNaN(n) && n >= -90 && n <= 90 &&
    typeof g === 'number' && !isNaN(g) && g >= -180 && g <= 180
  );
}

function compatibleSnapshot(snapshot, settings) {
  const migrated = migrateCompatibleSnapshot(snapshot, settings);
  if (!migrated) return null;
  const lat = parseFloat(settings.weatherLatitude);
  const lng = parseFloat(settings.weatherLongitude);
  const { stale: _stale, offline: _offline, ...canonicalFields } = migrated;
  return {
    ...canonicalFields,
    location: settings.weatherLocationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
  };
}

function normalizeIcon(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (typeof snapshot.icon === 'string' && !snapshot.icon.endsWith('.svg') && snapshot.weatherCode != null) {
    return { ...snapshot, icon: lookupWeatherCode(snapshot.weatherCode).icon };
  }
  return { ...snapshot };
}

function valueAt(values, index) {
  return Array.isArray(values) && index >= 0 ? values[index] : undefined;
}

function numberAt(values, index) {
  const value = valueAt(values, index);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringAt(values, index) {
  const value = valueAt(values, index);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * WeatherService — handles Open-Meteo API calls and plugin data persistence.
 * A singleton is shared across CalendarView instances.
 */
export class WeatherService {
  constructor(plugin, options = {}) {
    this.plugin = plugin;
    this._request = options.request || getObsidianWeatherDeps().requestUrl;
    this._sleep = options.sleep;
    this._now = options.now || (() => Date.now());
    this._retryOptions = {
      maxAttempts: options.maxAttempts ?? WEATHER_MAX_ATTEMPTS,
      baseDelayMs: options.baseDelayMs ?? WEATHER_RETRY_BASE_DELAY_MS,
      maxDelayMs: options.maxDelayMs ?? WEATHER_RETRY_MAX_DELAY_MS,
    };
    // Per-date in-flight promise map to avoid duplicate requests and fallbacks.
    this._inFlight = new Map();
    // Per-date memory cache for dates without diary files.
    this._memoryCache = new Map();
  }

  _nowIso() {
    return new Date(this._now()).toISOString();
  }

  _today() {
    return daylineDate(this.plugin.settings, new Date(this._now()));
  }

  _requestContext() {
    const source = this.plugin.settings;
    const settings = {
      weatherLatitude: source.weatherLatitude,
      weatherLongitude: source.weatherLongitude,
      weatherUnits: source.weatherUnits,
      weatherTimezone: source.weatherTimezone,
      weatherTtlHours: source.weatherTtlHours,
      weatherLocationName: source.weatherLocationName,
      dailyFolder: source.dailyFolder,
    };
    return {
      settings,
      configKey: weatherConfigKey(settings),
      today: daylineDate(settings, new Date(this._now())),
    };
  }

  _runDeduplicated(dateStr, configKey, operation) {
    const requestKey = `${dateStr}|${configKey}`;
    if (this._inFlight.has(requestKey)) return this._inFlight.get(requestKey);
    const promise = Promise.resolve().then(operation).finally(() => {
      if (this._inFlight.get(requestKey) === promise) this._inFlight.delete(requestKey);
    });
    this._inFlight.set(requestKey, promise);
    return promise;
  }

  /**
   * Get weather, returning a stale offline snapshot when refresh cannot complete.
   *
   * This is the passive path used while browsing, so settled historical dates
   * (older than the revisable recent window) are served from the cache only:
   * the device only knows the current address, and fetching an old day here
   * would register that day's weather under it. Putting weather on a past
   * date is always an explicit act — the card/overlay refresh button, the
   * refresh command, or the settings backfill, all of which go through
   * `forceRefresh`.
   */
  async getSnapshot(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) return null;
    const context = this._requestContext();
    return this._runDeduplicated(dateStr, context.configKey, () => this._fetchOrUseCached(dateStr, false, context));
  }

  /**
   * Check whether a frontmatter snapshot or memory cache record needs refresh.
   * `dateStr` is optional so existing callers keep working; when it is omitted
   * the snapshot's own `date` field supplies the freshness context.
   */
  _shouldFetch(record, ttlHours, dateStr = undefined) {
    const options = { date: dateStr, today: this._today() };
    if (record && typeof record === 'object' && 'cachedAt' in record) {
      return isSnapshotStale({ ...(record.snapshot || {}), cachedAt: record.cachedAt }, ttlHours, this._now(), options);
    }
    return isSnapshotStale(record, ttlHours, this._now(), options);
  }

  _configKey() {
    return weatherConfigKey(this.plugin.settings);
  }

  isSnapshotCompatible(snapshot) {
    return !!compatibleSnapshot(snapshot, this.plugin.settings);
  }

  _readLegacySnapshots(dateStr, sourcePath, settings = this.plugin.settings) {
    const app = this.plugin.app;
    const candidatePaths = [sourcePath, joinVaultPath(settings.dailyFolder, `${dateStr}.md`)]
      .filter((path, index, paths) => path && paths.indexOf(path) === index);
    const snapshots = [];
    for (const path of candidatePaths) {
      const existingFile = app?.vault?.getAbstractFileByPath?.(path);
      if (!existingFile) continue;
      const TFile = getObsidianWeatherDeps().TFile;
      if (!(existingFile instanceof TFile)) continue;
      const cache = app.metadataCache?.getFileCache?.(existingFile);
      const snapshot = compatibleSnapshot(cache?.frontmatter?._calendar_weather, settings);
      if (snapshot) snapshots.push({ snapshot: normalizeIcon(snapshot), source: 'frontmatter' });
    }
    return snapshots;
  }

  _cachedCandidates(dateStr, sourcePath, settings = this.plugin.settings, configKey = weatherConfigKey(settings)) {
    const candidates = [];
    const cacheEntry = this.plugin.weatherCache?.[dateStr];
    const cacheSnapshot = compatibleSnapshot(cacheEntry, settings);
    if (cacheSnapshot) {
      // Clean transient flags left by an older build before this record is
      // used as canonical plugin data.
      if (cacheEntry?.offline || cacheEntry?.stale) {
        const canonical = toCanonicalWeatherSnapshot(cacheEntry);
        if (canonical) {
          this.plugin.weatherCache[dateStr] = canonical;
          this.plugin._saveWeatherCache?.();
        }
      }
      candidates.push({ snapshot: normalizeIcon(cacheSnapshot), source: 'weatherCache' });
    }

    candidates.push(...this._readLegacySnapshots(dateStr, sourcePath, settings));

    const memoryRecord = this._memoryCache.get(dateStr);
    if (memoryRecord?.configKey === configKey && memoryRecord.snapshot) {
      const memorySnapshot = compatibleSnapshot(memoryRecord.snapshot, settings);
      if (memorySnapshot) {
        candidates.push({
          snapshot: normalizeIcon(memorySnapshot),
          source: 'memory',
          record: memoryRecord,
        });
      }
    }
    return candidates;
  }

  _selectCached(dateStr, sourcePath, ttlHours, settings = this.plugin.settings, configKey = weatherConfigKey(settings)) {
    const candidates = this._cachedCandidates(dateStr, sourcePath, settings, configKey);
    if (candidates.length === 0) return null;
    const fresh = candidates.find((candidate) => !this._shouldFetch(candidate.record || candidate.snapshot, ttlHours, dateStr));
    return fresh || candidates[0];
  }

  getCachedSnapshot(dateStr, sourcePath) {
    return this._selectCached(dateStr, sourcePath, this.plugin.settings.weatherTtlHours || 2)?.snapshot || null;
  }

  _migrateFrontmatterCache(dateStr, candidate) {
    if (candidate?.source !== 'frontmatter' || !candidate.snapshot) return;
    this.plugin.weatherCache = this.plugin.weatherCache || {};
    this.plugin.weatherCache[dateStr] = { ...candidate.snapshot };
    this.plugin._saveWeatherCache?.();
  }

  async _fetchOrUseCached(dateStr, forceRefresh, context = this._requestContext()) {
    const s = context.settings;
    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits === 'imperial' ? 'imperial' : 'metric';
    const ttlHours = s.weatherTtlHours || 2;
    const locationName = s.weatherLocationName || '';
    const memoryRecord = this._memoryCache.get(dateStr);
    const cached = this._selectCached(dateStr, undefined, ttlHours, s, context.configKey);

    // Reviewing an old diary must never register weather: for a settled
    // historical date this device only knows the current address, so a fetch
    // here would fabricate that day's weather under it — and overwrite the
    // only copy if the user has moved since. Historical dates are therefore
    // served from the cache alone; past days gain weather only through an
    // explicit refresh or the settings backfill.
    if (!forceRefresh && isHistoricalWeatherDate(dateStr, context.today)) {
      return cached?.snapshot ?? null;
    }

    // Preserve the existing short-lived negative cache for dates with no
    // usable snapshot, while force refresh always gets a new attempt.
    if (!forceRefresh && memoryRecord?.configKey === context.configKey
      && memoryRecord.snapshot === null && !cached && !this._shouldFetch(memoryRecord, ttlHours, dateStr)) {
      return null;
    }

    if (!forceRefresh && cached && !this._shouldFetch(cached.record || cached.snapshot, ttlHours, dateStr)) {
      this._migrateFrontmatterCache(dateStr, cached);
      return cached.snapshot;
    }

    const fetchResult = await this._fetchFromOpenMeteoResult(lat, lng, dateStr, units, locationName, context);
    const weather = fetchResult.snapshot;
    if (!weather) {
      if (cached?.snapshot) return cloneStaleSnapshot(cached.snapshot, fetchResult.offline);
      // Preserve the existing null behavior for dates with no usable cache.
      if (context.configKey === this._configKey()) {
        this._memoryCache.set(dateStr, { snapshot: null, cachedAt: this._nowIso(), configKey: context.configKey });
      }
      return null;
    }

    if (context.configKey === this._configKey()) {
      await this._persistSnapshot(dateStr, weather);
      this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: this._nowIso(), configKey: context.configKey });
    }
    return weather;
  }

  _dailyFields(isArchive) {
    const fields = [
      'temperature_2m_max',
      'temperature_2m_min',
      'weathercode',
      'relative_humidity_2m_max',
      'apparent_temperature_max',
      'wind_speed_10m_max',
      'sunrise',
      'sunset',
    ];
    // Forecast exposes probability; the archive endpoint may reject it.
    if (!isArchive) fields.push('precipitation_probability_max');
    return fields.join(',');
  }

  /**
   * ERA5/archive data lags several days, so recent past days must come from the
   * forecast API's `past_days` window; only settled history uses the archive.
   */
  _isArchiveDate(dateStr, today) {
    return dateStr < today && isHistoricalWeatherDate(dateStr, today, WEATHER_RECENT_DAYS);
  }

  _weatherBaseUrl(dateStr, today) {
    return this._isArchiveDate(dateStr, today)
      ? 'https://archive-api.open-meteo.com/v1/archive'
      : 'https://api.open-meteo.com/v1/forecast';
  }

  _buildWeatherUrl(lat, lng, dateStr, units, context = this._requestContext()) {
    const timezone = context.settings.weatherTimezone || 'auto';
    const today = context.today;
    const isToday = dateStr === today;
    const isArchive = this._isArchiveDate(dateStr, today);
    const isRecentPast = dateStr < today && !isArchive;
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      daily: this._dailyFields(isArchive),
      timezone,
      start_date: dateStr,
      end_date: dateStr,
    });
    if (isToday) {
      params.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m');
    }
    if (isRecentPast) {
      const ageDays = weatherDateAgeDays(dateStr, today);
      params.set('past_days', String(Math.min(WEATHER_RECENT_DAYS, Math.max(1, Math.round(ageDays ?? 1)))));
    }
    if (units === 'imperial') {
      params.set('temperature_unit', 'fahrenheit');
      params.set('wind_speed_unit', 'mph');
    } else {
      params.set('temperature_unit', 'celsius');
      params.set('wind_speed_unit', 'kmh');
    }
    return `${this._weatherBaseUrl(dateStr, today)}?${params.toString()}`;
  }

  async _requestWeather(url) {
    return requestWeatherWithRetry(
      () => withTimeout(
        Promise.resolve(this._request({ url })),
        WEATHER_REQUEST_TIMEOUT_MS,
        'weather request',
      ),
      { ...this._retryOptions, sleep: this._sleep },
    );
  }

  _location(lat, lng, locationName) {
    return locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  }

  _dailyIndex(daily, dateStr) {
    const dates = Array.isArray(daily?.time) ? daily.time : [];
    return dates.indexOf(dateStr);
  }

  _dailySnapshot(daily, idx, lat, lng, dateStr, units, locationName, configKey, fetchedAt = this._nowIso()) {
    if (!daily || idx < 0) return null;
    const code = numberAt(daily.weathercode || daily.weather_code, idx);
    if (typeof code !== 'number') return null;
    const wmo = lookupWeatherCode(code);
    const tempMax = numberAt(daily.temperature_2m_max, idx);
    const tempMin = numberAt(daily.temperature_2m_min, idx);
    const feelsLike = numberAt(daily.apparent_temperature_max, idx);
    return {
      fetchedAt,
      date: dateStr,
      location: this._location(lat, lng, locationName),
      latitude: lat,
      longitude: lng,
      temperature: tempMax == null ? null : Math.round(tempMax),
      feelsLike: feelsLike == null ? null : Math.round(feelsLike),
      humidity: numberAt(daily.relative_humidity_2m_max, idx),
      weatherCode: code,
      condition: wmo.condition,
      icon: wmo.icon,
      high: tempMax,
      low: tempMin,
      temperatureLabel: 'High',
      precipitationProbability: numberAt(daily.precipitation_probability_max, idx),
      windSpeed: numberAt(daily.wind_speed_10m_max, idx),
      sunrise: stringAt(daily.sunrise, idx),
      sunset: stringAt(daily.sunset, idx),
      units,
      configKey,
    };
  }

  _currentSnapshot(json, lat, lng, dateStr, units, locationName, configKey, fetchedAt) {
    const cur = json?.current;
    const daily = json?.daily;
    if (!cur || typeof cur !== 'object') return null;
    const code = typeof cur.weather_code === 'number' ? cur.weather_code : null;
    if (code === null) return null;
    const idx = this._dailyIndex(daily, dateStr);
    const wmo = lookupWeatherCode(code);
    const dailyMax = numberAt(daily?.temperature_2m_max, idx);
    const dailyMin = numberAt(daily?.temperature_2m_min, idx);
    return {
      fetchedAt,
      date: dateStr,
      location: this._location(lat, lng, locationName),
      latitude: lat,
      longitude: lng,
      temperature: typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null,
      feelsLike: typeof cur.apparent_temperature === 'number' ? Math.round(cur.apparent_temperature) : null,
      humidity: typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : null,
      weatherCode: code,
      condition: wmo.condition,
      icon: wmo.icon,
      high: dailyMax,
      low: dailyMin,
      temperatureLabel: 'Now',
      precipitationProbability: numberAt(daily?.precipitation_probability_max, idx),
      windSpeed: typeof cur.wind_speed_10m === 'number'
        ? cur.wind_speed_10m
        : numberAt(daily?.wind_speed_10m_max, idx),
      sunrise: stringAt(daily?.sunrise, idx),
      sunset: stringAt(daily?.sunset, idx),
      units,
      configKey,
    };
  }

  /** Call Open-Meteo once per operation, with all retry attempts inside it. */
  async _fetchFromOpenMeteoResult(lat, lng, dateStr, units, locationName, context = this._requestContext()) {
    const url = this._buildWeatherUrl(lat, lng, dateStr, units, context);
    let response;
    try {
      response = await this._requestWeather(url);
    } catch (err) {
      console.warn('[Dayline] Weather fetch failed:', err?.message || err);
      return { snapshot: null, offline: isOfflineWeatherFailure(err) };
    }

    if (!response?.json || typeof response.json !== 'object') return { snapshot: null, offline: false };
    try {
      const fetchedAt = this._nowIso();
      const today = context.today;
      if (dateStr === today) {
        const current = this._currentSnapshot(response.json, lat, lng, dateStr, units, locationName, context.configKey, fetchedAt);
        if (current) return { snapshot: current, offline: false };
      }
      const daily = response.json.daily;
      const idx = this._dailyIndex(daily, dateStr);
      return {
        snapshot: this._dailySnapshot(daily, idx, lat, lng, dateStr, units, locationName, context.configKey, fetchedAt),
        offline: false,
      };
    } catch (err) {
      console.warn('[Dayline] Weather response was unusable:', err?.message || err);
      return { snapshot: null, offline: false };
    }
  }

  /** Preserve the historical null-returning helper for direct callers. */
  async _fetchFromOpenMeteo(lat, lng, dateStr, units, locationName) {
    return (await this._fetchFromOpenMeteoResult(lat, lng, dateStr, units, locationName)).snapshot;
  }

  /** Compatibility helper for callers that still need a daily-only request. */
  async _dailyOnlyFetch(lat, lng, dateStr, params) {
    const today = daylineDate(this.plugin.settings, new Date(this._now()));
    const baseUrl = this._weatherBaseUrl(dateStr, today);
    try {
      return await this._requestWeather(`${baseUrl}?${params.toString()}`);
    } catch (err) {
      console.warn('[Dayline] Daily weather fetch failed:', err?.message || err);
      return null;
    }
  }

  /**
   * Persist only canonical data; offline/stale status is transient UI state.
   *
   * A settled historical record is the only remaining copy of that day, and
   * the device cannot know where the user actually was back then, so a
   * snapshot fetched under different coordinates — a refresh or backfill run
   * after a move — must never overwrite it. Same-place refetches (a units or
   * timezone change, sub-kilometre drift) stay allowed.
   */
  async _persistSnapshot(dateStr, weather) {
    const canonical = toCanonicalWeatherSnapshot(weather);
    if (!canonical) return;
    if (canonical.configKey && canonical.configKey !== this._configKey()) return;
    const existing = this.plugin.weatherCache?.[dateStr];
    if (existing && hasSnapshotPayload(existing)
      && isHistoricalWeatherDate(dateStr, this._today())
      && coordinatesMovedBeyondThreshold(existing.latitude, existing.longitude, canonical.latitude, canonical.longitude)) {
      console.warn('[Dayline] Kept pinned weather history for', dateStr, '- new snapshot came from different coordinates');
      return;
    }
    if (!this.plugin.weatherCache) this.plugin.weatherCache = {};
    this.plugin.weatherCache[dateStr] = { ...canonical, configKey: this._configKey() };
    // Bound the cache by entry count, never by wall-clock fetch age: a
    // backfilled history entry is the only remaining copy of that day.
    pruneWeatherCache(this.plugin.weatherCache, { maxEntries: WEATHER_CACHE_MAX_ENTRIES });
    this.plugin._saveWeatherCache?.();
  }

  /** Force a refresh while retaining stale-cache fallback and deduplication. */
  async forceRefresh(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) return null;
    const context = this._requestContext();
    return this._runDeduplicated(dateStr, context.configKey, () => this._fetchOrUseCached(dateStr, true, context));
  }

  /** Check if a date has a compatible cached snapshot. */
  hasCachedSnapshot(dateStr, sourcePath) {
    if (!this.plugin.settings.weatherEnabled) return false;
    return !!this.getCachedSnapshot(dateStr, sourcePath);
  }

  /** Bulk-fetch weather for a list of dates with a delay between requests. */
  async bulkBackfill(dateStrs, onProgress) {
    let done = 0;
    const total = dateStrs.length;
    for (const dateStr of dateStrs) {
      const entry = this.plugin.weatherCache?.[dateStr];
      if (entry && this.isSnapshotCompatible(entry) && entry.fetchedAt && !this._shouldFetch(entry, this.plugin.settings.weatherTtlHours || 2, dateStr)) {
        done++;
        onProgress?.(done, total, dateStr, true);
        continue;
      }
      try {
        await this.forceRefresh(dateStr);
      } catch (e) {
        console.warn('[Dayline] Backfill failed for', dateStr, e.message);
      }
      done++;
      onProgress?.(done, total, dateStr, false);
      if (done < total) await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    this.plugin._saveWeatherCache?.();
    return done;
  }
}
