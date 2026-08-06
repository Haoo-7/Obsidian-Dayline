import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  conditions: ['browser'],
  loader: { '.svg': 'text' },
  external: ['obsidian'],
  outfile: 'main.js',
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js: '/* Includes Mediabunny 1.52.3 (MPL-2.0). Source and notice: https://github.com/Haoo-7/Obsidian-Dayline/blob/master/THIRD_PARTY_NOTICES.md */',
  },
});
