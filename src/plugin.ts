// @ts-nocheck
/**
 * Dayline — a visual journal for calendars, timelines, moods, memories, weather, and photos.
 * Scans Calendar/Daily/ for notes with images, shows thumbnails in date cells.
 * Click a date to open that day's daily note.
 */
const { Plugin, ItemView, TFile, Notice, Modal, Menu, setIcon } = require('obsidian');
const { JournalIndex } = require('./journal-index');
const { MoodStore } = require('./mood-store');
const { MoodPickerModal } = require('./mood-picker-modal');
const { JournalTimelineView, JOURNAL_TIMELINE_VIEW } = require('./journal-timeline-view');
const { OnThisDayProvider, OnThisDayModal } = require('./on-this-day');
const { DaylineSettingsTab } = require('./settings-tab');
const { WeatherService, lookupWeatherCode, validateWeatherCoordinates } = require('./weather-service');
const { localize: _l } = require('./locale');
const { formatDateParts, getClockPartsInTimeZone, getTodayDate } = require('./date-utils');
const { ThumbnailService } = require('./thumbnail-service');
const { OverlayRegistry } = require('./overlay-registry');
const { SerialTaskQueue } = require('./task-queue');
const { formatCalendarMonth, getCalendarWeekdays, getDisplayLanguage, moodLabel, t } = require('./i18n');
const { getMoodColor } = require('./mood');
const { shouldShowCalendarMood, shouldShowCalendarWeatherCard, shouldShowCalendarWeatherBadge } = require('./calendar-display');
const { ViewVisibilityController, normalizeViewVisibilitySettings } = require('./view-visibility-controller');
const { hasExistingImage } = require('./heic-embed');
const { ImageMetadataCache, HeicCache, HEIC_EXTS, ReverseGeocoder } = require('./image-metadata');

const VIEW_TYPE = 'calendar-sidebar-view';
const OVERLAY_ATTR = 'data-cal-weather-overlay';

/* ============================================================
   Plugin Entry
   ============================================================ */
const DEFAULT_SETTINGS = {
  dailyFolder: 'Calendar/Daily',
  thumbnailFilter: 'all', // 'all' | 'date-prefixed'
  // --- Weather settings ---
  weatherEnabled: false,
  weatherLatitude: '',
  weatherLongitude: '',
  weatherLocationName: '',
  weatherUnits: 'metric', // 'metric' | 'imperial'
  weatherAutoFetch: true, // auto-fetch weather when opening a daily note
  weatherTtlHours: 2,     // cache TTL in hours before re-fetch
  weatherTimezone: 'auto', // Open-Meteo timezone mode
  weatherLanguage: 'zh',  // 'en' | 'zh' — display language for weather labels
  displayLanguage: 'zh',  // global plugin language; migrated from weatherLanguage
  showCalendarMood: true,
  showCalendarWeatherCard: true,
  showCalendarWeatherBadge: true,
  showCalendarView: true,
  showTimelineView: false,
  // Legacy combined weather visibility setting; retained for migration/downgrade compatibility.
  showCalendarWeather: true,
  // --- EXIF metadata ---
  showExif: true,         // show EXIF metadata tooltip on image hover
  exifReverseGeocode: false, // never send GPS coordinates unless explicitly enabled
  // --- On This Day settings ---
  onThisDayDot: false,    // show accent dots on cells with past-year entries
  onThisDayButton: true,  // show sidebar button to open On This Day modal
  onThisDayExcerptMode: 'auto',  // 'auto' | 'frontmatter' | 'template' | 'none'
  onThisDayExcerptKey: 'excerpt',  // frontmatter key when mode is 'frontmatter'
  onThisDayExcerptTemplate: '{body}',  // template when mode is 'template'
  // --- Journal index and mood metadata ---
  journalSources: [],
  moodMetadataPath: 'Calendar/journal-metadata.json',
  mirrorMoodToFrontmatter: false,
  reminderEnabled: false,
  reminderHour: 21,
};

