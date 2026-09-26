import type { ExifField } from './types';

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
