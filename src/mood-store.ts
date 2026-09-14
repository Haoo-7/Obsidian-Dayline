import { normalizeVaultPath } from './date-utils';
import type { MoodMetadata, MoodRecord } from './types';
import { MOOD_LABELS, parseMoodScore } from './mood';
import { serializeMoodCsv, serializeMoodJson } from './mood-export';

/** Current on-disk mood metadata contract. v1 remains readable and is migrated on load. */
export const MOOD_SCHEMA_VERSION = 2 as const;
export const LEGACY_MOOD_SCHEMA_VERSION = 1 as const;

export interface MoodStoreSettings {
  moodMetadataPath?: string;
  mirrorMoodToFrontmatter?: boolean;
}

export interface MoodRestoreOptions {
  /** Explicitly allow replacing a live record at the restore destination. */
  replace?: boolean;
}

export interface MoodMigrationResult {
  metadata: MoodMetadata;
  migrated: boolean;
  fromVersion: number;
  warnings: string[];
}

export interface MoodMirrorFailure {
  path: string;
  operation: 'write' | 'delete';
  message: string;
  failedAt: string;
}

export interface MoodIntegrityReport {
  valid: boolean;
  invalidRecords: string[];
  invalidOrphans: string[];
  invalidMetadata: string[];
  missingFiles: string[];
  backupAvailable: boolean;
}

type MoodListener = (path: string, record: MoodRecord | undefined) => void;
type MoodMirrorFailureListener = (failure: MoodMirrorFailure | undefined) => void;
type StoreContext = { path: string; generation: number };
type MoodTombstone = { deletedAt: string; [key: string]: unknown };
type MoodMetadataWithTombstones = MoodMetadata & { tombstones?: Record<string, MoodTombstone> };

const DEFAULT_PATH = 'Calendar/journal-metadata.json';
const BUILT_IN_LABEL_IDS = new Set(MOOD_LABELS.map((item) => item.id));
const MOOD_FRONTMATTER_KEYS = new Set(['mood', 'mood_labels', 'mood_note', 'mood_comment']);

function safeVaultPath(path: string): string {
  const normalized = normalizeVaultPath(path);
  return normalized.split('/').filter((part) => part && part !== '.' && part !== '..').join('/') || DEFAULT_PATH;
}

function emptyMetadata(): MoodMetadata {
  return { schemaVersion: MOOD_SCHEMA_VERSION, entries: {}, orphans: {}, customLabels: [], tombstones: {} };
}

function isScore(value: unknown): value is MoodRecord['score'] {
  return value === -2 || value === -1 || value === 0 || value === 1 || value === 2;
}

export function normalizeMoodLabels(value: unknown): string[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : []).map(String).map((label) => label.trim()).filter(Boolean),
  ));
}

export function normalizeCustomLabels(value: unknown): string[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map(String)
      .map((label) => label.trim())
      .filter((label) => label && !BUILT_IN_LABEL_IDS.has(label)),
  )).sort((a, b) => a.localeCompare(b));
}

export function validMoodRecord(value: unknown): value is MoodRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return isScore(record.score)
    && Array.isArray(record.labels)
    && record.labels.every((label) => typeof label === 'string')
    && typeof record.recordedAt === 'string'
    && record.recordedAt.trim().length > 0
    && typeof record.updatedAt === 'string'
    && record.updatedAt.trim().length > 0
    && (record.note === undefined || record.note === null || typeof record.note === 'string');
}

function normalizeRecord(record: MoodRecord): MoodRecord {
  const legacyNote = (record as MoodRecord & { comment?: unknown }).comment;
  const note = record.note === undefined && typeof legacyNote === 'string' ? legacyNote : record.note;
  return {
    ...record,
    score: record.score,
    labels: normalizeMoodLabels(record.labels),
    ...(note === undefined ? {} : { note: note === null ? null : String(note) }),
    recordedAt: record.recordedAt,
    updatedAt: record.updatedAt,
  };
}

function cloneUnknown<T>(value: T): T {
  if (value === undefined) return value;
  try { return JSON.parse(JSON.stringify(value)) as T; } catch { return value; }
}

function customLabelsFrom(entries: Record<string, MoodRecord>, orphans: MoodMetadata['orphans']): string[] {
  const values: string[] = [];
  for (const record of Object.values(entries)) {
    values.push(...record.labels);
  }
  for (const orphan of Object.values(orphans ?? {})) {
    values.push(...orphan.record.labels);
  }
  return normalizeCustomLabels(values);
}

