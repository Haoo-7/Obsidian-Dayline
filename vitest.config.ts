import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Installs the Obsidian `Node`/`HTMLElement` helpers (`createEl`, `createDiv`,
    // `createSpan`, `empty`, …) that JSDOM does not provide. Files that swap in
    // their own JSDOM instance keep working because the shim resolves `document`
    // at call time.
    setupFiles: [fileURLToPath(new URL('./tests/setup/obsidian-dom.ts', import.meta.url))],
  },
  resolve: {
    alias: {
      // The `obsidian` package ships type definitions only — its `main` is an
      // empty string, so Vite cannot resolve a runtime entry for it. Every test
      // that touches Obsidian APIs mocks the module with `vi.mock('obsidian')`,
      // which still needs a resolvable target. Point it at a stub so the mock
      // has something to replace; the real API is provided by the Obsidian host
      // at runtime, never by this package.
      obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
    },
  },
});