class DaylinePlugin extends Plugin {
  async onload() {
    this._dataWriteQueue = Promise.resolve();
    this._journalWriteQueue = new SerialTaskQueue();
    this._weatherSaveTimer = null;
    this._weatherCleanupTimer = null;
    this._exifHoverToken = 0;
    this._otdRequestToken = 0;
    await this._migrateLegacyData();
    await this.loadSettings();

    this.moodStore = new MoodStore(this.app, this.settings);
    await this.moodStore.load();
    this.journalIndex = new JournalIndex(this.app, (path) => this.moodStore.get(path));
    await this.journalIndex.refresh(this.settings);
    this._reminderTimer = setInterval(() => this._maybeRemind(), 60 * 1000);

    // Load styles (manually installed plugins don't auto-load styles.css)
    this._loadStyles();

    // Initialize shared WeatherService (singleton across all calendar views)
    this.weatherService = new WeatherService(this);
    // Shared EXIF metadata cache (used by calendar tooltip + note-image tooltip)
    this.exifCache = new ImageMetadataCache(this.app);
    // HEIC thumbnail conversion cache
    this.heicCache = new HeicCache(this.app);
    this.thumbnailService = new ThumbnailService(this.app, this.heicCache);
    // Reverse geocoder for EXIF GPS coordinates (Nominatim, free)
    this.geocoder = new ReverseGeocoder();

    // Preload libheif WASM module eagerly
    try {
      const path = require('path');
      const pluginDir = path.join(this.app.vault.adapter.basePath, '.obsidian', 'plugins', 'dayline');
      const libheifFactory = require(path.join(pluginDir, 'libheif-bundle.js'));
      this._libheifFactory = libheifFactory;
    } catch (e) {
      console.warn('[Dayline] Failed to load libheif:', e.message);
      this._libheifFactory = null;
    }
    // Track containers where we set position:relative so we can revert on unload
    this._hostPositionMarkers = new Set();
    this._overlayRegistry = new OverlayRegistry();
    this._overlayOriginalPositions = new Map();

    // Register the sidebar view
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.registerView(JOURNAL_TIMELINE_VIEW, (leaf) => new JournalTimelineView(leaf, this));

    this.viewVisibilityController = new ViewVisibilityController({
      workspace: this.app.workspace,
      initialState: this.settings,
      openers: {
        calendar: () => this._openCalendarView(),
        timeline: () => this._openTimelineView(),
      },
      onPersist: (kind, visible) => this._persistViewVisibility(kind, visible),
    });
    this._daylineRibbonEl = this.addRibbonIcon('calendar-range', 'Dayline', (event) => this._showDaylineMenu(event));
    this._syncDaylineRibbon();

    // Command to open the calendar (in case it gets closed)
    this.addCommand({
      id: 'open-calendar-sidebar',
      name: t(this.settings, 'openCalendar'),
      callback: () => this.activateView(),
    });

    // Command to refresh weather for the active date
    this.addCommand({
      id: 'refresh-weather',
      name: t(this.settings, 'refreshWeather'),
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) {
          leaf.view.refreshWeather().catch((err) => {
            console.warn('[Dayline] Refresh weather failed:', err.message);
          });
        }
      },
    });

    // Command: Open On This Day modal
    this.addCommand({
      id: 'open-on-this-day',
      name: t(this.settings, 'openOnThisDay'),
      callback: () => {
        const [, month, day] = _daylineDate(this.settings).split('-').map(Number);
        this.openOnThisDay(month, day);
      },
    });

    this.addCommand({
      id: 'open-journal-timeline',
      name: t(this.settings, 'openTimelineCommand'),
      callback: () => this.activateTimeline(),
    });
    this.addCommand({
      id: 'new-daily-note',
      name: t(this.settings, 'newDailyCommand'),
      callback: () => this.createDailyNoteForToday(),
    });
    this.addCommand({
      id: 'record-current-mood',
      name: t(this.settings, 'recordMoodCommand'),
      callback: () => this.recordCurrentMood(),
    });
    this.addCommand({
      id: 'export-journal-metadata',
      name: t(this.settings, 'exportMetadataCommand'),
      callback: async () => {
        try {
          const path = await this.moodStore.exportTo();
          new Notice(t(this.settings, 'metadataExported', { path }));
        } catch (error) {
          new Notice(t(this.settings, 'metadataExportFailed', { error: error?.message || error }));
        }
      },
    });
    this.addCommand({
      id: 'restore-journal-metadata-backup',
      name: t(this.settings, 'restoreMetadataCommand'),
      callback: async () => {
        try {
          await this.moodStore.restoreBackup();
          await this.journalIndex.refresh(this.settings);
          this.refreshJournalViews();
          new Notice(t(this.settings, 'metadataRestored'));
        } catch (error) {
          new Notice(t(this.settings, 'metadataRestoreFailed', { error: error?.message || error }));
        }
      },
    });
    this.addCommand({
      id: 'check-journal-metadata-integrity',
      name: t(this.settings, 'integrityCommand'),
      callback: async () => {
        const result = await this.moodStore.checkIntegrity();
        new Notice(result.valid
          ? t(this.settings, 'metadataValid')
          : t(this.settings, 'metadataIntegrityIssues', {
            metadata: result.invalidMetadata.length,
            records: result.invalidRecords.length,
            orphans: result.invalidOrphans.length,
            missing: result.missingFiles.length,
          }));
      },
    });
    this.addCommand({
      id: 'import-frontmatter-mood-metadata',
      name: t(this.settings, 'importFrontmatterCommand'),
      callback: async () => {
        const count = await this.moodStore.importFrontmatter(
          this.journalIndex.getEntries().map((entry) => entry.path),
          this.app.metadataCache,
        );
        await this.journalIndex.refresh(this.settings);
        this.refreshJournalViews();
        new Notice(t(this.settings, 'importedMoods', { count }));
      },
    });
    this.addCommand({
      id: 'detect-journal-import-directories',
      name: t(this.settings, 'detectImportsCommand'),
      callback: async () => {
        const result = await this.journalIndex.detectSources(this.settings);
        const fields = Object.entries(result.fields).map(([key, value]) => `${key}: ${value}`).join(', ');
        new Notice(`${result.files} journal files; ${result.noDate.length} without date. ${fields}`);
      },
    });

    // Settings tab
    this.addSettingTab(new DaylineSettingsTab(this.app, this));

    // Initialize EXIF tooltip element (shared across calendar & note-image hover)
    this._exifTooltipEl = null;
    this._exifHoverTimer = null;
    this._ensureExifTooltip();

    // Restore view visibility after Obsidian has restored the workspace layout.
    this.app.workspace.onLayoutReady(async () => {
      await this.viewVisibilityController.restore();
      this._syncDaylineRibbon();
      // Trigger initial overlay sync once the layout is stable
      this._syncAllOverlays();
    });

    // Plugin-level overlay sync: react to file-open, active-leaf-change, layout-change
    this.registerEvent(
      this.app.workspace.on('file-open', () => this._syncAllOverlays())
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          leaf.view?._handleActiveLeafChange?.();
        }
        this._syncAllOverlays();
      })
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this._syncAllOverlays();
        this._syncDaylineRibbon();
      })
    );
    this.registerEvent(this.app.vault.on('create', (file) => this._handleJournalCreateOrModify(file)));
    this.registerEvent(this.app.vault.on('modify', (file) => this._handleJournalCreateOrModify(file)));
    this.registerEvent(this.app.vault.on('delete', (file) => this._handleJournalDelete(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this._handleJournalRename(file, oldPath)));
  }

  /** Remove all note overlays and clear state on unload. */
  async onunload() {
    clearTimeout(this._weatherSaveTimer);
    clearTimeout(this._weatherCleanupTimer);
    clearTimeout(this._exifHoverTimer);
    clearInterval(this._reminderTimer);
    this._exifHoverToken++;
    await this._flushWeatherCache();
    await this._journalWriteQueue?.flush();
    await this.moodStore?.flush();
    await this.viewVisibilityController?.unload();
    this._removeAllOverlays();
    this._exifTooltipEl?.remove();
    this._exifTooltipEl = null;
    document.getElementById('dayline-styles')?.remove();
    document.getElementById('calendar-sidebar-styles')?.remove();
  }

  _persistViewVisibility(kind, visible) {
    const key = kind === 'calendar' ? 'showCalendarView' : 'showTimelineView';
    this.settings[key] = visible;
    return this.saveSettings();
  }

  _showDaylineMenu(event) {
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(t(this.settings, 'calendarTitle'))
      .setIcon('calendar-days')
      .setChecked(this.viewVisibilityController.isOpen('calendar'))
      .onClick(() => {
        this.viewVisibilityController.toggle('calendar')
          .then(() => this._syncDaylineRibbon())
          .catch((error) => console.warn('[Dayline] Calendar visibility toggle failed:', error?.message || error));
      }));
    menu.addItem((item) => item
      .setTitle(t(this.settings, 'timelineTitle'))
      .setIcon('list')
      .setChecked(this.viewVisibilityController.isOpen('timeline'))
      .onClick(() => {
        this.viewVisibilityController.toggle('timeline')
          .then(() => this._syncDaylineRibbon())
          .catch((error) => console.warn('[Dayline] Timeline visibility toggle failed:', error?.message || error));
      }));
    menu.showAtMouseEvent(event);
  }

  _syncDaylineRibbon() {
    const ribbon = this._daylineRibbonEl;
    if (!ribbon || !this.viewVisibilityController) return;
    ribbon.classList.toggle('is-active', this.viewVisibilityController.isAnyOpen());
  }

  async _migrateLegacyData() {
    const adapter = this.app.vault?.adapter;
    if (!adapter?.exists || !adapter?.read || !adapter?.write) return;
    const legacyPath = '.obsidian/plugins/calendar-sidebar/data.json';
    const currentPath = '.obsidian/plugins/dayline/data.json';
    try {
      if (await adapter.exists(currentPath) || !(await adapter.exists(legacyPath))) return;
      await adapter.write(currentPath, await adapter.read(legacyPath));
      console.info('[Dayline] Migrated Calendar Sidebar settings and weather cache.');
    } catch (error) {
      console.warn('[Dayline] Legacy data migration failed:', error);
    }
  }

  async activateTimeline() {
    const opened = await this.viewVisibilityController.open('timeline');
    this._syncDaylineRibbon();
    return opened;
  }

  async _openTimelineView() {
    const leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true);
    if (!leaf) throw new Error('could not create timeline leaf');
    await leaf.setViewState({ type: JOURNAL_TIMELINE_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async createDailyNoteForToday() {
    const date = _daylineDate(this.settings);
    const path = `${this.settings.dailyFolder}/${date}.md`;
    try {
      const file = await this.ensureJournalFile(path, '');
      await (this.app.workspace.getLeaf('split')).openFile(file);
      await this.journalIndex.refreshFile(path, this.settings);
    } catch (error) {
      console.warn('[Dayline] Create daily note failed:', error?.message || error);
      new Notice(t(this.settings, 'createNoteFailed', { error: error?.message || error }));
    }
  }

  async recordCurrentMood() {
    const activeFile = this.app.workspace.activeLeaf?.view?.file;
    const sources = this.journalIndex.resolveSources(this.settings);
    const activeIsJournal = activeFile?.extension === 'md'
      && sources.some((source) => activeFile.path === source.path || activeFile.path.startsWith(`${source.path}/`));
    const path = activeIsJournal
      ? activeFile.path
      : `${this.settings.dailyFolder}/${_daylineDate(this.settings)}.md`;
    this.openMoodPicker(path, { allowDateSelection: true, ensureFile: false });
  }

  async openMoodPicker(path, options = {}) {
    if (path && options.ensureFile !== false) await this.ensureJournalFile(path, '');
    const entry = this.journalIndex.getEntries().find((item) => item.path === path);
    new MoodPickerModal(this.app, {
      filePath: path,
      initial: this.moodStore.get(path) || entry?.mood,
      settings: this.settings,
      allowDateSelection: options.allowDateSelection === true,
      onDateChange: async (date) => {
        const nextPath = `${this.settings.dailyFolder}/${date}.md`;
        const nextEntry = this.journalIndex.getEntries().find((item) => item.path === nextPath);
        return {
          filePath: nextPath,
          initial: this.moodStore.get(nextPath) || nextEntry?.mood,
        };
      },
      onSave: async ({ filePath, score, labels }) => {
        const targetPath = filePath || path;
        await this.ensureJournalFile(targetPath, '');
        await this.moodStore.set(targetPath, score, labels, this.settings);
        await this.journalIndex.refreshFile(targetPath, this.settings);
        this.refreshJournalViews();
        new Notice(`${t(this.settings, 'moodSaved')}: ${targetPath}`);
      },
    }).open();
  }

  refreshJournalViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(JOURNAL_TIMELINE_VIEW)) leaf.view?.render?.();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const refresh = leaf.view?.refresh?.();
      if (refresh?.catch) refresh.catch((error) => console.warn('[Dayline] Calendar refresh failed:', error?.message || error));
    }
  }

  _maybeRemind() {
    if (!this.settings.reminderEnabled) return;
    const now = new Date();
    const clock = getClockPartsInTimeZone(now, this.settings.weatherTimezone || 'auto');
    if (clock.hour !== Number(this.settings.reminderHour ?? 21) || clock.minute !== 0) return;
    const date = _daylineDate(this.settings, now);
    if (this.journalIndex.getEntries().some((entry) => entry.date === date)) return;
    new Notice(t(this.settings, 'dailyReminder'));
  }

  async ensureFolder(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (!normalized || this.app.vault.getAbstractFileByPath(normalized)) return;
    const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    if (parent) await this.ensureFolder(parent);
    try { await this.app.vault.createFolder(normalized); } catch (_) { /* folder may have been created concurrently */ }
  }

  async ensureJournalFile(path, content) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
    return this.app.vault.create(path, content);
  }

  _handleJournalCreateOrModify(file) {
    this._notifyCalendarImageChange(file);
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this.journalIndex.refreshFile(file.path, this.settings)
      .catch((error) => console.warn('[Dayline] Journal index refresh failed:', error?.message || error));
  }

  _handleJournalDelete(file) {
    this._notifyCalendarImageChange(file);
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this._queueJournalWrite('move deleted mood to orphan', () => this.moodStore.removeToOrphan(file.path));
    this.journalIndex.removeFile(file.path);
  }

  async _handleJournalRename(file, oldPath) {
    this._notifyCalendarImageChange(file);
    if (!(file instanceof TFile) || file.extension !== 'md') return;

    // The new file must not be indexed until its authoritative mood key has
    // moved. This prevents a transient refresh from replacing a valid mood
    // with an empty value.
    try {
      await this._journalWriteQueue.add(() => this.moodStore.rename(oldPath, file.path));
    } catch (error) {
      console.warn('[Dayline] rename mood metadata failed:', error?.message || error);
      new Notice(`rename mood metadata: ${error?.message || error}`);
      // Keep the old in-memory entry visible until a later refresh can retry
      // the persistence operation instead of publishing a partial entry.
      return;
    }

    this.journalIndex.renameFile(oldPath, file.path);
    try {
      await this.journalIndex.refreshFile(file.path, this.settings);
    } catch (error) {
      console.warn('[Dayline] Renamed journal index refresh failed:', error?.message || error);
    }
  }

  _notifyCalendarImageChange(file) {
    if (!(file instanceof TFile) || !IMAGE_EXTS.includes(file.extension?.toLowerCase())) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      leaf.view?._onImageChanged?.(file);
    }
  }

  _queueJournalWrite(label, task) {
    return this._journalWriteQueue.add(task).catch((error) => {
      console.warn(`[Dayline] ${label} failed:`, error?.message || error);
      new Notice(`${label}: ${error?.message || error}`);
    });
  }

  /** Remove all overlay elements from markdown view containers. */
  _removeAllOverlays() {
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
    this._overlayRefreshHandlers = null;
    this._overlayRegistry?.clear();
    for (const container of this._overlayOriginalPositions?.keys() || []) this._restoreHostPosition(container);
    this._hostPositionMarkers?.clear();
  }

  _restoreHostPosition(container) {
    const original = this._overlayOriginalPositions?.get(container);
    if (!original) return;
    if (original.value) container.style.setProperty('position', original.value, original.priority);
    else container.style.removeProperty('position');
    this._overlayOriginalPositions.delete(container);
    this._hostPositionMarkers?.delete(container);
  }

  /** Plugin-level overlay sync — delegates to each CalendarView instance, then cleans stale ones. */
  _syncAllOverlays() {
    // Delegate to every CalendarView instance
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && typeof view._syncNoteOverlays === 'function') {
        view._syncNoteOverlays();
      }
    }
  }

  /* ----- On This Day ----- */
  openOnThisDay(month, day) {
    const calendarLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const provider = calendarLeaf?.view?._otdProvider;
    if (!provider) return;
    const token = ++this._otdRequestToken;
    provider.getEntries(month, day).then((entries) => {
      if (token !== this._otdRequestToken) return;
      new OnThisDayModal(this.app, this, provider, month, day, entries).open();
    }).catch((err) => {
      console.warn('[Dayline] On This Day load failed:', err?.message || err);
      new Notice(t(this.settings, 'onThisDayLoadFailed', { error: err?.message || err }));
    });
  }

  /* ----- Shared EXIF Tooltip (used by calendar view + note-image hover) ----- */

  _ensureExifTooltip() {
    if (this._exifTooltipEl) return;
    const tip = document.createElement('div');
    tip.className = 'cal-exif-tooltip';
    document.body.appendChild(tip);
    this._exifTooltipEl = tip;
  }

  _showExifTooltip(anchorEl, fields, loading) {
    const tip = this._exifTooltipEl;
    if (!tip || !anchorEl?.isConnected) return;
    const lang = this.settings.weatherLanguage;
    tip.replaceChildren();

    const addText = (tag, className, value) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.textContent = String(value ?? '');
      return el;
    };

    if (loading) {
      tip.appendChild(addText('div', 'cal-exif-tooltip-loading', _l(lang, 'exif_loading')));
    } else if (!fields || fields.length === 0) {
      const empty = addText('div', 'cal-exif-tooltip-empty', '');
      empty.appendChild(addText('div', '', _l(lang, 'exif_noData')));
      empty.appendChild(addText('div', 'cal-exif-tooltip-description', _l(lang, 'exif_noDataDesc')));
      tip.appendChild(empty);
    } else {
      for (const f of fields) {
        const row = addText('div', 'cal-exif-tooltip-row', '');
        row.appendChild(addText('span', 'cal-exif-tooltip-label', _l(lang, f.key)));
        row.appendChild(addText('span', 'cal-exif-tooltip-value', f.value));
        tip.appendChild(row);
      }
    }

    const rect = anchorEl.getBoundingClientRect();
    const tipW = tip.offsetWidth || 180;
    let left = rect.right + 6;
    if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 6;
    if (left < 4) left = 4;
    let top = rect.top;
    const tipH = tip.offsetHeight || 100;
    if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
    if (top < 4) top = 4;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.add('is-visible');
  }

  _hideExifTooltip() {
    if (this._exifTooltipEl) this._exifTooltipEl.classList.remove('is-visible');
  }

  _beginExifHover() {
    clearTimeout(this._exifHoverTimer);
    this._hideExifTooltip();
    return ++this._exifHoverToken;
  }

  _isCurrentExifHover(token) {
    return token === this._exifHoverToken;
  }

  _endExifHover() {
    clearTimeout(this._exifHoverTimer);
    this._exifHoverToken++;
    this._hideExifTooltip();
  }

  async loadSettings() {
    const data = await this.loadData() || {};
    // Extract weather cache separately so it doesn't get overwritten by saveSettings
    this.weatherCache = data.weatherCache || {};
    // Delete stale cache entries to prevent data.json bloat
    this._cleanupWeatherCache();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data, normalizeViewVisibilitySettings(data));
    const legacyWeatherVisible = data.showCalendarWeather !== false;
    if (data.showCalendarWeatherCard === undefined) this.settings.showCalendarWeatherCard = legacyWeatherVisible;
    if (data.showCalendarWeatherBadge === undefined) this.settings.showCalendarWeatherBadge = legacyWeatherVisible;
    this.settings.displayLanguage = getDisplayLanguage({ displayLanguage: data.displayLanguage, weatherLanguage: data.weatherLanguage });
    this.settings.weatherLanguage = this.settings.displayLanguage;
    delete this.settings.weatherCache; // settings object shouldn't carry the cache
  }

  async saveSettings() {
    const settings = { ...this.settings };
    settings.weatherLanguage = settings.displayLanguage || settings.weatherLanguage || 'zh';
    settings.showCalendarWeather = settings.showCalendarWeatherCard !== false || settings.showCalendarWeatherBadge !== false;
    settings.showCalendarView = settings.showCalendarView !== false;
    settings.showTimelineView = settings.showTimelineView === true;
    this.moodStore?.configure(settings);
    await this._enqueueDataWrite((data) => {
      Object.assign(data, settings);
      data.weatherCache = this.weatherCache || {};
    });
  }

  /** Save weather cache without touching settings. Debounced to avoid excessive writes. */
  _saveWeatherCache() {
    if (this._weatherSaveTimer) clearTimeout(this._weatherSaveTimer);
    this._weatherSaveTimer = setTimeout(() => {
      this._weatherSaveTimer = null;
      this._flushWeatherCache().catch((err) => {
        console.warn('[Dayline] Weather cache save failed:', err.message);
      });
    }, 2000); // debounce 2s
  }

  _enqueueDataWrite(mutator) {
    this._dataWriteQueue = (this._dataWriteQueue || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const data = await this.loadData() || {};
        await mutator(data);
        await this.saveData(data);
      });
    return this._dataWriteQueue;
  }

  _flushWeatherCache() {
    if (this._weatherSaveTimer) {
      clearTimeout(this._weatherSaveTimer);
      this._weatherSaveTimer = null;
    }
    return this._enqueueDataWrite((data) => {
      data.weatherCache = this.weatherCache || {};
    });
  }

  /** Remove cache entries older than 90 days. */
  _cleanupWeatherCache() {
    if (!this.weatherCache) return;
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [key, entry] of Object.entries(this.weatherCache)) {
      if (entry && entry.fetchedAt) {
        const timestamp = new Date(entry.fetchedAt).getTime();
        if (!Number.isFinite(timestamp) || timestamp < cutoff) {
          delete this.weatherCache[key];
          removed++;
        }
      }
    }
    if (removed > 0) {
      // Schedule cleanup persist (no urgency)
      clearTimeout(this._weatherCleanupTimer);
      this._weatherCleanupTimer = setTimeout(() => {
        this._weatherCleanupTimer = null;
        this._saveWeatherCache();
      }, 5000);
    }
  }

  _loadStyles() {
    const styleId = 'dayline-styles';
    let style = document.getElementById(styleId);
    if (!style) {
        style = document.createElement('style');
        style.id = styleId;
    }
    style.id = styleId;
    style.textContent = `
.cal-sidebar {
  padding: 8px 6px;
  user-select: none;
  overflow: hidden;
}
.cal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px 8px;
}
.cal-nav {
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-muted);
  line-height: 1;
}
.cal-nav:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.cal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-normal);
}
.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  padding: 2px 0 4px;
  gap: 2px;
}
.cal-weekday {
  padding: 2px 0;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal-day {
  position: relative;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  transition: box-shadow 0.15s ease;
}
.cal-day:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}
.cal-day:active {
  transform: scale(0.95);
}
.cal-day-empty {
  pointer-events: none;
  visibility: hidden;
}
.cal-no-image {
  background: var(--background-secondary-alt);
}
.cal-no-image .cal-day-num {
  color: var(--text-muted);
}
.cal-day-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: 0;
}
.cal-day-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1;
  pointer-events: none;
}
.cal-day-num {
  position: relative;
  z-index: 2;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  line-height: 1;
  pointer-events: none;
}
.cal-today {
  /* Full accent fill */
  background: var(--color-accent) !important;
}
.cal-today.cal-has-image .cal-day-overlay {
  background: rgba(0, 0, 0, 0.55);
}
.cal-today .cal-day-num {
  color: #fff;
}
.cal-today:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}
/* Active (currently viewed date) — accent border only, transparent bg */
.cal-active:not(.cal-today) {
  box-shadow: 0 0 0 2px var(--color-accent);
}
.cal-active:not(.cal-today):hover {
  box-shadow: 0 0 0 2px var(--color-accent), 0 0 0 4px var(--interactive-accent-hover);
}
/* When today is also the active date, today styling takes precedence */

/* --- EXIF tooltip --- */
.cal-exif-tooltip {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  max-width: 240px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  /* Frosted glass */
  background: rgba(30, 30, 30, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.9);
}
.cal-exif-tooltip.is-visible {
  opacity: 1;
}
.cal-exif-tooltip-row {
  display: flex;
  gap: 6px;
  white-space: nowrap;
}
.cal-exif-tooltip-label {
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
  min-width: 36px;
}
.cal-exif-tooltip-value {
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-exif-tooltip-loading {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
}
.cal-exif-tooltip-empty {
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  font-size: 11px;
}
.cal-exif-tooltip-description {
  font-size: 10px;
  margin-top: 2px;
}

/* --- Weather card --- */
.cal-weather-card {
  margin: 4px 2px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  min-height: 0;
}
.cal-weather-icon {
  width: 36px;
  height: 36px;
  object-fit: contain;
  flex-shrink: 0;
}
.cal-weather-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cal-weather-temp {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-normal);
  line-height: 1.2;
}
.cal-weather-detail {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
button.cal-weather-refresh {
  cursor: pointer;
  padding: 0;
  border: none;
  background: none !important;
  box-shadow: none !important;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s ease;
  opacity: 0.65;
}
button.cal-weather-refresh:hover {
  color: var(--text-normal);
  opacity: 1;
  background: none !important;
}
.cal-weather-setup {
  margin: 4px 2px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
  border: 1px dashed var(--background-modifier-border);
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}
.cal-weather-loading {
  opacity: 0.6;
}
.cal-weather-error {
  opacity: 0.7;
}
/* --- Weather badge on day cells --- */
.cal-weather-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  object-fit: contain;
  z-index: 3;
  pointer-events: none;
}

/* --- Daily note weather overlay (Day One style frosted-glass chip) --- */
.cal-note-overlay {
  position: absolute;
  top: 48px;
  right: 8px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 10px;
  /* Frosted glass — progressive enhancement with rgba fallback */
  background: rgba(40, 40, 45, 0.72);
  background: color-mix(in srgb, var(--background-secondary) 60%, transparent);
  backdrop-filter: blur(8px) saturate(130%);
  -webkit-backdrop-filter: blur(8px) saturate(130%);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border: 1px solid color-mix(in srgb, var(--background-modifier-border) 50%, transparent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: var(--text-normal);
  pointer-events: auto;
  max-width: 320px;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.cal-note-overlay.is-visible {
  opacity: 1;
  transform: translateY(0);
}
.cal-note-overlay .cal-overlay-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}
.cal-note-overlay .cal-overlay-info {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  overflow: hidden;
}
.cal-note-overlay .cal-overlay-temp {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal);
  line-height: 1.3;
}
.cal-note-overlay .cal-overlay-detail {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-note-overlay button.cal-overlay-refresh {
  cursor: pointer;
  padding: 0;
  border: none;
  background: none !important;
  box-shadow: none !important;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  opacity: 0.65;
}
.cal-note-overlay button.cal-overlay-refresh:hover {
  color: var(--text-normal);
  opacity: 1;
  background: none !important;
}
.cal-note-overlay .is-loading {
  opacity: 0.5;
}
.cal-note-overlay .spin {
  animation: cal-spin 1s linear infinite;
}
@keyframes cal-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .cal-note-overlay,
  .cal-note-overlay.is-visible {
    transition: none;
  }
  .cal-note-overlay .spin {
    animation-duration: 2s;
  }
}
/* --- On This Day --- */
.cal-otd-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.cal-otd-button:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.cal-otd-dot {
  position: absolute;
  bottom: 3px;
  right: 3px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-accent);
  opacity: 0.5;
  z-index: 3;
  pointer-events: none;
}
/* --- On This Day Modal (photo wall) --- */
.cal-otd-modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.cal-otd-panel {
  width: 560px;
  max-height: 85vh;
  background: var(--background-primary);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.theme-light .cal-otd-panel {
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0,0,0,0.06);
}
.theme-dark .cal-otd-panel {
  background: rgba(40,40,40,0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.1);
}
.cal-otd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}
.cal-otd-header-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-normal);
}
.cal-otd-close {
  cursor: pointer;
  font-size: 16px;
  color: var(--text-muted);
  width: 28px; height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background 0.15s;
}
.cal-otd-close:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.cal-otd-date-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cal-otd-date-input {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal);
  background: transparent;
  border: none;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  min-width: 110px;
  text-align: center;
  font-family: inherit;
  outline: none;
}
.cal-otd-date-input:hover {
  background: var(--background-modifier-hover);
}
.cal-otd-date-input::-webkit-calendar-picker-indicator {
  opacity: 0.5;
  cursor: pointer;
}
.cal-otd-date-input::-webkit-calendar-picker-indicator:hover {
  opacity: 1;
}
.cal-otd-empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 13px;
}
/* 2-column photo wall */
.cal-otd-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 0 16px 16px;
  overflow-y: auto;
}
.cal-otd-wall-card {
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.15s;
  background: var(--background-secondary-alt);
}
.cal-otd-wall-card:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}
.cal-otd-wall-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 8px 10px 4px;
}
.cal-otd-wall-photo {
  width: 100%;
  aspect-ratio: 1;
  background-size: cover;
  background-position: center top;
}
.cal-otd-wall-text {
  padding: 16px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 80px;
}
.cal-otd-wall-text-empty {
  font-style: italic;
  opacity: 0.5;
}
.cal-otd-wall-excerpt {
  padding: 6px 10px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (max-width: 480px) {
  .cal-otd-panel { width: 94vw; }
  .cal-otd-grid { grid-template-columns: 1fr; }
}
.cal-mood-button {
  position: absolute;
  left: 2px;
  bottom: 2px;
  z-index: 4;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cal-mood-empty { opacity: 0; }
.cal-day:hover .cal-mood-empty, .cal-mood-empty:focus-visible { opacity: 1; }
.cal-mood-empty .cal-mood-dot { width: 8px; height: 8px; border: 1px solid var(--text-faint); background: transparent; }
.cal-mood-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--journal-mood-color); }
.cal-mood-button:hover .cal-mood-dot { box-shadow: 0 0 0 2px color-mix(in srgb, var(--journal-mood-color) 35%, transparent); }
.cal-mood-button.mood-2 { --journal-mood-color: #4b93d1; }
.cal-mood-button.mood-1 { --journal-mood-color: #56a86a; }
.cal-mood-button.mood-0 { --journal-mood-color: #d9bd4c; }
.cal-mood-button.mood--1 { --journal-mood-color: #e68a3b; }
.cal-mood-button.mood--2 { --journal-mood-color: #d84b76; }
.journal-timeline-view { box-sizing: border-box; width: 100%; min-width: 0; padding: 14px; overflow-x: hidden; overflow-y: auto; }
.journal-timeline-header, .journal-timeline-entry-top, .journal-timeline-meta, .journal-timeline-actions, .journal-timeline-filter-row, .journal-timeline-filter-menu, .journal-mood-actions { display: flex; align-items: center; min-width: 0; }
.journal-timeline-header { justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.journal-timeline-heading { display: flex; align-items: baseline; gap: 7px; min-width: 0; overflow: hidden; }
.journal-timeline-heading h2 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; font-size: 18px; }
.journal-timeline-count { flex: 0 0 auto; color: var(--text-muted); font-size: 12px; }
.journal-timeline-actions { flex: 0 0 auto; gap: 4px; }
.journal-timeline-actions button, .journal-timeline-filter-row > button { width: 28px; height: 28px; padding: 5px; flex: 0 0 28px; }
.journal-timeline-filter-area, .journal-timeline-filter-row, .journal-timeline-filter-summary { width: 100%; min-width: 0; }
.journal-timeline-filter-row { gap: 6px; margin-bottom: 6px; }
.journal-timeline-filter-row input[type='search'] { flex: 1 1 auto; width: 1px; min-width: 0; }
.journal-timeline-filter-menu { flex-wrap: wrap; gap: 6px; padding: 7px; margin-bottom: 6px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); }
.journal-timeline-filter-menu.is-hidden { display: none; }
.journal-timeline-filter-menu input[type='date'], .journal-timeline-filter-menu select { flex: 1 1 100px; min-width: 0; max-width: 160px; }
.journal-timeline-favorite-filter { display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: var(--text-muted); font-size: 12px; }
.journal-timeline-filter-summary { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.journal-filter-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 7px; font-size: 11px; }
.journal-timeline-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; min-width: 0; margin-bottom: 12px; }
.journal-stat { min-width: 0; overflow: hidden; padding: 6px 0; border-bottom: 1px solid var(--background-modifier-border); }
.journal-stat-value { font-size: 15px; color: var(--text-normal); }
.journal-stat-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 11px; }
.journal-stat-trend { grid-column: 1 / -1; min-width: 0; }
.journal-stat-trend-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-top: 4px; }
.journal-stat-trend-cell { min-width: 0; height: 7px; border-radius: 3px; }
.journal-timeline-list { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; min-width: 0; gap: 8px; }
.journal-timeline-entry { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; gap: 10px; padding: 10px; border: 1px solid var(--background-modifier-border); border-left: 4px solid var(--background-modifier-border); border-radius: 7px; cursor: pointer; background: var(--background-primary); }
.journal-timeline-entry.has-thumbnail { grid-template-columns: minmax(0, 1fr) 88px; }
.journal-timeline-entry.mood-score-2 { border-left-color: #4b93d1; }
.journal-timeline-entry.mood-score-1 { border-left-color: #56a86a; }
.journal-timeline-entry.mood-score-0 { border-left-color: #d9bd4c; }
.journal-timeline-entry.mood-score--1 { border-left-color: #e68a3b; }
.journal-timeline-entry.mood-score--2 { border-left-color: #d84b76; }
.journal-timeline-entry:hover, .journal-timeline-entry:focus-visible { border-right-color: var(--interactive-accent); outline: none; }
.journal-timeline-entry-body { min-width: 0; overflow: hidden; }
.journal-timeline-entry-top { flex-wrap: wrap; gap: 4px 7px; min-width: 0; color: var(--text-muted); }
.journal-timeline-entry-date { flex: 0 1 auto; min-width: 0; max-width: 100%; margin: 0; overflow: hidden; color: var(--text-normal); font-size: 14px; font-weight: 600; }
.journal-timeline-entry-iso { display: none; }
.journal-timeline-favorite { flex: 0 0 auto; color: var(--text-accent); font-size: 11px; }
.journal-timeline-title { min-width: 0; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-normal); font-size: 13px; }
.journal-timeline-excerpt { min-width: 0; max-width: 100%; margin-top: 4px; overflow: hidden; overflow-wrap: anywhere; color: var(--text-muted); font-size: 12px; line-height: 1.45; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.journal-timeline-meta { flex-wrap: wrap; gap: 5px 10px; min-width: 0; margin-top: 6px; overflow-wrap: anywhere; color: var(--text-faint); font-size: 11px; }
.journal-timeline-thumbnail { position: relative; width: 88px; height: 88px; min-width: 88px; overflow: hidden; border-radius: 5px; background: var(--background-secondary); }
.journal-timeline-thumbnail img { display: block; width: 88px; height: 88px; object-fit: cover; opacity: 0; transition: opacity 0.15s ease; }
.journal-timeline-thumbnail.is-loaded img { opacity: 1; }
.journal-timeline-thumbnail-count { position: absolute; right: 4px; bottom: 4px; padding: 1px 4px; border-radius: 4px; background: rgba(0, 0, 0, 0.65); color: #fff; font-size: 10px; }
.journal-timeline-empty { min-width: 0; padding: 28px 8px; overflow-wrap: anywhere; color: var(--text-muted); text-align: center; }
.journal-mood-picker-modal .modal-content { min-width: 320px; }
.journal-mood-picker h3 { margin-bottom: 4px; }
.journal-mood-date-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 14px; color: var(--text-muted); font-size: 12px; }
.journal-mood-date-field input { min-width: 0; max-width: 150px; }
.journal-mood-step { color: var(--text-muted); margin: 0 0 16px; }
.journal-mood-scale { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; }
.journal-mood-level { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; min-height: 76px; gap: 6px; color: var(--journal-mood-color); border: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
.journal-mood-level:hover, .journal-mood-level:focus-visible, .journal-mood-level[aria-checked='true'] { border-color: var(--journal-mood-color); outline: none; }
.journal-mood-level[aria-checked='true'] { box-shadow: 0 0 0 2px color-mix(in srgb, var(--journal-mood-color) 35%, transparent); }
.journal-mood-level[aria-checked='true']::after { content: '✓'; position: absolute; top: 3px; right: 5px; font-size: 12px; }
.journal-mood-dot { display: block; width: 24px; height: 24px; flex: 0 0 24px; border-radius: 50%; background: var(--journal-mood-color); }
.journal-mood-level-label { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.journal-mood-selected { color: var(--text-muted); text-align: center; font-size: 12px; margin-top: 10px; }
.journal-mood-labels { display: flex; flex-wrap: wrap; gap: 7px; }
.journal-mood-label[aria-pressed='true'] { border-color: var(--interactive-accent); color: var(--text-accent); background: var(--background-modifier-hover); }
.journal-mood-actions { justify-content: space-between; gap: 8px; margin-top: 22px; }
@media (max-width: 420px) {
  .journal-timeline-view { padding: 10px; }
  .journal-timeline-entry.has-thumbnail { grid-template-columns: minmax(0, 1fr) 72px; }
  .journal-timeline-thumbnail, .journal-timeline-thumbnail img { width: 72px; height: 72px; min-width: 72px; }
}
@media (prefers-reduced-motion: reduce) {
  .journal-mood-picker *, .journal-timeline-entry { transition: none !important; animation: none !important; }
}
`;
    if (!style.parentElement) {
    document.head.appendChild(style);
}
  }

  async activateView() {
    const opened = await this.viewVisibilityController.open('calendar');
    this._syncDaylineRibbon();
    return opened;
  }

  async _openCalendarView() {
    const { workspace } = this.app;

    // Create a vertical-split leaf in the left sidebar.
    let leaf = workspace.getLeftLeaf(true);
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
    }
    if (!leaf) {
      new Notice('Dayline: could not create calendar leaf');
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);

    // Move calendar container above file explorer.
    try {
      const ls = workspace.leftSplit;
      if (ls && ls.children && ls.containerEl) {
        let calContainer, feContainer;
        for (const child of ls.children) {
          if (!child.children) continue;
          for (const lf of child.children) {
            const vt = lf.view?.getViewType?.();
            if (vt === VIEW_TYPE) calContainer = child;
            if (vt === 'file-explorer') feContainer = child;
          }
        }
        if (calContainer && feContainer) {
          // Children array: move to index 0
          const idx = ls.children.indexOf(calContainer);
          if (idx > 0) {
            ls.children.splice(idx, 1);
            ls.children.splice(0, 0, calContainer);
          }
          // DOM: insert before file explorer's container
          ls.containerEl.insertBefore(
            calContainer.containerEl,
            feContainer.containerEl
          );
        }
      }
    } catch (_) {
      // Non-critical — calendar still works, just at the bottom
    }
  }
}


