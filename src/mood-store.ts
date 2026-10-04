import { normalizeVaultPath } from './date-utils';
import type { MoodMetadata, MoodRecord } from './types';
import { MOOD_LABELS, parseMoodScore } from './mood';
import { serializeMoodCsv, serializeMoodJson } from './mood-export';

/** Current on-disk mood metadata contract. v1 remains readable and is migrated on load. */
export const MOOD_SCHEMA_VERSION = 2 as const;
export const LEGACY_MOOD_SCHEMA_VERSION = 1 as const;
/** Delete tombstones older than this no longer block a note recreated at the same path. */
export const MOOD_TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

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
  /** The file structure is usable; individual invalid records are skipped instead of invalidating the file. */
  readable: boolean;
  /** The file declares a schema newer than this plugin supports, so writes are disabled. */
  futureSchema: boolean;
  invalidRecords: string[];
  invalidOrphans: string[];
  invalidMetadata: string[];
  missingFiles: string[];
  backupAvailable: boolean;
  /** Human-readable problems collected while reading: skipped records, unknown schema, and similar. */
  warnings: string[];
}

/** Thrown when the metadata file was written by a newer schema and must not be overwritten. */
export class MoodMetadataReadOnlyError extends Error {
  readonly path: string;
  readonly schemaVersion: number | undefined;

  constructor(path: string, schemaVersion?: number) {
    super(`Mood metadata ${path} uses schema ${schemaVersion ?? 'unknown'}, which is newer than schema ${MOOD_SCHEMA_VERSION}; writing is disabled until Dayline is updated`);
    this.name = 'MoodMetadataReadOnlyError';
    this.path = path;
    this.schemaVersion = schemaVersion;
  }
}

type MoodListener = (path: string, record: MoodRecord | undefined) => void;
type MoodMirrorFailureListener = (failure: MoodMirrorFailure | undefined) => void;
type StoreContext = { path: string; generation: number };
type MoodTombstone = { deletedAt: string; [key: string]: unknown };
type MoodMetadataWithTombstones = MoodMetadata & { tombstones?: Record<string, MoodTombstone> };
type MoodMutateOptions = {
  /** Explicit overwrite: conflicts for this key resolve to the newest `updatedAt` instead of throwing. */
  overwritePath?: string;
};
type MoodMergeOptions = {
  overwritePath?: string;
};

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

/** Validate a score through the shared strict parser and throw a caller-actionable error. */
function requireMoodScore(value: unknown, context: string): MoodRecord['score'] {
  const score = parseMoodScore(value);
  if (score === undefined) {
    throw new Error(`Invalid mood score for ${context}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`);
  }
  return score;
}

/**
 * A tombstone is stale when the note was recreated after the deletion, when the
 * deletion timestamp is unusable, or when it outlived the tombstone TTL.
 */
function isTombstoneStale(tombstone: MoodTombstone, fileCtime: number | undefined, now = Date.now(), maxAgeMs = MOOD_TOMBSTONE_TTL_MS): boolean {
  const deletedAt = Date.parse(String(tombstone?.deletedAt ?? ''));
  if (!Number.isFinite(deletedAt)) return true;
  if (fileCtime !== undefined && Number.isFinite(fileCtime) && deletedAt < fileCtime) return true;
  return now - deletedAt > maxAgeMs;
}

function fileCtimeOf(file: unknown): number | undefined {
  const ctime = Number((file as { stat?: { ctime?: unknown } } | undefined)?.stat?.ctime);
  return Number.isFinite(ctime) ? ctime : undefined;
}

/** Drop tombstones past the TTL. Mutates the freshly migrated metadata in place. */
function pruneStaleTombstones(metadata: MoodMetadata, now: number, maxAgeMs = MOOD_TOMBSTONE_TTL_MS): MoodMetadata {
  const tombstones = (metadata as MoodMetadataWithTombstones).tombstones;
  if (!tombstones) return metadata;
  for (const [path, tombstone] of Object.entries(tombstones)) {
    if (isTombstoneStale(tombstone, undefined, now, maxAgeMs)) delete tombstones[path];
  }
  return metadata;
}

