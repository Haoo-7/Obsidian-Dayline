// @ts-nocheck
const { ItemView, Notice, TFile, setIcon } = require('obsidian');
const { calculateJournalStats } = require('./journal-stats');
const { MOOD_LEVELS, getMoodColor } = require('./mood');
const { formatJournalDate, getDisplayLanguage, moodLabel, t } = require('./i18n');
const { isGenericJournalTitle } = require('./excerpt');

export const JOURNAL_TIMELINE_VIEW = 'journal-timeline-view';

export class JournalTimelineView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.index = plugin.journalIndex;
    this.filter = {};
    this.filterMenuOpen = false;
    this.renderToken = 0;
    this.thumbnailObserver = null;
    this.thumbnailVisibilityChecks = new Map();
    this.thumbnailScrollTimer = null;
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

  async onOpen() {
    this.contentEl.addEventListener('scroll', this.thumbnailScrollHandler, { passive: true });
    this.unsubscribe = this.index.subscribe(() => this.render());
    await this.index.refresh(this.plugin.settings);
    this.render();
  }

  onClose() {
    this.renderToken++;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    this.contentEl.removeEventListener('scroll', this.thumbnailScrollHandler);
    if (this.thumbnailScrollTimer) clearTimeout(this.thumbnailScrollTimer);
    this.thumbnailScrollTimer = null;
    this.thumbnailVisibilityChecks.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.plugin.viewVisibilityController?.viewClosed('timeline')
      .then(() => this.plugin._syncDaylineRibbon())
      .catch((error) => console.warn('[Dayline] Timeline close state sync failed:', error?.message || error));
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('journal-timeline-view');
    this.renderToken++;

    const header = root.createDiv({ cls: 'journal-timeline-header' });
    const heading = header.createDiv({ cls: 'journal-timeline-heading' });
    heading.createEl('h2', { text: t(this.plugin.settings, 'timelineTitle') });
    heading.createDiv({ cls: 'journal-timeline-count', text: String(this.index.filter(this.filter).length) });

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
    this.renderList(root.createDiv({ cls: 'journal-timeline-list' }));
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
    filterButton.addEventListener('click', () => {
      this.filterMenuOpen = !this.filterMenuOpen;
      this.render();
    });

    const menu = filters.createDiv({ cls: 'journal-timeline-filter-menu' });
    if (!this.filterMenuOpen) menu.addClass('is-hidden');
    const from = menu.createEl('input', { attr: { type: 'date', 'aria-label': t(this.plugin.settings, 'fromDate'), title: t(this.plugin.settings, 'fromDate') } });
    from.value = this.filter.from ?? '';
    from.addEventListener('change', () => { this.filter.from = from.value || undefined; this.updateResults(); });
    const to = menu.createEl('input', { attr: { type: 'date', 'aria-label': t(this.plugin.settings, 'toDate'), title: t(this.plugin.settings, 'toDate') } });
    to.value = this.filter.to ?? '';
    to.addEventListener('change', () => { this.filter.to = to.value || undefined; this.updateResults(); });
    const mood = menu.createEl('select', { attr: { 'aria-label': t(this.plugin.settings, 'allMoods'), title: t(this.plugin.settings, 'allMoods') } });
    mood.createEl('option', { text: t(this.plugin.settings, 'allMoods'), attr: { value: '' } });
    for (const level of MOOD_LEVELS) {
      const option = mood.createEl('option', { text: moodLabel(this.plugin.settings, level.score), attr: { value: String(level.score) } });
      option.style.color = level.color;
    }
    mood.value = this.filter.moodScore === undefined ? '' : String(this.filter.moodScore);
    mood.addEventListener('change', () => { this.filter.moodScore = mood.value === '' ? undefined : Number(mood.value); this.updateResults(); });
    const favorite = menu.createEl('label', { cls: 'journal-timeline-favorite-filter' });
    const checkbox = favorite.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = Boolean(this.filter.favoriteOnly);
    favorite.createSpan({ text: t(this.plugin.settings, 'favoritesOnly') });
    checkbox.addEventListener('change', () => { this.filter.favoriteOnly = checkbox.checked; this.updateResults(); });
    const clear = menu.createEl('button', { attr: { type: 'button', 'aria-label': t(this.plugin.settings, 'clearFilters'), title: t(this.plugin.settings, 'clearFilters') } });
    setIcon(clear, 'x');
    clear.addEventListener('click', () => { this.filter = {}; this.updateResults(); this.render(); });
    this.renderFilterSummary(filters);
  }

  renderFilterSummary(root) {
    const active = [];
    if (this.filter.from) active.push({ key: 'from', label: `${t(this.plugin.settings, 'fromDate')}: ${this.filter.from}` });
    if (this.filter.to) active.push({ key: 'to', label: `${t(this.plugin.settings, 'toDate')}: ${this.filter.to}` });
    if (this.filter.moodScore !== undefined) active.push({ key: 'moodScore', label: moodLabel(this.plugin.settings, this.filter.moodScore) });
    if (this.filter.favoriteOnly) active.push({ key: 'favoriteOnly', label: t(this.plugin.settings, 'favorite') });
    if (active.length === 0) return;
    const summary = root.createDiv({ cls: 'journal-timeline-filter-summary' });
    for (const item of active) {
      const chip = summary.createEl('button', { cls: 'journal-filter-chip', text: `${item.label} ×`, attr: { type: 'button', 'aria-label': `${t(this.plugin.settings, 'clearFilters')}: ${item.label}` } });
      chip.addEventListener('click', () => { delete this.filter[item.key]; this.render(); });
    }
  }

  renderStats(root) {
    const stats = calculateJournalStats(this.index.getEntries());
    const section = root.createDiv({ cls: 'journal-timeline-stats', attr: { 'aria-label': t(this.plugin.settings, 'moodTrend') } });
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
    const trend = section.createDiv({ cls: 'journal-stat-trend' });
    trend.createDiv({ cls: 'journal-stat-label', text: t(this.plugin.settings, 'moodTrend') });
    const grid = trend.createDiv({ cls: 'journal-stat-trend-grid' });
    const recent = stats.trend.slice(-7);
    for (const item of recent) {
      const cell = grid.createDiv({ cls: 'journal-stat-trend-cell' });
      cell.style.backgroundColor = getMoodColor(item.score);
      cell.setAttribute('aria-label', `${item.date}: ${item.score === undefined ? t(this.plugin.settings, 'noMood') : moodLabel(this.plugin.settings, item.score)}`);
      cell.title = cell.getAttribute('aria-label');
    }
  }

  updateResults() {
    const count = this.contentEl.querySelector('.journal-timeline-count');
    const entries = this.index.filter(this.filter);
    if (count) count.setText(String(entries.length));
    const list = this.contentEl.querySelector('.journal-timeline-list');
    if (list) this.renderList(list, entries);
    const area = this.contentEl.querySelector('.journal-timeline-filter-area');
    if (area) {
      const oldSummary = area.querySelector('.journal-timeline-filter-summary');
      oldSummary?.remove();
      this.renderFilterSummary(area);
    }
  }

  renderList(list, entries = this.index.filter(this.filter)) {
    this.renderToken++;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    this.thumbnailVisibilityChecks.clear();
    list.empty();
    if (entries.length === 0) {
      list.createDiv({ cls: 'journal-timeline-empty', text: t(this.plugin.settings, 'noResults') });
      return;
    }
    for (const entry of entries) this.renderEntry(list, entry, this.renderToken);
  }

  renderEntry(list, entry, token) {
    const imageLinks = entry.attachments.filter((link) => this.plugin.thumbnailService?.isImageLink(link));
    const scoreClass = entry.mood ? `mood-score-${entry.mood.score}` : 'mood-score-none';
    const card = list.createEl('article', { cls: `journal-timeline-entry ${scoreClass}${imageLinks.length ? ' has-thumbnail' : ''}` });
    card.tabIndex = 0;
    card.dataset.path = entry.path;
    const body = card.createDiv({ cls: 'journal-timeline-entry-body' });
    const top = body.createDiv({ cls: 'journal-timeline-entry-top' });
    top.createEl('h3', { cls: 'journal-timeline-entry-date', text: formatJournalDate(entry.date, this.plugin.settings) });
    top.createEl('time', { cls: 'journal-timeline-entry-iso', text: entry.date, attr: { datetime: entry.date } });
    if (entry.favorite) top.createSpan({ cls: 'journal-timeline-favorite', text: t(this.plugin.settings, 'favorite') });
    if (entry.title && !isGenericJournalTitle(entry.title, entry.date)) body.createDiv({ cls: 'journal-timeline-title', text: entry.title });
    if (entry.excerpt) body.createDiv({ cls: 'journal-timeline-excerpt', text: entry.excerpt });
    const meta = body.createDiv({ cls: 'journal-timeline-meta' });
    if (entry.location?.name) meta.createSpan({ text: entry.location.name });
    if (imageLinks.length > 0) meta.createSpan({ text: `${imageLinks.length}${t(this.plugin.settings, 'media')}` });

    let thumbnail;
    if (imageLinks.length > 0) {
      thumbnail = card.createDiv({ cls: 'journal-timeline-thumbnail' });
      const image = thumbnail.createEl('img', { attr: { alt: entry.title || entry.date, loading: 'lazy' } });
      if (imageLinks.length > 1) thumbnail.createSpan({ cls: 'journal-timeline-thumbnail-count', text: `+${imageLinks.length - 1}` });
      this.observeThumbnail(card, thumbnail, image, entry, imageLinks, token);
    }

    const open = () => this.openEntry(entry.path);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); this.plugin.openMoodPicker(entry.path); }
    });
  }

  observeThumbnail(card, container, image, entry, links, token) {
    let started = false;
    const load = async () => {
      if (started) return;
      started = true;
      const result = await this.plugin.thumbnailService.loadFirst(links, entry.path);
      if (token !== this.renderToken || !container.isConnected || !card.isConnected) return;
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
        this.thumbnailObserver.unobserve(observation.target);
        load();
      }
    }, { rootMargin: '160px' });
    this.thumbnailObserver.observe(container);
    const checkVisible = () => {
      if (token !== this.renderToken || !container.isConnected) return;
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
      await this.app.workspace.getLeaf('split').openFile(file);
    } catch (error) {
      console.warn('[Dayline] Open timeline entry failed:', error?.message || error);
      new Notice(t(this.plugin.settings, 'timelineOpenFailed', { error: error?.message || error }));
    }
  }
}
