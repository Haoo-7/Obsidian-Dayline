/**
 * Type surface for the vendored `libheif-bundle.js` build.
 *
 * The real file is a 1.4 MB generated bundle with the WebAssembly payload
 * inlined, so it is declared here instead: TypeScript resolves this declaration,
 * esbuild still bundles the `.js` file itself, and the one contract Dayline
 * relies on stays visible — the default export is the Emscripten factory, and
 * calling it resolves the decoder module.
 */
declare const createLibheif: () => unknown;
export default createLibheif;