/* ============================================================
   Calendar View (ItemView)
   ============================================================ */
class CalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
    // Track the displayed month — derive it from the configured Dayline date
    // context so the calendar cannot lag behind the weather/reminder date.
    const [todayYear, todayMonth] = _daylineDate(this.plugin.settings).split('-').map(Number);
    this.displayMonth = new Date(todayYear, todayMonth - 1, 1);
    // Cache: "2026-7" → Map<"2026-07-15", embedLink[]>
    this.monthCache = new Map();
    this._refreshTimer = null;
    // Currently viewed date (YYYY-MM-DD), used for highlight
    this.activeDate = null;
    // Shared WeatherService from plugin (singleton)
    this.weather = plugin.weatherService;
    // Weather card element reference for live updates
    this._weatherCardEl = null;
    // Which date the current card is showing (prevents stale updates)
    this._weatherCardDate = null;
    // Weather state for today/active date
    this._weatherSnapshot = null;
    this._weatherLoading = false;
    this._weatherError = false;
    // Staleness guard: incremented on each render to discard stale async results
    this._fetchToken = 0;
    // Overlay sync: track which overlays exist per leaf to avoid duplicates
    this._overlayLeaves = new WeakSet();
    // In-flight dedup: leaf → promise, prevents concurrent duplicate fetch+mount
    this._overlayInFlight = new WeakMap();
    // Per-leaf version counter to discard stale async mounts
    this._overlayVersions = new WeakMap();
    // Track containers where we set position:relative so we can revert on unload
    this._hostPositionMarkers = new Set();
    // Containers whose shared overlays are claimed by this view
    this._overlayContainers = new Set();
    // EXIF metadata cache (shared with plugin)
    this.exifCache = plugin.exifCache;
    // Track processed note-image elements (cleared when view is destroyed)
    this._exifNoteImages = new WeakSet();
    // On This Day provider
    this._otdProvider = new OnThisDayProvider(plugin);
    // Cache for quick dot-marker lookup: Set<"MM-DD">
    this._otdDotCache = null;
  }

  getViewType()   { return VIEW_TYPE; }
  getDisplayText(){ return t(this.plugin.settings, 'calendarTitle'); }
  getIcon()       { return 'calendar'; }

  /* ----- Lifecycle ----- */
  async onOpen() {
    this.containerEl.addClass('cal-sidebar');
    this._unsubscribeIndex = this.plugin.journalIndex?.subscribe?.(() => {
      this.refresh().catch((error) => console.warn('[Dayline] Calendar index refresh failed:', error?.message || error));
    });

    // Build data for current month
    try {
      await this.buildMonthCache(this.displayMonth);
    } catch (error) {
      console.warn('[Dayline] Initial calendar month load failed:', error?.message || error);
      this.monthCache.delete(this._monthKey(this.displayMonth));
      new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
    }

    // Preload On This Day date index for dot markers
    this._otdProvider.ensureDateIndex().then(() => {
      this._otdDotCache = this._otdProvider.dateIndexSnapshot;
      if (this.plugin.settings.onThisDayDot) this.render(); // re-render to show dots
    }).catch((error) => {
      console.warn('[Dayline] On This Day index load failed:', error?.message || error);
      new Notice(t(this.plugin.settings, 'onThisDayLoadFailed', { error: error?.message || error }));
    });

    // Detect which date the user is currently viewing
    this._syncActiveDate();
    this.render();

  }

  onClose() {
    this._unsubscribeIndex?.();
    this._unsubscribeIndex = null;
    clearTimeout(this._refreshTimer);
    clearTimeout(this._exifNoteTimer);
    this.plugin._endExifHover();
    for (const observer of this._exifObservers?.values() || []) observer.disconnect();
    this._exifObservers?.clear();
    this._removeAllOverlaysFromViews();
    this._hostPositionMarkers.clear();
    this.plugin.viewVisibilityController?.viewClosed('calendar')
      .then(() => this.plugin._syncDaylineRibbon())
      .catch((error) => console.warn('[Dayline] Calendar close state sync failed:', error?.message || error));
  }

  _handleActiveLeafChange() {
    this._syncActiveDate();
    // Defer to avoid race with click handler calling openFile.
    setTimeout(() => this.render(), 0);
  }

  /* ----- File change refresh (debounced) ----- */
  _onImageChanged(file) {
    if (!(file instanceof TFile)) return;

    const extension = file.extension?.toLowerCase();
    if (!IMAGE_EXTS.includes(extension)) return;
    this.exifCache?.invalidate(file.path);
    this.plugin.heicCache?.invalidate(file.path);
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(async () => {
      try {
        this.monthCache.clear();
        await this.buildMonthCache(this.displayMonth);
        this.render();
      } catch (error) {
        console.warn('[Dayline] Calendar image refresh failed:', error?.message || error);
        this.monthCache.delete(this._monthKey(this.displayMonth));
        new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
      }
    }, 300);
  }

  /* ----- Public refresh (called from plugin and index updates) ----- */
  async refresh() {
    this.monthCache.delete(this._monthKey(this.displayMonth));
    if (this.exifCache) this.exifCache.invalidate();
    if (this._otdProvider) this._otdProvider.invalidate();
    this._otdDotCache = null;
    await this.buildMonthCache(this.displayMonth);
    this.render();
    // Rebuild OTD dot cache async
    if (this._otdProvider && this.plugin.settings.onThisDayDot) {
      this._otdProvider.ensureDateIndex().then(() => {
        this._otdDotCache = this._otdProvider.dateIndexSnapshot;
        this.render();
      }).catch((error) => {
        console.warn('[Dayline] On This Day index refresh failed:', error?.message || error);
        new Notice(t(this.plugin.settings, 'onThisDayLoadFailed', { error: error?.message || error }));
      });
    }
  }

  /* ----- Month cache key ----- */
  _monthKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }

  /* ----- Build cache for a given month ----- */
  async buildMonthCache(monthDate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const key = this._monthKey(monthDate);

    if (this.monthCache.has(key)) return;
    this.monthCache.set(key, new Map()); // placeholder

    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const map = new Map();

    for (const entry of this.plugin.journalIndex?.getEntries?.() || []) {
      const dateStr = entry.date;
      if (!dateStr.startsWith(prefix)) continue;

      const current = map.get(dateStr) || {
        path: entry.path,
        mood: entry.mood,
        images: [],
      };
      if (!current.path || entry.sourceType === 'daily') current.path = entry.path;
      if (!current.mood && entry.mood) current.mood = entry.mood;

      let images = (entry.attachments || []).filter(_isImageLink);
      if (this.plugin.settings.thumbnailFilter === 'date-prefixed') {
        images = images.filter((link) => {
          const fileName = String(link).split(/[\\/]/).pop()?.split('|', 1)[0] || '';
          return fileName.startsWith(dateStr);
        });
      }
      for (const link of images) {
        if (!current.images.some((item) => item.link === link && item.sourcePath === entry.path)) {
          current.images.push({ link, sourcePath: entry.path });
        }
      }
      map.set(dateStr, current);
    }

    this.monthCache.set(key, map);
  }

  /* ----- Render the calendar ----- */
  render() {
    // Bump fetch token so stale async results are discarded
    this._fetchToken = (this._fetchToken || 0) + 1;

    const el = this.contentEl;
    el.empty();

    // Ensure EXIF tooltip element exists (reused across renders)
    this._ensureExifTooltip();

    const year = this.displayMonth.getFullYear();
    const month = this.displayMonth.getMonth();
    const key = this._monthKey(this.displayMonth);
    const imageMap = this.monthCache.get(key) || new Map();

    // --- Header: month navigation ---
    const header = el.createDiv({ cls: 'cal-header' });
    const prevBtn = header.createEl('span', { cls: 'cal-nav' });
    prevBtn.setText('◀');
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._goToMonth(-1);
    });

    const title = header.createEl('span', { cls: 'cal-title' });
    title.setText(formatCalendarMonth(year, month + 1, this.plugin.settings));

    const nextBtn = header.createEl('span', { cls: 'cal-nav' });
    nextBtn.setText('▶');
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._goToMonth(1);
    });

    // --- Weather card (below header, above weekdays) ---
    this._renderWeatherCard(el);

    // --- On This Day button (below weather card) ---
    if (this.plugin.settings.onThisDayButton) {
      const otdBtn = el.createDiv({ cls: 'cal-otd-button' });
      const [, todayMonth, todayDay] = _daylineDate(this.plugin.settings).split('-').map(Number);
      const tm = todayMonth, td = todayDay;
      otdBtn.setText(_l(this.plugin.settings.weatherLanguage, 'otd_button', tm, td));
      otdBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const [, monthNumber, dayNumber] = _daylineDate(this.plugin.settings).split('-').map(Number);
        this.plugin.openOnThisDay(monthNumber, dayNumber);
      });
    }

    // --- Weekday row ---
    const wd = el.createDiv({ cls: 'cal-weekdays' });
    for (const day of getCalendarWeekdays(this.plugin.settings)) {
      wd.createEl('span', { cls: 'cal-weekday', text: day });
    }

    // --- Grid ---
    const grid = el.createDiv({ cls: 'cal-grid' });

    const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0=Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = _daylineDate(this.plugin.settings);

    // Empty cells before the 1st
    for (let i = 0; i < firstDay; i++) {
      grid.createDiv({ cls: 'cal-day cal-day-empty' });
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatDateParts(year, month + 1, d);
      const dateEntry = imageMap.get(dateStr) || { path: null, mood: undefined, images: [] };
      const images = dateEntry.images;
      const isToday = dateStr === todayStr;

      const cell = grid.createDiv({ cls: 'cal-day' });
      if (images.length > 0) cell.addClass('cal-has-image');
      else cell.addClass('cal-no-image');
      if (isToday) cell.addClass('cal-today');
      if (dateStr === this.activeDate && !isToday) cell.addClass('cal-active');

      // Background image (first image as thumbnail)
      if (images.length > 0) {
        const bg = cell.createDiv({ cls: 'cal-day-bg' });
        const overlay = cell.createDiv({ cls: 'cal-day-overlay' });
        this._setBackground(bg, images[0].link, dateStr, images[0].sourcePath);

        // EXIF tooltip on hover
        const firstImage = images[0];
        cell.addEventListener('mouseenter', () => this._onExifEnter(cell, firstImage.link, dateStr, firstImage.sourcePath));
        cell.addEventListener('mouseleave', () => this._onExifLeave());
      }

      // Weather badge for dates with cached weather
      if (this.plugin.settings.weatherEnabled
        && shouldShowCalendarWeatherBadge(this.plugin.settings)
        && this.weather.hasCachedSnapshot(dateStr, dateEntry.path)) {
        const snap = this._readCachedWeather(dateStr, dateEntry.path);
        if (snap) {
        const badge = cell.createEl('img', { cls: 'cal-weather-badge' });
        badge.src = _iconUrl(snap.icon) || '';
        badge.alt = snap.condition;
          badge.setAttribute('aria-label', `${snap.condition}, ${snap.temperature}${this._unitSymbol(snap.units)}`);
          badge.title = `${snap.condition} · ${snap.temperature}${this._unitSymbol(snap.units)}`;
        }
      }

      // Mood is stored outside Markdown. A frontmatter-only mood remains
      // visible through the index until the user explicitly imports it.
      const dailyPath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      const mood = shouldShowCalendarMood(this.plugin.settings)
        ? this.plugin.moodStore?.get(dailyPath)
          || dateEntry.mood
        : undefined;
      const moodPath = dateEntry.path || dailyPath;
      if (shouldShowCalendarMood(this.plugin.settings)) {
        const moodButton = cell.createEl('button', {
          cls: `cal-mood-button ${mood ? `mood-${mood.score}` : 'cal-mood-empty'}`,
          attr: {
            type: 'button',
            'aria-label': `${t(this.plugin.settings, 'recordMood')}: ${dateStr}`,
            title: mood ? moodLabel(this.plugin.settings, mood.score) : `${t(this.plugin.settings, 'recordMood')}: ${dateStr}`,
          },
        });
        if (mood) moodButton.style.setProperty('--journal-mood-color', getMoodColor(mood.score));
        moodButton.createSpan({ cls: 'cal-mood-dot', attr: { 'aria-hidden': 'true' } });
        moodButton.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.plugin.openMoodPicker(moodPath, { allowDateSelection: true, ensureFile: false });
        });
      }

      // On This Day dot marker
      if (this.plugin.settings.onThisDayDot && this._otdDotCache) {
        const mmdd = `${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (this._otdDotCache.has(mmdd) && dateStr !== todayStr) {
          cell.createDiv({ cls: 'cal-otd-dot' });
        }
      }

      // Date number
      const num = cell.createEl('span', { cls: 'cal-day-num', text: String(d) });

      // Click to open daily note — use pointerdown (fires before leaf activation)
      // so the first click after sidebar focus loss is not absorbed by Obsidian.
      cell.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._openNote(dateStr, dateEntry.path);
      });
    }
  }

  /* ----- EXIF Tooltip (delegates to plugin) ----- */

  _ensureExifTooltip() { this.plugin._ensureExifTooltip(); }
  _showExifTooltip(el, fields, loading) { this.plugin._showExifTooltip(el, fields, loading); }
  _hideExifTooltip() { this.plugin._hideExifTooltip(); }

  /** Mouse entered a day cell with an image — start the hover timer. */
  _onExifEnter(cell, imageLink, dateStr, sourcePath) {
    if (!this.plugin.settings.showExif) return;
    const hoverToken = this.plugin._beginExifHover();

    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        const notePath = sourcePath || `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
        const file = this.app.metadataCache.getFirstLinkpathDest(imageLink, notePath);
        if (!(file instanceof TFile)) return;
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(cell, null, true);
        const fields = await this.exifCache.get(file);
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(cell, fields, false);

        // Reverse geocode GPS coordinates asynchronously
        if (this.plugin.settings.exifReverseGeocode && fields && this.plugin.geocoder) {
          const gpsField = fields.find(f => f.key === 'exif_gps');
          if (gpsField) {
            const parts = gpsField.value.split(',').map(s => parseFloat(s.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              const place = await this.plugin.geocoder.lookup(parts[0], parts[1]);
              if (place && this.plugin._isCurrentExifHover(hoverToken)) {
                gpsField.value = place;
                this.plugin._showExifTooltip(cell, fields, false);
              }
            }
          }
        }
      } catch (_) {
        this.plugin._hideExifTooltip();
      }
    }, 500);
  }

  _onExifLeave() {
    this.plugin._endExifHover();
  }

  /* ----- Read cached weather from plugin data (no more YAML pollution) ----- */
  _readCachedWeather(dateStr, sourcePath) {
    const entry = this.weather.getCachedSnapshot(dateStr, sourcePath);
    if (entry && typeof entry === 'object') {
      // Normalize icon: migrate emoji → .svg filename
      if (typeof entry.icon === 'string' && !entry.icon.endsWith('.svg') && entry.weatherCode != null) {
        entry.icon = lookupWeatherCode(entry.weatherCode).icon;
      }
      return entry;
    }
    return null;
  }

  /* ----- Render weather card below month header (idempotent) ----- */
  _renderWeatherCard(containerEl) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled || !shouldShowCalendarWeatherCard(s)) {
      // Don't show anything when weather is disabled — avoid intrusive UI
      return;
    }

    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) {
      const hint = containerEl.createDiv({ cls: 'cal-weather-setup' });
      hint.setText(_l(s.weatherLanguage, 'setupHint'));
      hint.setAttribute('aria-label', _l(s.weatherLanguage, 'setupAria'));
      return;
    }

    // Use activeDate or today for the card
    const cardDate = this.activeDate || _daylineDate(this.plugin.settings);

    // Idempotency guard: if a card already exists for this date and has valid data, reuse it
    if (this._weatherCardDate === cardDate && this._weatherCardEl && this._weatherCardEl.isConnected) {
      // Card already exists for this date — just update badge rendering via full render
      return;
    }

    // Capture existing snapshot BEFORE resetting state
    const sameCardDate = this._weatherCardDate === cardDate;
    const existingSnap = sameCardDate && this._weatherSnapshot
      && this.weather.isSnapshotCompatible(this._weatherSnapshot)
      ? this._weatherSnapshot
      : null;

    // Different date or stale card — reset state and create fresh card
    this._weatherCardDate = cardDate;
    this._weatherSnapshot = existingSnap;
    this._weatherLoading = !existingSnap;
    this._weatherError = false;

    const card = containerEl.createDiv({
      cls: this._weatherLoading ? 'cal-weather-card cal-weather-loading' : 'cal-weather-card',
    });
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    this._weatherCardEl = card;

    const iconEl = card.createEl('img', { cls: 'cal-weather-icon' });
    const loading = this._weatherLoading ? '\u231B\uFE0F' : '';
    if (loading) iconEl.alt = loading;
    else { iconEl.src = _iconUrl('overcast.svg'); iconEl.alt = 'weather'; }

    const infoEl = card.createDiv({ cls: 'cal-weather-info' });
    const tempEl = infoEl.createDiv({ cls: 'cal-weather-temp' });
    const detailEl = infoEl.createDiv({ cls: 'cal-weather-detail' });
    tempEl.setText(_l(s.weatherLanguage, 'loading'));
    detailEl.setText(cardDate);

    // Native Obsidian refresh icon button
    const refreshBtn = card.createEl('button', {
      cls: 'cal-weather-refresh',
      attr: { 'aria-label': 'Refresh weather', title: 'Refresh weather' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._performRefresh(cardDate, refreshBtn).catch((err) => {
        console.warn('[Dayline] Refresh weather from card failed:', err.message);
      });
    });

    // Start background fetch only if we don't have an existing snapshot
    if (this._weatherLoading) {
      this._fetchWeatherForDate(cardDate);
    } else {
      this._updateWeatherCardUI();
    }
  }

  /* ----- Update weather card UI after async data arrives ----- */
  _updateWeatherCardUI() {
    const card = this._weatherCardEl;
    if (!card || !card.isConnected) return;
    const lang = this.plugin.settings.weatherLanguage;

    card.removeClass('cal-weather-loading');

    if (this._weatherError) {
      card.addClass('cal-weather-error');
      const iconEl = card.querySelector('.cal-weather-icon');
      if (iconEl) { iconEl.src = ''; iconEl.alt = '⚠️'; }
      card.querySelector('.cal-weather-temp').setText(_l(lang, 'unavailable'));
      card.querySelector('.cal-weather-detail').setText(_l(lang, 'checkSettings'));
      return;
    }

    const snap = this._weatherSnapshot;
    if (!snap) {
      const iconEl = card.querySelector('.cal-weather-icon');
      if (iconEl) iconEl.src = _iconUrl('overcast.svg');
      card.querySelector('.cal-weather-temp').setText('—');
      card.querySelector('.cal-weather-detail').setText(_l(lang, 'noData'));
      return;
    }

    const iconEl = card.querySelector('.cal-weather-icon');
    if (iconEl) {
      iconEl.src = _iconUrl(snap.icon) || '';
      iconEl.alt = snap.condition;
      iconEl.title = snap.condition;
    }

    const tempEl = card.querySelector('.cal-weather-temp');
    const unitSym = this._unitSymbol(snap.units);
    const labelKey = snap.temperatureLabel === 'Now' ? 'now' : 'high';
    const label = _l(lang, labelKey);
    tempEl.setText(`${label} ${snap.temperature ?? '?'}${unitSym}`);

    const detailEl = card.querySelector('.cal-weather-detail');
    const parts = [];
    if (snap.feelsLike != null) parts.push(`${_l(lang, 'feels')} ${snap.feelsLike}${unitSym}`);
    if (snap.humidity != null) parts.push(`${_l(lang, 'humidity')} ${snap.humidity}%`);
    if (snap.low != null) parts.push(`${_l(lang, 'low')} ${snap.low}${unitSym}`);
    detailEl.setText(parts.join(' · ') || snap.location);
    detailEl.title = snap.location;

    card.removeAttribute('aria-live');
  }

  /* ----- Fetch weather for a date in the background ----- */
  async _fetchWeatherForDate(dateStr) {
    const token = this._fetchToken;
    try {
      const snap = await this.weather.getSnapshot(dateStr);
      // Discard stale results if render() was called again since we started fetching
      if (token !== this._fetchToken || this._weatherCardDate !== dateStr) return;
      this._weatherSnapshot = snap;
      this._weatherError = !snap;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      // Do NOT call full render here — it would recreate the card and trigger another fetch.
      // Weather badges on day cells will appear on the next normal render cycle.
    } catch (err) {
      if (token !== this._fetchToken || this._weatherCardDate !== dateStr) return;
      this._weatherError = true;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
    }
  }

  /* ----- Explicit weather refresh (command / button) ----- */
  async refreshWeather(dateStr) {
    dateStr = dateStr || this.activeDate || _daylineDate(this.plugin.settings);
    await this._performRefresh(dateStr, null);
  }

  /* ----- Perform a refresh with loading/disabled state on the button ----- */
  async _performRefresh(dateStr, btnEl) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return;
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) return;

    // Set button to loading state immediately
    let wasLoading = false;
    if (btnEl) {
      btnEl.setAttribute('disabled', '');
      btnEl.addClass('is-loading');
      wasLoading = true;
    } else {
      this._weatherLoading = true;
    }

    const renderToken = this._fetchToken;
    try {
      const snap = await this.weather.forceRefresh(dateStr);
      if (renderToken !== this._fetchToken || this._weatherCardDate !== dateStr) return;
      this._weatherSnapshot = snap;
      this._weatherError = !snap;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      this.render();
      const lang = this.plugin.settings.weatherLanguage;
      if (snap) {
        new Notice(_l(lang, 'weatherUpdated', dateStr));
      } else {
        new Notice(_l(lang, 'noDataFor', dateStr));
      }
    } catch (err) {
      this._weatherError = true;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      const lang = this.plugin.settings.weatherLanguage;
      new Notice(_l(lang, 'refreshFailed', err.message || 'unknown error'));
    } finally {
      // Always restore button state
      if (wasLoading && btnEl) {
        btnEl.removeAttribute('disabled');
        btnEl.removeClass('is-loading');
      }
    }
  }

  /* ----- Unit symbol helper ----- */
  _unitSymbol(units) {
    return units === 'imperial' ? '\u00B0F' : '\u00B0C'; // °F / °C
  }

  /* ----- Resolve and set background image ----- */
  async _setBackground(bgEl, link, dateStr, sourcePath) {
    try {
      const notePath = sourcePath || `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      const result = await this.plugin.thumbnailService.load(link, notePath);
      if (result && bgEl.isConnected) bgEl.style.backgroundImage = `url("${result.url}")`;
    } catch (_) {
      // silent
    }
  }

  /* ----- Navigate months ----- */
  _goToMonth(delta) {
    const newMonth = new Date(this.displayMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    this.displayMonth = newMonth;

    this.buildMonthCache(this.displayMonth).then(() => this.render()).catch((error) => {
      console.warn('[Dayline] Calendar month load failed:', error?.message || error);
      this.monthCache.delete(this._monthKey(this.displayMonth));
      new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
    });
  }

  /* ----- Open (or create + open) daily note ----- */
  _openNote(dateStr, indexedPath) {
    const indexedFile = indexedPath && this.app.vault.getAbstractFileByPath(indexedPath);
    const path = indexedFile instanceof TFile
      ? indexedPath
      : `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);

    const openFileInLeaf = (f) => {
      const activeLeaf = this.app.workspace.activeLeaf;
      const isMarkdown = activeLeaf?.view?.getViewType?.() === 'markdown';
      const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
      const leaf = isMarkdown
        ? activeLeaf                        // use active tab if it's a markdown view
        : (mdLeaves.length > 0 ? mdLeaves[0] : this.app.workspace.getLeaf(true));
      if (!leaf) {
        const error = 'No markdown leaf is available';
        console.warn('[Dayline] Open note failed:', error);
        new Notice(t(this.plugin.settings, 'openNoteFailed', { error }));
        return;
      }
      leaf.openFile(f).then(() => {
        this._syncActiveDate(leaf);
        this.render();
        // Trigger background weather load after note opens (non-blocking)
        this._triggerWeatherAfterOpen(dateStr);
      }).catch((error) => {
        console.warn('[Dayline] Open note failed:', error?.message || error);
        new Notice(t(this.plugin.settings, 'openNoteFailed', { error: error?.message || error }));
      });
    };

    if (file instanceof TFile) {
      openFileInLeaf(file);
    } else {
      // File doesn't exist — ask user to confirm creation
      new CreateNoteModal(this.app, dateStr, () => {
        this._createDailyNote(path, dateStr).then((created) => {
          openFileInLeaf(created);
          // Trigger weather after note is created and opened
          setTimeout(() => this._triggerWeatherAfterOpen(dateStr), 500);
        }).catch((error) => {
          console.warn('[Dayline] Create daily note failed:', error?.message || error);
          new Notice(t(this.plugin.settings, 'createNoteFailed', { error: error?.message || error }));
        });
      }).open();
    }
  }

  /* ----- Trigger weather fetch after note open/create (non-blocking) ----- */
  _triggerWeatherAfterOpen(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled || !s.weatherAutoFetch) return;
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) return;
    const token = this._fetchToken;
    // Fire-and-forget: won't delay navigation
    this.weather.getSnapshot(dateStr).then((snap) => {
      if (snap && token === this._fetchToken && this._weatherCardDate === dateStr) {
        this._weatherSnapshot = snap;
        this._weatherLoading = false;
        this._weatherError = false;
        this._updateWeatherCardUI();
      }
    }).catch((err) => {
      console.warn('[Dayline] Weather fetch after note open failed:', err.message);
    });
  }

  /* ----- Sync weather overlays on all markdown leaves ----- */
  _syncNoteOverlays() {
    const s = this.plugin.settings;

    // EXIF hover on note images (runs regardless of weather)
    this._scheduleExifNoteAttach();

    if (!s.weatherEnabled) {
      this._removeAllOverlaysFromViews();
      return;
    }
    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) {
      this._removeAllOverlaysFromViews();
      return;
    }

    const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
    const indexedEntries = new Map(
      (this.plugin.journalIndex?.getEntries?.() || []).map((entry) => [entry.path, entry]),
    );
    const validJournalFiles = new Set();

    // Collect leaves backed by an indexed journal entry. This keeps overlays
    // aligned with custom date fields and external journal sources.
    for (const leaf of mdLeaves) {
      const file = leaf.view?.file;
      if (!(file instanceof TFile)) continue;
      const entry = indexedEntries.get(file.path);
      if (!entry) continue;

      validJournalFiles.add(file.path);

      // Check if there's already an in-flight request for this leaf — skip if so
      if (this._overlayInFlight.has(leaf)) {
        continue;
      }

      this._createOrUpdateOverlay(leaf, file, entry.date);
    }

    // Remove stale overlays from every non-journal markdown leaf
    // Must handle leaves without TFile (e.g., blank editor, Homepage.md, etc.)
    for (const leaf of mdLeaves) {
      const file = leaf.view?.file;
      const path = file ? file.path : null;

      // Skip valid journal notes
      if (path && validJournalFiles.has(path)) continue;

      // For leaves with no file (blank editor, etc.), still clean up
      // For leaves with a non-daily file (Homepage.md), clean up too
      this._releaseOverlay(leaf.containerEl);
    }
  }

  _invalidateOverlayRequests() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      this._overlayVersions.set(leaf, (this._overlayVersions.get(leaf) || 0) + 1);
    }
    this._removeAllOverlaysFromViews();
  }

  /* ----- EXIF hover on daily note embedded images ----- */

  _scheduleExifNoteAttach() {
    // Debounce: clear previous timer so we don't attach observers multiple times
    clearTimeout(this._exifNoteTimer);
    this._exifNoteTimer = setTimeout(() => {
      if (!this.plugin.settings.showExif) return;

      // Disconnect old observers for leaves no longer showing journal notes
      const indexedPaths = new Set(
        (this.plugin.journalIndex?.getEntries?.() || []).map((entry) => entry.path),
      );
      const activeJournalLeaves = new Set();
      const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
      for (const leaf of mdLeaves) {
        const file = leaf.view?.file;
        if (!(file instanceof TFile)) continue;
        if (!indexedPaths.has(file.path)) continue;
        activeJournalLeaves.add(leaf);
        this._observeNoteImages(leaf);
      }

      // Disconnect observers for non-journal-note leaves
      if (this._exifObservers) {
        for (const [leaf, obs] of this._exifObservers) {
          if (!activeJournalLeaves.has(leaf)) {
            obs.disconnect();
            this._exifObservers.delete(leaf);
          }
        }
      }
    }, 300);
  }

  _observeNoteImages(leaf) {
    // Already observing this leaf
    if (!this._exifObservers) this._exifObservers = new Map();
    if (this._exifObservers.has(leaf)) return;

    const container = leaf.view?.containerEl || leaf.containerEl;
    if (!container) return;

    // Scan existing images AND internal-embed spans (for HEIC etc.)
    this._processImageEls(container.querySelectorAll('img'));
    this._processEmbedEls(container.querySelectorAll('.internal-embed'));

    // Then watch for new ones
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === 'IMG') this._processImageEls([node]);
            if (node.classList?.contains('internal-embed')) this._processEmbedEls([node]);
            // Check descendants
            if (node.querySelectorAll) {
              this._processImageEls(node.querySelectorAll('img'));
              this._processEmbedEls(node.querySelectorAll('.internal-embed'));
            }
          }
        }
      }
    });

    observer.observe(container, { childList: true, subtree: true });
    this._exifObservers.set(leaf, observer);
  }

  _processImageEls(images) {
    for (const img of images) {
      if (this._exifNoteImages.has(img)) continue;
      this._exifNoteImages.add(img);
      img.addEventListener('mouseenter', (e) => this._onNoteImageEnter(e, img));
      img.addEventListener('mouseleave', () => this._onExifLeave());
    }
  }

  _processEmbedEls(embeds) {
    for (const el of embeds) {
      if (this._exifNoteImages.has(el)) continue;
      // Only attach if it references an image-like file
      const src = el.getAttribute('src') || '';
      const ext = src.split('.').pop()?.toLowerCase();
      if (!ext || !IMAGE_EXTS.includes(ext)) continue;
      this._exifNoteImages.add(el);
      el.addEventListener('mouseenter', (e) => this._onNoteImageEnter(e, el));
      el.addEventListener('mouseleave', () => this._onExifLeave());

      // For HEIC, also try to convert and display the image
      if (HEIC_EXTS.includes(ext) && !hasExistingImage(el) && !el.querySelector('.cal-heic-preview')) {
        this._convertHeicEmbed(el, src);
      }
    }
  }

  async _convertHeicEmbed(el, src) {
    // Show loading indicator
    const loader = document.createElement('div');
    loader.className = 'cal-heic-preview';
    loader.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:60px;color:var(--text-muted);font-size:12px;';
    loader.textContent = 'Converting HEIC...';
    el.appendChild(loader);

    try {
      const notePath = this.app.workspace.activeLeaf?.view?.file?.path || '';
      const file = this.app.metadataCache.getFirstLinkpathDest(src, notePath);
      if (!(file instanceof TFile)) return;

      const thumb = await this.plugin.heicCache.getThumbnail(file);
      if (!thumb) {
        loader.textContent = 'HEIC conversion failed';
        return;
      }

      // Obsidian may finish rendering its native image while conversion is in flight.
      if (hasExistingImage(el)) {
        loader.remove();
        return;
      }

      // Replace loader with image
      const img = document.createElement('img');
      img.src = thumb.dataUrl;
      img.style.cssText = 'max-width:100%;height:auto;display:block;';
      img.setAttribute('data-cal-exif', '1');
      this._exifNoteImages.add(img);
      img.addEventListener('mouseenter', (e) => this._onNoteImageEnter(e, img));
      img.addEventListener('mouseleave', () => this._onExifLeave());
      loader.replaceWith(img);
    } catch (_) {
      loader.textContent = 'HEIC error';
    }
  }

  async _onNoteImageEnter(e, img) {
    if (!this.plugin.settings.showExif) return;
    const hoverToken = this.plugin._beginExifHover();

    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        const file = this._resolveImageFile(img);
        if (!(file instanceof TFile)) return;

        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(img, null, true);
        const fields = await this.exifCache.get(file);
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(img, fields, false);
      } catch (_) {
        this.plugin._hideExifTooltip();
      }
    }, 500);
  }

  _resolveImageFile(el) {
    const leaf = this.app.workspace.activeLeaf;
    const notePath = leaf?.view?.file?.path || '';

    // If the element itself is an .internal-embed (HEIC etc.), resolve from its src
    if (el.classList && el.classList.contains('internal-embed')) {
      const embedSrc = el.getAttribute('src');
      if (embedSrc && notePath) {
        const f = this.app.metadataCache.getFirstLinkpathDest(embedSrc, notePath);
        if (f instanceof TFile) return f;
      }
    }

    // Method 1: walk up to parent .internal-embed span (for <img> children)
    let parent = el.parentElement;
    while (parent) {
      if (parent.classList.contains('internal-embed')) {
        const embedSrc = parent.getAttribute('src');
        if (embedSrc && notePath) {
          const f = this.app.metadataCache.getFirstLinkpathDest(embedSrc, notePath);
          if (f instanceof TFile) return f;
        }
        break;
      }
      parent = parent.parentElement;
    }

    // Method 2: parse the img src URL
    const src = el.getAttribute('src');
    if (!src) return null;

    let path = decodeURIComponent(src);
    const qIdx = path.indexOf('?');
    if (qIdx > 0) path = path.substring(0, qIdx);

    // Handle both app://local/ and app://<hash>/ URL formats
    const appIdx = path.indexOf('://');
    if (appIdx > 0) {
      const afterHost = path.indexOf('/', appIdx + 3);
      if (afterHost > 0) {
        path = path.substring(afterHost + 1);
      }
    }

    // Normalize and match against vault path
    const vaultPath = (this.app.vault.adapter.basePath || '').replace(/\\/g, '/');
    const normalized = path.replace(/\\/g, '/');

    if (vaultPath && normalized.startsWith(vaultPath)) {
      const relative = normalized.substring(vaultPath.length + 1);
      const f = this.app.vault.getAbstractFileByPath(relative);
      if (f instanceof TFile) return f;
    }

    // Fallback: try filename
    const fileName = normalized.split('/').pop();
    if (fileName) {
      const f = this.app.vault.getAbstractFileByPath(fileName);
      if (f instanceof TFile) return f;
    }

    return null;
  }

  /* ----- Mount or update weather overlay on a single markdown leaf ----- */
  async _createOrUpdateOverlay(leaf, file, indexedDate) {
    const dateStr = indexedDate || file.name.replace(/\.md$/, '');
    const container = leaf.containerEl;
    if (!container) return;

    // Record in-flight promise for this leaf to prevent concurrent duplicates
    const inFlightPromise = (async () => {
      try {
        await this._buildOverlayForLeaf(leaf, file, dateStr);
      } catch (err) {
        console.warn('[Dayline] Overlay build failed:', err.message);
      } finally {
        // Clean up in-flight marker
        this._overlayInFlight.delete(leaf);
        if (leaf.view?.file === file && !leaf.containerEl?.querySelector(`[${OVERLAY_ATTR}]`)) {
          this._syncNoteOverlays();
        }
      }
    })();
    this._overlayInFlight.set(leaf, inFlightPromise);
  }

  /* ----- Build overlay content and mount it into the given leaf ----- */
  async _buildOverlayForLeaf(leaf, file, dateStr) {
    const container = leaf.containerEl;
    if (!container) return;

    // Bump this leaf's version counter — stale results must not mount
    const myVersion = (this._overlayVersions.get(leaf) || 0) + 1;
    this._overlayVersions.set(leaf, myVersion);

    // Re-validate file after await (leaf may have switched)
    const currentFile = leaf.view?.file;
    if (currentFile !== file || !(currentFile instanceof TFile)) return;

    // Read snapshot from weatherCache first, then legacy frontmatter
    const cache = this.app.metadataCache.getFileCache(currentFile);
    let snap = this.weather.getCachedSnapshot(dateStr)
      || cache?.frontmatter?._calendar_weather
      || null;
    if (snap && !this.weather.isSnapshotCompatible(snap)) snap = null;
    // Normalize icon: migrate emoji → .svg filename
    if (snap && typeof snap.icon === 'string' && !snap.icon.endsWith('.svg') && snap.weatherCode != null) {
      snap.icon = lookupWeatherCode(snap.weatherCode).icon;
    }
    const isStale = snap && typeof snap === 'object' ? this.weather._shouldFetch(snap, this.plugin.settings.weatherTtlHours || 2) : true;

    // If no valid snapshot, trigger a background fetch
    if (!snap || isStale) {
      const fetched = await this.weather.getSnapshot(dateStr);
      if (fetched) snap = fetched;
    }

    if (snap && !this.weather.isSnapshotCompatible(snap)) snap = null;

    // Final re-check: file may have changed during fetch
    const latestFile = leaf.view?.file;
    if (latestFile !== file || !(latestFile instanceof TFile)) return;

    // Discard if a newer request has already mounted for this leaf
    if (myVersion < (this._overlayVersions.get(leaf) || 0)) return;

    // If no data at all, do NOT erase an existing valid overlay — just skip
    if (!snap) return;

    // Remove any existing overlay element first (idempotent)
    this._claimOverlay(container);
    const oldEl = container.querySelector(`[${OVERLAY_ATTR}]`);
    if (oldEl) oldEl.remove();

    // Ensure the container has relative positioning for absolute overlay placement
    this._ensureHostPosition(container);

    // Create overlay chip
    const overlay = container.createDiv({
      cls: 'cal-note-overlay',
      attr: { [OVERLAY_ATTR]: 'true' },
    });

    // Icon
    const iconEl = overlay.createEl('img', { cls: 'cal-overlay-icon' });
    iconEl.src = _iconUrl(snap.icon) || '';
    iconEl.alt = snap.condition || '';
    iconEl.title = snap.condition;

    // Info column
    const infoEl = overlay.createDiv({ cls: 'cal-overlay-info' });
    const tempEl = infoEl.createDiv({ cls: 'cal-overlay-temp' });
    const detailEl = infoEl.createDiv({ cls: 'cal-overlay-detail' });

    const lang = this.plugin.settings.weatherLanguage;
    const unitSym = this._unitSymbol(snap.units);
    const labelKey = snap.temperatureLabel === 'Now' ? 'now' : 'high';
    tempEl.setText(`${_l(lang, labelKey)} ${snap.temperature ?? '?'}${unitSym}`);

    const parts = [];
    if (snap.feelsLike != null) parts.push(`${_l(lang, 'feels')} ${snap.feelsLike}${unitSym}`);
    if (snap.humidity != null) parts.push(`${_l(lang, 'humidity')} ${snap.humidity}%`);
    detailEl.setText(parts.join(' · ') || '');
    detailEl.title = snap.condition;

    // Refresh button inside overlay
    const refreshLabel = _l(lang, 'refresh');
    const refreshBtn = overlay.createEl('button', {
      cls: 'cal-overlay-refresh',
      attr: { 'aria-label': refreshLabel, title: refreshLabel },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._performOverlayRefresh(dateStr, refreshBtn, overlay).catch((err) => {
        console.warn('[Dayline] Overlay refresh failed:', err.message);
      });
    });

    // Animate in
    requestAnimationFrame(() => {
      overlay.addClass('is-visible');
    });
  }

  /* ----- Ensure containerEl has position:relative for absolute overlay placement ----- */
  _ensureHostPosition(container) {
    if (this._hostPositionMarkers.has(container)) return;
    const computedStyle = getComputedStyle(container);
    if (computedStyle.position !== 'static') return;
    if (!this.plugin._overlayOriginalPositions.has(container)) {
      this.plugin._overlayOriginalPositions.set(container, {
        value: container.style.getPropertyValue('position'),
        priority: container.style.getPropertyPriority('position'),
      });
    }
    container.style.position = 'relative';
    this._hostPositionMarkers.add(container);
    // Also register with plugin for cleanup on unload
    this.plugin._hostPositionMarkers?.add(container);
  }

  /* ----- Refresh weather for an overlay ----- */
  async _performOverlayRefresh(dateStr, btnEl, overlayEl) {
    if (!overlayEl?.isConnected) return;
    btnEl.setAttribute('disabled', '');
    btnEl.addClass('is-loading');

    try {
      const snap = await this.weather.forceRefresh(dateStr);
      if (!snap || !overlayEl.isConnected) return;

      const tempEl = overlayEl.querySelector('.cal-overlay-temp');
      const detailEl = overlayEl.querySelector('.cal-overlay-detail');
      const iconEl = overlayEl.querySelector('.cal-overlay-icon');
      const unitSym = this._unitSymbol(snap.units);
      const lang = this.plugin.settings.weatherLanguage;
      const labelKey = snap.temperatureLabel === 'Now' ? 'now' : 'high';
      if (tempEl) tempEl.textContent = `${_l(lang, labelKey)} ${snap.temperature ?? '?'}${unitSym}`;
      if (iconEl) {
        iconEl.src = _iconUrl(snap.icon) || '';
        iconEl.title = snap.condition;
      }

      const parts = [];
      if (snap.feelsLike != null) parts.push(`${_l(lang, 'feels')} ${snap.feelsLike}${unitSym}`);
      if (snap.humidity != null) parts.push(`${_l(lang, 'humidity')} ${snap.humidity}%`);
      if (detailEl) detailEl.textContent = parts.join(' · ') || '';
    } catch (err) {
      console.warn('[Dayline] Overlay refresh failed:', err.message);
    } finally {
      if (btnEl?.isConnected) {
        btnEl.removeAttribute('disabled');
        btnEl.removeClass('is-loading');
      }
    }
  }

  /* ----- Remove all overlays from markdown view containers ----- */
  _removeAllOverlaysFromViews() {
    for (const container of Array.from(this._overlayContainers)) this._releaseOverlay(container);
  }

  _claimOverlay(container) {
    if (!container) return;
    this.plugin._overlayRegistry?.claim(container, this);
    this._overlayContainers.add(container);
  }

  _releaseOverlay(container) {
    if (!container || !this._overlayContainers.has(container)) return;
    this._overlayContainers.delete(container);
    // The marker belongs to this view even when another view still owns the
    // shared overlay. Clear it now so a later remount re-checks host positioning.
    this._hostPositionMarkers.delete(container);
    const isLastOwner = this.plugin._overlayRegistry?.release(container, this) ?? true;
    if (!isLastOwner) return;
    container.querySelector(`[${OVERLAY_ATTR}]`)?.remove();
    this.plugin._restoreHostPosition?.(container);
  }

  /* ----- Create daily note from template ----- */
  async _createDailyNote(path, dateStr) {
    // Check if daily notes plugin has a template configured
    const dnPlugin = this.app.internalPlugins.getPluginById('daily-notes');
    const templatePath = dnPlugin?.instance?.options?.template;

    if (templatePath) {
      const templateFile = this.app.vault.getAbstractFileByPath(templatePath + '.md');
      if (templateFile instanceof TFile) {
        // Try Templater first for proper template processing (e.g. tp.file.title)
        const tp = this.app.plugins.getPlugin('templater-obsidian')?.templater;
        if (tp && tp.create_new_note_from_template) {
          await tp.create_new_note_from_template(templateFile, this.plugin.settings.dailyFolder, dateStr, false);
          const created = this.app.vault.getAbstractFileByPath(path);
          if (created instanceof TFile) return created;
        }
        // Fallback: read raw template and create with unresolved content
        const content = await this.app.vault.read(templateFile);
        return this.app.vault.create(path, content);
      }
    }

    // No template — create empty file
    return this.app.vault.create(path, '');
  }

  /* ----- Sync active date from the currently viewed leaf ----- */
  _syncActiveDate(leaf) {
    leaf = leaf || this.app.workspace.activeLeaf;
    if (!leaf) {
      this._clearActiveDate();
      return;
    }
    const file = leaf.view?.file;
    if (!(file instanceof TFile)) {
      this._clearActiveDate();
      return;
    }
    const indexedEntry = this.plugin.journalIndex?.getEntries?.().find((entry) => entry.path === file.path);
    const fallbackMatch = file.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    const newDate = indexedEntry?.date || (fallbackMatch && file.path.startsWith(`${this.plugin.settings.dailyFolder}/`) ? fallbackMatch[1] : null);
    if (newDate) {
      // Reset weather card state when the active date actually changes
      if (newDate !== this.activeDate) {
        this._weatherCardDate = null;
        this._weatherSnapshot = null;
        this._weatherLoading = false;
        this._weatherError = false;
      }
      this.activeDate = newDate;
    } else {
      this._clearActiveDate();
    }
  }

  _clearActiveDate() {
    if (this.activeDate === null) return;
    this.activeDate = null;
    this._weatherCardDate = null;
    this._weatherSnapshot = null;
    this._weatherLoading = false;
    this._weatherError = false;
  }

  /* ----- Bulk weather backfill for all past dates ----- */
  async startWeatherBackfill() {
    const dateStrs = Array.from(new Set(
      (this.plugin.journalIndex?.getEntries?.() || [])
        .map((entry) => entry.date)
        .filter((date) => date < _daylineDate(this.plugin.settings)),
    )).sort();
    const missingDates = dateStrs.filter((date) => !this.weather.hasCachedSnapshot(date));

    if (missingDates.length === 0) {
      new Notice(_l(this.plugin.settings.weatherLanguage, 's_backfillAllDone'));
      return;
    }

    const lang = this.plugin.settings.weatherLanguage;
    new Notice(_l(lang, 's_backfillStarted', missingDates.length));
    await this.weather.bulkBackfill(missingDates, (done, total) => {
      if (done % 5 === 0 || done === total) {
        new Notice(_l(lang, 's_backfillProgress', done, total));
      }
    });
    new Notice(_l(lang, 's_backfillDone', missingDates.length));
    this.render();
  }
}

