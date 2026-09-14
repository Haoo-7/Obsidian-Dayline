import { build } from 'esbuild';
import { formatReport, runReleaseCheck } from './scripts/verify-release-contents.mjs';

// Pre-flight gate: Obsidian loads `styles.css` next to `main.js` from the plugin
// folder, and esbuild never produces it. Checking before the bundle is written
// means a missing asset stops the build without overwriting the tracked main.js.
const releaseCheck = runReleaseCheck();
console.log(formatReport(releaseCheck));
if (!releaseCheck.ok) {
  console.error('Build stopped: the release set next to main.js is incomplete.');
  console.error('Obsidian loads styles.css from the plugin folder; restore it before packaging.');
  process.exit(1);
}

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

console.log('Release set ready. Run "npm run verify:release:zip" before publishing the archive.');
