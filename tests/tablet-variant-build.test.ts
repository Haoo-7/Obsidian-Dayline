import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  VARIANT,
  applyPluginId,
  applyVariantIdentity,
  applyVariantViewTypes,
  assertNoSharedViewTypes,
} from '../scripts/build-tablet-variant.mjs';

const identitySource = readFileSync(new URL('../src/plugin-identity.ts', import.meta.url), 'utf8');
const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');

describe('tablet verification variant', () => {
  it('rewrites the plugin id so the variant owns its own data.json and folder', () => {
    const output = applyPluginId(identitySource);
    expect(output).toContain(`export const PLUGIN_ID = '${VARIANT.id}';`);
    expect(output).not.toContain("'dayline-journal'");
    // Legacy ids must stay intact so the variant can still migrate old installs.
    expect(output).toContain("['dayline', 'calendar-sidebar']");
  });

  it('namespaces every view type so both plugins can be installed together', () => {
    const output = applyVariantViewTypes(pluginSource);
    // Obsidian's registerView throws on a duplicate type, so no original may remain.
    expect(() => assertNoSharedViewTypes(output)).not.toThrow();
    expect(output).toContain("'calendar-sidebar-view-tablet'");
    expect(output).toContain('JOURNAL_TIMELINE_VIEW');
    // The normal build keeps the release view types.
    expect(pluginSource).toContain("const VIEW_TYPE = 'calendar-sidebar-view';");
  });

  it('rewrites all three view types, not just the calendar', () => {
    const output = applyVariantViewTypes(pluginSource);
    const timeline = applyVariantViewTypes(
      readFileSync(new URL('../src/journal-timeline-view.ts', import.meta.url), 'utf8'),
    );
    const mobile = applyVariantViewTypes(
      readFileSync(new URL('../src/dayline-mobile.ts', import.meta.url), 'utf8'),
    );
    expect(timeline).toContain("'journal-timeline-view-tablet'");
    expect(mobile).toContain("'dayline-mobile-view-tablet'");
    expect(output).not.toContain("'dayline-mobile-view'");
  });

  it('rejects a leak that would collide with the release plugin', () => {
    expect(() => assertNoSharedViewTypes("registerView('calendar-sidebar-view')")).toThrow(/shared view types/);
  });

  it('applies both rewrites through the combined entry point', () => {
    const output = applyVariantIdentity(identitySource);
    expect(output).toContain(`export const PLUGIN_ID = '${VARIANT.id}';`);

    const pluginOutput = applyVariantIdentity(pluginSource);
    expect(() => assertNoSharedViewTypes(pluginOutput)).not.toThrow();
  });

  it('keeps the committed manifest and identity on the release id', () => {
    // The variant is a build-time overlay; release metadata must stay untouched.
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    expect(manifest.id).toBe('dayline-journal');
    expect(manifest.name).toBe('Dayline Journal');
  });
});