/**
 * Convert schema-v1 metadata to schema-v2 without dropping unknown fields.
 * The transformation is pure, deterministic, and idempotent.
 */
export function migrateMoodMetadata(value: unknown): MoodMigrationResult {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawVersion = Number(raw.schemaVersion ?? LEGACY_MOOD_SCHEMA_VERSION);
  const fromVersion = Number.isFinite(rawVersion) ? rawVersion : LEGACY_MOOD_SCHEMA_VERSION;
  const warnings: string[] = [];
  const entries: Record<string, MoodRecord> = {};
  const rawEntries = raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries)
    ? raw.entries as Record<string, unknown>
    : {};
  for (const [path, value] of Object.entries(rawEntries)) {
    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath || !validMoodRecord(value)) continue;
    entries[normalizedPath] = normalizeRecord(cloneUnknown(value));
  }
  const orphans: MoodMetadata['orphans'] = {};
  const rawOrphans = raw.orphans && typeof raw.orphans === 'object' && !Array.isArray(raw.orphans)
    ? raw.orphans as Record<string, unknown>
    : {};
  for (const [path, value] of Object.entries(rawOrphans)) {
    const orphan = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath || !validMoodRecord(orphan.record)) continue;
    const record = normalizeRecord(cloneUnknown(orphan.record));
    const orphanedAt = typeof orphan.orphanedAt === 'string' && orphan.orphanedAt.trim()
      ? orphan.orphanedAt
      : record.updatedAt || record.recordedAt;
    orphans[normalizedPath] = {
      ...cloneUnknown(orphan),
      record,
      orphanedAt,
    };
  }
  const customLabels = normalizeCustomLabels([
    ...(Array.isArray(raw.customLabels) ? raw.customLabels.map(String) : []),
    ...customLabelsFrom(entries, orphans),
  ]);
  const tombstones: Record<string, MoodTombstone> = {};
  const rawTombstones = raw.tombstones && typeof raw.tombstones === 'object' && !Array.isArray(raw.tombstones)
    ? raw.tombstones as Record<string, unknown>
    : {};
  for (const [path, value] of Object.entries(rawTombstones)) {
    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const tombstone = value as Record<string, unknown>;
    if (typeof tombstone.deletedAt !== 'string' || !tombstone.deletedAt.trim()) continue;
    tombstones[normalizedPath] = cloneUnknown(tombstone) as MoodTombstone;
  }
  const metadata: MoodMetadata = {
    ...cloneUnknown(raw),
    schemaVersion: MOOD_SCHEMA_VERSION,
    entries,
    orphans,
    customLabels,
    tombstones,
  };
  if (fromVersion !== LEGACY_MOOD_SCHEMA_VERSION && fromVersion !== MOOD_SCHEMA_VERSION) {
    warnings.push(`Unknown mood metadata schema ${fromVersion}; normalized as schema ${MOOD_SCHEMA_VERSION}`);
  }
  return {
    metadata,
    migrated: fromVersion !== MOOD_SCHEMA_VERSION,
    fromVersion,
    warnings,
  };
}

export function validateMoodMetadata(value: unknown): MoodIntegrityReport {
  const invalidRecords: string[] = [];
  const invalidOrphans: string[] = [];
  const invalidMetadata: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidMetadata.push('metadata');
    return { valid: false, invalidRecords, invalidOrphans, invalidMetadata, missingFiles: [], backupAvailable: false };
  }

  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1 && raw.schemaVersion !== MOOD_SCHEMA_VERSION) invalidMetadata.push('schemaVersion');
  if (!raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) {
    invalidMetadata.push('entries');
  } else {
    const normalizedPaths = new Set<string>();
    for (const [path, record] of Object.entries(raw.entries)) {
      const normalizedPath = normalizeVaultPath(path);
      if (!normalizedPath || normalizedPaths.has(normalizedPath)) invalidMetadata.push(`entry-path:${path}`);
      normalizedPaths.add(normalizedPath);
      if (!validMoodRecord(record)) invalidRecords.push(path);
    }
  }
  if (raw.orphans !== undefined && (!raw.orphans || typeof raw.orphans !== 'object' || Array.isArray(raw.orphans))) {
    invalidMetadata.push('orphans');
  } else if (raw.orphans && typeof raw.orphans === 'object') {
    for (const [path, value] of Object.entries(raw.orphans)) {
      const orphan = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      if (!normalizeVaultPath(path) || !validMoodRecord(orphan.record) || typeof orphan.orphanedAt !== 'string') invalidOrphans.push(path);
    }
  }
  if (raw.tombstones !== undefined && (!raw.tombstones || typeof raw.tombstones !== 'object' || Array.isArray(raw.tombstones))) {
    invalidMetadata.push('tombstones');
  } else if (raw.tombstones && typeof raw.tombstones === 'object') {
    for (const [path, value] of Object.entries(raw.tombstones)) {
      const tombstone = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
      if (!normalizeVaultPath(path) || typeof tombstone.deletedAt !== 'string' || !tombstone.deletedAt.trim()) {
        invalidMetadata.push(`tombstone:${path}`);
      }
    }
  }
  return {
    valid: invalidRecords.length === 0 && invalidOrphans.length === 0 && invalidMetadata.length === 0,
    invalidRecords,
    invalidOrphans,
    invalidMetadata,
    missingFiles: [],
    backupAvailable: false,
  };
}

