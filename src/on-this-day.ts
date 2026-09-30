// @ts-nocheck
import { Notice, setIcon, TFile } from 'obsidian';
import { getTodayDate, joinVaultPath } from './date-utils';
import { extractExcerpt, isGenericJournalTitle, renderExcerptTemplate } from './excerpt';
import { onThisDayYearsAgo } from './on-this-day-entry';
import { localize as _l } from './locale';
import { getDisplayLanguage, t } from './i18n';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'avif', 'tiff', 'tif', 'bmp'];
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]+\S/;

/** MM-DD key for a month/day pair, the shape the journal index stores. */
function mmddKey(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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
  /** The visible memory wall, so a second open reuses it instead of stacking. */
  private _activeModal: OnThisDayModal | null = null;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  private currentYear(): number {
    return Number(daylineDate(this.plugin.settings).slice(0, 4));
  }

  /** A leap year has February 29; a common year has to borrow it for the 28th. */
  private isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  /**
   * MM-DD keys whose memories belong to one calendar view date.
   *
   * A February 29 diary only exists in leap years, so a common-year February 28
   * view also shows the February 29 memories instead of hiding them for three
   * years out of four.
   */
  private viewKeys(mmdd: string): string[] {
    if (mmdd !== '02-28' || this.isLeapYear(this.currentYear())) return [mmdd];
    return [mmdd, '02-29'];
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
    // The calendar's dot marker reads this set directly, so a common-year
    // February 28 must carry the February 29 memories it is going to show.
    if (!this.isLeapYear(thisYear) && index.has('02-29')) index.add('02-28');
    this.dateIndex = index;
    this.dateIndexYear = thisYear;
  }

  /** Quick check: does any year have a diary for this MM-DD? */
  async hasEntries(month: number, day: number): Promise<boolean> {
    await this.ensureDateIndex();
    return this.viewKeys(mmddKey(month, day)).some((key) => this.dateIndex?.has(key) ?? false);
  }

  /** Full entries for a given MM-DD (images + excerpts). */
  async getEntries(month: number, day: number): Promise<any[]> {
    await this.ensureDateIndex();
    const key = mmddKey(month, day);
    if (this.entryCache.has(key)) return this.entryCache.get(key) || [];

    const wanted = new Set(this.viewKeys(key));
    const seen = new Set<string>();
    const entries: any[] = [];
    const thisYear = this.currentYear();

    for (const entry of this.plugin.journalIndex?.getEntries?.() || []) {
      const year = Number(entry.date.slice(0, 4));
      if (!Number.isFinite(year) || year >= thisYear || !wanted.has(entry.date.slice(5))) continue;
      const identity = `${entry.path || ''}|${entry.date}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

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
    if (!this.dateIndex) return;
    const thisYear = this.currentYear();
    // February 28 and February 29 share one view in a common year, so a change
    // to either note has to recompute both markers.
    const affected = mmdd === '02-28' || mmdd === '02-29' ? ['02-28', '02-29'] : [mmdd];
    for (const key of affected) {
      this.entryCache.delete(key);
      const wanted = new Set(this.viewKeys(key));
      const hasHistoricalEntry = (this.plugin.journalIndex?.getEntries?.() || []).some((entry: any) => (
        wanted.has(entry.date.slice(5)) && Number(entry.date.slice(0, 4)) < thisYear
      ));
      if (hasHistoricalEntry) this.dateIndex.add(key);
      else this.dateIndex.delete(key);
    }
  }

  get dateIndexSnapshot(): Set<string> | null {
    return this.dateIndex;
  }

  /** The panel this provider currently has on screen, if any. */
  get activeModal(): OnThisDayModal | null {
    return this._activeModal;
  }

  /** Close the panel this provider opened. Safe to call from a view teardown. */
  closeModal(): void {
    this._activeModal?.close();
  }
}
/* ============================================================
   On This Day Modal
   ============================================================ */

/** Elements Tab may reach inside the dialog, in document order. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Fields that own the arrow keys; the date navigator must not steal them. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * The panel currently on screen, if any. The plugin opens the memory wall from
 * the calendar view, so at most one is visible; keeping a module-level handle
 * lets `onunload` close it without reaching into the view that owns the
 * provider.
 */
let activeOnThisDayModal: OnThisDayModal | null = null;

/** Close the open "On This Day" panel, if any. Safe to call from `onunload`. */
export function closeOnThisDayModal(): void {
  activeOnThisDayModal?.close();
}

export class OnThisDayModal {
  constructor(app, plugin, provider, month, day, entries) {
    this.app = app;
    this.plugin = plugin;
    this.provider = provider;
    this.month = month;
    this.day = day;
    this.entries = entries || [];
    this.lang = getDisplayLanguage(plugin?.settings || {});
    this._requestToken = 0;
    this._closed = false;
    this._returnFocusTo = null;
    this._onKey = this._onKeyDown.bind(this);
  }

  /** Resolve the display language, including a live `'system'` setting. */
  _displayLanguage() {
    return this.lang || getDisplayLanguage(this.plugin?.settings || {});
  }

  open() {
    // A second open while the wall is already up (double click, another date)
    // reuses the visible panel instead of stacking a second copy of the dialog.
    const existing = this.provider?._activeModal;
    if (existing && existing !== this && !existing._closed) {
      existing.showDate(this.month, this.day, this.entries);
      return existing;
    }
    // A panel left over from a previous calendar view is stale; drop it first.
    if (activeOnThisDayModal && activeOnThisDayModal !== this && !activeOnThisDayModal._closed) {
      activeOnThisDayModal.close();
    }

    this._closed = false;
    this.lang = getDisplayLanguage(this.plugin?.settings || {});
    const lang = this.lang;

    // Backdrop
    this.backdrop = createDiv();
    this.backdrop.className = 'cal-otd-modal';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    // Panel: a real modal dialog. `aria-modal` tells a screen reader that the
    // rest of the workspace is inert, and `tabindex="-1"` lets it take focus
    // without joining the Tab order.
    const panel = createDiv();
    panel.className = 'cal-otd-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', _l(lang, 'otd_title'));
    panel.setAttribute('tabindex', '-1');
    this.panel = panel;

    // --- Header: title + date nav + close ---
    const header = panel.createDiv({ cls: 'cal-otd-header' });
    this.titleEl = header.createDiv({ cls: 'cal-otd-header-title', text: _l(lang, 'otd_title') });

    const nav = header.createDiv({ cls: 'cal-otd-date-nav' });
    const prevDayBtn = nav.createEl('button', {
      cls: 'cal-otd-nav-btn',
      attr: { type: 'button', 'aria-label': _l(lang, 'otd_prevDay'), title: _l(lang, 'otd_prevDay') },
    });
    this.prevDayBtn = prevDayBtn;
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
    this.nextDayBtn = nextDayBtn;
    setIcon(nextDayBtn, 'chevron-right');
    nextDayBtn.addEventListener('click', (e) => { e.stopPropagation(); void this._navigateDate(1); });

    const closeBtn = header.createEl('button', {
      cls: 'cal-otd-close',
      attr: { type: 'button', 'aria-label': _l(lang, 'otd_close'), title: _l(lang, 'otd_close') },
    });
    this.closeBtn = closeBtn;
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

    // Remember where focus came from so closing returns the reader to the
    // control they opened the wall with.
    const active = document.activeElement;
    this._returnFocusTo = active && active !== document.body ? active : null;

    if (this.provider) this.provider._activeModal = this;
    activeOnThisDayModal = this;
    document.addEventListener('keydown', this._onKey);
    this.focusPanel();
    return this;
  }

  /**
   * Point the visible panel at another date (a second open for the same
   * provider) instead of building a second dialog on top of it.
   */
  showDate(month, day, entries) {
    this._requestToken++;
    this.month = month;
    this.day = day;
    this.entries = entries || [];
    this.lang = getDisplayLanguage(this.plugin?.settings || {});
    this._applyLanguage();
    this._updateDateInput();
    if (this.entries.length === 0) {
      this._renderMessage(_l(this.lang, 'otd_noMemories'), 'history');
    } else {
      this._renderGrid();
    }
    this.focusPanel();
    return this;
  }

  /** Move keyboard focus into the dialog, as a modal is expected to. */
  focusPanel() {
    if (!this.panel || typeof this.panel.focus !== 'function') return;
    try {
      this.panel.focus();
    } catch { /* the panel was detached or cannot take focus */ }
  }

  /** Re-label the chrome after the display language changed. */
  _applyLanguage() {
    const lang = this._displayLanguage();
    this.panel?.setAttribute('aria-label', _l(lang, 'otd_title'));
    if (this.titleEl) this.titleEl.setText(_l(lang, 'otd_title'));
    for (const [element, key] of [
      [this.prevDayBtn, 'otd_prevDay'],
      [this.nextDayBtn, 'otd_nextDay'],
      [this.closeBtn, 'otd_close'],
    ]) {
      if (!element) continue;
      const label = _l(lang, key);
      element.setAttribute('aria-label', label);
      element.setAttribute('title', label);
    }
    if (this.dateInput) this.dateInput.setAttribute('aria-label', _l(lang, 'otd_datePicker'));
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
    if (this._closed) return;
    this._closed = true;
    this._requestToken++;
    document.removeEventListener('keydown', this._onKey);
    if (activeOnThisDayModal === this) activeOnThisDayModal = null;
    if (this.provider && this.provider._activeModal === this) this.provider._activeModal = null;
    if (this.backdrop && this.backdrop.parentElement) {
      this.backdrop.parentElement.removeChild(this.backdrop);
    }
    this._restoreFocus();
  }

  /** Alias for close(), used by teardown paths such as `onunload`. */
  dispose() {
    this.close();
  }

  /** Return focus to whatever opened the panel. */
  _restoreFocus() {
    const target = this._returnFocusTo;
    this._returnFocusTo = null;
    if (!target || !target.isConnected || typeof target.focus !== 'function') return;
    try {
      target.focus();
    } catch { /* the trigger was removed with its view */ }
  }

  _onKeyDown(e) {
    if (this._closed) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'Tab') {
      this._trapFocus(e);
      return;
    }
    // The date input and any other field own the arrow keys: pressing ←/→ while
    // typing must not also flip the day under the reader.
    if (this._isEditableTarget(e.target)) return;
    if (e.key === 'ArrowLeft') { void this._navigateDate(-1); }
    else if (e.key === 'ArrowRight') { void this._navigateDate(1); }
  }

  /** Does the key event come from a field that owns the arrow keys? */
  _isEditableTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    if (target.isContentEditable) return true;
    try {
      return typeof target.closest === 'function' && Boolean(target.closest(EDITABLE_SELECTOR));
    } catch {
      return false;
    }
  }

  /** Keep Tab inside the dialog while it is modal. */
  _trapFocus(event) {
    if (!this.panel) return;
    const focusable = Array.from(this.panel.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hasAttribute('disabled'));
    if (focusable.length === 0) {
      event.preventDefault();
      this.focusPanel();
      return;
    }
    const active = document.activeElement;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey) {
      if (active === first || !this.panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !this.panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
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
    this._renderMessage(_l(this._displayLanguage(), 'loading'));

    // Fetch
    const requestToken = ++this._requestToken;
    try {
      this.entries = await this.provider.getEntries(this.month, this.day);
      if (this._closed || requestToken !== this._requestToken) return;
      if (this.entries.length === 0) {
        this._renderMessage(_l(this._displayLanguage(), 'otd_noMemories'), 'history');
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
    const lang = this._displayLanguage();
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
      const notePath = sourcePath || joinVaultPath(this.plugin.settings.dailyFolder, `${dateStr}.md`);
      this.plugin.thumbnailService.load(imageLink, notePath)
        .then((result) => {
          if (result && bgEl.isConnected) bgEl.style.backgroundImage = `url(${result.url})`;
        })
        .catch((error) => console.warn('[Dayline] On This Day thumbnail load failed:', error?.message || error));
    } catch { /* silently fail */ }
  }
}
