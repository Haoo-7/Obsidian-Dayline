/**
 * Bundled HEIC decoder.
 *
 * `libheif-bundle.js` in the repository root is the pre-built `libheif-js`
 * `wasm-bundle`: an Emscripten build of libheif with the WebAssembly binary
 * embedded as base64, so nothing is fetched or read from disk at runtime.
 *
 * It used to ship as a file next to `main.js` and was loaded with a runtime
 * `require()` of an absolute path inside the plugin folder. Obsidian's
 * installer only downloads `main.js`, `manifest.json` and `styles.css`, so
 * community-store installs never received that file and HEIC thumbnails fell
 * back silently. The decoder is part of `main.js` now.
 *
 * The import stays dynamic on purpose: the ~1.4 MB payload is neither executed
 * nor parsed until a HEIC image is actually converted. libheif-js is licensed
 * LGPL-3.0; see THIRD_PARTY_NOTICES.md.
 */

export interface HeicDecoderImage {
  get_width(): number;
  get_height(): number;
  display(target: ImageData, callback: (data?: ImageData) => void): void;
  free?(): void;
}

export interface HeicCodec {
  HeifDecoder: new () => { decode(data: Uint8Array): HeicDecoderImage[] | null | undefined };
}

let codecPromise: Promise<HeicCodec> | null = null;

/**
 * Resolve the libheif decoder for every caller, importing and instantiating it
 * at most once. `HeicCache` owns this as `plugin._libheifFactory` and calls it
 * on the first conversion, so the shape matches the module export the plugin
 * used to `require()` from the plugin folder.
 */
export function loadHeicCodec(): Promise<HeicCodec> {
  if (!codecPromise) {
    codecPromise = import('../libheif-bundle.js')
      // esbuild's CommonJS interop puts the bundle's `module.exports` — the
      // Emscripten factory — on `default`.
      .then((module) => module.default)
      // Calling that factory is what produces the decoder with `HeifDecoder`.
      .then((createLibheif) => createLibheif() as HeicCodec | Promise<HeicCodec>)
      .catch((error) => {
        // A failed load must not poison later attempts.
        codecPromise = null;
        throw error;
      });
  }
  return codecPromise;
}
