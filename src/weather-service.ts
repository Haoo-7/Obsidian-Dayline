// @ts-nocheck
import { getTodayDate } from './date-utils';
import {
  weatherConfigKey,
  migrateCompatibleSnapshot,
  isSnapshotStale,
  cloneStaleSnapshot,
  toCanonicalWeatherSnapshot,
} from './weather-cache';

let _obsidianWeatherDeps;
function getObsidianWeatherDeps() {
  if (!_obsidianWeatherDeps) _obsidianWeatherDeps = require('obsidian');
  return _obsidianWeatherDeps;
}

export const WEATHER_MAX_ATTEMPTS = 3;
export const WEATHER_RETRY_BASE_DELAY_MS = 250;
export const WEATHER_RETRY_MAX_DELAY_MS = 2000;

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
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await request(attempt);
      const status = errorStatus(response);
      if (status === undefined || status >= 200 && status < 300) return response;
      lastError = new WeatherRequestError(`Weather API returned status ${status}`, status);
      if (attempt >= maxAttempts || !isRetryableWeatherFailure(lastError)) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableWeatherFailure(error)) throw error;
    }
    await sleep(getWeatherRetryDelay(attempt, options));
  }

  throw lastError || new Error('Weather request failed');
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

/** Look up WMO code metadata; falls back to generic description. */
export function lookupWeatherCode(code) {
  const entry = WMO_CODES.find((w) => w.code === code);
  return entry || { condition: `Weather code ${code}`, icon: 'overcast.svg' };
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

  _requestKey(dateStr) {
    return `${dateStr}|${this._configKey()}`;
  }

  _runDeduplicated(dateStr, operation) {
    const requestKey = this._requestKey(dateStr);
    if (this._inFlight.has(requestKey)) return this._inFlight.get(requestKey);
    const promise = Promise.resolve().then(operation).finally(() => {
      if (this._inFlight.get(requestKey) === promise) this._inFlight.delete(requestKey);
    });
    this._inFlight.set(requestKey, promise);
    return promise;
  }

  /** Get weather, returning a stale offline snapshot when refresh cannot complete. */
  async getSnapshot(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) return null;
    return this._runDeduplicated(dateStr, () => this._fetchOrUseCached(dateStr, false));
  }

  /** Check whether a frontmatter snapshot or memory cache record needs refresh. */
  _shouldFetch(record, ttlHours) {
    if (record && typeof record === 'object' && 'cachedAt' in record) {
      return isSnapshotStale({ ...(record.snapshot || {}), cachedAt: record.cachedAt }, ttlHours, this._now());
    }
    return isSnapshotStale(record, ttlHours, this._now());
  }

  _configKey() {
    return weatherConfigKey(this.plugin.settings);
  }

  isSnapshotCompatible(snapshot) {
    return !!compatibleSnapshot(snapshot, this.plugin.settings);
  }

  _readLegacySnapshots(dateStr, sourcePath) {
    const app = this.plugin.app;
    const candidatePaths = [sourcePath, `${this.plugin.settings.dailyFolder}/${dateStr}.md`]
      .filter((path, index, paths) => path && paths.indexOf(path) === index);
    const snapshots = [];
    for (const path of candidatePaths) {
      const existingFile = app?.vault?.getAbstractFileByPath?.(path);
      if (!existingFile) continue;
      const TFile = getObsidianWeatherDeps().TFile;
      if (!(existingFile instanceof TFile)) continue;
      const cache = app.metadataCache?.getFileCache?.(existingFile);
      const snapshot = compatibleSnapshot(cache?.frontmatter?._calendar_weather, this.plugin.settings);
      if (snapshot) snapshots.push({ snapshot: normalizeIcon(snapshot), source: 'frontmatter' });
    }
    return snapshots;
  }

  _cachedCandidates(dateStr, sourcePath) {
    const candidates = [];
    const cacheEntry = this.plugin.weatherCache?.[dateStr];
    const cacheSnapshot = compatibleSnapshot(cacheEntry, this.plugin.settings);
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

    candidates.push(...this._readLegacySnapshots(dateStr, sourcePath));

    const memoryRecord = this._memoryCache.get(dateStr);
    if (memoryRecord?.configKey === this._configKey() && memoryRecord.snapshot) {
      const memorySnapshot = compatibleSnapshot(memoryRecord.snapshot, this.plugin.settings);
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

  _selectCached(dateStr, sourcePath, ttlHours) {
    const candidates = this._cachedCandidates(dateStr, sourcePath);
    if (candidates.length === 0) return null;
    const fresh = candidates.find((candidate) => !this._shouldFetch(candidate.record || candidate.snapshot, ttlHours));
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

  async _fetchOrUseCached(dateStr, forceRefresh) {
    const s = this.plugin.settings;
    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits === 'imperial' ? 'imperial' : 'metric';
    const ttlHours = s.weatherTtlHours || 2;
    const locationName = s.weatherLocationName || '';
    const memoryRecord = this._memoryCache.get(dateStr);
    const cached = this._selectCached(dateStr, undefined, ttlHours);

    // Preserve the existing short-lived negative cache for dates with no
    // usable snapshot, while force refresh always gets a new attempt.
    if (!forceRefresh && memoryRecord?.configKey === this._configKey()
      && memoryRecord.snapshot === null && !cached && !this._shouldFetch(memoryRecord, ttlHours)) {
      return null;
    }

    if (!forceRefresh && cached && !this._shouldFetch(cached.record || cached.snapshot, ttlHours)) {
      this._migrateFrontmatterCache(dateStr, cached);
      return cached.snapshot;
    }

    const fetchResult = await this._fetchFromOpenMeteoResult(lat, lng, dateStr, units, locationName);
    const weather = fetchResult.snapshot;
    if (!weather) {
      if (cached?.snapshot) return cloneStaleSnapshot(cached.snapshot, fetchResult.offline);
      // Preserve the existing null behavior for dates with no usable cache.
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: this._nowIso(), configKey: this._configKey() });
      return null;
    }

    await this._persistSnapshot(dateStr, weather);
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: this._nowIso(), configKey: this._configKey() });
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

  _buildWeatherUrl(lat, lng, dateStr, units) {
    const timezone = this.plugin.settings.weatherTimezone || 'auto';
    const today = daylineDate(this.plugin.settings, new Date(this._now()));
    const isToday = dateStr === today;
    const isArchive = dateStr < today;
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
    if (units === 'imperial') {
      params.set('temperature_unit', 'fahrenheit');
      params.set('wind_speed_unit', 'mph');
    } else {
      params.set('temperature_unit', 'celsius');
      params.set('wind_speed_unit', 'kmh');
    }
    const baseUrl = isArchive
      ? 'https://archive-api.open-meteo.com/v1/archive'
      : 'https://api.open-meteo.com/v1/forecast';
    return `${baseUrl}?${params.toString()}`;
  }

  async _requestWeather(url) {
    return requestWeatherWithRetry(
      () => this._request({ url, timeout: 10000 }),
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

  _dailySnapshot(daily, idx, lat, lng, dateStr, units, locationName, fetchedAt = this._nowIso()) {
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
      configKey: this._configKey(),
    };
  }

  _currentSnapshot(json, lat, lng, dateStr, units, locationName, fetchedAt) {
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
      configKey: this._configKey(),
    };
  }

  /** Call Open-Meteo once per operation, with all retry attempts inside it. */
  async _fetchFromOpenMeteoResult(lat, lng, dateStr, units, locationName) {
    const url = this._buildWeatherUrl(lat, lng, dateStr, units);
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
      const today = daylineDate(this.plugin.settings, new Date(this._now()));
      if (dateStr === today) {
        const current = this._currentSnapshot(response.json, lat, lng, dateStr, units, locationName, fetchedAt);
        if (current) return { snapshot: current, offline: false };
      }
      const daily = response.json.daily;
      const idx = this._dailyIndex(daily, dateStr);
      return {
        snapshot: this._dailySnapshot(daily, idx, lat, lng, dateStr, units, locationName, fetchedAt),
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
    const baseUrl = dateStr < today
      ? 'https://archive-api.open-meteo.com/v1/archive'
      : 'https://api.open-meteo.com/v1/forecast';
    try {
      return await this._requestWeather(`${baseUrl}?${params.toString()}`);
    } catch (err) {
      console.warn('[Dayline] Daily weather fetch failed:', err?.message || err);
      return null;
    }
  }

  /** Persist only canonical data; offline/stale status is transient UI state. */
  async _persistSnapshot(dateStr, weather) {
    const canonical = toCanonicalWeatherSnapshot(weather);
    if (!canonical) return;
    if (canonical.configKey && canonical.configKey !== this._configKey()) return;
    if (!this.plugin.weatherCache) this.plugin.weatherCache = {};
    this.plugin.weatherCache[dateStr] = { ...canonical, configKey: this._configKey() };
    this.plugin._saveWeatherCache?.();
  }

  /** Force a refresh while retaining stale-cache fallback and deduplication. */
  async forceRefresh(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) return null;
    return this._runDeduplicated(dateStr, () => this._fetchOrUseCached(dateStr, true));
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
      if (entry && this.isSnapshotCompatible(entry) && entry.fetchedAt && !this._shouldFetch(entry, this.plugin.settings.weatherTtlHours || 2)) {
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
      if (done < total) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    this.plugin._saveWeatherCache?.();
    return done;
  }
}
