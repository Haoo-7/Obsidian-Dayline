// @ts-nocheck
import { getTodayDate } from './date-utils';
import { localize as _l } from './locale';
import { t } from './i18n';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'avif', 'tiff', 'tif', 'bmp'];

function isImageLink(link: unknown): boolean {
  const clean = String(link || '').split('|', 1)[0].split('?', 1)[0];
  return IMAGE_EXTENSIONS.includes(clean.split('.').pop()?.toLowerCase() || '');
}

function daylineDate(settings: { weatherTimezone?: string }, date = new Date()): string {
  return getTodayDate(settings?.weatherTimezone || 'auto', date);
}

/** Strip Markdown/wiki syntax and return the first ~100 characters of plain text. */
function extractExcerpt(content: string): string | null {
  let text = content.replace(/^---[\s\S]*?---\n*/, '');
  text = text.replace(/!\[\[.*?\]\]/g, '');
  text = text.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/[*_~`]+/g, '');
  text = text.replace(/={2,}/g, '');
  text = text.replace(/^>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s/gm, '');
  text = text.replace(/\n+/g, ' ');
  text = text.replace(/\s{2,}/g, ' ').trim();
  if (text.length > 100) text = `${text.substring(0, 100)}...`;
  return text || null;
}

/** Render a user-customizable excerpt template. */
function renderExcerptTemplate(
  template: string,
  dateStr: string,
  year: number,
  frontmatter: Record<string, unknown>,
  bodyText: string | null,
): string | null {
  let result = template;
  result = result.replace(/\{body\}/g, bodyText || '');
  result = result.replace(/\{year\}/g, String(year));
  result = result.replace(/\{date\}/g, dateStr);
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === 'string' || typeof value === 'number') {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\{${escapedKey}\\}`, 'g'), String(value));
    }
  }
  result = result.trim();
  return result || null;
}

export class OnThisDayProvider {
  private readonly plugin: any;
  private dateIndex: Set<string> | null = null;
  private readonly entryCache = new Map<string, any[]>();

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  private currentYear(): number {
    return Number(daylineDate(this.plugin.settings).slice(0, 4));
  }

