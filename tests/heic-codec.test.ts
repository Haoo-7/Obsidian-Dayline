import { describe, expect, it, vi } from 'vitest';

/**
 * `libheif-bundle.js` is a 1.4 MB generated bundle, so mocking it keeps this
 * test about the loader contract: nothing touches the payload until the first
 * conversion, all callers share one import and one instantiation, and the
 * CommonJS export (the Emscripten factory) is called to produce the decoder that
 * `HeicCache` builds a `HeifDecoder` from.
 */
const state = vi.hoisted(() => ({ imports: 0, factoryCalls: 0 }));

vi.mock('../libheif-bundle.js', () => {
  state.imports += 1;
  return {
    default: () => {
      state.factoryCalls += 1;
      return Promise.resolve({ HeifDecoder: class { decode() { return []; } } });
    },
  };
});

import { loadHeicCodec } from '../src/heic-codec';

describe('bundled HEIC codec loader', () => {
  it('imports and instantiates the codec once, on demand', async () => {
    // Importing the loader must not parse or execute the embedded WASM payload.
    expect(state.imports).toBe(0);

    const first = loadHeicCodec();
    const second = loadHeicCodec();
    expect(second).toBe(first);

    const libheif = await first;
    expect(state.imports).toBe(1);
    expect(state.factoryCalls).toBe(1);
    expect(typeof libheif.HeifDecoder).toBe('function');
    expect(new libheif.HeifDecoder().decode(new Uint8Array())).toEqual([]);

    await expect(loadHeicCodec()).resolves.toBe(libheif);
    expect(state.imports).toBe(1);
    expect(state.factoryCalls).toBe(1);
  });
});
