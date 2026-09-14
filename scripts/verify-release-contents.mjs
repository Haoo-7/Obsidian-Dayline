#!/usr/bin/env node
/**
 * Dayline release contents gate.
 *
 * What this script checks (the documented contract):
 * - Default: the repo-root release set, meaning the files that must sit next to a
 *   manually assembled Obsidian plugin install: `main.js`, `manifest.json`, and
 *   `styles.css`. `main.js` and `styles.css` must also be non-empty.
 * - With `--zip[=<path>]`: additionally the root entries of `dayline.zip`.
 *
 * The archive is never rebuilt or rewritten here. A stale `dayline.zip` fails the
 * `--zip` check until a maintainer rebuilds it with `styles.css` included.
 *
 * Usage:
 *   node scripts/verify-release-contents.mjs [--root <dir>] [--zip[=<path>]]
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files Obsidian needs in a plugin release package. */
export const REQUIRED_RELEASE_FILES = Object.freeze(['main.js', 'manifest.json', 'styles.css']);

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_ZIP_PATH = join(REPO_ROOT, 'dayline.zip');

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_MIN_SIZE = 22;
const ZIP_MAX_COMMENT_SIZE = 0xffff;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIZE = 46;

function normalizeEntryName(entry) {
  return String(entry).replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Core decision function: given the listing of an assembled release set, report
 * which required files are absent. A listing missing everything still fails.
 *
 * @param {Iterable<string>} entries
 * @returns {{ ok: boolean, missing: string[], entries: string[] }}
 */
export function verifyReleaseEntries(entries) {
  const names = [];
  for (const entry of entries ?? []) {
    const name = normalizeEntryName(entry).replace(/\/+$/, '');
    if (name.length > 0) names.push(name);
  }
  const present = new Set(names);
  const missing = REQUIRED_RELEASE_FILES.filter((file) => !present.has(file));
  return { ok: missing.length === 0, missing, entries: names };
}

/**
 * Check the repo-root release set (or any directory standing in for it).
 *
 * @param {string} [root]
 * @returns {{ ok: boolean, missing: string[], entries: string[], empty: string[], issues: string[], root: string }}
 */
export function verifyRootReleaseFiles(root = REPO_ROOT) {
  const entries = [];
  const empty = [];
  for (const file of REQUIRED_RELEASE_FILES) {
    let stats;
    try {
      stats = statSync(join(root, file));
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    entries.push(file);
    if (stats.size === 0) empty.push(file);
  }
  const result = verifyReleaseEntries(entries);
  const issues = [
    ...result.missing.map((file) => `missing release file: ${file}`),
    ...empty.map((file) => `release file is empty: ${file}`),
  ];
  return { ...result, ok: issues.length === 0, issues, empty, root };
}

/**
 * Read entry names from a zip central directory. Zip64 archives are rejected
 * explicitly rather than misread; Dayline release archives are far below that size.
 *
 * @param {Buffer} buffer
 * @returns {string[]}
 */
export function readZipEntryNames(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < ZIP_EOCD_MIN_SIZE) {
    throw new Error('not a zip archive: file is too small');
  }
  const earliest = Math.max(0, buffer.length - ZIP_EOCD_MIN_SIZE - ZIP_MAX_COMMENT_SIZE);
  let eocd = -1;
  for (let offset = buffer.length - ZIP_EOCD_MIN_SIZE; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip archive: end-of-central-directory record not found');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('zip64 archives are not supported by this check');
  }

  const names = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + ZIP_CENTRAL_DIRECTORY_HEADER_SIZE > buffer.length ||
      buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new Error(`corrupt zip archive: bad central directory entry at offset ${cursor}`);
    }
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    names.push(buffer.toString('utf8', cursor + ZIP_CENTRAL_DIRECTORY_HEADER_SIZE, cursor + ZIP_CENTRAL_DIRECTORY_HEADER_SIZE + nameLength));
    cursor += ZIP_CENTRAL_DIRECTORY_HEADER_SIZE + nameLength + extraLength + commentLength;
  }
  return names;
}

/**
 * Check the entries stored in a release archive.
 *
 * @param {string} [zipPath]
 * @returns {{ ok: boolean, missing: string[], entries: string[], issues: string[], zipPath: string }}
 */
export function verifyZipReleaseContents(zipPath = DEFAULT_ZIP_PATH) {
  const names = readZipEntryNames(readFileSync(zipPath));
  const result = verifyReleaseEntries(names);
  const issues = result.missing.map((file) => `missing release file in archive: ${file}`);
  return { ...result, ok: issues.length === 0, issues, zipPath };
}

/**
 * Run every requested release set check.
 *
 * @param {{ root?: string, zipPath?: string | null }} [options]
 * @returns {{ ok: boolean, reports: Array<{ label: string, ok: boolean, issues: string[] }> }}
 */
export function runReleaseCheck({ root = REPO_ROOT, zipPath = null } = {}) {
  const rootResult = verifyRootReleaseFiles(root);
  const reports = [{ label: `repo root files (${root})`, ok: rootResult.ok, issues: rootResult.issues }];

  if (zipPath) {
    try {
      const zipResult = verifyZipReleaseContents(zipPath);
      reports.push({ label: `archive entries (${zipPath})`, ok: zipResult.ok, issues: zipResult.issues });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      reports.push({ label: `archive entries (${zipPath})`, ok: false, issues: [`unreadable archive: ${reason}`] });
    }
  }

  return { ok: reports.every((report) => report.ok), reports };
}

export function formatReport(result) {
  const lines = ['Dayline release contents check'];
  for (const report of result.reports) {
    lines.push(`  checked ${report.label}: ${report.ok ? 'OK' : 'FAIL'}`);
    for (const issue of report.issues) lines.push(`    - ${issue}`);
  }
  return lines.join('\n');
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const options = { root: REPO_ROOT, zipPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--zip') {
      options.zipPath = DEFAULT_ZIP_PATH;
    } else if (arg.startsWith('--zip=')) {
      options.zipPath = resolve(arg.slice('--zip='.length));
    } else if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root requires a directory path');
      options.root = resolve(value);
      index += 1;
    } else if (arg.startsWith('--root=')) {
      options.root = resolve(arg.slice('--root='.length));
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
    console.error('usage: node scripts/verify-release-contents.mjs [--root <dir>] [--zip[=<path>]]');
    return 2;
  }
  if (options.help) {
    console.log('usage: node scripts/verify-release-contents.mjs [--root <dir>] [--zip[=<path>]]');
    console.log(`required release files: ${REQUIRED_RELEASE_FILES.join(', ')}`);
    return 0;
  }

  const result = runReleaseCheck({ root: options.root, zipPath: options.zipPath });
  console.log(formatReport(result));
  return result.ok ? 0 : 1;
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
