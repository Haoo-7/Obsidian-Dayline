// @ts-nocheck
import { ItemView, Notice, TFile, setIcon } from 'obsidian';
import { MOOD_LEVELS, getMoodColor } from './mood';
import { buildRecentMoodTrend, calculateJournalStats } from './journal-stats';
import { formatJournalDate, getDisplayLanguage, moodLabel, t } from './i18n';
import { isGenericJournalTitle } from './excerpt';
import { createMediaAttachment } from './media-links';
import { shouldShowTimelineMoodTrend, shouldShowTimelineTitles } from './journal-timeline-display';
import {
  buildJournalLocationOptions,
  buildJournalTagOptions,
  displayableJournalMedia,
  MISSING_LOCATION_FILTER,
} from './journal-timeline-filters';
import { isInteractiveTimelineTarget, shouldOpenTimelineEntryFromKey } from './journal-timeline-interaction';
import { startJournalIndexLoad } from './journal-index';
import { renderMobileDaylineModeControls } from './dayline-mobile';

export const JOURNAL_TIMELINE_VIEW = 'journal-timeline-view';
const TIMELINE_PAGE_SIZE = 50;

function timelineDateParts(date, settings) {
  const value = new Date(`${date}T12:00:00`);
  const locale = getDisplayLanguage(settings) === 'en' ? 'en-US' : 'zh-CN';
  const parts = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' }).formatToParts(value);
  return {
    weekday: parts.find((part) => part.type === 'weekday')?.value || '',
    day: parts.find((part) => part.type === 'day')?.value || '',
  };
}

