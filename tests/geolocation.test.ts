// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  COORDINATE_DECIMALS,
  GEOLOCATION_TIMEOUT_MS,
  applyDeviceLocation,
  coordinatesMovedBeyondThreshold,
  formatCoordinates,
  geolocationFailureKey,
  requestCurrentCoordinates,
} from '../src/geolocation';

function successProvider(coords: { latitude: number; longitude: number; accuracy?: number }) {
  return {
    getCurrentPosition: (
      onSuccess: (position: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void,
    ) => {
      onSuccess({ coords });
    },
  };
}

/** Resolve with the rejection reason, typed as an Error for assertions. */
function expectRejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => { throw new Error('expected the request to reject'); },
    (error: unknown) => error as Error,
  );
}

describe('one-tap device geolocation', () => {
  it('resolves once with the device coordinates', async () => {
    const calls: Array<unknown> = [];
    const provider = {
      getCurrentPosition: (
        onSuccess: (position: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void,
        _onError?: unknown,
        options?: unknown,
      ) => {
        calls.push(options);
        onSuccess({ coords: { latitude: 39.9042, longitude: 116.4074, accuracy: 20 } });
      },
    };
    await expect(requestCurrentCoordinates({ geolocation: provider })).resolves.toMatchObject({
      latitude: 39.9042,
      longitude: 116.4074,
      accuracy: 20,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      enableHighAccuracy: false,
      timeout: GEOLOCATION_TIMEOUT_MS,
    });
  });

  it('rejects invalid coordinates instead of saving them', async () => {
    const provider = successProvider({ latitude: 200, longitude: 500 });
    await expect(requestCurrentCoordinates({ geolocation: provider })).rejects.toThrow('invalid');
  });

  it('maps denial, timeout, and missing providers to localized notice keys', async () => {
    const denied = {
      getCurrentPosition: (
        _onSuccess: unknown,
        onError?: (error: { code?: number }) => void,
      ) => onError?.({ code: 1 }),
    };
    const timedOut = {
      getCurrentPosition: (
        _onSuccess: unknown,
        onError?: (error: { code?: number }) => void,
      ) => onError?.({ code: 3 }),
    };

    await expect(requestCurrentCoordinates({ geolocation: denied })).rejects.toThrow('denied');
    await expect(requestCurrentCoordinates({ geolocation: timedOut })).rejects.toThrow('timeout');
    await expect(requestCurrentCoordinates({ geolocation: undefined })).rejects.toThrow('unavailable');
    await expect(requestCurrentCoordinates(null)).rejects.toThrow('unavailable');

    expect(geolocationFailureKey(new Error('denied'))).toBe('locateDenied');
    expect(geolocationFailureKey(new Error('timeout'))).toBe('locateTimedOut');
    expect(geolocationFailureKey(new Error('unavailable'))).toBe('locateUnavailable');
    expect(geolocationFailureKey(new Error('Position unavailable'))).toBe('locateError');
  });

  it('maps POSITION_UNAVAILABLE (code 2) to a localized key and logs the raw message for debugging only', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const provider = {
        getCurrentPosition: (
          _onSuccess: unknown,
          onError?: (error: { code?: number; message?: string }) => void,
        ) => onError?.({ code: 2, message: 'Position unavailable: no location provider' }),
      };
      const error = await expectRejection(requestCurrentCoordinates({ geolocation: provider }));
      expect(error.message).toBe('unavailable');
      expect(geolocationFailureKey(error)).toBe('locateUnavailable');
      expect(debug).toHaveBeenCalledWith('[Dayline] Geolocation failed:', 'Position unavailable: no location provider');
    } finally {
      debug.mockRestore();
    }
  });

  it('does not put an unknown provider message into the notice text', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const provider = {
        getCurrentPosition: (
          _onSuccess: unknown,
          onError?: (error: { message?: string }) => void,
        ) => onError?.({ message: 'Geolocation has been disabled in this document by permissions policy.' }),
      };
      const error = await expectRejection(requestCurrentCoordinates({ geolocation: provider }));
      expect(error.message).toBe('failed');
      expect(geolocationFailureKey(error)).toBe('locateError');
      expect(error.message).not.toContain('permissions policy');
    } finally {
      debug.mockRestore();
    }
  });

  it('times out instead of waiting on a silent provider', async () => {
    vi.useFakeTimers();
    try {
      const hanging = {
        getCurrentPosition: () => undefined,
      };
      const pending = requestCurrentCoordinates({ geolocation: hanging }, { timeoutMs: 1000 });
      const assertion = expect(pending).rejects.toThrow('timeout');
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('storing a device reading', () => {
  it('stores the coordinates at the precision weather needs', () => {
    const settings = { weatherLatitude: '', weatherLongitude: '', weatherLocationName: '' };
    expect(applyDeviceLocation(settings, { latitude: 39.90423456, longitude: 116.40741234 }))
      .toEqual({ clearedLocationName: false });
    expect(settings.weatherLatitude).toBe('39.90');
    expect(settings.weatherLongitude).toBe('116.41');
    expect(COORDINATE_DECIMALS).toBe(2);
  });

  it('clears a stale place name when the reading moved elsewhere', () => {
    const settings = { weatherLatitude: '39.9042', weatherLongitude: '116.4074', weatherLocationName: 'Beijing' };
    expect(applyDeviceLocation(settings, { latitude: 31.2304, longitude: 121.4737 }))
      .toEqual({ clearedLocationName: true });
    expect(settings.weatherLocationName).toBe('');
    expect(settings.weatherLatitude).toBe('31.23');
    expect(settings.weatherLongitude).toBe('121.47');
  });

  it('keeps the place name when the reading confirms the same coordinates', () => {
    const settings = { weatherLatitude: '39.9042', weatherLongitude: '116.4074', weatherLocationName: 'Beijing' };
    expect(applyDeviceLocation(settings, { latitude: 39.9042, longitude: 116.4074 }))
      .toEqual({ clearedLocationName: false });
    expect(settings.weatherLocationName).toBe('Beijing');
  });

  it('compares movement at the stored precision and tolerates a missing baseline', () => {
    expect(formatCoordinates(39.9042, 116.4074)).toBe('39.90, 116.41');
    expect(coordinatesMovedBeyondThreshold('39.9042', '116.4074', 39.90421, 116.40741)).toBe(false);
    expect(coordinatesMovedBeyondThreshold('39.9042', '116.4074', 39.92, 116.4074)).toBe(true);
    expect(coordinatesMovedBeyondThreshold('', '', 31.2304, 121.4737)).toBe(false);
    expect(coordinatesMovedBeyondThreshold('19abc', '116.4074', 31.2304, 121.4737)).toBe(false);
  });
});
