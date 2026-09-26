export type CapabilityRoute = 'full' | 'fallback' | 'disabled';

export type PlatformCapabilities = {
  isMobile: boolean;
  isMobileApp: boolean;
  isPhone: boolean;
  isTablet: boolean;
  /**
   * Obsidian's tablet UI. A mobile host with enough screen space keeps
   * desktop-like chrome: a pin-able sidebar, tab stacking, and splits.
   * Source: `Platform.isTablet` (documented as "sufficiently large screen space").
   */
  isTabletLayout: boolean;
  /**
   * Obsidian's phone UI. One leaf, no split, no ribbon. Also covers mobile
   * layouts Obsidian cannot classify as a tablet, including desktop mobile
   * emulation at a small viewport.
   */
  isPhoneLayout: boolean;
  isIos: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  coarsePointer: boolean;
  dom: boolean;
  canvas: boolean;
  video: boolean;
  wasm: boolean;
  objectUrls: boolean;
  filePicker: boolean;
  memoryConstrained: boolean;
  mobileCompatible: boolean;
  routes: {
    mediaMetadata: CapabilityRoute;
    mediaCover: CapabilityRoute;
    heic: CapabilityRoute;
    audioArtwork: CapabilityRoute;
    attachment: CapabilityRoute;
  };
};

type DetectionInput = {
  Platform?: any;
  app?: any;
  document?: any;
  navigator?: any;
  URL?: any;
  WebAssembly?: any;
  heicFactory?: unknown;
  matchMedia?: (query: string) => { matches?: boolean };
};

function route(enabled: boolean, fallback: boolean): CapabilityRoute {
  return enabled ? (fallback ? 'fallback' : 'full') : 'disabled';
}

/**
 * Whether the app viewport is large enough for Obsidian's tablet interface.
 *
 * Obsidian itself decides phone vs tablet with exactly this media query in the
 * app window (`Platform.isTablet` and the `is-tablet`/`is-phone` body classes are
 * both driven by it). Mirroring that single rule — rather than a width, a user
 * agent, or a touch-point count — keeps the plugin's layout in step with the
 * chrome Obsidian actually renders, including during the moment before
 * `Platform.isTablet` updates on a resize.
 *
 * Callers must still scope this to mobile hosts: a resized desktop window can
 * satisfy the query too, but that path never uses the mobile layout.
 */
function isWideTabletViewport(
  mediaQuery?: (query: string) => { matches?: boolean },
): boolean {
  if (typeof mediaQuery !== 'function') return false;
  return Boolean(mediaQuery('(min-width: 600px) and (min-height: 600px)')?.matches);
}

