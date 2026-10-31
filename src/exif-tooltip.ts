import type { ExifField } from './types';

const EXIF_DATE_TIME = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Format an EXIF `DateTimeOriginal` (`2026:08:18 23:12:54`, no zone) as a local
 * date and time in the interface language. The camera wrote wall-clock time, so
 * it is read and printed in local time without any zone shift. Anything that is
 * not in the EXIF shape is returned unchanged.
 */
export function formatExifDateTime(value: unknown, locale: string): string {
  if (value instanceof Date) return formatLocalDateTime(value, locale, '');
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const raw = String(value);
  const match = EXIF_DATE_TIME.exec(raw.trim());
  if (!match) return raw;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getMonth() !== month - 1) return raw;
  return formatLocalDateTime(date, locale, raw);
}

function formatLocalDateTime(date: Date, locale: string, fallback: string): string {
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  } catch {
    return fallback;
  }
}

export interface TooltipText {
  loading: string;
  noData: string;
  noDataDescription: string;
  label: (key: string) => string;
}

export function renderExifTooltip(
  target: HTMLElement,
  fields: ExifField[] | null,
  text: TooltipText,
): void {
  target.replaceChildren();

  if (!fields || fields.length === 0) {
    const empty = target.createDiv({ cls: 'cal-exif-tooltip-empty' });
    empty.createDiv({ text: text.noData });
    empty.createDiv({ cls: 'cal-exif-tooltip-description', text: text.noDataDescription });
    return;
  }

  for (const field of fields) {
    const row = target.createDiv({ cls: 'cal-exif-tooltip-row' });
    row.createSpan({ cls: 'cal-exif-tooltip-label', text: text.label(field.key) });
    row.createSpan({ cls: 'cal-exif-tooltip-value', text: String(field.value ?? '') });
  }
}
