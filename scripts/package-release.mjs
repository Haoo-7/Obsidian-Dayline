#!/usr/bin/env node
/**
 * Dayline release packager.
 *
 * Builds `dayline.zip` for a GitHub release from a temporary staging directory,
 * so the archive root stays flat (no enclosing folder) and Obsidian can extract
 * it straight into `.obsidian/plugins/dayline-journal/`.
 *
 * What goes in the archive:
 * - The required release set defined by `verify-release-contents.mjs`:
 *   `main.js`, `manifest.json`, `styles.css`.
 * - The assets the current product loads from the plugin folder at runtime:
 *   `libheif-bundle.js` (optional HEIC decoder), `THIRD_PARTY_NOTICES.md`, and
 *   every weather SVG under `icons/`.
 *
 * The contents rules are not duplicated here. `verifyRootReleaseFiles` proves the
 * staged tree is complete and non-empty before zipping, and `verifyReleaseEntries`
 * proves the finished archive lists every required entry, so a packaging mistake
 * exits non-zero instead of publishing an incomplete archive.
 *
 * Usage:
 *   node scripts/package-release.mjs [--root <dir>] [--zip <path>]
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ZIP_PATH,
  REPO_ROOT,
  REQUIRED_RELEASE_FILES,
  verifyReleaseEntries,
  verifyRootReleaseFiles,
} from './verify-release-contents.mjs';

/** Runtime files that must be copied verbatim into the archive root. */
export const PACKAGE_FILES = Object.freeze([
  'main.js',
  'manifest.json',
  'styles.css',
  'libheif-bundle.js',
  'THIRD_PARTY_NOTICES.md',
]);

/** Runtime directories copied into the archive root, with all of their contents. */
export const PACKAGE_DIRECTORIES = Object.freeze(['icons']);

/** Packaged directories copied as a flat list of visible files, never nested. */
export const FLAT_PACKAGE_DIRECTORIES = Object.freeze(['icons']);

/**
 * Product assets the plugin loads from its own folder at runtime, beyond the
 * required release set that `verifyRootReleaseFiles` already covers.
 */
const EXTRA_RUNTIME_FILES = Object.freeze(PACKAGE_FILES.filter((file) => !REQUIRED_RELEASE_FILES.includes(file)));

const ZIP_BINARY = 'zip';
const UNZIP_BINARY = 'unzip';

/**
 * Report runtime assets beyond the required release set that are missing, are
 * not plain files, or are zero-byte. Missing or empty `main.js`, `manifest.json`,
 * or `styles.css` are left to the gate so each problem is reported once, in the
 * gate's own wording.
 *
 * @param {string} root
 * @returns {string[]}
 */
function findMissingRuntimeAssets(root) {
  const issues = [];
  for (const file of EXTRA_RUNTIME_FILES) {
    let stats;
    try {
      stats = statSync(join(root, file));
    } catch {
      issues.push(`missing runtime file: ${file}`);
      continue;
    }
    if (!stats.isFile()) {
      issues.push(`missing runtime file: ${file}`);
    } else if (stats.size === 0) {
      issues.push(`release file is empty: ${file}`);
    }
  }
  for (const dir of PACKAGE_DIRECTORIES) {
    let stats;
    try {
      stats = statSync(join(root, dir));
    } catch {
      issues.push(`missing runtime directory: ${dir}/`);
      continue;
    }
    if (!stats.isDirectory()) {
      issues.push(`missing runtime directory: ${dir}/`);
      continue;
    }
    const visibleFiles = readdirSync(join(root, dir), { withFileTypes: true }).filter(
      (entry) => entry.isFile() && !entry.name.startsWith('.'),
    );
    if (visibleFiles.length === 0) issues.push(`runtime directory is empty: ${dir}/`);
  }
  return issues;
}

/**
 * Copy the runtime set from `root` into `stagingDir`.
 *
 * @param {string} stagingDir
 * @param {string} [root]
 */
export function stageReleaseFiles(stagingDir, root = REPO_ROOT) {
  for (const file of PACKAGE_FILES) {
    cpSync(join(root, file), join(stagingDir, file));
  }
  for (const dir of PACKAGE_DIRECTORIES) {
    const from = join(root, dir);
    const to = join(stagingDir, dir);
    mkdirSync(to, { recursive: true });
    if (FLAT_PACKAGE_DIRECTORIES.includes(dir)) {
      // Visible regular files only, so zip metadata such as `.DS_Store` never
      // reaches the archive.
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.startsWith('.')) continue;
        cpSync(join(from, entry.name), join(to, entry.name));
      }
    } else {
      cpSync(from, to, { recursive: true });
    }
  }
}

/**
 * Read the archive listing back through `unzip -Z1`, so the packager relies on
 * the system tooling that produced it instead of a second zip parser.
 *
 * @param {string} zipPath
 * @returns {string[]}
 */
