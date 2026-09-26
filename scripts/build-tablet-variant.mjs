#!/usr/bin/env node
/**
 * Build the tablet-verification variant of Dayline.
 *
 * Why this exists
 * ---------------
 * Obsidian's `registerView` throws when two enabled plugins register the same
 * view type:
 *
 *     if (viewByType.hasOwnProperty(type)) throw new Error('Attempting to register
 *       an existing view type "..."')
 *
 * So a tablet build that shares `calendar-sidebar-view` with an already-enabled
 * Dayline install cannot coexist with it. This script emits an independent
 * plugin whose runtime id, manifest id, and view types are all suffixed, and
 * writes it to its own plugin folder — leaving the normal install untouched.
 *
 * It deliberately never modifies tracked files: `src/plugin-identity.ts`,
 * `manifest.json`, and the committed `main.js` keep their release identity, so
 * `npm run build`, `npm test`, and `npm run verify:release` stay release-accurate.
 *
 * Usage:
 *   node scripts/build-tablet-variant.mjs [--out <plugin-dir>]
 *
 * Then in Obsidian: disable "Dayline Journal", enable "Dayline Tablet (verification)".
 */

import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Independent identity so both plugins can be installed side by side. */
export const VARIANT = Object.freeze({
  id: 'dayline-tablet',
  name: 'Dayline Tablet (verification)',
  viewSuffix: '-tablet',
  mobileViewSuffix: '-tablet',
});

/**
 * Rewrite the plugin id. Only `plugin-identity.ts` declares it; other modules
 * read it through the import, so this runs on that one module.
 */
export function applyPluginId(source, variant = VARIANT) {
  const next = source.replace(
    /export const PLUGIN_ID = '[^']*';/,
    `export const PLUGIN_ID = '${variant.id}';`,
  );
  if (!next.includes(`export const PLUGIN_ID = '${variant.id}';`)) {
    throw new Error('could not rewrite PLUGIN_ID');
  }
  return next;
}

/**
 * Namespace the three view types. Obsidian's view registry is global: a shared
 * type would make the two plugins fight over the same leaves.
 *
 * View types are declared in several modules (`plugin.ts`,
 * `journal-timeline-view.ts`, `settings-tab.ts`, `dayline-mobile.ts`,
 * `view-visibility-controller.ts`, `mobile-diagnostics.ts`), so every quoted
 * occurrence is rewritten.
 */
export function applyVariantViewTypes(source, variant = VARIANT) {
  let next = source;
  const viewTypes = [
    ['calendar-sidebar-view', `calendar-sidebar-view${variant.viewSuffix}`],
    ['journal-timeline-view', `journal-timeline-view${variant.viewSuffix}`],
    ['dayline-mobile-view', `dayline-mobile-view${variant.mobileViewSuffix}`],
  ];
  for (const [from, to] of viewTypes) {
    next = next.replace(new RegExp(`(['"\`])${from}\\1`, 'g'), `$1${to}$1`);
  }
  return next;
}

/**
 * Both rewrites for a single module: the id where it is declared, the view
 * types wherever they appear.
 */
export function applyVariantIdentity(source, variant = VARIANT) {
  const withId = source.includes('export const PLUGIN_ID =')
    ? applyPluginId(source, variant)
    : source;
  return applyVariantViewTypes(withId, variant);
}

/**
 * View types also appear as unquoted string literals inside the diagnostics
 * allowlist and the visibility controller map, so validate that no original
 * type survives anywhere in the built variant.
 */
export function assertNoSharedViewTypes(source) {
  const leaked = ['calendar-sidebar-view', 'journal-timeline-view', 'dayline-mobile-view']
    .filter((type) => new RegExp(`(['"\`])${type}\\1`).test(source));
  if (leaked.length) throw new Error(`variant still declares shared view types: ${leaked.join(', ')}`);
}

/** A tiny esbuild plugin that applies the identity rewrite to every module. */
function variantIdentityPlugin(variant) {
  const targets = /calendar-sidebar-view|journal-timeline-view|dayline-mobile-view|export const PLUGIN_ID =/;
  return {
    name: 'dayline-variant-identity',
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.ts$/ }, (args) => {
        const source = readFileSync(args.path, 'utf8');
        if (!targets.test(source)) return null;
        return { contents: applyVariantIdentity(source, variant), loader: 'ts' };
      });
    },
  };
}

function parseOutDir(argv) {
  const flag = argv.indexOf('--out');
  if (flag === -1) return null;
  const value = argv[flag + 1];
  if (!value) throw new Error('--out requires a directory');
  return resolve(value);
}

async function main() {
  const outDir = parseOutDir(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'manifest.json'), 'utf8'));

  const result = await build({
    entryPoints: [join(REPO_ROOT, 'src/main.ts')],
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2020',
    conditions: ['browser'],
    loader: { '.svg': 'text' },
    external: ['obsidian'],
    outfile: outDir ? join(outDir, 'main.js') : join(REPO_ROOT, 'tablet-variant/main.js'),
    sourcemap: false,
    legalComments: 'none',
    write: false,
    plugins: [variantIdentityPlugin(VARIANT)],
    banner: {
      js: '/* Includes Mediabunny 1.52.3 (MPL-2.0). Source and notice: https://github.com/Haoo-7/Obsidian-Dayline/blob/master/THIRD_PARTY_NOTICES.md */',
    },
  });

  const code = result.outputFiles[0].text;
  assertNoSharedViewTypes(code);

  const variantManifest = {
    ...manifest,
    id: VARIANT.id,
    name: VARIANT.name,
    version: `${manifest.version}-tablet`,
    description: `Tablet verification build of Dayline Journal v${manifest.version}. Disable the normal Dayline plugin before enabling this one.`,
  };

  const targetDir = outDir ?? join(REPO_ROOT, 'tablet-variant');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'main.js'), code);
  writeFileSync(join(targetDir, 'manifest.json'), `${JSON.stringify(variantManifest, null, 2)}\n`);
  copyFileSync(join(REPO_ROOT, 'styles.css'), join(targetDir, 'styles.css'));

  // libheif is resolved at runtime from the variant's own folder.
  const libheif = join(REPO_ROOT, 'libheif-bundle.js');
  if (existsSync(libheif)) copyFileSync(libheif, join(targetDir, 'libheif-bundle.js'));
  const notices = join(REPO_ROOT, 'THIRD_PARTY_NOTICES.md');
  if (existsSync(notices)) copyFileSync(notices, join(targetDir, 'THIRD_PARTY_NOTICES.md'));

  console.log(`Tablet variant built: ${targetDir}`);
  console.log(`  id: ${VARIANT.id} (view types suffixed ${VARIANT.viewSuffix})`);
  console.log('  Enable this plugin and disable "Dayline Journal" to verify.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error('Tablet variant build failed:', error.message);
    process.exit(1);
  });
}
