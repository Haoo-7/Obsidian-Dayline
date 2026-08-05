const DATE_FILENAME = /^(\d{4})-(\d{2})-(\d{2})\.md$/;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?=$|[ _-])/;

export interface DiaryDate {
  year: number;
  month: number;
  day: number;
  date: string;
}

export function parseDiaryDate(filename: string): DiaryDate | null {
  const match = DATE_FILENAME.exec(filename);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return null;

  return { year, month, day, date: `${match[1]}-${match[2]}-${match[3]}` };
}

export function parseDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?=$|T|[ _])/.exec(trimmed);
  if (!match) return null;
  const date = parseDiaryDate(`${match[1]}-${match[2]}-${match[3]}.md`);
  return date?.date ?? null;
}

export function parseDateFromFilename(filename: string): string | null {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const stem = basename.replace(/\.md$/i, '');
  const match = DATE_PREFIX.exec(stem);
  if (!match) return null;
  return parseDiaryDate(`${match[1]}-${match[2]}-${match[3]}.md`)?.date ?? null;
}

export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

export function isPathInFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizeVaultPath(path);
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder.length === 0 || normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

export function formatDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function formatDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatDateInTimeZone(date: Date, timezone = 'auto'): string {
  if (timezone && timezone !== 'auto') {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
    } catch (_) {
      // Invalid timezone settings fall back to the host local date.
    }
  }
  return formatDate(date);
}

export function getTodayDate(timezone = 'auto', now = new Date()): string {
  return formatDateInTimeZone(now, timezone);
}

export function getClockPartsInTimeZone(
  date: Date,
  timezone = 'auto',
): { hour: number; minute: number } {
  if (!timezone || timezone === 'auto') {
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return { hour: Number(values.hour), minute: Number(values.minute) };
  } catch (_) {
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
}

export function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

export function imageBasename(link: string): string {
  return link.split(/[\\/]/).pop()?.split('|', 1)[0] ?? '';
}

export function matchesDatePrefixedImage(link: string, date: string): boolean {
  const basename = imageBasename(link);
  return basename === date || new RegExp(`^${date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[ _-])`).test(basename);
}