function listArchiveEntries(zipPath) {
  const result = spawnSync(UNZIP_BINARY, ['-Z1', basename(zipPath)], { cwd: dirname(zipPath), encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr ?? '').trim() || `unzip exited with status ${result.status}`);
  return result.stdout.split('\n').filter((line) => line.trim().length > 0);
}

/**
 * Verify `root`, stage it, zip the staged tree flat into `zipPath`, then verify
 * the archive listing. Every failure mode returns `ok: false` with an issue list
 * rather than throwing, so callers get a report and a non-zero exit.
 *
 * @param {{ root?: string, zipPath?: string, stagingDir?: string }} [options]
 * @returns {{ ok: boolean, issues: string[], entries: string[], zipPath: string, stagingDir: string | null }}
 */
export function packageRelease({ root = REPO_ROOT, zipPath = DEFAULT_ZIP_PATH, stagingDir } = {}) {
  const target = resolve(zipPath);
  const ownedStaging = stagingDir ? null : mkdtempSync(join(tmpdir(), 'dayline-package-'));
  const staging = stagingDir ?? ownedStaging;
  const failure = (issues, entries = []) => ({ ok: false, issues, entries, zipPath: target, stagingDir: staging });

  try {
    // Check the source first: this yields the gate's own wording for missing or
    // zero-byte release files, and nothing is staged or zipped when it fails.
    const sourceResult = verifyRootReleaseFiles(root);
    const issues = [...sourceResult.issues, ...findMissingRuntimeAssets(root)];
    if (issues.length > 0) return failure(issues);

    stageReleaseFiles(staging, root);
    // Re-check the staged tree so a copy that dropped a file cannot be zipped.
    const stagedResult = verifyRootReleaseFiles(staging);
    const stagedIssues = [...stagedResult.issues, ...findMissingRuntimeAssets(staging)];
    if (stagedIssues.length > 0) return failure(stagedIssues);

    // `zip` updates an existing archive in place, which would let entries from a
    // previous package survive. Remove the target so the archive holds exactly
    // the staged runtime set on every run.
    rmSync(target, { force: true });

    const zipResult = spawnSync(ZIP_BINARY, ['-r', '-q', '-X', target, '.'], { cwd: staging, encoding: 'utf8' });

    if (zipResult.error) {
      const reason = zipResult.error instanceof Error ? zipResult.error.message : String(zipResult.error);
      return failure([`failed to run ${ZIP_BINARY}: ${reason}`]);
    }
    if (zipResult.status !== 0) {
      const reason = (zipResult.stderr ?? '').trim() || `exit status ${zipResult.status}`;
      return failure([`${ZIP_BINARY} failed: ${reason}`]);
    }

    let archive;
    try {
      archive = verifyReleaseEntries(listArchiveEntries(target));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure([`unreadable archive: ${reason}`]);
    }
    if (!archive.ok) {
      return failure(
        archive.missing.map((file) => `missing release file in archive: ${file}`),
        archive.entries,
      );
    }

    return { ok: true, issues: [], entries: archive.entries, zipPath: target, stagingDir: staging };
  } finally {
    if (ownedStaging) rmSync(ownedStaging, { recursive: true, force: true });
  }
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const options = { root: REPO_ROOT, zipPath: DEFAULT_ZIP_PATH, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root requires a directory path');
      options.root = resolve(value);
      index += 1;
    } else if (arg.startsWith('--root=')) {
      options.root = resolve(arg.slice('--root='.length));
    } else if (arg === '--zip') {
      const value = argv[index + 1];
      if (!value) throw new Error('--zip requires a file path');
      options.zipPath = resolve(value);
      index += 1;
    } else if (arg.startsWith('--zip=')) {
      options.zipPath = resolve(arg.slice('--zip='.length));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('usage: node scripts/package-release.mjs [--root <dir>] [--zip <path>]');
    return 2;
  }
  if (options.help) {
    console.log('usage: node scripts/package-release.mjs [--root <dir>] [--zip <path>]');
    console.log(`packaged files: ${[...PACKAGE_FILES, ...PACKAGE_DIRECTORIES.map((dir) => `${dir}/`)].join(', ')}`);
    return 0;
  }

  const result = packageRelease({ root: options.root, zipPath: options.zipPath });
  console.log('Dayline release packager');
  console.log(`  staged and verified the release set from ${options.root}`);
  for (const issue of result.issues) console.error(`    - ${issue}`);
  if (!result.ok) {
    console.error(`Packaging failed: ${result.zipPath} was not written.`);
    return 1;
  }
  console.log(`  wrote ${result.zipPath} (${result.entries.length} entries)`);
  console.log('Next: run "npm run verify:release:zip" to confirm the archive Obsidian receives.');
  return 0;
}

/**
 * True when this module is the process entry point, so importing it from tests
 * never runs the CLI.
 *
 * @returns {boolean}
 */
export function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exitCode = main(process.argv.slice(2));
}