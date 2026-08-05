// @ts-nocheck
const { TFile, requestUrl } = require('obsidian');
const { getTodayDate } = require('./date-utils');
const { weatherConfigKey, migrateCompatibleSnapshot, isSnapshotStale } = require('./weather-cache');

function daylineDate(settings, date = new Date()) {
  return getTodayDate(settings?.weatherTimezone || 'auto', date);
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
  { code: 63,  condition: 'Moderate rain',            icon: 'rain.svg' },
  { code: 65,  condition: 'Heavy rain',               icon: 'rain.svg' },
  { code: 71,  condition: 'Slight snow fall',         icon: 'snow.svg' },
  { code: 73,  condition: 'Moderate snow fall',       icon: 'snow.svg' },
  { code: 75,  condition: 'Heavy snow fall',          icon: 'snow.svg' },
  { code: 77,  condition: 'Snow grains',              icon: 'snow.svg' },
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

function _snapshotMatchesWeatherConfig(snapshot, settings) {
  const migrated = migrateCompatibleSnapshot(snapshot, settings);
  if (!migrated) return false;
  Object.assign(snapshot, migrated);
  _normalizeSnapshotLocation(snapshot, settings);
  return true;
}

function _normalizeSnapshotLocation(snapshot, settings) {
  const lat = parseFloat(settings.weatherLatitude);
  const lng = parseFloat(settings.weatherLongitude);
  snapshot.location = settings.weatherLocationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
}

/**
 * WeatherService — handles Open-Meteo API calls and frontmatter snapshot persistence.
 * Singleton shared across CalendarView instances.
 */
export class WeatherService {
  constructor(plugin) {
    this.plugin = plugin;
    // Per-date in-flight promise map to avoid duplicate requests
    this._inFlight = new Map();
    // Per-date memory cache to avoid repeated network calls for missing files
    this._memoryCache = new Map();
  }

  /**
   * Get weather snapshot for a given date string (YYYY-MM-DD).
   * Reads existing frontmatter snapshot first; fetches only when missing/stale.
   * Returns cached snapshot or fetched data, never blocks caller.
   */
  async getSnapshot(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) return null;

    const requestKey = `${dateStr}|${this._configKey()}`;
    // Return existing in-flight promise to deduplicate concurrent calls for
    // the same date and weather configuration.
    if (this._inFlight.has(requestKey)) {
      return this._inFlight.get(requestKey);
    }

    const promise = this._fetchOrUseCached(dateStr).finally(() => {
      if (this._inFlight.get(requestKey) === promise) this._inFlight.delete(requestKey);
    });
    this._inFlight.set(requestKey, promise);
    return promise;
  }

  /** Check if we should fetch or use cached data.
   * Accepts either a frontmatter snapshot ({fetchedAt}) or a memory cache record ({snapshot, cachedAt}). */
  _shouldFetch(record, ttlHours) {
    // Memory cache record shape: { snapshot, cachedAt }
    if (record && typeof record === 'object' && 'cachedAt' in record) {
      return isSnapshotStale({ ...(record.snapshot || {}), cachedAt: record.cachedAt }, ttlHours);
    }
    // Frontmatter snapshot shape: { fetchedAt, ...weather fields }
    return isSnapshotStale(record, ttlHours);
  }

  _configKey() {
    return weatherConfigKey(this.plugin.settings);
  }

  isSnapshotCompatible(snapshot) {
    return _snapshotMatchesWeatherConfig(snapshot, this.plugin.settings);
  }

  getCachedSnapshot(dateStr, sourcePath) {
    const entry = this.plugin.weatherCache?.[dateStr];
    if (entry && this.isSnapshotCompatible(entry)) return entry;

    const candidatePaths = [sourcePath, `${this.plugin.settings.dailyFolder}/${dateStr}.md`]
      .filter((path, index, paths) => path && paths.indexOf(path) === index);
    for (const path of candidatePaths) {
      const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
      if (!(existingFile instanceof TFile)) continue;
      const cache = this.plugin.app.metadataCache.getFileCache(existingFile);
      const snap = cache?.frontmatter?._calendar_weather;
      if (snap && this.isSnapshotCompatible(snap)) return snap;
    }
    return null;
  }

  /** Fetch from Open-Meteo or return cached snapshot from plugin data. */
  async _fetchOrUseCached(dateStr) {
    const s = this.plugin.settings;
    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits;
    const ttlHours = s.weatherTtlHours || 2;
    const locationName = s.weatherLocationName || '';

    // Helper to normalize icon field (migrate emoji → .svg filename)
    const _normIcon = (entry) => {
      if (entry && typeof entry.icon === 'string' && !entry.icon.endsWith('.svg') && entry.weatherCode != null) {
        const wmo = lookupWeatherCode(entry.weatherCode);
        entry.icon = wmo.icon;
      }
    };

    // 1. Check weatherCache in plugin data.json (new storage)
    const cacheEntry = this.plugin.weatherCache?.[dateStr];
    if (cacheEntry && this.isSnapshotCompatible(cacheEntry) && cacheEntry.fetchedAt && !this._shouldFetch(cacheEntry, ttlHours)) {
      _normIcon(cacheEntry);
      return cacheEntry;
    }

    // 2. Fallback: check legacy frontmatter _calendar_weather (for existing users)
    const path = `${s.dailyFolder}/${dateStr}.md`;
    const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile) {
      const cache = this.plugin.app.metadataCache.getFileCache(existingFile);
      const snap = cache?.frontmatter?._calendar_weather;
      if (snap && typeof snap === 'object' && this.isSnapshotCompatible(snap) && !this._shouldFetch(snap, ttlHours)) {
        _normIcon(snap);
        this.plugin.weatherCache = this.plugin.weatherCache || {};
        this.plugin.weatherCache[dateStr] = { ...snap };
        this.plugin._saveWeatherCache();
        return snap;
      }
    }

    // 3. Memory cache (for dates without diary files)
    const cachedRecord = this._memoryCache.get(dateStr);
    if (cachedRecord && cachedRecord.configKey === this._configKey() && !this._shouldFetch(cachedRecord, ttlHours)) {
      return cachedRecord.snapshot;
    }

    // Fetch from Open-Meteo
    const weather = await this._fetchFromOpenMeteo(lat, lng, dateStr, units, locationName);
    if (!weather) {
      // Cache a null-result record so we don't hammer the API for missing notes
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: new Date().toISOString(), configKey: this._configKey() });
      return null;
    }

    // Persist snapshot to frontmatter if the file now exists
    await this._persistSnapshot(dateStr, weather);

    // Also cache in memory for subsequent calls on non-existent files
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: new Date().toISOString(), configKey: this._configKey() });

    return weather;
  }

  /** Call Open-Meteo API for current + forecast data. */
  async _fetchFromOpenMeteo(lat, lng, dateStr, units, locationName) {
    const isToday = dateStr === daylineDate(this.plugin.settings);
    const timezone = this.plugin.settings.weatherTimezone || 'auto';

    // Build daily params
    const dailyParams = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      daily: 'temperature_2m_max,temperature_2m_min,weathercode,relative_humidity_2m_max,apparent_temperature_max',
      timezone,
      start_date: dateStr,
      end_date: dateStr,
    });
    if (units === 'imperial') {
      dailyParams.set('temperature_unit', 'fahrenheit');
      dailyParams.set('wind_speed_unit', 'mph');
    } else {
      dailyParams.set('temperature_unit', 'celsius');
      dailyParams.set('wind_speed_unit', 'kmh');
    }

    // Single combined request for today (current + daily), daily-only for other dates
    let baseUrl, url;
    if (isToday) {
      const combinedParams = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lng),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
        daily: 'temperature_2m_max,temperature_2m_min,weathercode,relative_humidity_2m_max,apparent_temperature_max',
        timezone,
        start_date: dateStr,
        end_date: dateStr,
      });
      if (units === 'imperial') {
        combinedParams.set('temperature_unit', 'fahrenheit');
        combinedParams.set('wind_speed_unit', 'mph');
      } else {
        combinedParams.set('temperature_unit', 'celsius');
        combinedParams.set('wind_speed_unit', 'kmh');
      }
      baseUrl = 'https://api.open-meteo.com/v1/forecast';
      url = `${baseUrl}?${combinedParams.toString()}`;
    } else {
      baseUrl = dateStr < daylineDate(this.plugin.settings) ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
      url = `${baseUrl}?${dailyParams.toString()}`;
    }

    let response;
    try {
      response = await requestUrl({ url, timeout: 10000 });
    } catch (err) {
      console.warn('[Dayline] Weather fetch failed:', err.message);
      return null;
    }

    if (response.status !== 200 || !response.json) {
      console.warn('[Dayline] Weather API returned status', response.status);
      return null;
    }

    const json = response.json;

    // --- Today: combined current + daily ---
    if (isToday && json.current) {
      const cur = json.current;
      const code = typeof cur.weather_code === 'number' ? cur.weather_code : null;
      if (code !== null) {
        const wmo = lookupWeatherCode(code);
        const tempCur = typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null;
        const feelsCur = typeof cur.apparent_temperature === 'number' ? Math.round(cur.apparent_temperature) : null;
        const humCur = typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : null;

        // Merge daily high/low into current snapshot
        let high = null, low = null, feelsLike = null, humidity = null;
        if (json.daily) {
          const dates = json.daily.time || [];
          const idx = dates.indexOf(dateStr);
          if (idx >= 0) {
            high = typeof json.daily.temperature_2m_max?.[idx] === 'number' ? json.daily.temperature_2m_max[idx] : null;
            low = typeof json.daily.temperature_2m_min?.[idx] === 'number' ? json.daily.temperature_2m_min[idx] : null;
            feelsLike = typeof json.daily.apparent_temperature_max?.[idx] === 'number' ? json.daily.apparent_temperature_max[idx] : null;
            humidity = typeof json.daily.relative_humidity_2m_max?.[idx] === 'number' ? json.daily.relative_humidity_2m_max[idx] : null;
          }
        }

        return {
          fetchedAt: new Date().toISOString(),
          date: dateStr,
          location: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
          latitude: lat,
          longitude: lng,
          temperature: tempCur,
          feelsLike: feelsCur,
          humidity: humCur,
          weatherCode: code,
          condition: wmo.condition,
          icon: wmo.icon,
          high: high,
          low: low,
          temperatureLabel: 'Now',
          units: units,
          configKey: this._configKey(),
        };
      }
    }

    // Fallback: daily-only path (non-today or combined request lacked useful data)
    const dailyData = await this._dailyOnlyFetch(lat, lng, dateStr, dailyParams, units);
    if (!dailyData) return null;
    // Validate response status and JSON structure before accessing daily data
    if (dailyData.status !== 200 || !dailyData.json) {
      console.warn('[Dayline] Daily weather fetch returned unexpected response');
      return null;
    }
    const dailyJson = dailyData.json;
    if (!dailyJson?.daily) {
      console.warn('[Dayline] Daily weather data missing "daily" field');
      return null;
    }
    const daily = dailyJson.daily;
    const dates = daily.time || [];
    const idx = dates.indexOf(dateStr);

    if (idx === -1) {
      console.warn(`[Dayline] Weather data unavailable for ${dateStr}`);
      return null;
    }

    const code = daily.weathercode?.[idx];
    const tempMax = daily.temperature_2m_max?.[idx];
    const tempMin = daily.temperature_2m_min?.[idx];
    const feelsLike = daily.apparent_temperature_max?.[idx];
    const humidity = daily.relative_humidity_2m_max?.[idx];

    if (typeof code !== 'number') return null;

    const wmo = lookupWeatherCode(code);

    return {
      fetchedAt: new Date().toISOString(),
      date: dateStr,
      location: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
      latitude: lat,
      longitude: lng,
      temperature: typeof tempMax === 'number' ? Math.round(tempMax) : null,
      feelsLike: typeof feelsLike === 'number' ? Math.round(feelsLike) : null,
      humidity: typeof humidity === 'number' ? humidity : null,
      weatherCode: code,
      condition: wmo.condition,
      icon: wmo.icon,
      high: typeof tempMax === 'number' ? tempMax : null,
      low: typeof tempMin === 'number' ? tempMin : null,
      temperatureLabel: 'High',
      units: units,
      configKey: this._configKey(),
    };
  }

  /** Fetch only daily data (for non-today dates or fallback). */
  async _dailyOnlyFetch(lat, lng, dateStr, params, units) {
    const baseUrl = (() => {
      return dateStr < daylineDate(this.plugin.settings)
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast';
    })();

    const url = `${baseUrl}?${params.toString()}`;

    try {
      return await requestUrl({ url, timeout: 8000 });
    } catch (err) {
      console.warn('[Dayline] Daily weather fetch failed:', err.message);
      return null;
    }
  }

  /** Persist weather snapshot to plugin data (no more YAML pollution). */
  async _persistSnapshot(dateStr, weather) {
    if (weather?.configKey && weather.configKey !== this._configKey()) return;
    if (!this.plugin.weatherCache) this.plugin.weatherCache = {};
    this.plugin.weatherCache[dateStr] = { ...weather, configKey: this._configKey() };
    this.plugin._saveWeatherCache();
  }

  /** Force refresh weather for a specific date (bypasses TTL check). */
  async forceRefresh(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) return null;

    // Clear in-flight promises for this date. Their completion handlers are
    // guarded so they cannot delete or overwrite a newer request.
    for (const key of this._inFlight.keys()) {
      if (key.startsWith(`${dateStr}|`)) this._inFlight.delete(key);
    }

    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits;
    const locationName = s.weatherLocationName || '';

    const weather = await this._fetchFromOpenMeteo(lat, lng, dateStr, units, locationName);
    if (!weather) {
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: new Date().toISOString(), configKey: this._configKey() });
      return null;
    }

    // Update memory cache immediately so UI can read it without waiting on persistence
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: new Date().toISOString(), configKey: this._configKey() });

    // Persist to frontmatter asynchronously — fire-and-forget with error handling
    this._persistSnapshot(dateStr, weather).catch((err) => {
      console.warn('[Dayline] Async weather persistence failed:', err.message);
    });

    return weather;
  }

  /** Check if a date has a valid cached snapshot (for badge display). */
  hasCachedSnapshot(dateStr, sourcePath) {
    if (!this.plugin.settings.weatherEnabled) return false;
    // Check new weatherCache first
    return !!this.getCachedSnapshot(dateStr, sourcePath);
  }

  /** Bulk-fetch weather for a list of dates with 2s delay between requests. */
  async bulkBackfill(dateStrs, onProgress) {
    let done = 0;
    const total = dateStrs.length;
    for (const dateStr of dateStrs) {
      // Skip if already cached and not stale
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
      // Delay between requests to be nice to the free API
      if (done < total) await new Promise(r => setTimeout(r, 2000));
    }
    // Persist all fetched data
    this.plugin._saveWeatherCache();
    return done;
  }
}
