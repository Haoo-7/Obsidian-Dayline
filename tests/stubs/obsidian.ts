/**
 * Runtime stub for the `obsidian` module.
 *
 * The published `obsidian` package is type definitions only: its `main` field is
 * an empty string, so a bundler or test runner cannot resolve a runtime entry.
 * Tests resolve `obsidian` to this file (see `vitest.config.ts`) so that
 * `vi.mock('obsidian', ...)` has a real module to replace. The Obsidian host
 * supplies the actual implementation at runtime.
 *
 * Anything a test forgets to mock resolves to `undefined` here, which fails
 * loudly at the call site instead of silently succeeding.
 */
export {};
