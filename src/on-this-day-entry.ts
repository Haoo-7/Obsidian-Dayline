export const ON_THIS_DAY_ENTRY_MODES = ['off', 'merged', 'header'] as const;
export type OnThisDayEntryMode = (typeof ON_THIS_DAY_ENTRY_MODES)[number];

export interface OnThisDayEntrySettings {
  onThisDayEntry?: unknown;
  onThisDayButton?: unknown;
}

export interface OnThisDayPreviewEntry {
  year: number;
  images?: string[];
  excerpt?: string | null;
  dateStr?: string;
  path?: string;
}

export interface OnThisDayPreview {
  year: number;
  image: string | null;
  imageNotePath?: string;
  imageDateStr?: string;
  excerpt: string | null;
  count: number;
}

export interface OnThisDayStripModel {
  title: string;
  meta: string;
  ariaLabel: string;
  dateStr?: string;
}

/** Prefer an explicit entry mode; older boolean settings map onto off/merged. */
export function normalizeOnThisDayEntryMode(settings: OnThisDayEntrySettings = {}): OnThisDayEntryMode {
  const raw = settings.onThisDayEntry;
  if (raw === 'off' || raw === 'merged' || raw === 'header') return raw;
  if (settings.onThisDayButton === false) return 'off';
  return 'merged';
}

export function shouldShowMergedOnThisDayEntry(settings: OnThisDayEntrySettings = {}): boolean {
  return normalizeOnThisDayEntryMode(settings) === 'merged';
}

export function shouldShowHeaderOnThisDayEntry(settings: OnThisDayEntrySettings = {}): boolean {
  return normalizeOnThisDayEntryMode(settings) === 'header';
}

export function onThisDayEntryDate(activeDate: string | null | undefined, today: string): string {
  return activeDate || today;
}

export function parseOnThisDayMonthDay(dateStr: string | null | undefined): { month: number; day: number } | null {
  const parts = String(dateStr || '').split('-').map(Number);
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return null;
  return { month, day };
}

/** Keep the selected diary date when the calendar pane itself becomes focused. */
export function shouldPreserveCalendarSelection(activeView: unknown, calendarView: unknown): boolean {
  return Boolean(calendarView) && activeView === calendarView;
}

/** Most recent past-year entry, preferring a photo from any year on that date. */
export function pickOnThisDayPreview(entries: OnThisDayPreviewEntry[] = []): OnThisDayPreview | null {
  if (!entries.length) return null;
  const latest = entries[0];
  const withImage = entries.find((entry) => (entry.images || []).length > 0);
  return {
    year: latest.year,
    image: withImage?.images?.[0] || null,
    imageNotePath: withImage?.path,
    imageDateStr: withImage?.dateStr,
    excerpt: latest.excerpt || null,
    count: entries.length,
  };
}

export function onThisDayStripMeta(yearsAgoLabel: string, dateLabel: string): string {
  return `${yearsAgoLabel} · ${dateLabel}`;
}

/**
 * Years between a memory and today.
 *
 * Every On This Day surface measures "how long ago" against **today**, because
 * that is the same basis `OnThisDayProvider.getEntries` uses to decide which
 * years count as past. Measuring against the date being browsed instead made
 * the merged strip label a memory as `0年前` whenever the calendar's active date
 * sat in a past year: the memory for that same year was offered back as a
 * "previous year" while its note was the one already on screen.
 *
 * A non-positive delta is only reachable through a clock or timezone edge
 * between the entry fetch and the render, so it clamps to 1 rather than
 * printing "0年前".
 */
export function onThisDayYearsAgo(memoryYear: number, todayYear: number): number {
  const delta = Number(todayYear) - Number(memoryYear);
  return Number.isFinite(delta) && delta > 0 ? Math.trunc(delta) : 1;
}

export function clearOnThisDayStrip(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('.cal-otd-strip'))) el.remove();
  for (const el of Array.from(root.querySelectorAll('.cal-weather-card.cal-otd-standalone'))) el.remove();
  for (const el of Array.from(root.querySelectorAll('.cal-weather-card.has-otd'))) {
    el.classList.remove('has-otd');
  }
}

function asHtmlElement(node: Element | null | undefined): HTMLElement | null {
  return node && node.nodeType === 1 ? node as HTMLElement : null;
}

export function resolveWeatherOnThisDayHost(container: HTMLElement): HTMLElement | null {
  return asHtmlElement(container.querySelector('.cal-weather-card:not(.cal-otd-standalone)'));
}

export function createStandaloneOnThisDayHost(container: HTMLElement): HTMLElement {
  const existing = asHtmlElement(container.querySelector('.cal-weather-card.cal-otd-standalone'));
  if (existing) return existing;

  // Create through the container so the node belongs to the same document, then
  // position it below; `createDiv` appends, and the branch below may move it.
  const card = container.createDiv({ cls: 'cal-weather-card cal-otd-standalone' });
  const setup = container.querySelector('.cal-weather-setup');
  const weekdays = container.querySelector('.cal-weekdays');
  if (setup?.parentElement === container) setup.insertAdjacentElement('afterend', card);
  else if (weekdays?.parentElement === container) container.insertBefore(card, weekdays);
  else container.append(card);
  return card;
}

export function mountOnThisDayStrip(host: HTMLElement, model: OnThisDayStripModel): HTMLButtonElement {
  host.classList.add('has-otd');
  host.querySelector('.cal-otd-strip')?.remove();

  const strip = host.createEl('button', { cls: 'cal-otd-strip' });
  strip.type = 'button';
  strip.setAttribute('aria-label', model.ariaLabel);
  if (model.dateStr) strip.dataset.otdDate = model.dateStr;

  strip.createSpan({ cls: 'cal-otd-strip-photo', attr: { 'aria-hidden': 'true' } });

  const text = strip.createSpan({ cls: 'cal-otd-strip-text' });
  text.createSpan({ cls: 'cal-otd-strip-title', text: model.title });
  text.createSpan({ cls: 'cal-otd-strip-meta', text: model.meta });

  strip.createSpan({ cls: 'cal-otd-strip-chevron', attr: { 'aria-hidden': 'true' } });
  return strip;
}
