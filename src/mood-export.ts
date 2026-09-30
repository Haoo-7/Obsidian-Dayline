import type { MoodMetadata, MoodRecord } from './types';
import { saveDaylineExport } from './journal-export';
import { MOOD_LABELS } from './mood';

/** Version of the portable mood export contract (independent of store schema). */
export const MOOD_EXPORT_SCHEMA_VERSION = 1 as const;

/** Stable RFC-4180 column order. Empty optional values are exported as empty cells. */
export const MOOD_EXPORT_COLUMNS = [
  'sourcePath',
  'recordStatus',
  'score',
  'labels',
  'note',
  'recordedAt',
  'updatedAt',
  'orphanedAt',
  'storeSchemaVersion',
] as const;

export type MoodExportColumn = typeof MOOD_EXPORT_COLUMNS[number];

export interface MoodExportRow {
  sourcePath: string;
  recordStatus: 'active' | 'orphan';
  score: MoodRecord['score'];
  labels: string[];
  note: string | null;
  recordedAt: string;
  updatedAt: string;
  orphanedAt: string | null;
  storeSchemaVersion: number;
}

function sortedLabels(labels: unknown): string[] {
  return Array.from(new Set(Array.isArray(labels) ? labels.map(String).map((value) => value.trim()).filter(Boolean) : []));
}

function rowsForMetadata(metadata: MoodMetadata): MoodExportRow[] {
  const rows: MoodExportRow[] = [];
  for (const path of Object.keys(metadata.entries || {}).sort((a, b) => a.localeCompare(b))) {
    const record = metadata.entries[path];
    rows.push({
      sourcePath: path,
      recordStatus: 'active',
      score: record.score,
      labels: sortedLabels(record.labels),
      note: record.note === undefined || record.note === null ? null : String(record.note),
      recordedAt: record.recordedAt,
      updatedAt: record.updatedAt,
      orphanedAt: null,
      storeSchemaVersion: Number(metadata.schemaVersion || 1),
    });
  }
  for (const path of Object.keys(metadata.orphans || {}).sort((a, b) => a.localeCompare(b))) {
    const orphan = metadata.orphans?.[path];
    if (!orphan) continue;
    const record = orphan.record;
    rows.push({
      sourcePath: path,
      recordStatus: 'orphan',
      score: record.score,
      labels: sortedLabels(record.labels),
      note: record.note === undefined || record.note === null ? null : String(record.note),
      recordedAt: record.recordedAt,
      updatedAt: record.updatedAt,
      orphanedAt: orphan.orphanedAt || null,
      storeSchemaVersion: Number(metadata.schemaVersion || 1),
    });
  }
  return rows.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.recordStatus.localeCompare(b.recordStatus));
}

export function moodExportRows(metadata: MoodMetadata): MoodExportRow[] {
  return rowsForMetadata(metadata);
}

/** Columns whose cells are free-form strings and must be guarded against spreadsheet formulas. */
export const MOOD_EXPORT_FORMULA_GUARDED_COLUMNS: readonly MoodExportColumn[] = ['sourcePath', 'labels', 'note'];

/** UTF-8 BOM so Excel decodes non-ASCII labels and notes instead of mojibaking them. */
export const MOOD_EXPORT_BOM = '\uFEFF';

/**
 * Spreadsheet apps treat a leading `=`, `+`, `-`, `@`, TAB, or CR as a formula,
 * even inside a quoted CSV field. A leading apostrophe is the conventional
 * neutralizer. `-2` in the numeric score column is legitimate, so the guard is
 * opt-in per cell and is never enabled for `score`.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/u;

export interface MoodCsvCellOptions {
  /** Prefix `'` when the text could be evaluated as a spreadsheet formula. */
  guardFormula?: boolean;
}

export function escapeMoodCsvCell(value: unknown, options: MoodCsvCellOptions = {}): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (options.guardFormula && FORMULA_LEAD.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/**
 * Labels share one CSV column joined by `; `, so a label that itself contains
 * the separator would be indistinguishable from two labels. Percent-encoding
 * the semicolon (and `%` itself) keeps the column unambiguous without dropping
 * label text.
 */
export function escapeMoodLabelsCell(labels: string[]): string {
  return labels
    .map((label) => String(label).replace(/%/gu, '%25').replace(/;/gu, '%3B'))
    .join('; ');
}

function valueForColumn(row: MoodExportRow, column: MoodExportColumn): string | number {
  switch (column) {
    case 'sourcePath': return row.sourcePath;
    case 'recordStatus': return row.recordStatus;
    case 'score': return row.score;
    case 'labels': return escapeMoodLabelsCell(row.labels);
    case 'note': return row.note ?? '';
    case 'recordedAt': return row.recordedAt;
    case 'updatedAt': return row.updatedAt;
    case 'orphanedAt': return row.orphanedAt ?? '';
    case 'storeSchemaVersion': return row.storeSchemaVersion;
  }
}

function escapeColumnCell(row: MoodExportRow, column: MoodExportColumn): string {
  return escapeMoodCsvCell(valueForColumn(row, column), {
    guardFormula: MOOD_EXPORT_FORMULA_GUARDED_COLUMNS.includes(column),
  });
}

/** Deterministic UTF-8 BOM-prefixed CSV with CRLF rows and semicolon-separated label values. */
export function serializeMoodCsv(metadata: MoodMetadata): string {
  const rows = [MOOD_EXPORT_COLUMNS.map((column) => escapeMoodCsvCell(column)).join(',')];
  for (const row of rowsForMetadata(metadata)) {
    rows.push(MOOD_EXPORT_COLUMNS.map((column) => escapeColumnCell(row, column)).join(','));
  }
  return `${MOOD_EXPORT_BOM}${rows.join('\r\n')}\r\n`;
}

export interface MoodJsonExport {
  exportSchemaVersion: typeof MOOD_EXPORT_SCHEMA_VERSION;
  storeSchemaVersion: number;
  customLabels: string[];
  records: MoodExportRow[];
}

/** Stable, versioned JSON export. Record ordering is source path then status. */
export function moodExportObject(metadata: MoodMetadata): MoodJsonExport {
  const builtInIds = new Set(MOOD_LABELS.map((item) => item.id));
  return {
    exportSchemaVersion: MOOD_EXPORT_SCHEMA_VERSION,
    storeSchemaVersion: Number(metadata.schemaVersion || 1),
    customLabels: Array.from(new Set((metadata.customLabels || []).map(String).map((value) => value.trim()).filter((value) => value && !builtInIds.has(value)))).sort((a, b) => a.localeCompare(b)),
    records: rowsForMetadata(metadata),
  };
}

export function serializeMoodJson(metadata: MoodMetadata): string {
  return `${JSON.stringify(moodExportObject(metadata), null, 2)}\n`;
}

/** Save using the shared collision-safe `Dayline Exports/` behavior. */
export async function saveMoodExport(app: any, content: string, fileName: string): Promise<string> {
  return saveDaylineExport(app, content, fileName);
}