function normalizeMetadata(value: unknown): MoodMetadata {
  return migrateMoodMetadata(value).metadata;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '';
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

/** Apply local changes to the latest disk snapshot, rejecting overlapping edits. */
function mergeMetadata(base: MoodMetadata, local: MoodMetadata, remote: MoodMetadata): MoodMetadata {
  const result = cloneUnknown(remote);
  const mergeMap = (before: Record<string, unknown>, after: Record<string, unknown>, disk: Record<string, unknown>, label: string) => {
    const merged = cloneUnknown(disk);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (sameValue(before[key], after[key])) continue;
      if (!sameValue(before[key], disk[key])) throw new Error(`Mood metadata conflict: ${label}${key}`);
      if (Object.hasOwn(after, key)) Object.defineProperty(merged, key, { value: cloneUnknown(after[key]), enumerable: true, configurable: true, writable: true });
      else delete merged[key];
    }
    return merged;
  };
  result.entries = mergeMap(base.entries, local.entries, remote.entries, 'entries/') as MoodMetadata['entries'];
  result.orphans = mergeMap(base.orphans ?? {}, local.orphans ?? {}, remote.orphans ?? {}, 'orphans/') as MoodMetadata['orphans'];
  (result as MoodMetadataWithTombstones).tombstones = mergeMap(
    (base as MoodMetadataWithTombstones).tombstones ?? {},
    (local as MoodMetadataWithTombstones).tombstones ?? {},
    (remote as MoodMetadataWithTombstones).tombstones ?? {},
    'tombstones/',
  ) as Record<string, MoodTombstone>;
  result.customLabels = normalizeCustomLabels([...(remote.customLabels ?? []), ...(local.customLabels ?? [])]);
  return result;
}

export class MoodStore {
  private readonly app: any;
  private readonly listeners = new Set<MoodListener>();
  private readonly mirrorFailureListeners = new Set<MoodMirrorFailureListener>();
  private readonly mirrorFailures = new Map<string, MoodMirrorFailure>();
  private data: MoodMetadata = emptyMetadata();
  private path = DEFAULT_PATH;
  private loaded = false;
  private loadError: Error | undefined;
  private recoveredFromBackup = false;
  private primaryRaw: string | null = null;
  private generation = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(app: any, settings: MoodStoreSettings = {}) {
    this.app = app;
    this.configure(settings);
  }

  configure(settings: MoodStoreSettings): void {
    const nextPath = safeVaultPath(settings.moodMetadataPath || DEFAULT_PATH);
    if (nextPath !== this.path) {
      this.generation++;
      this.data = emptyMetadata();
      this.primaryRaw = null;
      this.loaded = false;
      this.loadError = undefined;
      this.recoveredFromBackup = false;
      this.mirrorFailures.clear();
    }
    this.path = nextPath;
  }

  get metadataPath(): string {
    return this.path;
  }

  async load(): Promise<void> {
    return this.enqueue((context) => this.loadState(context));
  }