function isConflictError(error: unknown): boolean {
  return error instanceof Error && /conflict/iu.test(error.message);
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
  const warnings: string[] = [];
  const finish = (readable: boolean, futureSchema: boolean): MoodIntegrityReport => ({
    valid: readable && invalidRecords.length === 0 && invalidOrphans.length === 0 && invalidMetadata.length === 0,
    readable,
    futureSchema,
    invalidRecords,
    invalidOrphans,
    invalidMetadata,
    missingFiles: [],
    backupAvailable: false,
    warnings,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidMetadata.push('metadata');
    return finish(false, false);
  }

  const raw = value as Record<string, unknown>;
  const schemaVersion = raw.schemaVersion === undefined
    ? MOOD_SCHEMA_VERSION
    : Number(raw.schemaVersion);
  if (!Number.isFinite(schemaVersion)) invalidMetadata.push('schemaVersion');
  const futureSchema = Number.isFinite(schemaVersion) && schemaVersion > MOOD_SCHEMA_VERSION;
  if (futureSchema) {
    warnings.push(`Mood metadata schema ${schemaVersion} is newer than supported schema ${MOOD_SCHEMA_VERSION}; writes are disabled until the plugin is upgraded`);
  } else if (Number.isFinite(schemaVersion) && schemaVersion !== LEGACY_MOOD_SCHEMA_VERSION && schemaVersion !== MOOD_SCHEMA_VERSION) {
    warnings.push(`Unknown mood metadata schema ${schemaVersion}; normalized as schema ${MOOD_SCHEMA_VERSION}`);
  }
  if (!raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) {
    invalidMetadata.push('entries');
  } else {
    const normalizedPaths = new Set<string>();
    for (const [path, record] of Object.entries(raw.entries)) {
      const normalizedPath = normalizeVaultPath(path);
      const duplicate = normalizedPath ? normalizedPaths.has(normalizedPath) : false;
      if (normalizedPath) normalizedPaths.add(normalizedPath);
      if (!normalizedPath || duplicate || !validMoodRecord(record)) invalidRecords.push(path);
    }
  }
  if (raw.orphans !== undefined && (!raw.orphans || typeof raw.orphans !== 'object' || Array.isArray(raw.orphans))) {
    invalidMetadata.push('orphans');
  } else if (raw.orphans && typeof raw.orphans === 'object') {
    for (const [path, orphanValue] of Object.entries(raw.orphans)) {
      const orphan = orphanValue && typeof orphanValue === 'object' ? orphanValue as Record<string, unknown> : {};
      if (!normalizeVaultPath(path) || !validMoodRecord(orphan.record) || typeof orphan.orphanedAt !== 'string') invalidOrphans.push(path);
    }
  }
  if (raw.tombstones !== undefined && (!raw.tombstones || typeof raw.tombstones !== 'object' || Array.isArray(raw.tombstones))) {
    invalidMetadata.push('tombstones');
  } else if (raw.tombstones && typeof raw.tombstones === 'object') {
    for (const [path, tombstoneValue] of Object.entries(raw.tombstones)) {
      const tombstone = tombstoneValue && typeof tombstoneValue === 'object' && !Array.isArray(tombstoneValue) ? tombstoneValue as Record<string, unknown> : {};
      if (!normalizeVaultPath(path) || typeof tombstone.deletedAt !== 'string' || !tombstone.deletedAt.trim()) {
        invalidMetadata.push(`tombstone:${path}`);
      }
    }
  }
  for (const path of invalidRecords) warnings.push(`Skipped invalid mood record: ${path}`);
  for (const path of invalidOrphans) warnings.push(`Skipped invalid mood orphan: ${path}`);
  // A future schema stays readable on purpose: it is opened read-only so the newer file is never overwritten.
  return finish(invalidMetadata.length === 0 || futureSchema, futureSchema);
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

function recordUpdatedAt(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
  if (typeof updatedAt !== 'string') return undefined;
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** True only when the remote record carries a strictly newer, parseable `updatedAt`. */
function isRemoteRecordNewer(local: unknown, remote: unknown): boolean {
  const localAt = recordUpdatedAt(local);
  const remoteAt = recordUpdatedAt(remote);
  if (localAt === undefined || remoteAt === undefined) return false;
  return remoteAt > localAt;
}

/** Apply local changes to the latest disk snapshot, rejecting overlapping edits. */
function mergeMetadata(base: MoodMetadata, local: MoodMetadata, remote: MoodMetadata, options: MoodMergeOptions = {}): MoodMetadata {
  for (const [path, record] of Object.entries(local.entries)) {
    if (!isScore(record?.score)) throw new Error(`Invalid mood score for ${path}: ${String(record?.score)}`);
  }
  for (const [path, orphan] of Object.entries(local.orphans ?? {})) {
    if (!isScore(orphan?.record?.score)) throw new Error(`Invalid mood score for ${path}: ${String(orphan?.record?.score)}`);
  }
  const result = cloneUnknown(remote);
  const overwritePath = options.overwritePath;
  // A file sync engine replaces the metadata at file granularity, so the disk
  // snapshot can be an older copy. Every real deletion leaves a tombstone, so
  // a record that only exists in the merge base and has no tombstone on disk
  // was lost by a stale synced copy, not deleted: re-seed it from the base so
  // this write heals the file instead of overwriting it.
  const remoteTombstones = (remote as MoodMetadataWithTombstones).tombstones ?? {};
  const mergeMap = (before: Record<string, unknown>, after: Record<string, unknown>, disk: Record<string, unknown>, label: string, missingOnDiskIsStale?: (key: string) => boolean) => {
    const merged = cloneUnknown(disk);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    if (overwritePath !== undefined) keys.add(overwritePath);
    for (const key of keys) {
      const isOverwriteKey = key === overwritePath;
      if (!isOverwriteKey && sameValue(before[key], after[key])) {
        if (missingOnDiskIsStale?.(key) && !Object.hasOwn(disk, key) && before[key] !== undefined) {
          Object.defineProperty(merged, key, { value: cloneUnknown(before[key]), enumerable: true, configurable: true, writable: true });
        }
        continue;
      }
      if (isOverwriteKey) {
        // Explicit overwrite: the newer record wins, everything else follows local intent.
        if (isRemoteRecordNewer(after[key], disk[key])) continue;
      } else if (!sameValue(before[key], disk[key])) {
        throw new Error(`Mood metadata conflict: ${label}${key}`);
      }
      if (Object.hasOwn(after, key)) Object.defineProperty(merged, key, { value: cloneUnknown(after[key]), enumerable: true, configurable: true, writable: true });
      else delete merged[key];
    }
    return merged;
  };
  result.entries = mergeMap(
    base.entries,
    local.entries,
    remote.entries,
    'entries/',
    (key) => !Object.hasOwn(remoteTombstones, key),
  ) as MoodMetadata['entries'];
  result.orphans = mergeMap(base.orphans ?? {}, local.orphans ?? {}, remote.orphans ?? {}, 'orphans/') as MoodMetadata['orphans'];
  (result as MoodMetadataWithTombstones).tombstones = mergeMap(
    (base as MoodMetadataWithTombstones).tombstones ?? {},
    (local as MoodMetadataWithTombstones).tombstones ?? {},
    (remote as MoodMetadataWithTombstones).tombstones ?? {},
    'tombstones/',
  ) as Record<string, MoodTombstone>;
  result.customLabels = normalizeCustomLabels([...(remote.customLabels ?? []), ...(base.customLabels ?? []), ...(local.customLabels ?? [])]);
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
  private readOnlyMode = false;
  private readOnlySchemaVersion: number | undefined;
  private warnings: string[] = [];
  private mirrorMoodToFrontmatter = false;
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
      this.readOnlyMode = false;
      this.readOnlySchemaVersion = undefined;
      this.warnings = [];
      this.mirrorFailures.clear();
    }
    if (settings.mirrorMoodToFrontmatter !== undefined) this.mirrorMoodToFrontmatter = settings.mirrorMoodToFrontmatter;
    this.path = nextPath;
  }

  get metadataPath(): string {
    return this.path;
  }

  /** True while the metadata file uses a newer schema; every write is refused until the plugin is upgraded. */
  get readOnly(): boolean {
    return this.readOnlyMode;
  }

  /** Problems collected by the last read, such as invalid records that were skipped. */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  async load(): Promise<void> {
    return this.enqueue((context) => this.loadState(context));
  }

  private async loadState(context: StoreContext): Promise<void> {
    this.assertContext(context);
    this.loaded = false;
    this.loadError = undefined;
    this.recoveredFromBackup = false;
    this.readOnlyMode = false;
    this.readOnlySchemaVersion = undefined;
    this.warnings = [];
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
      if (!validation.readable) throw new Error(`Invalid mood metadata: ${formatValidation(validation)}`);
      const migration = migrateMoodMetadata(parsed);
      this.warnings = Array.from(new Set([...validation.warnings, ...migration.warnings]));
      // Read-only mode must not rewrite the newer file, so only prune tombstones when the file is writable.
      const metadata = validation.futureSchema
        ? migration.metadata
        : pruneStaleTombstones(migration.metadata, Date.now());
      if (validation.futureSchema) {
        this.readOnlyMode = true;
        this.readOnlySchemaVersion = migration.fromVersion;
        this.data = metadata;
        this.primaryRaw = raw;
        this.loaded = true;
        return;
      }
      const serialized = JSON.stringify(metadata, null, 2);
      if (raw !== null && (migration.migrated || serialized !== JSON.stringify(parsed, null, 2))) {
        try {
          await this.writeJsonWithBackup(context.path, serialized, () => this.verifyPrimary(context, raw));
          raw = serialized;
        } catch (error) {
          this.assertContext(context);
          // A failed normalization write does not make the valid primary corrupt.
          console.warn('[Dayline] Mood metadata normalization could not be persisted:', error);
        }
      }
      this.assertContext(context);
      this.data = metadata;
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
        // Preserve the damaged primary before the backup content replaces it.
        if (raw !== null) await this.saveCorruptCopy(context, raw);
        this.assertContext(context);
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

  /** Re-read the metadata file after an external change, refresh state, and notify listeners. */
  async reloadFromDisk(): Promise<void> {
    return this.enqueue(async (context) => {
      const previous = this.data;
      await this.loadState(context);
      this.assertContext(context);
      await this.reconcileRevertedRecords(context, previous);
      this.assertContext(context);
      this.emitChanged(previous, this.data);
    });
  }

  /**
   * Restore records that the freshly read disk file lost relative to the
   * previous in-memory state, and persist the union. A sync engine replacing
   * the metadata with an older copy used to hide those records until the next
   * write re-seeded them; healing the file here keeps both devices converging
   * instead of overwriting each other. Tombstones are deliberately not
   * reconciled: a recreated note must stay able to expose a fresh record even
   * while this session still holds the old deletion.
   */
  private async reconcileRevertedRecords(context: StoreContext, previous: MoodMetadata): Promise<void> {
    if (this.readOnlyMode || this.loadError) return;
    const tombstones = (this.data as MoodMetadataWithTombstones).tombstones ?? {};
    const lost: Record<string, MoodRecord> = {};
    for (const [key, record] of Object.entries(previous.entries ?? {})) {
      if (!this.data.entries[key] && !tombstones[key]) lost[key] = record;
    }
    if (Object.keys(lost).length === 0) return;
    const next: MoodMetadata = {
      ...cloneUnknown(this.data),
      entries: { ...cloneUnknown(this.data.entries), ...cloneUnknown(lost) },
    };
    next.customLabels = normalizeCustomLabels([...(next.customLabels ?? []), ...customLabelsFrom(lost, {})]);
    this.data = next;
    const content = JSON.stringify(next, null, 2);
    try {
      await this.writeJsonWithBackup(context.path, content, () => this.verifyPrimary(context, this.primaryRaw));
      this.primaryRaw = content;
    } catch (error) {
      // Memory already keeps the union; the next queued write re-seeds the same records.
      console.warn('[Dayline] Mood metadata reconciliation could not be persisted:', error);
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

  async set(path: string, score: unknown, labels: string[], settingsOrNote: MoodStoreSettings | string | null = {}, note?: string | null): Promise<MoodRecord> {
    const settings: MoodStoreSettings = settingsOrNote && typeof settingsOrNote === 'object' ? settingsOrNote : {};
    if (typeof settingsOrNote === 'string' || settingsOrNote === null) note = settingsOrNote;
    if (note === undefined && settingsOrNote && typeof settingsOrNote === 'object' && 'note' in settingsOrNote) {
      note = (settingsOrNote as MoodStoreSettings & { note?: string | null }).note;
    }
    const normalizedPath = normalizeVaultPath(path);
    const parsedScore = requireMoodScore(score, normalizedPath);
    let record!: MoodRecord;
    await this.mutate((data) => {
      const previous = data.entries[normalizedPath];
      const now = new Date().toISOString();
      record = normalizeRecord({
        ...(previous ? cloneUnknown(previous) : {}),
        score: parsedScore,
        labels: normalizeMoodLabels(labels),
        ...(note === undefined ? (previous?.note === undefined ? {} : { note: previous.note }) : { note: note === null ? null : String(note) }),
        recordedAt: previous?.recordedAt ?? now,
        updatedAt: now,
      });
      data.entries[normalizedPath] = record;
      data.customLabels = normalizeCustomLabels([...(data.customLabels ?? []), ...record.labels]);
      if (data.orphans) delete data.orphans[normalizedPath];
      delete (data as MoodMetadataWithTombstones).tombstones?.[normalizedPath];
    }, { overwritePath: normalizedPath });
    // Last-writer-wins may have kept a newer external record; publish what is actually stored.
    const effective = this.data.entries[normalizedPath] ?? record;
    this.emit(normalizedPath, effective);
    if (settings.mirrorMoodToFrontmatter || this.mirrorMoodToFrontmatter) await this.attemptMirror(normalizedPath, 'write', effective);
    return effective;
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
    let fromFrontmatter = false;
    await this.mutate((data) => {
      const stored = data.entries[key];
      if (stored) {
        record = stored;
      } else if (fallbackRecord) {
        const candidate = normalizeRecord({ ...cloneUnknown(fallbackRecord), score: requireMoodScore(fallbackRecord.score, key) });
        if (validMoodRecord(candidate)) {
          record = candidate;
          fromFrontmatter = true;
        }
      }
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
    // Only touch note frontmatter when the store owns it, or the mood came from frontmatter itself.
    if (this.mirrorMoodToFrontmatter || fromFrontmatter) await this.attemptMirror(key, 'delete', record);
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
      const restored = normalizeRecord({ ...cloneUnknown(source.record), score: requireMoodScore(source.record?.score, sourceKey) });
      record = restored;
      data.entries[destination] = restored;
      delete data.orphans?.[sourceKey];
      delete (data as MoodMetadataWithTombstones).tombstones?.[destination];
    });
    if (record) this.emit(destination, record);
    return record;
  }

  /**
   * Restore an orphaned mood when a note reappears at the orphaned path. Sync
   * engines replace files as delete + recreate, which moved the mood to the
   * recovery list and hid it until the user restored it by hand. A live record
   * at the destination always wins, and a file whose creation predates the
   * orphaning is not a recreation, so the orphan is kept in both cases.
   * `fileCtime` is the Obsidian `TFile.stat.ctime` in milliseconds; when
   * omitted it is read from the vault. Returns true when a record was restored.
   */
  async autoRecoverOrphan(path: string, fileCtime?: number): Promise<boolean> {
    const key = normalizeVaultPath(path);
    const ctime = fileCtime ?? this.vaultFileCtime(key);
    let restored: MoodRecord | undefined;
    await this.mutate((data) => {
      const source = data.orphans?.[key];
      if (!source || data.entries[key]) return;
      const orphanedAt = Date.parse(String(source.orphanedAt ?? ''));
      // A file whose creation predates the orphaning is not a recreation.
      if (ctime !== undefined && Number.isFinite(orphanedAt) && orphanedAt >= ctime) return;
      restored = normalizeRecord({ ...cloneUnknown(source.record), score: requireMoodScore(source.record?.score, key) });
      data.entries[key] = restored;
      delete data.orphans?.[key];
      delete (data as MoodMetadataWithTombstones).tombstones?.[key];
    }, { overwritePath: key });
    if (restored) this.emit(key, restored);
    return restored !== undefined;
  }

  /**
   * Drop the delete tombstone for `path` when it is stale, so a note recreated at
   * the same path can expose its frontmatter mood again. `fileCtime` is the
   * Obsidian `TFile.stat.ctime` in milliseconds; when omitted it is read from the
   * vault. Returns true when a tombstone was removed.
   */
  async clearStaleTombstone(path: string, fileCtime?: number): Promise<boolean> {
    const key = normalizeVaultPath(path);
    const tombstone = (this.data as MoodMetadataWithTombstones).tombstones?.[key];
    if (!tombstone) return false;
    const ctime = fileCtime ?? this.vaultFileCtime(key);
    if (!isTombstoneStale(tombstone, ctime)) return false;
    await this.mutate((data) => {
      delete (data as MoodMetadataWithTombstones).tombstones?.[key];
    });
    this.emit(key, this.data.entries[key]);
    return true;
  }

  /** Remove delete tombstones older than `maxAgeMs`; returns how many were dropped. */
  async pruneTombstones(maxAgeMs = MOOD_TOMBSTONE_TTL_MS): Promise<number> {
    let removed = 0;
    await this.mutate((data) => {
      const tombstones = (data as MoodMetadataWithTombstones).tombstones;
      if (!tombstones) return;
      for (const [path, tombstone] of Object.entries(tombstones)) {
        if (isTombstoneStale(tombstone, undefined, Date.now(), maxAgeMs)) {
          delete tombstones[path];
          removed++;
        }
      }
    });
    return removed;
  }

  async importFrontmatter(filePaths: string[], metadataCache: any): Promise<number> {
    let imported = 0;
    await this.mutate((data) => {
      const tombstones = (data as MoodMetadataWithTombstones).tombstones ?? {};
      for (const rawPath of filePaths) {
        const path = normalizeVaultPath(rawPath);
        if (!path || data.entries[path]) continue;
        const file = this.app.vault.getAbstractFileByPath(path);
        const tombstone = tombstones[path];
        // A stale tombstone must not hide the mood of a note recreated at this path.
        if (tombstone && !isTombstoneStale(tombstone, fileCtimeOf(file))) continue;
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
        if (tombstone) delete tombstones[path];
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
    await this.writeJsonWithBackup(destination, `${JSON.stringify(this.data, null, 2)}\n`);
    return destination;
  }

  async exportCsv(destinationPath = `${this.path}.export.csv`): Promise<string> {
    await this.flush();
    if (this.loadError) throw this.loadError;
    const destination = safeVaultPath(destinationPath);
    if (destination === this.path) throw new Error('Export destination must differ from the metadata path');
    await this.writeJsonWithBackup(destination, serializeMoodCsv(this.data));
    return destination;
  }

  async exportJson(destinationPath = `${this.path}.moods.json`): Promise<string> {
    await this.flush();
    if (this.loadError) throw this.loadError;
    const destination = safeVaultPath(destinationPath);
    if (destination === this.path) throw new Error('Export destination must differ from the metadata path');
    await this.writeJsonWithBackup(destination, serializeMoodJson(this.data));
    return destination;
  }

  /**
   * Restore from either a serialized payload or already-parsed metadata. The
   * parameter is `unknown` because the value is validated below; naming the
   * accepted shapes would not make the validation any safer.
   */
  async restoreFrom(raw: unknown): Promise<void> {
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
    const warnings: string[] = [];
    let backupAvailable = false;
    let primaryExists = false;
    let futureSchema = false;
    const pathsToCheck = new Set(Object.keys(this.data.entries));
    try {
      primaryExists = await this.adapter().exists(this.path);
      if (primaryExists) {
        const raw = JSON.parse(await this.adapter().read(this.path));
        const result = validateMoodMetadata(raw);
        invalidRecords.push(...result.invalidRecords);
        invalidOrphans.push(...result.invalidOrphans);
        invalidMetadata.push(...result.invalidMetadata);
        warnings.push(...result.warnings);
        futureSchema = result.futureSchema;
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
      readable: invalidMetadata.length === 0 || futureSchema,
      futureSchema,
      invalidRecords,
      invalidOrphans,
      invalidMetadata,
      missingFiles,
      backupAvailable,
      warnings,
    };
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async mutate(mutator: (data: MoodMetadata) => void | MoodMetadata, options: MoodMutateOptions = {}): Promise<void> {
    return this.enqueue(async (context) => {
      if (!this.loaded) await this.loadState(context);
      this.assertContext(context);
      if (this.loadError) throw this.loadError;
      if (this.readOnlyMode) throw this.readOnlyError();
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
      try {
        const raw = await this.readPrimary(context.path);
        this.assertContext(context);
        if (raw === null && this.primaryRaw !== null) throw new Error('Mood metadata conflict: primary file was removed');
        const parsed = raw === null ? emptyMetadata() : JSON.parse(raw);
        const validation = validateMoodMetadata(parsed);
        if (!validation.readable) throw new Error(`Invalid mood metadata: ${formatValidation(validation)}`);
        if (validation.futureSchema) {
          this.readOnlyMode = true;
          this.readOnlySchemaVersion = undefined;
          this.warnings = validation.warnings;
          throw this.readOnlyError();
        }
        const remote = normalizeMetadata(parsed);
        const next = mergeMetadata(base, local, remote, options);
        if (!sameValue(next, remote)) {
          const content = JSON.stringify(next, null, 2);
          await this.writeJsonWithBackup(context.path, content, () => this.verifyPrimary(context, raw));
          this.assertContext(context);
          this.primaryRaw = content;
        }
        this.data = next;
      } catch (error) {
        // A conflict leaves the merge base stale; refresh it so the next write can proceed.
        if (isConflictError(error) || error instanceof MoodMetadataReadOnlyError) await this.refreshFromDisk(context);
        throw error;
      }
    });
  }

  /** Re-read the disk snapshot without throwing, so conflict recovery cannot mask the original error. */
  private async refreshFromDisk(context: StoreContext): Promise<void> {
    try {
      this.assertContext(context);
      const raw = await this.readPrimary(context.path);
      this.assertContext(context);
      if (raw === null) return;
      const parsed = JSON.parse(raw);
      const validation = validateMoodMetadata(parsed);
      if (!validation.readable) return;
      const migration = migrateMoodMetadata(parsed);
      const next = validation.futureSchema
        ? migration.metadata
        : pruneStaleTombstones(migration.metadata, Date.now());
      const previous = this.data;
      this.readOnlyMode = validation.futureSchema;
      this.readOnlySchemaVersion = validation.futureSchema ? migration.fromVersion : undefined;
      this.warnings = Array.from(new Set([...validation.warnings, ...migration.warnings]));
      this.data = next;
      this.primaryRaw = raw;
      this.loaded = true;
      this.loadError = undefined;
      this.emitChanged(previous, next);
    } catch (error) {
      console.warn('[Dayline] Mood metadata conflict recovery could not refresh from disk:', error);
    }
  }

  private readOnlyError(): MoodMetadataReadOnlyError {
    return new MoodMetadataReadOnlyError(this.path, this.readOnlySchemaVersion);
  }

  private emitChanged(previous: MoodMetadata, next: MoodMetadata): void {
    const keys = new Set<string>([
      ...Object.keys(previous.entries ?? {}),
      ...Object.keys(next.entries ?? {}),
      ...Object.keys((previous as MoodMetadataWithTombstones).tombstones ?? {}),
      ...Object.keys((next as MoodMetadataWithTombstones).tombstones ?? {}),
    ]);
    for (const key of keys) {
      if (!sameValue(previous.entries?.[key], next.entries?.[key])) this.emit(key, next.entries?.[key]);
    }
  }

  private async saveCorruptCopy(context: StoreContext, raw: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const corruptPath = `${context.path}.corrupt-${stamp}`;
    try {
      await this.writeJson(corruptPath, raw);
    } catch (error) {
      console.warn(`[Dayline] Damaged mood metadata could not be preserved at ${corruptPath}:`, error);
    }
  }

  private vaultFileCtime(path: string): number | undefined {
    return fileCtimeOf(this.app.vault.getAbstractFileByPath(path));
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

  /**
   * Remove mood keys from a note. When the store owns the field (`force`) every
   * mood key is dropped; otherwise only a frontmatter mood matching the deleted
   * record is removed, which leaves user-authored values untouched.
   */
  private async removeMoodFromFrontmatter(path: string, record?: MoodRecord, force = false): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !this.app.fileManager?.processFrontMatter) return;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      if (!force) {
        const declared = parseMoodScore(frontmatter.mood);
        if (declared === undefined) return;
        if (record && declared !== parseMoodScore(record.score)) return;
      }
      for (const key of Object.keys(frontmatter)) {
        if (MOOD_FRONTMATTER_KEYS.has(key.toLowerCase())) delete frontmatter[key];
      }
    });
  }

  private async attemptMirror(path: string, operation: MoodMirrorFailure['operation'], record?: MoodRecord): Promise<boolean> {
    try {
      if (operation === 'write' && record) await this.mirrorToFrontmatter(path, record);
      else if (operation === 'delete') await this.removeMoodFromFrontmatter(path, record, this.mirrorMoodToFrontmatter);
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

  /**
   * Stage `content` in a `.tmp` sibling, keep the previous primary as the
   * `.bak` recovery point, then replace the primary in place. The primary path
   * therefore never goes missing: an earlier revision renamed the primary to
   * `.bak` before moving the temp file into place, which file sync engines
   * observed as a deletion and propagated to every other device. The in-place
   * commit trades that deletion window for a torn-write window, which the
   * corrupt-primary recovery path already handles.
   */
  private async writeJsonWithBackup(path: string, content: string, beforeCommit?: () => Promise<void>): Promise<void> {
    await this.ensureParent(path);
    const temp = `${path}.tmp`;
    const backup = `${path}.bak`;
    const adapter = this.adapter();
    try {
      await adapter.write(temp, content);
      await beforeCommit?.();
      if (await adapter.exists(path)) {
        if (await adapter.exists(backup)) await adapter.remove(backup);
        if (typeof adapter.copy === 'function') await adapter.copy(path, backup);
        else await adapter.write(backup, await adapter.read(path));
      }
      await adapter.write(path, content);
    } catch (error) {
      try {
        if (await adapter.exists(temp)) await adapter.remove(temp);
      } catch {
        // Preserve the original error if a temporary file cannot be cleaned up.
      }
      throw error;
    }
    try {
      if (await adapter.exists(temp)) await adapter.remove(temp);
    } catch {
      // A leftover temp file is ignored while the primary is valid; never fail the write for it.
    }
  }

  private async replaceMetadata(next: MoodMetadata, context: StoreContext): Promise<void> {
    if (this.readOnlyMode) throw this.readOnlyError();
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
