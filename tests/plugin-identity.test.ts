import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLUGIN_ID } from '../src/plugin-identity';

describe('plugin identity', () => {
  it('keeps the runtime plugin ID aligned with the manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.name).toBe('Dayline Journal');
    expect(manifest).not.toHaveProperty('dir');
    expect(packageJson.version).toBe(manifest.version);
  });
});
