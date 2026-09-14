import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PACKAGE_DIRECTORIES,
  PACKAGE_FILES,
  packageRelease,
} from '../scripts/package-release.mjs';
import {
  DEFAULT_ZIP_PATH,
  REQUIRED_RELEASE_FILES,
  formatReport,
  readZipEntryNames,
  runReleaseCheck,
  verifyReleaseEntries,
  verifyRootReleaseFiles,
  verifyZipReleaseContents,
} from '../scripts/verify-release-contents.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'verify-release-contents.mjs');
const PACKAGE_SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'package-release.mjs');

const scratchDirs: string[] = [];

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `dayline-${prefix}-`));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** Minimal store-only zip writer so archive tests need no extra dependency. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entryNames: readonly string[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const name of entryNames) {
    const nameBytes = Buffer.from(name, 'utf8');
    const content = Buffer.from(`contents of ${name}`, 'utf8');
    const checksum = crc32(content);
    const isDirectory = name.endsWith('/');
    const payload = isDirectory ? Buffer.alloc(0) : content;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(isDirectory ? 0 : checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(isDirectory ? 0 : checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entryNames.length, 8);
  eocd.writeUInt16LE(entryNames.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function writeFixtureZip(prefix: string, entryNames: readonly string[]): string {
  const path = join(makeScratchDir(prefix), 'release.zip');
  writeFileSync(path, buildZip(entryNames));
  return path;
}

/** A directory holding only the requested release files, standing in for a manual install folder. */
function makeReleaseRoot(files: readonly string[]): string {
  const dir = makeScratchDir('release-root');
  for (const file of files) {
    writeFileSync(join(dir, file), file === 'styles.css' ? '.cal-sidebar { color: red; }\n' : `// ${file}\n`);
  }
  return dir;
}

/** A directory resembling an assembled install folder: every packaged runtime asset. */
function makeInstallableRoot(prefix: string): string {
  const dir = makeScratchDir(prefix);
  for (const file of PACKAGE_FILES) {
    writeFileSync(join(dir, file), file === 'styles.css' ? '.cal-sidebar { color: red; }\n' : `// ${file}\n`);
  }
  for (const directory of PACKAGE_DIRECTORIES) {
    mkdirSync(join(dir, directory), { recursive: true });
    writeFileSync(join(dir, directory, 'clear-day.svg'), '<svg></svg>\n');
  }
  return dir;
}

function runCli(args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT_PATH, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

function runPackageCli(args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [PACKAGE_SCRIPT_PATH, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('release contents: styles.css is part of the release set', () => {
  it('ships a non-empty root styles.css next to main.js and manifest.json', () => {
    const stylesPath = join(REPO_ROOT, 'styles.css');
    expect(existsSync(stylesPath)).toBe(true);
    expect(statSync(stylesPath).size).toBeGreaterThan(0);

    const styles = readFileSync(stylesPath, 'utf8');
    expect(styles.trim().length).toBeGreaterThan(0);
    // Styling that regressed to unstyled markup when the asset was dropped.
    for (const selector of [
      '.cal-sidebar',
      '.journal-timeline-view',
      '.dayline-source-editor',
      '.journal-mood-picker-modal',
      '.dayline-mobile-diagnostics-clipboard',
      '.cal-heic-preview',
    ]) {
      expect(styles).toContain(selector);
    }
  });

  it('requires main.js, manifest.json, and styles.css in the release set', () => {
    expect(REQUIRED_RELEASE_FILES).toEqual(['main.js', 'manifest.json', 'styles.css']);
  });

  it('accepts the current repo root release set', () => {
    const result = verifyRootReleaseFiles(REPO_ROOT);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.entries).toEqual(REQUIRED_RELEASE_FILES);
  });

  it('treats missing styles.css as a failure even when the other files are present', () => {
    const result = verifyReleaseEntries(['main.js', 'manifest.json']);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['styles.css']);
  });

  it('never silently passes a release set holding only main.js and manifest.json', () => {
    const root = makeReleaseRoot(['main.js', 'manifest.json']);
    const result = verifyRootReleaseFiles(root);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['styles.css']);
    expect(result.issues).toContain('missing release file: styles.css');

    // The human-readable report must name the dropped asset.
    expect(formatReport({ ok: false, reports: [{ label: `repo root files (${root})`, ok: false, issues: result.issues }] })).toContain(
      'missing release file: styles.css',
    );

    const cli = runCli(['--root', root]);
    expect(cli.status).toBe(1);
    expect(cli.output).toContain('styles.css');
  });

  it('accepts a release set that contains all three files plus extra assets', () => {
    const root = makeReleaseRoot(REQUIRED_RELEASE_FILES);
    expect(verifyRootReleaseFiles(root).ok).toBe(true);

    const cli = runCli(['--root', root]);
    expect(cli.status).toBe(0);
    expect(cli.output).toContain('OK');
  });

  it('flags an empty styles.css as a failure', () => {
    const root = makeReleaseRoot(['main.js', 'manifest.json']);
    writeFileSync(join(root, 'styles.css'), '');
    const result = verifyRootReleaseFiles(root);

    expect(result.ok).toBe(false);
    expect(result.issues).toContain('release file is empty: styles.css');
  });

  it('exits 0 on the current repo tree and non-zero when styles.css is absent', () => {
    const passing = runCli([]);
    expect(passing.status).toBe(0);
    expect(passing.output).toContain('OK');

    const missingRoot = makeReleaseRoot(['main.js', 'manifest.json']);
    const failing = runCli(['--root', missingRoot]);
    expect(failing.status).toBe(1);
    expect(failing.output).toContain('missing release file: styles.css');
  });
});

describe('release contents: archive listing check', () => {
  it('reads entry names from a zip archive', () => {
    const zipPath = writeFixtureZip('zip-read', ['main.js', 'manifest.json', 'styles.css', 'icons/']);
    expect(readZipEntryNames(readFileSync(zipPath)).sort()).toEqual(['icons/', 'main.js', 'manifest.json', 'styles.css']);
  });

  it('reports a zip release set that omits styles.css', () => {
    const zipPath = writeFixtureZip('zip-missing-styles', ['main.js', 'manifest.json', 'icons/clear-day.svg']);
    const result = verifyZipReleaseContents(zipPath);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['styles.css']);
    expect(result.issues).toContain('missing release file in archive: styles.css');

    // Auto-discovery must not hide the failure when a zip path is supplied.
    const report = runReleaseCheck({ root: makeReleaseRoot(REQUIRED_RELEASE_FILES), zipPath });
    expect(report.ok).toBe(false);
    expect(report.reports.some((entry) => entry.issues.some((issue) => issue.includes('styles.css')))).toBe(true);
  });

  it('accepts a zip release set that contains all three files', () => {
    const zipPath = writeFixtureZip('zip-complete', ['main.js', 'manifest.json', 'styles.css', 'icons/', 'libheif-bundle.js']);
    expect(verifyZipReleaseContents(zipPath).ok).toBe(true);
    expect(runCli(['--root', REPO_ROOT, `--zip=${zipPath}`]).status).toBe(0);
  });

  it('fails closed on an unreadable archive instead of passing', () => {
    const zipPath = join(makeScratchDir('zip-broken'), 'release.zip');
    writeFileSync(zipPath, 'this is not a zip archive');
    const report = runReleaseCheck({ root: makeReleaseRoot(REQUIRED_RELEASE_FILES), zipPath });

    expect(report.ok).toBe(false);
    expect(report.reports.some((entry) => entry.issues.some((issue) => issue.startsWith('unreadable archive:')))).toBe(true);
  });

  it('parses the repository release archive when it is present', () => {
    if (!existsSync(DEFAULT_ZIP_PATH)) return;
    const names = readZipEntryNames(readFileSync(DEFAULT_ZIP_PATH));
    // Whatever a maintainer packs, the runtime files must be there.
    expect(names).toContain('main.js');
    expect(names).toContain('manifest.json');
  });
});

describe('release packaging: dayline.zip can be rebuilt repeatably', () => {
  it('exposes the packaging script through npm', () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(manifest.scripts?.['package:release']).toBe('node scripts/package-release.mjs');
    expect(existsSync(PACKAGE_SCRIPT_PATH)).toBe(true);
  });

  it('packages styles.css alongside the other runtime assets', () => {
    for (const file of ['main.js', 'manifest.json', 'styles.css']) {
      expect(REQUIRED_RELEASE_FILES).toContain(file);
      expect(PACKAGE_FILES).toContain(file);
    }
    // Product assets Obsidian loads from the plugin folder at runtime.
    expect(PACKAGE_FILES).toContain('libheif-bundle.js');
    expect(PACKAGE_FILES).toContain('THIRD_PARTY_NOTICES.md');
    expect(PACKAGE_DIRECTORIES).toContain('icons');
  });

  it('writes a flat archive whose entries cover the whole runtime set', () => {
    const zipPath = join(makeScratchDir('package-ok'), 'dayline.zip');
    const result = packageRelease({ root: makeInstallableRoot('package-source'), zipPath });

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);

    const names = readZipEntryNames(readFileSync(zipPath));
    // Archive root stays flat: Obsidian extracts straight into the plugin folder.
    expect(names.some((name) => name.startsWith('/') || name.includes('../'))).toBe(false);
    for (const file of PACKAGE_FILES) expect(names).toContain(file);
    expect(names).toContain('styles.css');
    expect(names.some((name) => name.startsWith('icons/') && name.endsWith('.svg'))).toBe(true);
  });

  it('fails when a required release file is missing instead of writing an archive', () => {
    const root = makeInstallableRoot('package-missing');
    rmSync(join(root, 'styles.css'));
    const zipPath = join(makeScratchDir('package-missing-out'), 'dayline.zip');

    const result = packageRelease({ root, zipPath });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('missing release file: styles.css');
    expect(existsSync(zipPath)).toBe(false);
  });

  it('fails when a packaged runtime file is zero-byte', () => {
    const root = makeInstallableRoot('package-empty');
    writeFileSync(join(root, 'main.js'), '');
    const zipPath = join(makeScratchDir('package-empty-out'), 'dayline.zip');

    const result = packageRelease({ root, zipPath });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('release file is empty: main.js');
    expect(existsSync(zipPath)).toBe(false);
  });

  it('reports packaging failures through the CLI with a non-zero exit', () => {
    const root = makeInstallableRoot('package-cli');
    rmSync(join(root, 'styles.css'));
    const zipPath = join(makeScratchDir('package-cli-out'), 'dayline.zip');

    const failure = runPackageCli(['--root', root, '--zip', zipPath]);
    expect(failure.status).toBe(1);
    expect(failure.output).toContain('styles.css');
    expect(existsSync(zipPath)).toBe(false);

    const success = runPackageCli(['--root', makeInstallableRoot('package-cli-ok'), '--zip', zipPath]);
    expect(success.status).toBe(0);
    expect(success.output).toContain('npm run verify:release:zip');
    expect(verifyZipReleaseContents(zipPath).ok).toBe(true);
  });

  it('rebuilds the checked-in archive so the zip gate stays satisfied', () => {
    if (!existsSync(DEFAULT_ZIP_PATH)) return;
    const names = readZipEntryNames(readFileSync(DEFAULT_ZIP_PATH));
    expect(verifyReleaseEntries(names).ok).toBe(true);
    expect(names).toContain('styles.css');
    expect(names).toContain('libheif-bundle.js');
    expect(names).toContain('THIRD_PARTY_NOTICES.md');
    expect(names.filter((name) => name.startsWith('icons/') && name.endsWith('.svg')).length).toBeGreaterThan(0);
  });
});