  private async loadState(context: StoreContext): Promise<void> {
    this.assertContext(context);
    this.loaded = false;
    this.loadError = undefined;
    this.recoveredFromBackup = false;
    let raw: string | null = null;
    try {
      raw = await this.readPrimary(context.path);
      this.assertContext(context);
      if (raw === null) {
        const recoveryExists = await this.adapter().exists(`${context.path}.bak`)
          || await this.adapter().exists(`${context.path}.tmp`);
        if (recoveryExists) throw new Error('Mood metadata primary file is missing');
      }
      const parsed = raw === null ? emptyMetadata() : JSON.parse(raw);
      const validation = validateMoodMetadata(parsed);
      if (!validation.valid) throw new Error(`Invalid mood metadata: ${formatValidation(validation)}`);
      const migration = migrateMoodMetadata(parsed);
      const serialized = JSON.stringify(migration.metadata, null, 2);
      if (raw !== null && (migration.migrated || serialized !== JSON.stringify(parsed, null, 2))) {
        try {
          await this.writeJsonAtomically(context.path, serialized, () => this.verifyPrimary(context, raw));
          raw = serialized;
        } catch (error) {
          this.assertContext(context);
          // A failed normalization write does not make the valid primary corrupt.
          console.warn('[Dayline] Mood metadata normalization could not be persisted:', error);
        }
      }
      this.assertContext(context);
      this.data = migration.metadata;
      this.primaryRaw = raw;
      this.loaded = true;
    } catch (error) {
      this.assertContext(context);
      const restored = await this.readRecovery(context.path);
      this.assertContext(context);
      if (restored) {
        this.data = restored;
        this.loaded = true;
        this.recoveredFromBackup = true;
        this.primaryRaw = raw;
        try {
          // Repair the primary file while keeping the known-good .bak intact.
          const content = JSON.stringify(restored, null, 2);
          await this.verifyPrimary(context, raw);
          await this.writeJson(context.path, content);
          this.assertContext(context);
          this.primaryRaw = content;
          this.recoveredFromBackup = false;
        } catch (repairError) {
          this.assertContext(context);
          console.warn('[Dayline] Mood metadata primary file could not be repaired:', repairError);
        }
        return;
      }
      console.warn('[Dayline] Mood metadata could not be read:', error);
      this.data = emptyMetadata();
      this.primaryRaw = raw;
      this.loaded = true;
      this.loadError = error instanceof Error ? error : new Error(String(error));
    }
  }

  get(path: string): MoodRecord | undefined {
    return this.data.entries[normalizeVaultPath(path)];
  }

  getForIndex(path: string): MoodRecord | null | undefined {
    const key = normalizeVaultPath(path);
    const record = this.data.entries[key];
    if (record) return record;
    return Object.hasOwn((this.data as MoodMetadataWithTombstones).tombstones ?? {}, key) ? null : undefined;
  }

  getAll(): Record<string, MoodRecord> {
    return { ...this.data.entries };
  }

  getOrphans(): NonNullable<MoodMetadata['orphans']> {
    return { ...(this.data.orphans ?? {}) };
  }

  getCustomLabels(): string[] {
    return normalizeCustomLabels(this.data.customLabels);
  }

  getMetadata(): MoodMetadata {
    return cloneUnknown(this.data);
  }

