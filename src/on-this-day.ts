// @ts-nocheck
import { Notice, setIcon, TFile } from 'obsidian';
import { getTodayDate } from './date-utils';
import { extractExcerpt, isGenericJournalTitle, renderExcerptTemplate } from './excerpt';
import { onThisDayYearsAgo } from './on-this-day-entry';
import { localize as _l } from './locale';
import { t } from './i18n';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'avif', 'tiff', 'tif', 'bmp'];
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]+\S/;

function isImageLink(link: unknown): boolean {
  const clean = String(link || '').split('|', 1)[0].split('?', 1)[0];
  return IMAGE_EXTENSIONS.includes(clean.split('.').pop()?.toLowerCase() || '');
}

function daylineDate(settings: { weatherTimezone?: string }, date = new Date()): string {
  return getTodayDate(settings?.weatherTimezone || 'auto', date);
}

function headingTextOf(line: string): string {
  return line.replace(/^[ \t]*#{1,6}[ \t]+/, '').replace(/[ \t]+$/, '').trim();
}

/**
 * Separate a diary's title from the text that belongs in the card body.
 *
 * The journal index already promotes a frontmatter `title` or the note's first
 * `# Heading` to `entry.title`, but that same heading line stayed inside the
 * body. The card therefore rendered "Low Tide Last Year / 去年低潮线 Same
 * calendar date, previous year…" as one paragraph, with no seam between the
 * title and the body — the title read as the body's first sentence.
 *
 * `titleFromContent` treats a leading heading as the note's title, so the body
 * drops it; a heading matching the resolved title is dropped too, so a title
 * that only lives in the body cannot reappear there. Anything else is left
 * alone, which keeps section headings that sit after the opening paragraph.
 *
 * A date-only or placeholder title (`2025-07-18`, `Daily note`) carries no
 * information for a memory card, so it resolves to `null` and the card renders
 * its body without a title row.
 */
export function splitTitleFromBody(
  content: unknown,
  indexTitle: unknown,
  date: unknown,
): { title: string | null; body: string } {
  const lines = (typeof content === 'string' ? content : '').split('\n');
  const headingIndex = lines.findIndex((line) => HEADING_LINE.test(line));
  const headingText = headingIndex === -1 ? '' : headingTextOf(lines[headingIndex]);
  const headingLeads = headingIndex !== -1 && lines.slice(0, headingIndex).every((line) => line.trim() === '');

  const candidate = (typeof indexTitle === 'string' ? indexTitle.trim() : '') || headingText;
  const title = candidate && !isGenericJournalTitle(candidate, typeof date === 'string' ? date : '')
    ? candidate
    : null;

  const dropHeading = headingIndex !== -1 && (headingLeads || (title !== null && headingText === title));
  const body = dropHeading
    ? lines.filter((_line, index) => index !== headingIndex).join('\n')
    : lines.join('\n');

  return { title, body };
}

export class OnThisDayProvider {
  private readonly plugin: any;
  private dateIndex: Set<string> | null = null;
  private dateIndexYear: number | null = null;
  private readonly entryCache = new Map<string, any[]>();

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  private currentYear(): number {
    return Number(daylineDate(this.plugin.settings).slice(0, 4));
  }

  /** Build a set of all MM-DD values that have indexed journal entries. */
  async ensureDateIndex(): Promise<void> {
    const thisYear = this.currentYear();
    if (this.dateIndex && this.dateIndexYear === thisYear) return;
    if (this.dateIndexYear !== null && this.dateIndexYear !== thisYear) this.entryCache.clear();
    const index = new Set<string>();
    for (const entry of this.plugin.journalIndex?.getEntries?.() || []) {
      const year = Number(entry.date.slice(0, 4));
      if (Number.isFinite(year) && year < thisYear) index.add(entry.date.slice(5));
    }
    this.dateIndex = index;
    this.dateIndexYear = thisYear;
  }

  /** Quick check: does any year have a diary for this MM-DD? */
  async hasEntries(month: number, day: number): Promise<boolean> {
    await this.ensureDateIndex();
    const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return this.dateIndex?.has(key) ?? false;
  }

  /** Full entries for a given MM-DD (images + excerpts). */
  async getEntries(month: number, day: number): Promise<any[]> {
    await this.ensureDateIndex();
    const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (this.entryCache.has(key)) return this.entryCache.get(key) || [];

    const entries: any[] = [];
    const thisYear = this.currentYear();

    for (const entry of this.plugin.journalIndex?.getEntries?.() || []) {
      const year = Number(entry.date.slice(0, 4));
      if (!Number.isFinite(year) || year >= thisYear || entry.date.slice(5) !== key) continue;

      const images = (entry.attachments || []).filter(isImageLink);
      // Raw Markdown is what the excerpt and the title split need; older index
      // shapes only carry the pre-cleaned `excerpt`.
      const { title, body } = splitTitleFromBody(entry.searchText ?? entry.excerpt ?? '', entry.title, entry.date);

      let excerpt: string | null = null;
      const mode = this.plugin.settings.onThisDayExcerptMode;
      if (mode === 'frontmatter') {
        const fmKey = this.plugin.settings.onThisDayExcerptKey || 'excerpt';
        const frontmatter = entry.frontmatter || {};
        if (frontmatter && frontmatter[fmKey]) excerpt = String(frontmatter[fmKey]).trim();
      } else if (mode === 'template') {
        const template = this.plugin.settings.onThisDayExcerptTemplate || '{body}';
        excerpt = renderExcerptTemplate(
          template,
          entry.date,
          year,
          entry.frontmatter || {},
          extractExcerpt(body),
        );
      } else if (mode !== 'none') {
        excerpt = extractExcerpt(body);
      }

      entries.push({ year, dateStr: entry.date, path: entry.path, title, images, excerpt });
    }

    entries.sort((a, b) => b.year - a.year);
    if (entries.length > 0) this.entryCache.set(key, entries);
    return entries;
  }

  /** Invalidate one MM-DD cache entry, or all entries when omitted. */
  invalidate(mmdd?: string): void {
    if (mmdd) {
      this.entryCache.delete(mmdd);
      return;
    }
    this.entryCache.clear();
    this.dateIndex = null;
    this.dateIndexYear = null;
  }

  /** Refresh one MM-DD marker without rebuilding the complete date index. */
  refreshDateIndexFor(mmdd: string): void {
    this.entryCache.delete(mmdd);
    if (!this.dateIndex) return;
    const thisYear = this.currentYear();
    const hasHistoricalEntry = (this.plugin.journalIndex?.getEntries?.() || []).some((entry: any) => (
      entry.date.slice(5) === mmdd && Number(entry.date.slice(0, 4)) < thisYear
    ));
    if (hasHistoricalEntry) this.dateIndex.add(mmdd);
    else this.dateIndex.delete(mmdd);
  }

  get dateIndexSnapshot(): Set<string> | null {
    return this.dateIndex;
  }
}
/* ============================================================
   On This Day Modal
   ============================================================ */

export class OnThisDayModal {
  constructor(app, plugin, provider, month, day, entries) {
    this.app = app;
    this.plugin = plugin;
    this.provider = provider;
    this.month = month;
    this.day = day;
    this.entries = entries || [];
    this._requestToken = 0;
    this._closed = false;
    this._onKey = this._onKeyDown.bind(this);
  }

  open() {
    const lang = this.plugin.settings.weatherLanguage;

    // Backdrop
    this.backdrop = createDiv();
    this.backdrop.className = 'cal-otd-modal';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    // Panel
    const panel = createDiv();
    panel.className = 'cal-otd-panel';
    this.panel = panel;

    // --- Header: title + date nav + close ---
    const header = panel.createDiv({ cls: 'cal-otd-header' });
    header.createDiv({ cls: 'cal-otd-header-title', text: _l(lang, 'otd_title') });

    const nav = header.createDiv({ cls: 'cal-otd-date-nav' });
    const prevDayBtn = nav.createEl('button', {
      cls: 'cal-otd-nav-btn',
      attr: { type: 'button', 'aria-label': _l(lang, 'otd_prevDay'), title: _l(lang, 'otd_prevDay') },
    });
    setIcon(prevDayBtn, 'chevron-left');
    prevDayBtn.addEventListener('click', (e) => { e.stopPropagation(); void this._navigateDate(-1); });

    const dateInput = nav.createEl('input', {
      type: 'date',
      cls: 'cal-otd-date-input',
      attr: { 'aria-label': _l(lang, 'otd_datePicker') },
    });
    this.dateInput = dateInput;
    this._updateDateInput();
    dateInput.addEventListener('change', () => {
      const parts = dateInput.value.split('-');
      if (parts.length === 3) {
        this.month = parseInt(parts[1], 10);
        this.day = parseInt(parts[2], 10);
        void this._navigateDate(0); // refetch current date
      }
    });

    const nextDayBtn = nav.createEl('button', {
      cls: 'cal-otd-nav-btn',
      attr: { type: 'button', 'aria-label': _l(lang, 'otd_nextDay'), title: _l(lang, 'otd_nextDay') },
    });
    setIcon(nextDayBtn, 'chevron-right');
    nextDayBtn.addEventListener('click', (e) => { e.stopPropagation(); void this._navigateDate(1); });

    const closeBtn = header.createEl('button', {
      cls: 'cal-otd-close',
      attr: { type: 'button', 'aria-label': _l(lang, 'otd_close'), title: _l(lang, 'otd_close') },
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.close());

    // --- Grid body ---
    this.bodyEl = panel.createDiv({ cls: 'cal-otd-grid' });

    if (this.entries.length === 0) {
      this._renderMessage(_l(lang, 'otd_noMemories'), 'history');
    } else {
      this._renderGrid();
    }

    this.backdrop.appendChild(panel);
    document.body.appendChild(this.backdrop);
    document.addEventListener('keydown', this._onKey);
  }

  /**
   * One layout for the empty, loading and error states. They used to be a bare
   * centred sentence, which read as a rendering failure; an icon plus the
   * message makes the state look deliberate. Text is passed in already
   * localized because the empty state comes from the LOCALE table while the
   * error comes from the `t()` catalogue.
   */
  _renderMessage(message, icon, detail) {
    this.bodyEl.empty();
    const state = this.bodyEl.createDiv({ cls: 'cal-otd-empty-state' });
    if (icon) {
      const iconEl = state.createDiv({ cls: 'cal-otd-empty-icon', attr: { 'aria-hidden': 'true' } });
      setIcon(iconEl, icon);
    }
    state.createDiv({ cls: 'cal-otd-empty-title', text: message });
    if (detail) state.createDiv({ cls: 'cal-otd-empty-detail', text: detail });
    return state;
  }

  close() {
    this._closed = true;
    this._requestToken++;
    document.removeEventListener('keydown', this._onKey);
    if (this.backdrop && this.backdrop.parentElement) {
      this.backdrop.parentElement.removeChild(this.backdrop);
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') { this.close(); }
    else if (e.key === 'ArrowLeft') { void this._navigateDate(-1); }
    else if (e.key === 'ArrowRight') { void this._navigateDate(1); }
  }

  async _navigateDate(delta) {
    if (!this.provider) return;

    // Compute new date
    // Use a leap year so Feb 29 remains a valid month/day in the navigator.
    const d = new Date(2000, this.month - 1, this.day + delta);
    this.month = d.getMonth() + 1;
    this.day = d.getDate();

    // Update the visible date label
    this._updateDateInput();

    // Show loading
    this._renderMessage(_l(this.plugin.settings.weatherLanguage, 'loading'));

    // Fetch
    const requestToken = ++this._requestToken;
    try {
      this.entries = await this.provider.getEntries(this.month, this.day);
      if (this._closed || requestToken !== this._requestToken) return;
      if (this.entries.length === 0) {
        this._renderMessage(_l(this.plugin.settings.weatherLanguage, 'otd_noMemories'), 'history');
      } else {
        this._renderGrid();
      }
    } catch (e) {
      if (this._closed || requestToken !== this._requestToken) return;
      this._renderMessage(
        t(this.plugin.settings, 'onThisDayLoadFailed', { error: e?.message || e }),
        'alert-triangle',
      );
    }
  }

  _updateDateInput() {
    if (!this.dateInput) return;
    const currentYear = Number(daylineDate(this.plugin.settings).slice(0, 4));
    const year = this.month === 2 && this.day === 29 ? 2000 : currentYear;
    this.dateInput.value = `${year}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`;
  }

  _renderGrid() {
    this.bodyEl.empty();
    const lang = this.plugin.settings.weatherLanguage;
    const currentYear = Number(daylineDate(this.plugin.settings).slice(0, 4));
    const openLabel = _l(lang, 'otd_openNote');

    for (const entry of this.entries) {
      const images = entry.images || [];
      const yearsAgo = onThisDayYearsAgo(entry.year, currentYear);
      const metaText = `${_l(lang, 'otd_yearsAgo', yearsAgo)}  ·  ${entry.year}`;

      const card = this.bodyEl.createDiv({ cls: 'cal-otd-wall-card' });
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('title', openLabel);
      card.setAttribute('aria-label', [metaText, entry.title, openLabel].filter(Boolean).join(' · '));

      // Meta row: how long ago, which year, and how many photos are inside.
      const meta = card.createDiv({ cls: 'cal-otd-wall-meta' });
      meta.createSpan({ cls: 'cal-otd-wall-badge', text: metaText });
      if (images.length > 1) {
        meta.createSpan({ cls: 'cal-otd-wall-count', text: `+${images.length - 1}` });
      }

      if (images.length > 0) {
        const photo = card.createDiv({ cls: 'cal-otd-wall-photo' });
        this._setPhotoBackground(photo, images[0], entry.dateStr, entry.path);
      }

      // The title and the body are separate rows with their own type. They used
      // to be one run-on excerpt, so a diary title was indistinguishable from
      // the first sentence of its body.
      const hasPhoto = images.length > 0;
      // Only a photo-less, text-less card needs the placeholder: without it the
      // card collapses to a bare year badge. A photo-only card speaks for itself.
      const needsPlaceholder = !entry.title && !entry.excerpt && !hasPhoto;
      if (entry.title || entry.excerpt || needsPlaceholder) {
        const text = card.createDiv({
          cls: hasPhoto ? 'cal-otd-wall-text' : 'cal-otd-wall-text is-text-only',
        });
        if (entry.title) text.createDiv({ cls: 'cal-otd-wall-title', text: entry.title });
        if (entry.excerpt) {
          text.createDiv({ cls: 'cal-otd-wall-excerpt', text: entry.excerpt });
        } else if (needsPlaceholder) {
          text.createDiv({ cls: 'cal-otd-wall-excerpt is-empty', text: _l(lang, 'otd_emptyExcerpt') });
        }
      }

      // Click (or Enter/Space — the card is the keyboard entry point) opens the note.
      // `getLeaf('split')` used to be called here, which made this the one
      // Dayline surface that forced the workspace to grow a new pane instead of
      // replacing the journal note the reader already had open. The calendar
      // cell and the timeline card both route through `openJournalFile`, so a
      // memory now lands in the same leaf they would use.
      const openNote = () => {
        this.close();
        const file = entry.path && this.app.vault.getAbstractFileByPath(entry.path);
        Promise.resolve()
          .then(() => file instanceof TFile
            ? this.plugin.openJournalFile(file)
            : this.app.workspace.openLinkText(entry.dateStr, this.plugin.settings.dailyFolder, false))
          .catch((error) => {
            console.warn('[Dayline] Open On This Day note failed:', error?.message || error);
            new Notice(t(this.plugin.settings, 'openNoteFailed', { error: error?.message || error }));
          });
      };
      card.addEventListener('click', openNote);
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openNote();
      });
    }
  }

  _setPhotoBackground(bgEl, imageLink, dateStr, sourcePath) {
    try {
      const notePath = sourcePath || `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      this.plugin.thumbnailService.load(imageLink, notePath)
        .then((result) => {
          if (result && bgEl.isConnected) bgEl.style.backgroundImage = `url(${result.url})`;
        })
        .catch((error) => console.warn('[Dayline] On This Day thumbnail load failed:', error?.message || error));
    } catch { /* silently fail */ }
  }
}
