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

  it('keeps the desktop capability routes independent from mobile routing', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: false, isDesktop: true },
      navigator: { maxTouchPoints: 0, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: () => ({ matches: false }),
    }));
    expect(result.isMobile).toBe(false);
    expect(result.isDesktop).toBe(true);
    expect(result.coarsePointer).toBe(false);
    expect(resolveCapabilityRoute(result, 'mediaMetadata')).toBe('full');
    expect(resolveCapabilityRoute(result, 'mediaCover')).toBe('full');
    expect(resolveCapabilityRoute(result, 'heic')).toBe('full');
    expect(resolveCapabilityRoute(result, 'audioArtwork')).toBe('full');
  });

  it('reads phone-app form factor from Platform without inferring from viewport or pointer', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: true, isPhone: true, isTablet: false, isIosApp: true },
      navigator: { maxTouchPoints: 0, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: () => ({ matches: false }),
    }));
    expect(result.isMobile).toBe(true);
    expect(result.isMobileApp).toBe(true);
    expect(result.isPhone).toBe(true);
    expect(result.isTablet).toBe(false);
    expect(result.isDesktop).toBe(false);
  });

  it('reads tablet-app form factor from Platform without treating it as a phone', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: true, isPhone: false, isTablet: true, isIosApp: true },
    }));
    expect(result.isMobile).toBe(true);
    expect(result.isMobileApp).toBe(true);
    expect(result.isPhone).toBe(false);
    expect(result.isTablet).toBe(true);
  });

  it('keeps desktop mobile emulation as isMobile without marking a phone or tablet app', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: false, isPhone: false, isTablet: false, isDesktop: false },
    }));
    expect(result.isMobile).toBe(true);
    expect(result.isMobileApp).toBe(false);
    expect(result.isPhone).toBe(false);
    expect(result.isTablet).toBe(false);
  });

  it('does not infer phone or tablet flags on desktop', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: false, isMobileApp: false, isPhone: false, isTablet: false, isDesktop: true },
      navigator: { maxTouchPoints: 0, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: () => ({ matches: false }),
    }));
    expect(result.isMobile).toBe(false);
    expect(result.isMobileApp).toBe(false);
    expect(result.isPhone).toBe(false);
    expect(result.isTablet).toBe(false);
    expect(result.isDesktop).toBe(true);
  });
});