/* ============================================================
   Create Note Confirm Modal
   ============================================================ */
class CreateNoteModal extends Modal {
  constructor(app, dateStr, onConfirm) {
    super(app);
    this.dateStr = dateStr;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Create Daily Note' });
    contentEl.createEl('p', { text: `No daily note found for ${this.dateStr}. Create one?` });

    const btnDiv = contentEl.createDiv({ cls: 'modal-button-container' });
    btnDiv.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());
    const confirmBtn = btnDiv.createEl('button', { text: 'Create', cls: 'mod-cta' });
    confirmBtn.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose() {
    // Disconnect EXIF MutationObservers
    if (this._exifObservers) {
      for (const obs of this._exifObservers.values()) obs.disconnect();
      this._exifObservers.clear();
    }
    const { contentEl } = this;
    contentEl.empty();
  }
}

/* ============================================================
   Helpers
   ============================================================ */
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'avif', 'tiff', 'tif', 'bmp'];

function _isImageLink(link) {
  const clean = String(link || '').split('|', 1)[0].split('?', 1)[0];
  return IMAGE_EXTS.includes(clean.split('.').pop()?.toLowerCase());
}

function _daylineDate(settings, date = new Date()) {
  return getTodayDate(settings?.weatherTimezone || 'auto', date);
}

