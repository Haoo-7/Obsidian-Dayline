import { describe, expect, it } from 'vitest';
import { detectPlatformCapabilities, resolveCapabilityRoute, usesPhoneLayout } from '../src/platform-capabilities';

function browser(overrides: any = {}) {
  return {
    Platform: { isMobile: true, isIosApp: true, ...overrides.Platform },
    document: { createElement: (tag: string) => tag === 'canvas'
      ? { getContext: () => ({}) }
      : { canPlayType: () => 'maybe' }, },
    navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
    URL: { createObjectURL() {}, revokeObjectURL() {} },
    WebAssembly: { instantiate() {} },
    // Default to a phone-sized viewport so tests opt in to tablet layout
    // explicitly instead of inheriting it from the coarse-pointer default.
    matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') }),
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

  it('mirrors Obsidian viewport detection when Platform omits the form factor', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: false, isPhone: false, isTablet: false, isDesktop: false },
      navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: (query: string) => ({ matches: query.includes('min-width: 600px') }),
    }));
    expect(result.isPhone).toBe(false);
    expect(result.isTablet).toBe(false);
    // Obsidian decides tablet vs phone from the viewport; mirror that so a
    // tablet is never routed through the phone single-leaf layout.
    expect(result.isTabletLayout).toBe(true);
    expect(result.isPhoneLayout).toBe(false);
  });

  it('follows the viewport even when the host reports no touch points', () => {
    // Desktop mobile emulation reports maxTouchPoints: 0 while still driving
    // Obsidian's is-tablet body class from the viewport query alone. Requiring a
    // touch point here would wrongly force the phone layout on a real tablet.
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: false, isPhone: false, isTablet: false, isDesktop: false },
      navigator: { maxTouchPoints: 0, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: (query: string) => ({ matches: query.includes('min-width: 600px') }),
    }));
    expect(result.isTabletLayout).toBe(true);
    expect(result.isPhoneLayout).toBe(false);
  });

  it('prefers the live viewport over a stale Platform flag', () => {
    // Obsidian sets isTablet = mq.matches and isPhone = !mq.matches from one
    // query, and skips the update while the soft keyboard is visible. A stale
    // pair therefore must not override the viewport currently being rendered.
    const shrunk = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: true, isPhone: false, isTablet: true, isIosApp: true },
      navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') }),
    }));
    expect(shrunk.isPhoneLayout).toBe(true);
    expect(shrunk.isTabletLayout).toBe(false);

    const grown = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: true, isPhone: true, isTablet: false, isIosApp: true },
      navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: (query: string) => ({ matches: true }),
    }));
    expect(grown.isPhoneLayout).toBe(false);
    expect(grown.isTabletLayout).toBe(true);
  });

  it('falls back to the Platform flag when no media query exists', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: true, isPhone: false, isTablet: true, isIosApp: true },
      navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: undefined,
    }));
    expect(result.isPhoneLayout).toBe(false);
    expect(result.isTabletLayout).toBe(true);
  });

  it('keeps a small touch viewport on the phone layout', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: true, isMobileApp: true, isPhone: true, isTablet: false, isIosApp: true },
      navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') }),
    }));
    expect(result.isPhoneLayout).toBe(true);
    expect(result.isTabletLayout).toBe(false);
  });

  it('never infers a phone layout on a non-mobile host', () => {
    const result = detectPlatformCapabilities(browser({
      Platform: { isMobile: false, isMobileApp: false, isPhone: false, isTablet: false, isDesktop: true },
      navigator: { maxTouchPoints: 0, deviceMemory: 8, hardwareConcurrency: 8 },
      matchMedia: () => ({ matches: false }),
    }));
    expect(result.isPhoneLayout).toBe(false);
    expect(result.isTabletLayout).toBe(false);
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

  it('falls back to the mobile flag when a host predates isPhoneLayout', () => {
    // Hand-built hosts and older capability snapshots must keep their previous
    // phone behavior instead of being silently promoted to the tablet path.
    expect(usesPhoneLayout({ isMobile: true } as any)).toBe(true);
    expect(usesPhoneLayout({ isMobile: false } as any)).toBe(false);
    expect(usesPhoneLayout(null)).toBe(false);
    expect(usesPhoneLayout(undefined)).toBe(false);
  });

  it('prefers the explicit phone-layout flag when present', () => {
    expect(usesPhoneLayout({ isMobile: true, isPhoneLayout: false } as any)).toBe(false);
    expect(usesPhoneLayout({ isMobile: false, isPhoneLayout: true } as any)).toBe(true);
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
