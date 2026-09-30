import type { JournalEntry } from './types';

/** Normalize user-visible journal text once so filtering can use simple substring checks. */
export function normalizeJournalText(value: unknown): string {
  if (value === undefined || value === null) return '';
  let text = String(value);
  try {
    text = text.normalize('NFKC');
  } catch {
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

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const FENCED_BLOCK = /^\s*(```|~~~)[\s\S]*?^\s*\1\s*$/gm;

/** Raw text a fallback tag scan may trust: no frontmatter, no code blocks. */
function tagScanText(body: string): string {
  return body.replace(FRONTMATTER, ' ').replace(FENCED_BLOCK, ' ');
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
  // Obsidian's metadata cache already ignores code blocks, quoted color
  // literals, and numeric references, so prefer it whenever it has any entries
  // and never re-scan the raw body on top of it.
  const cachedTags = Array.isArray(metadataTags) ? metadataTags : [];
  if (cachedTags.length > 0) {
    for (const item of cachedTags) {
      if (typeof item === 'string') addTag(result, seen, item);
      else addTag(result, seen, (item as Record<string, unknown>)?.tag);
    }
    return result;
  }

  // Fallback: read a cleaned body, exclude quotes as both boundary and value
  // characters, and require a non-digit so `Issue #123` is not a tag.
  const tagPattern = /(^|[\s([{])#([^\s#.,!?;:)\]}"']+)/gu;
  for (const match of tagScanText(body).matchAll(tagPattern)) {
    if (!/[^\d]/u.test(match[2])) continue;
    addTag(result, seen, match[2]);
  }
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