export function detectPlatformCapabilities(input: DetectionInput = {}): PlatformCapabilities {
  // Capability probes must stay popout-safe: resolve host globals through
  // `window` and tolerate hosts where no window exists at all.
  const host = typeof window !== 'undefined' ? window as any : undefined;
  const platform = input.Platform || host?.Platform || {};
  const doc = input.document === undefined ? host?.document : input.document;
  const nav = input.navigator === undefined ? host?.navigator : input.navigator;
  const urlApi = input.URL === undefined ? host?.URL : input.URL;
  const wasmApi = input.WebAssembly === undefined ? host?.WebAssembly : input.WebAssembly;
  const mediaQuery = input.matchMedia || host?.matchMedia;
  const isMobile = Boolean(platform.isMobile || platform.isMobileApp);
  const isMobileApp = Boolean(platform.isMobileApp);
  const isPhone = Boolean(platform.isPhone);
  const isTablet = Boolean(platform.isTablet);
  // Obsidian derives BOTH of its own form-factor flags from this one viewport
  // query, but it only refreshes them on a debounced media-query change and
  // skips the update entirely while the soft keyboard is visible. That makes
  // `Platform.isPhone`/`isTablet` stale for a moment after a resize or
  // rotation, so the live query is the better source of truth and is exactly
  // what Obsidian is rendering from. The Platform flags remain the fallback for
  // hosts that expose no media query.
  const viewportTablet = typeof mediaQuery === 'function'
    ? isWideTabletViewport(mediaQuery)
    : undefined;
  const isPhoneLayout = isMobile
    ? (viewportTablet !== undefined ? !viewportTablet : !isTablet)
    : false;
  const isTabletLayout = isMobile && !isPhoneLayout;
  const isIos = Boolean(platform.isIosApp || platform.isIos || platform.isIOS);
  const isAndroid = Boolean(platform.isAndroidApp || platform.isAndroid);
  const coarsePointer = Boolean(
    mediaQuery?.('(pointer: coarse)')?.matches
      || Number(nav?.maxTouchPoints) > 0
      || isMobile,
  );
  const dom = Boolean(doc?.createElement);
  let canvas = false;
  let video = false;
  if (dom) {
    try { canvas = Boolean(doc.createElement('canvas')?.getContext?.('2d')); } catch { canvas = false; }
    try { video = Boolean(doc.createElement('video')?.canPlayType); } catch { video = false; }
  }
  const objectUrls = Boolean(typeof urlApi?.createObjectURL === 'function' && typeof urlApi?.revokeObjectURL === 'function');
  const wasm = Boolean(typeof wasmApi?.instantiate === 'function');
  const memory = Number(nav?.deviceMemory);
  const cores = Number(nav?.hardwareConcurrency);
  const memoryConstrained = isMobile && ((Number.isFinite(memory) && memory > 0 && memory <= 2)
    || (Number.isFinite(cores) && cores > 0 && cores <= 2));
  // Keep capability detection generic; no feature-specific staging adapter is used.
  const filePicker = Boolean(
    typeof doc?.createElement === 'function'
      && typeof input.app?.vault?.createBinary === 'function'
      && typeof input.app?.fileManager?.getAvailablePathForAttachment === 'function',
  );
  const mediaCore = dom && video;
  const heavyMedia = mediaCore && objectUrls && !memoryConstrained;
  // Mobile can still show ordinary image metadata, but avoid parsing large
  // video/audio containers through Mediabunny during touch-first browsing.
  const mediaMetadata = mediaCore ? (isMobile || memoryConstrained ? 'fallback' : 'full') : 'disabled';
  // Image covers are handled independently. This route controls video frame
  // extraction and embedded audio artwork, both intentionally disabled on
  // mobile to avoid expensive decode work and large temporary blobs.
  const mediaCover = isMobile ? 'disabled' : route(heavyMedia, false);
  // HEIC conversion can allocate a large decode buffer. Keep it desktop-only
  // even when a mobile host happens to expose a converter factory.
  const heic = isMobile ? 'disabled' : route(dom && canvas && objectUrls && wasm && !memoryConstrained, false);
  const audioArtwork = isMobile ? 'disabled' : route(objectUrls && !memoryConstrained, false);
  return {
    isMobile,
    isMobileApp,
    isPhone,
    isTablet,
    isTabletLayout,
    isPhoneLayout,
    isIos,
    isAndroid,
    isDesktop: Boolean(platform.isDesktop || (!isMobile && !isIos && !isAndroid)),
    coarsePointer,
    dom,
    canvas,
    video,
    wasm,
    objectUrls,
    filePicker,
    memoryConstrained,
    mobileCompatible: dom && (isMobile ? coarsePointer : true),
    routes: {
      mediaMetadata,
      mediaCover,
      heic,
      audioArtwork,
      attachment: filePicker ? 'full' : 'disabled',
    },
  };
}

export function resolveCapabilityRoute(capabilities: PlatformCapabilities | undefined, feature: keyof PlatformCapabilities['routes']): CapabilityRoute {
  // Callers constructed before capability routing (including older test hosts)
  // retain the pre-routing behavior until the runtime supplies a route.
  return capabilities?.routes?.[feature] || 'full';
}

/**
 * Whether Dayline should use its phone layout: a single leaf that swaps between
 * calendar and timeline, with no sidebar and no ribbon.
 *
 * Reads the resolved capability when present and otherwise falls back to the
 * raw mobile flag, so hand-built hosts and older capability snapshots that
 * predate `isPhoneLayout` keep their previous behavior instead of silently
 * being treated as a tablet and given the sidebar path.
 */
export function usesPhoneLayout(capabilities: Partial<PlatformCapabilities> | null | undefined): boolean {
  if (typeof capabilities?.isPhoneLayout === 'boolean') return capabilities.isPhoneLayout;
  return Boolean(capabilities?.isMobile);
}