  /** Build a set of all MM-DD values that have indexed journal entries. */
  async ensureDateIndex(): Promise<void> {
    if (this.dateIndex) return;
    const thisYear = this.currentYear();
    const index = new Set<string>();
    for (const entry of this.plugin.journalIndex?.getEntries?.() || []) {
      const year = Number(entry.date.slice(0, 4));
      if (Number.isFinite(year) && year < thisYear) index.add(entry.date.slice(5));
    }
    this.dateIndex = index;
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
          extractExcerpt(entry.searchText || entry.excerpt || ''),
        );
      } else if (mode !== 'none') {
        excerpt = extractExcerpt(entry.searchText || entry.excerpt || '');
      }

      entries.push({ year, dateStr: entry.date, path: entry.path, images, excerpt });
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
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'cal-otd-modal';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    // Panel
    const panel = document.createElement('div');
    panel.className = 'cal-otd-panel';
    this.panel = panel;

    // --- Header: title + date nav + close ---
    const header = panel.createDiv({ cls: 'cal-otd-header' });
    header.createDiv({ cls: 'cal-otd-header-title', text: _l(lang, 'otd_title') });

    const nav = header.createDiv({ cls: 'cal-otd-date-nav' });
    const prevDayBtn = nav.createDiv({ cls: 'cal-otd-nav-btn', text: '◀' });
    prevDayBtn.setAttribute('aria-label', _l(lang, 'otd_prevDay'));
    prevDayBtn.setAttribute('title', _l(lang, 'otd_prevDay'));
    prevDayBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navigateDate(-1); });

    const dateInput = nav.createEl('input', {
      type: 'date',
      cls: 'cal-otd-date-input',
      attr: { 'aria-label': _l(lang, 'otd_datePicker') },
    });
    dateInput.addEventListener('change', () => {
      const parts = dateInput.value.split('-');
      if (parts.length === 3) {
        this.month = parseInt(parts[1]);
        this.day = parseInt(parts[2]);
        this._navigateDate(0); // refetch current date
      }
    });
    this.dateInput = dateInput;
    this._updateDateInput();

    const nextDayBtn = nav.createDiv({ cls: 'cal-otd-nav-btn', text: '▶' });
    nextDayBtn.setAttribute('aria-label', _l(lang, 'otd_nextDay'));
    nextDayBtn.setAttribute('title', _l(lang, 'otd_nextDay'));
    nextDayBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navigateDate(1); });

    const closeBtn = header.createDiv({ cls: 'cal-otd-close', text: '\u2715' });
    closeBtn.setAttribute('aria-label', _l(lang, 'otd_close'));
    closeBtn.setAttribute('title', _l(lang, 'otd_close'));
    closeBtn.addEventListener('click', () => this.close());

    // --- Grid body ---
    this.bodyEl = panel.createDiv({ cls: 'cal-otd-grid' });

    // Empty state or content
    if (this.entries.length === 0) {
      const emptyMsg = this.bodyEl.createDiv({ cls: 'cal-otd-empty-state' });
      emptyMsg.setText(_l(lang, 'otd_noMemories'));
    } else {
      this._renderGrid();
    }

    this.backdrop.appendChild(panel);
    document.body.appendChild(this.backdrop);
    document.addEventListener('keydown', this._onKey);
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
    else if (e.key === 'ArrowLeft') { this._navigateDate(-1); }
    else if (e.key === 'ArrowRight') { this._navigateDate(1); }
  }

  async _navigateDate(delta) {
    if (!this.provider) return;

    // Compute new date
    // Use a leap year so Feb 29 remains a valid month/day in the navigator.
    const d = new Date(2000, this.month - 1, this.day + delta);
    this.month = d.getMonth() + 1;
    this.day = d.getDate();

    // Update label
    const lang = this.plugin.settings.weatherLanguage;
    this._updateDateInput();

    // Show loading
    this.bodyEl.empty();
    const loadingEl = this.bodyEl.createDiv({ cls: 'cal-otd-empty-state' });
    loadingEl.setText(_l(lang, 'loading'));

    // Fetch
    const requestToken = ++this._requestToken;
    try {
      this.entries = await this.provider.getEntries(this.month, this.day);
      if (this._closed || requestToken !== this._requestToken) return;
      this.bodyEl.empty();
      if (this.entries.length === 0) {
        const emptyMsg = this.bodyEl.createDiv({ cls: 'cal-otd-empty-state' });
        emptyMsg.setText(_l(lang, 'otd_noMemories'));
      } else {
        this._renderGrid();
      }
    } catch (e) {
      if (this._closed || requestToken !== this._requestToken) return;
      this.bodyEl.empty();
      const errEl = this.bodyEl.createDiv({ cls: 'cal-otd-empty-state' });
      errEl.setText(t(this.plugin.settings, 'onThisDayLoadFailed', { error: e?.message || e }));
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

    for (const entry of this.entries) {
      const card = this.bodyEl.createDiv({ cls: 'cal-otd-wall-card' });

      // Year badge
      const badge = card.createDiv({ cls: 'cal-otd-wall-badge' });
      const currentYear = Number(daylineDate(this.plugin.settings).slice(0, 4));
      badge.setText(_l(lang, 'otd_yearsAgo', currentYear - entry.year) + `  ·  ${entry.year}`);

      // Photo or text block
      if (entry.images && entry.images.length > 0) {
        const photo = card.createDiv({ cls: 'cal-otd-wall-photo' });
        this._setPhotoBackground(photo, entry.images[0], entry.dateStr, entry.path);
      } else if (entry.excerpt) {
        // Text-only preview when diary has no images but does have excerpt
        const textBlock = card.createDiv({ cls: 'cal-otd-wall-text' });
        textBlock.setText(entry.excerpt);
      }
      // If no image AND no excerpt → compact card with just the year badge

      // Excerpt below photo
      if (entry.images && entry.images.length > 0 && entry.excerpt) {
        card.createDiv({ cls: 'cal-otd-wall-excerpt', text: entry.excerpt });
      }

      // Click to open the note
      card.addEventListener('click', () => {
        const { TFile, Notice } = require('obsidian');
        this.close();
        const file = entry.path && this.app.vault.getAbstractFileByPath(entry.path);
        Promise.resolve()
          .then(() => file instanceof TFile
            ? this.app.workspace.getLeaf('split').openFile(file)
            : this.app.workspace.openLinkText(entry.dateStr, this.plugin.settings.dailyFolder, false))
          .catch((error) => {
            console.warn('[Dayline] Open On This Day note failed:', error?.message || error);
            new Notice(t(this.plugin.settings, 'openNoteFailed', { error: error?.message || error }));
          });
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
    } catch (e) { /* silently fail */ }
  }
}