/* ============================================================
   Embedded Meteocons SVG icons (MIT, @meteocons/svg-static v0.1.0)
   Inlined for zero I/O, instant synchronous lookup.
   ============================================================ */
const SVG_ICONS = {
'clear-day.svg':`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="clear-day"><g id="Sun"><circle id="Core" cx="64" cy="63.9999" r="19.5" fill="url(#a)" stroke="#F8AF18"/><g id="Rays"><path d="M61 19C61 17.3431 62.3431 16 64 16C65.6568 16 67 17.3431 67 19V33C67 34.6569 65.6568 36 64 36C62.3431 36 61 34.6569 61 33V19Z" fill="#F8AF18"/><path d="M93.6985 30.0589C94.87 28.8873 96.7696 28.8873 97.9411 30.0589C99.1127 31.2304 99.1127 33.1299 97.9411 34.3015L88.0416 44.201C86.8701 45.3726 84.9706 45.3726 83.799 44.201C82.6274 43.0294 82.6274 41.1299 83.799 39.9584L93.6985 30.0589Z" fill="#F8AF18"/><path d="M109 61C110.657 61 112 62.3432 112 64C112 65.6569 110.657 67 109 67H95C93.3431 67 92 65.6569 92 64C92 62.3432 93.3431 61 95 61H109Z" fill="#F8AF18"/><path d="M97.9411 93.6985C99.1127 94.8701 99.1127 96.7696 97.9411 97.9411C96.7696 99.1127 94.8701 99.1127 93.6985 97.9411L83.799 88.0416C82.6274 86.8701 82.6274 84.9706 83.799 83.799C84.9706 82.6274 86.8701 82.6274 88.0416 83.799L97.9411 93.6985Z" fill="#F8AF18"/><path d="M61 95C61 93.3431 62.3431 92 64 92C65.6568 92 67 93.3431 67 95V109C67 110.657 65.6568 112 64 112C62.3431 112 61 110.657 61 109V95Z" fill="#F8AF18"/><path d="M39.9584 83.799C41.1299 82.6274 43.0294 82.6274 44.201 83.799C45.3726 84.9706 45.3726 86.8701 44.201 88.0416L34.3015 97.9411C33.1299 99.1127 31.2304 99.1127 30.0589 97.9411C28.8873 96.7696 28.8873 94.87 30.0589 93.6985L39.9584 83.799Z" fill="#F8AF18"/><path d="M33 61C34.6569 61 36 62.3431 36 64C36 65.6568 34.6569 67 33 67H19C17.3431 67 16 65.6568 16 64C16 62.3431 17.3431 61 19 61H33Z" fill="#F8AF18"/><path d="M44.201 39.9584C45.3726 41.1299 45.3726 43.0294 44.201 44.201C43.0294 45.3726 41.1299 45.3726 39.9584 44.201L30.0589 34.3015C28.8873 33.1299 28.8873 31.2305 30.0589 30.0589C31.2305 28.8873 33.1299 28.8873 34.3015 30.0589L44.201 39.9584Z" fill="#F8AF18"/></g></g></g><defs><linearGradient id="a" x1="64" y1="43.9999" x2="64" y2="83.9999" gradientUnits="userSpaceOnUse"><stop stop-color="#FBBF24"/><stop offset="1" stop-color="#F8AF18"/></linearGradient></defs></svg>')}`,
'partly-cloudy-day.svg':`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#pcc)"><g id="Sky"><g id="Sun"><circle id="Core" cx="39" cy="51" r="8.5" fill="url(#pcg1)" stroke="#F8AF18"/><g id="Rays"><path d="M37.6875 31.3125C37.6875 30.5876 38.2751 30 39 30C39.7249 30 40.3125 30.5876 40.3125 31.3125V37.4375C40.3125 38.1624 39.7249 38.75 39 38.75C38.2751 38.75 37.6875 38.1624 37.6875 37.4375V31.3125Z" fill="#F8AF18"/><path d="M51.9931 36.1508C52.5056 35.6382 53.3367 35.6382 53.8492 36.1508C54.3618 36.6633 54.3618 37.4943 53.8492 38.0069L49.5182 42.3379C49.0056 42.8505 48.1746 42.8505 47.6621 42.3379C47.1495 41.8254 47.1495 40.9944 47.6621 40.4818L51.9931 36.1508Z" fill="#F8AF18"/><path d="M58.6875 49.6875C59.4124 49.6875 60 50.2751 60 51C60 51.7249 59.4124 52.3125 58.6875 52.3125H52.5625C51.8376 52.3125 51.25 51.7249 51.25 51C51.25 50.2751 51.8376 49.6875 52.5625 49.6875H58.6875Z" fill="#F8AF18"/><path d="M53.8492 63.9931C54.3618 64.5057 54.3618 65.3367 53.8492 65.8492C53.3367 66.3618 52.5056 66.3618 51.9931 65.8492L47.6621 61.5182C47.1495 61.0057 47.1495 60.1746 47.6621 59.6621C48.1746 59.1495 49.0057 59.1495 49.5182 59.6621L53.8492 63.9931Z" fill="#F8AF18"/><path d="M37.6875 64.5625C37.6875 63.8376 38.2751 63.25 39 63.25C39.7249 63.25 40.3125 63.8376 40.3125 64.5625V70.6875C40.3125 71.4124 39.7249 72 39 72C38.2751 72 37.6875 71.4124 37.6875 70.6875V64.5625Z" fill="#F8AF18"/><path d="M28.4818 59.6621C28.9943 59.1495 29.8254 59.1495 30.3379 59.6621C30.8505 60.1746 30.8505 61.0056 30.3379 61.5182L26.0069 65.8492C25.4943 66.3618 24.6633 66.3618 24.1508 65.8492C23.6382 65.3367 23.6382 64.5056 24.1508 63.9931L28.4818 59.6621Z" fill="#F8AF18"/><path d="M25.4375 49.6875C26.1624 49.6875 26.75 50.2751 26.75 51C26.75 51.7249 26.1624 52.3125 25.4375 52.3125H19.3125C18.5876 52.3125 18 51.7249 18 51C18 50.2751 18.5876 49.6875 19.3125 49.6875H25.4375Z" fill="#F8AF18"/><path d="M30.3379 40.4818C30.8505 40.9944 30.8505 41.8254 30.3379 42.3379C29.8254 42.8505 28.9944 42.8505 28.4818 42.3379L24.1508 38.0069C23.6382 37.4944 23.6382 36.6633 24.1508 36.1508C24.6633 35.6382 25.4944 35.6382 26.0069 36.1508L30.3379 40.4818Z" fill="#F8AF18"/></g></g><g id="Clouds"><g id="Cloud"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#pcg2)" stroke="#E6EFFC"/></g></g></g></g><defs><linearGradient id="pcg1" x1="39" y1="42" x2="39" y2="60" gradientUnits="userSpaceOnUse"><stop stop-color="#FBBF24"/><stop offset="1" stop-color="#F8AF18"/></linearGradient><linearGradient id="pcg2" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="pcc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
'overcast.svg':`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#ovc)"><g id="Sky"><g id="Clouds"><g id="Secondary Cloud"><path d="M83.8392 48.6934C86.2444 44.9584 91.2146 43.529 95.3177 45.1768C99.3609 46.8006 101.814 51.1888 100.71 55.4365L100.54 56.0898L101.215 56.0615C104.496 55.924 107.5 58.4646 107.5 61.7744C107.5 64.9759 104.669 67.4999 101.489 67.5H74.9769C71.7679 67.5008 68.8449 65.1182 68.5287 61.9072C68.2136 58.7068 70.6168 55.8414 73.764 55.2705L74.2552 55.1816L74.1674 54.6904C73.7734 52.4931 74.8117 50.2493 76.6849 49.0273C78.6105 47.7713 81.177 47.7069 83.1683 48.8564L83.5814 49.0938L83.8392 48.6934Z" fill="url(#ovg1)" stroke="#94A3B8"/></g><g id="Cloud"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#ovg2)" stroke="#E6EFFC"/></g></g></g></g><defs><linearGradient id="ovg1" x1="88.0002" y1="44" x2="88.0002" y2="68" gradientUnits="userSpaceOnUse"><stop stop-color="#B0BCCD"/><stop offset="1" stop-color="#94A3B8"/></linearGradient><linearGradient id="ovg2" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="ovc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
'fog.svg':`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#fc)"><g id="Clouds"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#fg1)" stroke="#E6EFFC"/></g><g id="Precipitation"><path d="M40 95H88" stroke="#E2E8F0" stroke-width="3" stroke-linecap="round"/><path d="M40 103H88" stroke="#E2E8F0" stroke-width="3" stroke-linecap="round"/></g></g><defs><linearGradient id="fg1" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="fc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
'drizzle.svg':`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#dzc)"><g id="Clouds"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#dzg1)" stroke="#E6EFFC"/></g><g id="Precipitation"><path d="M52 95V98" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/><path d="M64 87V90" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/><path d="M76 95V98" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/></g></g><defs><linearGradient id="dzg1" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="dzc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
'rain.svg':`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#rc)"><g id="Clouds"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#rg1)" stroke="#E6EFFC"/></g><g id="Precipitation"><path d="M52 91V103" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/><path d="M64 83V95" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/><path d="M76 91V103" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/></g></g><defs><linearGradient id="rg1" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="rc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
'snow.svg':`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#snc)"><g id="Clouds"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#sng1)" stroke="#E6EFFC"/></g><g id="Snowflakes"><path d="M52.578 98.366l-1.205-.689c.106-.444.105-.908-.003-1.353l1.208-.69c.095-.054.18-.126.247-.214.067-.087.117-.186.146-.292.028-.107.036-.218.021-.326a.72.72 0 00-.106-.31.63.63 0 00-.514-.39.63.63 0 00-.639.084L51.528 94.876c-.335-.317-.741-.55-1.184-.676V92.82a.62.62 0 00-.187-.582.647.647 0 00-.876 0 .62.62 0 00-.187.582v1.38c-.442.128-.848.36-1.185.674L47.266 94.185a.63.63 0 00-.639-.084.63.63 0 00-.514.39.72.72 0 00-.106.31.692.692 0 00.021.326.62.62 0 00.146.293c.068.087.152.16.248.214l1.204.688c-.106.445-.105.909.003 1.353l-1.208.69a.632.632 0 00-.247.214.62.62 0 00-.146.293.692.692 0 00-.021.326.72.72 0 00.106.31.63.63 0 00.514.39c.216.057.445.027.639-.084l1.206-.69c.334.318.74.55 1.184.675v1.382a.62.62 0 00.187.582.647.647 0 00.876 0 .62.62 0 00.187-.582v-1.382c.441-.13.847-.36 1.184-.674l1.206.69a.63.63 0 00.639.084.63.63 0 00.514-.39.72.72 0 00.106-.31.692.692 0 00-.021-.326.62.62 0 00-.146-.293.632.632 0 00-.247-.214zm-4.712-.28a.75.75 0 01-.37-.32.785.785 0 01-.096-.384.69.69 0 01.033-.284.66.66 0 01.159-.265.721.721 0 011.03-.02.78.78 0 01.37.32c.082.143.125.302.126.464 0 .162-.044.321-.126.464a.721.721 0 01-1.03-.02.78.78 0 01-.096.045zm15.002.28l-1.205-.689c.106-.444.105-.908-.003-1.353l1.208-.69c.095-.054.18-.126.247-.214.067-.087.117-.186.146-.292.028-.107.036-.218.021-.326a.72.72 0 00-.106-.31.63.63 0 00-.514-.39.63.63 0 00-.639.084L66.528 94.876c-.335-.317-.741-.55-1.184-.676V92.82a.62.62 0 00-.187-.582.647.647 0 00-.876 0 .62.62 0 00-.187.582v1.38c-.442.128-.848.36-1.185.674L62.266 94.185a.63.63 0 00-.639-.084.63.63 0 00-.514.39.72.72 0 00-.106.31.692.692 0 00.021.326.62.62 0 00.146.293c.068.087.152.16.248.214l1.204.688c-.106.445-.105.909.003 1.353l-1.208.69a.632.632 0 00-.247.214.62.62 0 00-.146.293.692.692 0 00-.021.326.72.72 0 00.106.31.63.63 0 00.514.39c.216.057.445.027.639-.084l1.206-.69c.334.318.74.55 1.184.675v1.382a.62.62 0 00.187.582.647.647 0 00.876 0 .62.62 0 00.187-.582v-1.382c.441-.13.847-.36 1.184-.674l1.206.69a.63.63 0 00.639.084.63.63 0 00.514-.39.72.72 0 00.106-.31.692.692 0 00-.021-.326.62.62 0 00-.146-.293.632.632 0 00-.247-.214zm-4.712-.28a.75.75 0 01-.37-.32.785.785 0 01-.096-.384.69.69 0 01.033-.284.66.66 0 01.159-.265.721.721 0 011.03-.02.78.78 0 01.37.32c.082.143.125.302.126.464 0 .162-.044.321-.126.464a.721.721 0 01-1.03-.02.78.78 0 01-.096.045zm15.002.28l-1.205-.689c.106-.444.105-.908-.003-1.353l1.208-.69c.095-.054.18-.126.247-.214.067-.087.117-.186.146-.292.028-.107.036-.218.021-.326a.72.72 0 00-.106-.31.63.63 0 00-.514-.39.63.63 0 00-.639.084L81.528 94.876c-.335-.317-.741-.55-1.184-.676V92.82a.62.62 0 00-.187-.582.647.647 0 00-.876 0 .62.62 0 00-.187.582v1.38c-.442.128-.848.36-1.185.674L77.266 94.185a.63.63 0 00-.639-.084.63.63 0 00-.514.39.72.72 0 00-.106.31.692.692 0 00.021.326.62.62 0 00.146.293c.068.087.152.16.248.214l1.204.688c-.106.445-.105.909.003 1.353l-1.208.69a.632.632 0 00-.247.214.62.62 0 00-.146.293.692.692 0 00-.021.326.72.72 0 00.106.31.63.63 0 00.514.39c.216.057.445.027.639-.084l1.206-.69c.334.318.74.55 1.184.675v1.382a.62.62 0 00.187.582.647.647 0 00.876 0 .62.62 0 00.187-.582v-1.382c.441-.13.847-.36 1.184-.674l1.206.69a.63.63 0 00.639.084.63.63 0 00.514-.39.72.72 0 00.106-.31.692.692 0 00-.021-.326.62.62 0 00-.146-.293.632.632 0 00-.247-.214zm-4.712-.28a.75.75 0 01-.37-.32.785.785 0 01-.096-.384.69.69 0 01.033-.284.66.66 0 01.159-.265.721.721 0 011.03-.02.78.78 0 01.37.32c.082.143.125.302.126.464 0 .162-.044.321-.126.464a.721.721 0 01-1.03-.02.78.78 0 01-.096.045z" fill="#86C3DB"/></g></g><defs><linearGradient id="sng1" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="snc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
'thunderstorms.svg':`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#tsc)"><g id="Clouds"><path d="M55.2625 48.4746C60.1228 40.6111 70.2976 37.38 78.8152 40.9434C87.3215 44.5023 92.1381 54.0026 89.9031 62.9648L89.7419 63.6143L90.4109 63.585C97.4205 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7719 88.4997 90.9773 88.5H37.9539C31.1276 88.5018 25.203 83.1709 24.5593 76.3604C23.9159 69.5518 28.7371 63.2124 35.4431 61.9453L35.9265 61.8535L35.8425 61.3691C35.0258 56.6239 37.1259 51.7168 41.1052 49.0127C45.0952 46.3014 50.4461 46.1537 54.5798 48.6396L55.0027 48.8945L55.2625 48.4746Z" fill="url(#tsg1)" stroke="#E6EFFC"/></g><g id="Lightning"><path d="M71.1729 68.5L63.5566 83.041L63.1729 83.7725H75.002L56.9521 107.892L60.4893 91.0117L60.6162 90.4092H52.7041L60.3555 68.5H71.1729Z" fill="url(#tsg2)" stroke="#F6A823"/></g></g><defs><linearGradient id="tsg1" x1="64.0009" y1="39" x2="64.0009" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><linearGradient id="tsg2" x1="64.528" y1="66.0377" x2="84.4144" y2="77.4572" gradientUnits="userSpaceOnUse"><stop stop-color="#F7B23B"/><stop offset="1" stop-color="#F6A823"/></linearGradient><clipPath id="tsc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
};

/** Get data URI for a weather icon — synchronous, zero I/O. */
function _iconUrl(iconFile) {
  return SVG_ICONS[iconFile] || '';
}

export default DaylinePlugin;
