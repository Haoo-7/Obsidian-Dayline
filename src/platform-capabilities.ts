export type CapabilityRoute = 'full' | 'fallback' | 'disabled';

export type PlatformCapabilities = {
  isMobile: boolean;
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

export function detectPlatformCapabilities(input: DetectionInput = {}): PlatformCapabilities {
  const platform = input.Platform || (globalThis as any).Platform || {};
  const doc = input.document === undefined ? (globalThis as any).document : input.document;
  const nav = input.navigator === undefined ? (globalThis as any).navigator : input.navigator;
  const urlApi = input.URL === undefined ? (globalThis as any).URL : input.URL;
  const wasmApi = input.WebAssembly === undefined ? (globalThis as any).WebAssembly : input.WebAssembly;
  const mediaQuery = input.matchMedia || (globalThis as any).matchMedia;
  const isMobile = Boolean(platform.isMobile || platform.isMobileApp);
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
    try { canvas = Boolean(doc.createElement('canvas')?.getContext?.('2d')); } catch (_) { canvas = false; }
    try { video = Boolean(doc.createElement('video')?.canPlayType); } catch (_) { video = false; }
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
