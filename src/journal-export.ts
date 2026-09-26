/** A character that cannot appear in a filename: reserved, or a C0 control. */
const UNSAFE_FILENAME_CHAR = /[\\/:*?"<>|]/u;

function sanitizeFileName(name: string, extension: string): string {
  const base = Array.from(name.replace(/\.[a-z0-9]+$/iu, ''))
    // C0 controls (U+0000–U+001F) are stripped by code point rather than by a
    // regex range, so the pattern carries no literal control character, which
    // `no-control-regex` rejects at review time. The bound is inclusive of
    // U+001F only, matching the previous `\u0000-\u001f` range exactly.
    .map((char) => (UNSAFE_FILENAME_CHAR.test(char) || char.codePointAt(0)! <= 0x1f ? '-' : char))
    .join('')
    .trim() || 'journal-export';
  return `${base}.${extension}`;
}

/** Save a Dayline export into a vault folder using Obsidian's adapter APIs. */
export async function saveDaylineExport(app: any, content: string, fileName: string): Promise<string> {
  const safeName = sanitizeFileName(fileName, fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'json');
  const folder = 'Dayline Exports';
  const folderPath = app.vault.getAbstractFileByPath?.(folder);
  if (!folderPath && app.vault.createFolder) {
    try { await app.vault.createFolder(folder); } catch { /* another export may have created it */ }
  }
  let candidate = `${folder}/${safeName}`;
  const exists = (path: string) => Boolean(app.vault.getAbstractFileByPath?.(path));
  let suffix = 2;
  while (exists(candidate)) {
    const dot = safeName.lastIndexOf('.');
    candidate = `${folder}/${safeName.slice(0, dot)}-${suffix++}${safeName.slice(dot)}`;
  }
  if (app.vault.create) {
    await app.vault.create(candidate, content);
  } else if (app.vault.adapter?.write) {
    await app.vault.adapter.write(candidate, content);
  } else {
    throw new Error('Obsidian vault write API is unavailable');
  }
  return candidate;
}
