const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const FENCED_BLOCK = /^\s*(```|~~~)[\s\S]*?^\s*\1\s*$/gm;
const GENERIC_TITLES = new Set(['daily note', 'daily', 'journal entry', 'entry', 'untitled', 'freewrite']);

function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER, '');
}

function freewriteSection(content: string): string {
  const match = /(?:^|\n)#{1,6}\s*[^\n]*\bfreewrite\b[^\n]*(?:\n|$)([\s\S]*?)(?=\n#{1,6}\s+|$)/i.exec(content);
  return match ? match[1] : content;
}

function cleanMarkdown(content: string): string {
  let text = stripFrontmatter(content).replace(FENCED_BLOCK, ' ');
  text = freewriteSection(text);
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/<div[^>]*class=["'][^"']*(?:dataview|metadata|callout)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/^\s*(?:dataviewjs?|dv\.|INPUT\[|VIEW\[|BUTTON\[).*$/gim, ' ')
    .replace(/^\s*[-*+]\s+\[[ xX]\].*$/gm, ' ')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/^\s*#{0,6}\s*[<❮].*\d{4}-\d{2}-\d{2}.*[>❯].*$/gm, ' ')
    .replace(/^\s*#{1,6}\s*.*\b\d{4}\s*\/\s*Q[1-4]\b.*$/gim, ' ')
    .replace(/^\s*#{1,6}\s*(?:dataview|meta\s*bind|tasks?|habits?|tips?|relevant\s+project)\b.*$/gim, ' ')
    .replace(/^\s*(?:#[-\w\\]+\s*){2,}$/gm, ' ')
    .replace(/^\s*#{1,6}\s*(?:daily note|journal entry|freewrite)\s*$/gim, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || target)
    .replace(/`[^`]*`/g, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*\[![^\]]+\][-+]?\s*/gim, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~]+/g, '')
    .replace(/^\s*https?:\/\/\S+\s*$/gm, ' ');
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph && !/^\d{4}-\d{2}-\d{2}$/.test(paragraph))
    .join(' ')
    .trim();
}

export function extractExcerpt(content: string, maxLength = 160): string | null {
  const text = cleanMarkdown(content);
  if (!text) return null;
  // Slice by code point so a truncation never splits an emoji surrogate pair.
  const characters = Array.from(text);
  if (characters.length <= maxLength) return text;
  return `${characters.slice(0, maxLength).join('').trimEnd()}...`;
}

export function isGenericJournalTitle(title: string, date?: string): boolean {
  const normalized = title.trim().replace(/\s+/g, ' ').toLowerCase();
  return GENERIC_TITLES.has(normalized) || Boolean(date && normalized === date.toLowerCase());
}

export function renderExcerptTemplate(
  template: string,
  date: string,
  year: number,
  frontmatter: Record<string, unknown>,
  body: string | null,
): string | null {
  const values = new Map<string, string>([
    ['year', String(year)],
    ['date', date],
    ['body', body || ''],
  ]);
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    values.set(key, String(value));
  }
  // A single callback pass keeps `$&`/`$$` in the body literal and guarantees
  // that placeholders inside the substituted body are never expanded again.
  const result = template.replace(/\{([^{}]*)\}/g, (match, key: string) => {
    const value = values.get(key);
    return value === undefined ? match : value;
  });
  return result.trim() || null;
}
