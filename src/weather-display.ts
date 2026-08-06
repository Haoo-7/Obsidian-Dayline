import type { WeatherSnapshot } from './types';

export interface WeatherDisplayLabels {
  feels: string;
  humidity: string;
  low: string;
  precipitation: string;
  wind: string;
  sunrise: string;
  sunset: string;
  cached: string;
  stale: string;
  offline: string;
}

/**
 * Open-Meteo returns sunrise/sunset as local wall-clock values for the
 * requested timezone. Read the clock portion directly so the host timezone
 * cannot move the displayed time across a date boundary.
 */
export function formatWeatherTime(value: unknown, _language = 'en', _timezone = 'auto'): string {
  const match = typeof value === 'string' ? /T(\d{1,2}):(\d{2})/.exec(value) : null;
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

export function weatherWindUnit(units: unknown): string {
  return units === 'imperial' ? 'mph' : 'km/h';
}

export function buildWeatherDetailParts(
  snapshot: WeatherSnapshot,
  labels: Pick<WeatherDisplayLabels, 'feels' | 'humidity' | 'low'>,
): string[] {
  const unit = snapshot.units === 'imperial' ? '\u00b0F' : '\u00b0C';
  const parts: string[] = [];
  if (snapshot.feelsLike != null) parts.push(`${labels.feels} ${snapshot.feelsLike}${unit}`);
  if (snapshot.humidity != null) parts.push(`${labels.humidity} ${snapshot.humidity}%`);
  return parts;
}

export function buildWeatherExtraParts(
  snapshot: WeatherSnapshot,
  labels: Pick<WeatherDisplayLabels, 'precipitation' | 'wind' | 'sunrise' | 'sunset'> & { low?: string },
  language = 'en',
  timezone = 'auto',
): string[] {
  const parts: string[] = [];
  if (snapshot.low != null && labels.low) parts.push(`${labels.low} ${snapshot.low}${snapshot.units === 'imperial' ? '\u00b0F' : '\u00b0C'}`);
  if (snapshot.precipitationProbability != null) {
    parts.push(`${labels.precipitation} ${snapshot.precipitationProbability}%`);
  }
  if (snapshot.windSpeed != null) {
    parts.push(`${labels.wind} ${Math.round(Number(snapshot.windSpeed))} ${weatherWindUnit(snapshot.units)}`);
  }
  const sunrise = formatWeatherTime(snapshot.sunrise, language, timezone);
  const sunset = formatWeatherTime(snapshot.sunset, language, timezone);
  if (sunrise) parts.push(`${labels.sunrise} ${sunrise}`);
  if (sunset) parts.push(`${labels.sunset} ${sunset}`);
  return parts;
}

export function buildWeatherStatus(
  snapshot: WeatherSnapshot,
  labels: Pick<WeatherDisplayLabels, 'cached' | 'stale' | 'offline'>,
): string[] {
  if (!snapshot.stale && !snapshot.offline) return [];
  return [labels.cached, snapshot.stale ? labels.stale : '', snapshot.offline ? labels.offline : '']
    .filter(Boolean);
}