function timelineEntryTime(entry, settings) {
  const source = entry.modifiedAt || entry.createdAt;
  if (!source) return '';
  const value = new Date(source);
  if (!Number.isFinite(value.getTime())) return '';
  return new Intl.DateTimeFormat(getDisplayLanguage(settings) === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

export class JournalTimelineView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.index = plugin.journalIndex;
    this.filter = this._getMobileTimelineFilter();
    this.filterMenuOpen = false;
    this.renderToken = 0;
    this.closed = false;
    this.journalIndexError = null;
    this.thumbnailObserver = null;
    this.thumbnailLayoutObserver = null;
    this.thumbnailVisibilityChecks = new Map();
    this.thumbnailLoaders = new Map();
    this.thumbnailScrollTimer = null;
    this.mediaRefreshTimer = null;
    this.visibleEntryLimit = TIMELINE_PAGE_SIZE;
    this.renderScheduled = false;
    this.renderScheduleTimer = null;
    this.thumbnailScrollHandler = () => {
      if (this.thumbnailScrollTimer) return;
      this.thumbnailScrollTimer = setTimeout(() => {
        this.thumbnailScrollTimer = null;
        for (const check of this.thumbnailVisibilityChecks.values()) check();
      }, 50);
    };
  }

  getViewType() { return JOURNAL_TIMELINE_VIEW; }
  getDisplayText() { return t(this.plugin.settings, 'timelineTitle'); }
  getIcon() { return 'list'; }

  _renderMobileModeControls(root) {
    if (!this.plugin.capabilities?.isMobile) return;
    renderMobileDaylineModeControls(root, {
      activeMode: 'timeline',
      labels: {
        calendar: t(this.plugin.settings, 'calendarTitle'),
        timeline: t(this.plugin.settings, 'timelineTitle'),
      },
      onSelect: (mode) => mode === 'calendar'
        ? this.plugin.activateView()
        : this.plugin.activateTimeline(),
      setIcon,
      onReturn: () => this.plugin._returnToMobileMarkdown(),
    });
  }

  _getMobileTimelineFilter() {
    if (!this.plugin.capabilities?.isMobile) return {};
    const filter = this.plugin._getMobileTimelineFilter?.();
    return filter && typeof filter === 'object' ? { ...filter } : {};
  }

  _persistMobileTimelineFilter() {
    if (this.plugin.capabilities?.isMobile) this.plugin._setMobileTimelineFilter?.(this.filter);
  }

  setDateFilter(date) {
    this.filter = { from: date, to: date };
    this.syncFilterControls();
    this._persistMobileTimelineFilter();
    this.render();
  }

  async onOpen() {
    this.closed = false;
    this.journalIndexError = null;
    const root = this.contentEl;
    if (this.plugin.capabilities?.isMobile) this.containerEl.addClass('dayline-mobile-native-view');
    root.removeClass('cal-calendar-content');
    root.addEventListener('scroll', this.thumbnailScrollHandler, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.thumbnailLayoutObserver = new ResizeObserver(() => {
        for (const check of this.thumbnailVisibilityChecks.values()) check();
      });
      this.thumbnailLayoutObserver.observe(root);
    }
    this.unsubscribe = this.index.subscribe(() => this.scheduleRender());
    this.render();
    startJournalIndexLoad(
      () => this.plugin.ensureJournalIndexReady
        ? this.plugin.ensureJournalIndexReady()
        : this.index.refresh(this.plugin.settings),
      () => {
        if (this.closed) return;
        this.journalIndexError = null;
        this.render();
      },
      (error) => {
        if (this.closed) return;
        this.journalIndexError = error;
        console.warn('[Dayline] Timeline journal index load failed:', error?.message || error);
        this.render();
      },
    );
  }

  onClose() {
    this.closed = true;
    this.titleEdit = null;
    this.renderToken++;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    this.contentEl.removeEventListener('scroll', this.thumbnailScrollHandler);
    this.thumbnailLayoutObserver?.disconnect();
    this.thumbnailLayoutObserver = null;
    if (this.thumbnailScrollTimer) clearTimeout(this.thumbnailScrollTimer);
    this.thumbnailScrollTimer = null;
    if (this.mediaRefreshTimer) clearTimeout(this.mediaRefreshTimer);
    this.mediaRefreshTimer = null;
    if (this.renderScheduleTimer) clearTimeout(this.renderScheduleTimer);
    this.renderScheduleTimer = null;
    this.renderScheduled = false;
    this.thumbnailVisibilityChecks.clear();
    this.thumbnailLoaders.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!this.plugin.capabilities?.isMobile) {
      this.plugin.viewVisibilityController?.viewClosed('timeline')
        .then(() => this.plugin._syncDaylineRibbon())
        .catch((error) => console.warn('[Dayline] Timeline close state sync failed:', error?.message || error));
    } else {
      this.plugin._syncDaylineRibbon();
    }
    this.containerEl.removeClass('dayline-mobile-native-view');
    this.contentEl.removeClass('journal-timeline-view');
  }

  scheduleRender() {
    if (this.renderScheduled || this.closed) return;
    this.renderScheduled = true;
    this.renderScheduleTimer = setTimeout(() => {
      this.renderScheduleTimer = null;
      this.renderScheduled = false;
      if (!this.closed) this.render();
    }, 0);
  }

  render() {
    const root = this.contentEl;
    this._persistMobileTimelineFilter();
    const language = getDisplayLanguage(this.plugin.settings);
    if ((this.titleEdit || (this.index.isReady && !this.journalIndexError && this.renderLanguage === language))
      && root.querySelector('.journal-timeline-list')) {
      this.updateResults(false);
      this.updateFilterOptions();
      const stats = root.querySelector('.journal-timeline-stats-details');
      if (stats) {
        const open = stats.open;
        const focused = stats.contains(document.activeElement);
        stats.remove();
        this.renderStats(root, root.querySelector('.journal-timeline-pending-edit') || root.querySelector('.journal-timeline-list'));
        const replacement = root.querySelector('.journal-timeline-stats-details');
        replacement.open = open;
        if (focused) replacement.querySelector('summary').focus();
      }
      return;
    }
    root.empty();
    this.renderLanguage = language;
    root.addClass('journal-timeline-view');
    this.renderToken++;
    this._renderMobileModeControls(root);
    if (this.journalIndexError) {
      root.createDiv({ cls: 'journal-index-loading journal-index-load-error', text: t(this.plugin.settings, 'journalIndexLoadFailed', { error: this.journalIndexError?.message || this.journalIndexError }) });
      return;
    }
    if (!this.index.isReady) {
      root.createDiv({ cls: 'journal-index-loading', text: t(this.plugin.settings, 'journalIndexLoading') });
      return;
    }
    const entries = this.index.filter(this.filter);

    const header = root.createDiv({ cls: 'journal-timeline-header' });
    const heading = header.createDiv({ cls: 'journal-timeline-heading' });
    heading.createEl('h2', { text: t(this.plugin.settings, 'timelineTitle') });
    heading.createDiv({ cls: 'journal-timeline-count', text: String(entries.length) });

    const actions = header.createDiv({ cls: 'journal-timeline-actions' });
    const moodButton = actions.createEl('button', {
      attr: { type: 'button', 'aria-label': t(this.plugin.settings, 'recordMood'), title: t(this.plugin.settings, 'recordMood') },
    });
    setIcon(moodButton, 'heart-pulse');
    moodButton.addEventListener('click', () => this.plugin.recordCurrentMood());
    const newButton = actions.createEl('button', {
      attr: { type: 'button', 'aria-label': t(this.plugin.settings, 'createDailyNote'), title: t(this.plugin.settings, 'createDailyNote') },
    });
    setIcon(newButton, 'file-plus-2');
    newButton.addEventListener('click', () => this.plugin.createDailyNoteForToday());
    this.renderFilters(root);
    this.renderStats(root);
    this.renderList(root.createDiv({ cls: 'journal-timeline-list' }), entries);
  }

  renderStats(root, before = null) {
    const stats = calculateJournalStats(this.index.getEntries());
    const details = root.createEl('details', { cls: 'journal-timeline-stats-details' });
    if (before) root.insertBefore(details, before);
    const summary = details.createEl('summary');
    summary.createSpan({ text: t(this.plugin.settings, 'allJournalStats') });
    summary.createSpan({ cls: 'journal-timeline-stats-summary', text: `${t(this.plugin.settings, 'thisMonth')} ${stats.monthCompletionRate}%` });
    const section = details.createDiv({ cls: 'journal-timeline-stats' });
    const values = [
      [t(this.plugin.settings, 'currentStreak'), `${stats.currentStreak}`],
      [t(this.plugin.settings, 'longestStreak'), `${stats.longestStreak}`],
      [t(this.plugin.settings, 'thisMonth'), `${stats.monthCompletionRate}%`],
    ];
    for (const [label, value] of values) {
      const item = section.createDiv({ cls: 'journal-stat' });
      item.createDiv({ cls: 'journal-stat-value', text: value });
      item.createDiv({ cls: 'journal-stat-label', text: label });
    }
    if (!shouldShowTimelineMoodTrend(this.plugin.settings)) return;
    const trend = section.createDiv({ cls: 'journal-stat-trend' });
    trend.createDiv({ cls: 'journal-stat-label', text: t(this.plugin.settings, 'moodTrend') });
    const grid = trend.createDiv({ cls: 'journal-stat-trend-grid' });
    for (const item of buildRecentMoodTrend(this.index.getEntries())) {
      const cell = grid.createDiv({ cls: 'journal-stat-trend-cell' });
      cell.style.backgroundColor = getMoodColor(item.score);
      cell.setAttribute('aria-label', `${item.date}: ${item.score === undefined ? t(this.plugin.settings, 'noMood') : moodLabel(this.plugin.settings, item.score)}`);
      cell.title = cell.getAttribute('aria-label');
    }
  }

  /** Media changes do not alter index data, but visible thumbnail URLs may. */
  _onMediaChanged() {
    if (this.mediaRefreshTimer) clearTimeout(this.mediaRefreshTimer);
    this.mediaRefreshTimer = setTimeout(() => {
      this.mediaRefreshTimer = null;
      this.render();
    }, 100);
  }

  renderFilters(root) {
    const filters = root.createDiv({ cls: 'journal-timeline-filter-area' });
    const row = filters.createDiv({ cls: 'journal-timeline-filter-row' });
    const query = row.createEl('input', {
      attr: { type: 'search', placeholder: t(this.plugin.settings, 'searchJournal'), 'aria-label': t(this.plugin.settings, 'searchJournal') },
    });
    query.value = this.filter.query ?? '';
    query.addEventListener('input', () => {
      this.filter.query = query.value || undefined;
      this.updateResults();
    });
    const filterButton = row.createEl('button', {
      attr: {
        type: 'button',
        'aria-label': this.filterMenuOpen ? t(this.plugin.settings, 'closeFilters') : t(this.plugin.settings, 'openFilters'),
        'aria-expanded': String(this.filterMenuOpen),
        title: this.filterMenuOpen ? t(this.plugin.settings, 'closeFilters') : t(this.plugin.settings, 'openFilters'),
      },
    });
    setIcon(filterButton, 'list-filter');
    this.filterButton = filterButton;
    filterButton.addEventListener('click', () => {
      this.filterMenuOpen = !this.filterMenuOpen;
      menu.hidden = !this.filterMenuOpen;
      filterButton.setAttribute('aria-expanded', String(this.filterMenuOpen));
      const label = t(this.plugin.settings, this.filterMenuOpen ? 'closeFilters' : 'openFilters');
      filterButton.setAttribute('aria-label', label);
      filterButton.title = label;
      if (!this.filterMenuOpen && menu.contains(document.activeElement)) filterButton.focus();
    });

    const menu = filters.createDiv({ cls: 'journal-timeline-filter-menu' });
    menu.hidden = !this.filterMenuOpen;
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (this.filterMenuOpen) filterButton.click();
      filterButton.focus();
    });
    const field = (key) => {
      const label = menu.createEl('label', { cls: 'journal-timeline-filter-field' });
      label.createSpan({ text: t(this.plugin.settings, key) });
      return label;
    };
    const from = field('fromDate').createEl('input', { attr: { type: 'date', 'aria-label': t(this.plugin.settings, 'fromDate'), title: t(this.plugin.settings, 'fromDate') } });
    from.value = this.filter.from ?? '';
    from.addEventListener('change', () => { this.filter.from = from.value || undefined; this.updateResults(); });
    const to = field('toDate').createEl('input', { attr: { type: 'date', 'aria-label': t(this.plugin.settings, 'toDate'), title: t(this.plugin.settings, 'toDate') } });
    to.value = this.filter.to ?? '';
    to.addEventListener('change', () => { this.filter.to = to.value || undefined; this.updateResults(); });
    const source = field('source').createEl('select', { attr: { 'aria-label': t(this.plugin.settings, 'source'), title: t(this.plugin.settings, 'source') } });
    source.createEl('option', { text: t(this.plugin.settings, 'allSources'), attr: { value: '' } });
    for (const item of this.sourceOptions()) {
      const option = source.createEl('option', { text: item.label, attr: { value: item.id } });
      option.selected = this.filter.sourceId === item.id;
    }
    source.value = this.filter.sourceId ?? '';
    source.addEventListener('change', () => { this.filter.sourceId = source.value || undefined; this.updateResults(); });
    const mood = field('mood').createEl('select', { attr: { 'aria-label': t(this.plugin.settings, 'allMoods'), title: t(this.plugin.settings, 'allMoods') } });
    mood.createEl('option', { text: t(this.plugin.settings, 'allMoods'), attr: { value: '' } });
    for (const level of MOOD_LEVELS) {
      const option = mood.createEl('option', { text: moodLabel(this.plugin.settings, level.score), attr: { value: String(level.score) } });
      option.style.color = level.color;
    }
    mood.value = this.filter.moodScore === undefined ? '' : String(this.filter.moodScore);
    mood.addEventListener('change', () => { this.filter.moodScore = mood.value === '' ? undefined : Number(mood.value); this.updateResults(); });
    const media = field('mediaFilter').createEl('select', { attr: { 'aria-label': t(this.plugin.settings, 'mediaFilter'), title: t(this.plugin.settings, 'mediaFilter') } });
    for (const [value, key] of [
      ['all', 'mediaAll'], ['any', 'mediaAny'], ['image', 'mediaImage'],
      ['video', 'mediaVideo'], ['audio', 'mediaAudio'], ['none', 'mediaNone'],
    ]) {
      const option = media.createEl('option', { text: t(this.plugin.settings, key), attr: { value } });
      option.selected = (this.filter.media || 'all') === value;
    }
    media.value = this.filter.media || 'all';
    media.addEventListener('change', () => { this.filter.media = media.value === 'all' ? undefined : media.value; this.updateResults(); });
    const location = field('locationFilter').createEl('select', { attr: { 'aria-label': t(this.plugin.settings, 'locationFilter'), title: t(this.plugin.settings, 'locationFilter') } });
    location.createEl('option', { text: t(this.plugin.settings, 'allLocations'), attr: { value: '' } });
    for (const item of buildJournalLocationOptions(this.index.getEntries())) {
      const option = location.createEl('option', {
        text: item.value === MISSING_LOCATION_FILTER ? t(this.plugin.settings, 'noLocation') : item.label,
        attr: { value: item.value },
      });
      option.selected = this.filter.location === item.value;
    }
    location.value = this.filter.location || '';
    location.addEventListener('change', () => { this.filter.location = location.value || undefined; this.updateResults(); });
    const tag = field('tagFilter').createEl('select', { attr: { 'aria-label': t(this.plugin.settings, 'tagFilter'), title: t(this.plugin.settings, 'tagFilter') } });
    tag.createEl('option', { text: t(this.plugin.settings, 'allTags'), attr: { value: '' } });
    for (const item of buildJournalTagOptions(this.index.getEntries())) {
      const option = tag.createEl('option', { text: item.label, attr: { value: item.value } });
      option.selected = this.filter.tag === item.value;
    }
    tag.value = this.filter.tag || '';
    tag.addEventListener('change', () => { this.filter.tag = tag.value || undefined; this.updateResults(); });
    const favorite = menu.createEl('label', { cls: 'journal-timeline-favorite-filter' });
    const checkbox = favorite.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = Boolean(this.filter.favoriteOnly);
    favorite.createSpan({ text: t(this.plugin.settings, 'favoritesOnly') });
    checkbox.addEventListener('change', () => { this.filter.favoriteOnly = checkbox.checked; this.updateResults(); });
    const clear = menu.createEl('button', { cls: 'journal-timeline-clear-filters', text: t(this.plugin.settings, 'clearFilters'), attr: { type: 'button' } });
    clear.addEventListener('click', () => this.clearFilters());
    this.filterControls = { query, from, to, sourceId: source, moodScore: mood, media, location, tag, favoriteOnly: checkbox };
    for (const select of [source, location, tag]) {
      select.addEventListener('blur', () => this.updateFilterOptions());
    }
    this.renderFilterSummary(filters);
  }

  syncFilterControls() {
    for (const [key, control] of Object.entries(this.filterControls || {})) {
      if (key === 'favoriteOnly') control.checked = Boolean(this.filter[key]);
      else control.value = this.filter[key] ?? (key === 'media' ? 'all' : '');
    }
  }

  updateFilterOptions() {
    const sources = this.sourceOptions().map(item => ({ value: item.id, label: item.label }));
    const locations = buildJournalLocationOptions(this.index.getEntries()).map(item => ({
      value: item.value,
      label: item.value === MISSING_LOCATION_FILTER ? t(this.plugin.settings, 'noLocation') : item.label,
    }));
    const tags = buildJournalTagOptions(this.index.getEntries());
    for (const [key, options] of [['sourceId', sources], ['location', locations], ['tag', tags]]) {
      const select = this.filterControls?.[key];
      if (!select || select === document.activeElement) continue;
      const current = this.filter[key] || '';
      const nextOptions = [{ value: '', label: select.options[0].textContent }, ...options];
      if (current && !nextOptions.some(item => item.value === current)) nextOptions.push({ value: current, label: current });
      if (JSON.stringify([...select.options].map(item => [item.value, item.textContent]))
        === JSON.stringify(nextOptions.map(item => [item.value, item.label]))) continue;
      select.empty();
      for (const item of nextOptions) select.createEl('option', { text: item.label, attr: { value: item.value } });
      select.value = current;
    }
  }

  clearFilters() {
    this.filter = {};
    this.syncFilterControls();
    this.updateResults();
    this.filterButton?.focus();
  }

  renderFilterSummary(root) {
    const active = [];
    if (this.filter.query?.trim()) active.push({ key: 'query', label: `${t(this.plugin.settings, 'searchJournal')}: ${this.filter.query.trim()}` });
    if (this.filter.from) active.push({ key: 'from', label: `${t(this.plugin.settings, 'fromDate')}: ${this.filter.from}` });
    if (this.filter.to) active.push({ key: 'to', label: `${t(this.plugin.settings, 'toDate')}: ${this.filter.to}` });
    if (this.filter.sourceId) {
      const source = this.sourceOptions().find((item) => item.id === this.filter.sourceId);
      active.push({ key: 'sourceId', label: `${t(this.plugin.settings, 'source')}: ${source?.label || this.filter.sourceId}` });
    }
    if (this.filter.moodScore !== undefined) active.push({ key: 'moodScore', label: moodLabel(this.plugin.settings, this.filter.moodScore) });
    if (this.filter.media) active.push({ key: 'media', label: `${t(this.plugin.settings, 'mediaFilter')}: ${this.mediaFilterLabel(this.filter.media)}` });
    if (this.filter.location) {
      const option = buildJournalLocationOptions(this.index.getEntries()).find((item) => item.value === this.filter.location);
      active.push({ key: 'location', label: `${t(this.plugin.settings, 'locationFilter')}: ${option?.value === MISSING_LOCATION_FILTER ? t(this.plugin.settings, 'noLocation') : option?.label || this.filter.location}` });
    }
    if (this.filter.tag) active.push({ key: 'tag', label: `${t(this.plugin.settings, 'tagFilter')}: #${this.filter.tag}` });
    if (this.filter.favoriteOnly) active.push({ key: 'favoriteOnly', label: t(this.plugin.settings, 'favorite') });
    this.filterButton?.classList.toggle('is-active', active.length > 0);
    if (this.filterButton) this.filterButton.dataset.count = String(active.length);
    if (active.length === 0) return;
    const summary = root.createDiv({ cls: 'journal-timeline-filter-summary' });
    for (const item of active) {
      const chip = summary.createEl('button', { cls: 'journal-filter-chip', attr: { type: 'button', 'aria-label': `${t(this.plugin.settings, 'clearFilters')}: ${item.label}` } });
      chip.dataset.filterKey = item.key;
      chip.createSpan({ text: item.label });
      setIcon(chip.createSpan({ cls: 'journal-filter-chip-remove', attr: { 'aria-hidden': 'true' } }), 'x');
      chip.addEventListener('click', () => {
        const position = active.indexOf(item);
        delete this.filter[item.key];
        this.syncFilterControls();
        this.updateResults();
        const chips = this.contentEl.querySelectorAll('.journal-filter-chip');
        (chips[Math.min(position, chips.length - 1)] || this.filterButton)?.focus();
      });
    }
  }

  sourceOptions() {
    const byId = new Map();
    for (const source of this.index.sources || []) {
      byId.set(source.id, {
        id: source.id,
        label: source.id === 'daily' ? t(this.plugin.settings, 'dailyNotes') : (source.label || source.path || source.id),
      });
    }
    for (const entry of this.index.getEntries()) {
      if (!byId.has(entry.sourceId)) byId.set(entry.sourceId, {
        id: entry.sourceId,
        label: entry.sourceId === 'daily' ? t(this.plugin.settings, 'dailyNotes') : (entry.sourceLabel || entry.sourcePath || entry.sourceId),
      });
    }
    return Array.from(byId.values());
  }

  mediaFilterLabel(value) {
    const key = value === 'all' ? 'mediaAll'
      : value === 'any' ? 'mediaAny'
        : value === 'image' ? 'mediaImage'
          : value === 'video' ? 'mediaVideo'
            : value === 'audio' ? 'mediaAudio' : 'mediaNone';
    return t(this.plugin.settings, key);
  }

  updateResults(resetPage = true) {
    const root = this.contentEl;
    this._persistMobileTimelineFilter();
    const count = root.querySelector('.journal-timeline-count');
    const entries = this.index.filter(this.filter);
    if (resetPage) this.visibleEntryLimit = TIMELINE_PAGE_SIZE;
    if (count) count.setText(String(entries.length));
    const list = root.querySelector('.journal-timeline-list');
    if (list) this.renderList(list, entries);
    const area = root.querySelector('.journal-timeline-filter-area');
    if (area) {
      const oldSummary = area.querySelector('.journal-timeline-filter-summary');
      const focusedKey = oldSummary?.contains(document.activeElement)
        ? document.activeElement.closest('.journal-filter-chip')?.dataset.filterKey : null;
      oldSummary?.remove();
      this.renderFilterSummary(area);
      if (focusedKey) {
        [...area.querySelectorAll('.journal-filter-chip')]
          .find(chip => chip.dataset.filterKey === focusedKey)?.focus();
      }
    }
  }

  renderList(list, entries = this.index.filter(this.filter)) {
    const edit = this.titleEdit;
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const editingFocused = edit?.card.contains(document.activeElement);
    const focusedPath = focused?.closest('.journal-timeline-entry')?.dataset.path;
    const focusedTitle = focused?.classList.contains('journal-timeline-entry-title');
    const loadingMore = focused?.classList.contains('journal-timeline-load-more');
    const previousCount = list.querySelectorAll('.journal-timeline-entry').length;
    this.renderToken++;
    if (!edit) {
      this.thumbnailObserver?.disconnect();
      this.thumbnailObserver = null;
      this.thumbnailVisibilityChecks.clear();
      this.thumbnailLoaders.clear();
    } else {
      for (const map of [this.thumbnailVisibilityChecks, this.thumbnailLoaders]) {
        for (const container of map.keys()) {
          if (edit.card.contains(container)) continue;
          this.thumbnailObserver?.unobserve(container);
          map.delete(container);
        }
      }
    }
    const editIndex = edit ? entries.findIndex(entry => entry.path === edit.path) : -1;
    // A matching draft stays in the results, even if a refresh moves it beyond the current page.
    if (editIndex >= this.visibleEntryLimit) this.visibleEntryLimit = editIndex + 1;
    let pending = this.contentEl.querySelector('.journal-timeline-pending-edit');
    if (edit && editIndex === -1) {
      if (!pending) {
        pending = this.contentEl.createDiv({ cls: 'journal-timeline-pending-edit' });
        this.contentEl.insertBefore(pending, list);
        pending.createDiv({ text: t(this.plugin.settings, 'unsavedTitle'), attr: { role: 'status' } });
      }
      this.moveTitleEditCard(pending);
    }
    for (const child of [...list.childNodes]) {
      if (child !== edit?.card) child.remove();
    }
    if (!edit) pending?.remove();
    if (entries.length === 0) {
      const empty = list.createDiv({ cls: 'journal-timeline-empty' });
      const hasEntries = this.index.getEntries().length > 0;
      empty.createDiv({ text: t(this.plugin.settings, hasEntries ? 'noResults' : 'noJournalEntries') });
      const action = empty.createEl('button', { text: t(this.plugin.settings, hasEntries ? 'clearFilters' : 'createDailyNote'), attr: { type: 'button' } });
      action.addEventListener('click', () => hasEntries ? this.clearFilters() : this.plugin.createDailyNoteForToday());
      if (focused && !editingFocused) action.focus();
      return;
    }
    let month;
    let beforeEdit = editIndex >= 0 && edit.card.parentElement === list;
    const positionNewNode = (node) => {
      if (beforeEdit) list.insertBefore(node, edit.card);
    };
    for (const entry of entries.slice(0, this.visibleEntryLimit)) {
      const key = entry.date.slice(0, 7);
      if (key !== month) {
        month = key;
        const label = new Intl.DateTimeFormat(getDisplayLanguage(this.plugin.settings) === 'en' ? 'en-US' : 'zh-CN',
          { year: 'numeric', month: 'long' }).format(new Date(`${key}-01T12:00:00`));
        positionNewNode(list.createEl('h3', { cls: 'journal-timeline-month', text: label }));
      }
      if (edit && entry.path === edit.path) {
        this.moveTitleEditCard(list);
        beforeEdit = false;
      } else {
        this.renderEntry(list, entry, this.renderToken);
        positionNewNode(list.lastElementChild);
      }
    }
    if (editIndex >= 0) pending?.remove();
    if (entries.length > this.visibleEntryLimit) {
      const remaining = Math.min(TIMELINE_PAGE_SIZE, entries.length - this.visibleEntryLimit);
      const button = list.createEl('button', {
        cls: 'journal-timeline-load-more',
        text: getDisplayLanguage(this.plugin.settings) === 'en' ? `Show ${remaining} more` : `再显示 ${remaining} 条`,
        attr: { type: 'button' },
      });
      button.addEventListener('click', () => {
        this.visibleEntryLimit += TIMELINE_PAGE_SIZE;
        this.renderList(list, entries);
      });
    }
    if (focused && !editingFocused) {
      const cards = [...list.querySelectorAll('.journal-timeline-entry')];
      const card = loadingMore ? cards[previousCount] : cards.find(item => item.dataset.path === focusedPath);
      ((focusedTitle && card?.querySelector('.journal-timeline-entry-title')) || card || this.filterButton)?.focus();
    }
  }

  moveTitleEditCard(parent) {
    const edit = this.titleEdit;
    if (!edit || edit.card.parentElement === parent) return;
    const active = document.activeElement;
    const focused = edit.card.contains(active);
    const selection = [edit.input.selectionStart, edit.input.selectionEnd, edit.input.selectionDirection];
    // Moving a focused editor can blur it; that blur must not submit the draft.
    edit.moving = true;
    try {
      parent.append(edit.card);
      if (focused && document.activeElement !== active) {
        active.focus({ preventScroll: true });
        if (active === edit.input) edit.input.setSelectionRange(...selection);
      }
    } finally {
      edit.moving = false;
    }
  }

  renderEntry(list, entry, token) {
    const media = displayableJournalMedia(entry);
    const imageLinks = entry.attachments.filter((link) => this.plugin.thumbnailService?.isImageLink(link));
    const frontmatterCover = entry.cover ? createMediaAttachment(entry.cover, entry.path) : null;
    const validCover = frontmatterCover?.kind !== 'unknown' ? frontmatterCover : null;
    const thumbnailMedia = media.length > 0
      ? media.slice()
      : imageLinks.map((link) => ({ link, normalizedLink: link, sourcePath: entry.path, kind: 'image' }));
    if (validCover && !thumbnailMedia.some((item) => item.normalizedLink === validCover.normalizedLink)) {
      thumbnailMedia.unshift(validCover);
    }
    const scoreClass = entry.mood ? `mood-score-${entry.mood.score}` : 'mood-score-none';
    const card = list.createEl('article', { cls: `journal-timeline-entry ${scoreClass}${thumbnailMedia.length ? ' has-thumbnail' : ''}` });
    card.tabIndex = 0;
    card.dataset.path = entry.path;
    card.setAttribute('aria-label', `${entry.date}, ${formatJournalDate(entry.date, this.plugin.settings)}${entry.title ? `: ${entry.title}` : ''}`);
    const dateColumn = card.createDiv({ cls: 'journal-timeline-entry-date-column' });
    const dateParts = timelineDateParts(entry.date, this.plugin.settings);
    dateColumn.createSpan({ cls: 'journal-timeline-entry-weekday', text: dateParts.weekday });
    dateColumn.createSpan({ cls: 'journal-timeline-entry-day', text: dateParts.day });
    const body = card.createDiv({ cls: 'journal-timeline-entry-body' });
    const title = entry.title && !isGenericJournalTitle(entry.title, entry.date) ? entry.title : '';
    const titleEditor = shouldShowTimelineTitles(this.plugin.settings) ? body.createEl('h3', {
      cls: `journal-timeline-entry-title${title ? '' : ' is-placeholder'}`,
      text: title,
      attr: {
        role: 'button',
        tabindex: '0',
        'aria-label': title
          ? `${t(this.plugin.settings, 'editJournalTitle')}: ${title}`
          : t(this.plugin.settings, 'addJournalTitle'),
        title: title ? t(this.plugin.settings, 'editJournalTitle') : t(this.plugin.settings, 'addJournalTitle'),
      },
    }) : null;
    if (titleEditor) {
      if (!title) {
        setIcon(titleEditor, 'pencil');
        titleEditor.classList.add('journal-timeline-add-title');
        body.classList.add('has-title-placeholder');
      }
      titleEditor.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.editTitleInline(titleEditor, entry.path, title);
      });
      titleEditor.addEventListener('keydown', (event) => {
        if (event.target !== titleEditor) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        this.editTitleInline(titleEditor, entry.path, title);
      });
    }

    const top = body.createDiv({ cls: 'journal-timeline-entry-top' });
    top.createEl('time', { cls: 'journal-timeline-entry-iso', text: entry.date, attr: { datetime: entry.date } });
    if (entry.favorite) top.createSpan({ cls: 'journal-timeline-favorite', text: t(this.plugin.settings, 'favorite') });
    if (entry.excerpt) body.createDiv({ cls: 'journal-timeline-excerpt', text: entry.excerpt });
    const time = timelineEntryTime(entry, this.plugin.settings);
    if (time) {
      const meta = body.createDiv({ cls: 'journal-timeline-meta' });
      meta.createEl('time', {
        text: t(this.plugin.settings, entry.modifiedAt ? 'updatedAt' : 'createdAt', { time }),
        attr: { datetime: new Date(entry.modifiedAt || entry.createdAt).toISOString() },
      });
    }
    let thumbnail;
    if (thumbnailMedia.length > 0) {
      thumbnail = card.createDiv({ cls: 'journal-timeline-thumbnail' });
      const image = thumbnail.createEl('img', { attr: { alt: entry.title || entry.date, loading: 'lazy' } });
      if (thumbnailMedia.length > 1) thumbnail.createSpan({ cls: 'journal-timeline-thumbnail-count', text: `+${thumbnailMedia.length - 1}` });
      this.observeThumbnail(card, thumbnail, image, entry, thumbnailMedia, token);
    }

    const open = () => this.openEntry(entry.path);
    card.addEventListener('click', (event) => {
      if (!isInteractiveTimelineTarget(event.target)) open();
    });
    card.addEventListener('keydown', (event) => {
      if (shouldOpenTimelineEntryFromKey(event)) { event.preventDefault(); open(); return; }
      if (isInteractiveTimelineTarget(event.target)) return;
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); this.plugin.openMoodPicker(entry.path); }
    });
  }

  editTitleInline(editor, path, initialTitle) {
    if (this.titleEdit || editor.dataset.editing === 'true') return;
    editor.dataset.editing = 'true';
    editor.classList.add('is-editing');
    editor.closest('.journal-timeline-entry-body')?.classList.remove('has-title-placeholder');
    editor.setAttribute('role', 'group');
    editor.removeAttribute('tabindex');
    editor.textContent = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialTitle;
    input.maxLength = 200;
    input.setAttribute('aria-label', t(this.plugin.settings, 'editJournalTitle'));
    editor.append(input);
    const edit = this.titleEdit = { path, card: editor.closest('.journal-timeline-entry'), editor, input };

    let settled = false;
    let saving = false;
    let failed = false;
    const restore = (focus) => {
      settled = true;
      this.titleEdit = null;
      if (this.closed) return;
      this.render();
      if (!focus) return;
      const card = [...this.contentEl.querySelectorAll('.journal-timeline-entry')].find(item => item.dataset.path === path);
      (card?.querySelector('.journal-timeline-entry-title') || card || this.filterButton)?.focus();
    };
    const finish = async (save) => {
      if (settled || saving) return;
      if (!save || input.value === initialTitle) {
        restore(document.activeElement === input);
        return;
      }
      saving = true;
      const disabledFocusedInput = document.activeElement === input;
      let focusMovedAway = false;
      const trackFocus = (event) => {
        if (!editor.contains(event.target) && event.target !== document.body) focusMovedAway = true;
      };
      document.addEventListener('focusin', trackFocus);
      const shouldRestoreFocus = () => editor.contains(document.activeElement)
        || (disabledFocusedInput && !focusMovedAway && document.activeElement === document.body);
      input.disabled = true;
      editor.setAttribute('aria-busy', 'true');
      editor.querySelector('.journal-title-save-error')?.remove();
      try {
        await this.plugin.saveJournalTitle(path, input.value);
        restore(shouldRestoreFocus());
      } catch (error) {
        if (this.closed) return;
        const focus = shouldRestoreFocus();
        failed = true;
        input.disabled = false;
        const message = editor.createDiv({ cls: 'journal-title-save-error' });
        message.createDiv({ text: t(this.plugin.settings, 'journalTitleSaveFailed', { error: error?.message || error }), attr: { role: 'alert' } });
        const retry = message.createEl('button', { text: t(this.plugin.settings, 'retry'), attr: { type: 'button' } });
        retry.addEventListener('click', (event) => { event.stopPropagation(); void finish(true); });
        const cancel = message.createEl('button', { text: t(this.plugin.settings, 'cancel'), attr: { type: 'button' } });
        cancel.addEventListener('click', (event) => { event.stopPropagation(); restore(true); });
        if (focus) input.focus();
      } finally {
        document.removeEventListener('focusin', trackFocus);
        saving = false;
        editor.removeAttribute('aria-busy');
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        void finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        void finish(false);
      }
    });
    input.addEventListener('blur', () => { if (!failed && !edit.moving) void finish(true); });
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.focus();
    input.select();
  }

  observeThumbnail(card, container, image, entry, links, token) {
    let started = false;
    const load = async () => {
      if (started) return;
      started = true;
      this.thumbnailLoaders.delete(container);
      this.thumbnailVisibilityChecks.delete(container);
      const explicitCover = entry.cover ? createMediaAttachment(entry.cover, entry.path) : null;
      const validCover = explicitCover?.kind !== 'unknown' ? explicitCover : undefined;
      const result = this.plugin.mediaService?.loadFirstCover
        ? await this.plugin.mediaService.loadFirstCover(links, validCover)
        : await this.plugin.thumbnailService.loadFirst(links.map((item) => item.link || item.normalizedLink), entry.path);
      if ((token !== this.renderToken && card !== this.titleEdit?.card) || !container.isConnected || !card.isConnected) return;
      if (!result) {
        card.removeClass('has-thumbnail');
        container.remove();
        return;
      }
      image.src = result.url;
      container.addClass('is-loaded');
    };
    if (typeof IntersectionObserver === 'undefined') { load(); return; }
    this.thumbnailObserver ??= new IntersectionObserver((observations) => {
      for (const observation of observations) {
        if (!observation.isIntersecting) continue;
        this.thumbnailObserver?.unobserve(observation.target);
        this.thumbnailLoaders.get(observation.target)?.();
      }
    }, { root: this.contentEl, rootMargin: '160px' });
    this.thumbnailObserver.observe(container);
    this.thumbnailLoaders.set(container, load);
    const checkVisible = () => {
      if ((token !== this.renderToken && card !== this.titleEdit?.card) || !container.isConnected) return;
      const rootRect = this.contentEl.getBoundingClientRect();
      const rect = container.getBoundingClientRect();
      if (rect.bottom >= rootRect.top - 160 && rect.top <= rootRect.bottom + 160) load();
    };
    this.thumbnailVisibilityChecks.set(container, checkVisible);
    setTimeout(checkVisible, 50);
  }

  async openEntry(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t(this.plugin.settings, 'timelineOpenFailed', { error: path }));
      return;
    }
    try {
      if (this.plugin.openJournalFile) await this.plugin.openJournalFile(file);
      else await this.app.workspace.getLeaf('split').openFile(file);
    } catch (error) {
      console.warn('[Dayline] Open timeline entry failed:', error?.message || error);
      new Notice(t(this.plugin.settings, 'timelineOpenFailed', { error: error?.message || error }));
    }
  }
}