  subscribe(listener: MoodListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeMirrorFailures(listener: MoodMirrorFailureListener): () => void {
    this.mirrorFailureListeners.add(listener);
    return () => this.mirrorFailureListeners.delete(listener);
  }

  getMirrorFailure(path: string): MoodMirrorFailure | undefined {
    const failure = this.mirrorFailures.get(normalizeVaultPath(path));
    return failure ? { ...failure } : undefined;
  }

  async retryMirror(path: string): Promise<boolean> {
    const key = normalizeVaultPath(path);
    const failure = this.mirrorFailures.get(key);
    if (!failure) return true;
    const record = failure.operation === 'write' ? this.data.entries[key] : undefined;
    if (failure.operation === 'write' && !record) return false;
    return this.attemptMirror(key, failure.operation, record);
  }

  async set(path: string, score: MoodRecord['score'], labels: string[], settingsOrNote: MoodStoreSettings | string | null = {}, note?: string | null): Promise<MoodRecord> {
    const settings: MoodStoreSettings = settingsOrNote && typeof settingsOrNote === 'object' ? settingsOrNote : {};
    if (typeof settingsOrNote === 'string' || settingsOrNote === null) note = settingsOrNote;
    if (note === undefined && settingsOrNote && typeof settingsOrNote === 'object' && 'note' in settingsOrNote) {
      note = (settingsOrNote as MoodStoreSettings & { note?: string | null }).note;
    }
    const normalizedPath = normalizeVaultPath(path);
    let record!: MoodRecord;
    await this.mutate((data) => {
      const previous = data.entries[normalizedPath];
      const now = new Date().toISOString();
      record = normalizeRecord({
        ...(previous ? cloneUnknown(previous) : {}),
        score,
        labels: normalizeMoodLabels(labels),
        ...(note === undefined ? (previous?.note === undefined ? {} : { note: previous.note }) : { note: note === null ? null : String(note) }),
        recordedAt: previous?.recordedAt ?? now,
        updatedAt: now,
      });
      data.entries[normalizedPath] = record;
      data.customLabels = normalizeCustomLabels([...(data.customLabels ?? []), ...record.labels]);
      if (data.orphans) delete data.orphans[normalizedPath];
      delete (data as MoodMetadataWithTombstones).tombstones?.[normalizedPath];
    });
    this.emit(normalizedPath, record);
    if (settings.mirrorMoodToFrontmatter) await this.attemptMirror(normalizedPath, 'write', record);
    return record;
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldKey = normalizeVaultPath(oldPath);
    const newKey = normalizeVaultPath(newPath);
    if (oldKey === newKey) return;
    await this.mutate((data) => {
      if ((data.entries[oldKey] && data.entries[newKey]) || (data.orphans?.[oldKey] && data.orphans?.[newKey])) {
        throw new Error(`Mood rename target already has a record: ${newKey}`);
      }
      if (data.entries[oldKey]) {
        data.entries[newKey] = data.entries[oldKey];
        delete data.entries[oldKey];
        (data as MoodMetadataWithTombstones).tombstones ??= {};
        (data as MoodMetadataWithTombstones).tombstones![oldKey] = { deletedAt: new Date().toISOString() };
        delete (data as MoodMetadataWithTombstones).tombstones?.[newKey];
      }
      if (data.orphans?.[oldKey]) {
        data.orphans[newKey] = data.orphans[oldKey];
        delete data.orphans[oldKey];
      }
    });
    this.emit(newKey, this.get(newKey));
  }

  async removeToOrphan(path: string): Promise<void> {
    const key = normalizeVaultPath(path);
    await this.mutate((data) => {
      const record = data.entries[key];
      if (!record) return;
      data.orphans ??= {};
      data.orphans[key] = { record, orphanedAt: new Date().toISOString() };
      delete data.entries[key];
      (data as MoodMetadataWithTombstones).tombstones ??= {};
      (data as MoodMetadataWithTombstones).tombstones![key] = { deletedAt: new Date().toISOString() };
    });
    this.emit(key, undefined);
  }

  /** Delete a single mood while retaining it in the recovery list by default. */
  async deleteRecord(path: string, preserveRecovery = true, fallbackRecord?: MoodRecord): Promise<MoodRecord | undefined> {
    const key = normalizeVaultPath(path);
    let record: MoodRecord | undefined;
    await this.mutate((data) => {
      record = data.entries[key]
        || (fallbackRecord && validMoodRecord(fallbackRecord) ? normalizeRecord(cloneUnknown(fallbackRecord)) : undefined);
      if (preserveRecovery) {
        if (record) {
          data.orphans ??= {};
          data.orphans[key] = { record: cloneUnknown(record), orphanedAt: new Date().toISOString() };
        }
      } else if (data.orphans) {
        delete data.orphans[key];
      }
      delete data.entries[key];
      (data as MoodMetadataWithTombstones).tombstones ??= {};
      (data as MoodMetadataWithTombstones).tombstones![key] = { deletedAt: new Date().toISOString() };
    });
    this.emit(key, undefined);
    await this.attemptMirror(key, 'delete');
    return record;
  }

  async remove(path: string, options: { preserveRecovery?: boolean } = {}): Promise<MoodRecord | undefined> {
    return this.deleteRecord(path, options.preserveRecovery !== false);
  }

  async delete(path: string, preserveRecovery = true): Promise<MoodRecord | undefined> {
    return this.deleteRecord(path, preserveRecovery);
  }

  async restoreOrphan(orphanKey: string, destinationPath = orphanKey, options: MoodRestoreOptions = {}): Promise<MoodRecord | undefined> {
    const sourceKey = normalizeVaultPath(orphanKey);
    const destination = safeVaultPath(destinationPath);
    let record: MoodRecord | undefined;
    await this.mutate((data) => {
      const source = data.orphans?.[sourceKey];
      if (!source) return;
      const file = this.app.vault.getAbstractFileByPath(destination);
      if (!destination.toLowerCase().endsWith('.md') || !file) {
        throw new Error(`Mood restore target Markdown does not exist: ${destination}`);
      }
      if (data.entries[destination] && !options.replace) {
        throw new Error(`Mood restore target already has a record: ${destination}`);
      }
      record = source.record;
      data.entries[destination] = source.record;
      delete data.orphans?.[sourceKey];
      delete (data as MoodMetadataWithTombstones).tombstones?.[destination];
    });
    if (record) this.emit(destination, record);
    return record;
  }

  async importFrontmatter(filePaths: string[], metadataCache: any): Promise<number> {
    let imported = 0;
    await this.mutate((data) => {
      for (const rawPath of filePaths) {
        const path = normalizeVaultPath(rawPath);
        if (data.entries[path] || Object.hasOwn((data as MoodMetadataWithTombstones).tombstones ?? {}, path)) continue;
        const file = this.app.vault.getAbstractFileByPath(path);
        const frontmatter = metadataCache.getFileCache(file)?.frontmatter ?? {};
        const score = parseMoodScore(frontmatter.mood);
        if (score === undefined) continue;
        const labels = normalizeMoodLabels(Array.isArray(frontmatter.mood_labels)
          ? frontmatter.mood_labels
          : typeof frontmatter.mood_labels === 'string'
            ? frontmatter.mood_labels.split(',')
            : []);
        const rawNote = frontmatter.mood_note ?? frontmatter.mood_comment;
        const now = new Date().toISOString();
        data.entries[path] = normalizeRecord({
          score,
          labels,
          ...(rawNote === null || rawNote === undefined || String(rawNote).trim() === '' ? {} : { note: String(rawNote).trim() }),
          recordedAt: now,
          updatedAt: now,
        });
        data.customLabels = normalizeCustomLabels([...(data.customLabels ?? []), ...labels]);
        imported++;
      }
    });
    for (const path of filePaths) if (this.data.entries[normalizeVaultPath(path)]) this.emit(normalizeVaultPath(path), this.get(path));
    return imported;
  }

  async exportTo(destinationPath = `${this.path}.export.json`): Promise<string> {
    await this.flush();
    if (this.loadError) throw this.loadError;
    const destination = safeVaultPath(destinationPath);
    if (destination === this.path) throw new Error('Export destination must differ from the metadata path');
    await this.writeJsonAtomically(destination, `${JSON.stringify(this.data, null, 2)}\n`);
    return destination;
  }

  async exportCsv(destinationPath = `${this.path}.export.csv`): Promise<string> {
    await this.flush();
    if (this.loadError) throw this.loadError;
    const destination = safeVaultPath(destinationPath);
    if (destination === this.path) throw new Error('Export destination must differ from the metadata path');
    await this.writeJsonAtomically(destination, serializeMoodCsv(this.data));
    return destination;
  }

  async exportJson(destinationPath = `${this.path}.moods.json`): Promise<string> {
    await this.flush();
    if (this.loadError) throw this.loadError;
    const destination = safeVaultPath(destinationPath);
    if (destination === this.path) throw new Error('Export destination must differ from the metadata path');
    await this.writeJsonAtomically(destination, serializeMoodJson(this.data));
    return destination;
  }

  async restoreFrom(raw: string | MoodMetadata | unknown): Promise<void> {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const validation = validateMoodMetadata(parsed);
    if (!validation.valid) throw new Error(`Invalid mood metadata: ${formatValidation(validation)}`);
    const next = migrateMoodMetadata(parsed).metadata;
    await this.enqueue((context) => this.replaceMetadata(next, context));
  }

  async restoreBackup(): Promise<{ entries: number; orphans: number }> {
    return this.enqueue(async (context) => {
      const backupPath = `${context.path}.bak`;
      if (!(await this.adapter().exists(backupPath))) throw new Error(`Backup not found: ${backupPath}`);
      const parsed = JSON.parse(await this.adapter().read(backupPath));
      const validation = validateMoodMetadata(parsed);
      if (!validation.valid) throw new Error(`Invalid mood backup: ${formatValidation(validation)}`);
      const next = migrateMoodMetadata(parsed).metadata;
      await this.replaceMetadata(next, context);
      return { entries: Object.keys(next.entries).length, orphans: Object.keys(next.orphans ?? {}).length };
    });
  }

  async checkIntegrity(): Promise<MoodIntegrityReport> {
    return this.enqueue(() => this.checkIntegrityState());
  }

  private async checkIntegrityState(): Promise<MoodIntegrityReport> {
    const invalidRecords: string[] = [];
    const invalidOrphans: string[] = [];
    const invalidMetadata: string[] = [];
    const missingFiles: string[] = [];
    let backupAvailable = false;
    let primaryExists = false;
    const pathsToCheck = new Set(Object.keys(this.data.entries));
    try {
      primaryExists = await this.adapter().exists(this.path);
      if (primaryExists) {
        const raw = JSON.parse(await this.adapter().read(this.path));
        const result = validateMoodMetadata(raw);
        invalidRecords.push(...result.invalidRecords);
        invalidOrphans.push(...result.invalidOrphans);
        invalidMetadata.push(...result.invalidMetadata);
        if (raw?.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries)) {
          for (const [path, record] of Object.entries(raw.entries)) {
            if (validMoodRecord(record)) pathsToCheck.add(normalizeVaultPath(path));
          }
        }
      } else if (Object.keys(this.data.entries).length > 0) {
        invalidMetadata.push('metadata-file-missing');
      }
    } catch {
      invalidMetadata.push(this.path);
    }
    const backupPath = `${this.path}.bak`;
    backupAvailable = await this.adapter().exists(backupPath);
    if (backupAvailable) {
      try {
        const backupResult = validateMoodMetadata(JSON.parse(await this.adapter().read(backupPath)));
        if (!backupResult.valid) {
          backupAvailable = false;
          invalidMetadata.push('backup');
        }
      } catch {
        backupAvailable = false;
        invalidMetadata.push('backup');
      }
    } else if (!primaryExists && Object.keys(this.data.entries).length > 0) {
      invalidMetadata.push('metadata-file-missing');
    }
    for (const path of pathsToCheck) {
      if (path && !this.app.vault.getAbstractFileByPath(path)) missingFiles.push(path);
    }
    return {
      valid: invalidRecords.length === 0 && invalidOrphans.length === 0 && invalidMetadata.length === 0 && missingFiles.length === 0,
      invalidRecords,
      invalidOrphans,
      invalidMetadata,
      missingFiles,
      backupAvailable,
    };
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async mutate(mutator: (data: MoodMetadata) => void | MoodMetadata): Promise<void> {
    return this.enqueue(async (context) => {
      if (!this.loaded) await this.loadState(context);
      this.assertContext(context);
      if (this.loadError) throw this.loadError;
      if (this.recoveredFromBackup) {
        await this.verifyPrimary(context, this.primaryRaw);
        const content = JSON.stringify(this.data, null, 2);
        await this.writeJson(context.path, content);
        this.assertContext(context);
        this.primaryRaw = content;
        this.recoveredFromBackup = false;
      }
      const base = this.data;
      const cloned = normalizeMetadata(cloneUnknown(base));
      const result = mutator(cloned);
      const local = result && typeof result === 'object' && 'entries' in result ? result : cloned;
      if (sameValue(base, local)) return;
      const raw = await this.readPrimary(context.path);
      this.assertContext(context);
      if (raw === null && this.primaryRaw !== null) throw new Error('Mood metadata conflict: primary file was removed');
      const parsed = raw === null ? emptyMetadata() : JSON.parse(raw);
      const validation = validateMoodMetadata(parsed);
      if (!validation.valid) throw new Error(`Invalid mood metadata: ${formatValidation(validation)}`);
      const next = mergeMetadata(base, local, normalizeMetadata(parsed));
      const content = JSON.stringify(next, null, 2);
      await this.writeJsonAtomically(context.path, content, () => this.verifyPrimary(context, raw));
      this.assertContext(context);
      this.data = next;
      this.primaryRaw = content;
    });
  }

  private enqueue<T>(operation: (context: StoreContext) => Promise<T>): Promise<T> {
    const context = { path: this.path, generation: this.generation };
    const task = this.writeQueue.then(() => {
      this.assertContext(context);
      return operation(context);
    });
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  private assertContext(context: StoreContext): void {
    if (context.generation !== this.generation) throw new Error('Mood metadata path changed during operation');
  }

  private async readPrimary(path: string): Promise<string | null> {
    return await this.adapter().exists(path) ? this.adapter().read(path) : null;
  }

  private async verifyPrimary(context: StoreContext, expected: string | null): Promise<void> {
    this.assertContext(context);
    const actual = await this.readPrimary(context.path);
    this.assertContext(context);
    if (actual !== expected) throw new Error('Mood metadata conflict: file changed during operation');
  }

  private async mirrorToFrontmatter(path: string, record: MoodRecord): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !this.app.fileManager?.processFrontMatter) return;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.mood = record.score;
      frontmatter.mood_labels = record.labels;
      if (record.note === null || record.note === undefined || record.note === '') delete frontmatter.mood_note;
      else frontmatter.mood_note = record.note;
    });
  }

  private async removeMoodFromFrontmatter(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !this.app.fileManager?.processFrontMatter) return;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      for (const key of Object.keys(frontmatter)) {
        if (MOOD_FRONTMATTER_KEYS.has(key.toLowerCase())) delete frontmatter[key];
      }
    });
  }

  private async attemptMirror(path: string, operation: MoodMirrorFailure['operation'], record?: MoodRecord): Promise<boolean> {
    try {
      if (operation === 'write' && record) await this.mirrorToFrontmatter(path, record);
      else if (operation === 'delete') await this.removeMoodFromFrontmatter(path);
      if (this.mirrorFailures.delete(path)) this.emitMirrorFailure(undefined);
      return true;
    } catch (error) {
      const failure: MoodMirrorFailure = {
        path,
        operation,
        message: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString(),
      };
      this.mirrorFailures.set(path, failure);
      console.warn(`[Dayline] Mood frontmatter mirror ${operation} failed for ${path}:`, error);
      this.emitMirrorFailure(failure);
      return false;
    }
  }

  private async readRecovery(path: string): Promise<MoodMetadata | undefined> {
    for (const suffix of ['.bak', '.tmp']) {
      try {
        const candidate = `${path}${suffix}`;
        if (!(await this.adapter().exists(candidate))) continue;
        const parsed = JSON.parse(await this.adapter().read(candidate));
        if (validateMoodMetadata(parsed).valid) return migrateMoodMetadata(parsed).metadata;
      } catch {
        // Try the next recovery candidate without discarding either file.
      }
    }
    return undefined;
  }

  private adapter(): any {
    return this.app.vault.adapter;
  }

  private async writeJson(path: string, content: string): Promise<void> {
    await this.ensureParent(path);
    await this.adapter().write(path, content);
  }

  private async writeJsonAtomically(path: string, content: string, beforeCommit?: () => Promise<void>): Promise<void> {
    await this.ensureParent(path);
    const temp = `${path}.tmp`;
    const backup = `${path}.bak`;
    const adapter = this.adapter();
    let movedPrimary = false;
    try {
      await adapter.write(temp, content);
      await beforeCommit?.();
      if (await adapter.exists(path)) {
        if (await adapter.exists(backup)) await adapter.remove(backup);
        await adapter.rename(path, backup);
        movedPrimary = true;
      }
      await adapter.rename(temp, path);
    } catch (error) {
      try {
        if (movedPrimary && !(await adapter.exists(path)) && await adapter.exists(backup)) await adapter.rename(backup, path);
      } catch {
        // Preserve the original error while leaving the backup for recovery.
      }
      try {
        if (await adapter.exists(temp)) await adapter.remove(temp);
      } catch {
        // Preserve the original error if a temporary file cannot be cleaned up.
      }
      throw error;
    }
  }

  private async replaceMetadata(next: MoodMetadata, context: StoreContext): Promise<void> {
    // Explicit restore keeps the existing .bak as a recovery point.
    const raw = await this.readPrimary(context.path);
    await this.verifyPrimary(context, raw);
    const content = JSON.stringify(next, null, 2);
    await this.writeJson(context.path, content);
    this.assertContext(context);
    this.data = next;
    this.primaryRaw = content;
    this.loaded = true;
    this.loadError = undefined;
    this.recoveredFromBackup = false;
    for (const path of Object.keys(next.entries)) this.emit(path, next.entries[path]);
  }

  private async ensureParent(path: string): Promise<void> {
    const parent = parentPath(path);
    if (!parent) return;
    const adapter = this.adapter();
    if (!(await adapter.exists(parent))) await adapter.mkdir(parent);
  }

  private emit(path: string, record: MoodRecord | undefined): void {
    for (const listener of this.listeners) listener(path, record);
  }

  private emitMirrorFailure(failure: MoodMirrorFailure | undefined): void {
    for (const listener of this.mirrorFailureListeners) {
      try {
        listener(failure);
      } catch (error) {
        console.warn('[Dayline] Mood mirror failure listener failed:', error);
      }
    }
  }
}

function formatValidation(result: MoodIntegrityReport): string {
  const parts = [
    result.invalidMetadata.length ? `metadata: ${result.invalidMetadata.join(', ')}` : '',
    result.invalidRecords.length ? `records: ${result.invalidRecords.join(', ')}` : '',
    result.invalidOrphans.length ? `orphans: ${result.invalidOrphans.join(', ')}` : '',
  ].filter(Boolean);
  return parts.join('; ') || 'unknown validation error';
}
