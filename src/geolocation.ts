export type GeolocationCoordinates = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

export type GeolocationRequestOptions = {
  timeoutMs?: number;
  maximumAgeMs?: number;
};

export type GeolocationProvider = {
  getCurrentPosition: (
    onSuccess: (position: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void,
    onError?: (error: { code?: number; message?: string }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ) => void;
};

export const GEOLOCATION_TIMEOUT_MS = 15000;

/** Decimal places kept for weather coordinates: 2 decimals is roughly 1 km. */
export const COORDINATE_DECIMALS = 2;

/** Format coordinates the way the weather card and snapshots display them. */
export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(COORDINATE_DECIMALS)}, ${longitude.toFixed(COORDINATE_DECIMALS)}`;
}

/** Parse a stored coordinate; empty or non-numeric input has no baseline. */
function coordinateNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether the coordinates moved far enough that a previously entered or
 * geocoded place name no longer describes them. The comparison happens at the
 * precision the plugin stores, so a sub-kilometre move keeps the label.
 *
 * Missing or unparseable previous coordinates return `false`: without a
 * baseline there is no evidence the name went stale, and the user's own label
 * must not be discarded on a first reading.
 */
export function coordinatesMovedBeyondThreshold(
  previousLatitude: unknown,
  previousLongitude: unknown,
  nextLatitude: number,
  nextLongitude: number,
): boolean {
  const prevLat = coordinateNumber(previousLatitude);
  const prevLng = coordinateNumber(previousLongitude);
  if (prevLat === null || prevLng === null) return false;
  if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) return false;
  return formatCoordinates(prevLat, prevLng) !== formatCoordinates(nextLatitude, nextLongitude);
}

export type DeviceLocationSettings = {
  weatherLatitude: string | number;
  weatherLongitude: string | number;
  weatherLocationName: string;
};

/**
 * Store a one-tap device reading.
 *
 * The place name is dropped when it described other coordinates, because the
 * weather card prefers `weatherLocationName` over the coordinates and would
 * otherwise keep showing the old city next to the new position. Coordinates are
 * stored at the 2-decimal precision weather actually uses.
 */
export function applyDeviceLocation(
  settings: DeviceLocationSettings,
  coords: GeolocationCoordinates,
): { clearedLocationName: boolean } {
  const clearedLocationName = Boolean(settings.weatherLocationName)
    && coordinatesMovedBeyondThreshold(
      settings.weatherLatitude,
      settings.weatherLongitude,
      coords.latitude,
      coords.longitude,
    );
  if (clearedLocationName) settings.weatherLocationName = '';
  settings.weatherLatitude = coords.latitude.toFixed(COORDINATE_DECIMALS);
  settings.weatherLongitude = coords.longitude.toFixed(COORDINATE_DECIMALS);
  return { clearedLocationName };
}

export type GeolocationNavigator = {
  geolocation?: GeolocationProvider;
};

function resolveGeolocation(navigatorOverride?: GeolocationNavigator | null): GeolocationProvider | null {
  const nav: GeolocationNavigator | null = navigatorOverride !== undefined
    ? navigatorOverride
    : (typeof navigator !== 'undefined' ? { geolocation: (navigator as Navigator & GeolocationNavigator).geolocation } : null);
  const provider = nav?.geolocation;
  if (provider && typeof provider.getCurrentPosition === 'function') return provider;
  return null;
}

function normalizeCoordinates(latitude: unknown, longitude: unknown): GeolocationCoordinates | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

function geolocationErrorCode(error: unknown): number | null {
  const code = Number((error as { code?: unknown } | null)?.code);
  return Number.isFinite(code) ? code : null;
}

/** Read the device location exactly once, only after an explicit user gesture. */
export function requestCurrentCoordinates(
  navigatorOverride?: GeolocationNavigator | null,
  options: GeolocationRequestOptions = {},
): Promise<GeolocationCoordinates> {
  const provider = resolveGeolocation(navigatorOverride);
  if (!provider) return Promise.reject(new Error('unavailable'));
  const timeoutMs = options.timeoutMs ?? GEOLOCATION_TIMEOUT_MS;
  const maximumAgeMs = options.maximumAgeMs ?? 600000;
  return new Promise<GeolocationCoordinates>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('timeout'));
    }, timeoutMs);
    const finish = (task: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      task();
    };
    try {
      provider.getCurrentPosition(
        (position) => finish(() => {
          const coords = normalizeCoordinates(position?.coords?.latitude, position?.coords?.longitude);
          if (!coords) {
            reject(new Error('invalid'));
            return;
          }
          const accuracy = Number(position?.coords?.accuracy);
          resolve(Number.isFinite(accuracy) && accuracy >= 0 ? { ...coords, accuracy } : coords);
        }),
        (error) => finish(() => {
          // The raw message comes from the browser or Electron, is English, and
          // differs per platform; keep it in the debug log and reject with a
          // code-based sentinel the UI can localize.
          const message = (error as { message?: unknown } | null)?.message;
          if (typeof message === 'string' && message.length > 0) {
            console.debug('[Dayline] Geolocation failed:', message);
          }
          const code = geolocationErrorCode(error);
          if (code === 1) reject(new Error('denied'));
          else if (code === 2) reject(new Error('unavailable'));
          else if (code === 3) reject(new Error('timeout'));
          else reject(new Error('failed'));
        }),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maximumAgeMs },
      );
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

export function geolocationFailureKey(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'unavailable') return 'locateUnavailable';
  if (message === 'timeout') return 'locateTimedOut';
  if (message === 'denied') return 'locateDenied';
  return 'locateError';
}
