import type { JournalEntry } from './types';

/** Normalize user-visible journal text once so filtering can use simple substring checks. */
export function normalizeJournalText(value: unknown): string {
  if (value === undefined || value === null) return '';
  let text = String(value);
  try {
    text = text.normalize('NFKC');
  } catch (_) {
    // Older embedded runtimes may not expose Unicode normalization.
  }
  return text.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

function valuesFromTag(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(valuesFromTag);
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return ['tag', 'name', 'value'].flatMap((key) => valuesFromTag(record[key]));
}

function normalizeTag(value: unknown): string {
  let tag = normalizeJournalText(value).replace(/^#+/u, '').trim();
  return tag;
}

function addTag(result: string[], seen: Set<string>, value: unknown): void {
  // YAML commonly stores tags as a comma-separated string. Split only the
  // delimiters used by frontmatter; spaces remain part of a tag value.
  const values = typeof value === 'string' ? value.split(/[,;\n]/u) : [value];
  for (const item of values) {
    const tag = normalizeTag(item);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
}

/** Parse YAML frontmatter tags and Obsidian's metadata-cache tag records. */
export function parseJournalTags(
  frontmatter: Record<string, unknown> = {},
  body = '',
  metadataTags: unknown[] = [],
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!/^tags?$/iu.test(key)) continue;
    for (const item of valuesFromTag(value)) addTag(result, seen, item);
  }
  for (const item of metadataTags) {
    if (typeof item === 'string') addTag(result, seen, item);
    else addTag(result, seen, (item as Record<string, unknown>)?.tag);
  }

  // Require a non-whitespace character after # so Markdown headings are not
  // interpreted as tags. Punctuation delimiters are excluded from the value.
  const tagPattern = /(^|[\s([{"'])#([^\s#.,!?;:)\]}]+)/gu;
  for (const match of body.matchAll(tagPattern)) addTag(result, seen, match[2]);
  return result;
}

function primitiveSearchValues(value: unknown, result: string[], depth = 0): void {
  if (depth > 3 || value === undefined || value === null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    result.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) primitiveSearchValues(item, result, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      primitiveSearchValues(item, result, depth + 1);
    }
  }
}

export interface JournalSearchFields {
  path?: string;
  title?: string;
  excerpt?: string;
  body?: string;
  sourceId?: string;
  sourcePath?: string;
  sourceType?: string;
  sourceLabel?: string;
  location?: JournalEntry['location'];
  tags?: string[];
  activity?: unknown;
  weather?: unknown;
  uuid?: string;
  frontmatter?: Record<string, unknown>;
}

/** Build a deterministic normalized search index for a journal entry. */
export function buildJournalSearchText(fields: JournalSearchFields): string {
  const values: string[] = [];
  values.push(
    fields.path || '',
    fields.title || '',
    fields.excerpt || '',
    fields.body || '',
    fields.sourceId || '',
    fields.sourcePath || '',
    fields.sourceType || '',
    fields.sourceLabel || '',
    fields.location?.name || '',
    fields.location?.latitude === undefined ? '' : String(fields.location.latitude),
    fields.location?.longitude === undefined ? '' : String(fields.location.longitude),
    ...(fields.tags || []),
    fields.uuid || '',
  );
  primitiveSearchValues(fields.activity, values);
  primitiveSearchValues(fields.weather, values);
  primitiveSearchValues(fields.frontmatter, values);

  const seen = new Set<string>();
  return values
    .map(normalizeJournalText)
    .filter((value) => value && !seen.has(value) && seen.add(value))
    .join(' ');
}

export function normalizeJournalTag(value: unknown): string {
  return normalizeTag(value);
}
