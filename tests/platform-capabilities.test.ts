import { describe, expect, it } from 'vitest';
import { detectPlatformCapabilities, resolveCapabilityRoute } from '../src/platform-capabilities';

function browser(overrides: any = {}) {
  return {
    Platform: { isMobile: true, isIosApp: true, ...overrides.Platform },
    document: { createElement: (tag: string) => tag === 'canvas'
      ? { getContext: () => ({}) }
      : { canPlayType: () => 'maybe' }, },
    navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
    URL: { createObjectURL() {}, revokeObjectURL() {} },
    WebAssembly: { instantiate() {} },
    matchMedia: () => ({ matches: true }),
    app: {
      fileManager: { getAvailablePathForAttachment() {} },
      vault: { createBinary() {} },
    },
    ...overrides,
  };
}

describe('platform capability routing', () => {
  it('detects iOS coarse-pointer capabilities and full attachment/media routes', () => {
    const result = detectPlatformCapabilities(browser());
    expect(result.isIos).toBe(true);
    expect(result.coarsePointer).toBe(true);
    expect(result.mobileCompatible).toBe(true);
    expect(resolveCapabilityRoute(result, 'attachment')).toBe('full');
    expect(resolveCapabilityRoute(result, 'heic')).toBe('disabled');
    expect(resolveCapabilityRoute(result, 'mediaMetadata')).toBe('fallback');
    expect(resolveCapabilityRoute(result, 'mediaCover')).toBe('disabled');
    expect(resolveCapabilityRoute(result, 'audioArtwork')).toBe('disabled');
  });

  it('routes low-memory mobile media away from heavy work', () => {
    const result = detectPlatformCapabilities(browser({ navigator: { maxTouchPoints: 5, deviceMemory: 1, hardwareConcurrency: 2 } }));
    expect(result.memoryConstrained).toBe(true);
    expect(resolveCapabilityRoute(result, 'mediaCover')).toBe('disabled');
    expect(resolveCapabilityRoute(result, 'audioArtwork')).toBe('disabled');
  });

  it('keeps HEIC conversion disabled on mobile even if a host exposes a factory', () => {
    const result = detectPlatformCapabilities(browser({ heicFactory: {} }));
    expect(resolveCapabilityRoute(result, 'heic')).toBe('disabled');
  });

  it('routes unsupported browser capabilities to graceful fallback/disabled states', () => {
    const result = detectPlatformCapabilities(browser({ document: { createElement: () => ({}) }, URL: {} }));
    expect(result.mobileCompatible).toBe(true);
    expect(resolveCapabilityRoute(result, 'mediaMetadata')).toBe('disabled');
    expect(resolveCapabilityRoute(result, 'heic')).toBe('disabled');
    expect(resolveCapabilityRoute(result, 'attachment')).toBe('full');
  });

  it('recognizes Android and does not infer iOS from a generic mobile flag', () => {
    const result = detectPlatformCapabilities(browser({ Platform: { isMobile: true, isAndroidApp: true } }));
    expect(result.isAndroid).toBe(true);
    expect(result.isIos).toBe(false);
  });
});
