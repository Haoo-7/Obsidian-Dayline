// @ts-nocheck
/**
 * Dayline — a visual journal for calendars, timelines, moods, memories, weather, and photos.
 * Scans Calendar/Daily/ for notes with images, shows thumbnails in date cells.
 * Click a date to open that day's daily note.
 */
const { Plugin, ItemView, TFolder, TFile, Notice, Modal, PluginSettingTab, Setting, SuggestModal, requestUrl, setIcon } = require('obsidian');
const { JournalIndex } = require('./journal-index');
const { MoodStore } = require('./mood-store');
const { MoodPickerModal } = require('./mood-picker-modal');
const { JournalTimelineView, JOURNAL_TIMELINE_VIEW } = require('./journal-timeline-view');
const { formatDateInTimeZone } = require('./date-utils');
const { ThumbnailService } = require('./thumbnail-service');
const { getDisplayLanguage, moodLabel, t } = require('./i18n');
const { getMoodColor } = require('./mood');
const { shouldShowCalendarMood, shouldShowCalendarWeatherCard, shouldShowCalendarWeatherBadge } = require('./calendar-display');

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

    // Register the sidebar view
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.registerView(JOURNAL_TIMELINE_VIEW, (leaf) => new JournalTimelineView(leaf, this));

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
        const today = new Date();
        this.openOnThisDay(today.getMonth() + 1, today.getDate());
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
        const path = await this.moodStore.exportTo();
        new Notice(t(this.settings, 'metadataExported', { path }));
      },
    });
    this.addCommand({
      id: 'restore-journal-metadata-backup',
      name: t(this.settings, 'restoreMetadataCommand'),
      callback: async () => {
        try {
          const backupPath = `${this.moodStore.metadataPath}.bak`;
          const raw = await this.app.vault.adapter.read(backupPath);
          await this.moodStore.restoreFrom(raw);
          await this.journalIndex.refresh(this.settings);
          this.refreshJournalViews();
          new Notice(t(this.settings, 'metadataRestored'));
        } catch (error) {
          new Notice(`Could not restore journal metadata: ${error.message || error}`);
        }
      },
    });
    this.addCommand({
      id: 'check-journal-metadata-integrity',
      name: t(this.settings, 'integrityCommand'),
      callback: async () => {
        const result = await this.moodStore.checkIntegrity();
        new Notice(result.valid && result.missingFiles.length === 0
          ? t(this.settings, 'metadataValid')
          : `Metadata check: ${result.invalidRecords.length} invalid, ${result.missingFiles.length} missing files`);
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

    // Auto-open on layout ready (after Obsidian starts)
    this.app.workspace.onLayoutReady(() => {
      this.activateView();
      // Trigger initial overlay sync once the layout is stable
      this._syncAllOverlays();
    });

    // Plugin-level overlay sync: react to file-open, active-leaf-change, layout-change
    this.registerEvent(
      this.app.workspace.on('file-open', () => this._syncAllOverlays())
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this._syncAllOverlays())
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this._syncAllOverlays())
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
    await this.moodStore?.flush();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JOURNAL_TIMELINE_VIEW);
    this._removeAllOverlays();
    this._exifTooltipEl?.remove();
    this._exifTooltipEl = null;
    document.getElementById('dayline-styles')?.remove();
    document.getElementById('calendar-sidebar-styles')?.remove();
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
    const existing = this.app.workspace.getLeavesOfType(JOURNAL_TIMELINE_VIEW);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: JOURNAL_TIMELINE_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async createDailyNoteForToday() {
    const date = _formatDate(new Date());
    const path = `${this.settings.dailyFolder}/${date}.md`;
    const file = await this.ensureJournalFile(path, '');
    await (this.app.workspace.getLeaf('split')).openFile(file);
    await this.journalIndex.refreshFile(path, this.settings);
  }

  async recordCurrentMood() {
    const activeFile = this.app.workspace.activeLeaf?.view?.file;
    const sources = this.journalIndex.resolveSources(this.settings);
    const activeIsJournal = activeFile?.extension === 'md'
      && sources.some((source) => activeFile.path === source.path || activeFile.path.startsWith(`${source.path}/`));
    const path = activeIsJournal
      ? activeFile.path
      : `${this.settings.dailyFolder}/${_formatDate(new Date())}.md`;
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
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view?.render?.();
  }

  _maybeRemind() {
    if (!this.settings.reminderEnabled) return;
    const now = new Date();
    if (now.getHours() !== Number(this.settings.reminderHour ?? 21) || now.getMinutes() !== 0) return;
    const date = _formatDate(now);
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
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this.journalIndex.refreshFile(file.path, this.settings).then(() => this.refreshJournalViews());
  }

  _handleJournalDelete(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this.moodStore.removeToOrphan(file.path).catch(() => {});
    this.journalIndex.removeFile(file.path);
    this.refreshJournalViews();
  }

  _handleJournalRename(file, oldPath) {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this.moodStore.rename(oldPath, file.path).catch(() => {});
    this.journalIndex.renameFile(oldPath, file.path);
    this.journalIndex.refreshFile(file.path, this.settings).then(() => this.refreshJournalViews());
  }

  /** Remove all overlay elements from markdown view containers. */
  _removeAllOverlays() {
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
    this._overlayRefreshHandlers = null;
    // Revert any position:relative we added to containerEl
    for (const container of this._hostPositionMarkers || []) {
      if (container.style.position === 'relative') {
        container.style.removeProperty('position');
      }
    }
    this._hostPositionMarkers?.clear();
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
      console.warn('[Dayline] On This Day load failed:', err.message);
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
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
    const { workspace } = this.app;

    // 1. De-duplicate: reveal existing leaf if already open
    const existing = workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      for (const duplicate of existing.slice(1)) {
        workspace.detachLeaf(duplicate);
      }
      workspace.revealLeaf(existing[0]);
      return;
    }

    // 2. Create a vertical-split leaf in the left sidebar
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

    // 3. Move calendar container above file explorer
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
   Weather Service — Open-Meteo integration
   ============================================================ */

// WMO Weather interpretation codes (Meteocons Filled SVG icons)
// Icon values are .svg filenames in the icons/ directory
const WMO_CODES = [
  { code: 0,   condition: 'Clear sky',               icon: 'clear-day.svg' },
  { code: 1,   condition: 'Mainly clear',             icon: 'clear-day.svg' },
  { code: 2,   condition: 'Partly cloudy',            icon: 'partly-cloudy-day.svg' },
  { code: 3,   condition: 'Overcast',                 icon: 'overcast.svg' },
  { code: 45,  condition: 'Foggy',                    icon: 'fog.svg' },
  { code: 48,  condition: 'Depositing rime fog',      icon: 'fog.svg' },
  { code: 51,  condition: 'Light drizzle',            icon: 'drizzle.svg' },
  { code: 53,  condition: 'Moderate drizzle',         icon: 'drizzle.svg' },
  { code: 55,  condition: 'Dense drizzle',            icon: 'drizzle.svg' },
  { code: 61,  condition: 'Slight rain',              icon: 'rain.svg' },
  { code: 63,  condition: 'Moderate rain',            icon: 'rain.svg' },
  { code: 65,  condition: 'Heavy rain',               icon: 'rain.svg' },
  { code: 71,  condition: 'Slight snow fall',         icon: 'snow.svg' },
  { code: 73,  condition: 'Moderate snow fall',       icon: 'snow.svg' },
  { code: 75,  condition: 'Heavy snow fall',          icon: 'snow.svg' },
  { code: 77,  condition: 'Snow grains',              icon: 'snow.svg' },
  { code: 80,  condition: 'Slight rain showers',      icon: 'rain.svg' },
  { code: 81,  condition: 'Moderate rain showers',    icon: 'rain.svg' },
  { code: 82,  condition: 'Violent rain showers',     icon: 'rain.svg' },
  { code: 85,  condition: 'Slight snow showers',      icon: 'snow.svg' },
  { code: 86,  condition: 'Heavy snow showers',       icon: 'snow.svg' },
  { code: 95,  condition: 'Thunderstorm',             icon: 'thunderstorms.svg' },
  { code: 96,  condition: 'Thunderstorm w/ hail',     icon: 'thunderstorms.svg' },
  { code: 99,  condition: 'Thunderstorm w/ heavy hail', icon: 'thunderstorms.svg' },
];

/** Look up WMO code metadata; falls back to generic description. */
function _lookupWmo(code) {
  const entry = WMO_CODES.find((w) => w.code === code);
  return entry || { condition: `Weather code ${code}`, icon: 'overcast.svg' };
}

/** Validate that lat/lng are within acceptable ranges. */
function _validateCoords(lat, lng) {
  const n = parseFloat(lat);
  const g = parseFloat(lng);
  return (
    typeof n === 'number' && !isNaN(n) && n >= -90 && n <= 90 &&
    typeof g === 'number' && !isNaN(g) && g >= -180 && g <= 180
  );
}

function _weatherConfigKey(settings) {
  const lat = parseFloat(settings.weatherLatitude);
  const lng = parseFloat(settings.weatherLongitude);
  return JSON.stringify({
    latitude: Number.isFinite(lat) ? Number(lat.toFixed(6)) : null,
    longitude: Number.isFinite(lng) ? Number(lng.toFixed(6)) : null,
    units: settings.weatherUnits === 'imperial' ? 'imperial' : 'metric',
    timezone: settings.weatherTimezone || 'auto',
    apiVersion: 'open-meteo-v1',
  });
}

function _snapshotMatchesWeatherConfig(snapshot, settings) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const expected = _weatherConfigKey(settings);
  if (snapshot.configKey === expected) {
    _normalizeSnapshotLocation(snapshot, settings);
    return true;
  }

  // Migrate snapshots written before configKey existed when their location and
  // unit metadata prove they belong to the current weather configuration.
  const lat = parseFloat(settings.weatherLatitude);
  const lng = parseFloat(settings.weatherLongitude);
  const snapshotLat = parseFloat(snapshot.latitude);
  const snapshotLng = parseFloat(snapshot.longitude);
  const sameLocation = Number.isFinite(snapshotLat) && Number.isFinite(snapshotLng)
    && Math.abs(snapshotLat - lat) < 0.000001
    && Math.abs(snapshotLng - lng) < 0.000001;
  const sameUnits = snapshot.units === (settings.weatherUnits === 'imperial' ? 'imperial' : 'metric');
  if (sameLocation && sameUnits) {
    snapshot.configKey = expected;
    _normalizeSnapshotLocation(snapshot, settings);
    return true;
  }
  return false;
}

function _normalizeSnapshotLocation(snapshot, settings) {
  const lat = parseFloat(settings.weatherLatitude);
  const lng = parseFloat(settings.weatherLongitude);
  snapshot.location = settings.weatherLocationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
}

/**
 * WeatherService — handles Open-Meteo API calls and frontmatter snapshot persistence.
 * Singleton shared across CalendarView instances.
 */
class WeatherService {
  constructor(plugin) {
    this.plugin = plugin;
    // Per-date in-flight promise map to avoid duplicate requests
    this._inFlight = new Map();
    // Per-date memory cache to avoid repeated network calls for missing files
    this._memoryCache = new Map();
  }

  /**
   * Get weather snapshot for a given date string (YYYY-MM-DD).
   * Reads existing frontmatter snapshot first; fetches only when missing/stale.
   * Returns cached snapshot or fetched data, never blocks caller.
   */
  async getSnapshot(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return null;

    const requestKey = `${dateStr}|${this._configKey()}`;
    // Return existing in-flight promise to deduplicate concurrent calls for
    // the same date and weather configuration.
    if (this._inFlight.has(requestKey)) {
      return this._inFlight.get(requestKey);
    }

    const promise = this._fetchOrUseCached(dateStr).finally(() => {
      if (this._inFlight.get(requestKey) === promise) this._inFlight.delete(requestKey);
    });
    this._inFlight.set(requestKey, promise);
    return promise;
  }

  /** Check if we should fetch or use cached data.
   * Accepts either a frontmatter snapshot ({fetchedAt}) or a memory cache record ({snapshot, cachedAt}). */
  _shouldFetch(record, ttlHours) {
    // Memory cache record shape: { snapshot, cachedAt }
    if (record && typeof record === 'object' && 'cachedAt' in record) {
      if (!record.cachedAt) return true;
      const timestamp = new Date(record.cachedAt).getTime();
      if (!Number.isFinite(timestamp)) return true;
      const ageMs = Date.now() - timestamp;
      return ageMs > ttlHours * 60 * 60 * 1000;
    }
    // Frontmatter snapshot shape: { fetchedAt, ...weather fields }
    if (!record) return true;
    if (!record.fetchedAt) return true;
    const timestamp = new Date(record.fetchedAt).getTime();
    if (!Number.isFinite(timestamp)) return true;
    const ageMs = Date.now() - timestamp;
    return ageMs > ttlHours * 60 * 60 * 1000;
  }

  _configKey() {
    return _weatherConfigKey(this.plugin.settings);
  }

  isSnapshotCompatible(snapshot) {
    return _snapshotMatchesWeatherConfig(snapshot, this.plugin.settings);
  }

  getCachedSnapshot(dateStr) {
    const entry = this.plugin.weatherCache?.[dateStr];
    if (entry && this.isSnapshotCompatible(entry)) return entry;

    const path = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
    const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile) {
      const cache = this.plugin.app.metadataCache.getFileCache(existingFile);
      const snap = cache?.frontmatter?._calendar_weather;
      if (snap && this.isSnapshotCompatible(snap)) return snap;
    }
    return null;
  }

  /** Fetch from Open-Meteo or return cached snapshot from plugin data. */
  async _fetchOrUseCached(dateStr) {
    const s = this.plugin.settings;
    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits;
    const ttlHours = s.weatherTtlHours || 2;
    const locationName = s.weatherLocationName || '';

    // Helper to normalize icon field (migrate emoji → .svg filename)
    const _normIcon = (entry) => {
      if (entry && typeof entry.icon === 'string' && !entry.icon.endsWith('.svg') && entry.weatherCode != null) {
        const wmo = _lookupWmo(entry.weatherCode);
        entry.icon = wmo.icon;
      }
    };

    // 1. Check weatherCache in plugin data.json (new storage)
    const cacheEntry = this.plugin.weatherCache?.[dateStr];
    if (cacheEntry && this.isSnapshotCompatible(cacheEntry) && cacheEntry.fetchedAt && !this._shouldFetch(cacheEntry, ttlHours)) {
      _normIcon(cacheEntry);
      return cacheEntry;
    }

    // 2. Fallback: check legacy frontmatter _calendar_weather (for existing users)
    const path = `${s.dailyFolder}/${dateStr}.md`;
    const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile) {
      const cache = this.plugin.app.metadataCache.getFileCache(existingFile);
      const snap = cache?.frontmatter?._calendar_weather;
      if (snap && typeof snap === 'object' && this.isSnapshotCompatible(snap) && !this._shouldFetch(snap, ttlHours)) {
        _normIcon(snap);
        this.plugin.weatherCache = this.plugin.weatherCache || {};
        this.plugin.weatherCache[dateStr] = { ...snap };
        this.plugin._saveWeatherCache();
        return snap;
      }
    }

    // 3. Memory cache (for dates without diary files)
    const cachedRecord = this._memoryCache.get(dateStr);
    if (cachedRecord && cachedRecord.configKey === this._configKey() && !this._shouldFetch(cachedRecord, ttlHours)) {
      return cachedRecord.snapshot;
    }

    // Fetch from Open-Meteo
    const weather = await this._fetchFromOpenMeteo(lat, lng, dateStr, units, locationName);
    if (!weather) {
      // Cache a null-result record so we don't hammer the API for missing notes
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: new Date().toISOString(), configKey: this._configKey() });
      return null;
    }

    // Persist snapshot to frontmatter if the file now exists
    await this._persistSnapshot(dateStr, weather);

    // Also cache in memory for subsequent calls on non-existent files
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: new Date().toISOString(), configKey: this._configKey() });

    return weather;
  }

  /** Call Open-Meteo API for current + forecast data. */
  async _fetchFromOpenMeteo(lat, lng, dateStr, units, locationName) {
    const isToday = dateStr === _formatDate(new Date(), this.plugin.settings.weatherTimezone);
    const timezone = this.plugin.settings.weatherTimezone || 'auto';

    // Build daily params
    const dailyParams = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      daily: 'temperature_2m_max,temperature_2m_min,weathercode,relative_humidity_2m_max,apparent_temperature_max',
      timezone,
      start_date: dateStr,
      end_date: dateStr,
    });
    if (units === 'imperial') {
      dailyParams.set('temperature_unit', 'fahrenheit');
      dailyParams.set('wind_speed_unit', 'mph');
    } else {
      dailyParams.set('temperature_unit', 'celsius');
      dailyParams.set('wind_speed_unit', 'kmh');
    }

    // Single combined request for today (current + daily), daily-only for other dates
    let baseUrl, url;
    if (isToday) {
      const combinedParams = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lng),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
        daily: 'temperature_2m_max,temperature_2m_min,weathercode,relative_humidity_2m_max,apparent_temperature_max',
        timezone,
        start_date: dateStr,
        end_date: dateStr,
      });
      if (units === 'imperial') {
        combinedParams.set('temperature_unit', 'fahrenheit');
        combinedParams.set('wind_speed_unit', 'mph');
      } else {
        combinedParams.set('temperature_unit', 'celsius');
        combinedParams.set('wind_speed_unit', 'kmh');
      }
      baseUrl = 'https://api.open-meteo.com/v1/forecast';
      url = `${baseUrl}?${combinedParams.toString()}`;
    } else {
      baseUrl = dateStr < _formatDate(new Date(), this.plugin.settings.weatherTimezone) ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
      url = `${baseUrl}?${dailyParams.toString()}`;
    }

    let response;
    try {
      response = await requestUrl({ url, timeout: 10000 });
    } catch (err) {
      console.warn('[Dayline] Weather fetch failed:', err.message);
      return null;
    }

    if (response.status !== 200 || !response.json) {
      console.warn('[Dayline] Weather API returned status', response.status);
      return null;
    }

    const json = response.json;

    // --- Today: combined current + daily ---
    if (isToday && json.current) {
      const cur = json.current;
      const code = typeof cur.weather_code === 'number' ? cur.weather_code : null;
      if (code !== null) {
        const wmo = _lookupWmo(code);
        const tempCur = typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null;
        const feelsCur = typeof cur.apparent_temperature === 'number' ? Math.round(cur.apparent_temperature) : null;
        const humCur = typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : null;

        // Merge daily high/low into current snapshot
        let high = null, low = null, feelsLike = null, humidity = null;
        if (json.daily) {
          const dates = json.daily.time || [];
          const idx = dates.indexOf(dateStr);
          if (idx >= 0) {
            high = typeof json.daily.temperature_2m_max?.[idx] === 'number' ? json.daily.temperature_2m_max[idx] : null;
            low = typeof json.daily.temperature_2m_min?.[idx] === 'number' ? json.daily.temperature_2m_min[idx] : null;
            feelsLike = typeof json.daily.apparent_temperature_max?.[idx] === 'number' ? json.daily.apparent_temperature_max[idx] : null;
            humidity = typeof json.daily.relative_humidity_2m_max?.[idx] === 'number' ? json.daily.relative_humidity_2m_max[idx] : null;
          }
        }

        return {
          fetchedAt: new Date().toISOString(),
          date: dateStr,
          location: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
          latitude: lat,
          longitude: lng,
          temperature: tempCur,
          feelsLike: feelsCur,
          humidity: humCur,
          weatherCode: code,
          condition: wmo.condition,
          icon: wmo.icon,
          high: high,
          low: low,
          temperatureLabel: 'Now',
          units: units,
          configKey: this._configKey(),
        };
      }
    }

    // Fallback: daily-only path (non-today or combined request lacked useful data)
    const dailyData = await this._dailyOnlyFetch(lat, lng, dateStr, dailyParams, units);
    if (!dailyData) return null;
    // Validate response status and JSON structure before accessing daily data
    if (dailyData.status !== 200 || !dailyData.json) {
      console.warn('[Dayline] Daily weather fetch returned unexpected response');
      return null;
    }
    const dailyJson = dailyData.json;
    if (!dailyJson?.daily) {
      console.warn('[Dayline] Daily weather data missing "daily" field');
      return null;
    }
    const daily = dailyJson.daily;
    const dates = daily.time || [];
    const idx = dates.indexOf(dateStr);

    if (idx === -1) {
      console.warn(`[Dayline] Weather data unavailable for ${dateStr}`);
      return null;
    }

    const code = daily.weathercode?.[idx];
    const tempMax = daily.temperature_2m_max?.[idx];
    const tempMin = daily.temperature_2m_min?.[idx];
    const feelsLike = daily.apparent_temperature_max?.[idx];
    const humidity = daily.relative_humidity_2m_max?.[idx];

    if (typeof code !== 'number') return null;

    const wmo = _lookupWmo(code);

    return {
      fetchedAt: new Date().toISOString(),
      date: dateStr,
      location: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
      latitude: lat,
      longitude: lng,
      temperature: typeof tempMax === 'number' ? Math.round(tempMax) : null,
      feelsLike: typeof feelsLike === 'number' ? Math.round(feelsLike) : null,
      humidity: typeof humidity === 'number' ? humidity : null,
      weatherCode: code,
      condition: wmo.condition,
      icon: wmo.icon,
      high: typeof tempMax === 'number' ? tempMax : null,
      low: typeof tempMin === 'number' ? tempMin : null,
      temperatureLabel: 'High',
      units: units,
      configKey: this._configKey(),
    };
  }

  /** Fetch only daily data (for non-today dates or fallback). */
  async _dailyOnlyFetch(lat, lng, dateStr, params, units) {
    const baseUrl = (() => {
      return dateStr < _formatDate(new Date(), this.plugin.settings.weatherTimezone)
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast';
    })();

    const url = `${baseUrl}?${params.toString()}`;

    try {
      return await requestUrl({ url, timeout: 8000 });
    } catch (err) {
      console.warn('[Dayline] Daily weather fetch failed:', err.message);
      return null;
    }
  }

  /** Persist weather snapshot to plugin data (no more YAML pollution). */
  async _persistSnapshot(dateStr, weather) {
    if (weather?.configKey && weather.configKey !== this._configKey()) return;
    if (!this.plugin.weatherCache) this.plugin.weatherCache = {};
    this.plugin.weatherCache[dateStr] = { ...weather, configKey: this._configKey() };
    this.plugin._saveWeatherCache();
  }

  /** Force refresh weather for a specific date (bypasses TTL check). */
  async forceRefresh(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return null;

    // Clear in-flight promises for this date. Their completion handlers are
    // guarded so they cannot delete or overwrite a newer request.
    for (const key of this._inFlight.keys()) {
      if (key.startsWith(`${dateStr}|`)) this._inFlight.delete(key);
    }

    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits;
    const locationName = s.weatherLocationName || '';

    const weather = await this._fetchFromOpenMeteo(lat, lng, dateStr, units, locationName);
    if (!weather) {
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: new Date().toISOString(), configKey: this._configKey() });
      return null;
    }

    // Update memory cache immediately so UI can read it without waiting on persistence
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: new Date().toISOString(), configKey: this._configKey() });

    // Persist to frontmatter asynchronously — fire-and-forget with error handling
    this._persistSnapshot(dateStr, weather).catch((err) => {
      console.warn('[Dayline] Async weather persistence failed:', err.message);
    });

    return weather;
  }

  /** Check if a date has a valid cached snapshot (for badge display). */
  hasCachedSnapshot(dateStr) {
    if (!this.plugin.settings.weatherEnabled) return false;
    // Check new weatherCache first
    return !!this.getCachedSnapshot(dateStr);
  }

  /** Bulk-fetch weather for a list of dates with 2s delay between requests. */
  async bulkBackfill(dateStrs, onProgress) {
    let done = 0;
    const total = dateStrs.length;
    for (const dateStr of dateStrs) {
      // Skip if already cached and not stale
      const entry = this.plugin.weatherCache?.[dateStr];
      if (entry && this.isSnapshotCompatible(entry) && entry.fetchedAt && !this._shouldFetch(entry, this.plugin.settings.weatherTtlHours || 2)) {
        done++;
        onProgress?.(done, total, dateStr, true);
        continue;
      }
      try {
        await this.forceRefresh(dateStr);
      } catch (e) {
        console.warn('[Dayline] Backfill failed for', dateStr, e.message);
      }
      done++;
      onProgress?.(done, total, dateStr, false);
      // Delay between requests to be nice to the free API
      if (done < total) await new Promise(r => setTimeout(r, 2000));
    }
    // Persist all fetched data
    this.plugin._saveWeatherCache();
    return done;
  }
}

/* ============================================================
   Locale / i18n
   ============================================================ */
const LOCALE = {
  en: {
    now:      'Now',
    high:     'High',
    feels:    'Feels',
    humidity: 'Humidity',
    low:      'Low',
    loading:  'Loading...',
    unavailable:    'Unavailable',
    checkSettings:  'Check settings or try again',
    noData:         'No weather data available',
    refresh:        'Refresh weather',
    setupHint:      '\u26A0\uFE0F  Set latitude & longitude in settings to enable weather',
    setupAria:      'Weather requires configured coordinates.',
    weatherUpdated: (d) => `Weather updated for ${d}`,
    noDataFor:      (d) => `No weather data available for ${d}`,
    refreshFailed:  (e) => `Failed to refresh weather: ${e}`,
    // Settings tab
    s_dailyFolder:       'Daily notes folder',
    s_dailyFolderDesc:   'Path to your daily notes folder (relative to vault root). Notes should be named YYYY-MM-DD.md',
    s_thumbnailFilter:   'Thumbnail filter',
    s_thumbnailFilterDesc: 'Which embedded images to show as date thumbnails',
    s_thumbnailAll:      'All embedded images',
    s_thumbnailDate:     'Only date-prefixed (YYYY-MM-DD_*)',
    s_weather:           'Weather',
    s_weatherEnable:     'Enable weather',
    s_weatherEnableDesc: 'Show weather info for dates in Dayline',
    s_latitude:          'Latitude',
    s_latitudeDesc:      'Your latitude (e.g. 39.9042 for Beijing)',
    s_longitude:         'Longitude',
    s_longitudeDesc:     'Your longitude (e.g. 116.4074 for Beijing)',
    s_locationName:      'Location name',
    s_locationNameDesc:  'Display name (optional, shown in tooltip)',
    s_tempUnits:         'Temperature units',
    s_tempUnitsDesc:     'Display temperature in Celsius or Fahrenheit',
    s_autoFetch:         'Auto-fetch weather',
    s_autoFetchDesc:     'Automatically fetch weather when opening a daily note',
    s_cacheTtl:          'Cache TTL (hours)',
    s_cacheTtlDesc:      'How long to keep cached weather before re-fetching',
    s_language:          'Language / 语言',
    s_languageDesc:      'Display language for weather labels',
    s_browseFolders:     'Browse folders',
    s_celsius:           'Celsius (\u00B0C)',
    s_fahrenheit:        'Fahrenheit (\u00B0F)',
    s_english:           'English',
    s_chinese:           '中文',
    // EXIF tooltip
    s_exif:              'EXIF Metadata',
    s_exifEnable:        'Show image EXIF metadata',
    s_exifEnableDesc:    'Display camera settings and capture info when hovering over images',
    s_exifGeocode:       'Resolve GPS locations',
    s_exifGeocodeDesc:   'Send EXIF GPS coordinates to OpenStreetMap Nominatim to show place names',
    exif_loading:        'Reading...',
    exif_noData:         'No EXIF data',
    exif_noDataDesc:     'This image does not contain camera metadata',
    exif_camera:         'Camera',
    exif_lens:           'Lens',
    exif_date:           'Date',
    exif_aperture:       'Aperture',
    exif_shutter:        'Shutter',
    exif_iso:            'ISO',
    exif_focal:          'Focal Length',
    exif_gps:            'GPS',
    exif_software:       'Software',
    // On This Day
    otd_title:           'On This Day',
    otd_button:          (m,d) => `📅 ${m}/${d}`,
    otd_emptyYear:       'No entry for this day',
    otd_noMemories:      'No memories for this day yet',
    otd_yearsAgo:        (n) => `${n} year${n>1?'s':''} ago`,
    otd_emptyExcerpt:    '(no text)',
    otd_close:           'Close',
    otd_openNote:        'Open note',
    otd_prev:            'Previous year',
    otd_next:            'Next year',
    s_otd:               'On This Day',
    s_otdDot:            'Show markers on calendar',
    s_otdDotDesc:        'Display a small dot on dates with past-year entries',
    s_otdButton:         'Show sidebar button',
    s_otdButtonDesc:     'Display an On This Day button below the weather card',
    s_otdExcerptMode:    'Excerpt mode',
    s_otdExcerptModeDesc:'How to generate text previews for past entries',
    s_otdExcerptAuto:    'Auto-extract from note body',
    s_otdExcerptFrontmatter: 'From frontmatter field',
    s_otdExcerptNone:    'No excerpt',
    s_otdExcerptTemplate: 'Custom template',
    s_otdExcerptTemplateDesc: 'Use {body}, {year}, {date}, or any frontmatter key like {mood}',
    s_otdTemplate:     'Template',
    s_otdTemplateDesc:  'Template string for custom excerpt mode',
    s_otdExcerptKey:     'Frontmatter field name',
    s_otdExcerptKeyDesc: 'Which frontmatter key to read (only used in frontmatter mode)',
    // Weather backfill
    s_backfill:          'Bulk backfill weather',
    s_backfillDesc:      'Fetch historical weather for all past diary dates (may take several minutes)',
    s_backfillBtn:       'Start backfill',
    s_backfillStarted:   (n) => `Backfilling ${n} days...`,
    s_backfillProgress:  (done, total) => `Backfill: ${done}/${total}`,
    s_backfillDone:      (n) => `Backfill complete: ${n} days`,
    s_backfillAllDone:   'All dates already have weather data',
  },
  zh: {
    now:      '现在',
    high:     '最高',
    feels:    '体感',
    humidity: '湿度',
    low:      '最低',
    loading:  '加载中...',
    unavailable:    '不可用',
    checkSettings:  '检查设置或重试',
    noData:         '暂无天气数据',
    refresh:        '刷新天气',
    setupHint:      '\u26A0\uFE0F  在设置中配置经纬度以启用天气',
    setupAria:      '天气需要配置坐标。',
    weatherUpdated: (d) => `已更新 ${d} 的天气`,
    noDataFor:      (d) => `${d} 暂无天气数据`,
    refreshFailed:  (e) => `刷新天气失败：${e}`,
    // Settings tab
    s_dailyFolder:       '日记文件夹',
    s_dailyFolderDesc:   '日记文件所在的文件夹路径（相对于 vault 根目录），文件命名格式 YYYY-MM-DD.md',
    s_thumbnailFilter:   '缩略图筛选',
    s_thumbnailFilterDesc: '选择哪些嵌入图片作为日期缩略图',
    s_thumbnailAll:      '所有嵌入图片',
    s_thumbnailDate:     '仅日期前缀 (YYYY-MM-DD_*)',
    s_weather:           '天气',
    s_weatherEnable:     '启用天气',
    s_weatherEnableDesc: '在日历侧边栏中显示日期天气信息',
    s_latitude:          '纬度',
    s_latitudeDesc:      '所在地纬度（如 北京 39.9042）',
    s_longitude:         '经度',
    s_longitudeDesc:     '所在地经度（如 北京 116.4074）',
    s_locationName:      '位置名称',
    s_locationNameDesc:  '显示名称（可选，鼠标悬停时显示）',
    s_tempUnits:         '温度单位',
    s_tempUnitsDesc:     '选择摄氏度或华氏度',
    s_autoFetch:         '自动获取天气',
    s_autoFetchDesc:     '打开日记时自动获取天气数据',
    s_cacheTtl:          '缓存时长（小时）',
    s_cacheTtlDesc:      '天气数据缓存的有效时长，过期后重新获取',
    s_language:          '语言 / Language',
    s_languageDesc:      '天气标签的显示语言',
    s_browseFolders:     '浏览文件夹',
    s_celsius:           '摄氏 (\u00B0C)',
    s_fahrenheit:        '华氏 (\u00B0F)',
    s_english:           'English',
    s_chinese:           '中文',
    // EXIF tooltip
    s_exif:              'EXIF 信息',
    s_exifEnable:        '显示图片 EXIF 信息',
    s_exifEnableDesc:    '鼠标悬停在日历图片上时，显示相机参数和拍摄数据',
    s_exifGeocode:       '解析 GPS 地点',
    s_exifGeocodeDesc:   '将 EXIF GPS 坐标发送到 OpenStreetMap Nominatim 以显示地名',
    exif_loading:        '读取中...',
    exif_noData:         '无 EXIF 信息',
    exif_noDataDesc:     '这张图片没有包含拍摄元数据',
    exif_camera:         '相机',
    exif_lens:           '镜头',
    exif_date:           '拍摄时间',
    exif_aperture:       '光圈',
    exif_shutter:        '快门',
    exif_iso:            'ISO',
    exif_focal:          '焦距',
    exif_gps:            'GPS',
    exif_software:       '软件',
    // On This Day
    otd_title:           '去年今日',
    otd_button:          (m,d) => `📅 ${m}月${d}日`,
    otd_emptyYear:       '这一天还没有记录',
    otd_noMemories:      '还没有往年的今天',
    otd_yearsAgo:        (n) => `${n}年前`,
    otd_emptyExcerpt:    '（无文字内容）',
    otd_close:           '关闭',
    otd_openNote:        '打开笔记',
    otd_prev:            '上一年',
    otd_next:            '下一年',
    s_otd:               '去年今日',
    s_otdDot:            '日历上显示标记',
    s_otdDotDesc:        '在有往年记录的日期格子上显示小圆点标记',
    s_otdButton:         '显示侧边栏按钮',
    s_otdButtonDesc:     '在天气卡片下方显示「去年今日」按钮',
    s_otdExcerptMode:    '摘要模式',
    s_otdExcerptModeDesc:'如何生成往年日记的文字预览',
    s_otdExcerptAuto:    '自动提取正文',
    s_otdExcerptFrontmatter: '从 frontmatter 字段',
    s_otdExcerptNone:    '不显示摘要',
    s_otdExcerptTemplate: '自定义模板',
    s_otdExcerptTemplateDesc: '使用 {body}、{year}、{date} 或任意 frontmatter 键如 {mood}',
    s_otdTemplate:     '模板',
    s_otdTemplateDesc:  '自定义摘要的模板字符串',
    s_otdExcerptKey:     'Frontmatter 字段名',
    s_otdExcerptKeyDesc: '读取哪个 frontmatter 键（仅 frontmatter 模式下使用）',
    // Weather backfill
    s_backfill:          '回填历史天气',
    s_backfillDesc:      '为所有已有日记但缺少天气数据的日期批量拉取天气（约需数分钟）',
    s_backfillBtn:       '开始回填',
    s_backfillStarted:   (n) => `开始回填 ${n} 天……`,
    s_backfillProgress:  (done, total) => `回填中: ${done}/${total}`,
    s_backfillDone:      (n) => `回填完成: ${n} 天`,
    s_backfillAllDone:   '所有日期已有天气数据',
  },
};

/** Look up a localized string by key. */
function _l(lang, key, ...args) {
  const entry = LOCALE[lang]?.[key];
  return typeof entry === 'function' ? entry(...args) : (entry ?? key);
}

/* ============================================================
   Lightweight JPEG EXIF Parser (zero-dependency)
   ============================================================ */

/**
 * Parse EXIF data from a JPEG ArrayBuffer.
 * Returns an object with human-readable values, or null if no EXIF found.
 */
/* ============================================================
   Shared TIFF/EXIF Parser (format-agnostic)
   Takes a DataView positioned at the TIFF header.
   ============================================================ */

function _parseExifData(exifBytes) {
  const dv = new DataView(exifBytes);
  let le = true; // little-endian default
  const r16 = (o) => dv.getUint16(o, le);
  const r32 = (o) => dv.getUint32(o, le);

  function _parseTiff(offset, depth) {
    if (depth > 2) return null;
    const bo = dv.getUint16(offset);
    if (bo === 0x4949) le = true;
    else if (bo === 0x4D4D) le = false;
    else return null;
    if (r16(offset + 2) !== 42) return null;
    const ifdOff = r32(offset + 4);
    if (ifdOff === 0) return null;
    return _readIfd(offset + ifdOff, offset, depth);
  }

  function _readIfd(ifdStart, tiffBase, depth) {
    const n = r16(ifdStart);
    if (n === 0 || n > 256) return null;
    const result = {};
    let gpsOff = null;
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const type = r16(eo + 2);
      const count = r32(eo + 4);
      const vo = eo + 8;
      if (tag === 0x8769) { // EXIF IFD
        const exifIfd = r32(vo);
        if (exifIfd > 0) {
          const d = _readIfd(tiffBase + exifIfd, tiffBase, depth + 1);
          if (d) Object.assign(result, d);
        }
        continue;
      }
      if (tag === 0x8825) { gpsOff = r32(vo); continue; } // GPS IFD
      const val = _readTag(eo, type, count, tiffBase);
      switch (tag) {
        case 0x010F: result.make = val; break;
        case 0x0110: result.model = val; break;
        case 0x0131: result.software = val; break;
        case 0x9003: result.dateTimeOriginal = val; break;
        case 0x829A: result.exposureTime = val; break;
        case 0x829D: result.fNumber = val; break;
        case 0x8827: result.iso = val; break;
        case 0x920A: result.focalLength = val; break;
        case 0xA434: result.lensModel = val; break;
      }
    }
    if (gpsOff !== null && gpsOff > 0) {
      const g = _readGps(tiffBase + gpsOff, tiffBase);
      if (g) Object.assign(result, g);
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function _readGps(ifdStart, tiffBase) {
    const n = r16(ifdStart);
    if (n === 0 || n > 64) return null;
    const r = {};
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const val = _readTag(eo, r16(eo + 2), r32(eo + 4), tiffBase);
      if (tag === 1) r.gpsLatRef = val;
      if (tag === 2) r.gpsLat = val;
      if (tag === 3) r.gpsLonRef = val;
      if (tag === 4) r.gpsLon = val;
    }
    if (r.gpsLat && Array.isArray(r.gpsLat) && r.gpsLat.length >= 3) {
      const lat = r.gpsLat[0] + r.gpsLat[1] / 60 + r.gpsLat[2] / 3600;
      r.gpsLatDecimal = r.gpsLatRef === 'S' ? -lat : lat;
    }
    if (r.gpsLon && Array.isArray(r.gpsLon) && r.gpsLon.length >= 3) {
      const lon = r.gpsLon[0] + r.gpsLon[1] / 60 + r.gpsLon[2] / 3600;
      r.gpsLonDecimal = r.gpsLonRef === 'W' ? -lon : lon;
    }
    return r;
  }

  function _readTag(entryOffset, type, count, tiffBase) {
    const dataOff = entryOffset + 8;
    const sizes = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };
    const sz = sizes[type] || 1;
    const total = count * sz;
    const vo = total <= 4 ? dataOff : (tiffBase + r32(dataOff));

    switch (type) {
      case 1: case 6: case 7:
        if (count === 1) return dv.getUint8(vo);
        const bytes = []; for (let i = 0; i < count; i++) bytes.push(dv.getUint8(vo + i));
        return bytes;
      case 2:
        let s = ''; for (let i = 0; i < count - 1; i++) s += String.fromCharCode(dv.getUint8(vo + i));
        return s.trim();
      case 3:
        if (count === 1) return r16(vo);
        const sa = []; for (let i = 0; i < count; i++) sa.push(r16(vo + i * 2));
        return sa;
      case 4:
        if (count === 1) return r32(vo);
        const la = []; for (let i = 0; i < count; i++) la.push(r32(vo + i * 4));
        return la;
      case 5: case 10:
        if (count === 1) { const n = r32(vo), d = r32(vo + 4); return d === 0 ? n : n / d; }
        const ra = [];
        for (let i = 0; i < count; i++) { const n = r32(vo + i * 8), d = r32(vo + i * 8 + 4); ra.push(d === 0 ? n : n / d); }
        return ra;
      case 9:
        if (count === 1) return dv.getInt32(vo, le);
        const sla = []; for (let i = 0; i < count; i++) sla.push(dv.getInt32(vo + i * 4, le));
        return sla;
      default: return dv.getUint8(vo);
    }
  }

  const result = _parseTiff(0, 0);
  return result;
}

/* ============================================================
   Format-specific EXIF extractors
   ============================================================ */

/** Extract EXIF from JPEG (APP1 marker). */
function parseJpegExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null;
  let offset = 2;
  while (offset < dv.byteLength - 1) {
    const marker = dv.getUint16(offset);
    if (marker === 0xFFE1) {
      if (dv.getUint32(offset + 4) === 0x45786966) { // "Exif"
        return _parseExifData(arrayBuffer.slice(offset + 10));
      }
    }
    if (marker < 0xFF00 || marker === 0xFFD8 || marker === 0xFFD9) break;
    const segLen = dv.getUint16(offset + 2);
    if (segLen < 2) break;
    offset += 2 + segLen;
  }
  return null;
}

/** Extract EXIF from PNG (eXIf chunk). */
function parsePngExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 8) return null;
  // PNG signature: 137 80 78 71 13 10 26 10
  if (dv.getUint32(0) !== 0x89504E47 || dv.getUint32(4) !== 0x0D0A1A0A) return null;
  let offset = 8;
  while (offset < dv.byteLength - 8) {
    const len = dv.getUint32(offset); // chunk length (big-endian)
    const type = dv.getUint32(offset + 4); // chunk type (4 ASCII chars)
    if (type === 0x65495866) { // "eXIf"
      // Chunk data starts at offset + 8, length is `len`
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + len));
    }
    if (type === 0x49454E44) break; // "IEND" — end of PNG
    offset += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }
  return null;
}

/** Extract EXIF from WebP (RIFF container, EXIF chunk). */
function parseWebpExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 16) return null;
  // RIFF header: "RIFF" + fileSize + "WEBP"
  if (dv.getUint32(0) !== 0x52494646) return null; // "RIFF"
  if (dv.getUint32(8) !== 0x57454250) return null; // "WEBP"
  let offset = 12;
  while (offset < dv.byteLength - 8) {
    const fourCC = dv.getUint32(offset);
    const chunkSize = dv.getUint32(offset + 4, true); // little-endian!
    if (fourCC === 0x45584946) { // "EXIF"
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + chunkSize));
    }
    if (fourCC === 0x56503820) { // "VP8 " — image data, no more metadata after this
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are padded to even
  }
  return null;
}

/** Extract EXIF from HEIC/HEIF (ISOBMFF container — scan for TIFF header). */
function parseHeicExif(arrayBuffer) {
  // HEIC files store EXIF as raw TIFF data inside the meta/mdat boxes.
  // We scan for the TIFF byte-order marker (II=0x4949 or MM=0x4D4D)
  // followed by magic 42 (0x002A).
  const dv = new DataView(arrayBuffer);
  const max = dv.byteLength - 8;
  for (let i = 0; i < max; i++) {
    const bo = dv.getUint16(i);
    if ((bo === 0x4949 || bo === 0x4D4D) && dv.getUint16(i + 2, bo === 0x4949) === 42) {
      // Found TIFF header — extract from here
      const exifSlice = arrayBuffer.slice(i);
      return _parseExifData(exifSlice);
    }
  }
  return null;
}

/** Unified entry point — auto-detects format and extracts EXIF. */
function parseImageExif(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return null;
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint16(0);
  const magic4 = dv.getUint32(0);
  // Check for HEIC ftyp box at offset 4: size(4) + "ftyp" + brand
  const brand4 = dv.getUint32(8);
  const isHeic = (arrayBuffer.byteLength > 12 && dv.getUint32(4) === 0x66747970 && // "ftyp"
    (brand4 === 0x68656963 || brand4 === 0x68656978 || brand4 === 0x68657663 || // heic/heix/hevc
     brand4 === 0x6865696D || brand4 === 0x68656973 || brand4 === 0x6865766D || // heim/heis/hevm
     brand4 === 0x68657673 || brand4 === 0x6D696631 || brand4 === 0x6D736631));  // hevs/mif1/msf1

  // JPEG: 0xFFD8
  if (magic === 0xFFD8) return parseJpegExif(arrayBuffer);
  // PNG: 0x89504E47
  if (magic4 === 0x89504E47) return parsePngExif(arrayBuffer);
  // WebP: 0x52494646 ("RIFF")
  if (magic4 === 0x52494646) return parseWebpExif(arrayBuffer);
  // HEIC/HEIF: ISOBMFF container
  if (isHeic) return parseHeicExif(arrayBuffer);

  return null;
}

/**
 * Format raw EXIF data into human-readable display fields.
 * Returns null if no meaningful data was found.
 */
function formatExifForDisplay(raw) {
  if (!raw) return null;

  const fields = [];

  // Camera: Make + Model
  if (raw.make || raw.model) {
    const make = raw.make || '';
    const model = raw.model || '';
    fields.push({ key: 'exif_camera', value: (make + ' ' + model).trim() });
  }

  // Lens
  if (raw.lensModel) {
    fields.push({ key: 'exif_lens', value: raw.lensModel });
  }

  // Date
  if (raw.dateTimeOriginal) {
    let dt = raw.dateTimeOriginal;
    if (typeof dt === 'string' && dt.includes(' ')) {
      dt = dt.replace(' ', '  '); // add spacing
    }
    fields.push({ key: 'exif_date', value: dt });
  }

  // Aperture
  if (raw.fNumber !== undefined && raw.fNumber !== null) {
    const f = typeof raw.fNumber === 'number' ? raw.fNumber.toFixed(1) : String(raw.fNumber);
    fields.push({ key: 'exif_aperture', value: 'f/' + f });
  }

  // Shutter speed
  if (raw.exposureTime !== undefined && raw.exposureTime !== null) {
    let shutter;
    if (typeof raw.exposureTime === 'number') {
      if (raw.exposureTime >= 1) {
        shutter = raw.exposureTime + 's';
      } else {
        const denom = Math.round(1 / raw.exposureTime);
        shutter = '1/' + denom + 's';
      }
    } else {
      shutter = String(raw.exposureTime);
    }
    fields.push({ key: 'exif_shutter', value: shutter });
  }

  // ISO
  if (raw.iso !== undefined && raw.iso !== null) {
    fields.push({ key: 'exif_iso', value: String(raw.iso) });
  }

  // Focal length
  if (raw.focalLength !== undefined && raw.focalLength !== null) {
    const fl = typeof raw.focalLength === 'number'
      ? Math.round(raw.focalLength) + 'mm'
      : String(raw.focalLength);
    fields.push({ key: 'exif_focal', value: fl });
  }

  // GPS
  if (raw.gpsLatDecimal !== undefined && raw.gpsLonDecimal !== undefined) {
    const lat = raw.gpsLatDecimal.toFixed(4);
    const lon = raw.gpsLonDecimal.toFixed(4);
    fields.push({ key: 'exif_gps', value: lat + ', ' + lon });
  }

  // Software
  if (raw.software) {
    fields.push({ key: 'exif_software', value: raw.software });
  }

  return fields.length > 0 ? fields : null;
}

/* ============================================================
   Image Metadata Cache
   ============================================================ */

class ImageMetadataCache {
  /**
   * @param {import('obsidian').App} app
   */
  constructor(app) {
    this.app = app;
    /** @type {Map<string, { fields: Array<{key:string,value:string}> } | null>} */
    this._cache = new Map();
    /** @type {Map<string, Promise>} */
    this._pending = new Map();
  }

  /**
   * Get formatted EXIF fields for an image file.
   * @param {import('obsidian').TFile} file
   * @returns {Promise<Array<{key:string,value:string}> | null>}
   */
  async get(file) {
    const filePath = file.path;
    const cached = this._cache.get(filePath);
    if (cached !== undefined) return cached;

    const pending = this._pending.get(filePath);
    if (pending) return pending;

    const promise = this._load(file);
    this._pending.set(filePath, promise);
    try {
      const result = await promise;
      this._cache.set(filePath, result);
      return result;
    } finally {
      this._pending.delete(filePath);
    }
  }

  async _load(file) {
    try {
      const buf = await this.app.vault.readBinary(file);
      const raw = parseImageExif(buf);
      if (!raw) return null;
      return formatExifForDisplay(raw);
    } catch (_) {
      return null;
    }
  }

  /** Invalidate cache for a specific file, or all files if no path given. */
  invalidate(filePath) {
    if (filePath) {
      this._cache.delete(filePath);
      this._pending.delete(filePath);
    } else {
      this._cache.clear();
      this._pending.clear();
    }
  }
}

/* ============================================================
   HEIC Thumbnail Cache (libheif-js powered)
   ============================================================ */

const HEIC_EXTS = ['heic', 'heif'];

class HeicCache {
  constructor(app) {
    this.app = app;
    /** @type {Map<string, {dataUrl:string, width:number, height:number}>} */
    this._cache = new Map();
    /** @type {Map<string, Promise>} */
    this._pending = new Map();
    this._libheifReady = null;
  }

  _getLibheif() {
    if (!this._libheifReady) {
      const plugin = this.app.plugins?.plugins?.dayline;
      const factory = plugin?._libheifFactory;
      if (!factory) {
        return Promise.reject(new Error('libheif not loaded'));
      }
      // factory() may return a Promise or the libheif object directly
      this._libheifReady = Promise.resolve(factory());
    }
    return this._libheifReady;
  }

  /**
   * Get a JPEG data URL thumbnail for a HEIC file.
   * @param {import('obsidian').TFile} file
   * @returns {Promise<{dataUrl:string, width:number, height:number}|null>}
   */
  async getThumbnail(file) {
    const key = `${file.path}:${file.stat?.mtime || 0}`;
    if (this._cache.has(key)) return this._cache.get(key);
    if (this._pending.has(key)) return this._pending.get(key);

    const promise = this._convert(file);
    this._pending.set(key, promise);
    try {
      const result = await promise;
      if (result) this._cache.set(key, result);
      return result;
    } finally {
      this._pending.delete(key);
    }
  }

  async _convert(file) {
    try {
      const buf = await this.app.vault.readBinary(file);
      const libheif = await this._getLibheif();

      const decoder = new libheif.HeifDecoder();
      const images = decoder.decode(new Uint8Array(buf));
      if (!images || !images.length) return null;
      const img = images[0];

      const origW = img.get_width();
      const origH = img.get_height();

      // Decode to canvas
      const canvas = document.createElement('canvas');
      canvas.width = origW;
      canvas.height = origH;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(origW, origH);

      await new Promise((resolve, reject) => {
        img.display(imageData, (displayData) => {
          if (!displayData) return reject(new Error('libheif display failed'));
          resolve(displayData);
        });
      });

      ctx.putImageData(imageData, 0, 0);

      // Scale down to max 900px for thumbnails
      const maxDim = 900;
      let tw = origW, th = origH;
      if (origW > maxDim || origH > maxDim) {
        const scale = maxDim / Math.max(origW, origH);
        tw = Math.round(origW * scale);
        th = Math.round(origH * scale);
      }

      const thumb = document.createElement('canvas');
      thumb.width = tw;
      thumb.height = th;
      const thumbCtx = thumb.getContext('2d');
      thumbCtx.drawImage(canvas, 0, 0, tw, th);

      const dataUrl = thumb.toDataURL('image/jpeg', 0.75);

      return { dataUrl, width: tw, height: th };
    } catch (e) {
      console.warn('[Dayline] HEIC conversion failed:', e.message || e);
      return null;
    }
  }

  invalidate(filePath) {
    if (filePath) {
      for (const key of this._cache.keys()) if (key.startsWith(`${filePath}:`)) this._cache.delete(key);
      for (const key of this._pending.keys()) if (key.startsWith(`${filePath}:`)) this._pending.delete(key);
    } else {
      this._cache.clear();
      this._pending.clear();
      this._libheifReady = null;
    }
  }
}

/* ============================================================
   Reverse Geocoder (Nominatim, free, no API key)
   ============================================================ */

class ReverseGeocoder {
  constructor() {
    this._cache = new Map();      // "lat,lon" → place name string
    this._pending = new Map();    // "lat,lon" → Promise (in-flight dedup)
    this._lastRequest = 0;        // rate limit: 1 req/s
    this._requestQueue = Promise.resolve();
  }

  /**
   * Look up a human-readable place name for coordinates.
   * Returns null if the lookup fails or has no result.
   */
  async lookup(lat, lon) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (this._cache.has(key)) return this._cache.get(key);
    if (this._pending.has(key)) return this._pending.get(key);

    this._requestQueue = this._requestQueue
      .catch(() => {})
      .then(() => this._doLookup(lat, lon, key));
    const promise = this._requestQueue;
    this._pending.set(key, promise);
    try {
      const result = await promise;
      this._cache.set(key, result);
      return result;
    } finally {
      this._pending.delete(key);
    }
  }

  async _doLookup(lat, lon, key) {
    // Respect Nominatim's 1 req/s rate limit
    const now = Date.now();
    const elapsed = now - this._lastRequest;
    if (elapsed < 1100) {
      await new Promise(r => setTimeout(r, 1100 - elapsed));
    }
    this._lastRequest = Date.now();

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&accept-language=zh`;
      const resp = await requestUrl({ url, headers: { 'User-Agent': 'ObsidianDayline/2.0' } });
      if (resp.status === 200 && resp.json) {
        const data = resp.json;
        // Use display_name: e.g. "广州市天河区..." 
        // For cleaner output, prefer `address` sub-fields
        if (data.address) {
          const a = data.address;
          // Build a concise label: city + district + suburb
          const parts = [a.city || a.town || a.county, a.district || a.suburb, a.village].filter(Boolean);
          if (parts.length > 0) return parts.join(' · ');
          if (data.display_name) return data.display_name.split(',')[0];
        }
        if (data.display_name) return data.display_name.split(',')[0];
      }
    } catch (e) {
      // Silently fail — just show raw coordinates
    }
    return null;
  }

  invalidate() { this._cache.clear(); this._pending.clear(); }
}

/* ============================================================
   On This Day Data Provider
   ============================================================ */

class OnThisDayProvider {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this._dateIndex = null;      // Set<"MM-DD"> of all dates that exist
    this._otdCache = new Map();  // Map<"MM-DD", [{year, dateStr, images[], excerpt}]>
  }

  /** Build a Set of all MM-DD that have diary entries (one-time scan). */
  async _ensureDateIndex() {
    if (this._dateIndex) return;
    const folderPath = this.plugin.settings.dailyFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this._dateIndex = new Set();
      return;
    }
    const today = new Date();
    const thisYear = today.getFullYear();
    const index = new Set();
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== 'md') continue;
      const match = child.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!match) continue;
      if (parseInt(match[1]) >= thisYear) continue; // skip current year
      index.add(`${match[2]}-${match[3]}`);
    }
    this._dateIndex = index;
  }

  /** Quick check: does any year have a diary for this MM-DD? */
  async hasEntries(month, day) {
    await this._ensureDateIndex();
    const key = `${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return this._dateIndex.has(key);
  }

  /** Full entries for a given MM-DD (images + excerpts). */
  async getEntries(month, day) {
    await this._ensureDateIndex();
    const key = `${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if (this._otdCache.has(key)) return this._otdCache.get(key);

    const folderPath = this.plugin.settings.dailyFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this._otdCache.set(key, []);
      return [];
    }

    const entries = [];
    const today = new Date();
    const thisYear = today.getFullYear();

    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== 'md') continue;
      const match = child.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!match) continue;
      const year = parseInt(match[1]);
      if (match[2] !== String(month).padStart(2,'0') || match[3] !== String(day).padStart(2,'0')) continue;
      if (year >= thisYear) continue; // skip current year

      // Extract images from metadataCache
      const cache = this.app.metadataCache.getFileCache(child);
      const embeds = cache?.embeds || [];
      const images = embeds
        .map(e => e.link)
        .filter(link => link && IMAGE_EXTS.includes(link.split('.').pop()?.toLowerCase()));

      // Extract excerpt
      let excerpt = null;
      const mode = this.plugin.settings.onThisDayExcerptMode;
      if (mode === 'frontmatter') {
        const fmKey = this.plugin.settings.onThisDayExcerptKey || 'excerpt';
        const fm = cache?.frontmatter;
        if (fm && fm[fmKey]) excerpt = String(fm[fmKey]).trim();
      } else if (mode === 'template') {
        try {
          const content = await this.app.vault.read(child);
          const tpl = this.plugin.settings.onThisDayExcerptTemplate || '{body}';
          excerpt = _renderExcerptTemplate(tpl, child.name.replace(/\.md$/, ''), year, cache?.frontmatter || {}, _extractExcerpt(content));
        } catch (e) { /* ignore read errors */ }
      } else if (mode !== 'none') {
        try {
          const content = await this.app.vault.read(child);
          excerpt = _extractExcerpt(content);
        } catch (e) { /* ignore read errors */ }
      }

      entries.push({ year, dateStr: child.name.replace(/\.md$/, ''), images, excerpt });
    }

    // Sort descending by year (most recent first)
    entries.sort((a, b) => b.year - a.year);
    // Only cache non-empty results to avoid race conditions with newly created files
    if (entries.length > 0) {
      this._otdCache.set(key, entries);
    }
    return entries;
  }

  /** Invalidate cache for a specific MM-DD, or all. */
  invalidate(mmdd) {
    if (mmdd) {
      this._otdCache.delete(mmdd);
    } else {
      this._otdCache.clear();
      this._dateIndex = null;
    }
  }
}

/** Strip Markdown/wiki syntax and return first ~100 chars of plain text. */
function _extractExcerpt(content) {
  let text = content.replace(/^---[\s\S]*?---\n*/, ''); // YAML frontmatter
  text = text.replace(/!\[\[.*?\]\]/g, '');               // embedded images
  text = text.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1'); // wiki links → label
  text = text.replace(/^#{1,6}\s+/gm, '');                // headings
  text = text.replace(/[*_~`]+/g, '');                    // bold/italic/strikethrough/code
  text = text.replace(/={2,}/g, '');                      // highlight
  text = text.replace(/^>\s?/gm, '');                     // blockquote
  text = text.replace(/^\s*[-*+]\s/gm, '');               // list bullets
  text = text.replace(/\n+/g, ' ');                       // newlines → space
  text = text.replace(/\s{2,}/g, ' ').trim();             // collapse whitespace
  if (text.length > 100) text = text.substring(0, 100) + '...';
  return text || null;
}

/** Render a user-customizable excerpt template. */
function _renderExcerptTemplate(template, dateStr, year, frontmatter, bodyText) {
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

/* ============================================================
   Calendar View (ItemView)
   ============================================================ */
class CalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
    // Track the displayed month — always the 1st of a month
    this.displayMonth = new Date();
    this.displayMonth.setDate(1);
    this.displayMonth.setHours(0, 0, 0, 0);
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
  getDisplayText(){ return 'Calendar'; }
  getIcon()       { return 'calendar'; }

  /* ----- Lifecycle ----- */
  async onOpen() {
    this.containerEl.addClass('cal-sidebar');

    // Build data for current month
    await this.buildMonthCache(this.displayMonth);

    // Preload On This Day date index for dot markers
    this._otdProvider._ensureDateIndex().then(() => {
      this._otdDotCache = this._otdProvider._dateIndex;
      if (this.plugin.settings.onThisDayDot) this.render(); // re-render to show dots
    });

    // Detect which date the user is currently viewing
    this._syncActiveDate();
    this.render();

    // Auto-refresh when vault changes
    this.registerEvent(
      this.app.vault.on('modify', (file) => this._onFileChanged(file))
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => this._onFileChanged(file))
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => this._onFileChanged(file))
    );
    // Re-highlight when the user switches tabs/leaves
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this._syncActiveDate();
        // Defer to avoid race with click handler calling openFile
        setTimeout(() => this.render(), 0);
      })
    );
    // Sync note overlays on file-open and layout changes
    this.registerEvent(
      this.app.workspace.on('file-open', () => this._syncNoteOverlays())
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this._syncNoteOverlays())
    );
  }

  onClose() {
    clearTimeout(this._refreshTimer);
    clearTimeout(this._exifNoteTimer);
    this.plugin._endExifHover();
    for (const observer of this._exifObservers?.values() || []) observer.disconnect();
    this._exifObservers?.clear();
    this._removeAllOverlaysFromViews();
    for (const container of this._hostPositionMarkers) {
      if (container.style.position === 'relative') container.style.removeProperty('position');
      this.plugin._hostPositionMarkers?.delete(container);
    }
    this._hostPositionMarkers.clear();
  }

  /* ----- File change refresh (debounced) ----- */
  _onFileChanged(file) {
    if (!(file instanceof TFile)) return;

    // Image metadata and HEIC thumbnails must be invalidated when the image
    // changes, even though the image itself is outside the daily-note folder.
    const extension = file.extension?.toLowerCase();
    if (IMAGE_EXTS.includes(extension)) {
      this.exifCache?.invalidate(file.path);
      this.plugin.heicCache?.invalidate(file.path);
      clearTimeout(this._refreshTimer);
      this._refreshTimer = setTimeout(async () => {
        this.monthCache.clear();
        await this.buildMonthCache(this.displayMonth);
        this.render();
      }, 300);
      return;
    }

    // Only care about daily-note markdown files after image handling.
    if (extension !== 'md') return;
    const folderPrefix = this.plugin.settings.dailyFolder + '/';
    if (!file.path.startsWith(folderPrefix)) return;

    // Invalidate EXIF cache — cheap to rebuild on next hover
    if (this.exifCache) this.exifCache.invalidate();

    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(async () => {
      // Invalidate cache for the affected month
      const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]) - 1;
        const key = `${year}-${month}`;
        this.monthCache.delete(key);
        // Invalidate OTD cache for this MM-DD
        if (this._otdProvider) {
          this._otdProvider.invalidate(`${match[2]}-${match[3]}`);
          this._otdProvider._dateIndex = null; // force full reindex on next access
        }
        this._otdDotCache = null; // force rebuild on next render
        await this.buildMonthCache(this.displayMonth);
      } else {
        this.monthCache.delete(this._monthKey(this.displayMonth));
        if (this._otdProvider) { this._otdProvider.invalidate(); this._otdProvider._dateIndex = null; }
        this._otdDotCache = null;
        await this.buildMonthCache(this.displayMonth);
      }
      // Rebuild OTD dot cache async
      if (this._otdProvider && this.plugin.settings.onThisDayDot) {
        this._otdProvider._ensureDateIndex().then(() => {
          this._otdDotCache = this._otdProvider._dateIndex;
        });
      }
      this.render();
    }, 300);
  }

  /* ----- Public refresh (called from plugin) ----- */
  async refresh() {
    this.monthCache.delete(this._monthKey(this.displayMonth));
    if (this.exifCache) this.exifCache.invalidate();
    if (this._otdProvider) this._otdProvider.invalidate();
    this._otdDotCache = null;
    await this.buildMonthCache(this.displayMonth);
    this.render();
    // Rebuild OTD dot cache async
    if (this._otdProvider && this.plugin.settings.onThisDayDot) {
      this._otdProvider._ensureDateIndex().then(() => {
        this._otdDotCache = this._otdProvider._dateIndex;
        this.render();
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

    const folderPath = this.plugin.settings.dailyFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return;

    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const map = new Map();

    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== 'md') continue;
      const dateMatch = child.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!dateMatch || dateMatch[1] !== String(year) || dateMatch[2] !== String(month + 1).padStart(2, '0')) continue;

      const dateStr = child.name.replace(/\.md$/, '');
      const cache = this.app.metadataCache.getFileCache(child);
      if (!cache) continue;

      const embeds = cache.embeds || [];
      let images = embeds
        .map((e) => e.link)
        .filter((link) => link && IMAGE_EXTS.includes(link.split('.').pop()?.toLowerCase()));

      // Apply thumbnail filter
      if (this.plugin.settings.thumbnailFilter === 'date-prefixed') {
        images = images.filter((link) => {
          const fileName = String(link).split(/[\\/]/).pop() || '';
          return fileName.startsWith(dateStr);
        });
      }

      if (images.length > 0) {
        map.set(dateStr, images);
      }
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
    title.setText(`${year}年${month + 1}月`);

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
      const todayDate = new Date();
      const tm = todayDate.getMonth() + 1, td = todayDate.getDate();
      otdBtn.setText(_l(this.plugin.settings.weatherLanguage, 'otd_button', tm, td));
      otdBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = new Date();
        this.plugin.openOnThisDay(d.getMonth() + 1, d.getDate());
      });
    }

    // --- Weekday row ---
    const wd = el.createDiv({ cls: 'cal-weekdays' });
    for (const day of ['日', '一', '二', '三', '四', '五', '六']) {
      wd.createEl('span', { cls: 'cal-weekday', text: day });
    }

    // --- Grid ---
    const grid = el.createDiv({ cls: 'cal-grid' });

    const firstDay = new Date(year, month, 1).getDay(); // 0=Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const todayStr = _formatDate(today);

    // Empty cells before the 1st
    for (let i = 0; i < firstDay; i++) {
      grid.createDiv({ cls: 'cal-day cal-day-empty' });
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dateStr = _formatDate(dateObj);
      const images = imageMap.get(dateStr) || [];
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
        this._setBackground(bg, images[0], dateStr);

        // EXIF tooltip on hover
        const firstImage = images[0];
        cell.addEventListener('mouseenter', () => this._onExifEnter(cell, firstImage, dateStr));
        cell.addEventListener('mouseleave', () => this._onExifLeave());
      }

      // Weather badge for dates with cached weather
      if (this.plugin.settings.weatherEnabled
        && shouldShowCalendarWeatherBadge(this.plugin.settings)
        && this.weather.hasCachedSnapshot(dateStr)) {
        const snap = this._readCachedWeather(dateStr);
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
          || this.plugin.journalIndex?.getEntries().find((entry) => entry.path === dailyPath)?.mood
        : undefined;
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
          this.plugin.openMoodPicker(dailyPath, { allowDateSelection: true, ensureFile: false });
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
        this._openNote(dateStr);
      });
    }
  }

  /* ----- EXIF Tooltip (delegates to plugin) ----- */

  _ensureExifTooltip() { this.plugin._ensureExifTooltip(); }
  _showExifTooltip(el, fields, loading) { this.plugin._showExifTooltip(el, fields, loading); }
  _hideExifTooltip() { this.plugin._hideExifTooltip(); }

  /** Mouse entered a day cell with an image — start the hover timer. */
  _onExifEnter(cell, imageLink, dateStr) {
    if (!this.plugin.settings.showExif) return;
    const hoverToken = this.plugin._beginExifHover();

    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        const sourcePath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
        const file = this.app.metadataCache.getFirstLinkpathDest(imageLink, sourcePath);
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
  _readCachedWeather(dateStr) {
    const entry = this.weather.getCachedSnapshot(dateStr);
    if (entry && typeof entry === 'object') {
      // Normalize icon: migrate emoji → .svg filename
      if (typeof entry.icon === 'string' && !entry.icon.endsWith('.svg') && entry.weatherCode != null) {
        entry.icon = _lookupWmo(entry.weatherCode).icon;
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

    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) {
      const hint = containerEl.createDiv({ cls: 'cal-weather-setup' });
      hint.setText(_l(s.weatherLanguage, 'setupHint'));
      hint.setAttribute('aria-label', _l(s.weatherLanguage, 'setupAria'));
      return;
    }

    // Use activeDate or today for the card
    const cardDate = this.activeDate || _formatDate(new Date());

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
    dateStr = dateStr || this.activeDate || _formatDate(new Date());
    await this._performRefresh(dateStr, null);
  }

  /* ----- Perform a refresh with loading/disabled state on the button ----- */
  async _performRefresh(dateStr, btnEl) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return;

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
  async _setBackground(bgEl, link, dateStr) {
    try {
      const sourcePath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      const result = await this.plugin.thumbnailService.load(link, sourcePath);
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

    this.buildMonthCache(this.displayMonth).then(() => this.render());
  }

  /* ----- Open (or create + open) daily note ----- */
  _openNote(dateStr) {
    const path = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);

    const openFileInLeaf = (f) => {
      const activeLeaf = this.app.workspace.activeLeaf;
      const isMarkdown = activeLeaf?.view?.getViewType?.() === 'markdown';
      const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
      const leaf = isMarkdown
        ? activeLeaf                        // use active tab if it's a markdown view
        : (mdLeaves.length > 0 ? mdLeaves[0] : this.app.workspace.getLeaf(true));
      leaf.openFile(f).then(() => {
        this._syncActiveDate(leaf);
        this.render();
        // Trigger background weather load after note opens (non-blocking)
        this._triggerWeatherAfterOpen(dateStr);
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
        });
      }).open();
    }
  }

  /* ----- Trigger weather fetch after note open/create (non-blocking) ----- */
  _triggerWeatherAfterOpen(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled || !s.weatherAutoFetch) return;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return;
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
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) {
      this._removeAllOverlaysFromViews();
      return;
    }

    const dailyFolder = s.dailyFolder;
    const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
    const validDailyFiles = new Set();

    // Collect valid daily note leaves
    for (const leaf of mdLeaves) {
      const file = leaf.view?.file;
      if (!(file instanceof TFile)) continue;
      if (!file.path.startsWith(dailyFolder + '/')) continue;
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) continue;

      validDailyFiles.add(file.path);

      // Check if there's already an in-flight request for this leaf — skip if so
      if (this._overlayInFlight.has(leaf)) {
        continue;
      }

      this._createOrUpdateOverlay(leaf, file);
    }

    // Remove stale overlays from EVERY non-daily markdown leaf
    // Must handle leaves without TFile (e.g., blank editor, Homepage.md, etc.)
    for (const leaf of mdLeaves) {
      const file = leaf.view?.file;
      const path = file ? file.path : null;

      // Skip valid daily notes
      if (path && validDailyFiles.has(path)) continue;

      // For leaves with no file (blank editor, etc.), still clean up
      // For leaves with a non-daily file (Homepage.md), clean up too
      const overlay = leaf.containerEl?.querySelector(`[${OVERLAY_ATTR}]`);
      if (overlay) {
        overlay.remove();
      }
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
      const dailyFolder = this.plugin.settings.dailyFolder;

      // Disconnect old observers for leaves no longer showing daily notes
      const activeDailyLeaves = new Set();
      const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
      for (const leaf of mdLeaves) {
        const file = leaf.view?.file;
        if (!(file instanceof TFile)) continue;
        if (!file.path.startsWith(dailyFolder + '/')) continue;
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) continue;
        activeDailyLeaves.add(leaf);
        this._observeNoteImages(leaf);
      }

      // Disconnect observers for non-daily-note leaves
      if (this._exifObservers) {
        for (const [leaf, obs] of this._exifObservers) {
          if (!activeDailyLeaves.has(leaf)) {
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
      if (HEIC_EXTS.includes(ext) && !el.querySelector('.cal-heic-preview')) {
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
  async _createOrUpdateOverlay(leaf, file) {
    const dateStr = file.name.replace(/\.md$/, '');
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
      snap.icon = _lookupWmo(snap.weatherCode).icon;
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
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
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
    const folderPrefix = this.plugin.settings.dailyFolder + '/';
    if (!file.path.startsWith(folderPrefix)) {
      this._clearActiveDate();
      return;
    }
    const match = file.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (match) {
      const newDate = match[1];
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
    const folderPath = this.plugin.settings.dailyFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return;

    const dateStrs = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== 'md') continue;
      const match = child.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!match) continue;
      const ds = match[0].replace(/\.md$/, '');
      // Skip dates that already have cached weather (new storage or legacy frontmatter)
      if (!this.weather.hasCachedSnapshot(ds)) dateStrs.push(ds);
    }

    if (dateStrs.length === 0) {
      new Notice(_l(this.plugin.settings.weatherLanguage, 's_backfillAllDone'));
      return;
    }

    const lang = this.plugin.settings.weatherLanguage;
    new Notice(_l(lang, 's_backfillStarted', dateStrs.length));
    await this.weather.bulkBackfill(dateStrs, (done, total) => {
      if (done % 5 === 0 || done === total) {
        new Notice(_l(lang, 's_backfillProgress', done, total));
      }
    });
    new Notice(_l(lang, 's_backfillDone', dateStrs.length));
    this.render();
  }
}

/* ============================================================
   Settings Tab
   ============================================================ */
class DaylineSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async _refreshViews({ resetSource = false } = {}) {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    await Promise.all(leaves.map(async (leaf) => {
      const view = leaf.view;
      if (!view) return;
      if (resetSource) {
        view.monthCache?.clear();
        view._otdProvider?.invalidate();
        view._otdDotCache = null;
      }
      view._invalidateOverlayRequests?.();
      if (typeof view.refresh === 'function') await view.refresh();
      view._syncNoteOverlays?.();
    }));
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const _s = (key, ...args) => _l(this.plugin.settings.weatherLanguage, key, ...args);

    containerEl.createEl('h2', { text: 'Dayline' });

    /* ======================
       Section: Diary 日记
       ====================== */
    containerEl.createEl('h3', { text: '📓 ' + _s('s_dailyFolder') });

    new Setting(containerEl)
      .setName(_s('s_dailyFolder'))
      .setDesc(_s('s_dailyFolderDesc'))
      .addSearch((cb) => {
        this.folderInput = cb;
        cb.setValue(this.plugin.settings.dailyFolder)
          .setPlaceholder('Calendar/Daily')
          .onChange(async (value) => {
            this.plugin.settings.dailyFolder = value.replace(/\/+$/, '');
            await this.plugin.saveSettings();
            await this._refreshViews({ resetSource: true });
          });
      })
      .addExtraButton((btn) => {
        btn.setIcon('folder-search')
          .setTooltip(_s('s_browseFolders'))
          .onClick(() => {
            new FolderSuggestModal(this.app, (path) => {
              this.plugin.settings.dailyFolder = path;
              this.plugin.saveSettings().then(() => this._refreshViews({ resetSource: true }));
              this.folderInput.setValue(path);
            }).open();
          });
      });

    new Setting(containerEl)
      .setName(_s('s_thumbnailFilter'))
      .setDesc(_s('s_thumbnailFilterDesc'))
      .addDropdown((dd) =>
        dd
          .addOption('all', _s('s_thumbnailAll'))
          .addOption('date-prefixed', _s('s_thumbnailDate'))
          .setValue(this.plugin.settings.thumbnailFilter)
          .onChange(async (value) => {
            this.plugin.settings.thumbnailFilter = value;
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view?.refresh) leaf.view.refresh();
          })
      );

    containerEl.createEl('h3', { text: t(this.plugin.settings, 'calendarDisplay') });

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showCalendarMood'))
      .setDesc(t(this.plugin.settings, 'showCalendarMoodDesc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCalendarMood !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCalendarMood = value;
          await this.plugin.saveSettings();
          await this._refreshViews();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showCalendarWeatherCard'))
      .setDesc(t(this.plugin.settings, 'showCalendarWeatherCardDesc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCalendarWeatherCard !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCalendarWeatherCard = value;
          await this.plugin.saveSettings();
          await this._refreshViews();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showCalendarWeatherBadge'))
      .setDesc(t(this.plugin.settings, 'showCalendarWeatherBadgeDesc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCalendarWeatherBadge !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCalendarWeatherBadge = value;
          await this.plugin.saveSettings();
          await this._refreshViews();
        }));

    /* ======================
       Section: Journal and mood
       ====================== */
    containerEl.createEl('h3', { text: t(this.plugin.settings, 'journalSources') });

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'journalSources'))
      .setDesc(t(this.plugin.settings, 'journalSourcesDesc'))
      .addTextArea((text) => {
        text.setValue(JSON.stringify(this.plugin.settings.journalSources || [], null, 2));
        text.inputEl.rows = 5;
        text.inputEl.addClass('calendar-sidebar-source-json');
        text.onChange(async (value) => {
          try {
            const parsed = JSON.parse(value || '[]');
            if (!Array.isArray(parsed)) throw new Error('Sources must be an array');
            this.plugin.settings.journalSources = parsed;
            await this.plugin.saveSettings();
            await this.plugin.journalIndex.refresh(this.plugin.settings);
            this.plugin.refreshJournalViews();
          } catch (_) {
            new Notice('Journal sources must be a valid JSON array');
          }
        });
      });

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'moodMetadataPath'))
      .setDesc(t(this.plugin.settings, 'moodMetadataPathDesc'))
      .addText((text) => text
        .setValue(this.plugin.settings.moodMetadataPath)
        .setPlaceholder('Calendar/journal-metadata.json')
        .onChange(async (value) => {
          const next = value.trim() || 'Calendar/journal-metadata.json';
          this.plugin.settings.moodMetadataPath = next;
          await this.plugin.saveSettings();
          this.plugin.moodStore.configure(this.plugin.settings);
          await this.plugin.moodStore.load();
          await this.plugin.journalIndex.refresh(this.plugin.settings);
          this.plugin.refreshJournalViews();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'mirrorMood'))
      .setDesc(t(this.plugin.settings, 'mirrorMoodDesc'))
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.settings.mirrorMoodToFrontmatter))
        .onChange(async (value) => {
          this.plugin.settings.mirrorMoodToFrontmatter = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'reminder'))
      .setDesc(t(this.plugin.settings, 'reminderDesc'))
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.settings.reminderEnabled))
        .onChange(async (value) => {
          this.plugin.settings.reminderEnabled = value;
          await this.plugin.saveSettings();
        }))
      .addExtraButton((button) => button
        .setIcon('clock-3')
        .setTooltip('Reminder hour')
        .onClick(() => {
          const value = window.prompt('Reminder hour (0-23)', String(this.plugin.settings.reminderHour ?? 21));
          const hour = Number(value);
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
            this.plugin.settings.reminderHour = hour;
            this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'journalTools'))
      .setDesc(t(this.plugin.settings, 'journalToolsDesc'))
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'openTimeline'))
        .onClick(() => this.plugin.activateTimeline()))
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'detectImports'))
        .onClick(async () => {
          const result = await this.plugin.journalIndex.detectSources(this.plugin.settings);
          new Notice(`${result.files} files, ${result.noDate.length} without a date`);
        }));

    /* ======================
       Section: Weather 天气
       ====================== */
    containerEl.createEl('h3', { text: '🌤️ ' + _s('s_weather') });

    new Setting(containerEl)
      .setName(_s('s_weatherEnable'))
      .setDesc(_s('s_weatherEnableDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.weatherEnabled)
          .onChange(async (value) => {
            this.plugin.settings.weatherEnabled = value;
            await this.plugin.saveSettings();
            await this._refreshViews();
          })
      );

    new Setting(containerEl)
      .setName(_s('s_latitude'))
      .setDesc(_s('s_latitudeDesc'))
      .addText((text) =>
        text
          .setPlaceholder('39.9042')
          .setValue(String(this.plugin.settings.weatherLatitude))
          .onChange(async (value) => {
            this.plugin.settings.weatherLatitude = value.trim();
            await this.plugin.saveSettings();
            await this._refreshViews();
          })
      );

    new Setting(containerEl)
      .setName(_s('s_longitude'))
      .setDesc(_s('s_longitudeDesc'))
      .addText((text) =>
        text
          .setPlaceholder('116.4074')
          .setValue(String(this.plugin.settings.weatherLongitude))
          .onChange(async (value) => {
            this.plugin.settings.weatherLongitude = value.trim();
            await this.plugin.saveSettings();
            await this._refreshViews();
          })
      );

    new Setting(containerEl)
      .setName(_s('s_locationName'))
      .setDesc(_s('s_locationNameDesc'))
      .addText((text) =>
        text
          .setPlaceholder(_s('s_locationName'))
          .setValue(String(this.plugin.settings.weatherLocationName))
          .onChange(async (value) => {
            this.plugin.settings.weatherLocationName = value.trim();
            await this.plugin.saveSettings();
            await this._refreshViews();
          })
      );

    new Setting(containerEl)
      .setName(_s('s_tempUnits'))
      .setDesc(_s('s_tempUnitsDesc'))
      .addDropdown((dd) =>
        dd
          .addOption('metric', _s('s_celsius'))
          .addOption('imperial', _s('s_fahrenheit'))
          .setValue(this.plugin.settings.weatherUnits)
          .onChange(async (value) => {
            this.plugin.settings.weatherUnits = value;
            await this.plugin.saveSettings();
            await this._refreshViews();
          })
      );

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'weatherTimezone'))
      .setDesc(t(this.plugin.settings, 'weatherTimezoneDesc'))
      .addText((text) => text
        .setPlaceholder('auto or Asia/Shanghai')
        .setValue(String(this.plugin.settings.weatherTimezone || 'auto'))
        .onChange(async (value) => {
          this.plugin.settings.weatherTimezone = value.trim() || 'auto';
          await this.plugin.saveSettings();
          await this._refreshViews();
        }));

    new Setting(containerEl)
      .setName(_s('s_autoFetch'))
      .setDesc(_s('s_autoFetchDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.weatherAutoFetch)
          .onChange(async (value) => {
            this.plugin.settings.weatherAutoFetch = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(_s('s_cacheTtl'))
      .setDesc(_s('s_cacheTtlDesc'))
      .addText((text) =>
        text
          .setPlaceholder('2')
          .setValue(String(this.plugin.settings.weatherTtlHours))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            this.plugin.settings.weatherTtlHours = isNaN(n) || n < 1 ? 2 : n;
            await this.plugin.saveSettings();
            await this._refreshViews();
          })
      );

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'language'))
      .setDesc(t(this.plugin.settings, 'languageDesc'))
      .addDropdown((dd) =>
        dd
          .addOption('en', t(this.plugin.settings, 'english'))
          .addOption('zh', t(this.plugin.settings, 'chinese'))
          .setValue(this.plugin.settings.displayLanguage)
          .onChange(async (value) => {
            this.plugin.settings.displayLanguage = value;
            this.plugin.settings.weatherLanguage = value;
            await this.plugin.saveSettings();
            this.display();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) {
              leaf.view._syncNoteOverlays();
              leaf.view.refresh();
            }
            this.plugin.refreshJournalViews();
          })
      );

    // Backfill weather button
    new Setting(containerEl)
      .setName(_s('s_backfill'))
      .setDesc(_s('s_backfillDesc'))
      .addButton((btn) => btn
        .setButtonText(_s('s_backfillBtn'))
        .onClick(async () => {
          const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
          if (leaf?.view) leaf.view.startWeatherBackfill();
        })
      );

    /* ======================
       Section: On This Day 去年今日
       ====================== */
    containerEl.createEl('h3', { text: '📅 ' + _s('s_otd') });

    new Setting(containerEl)
      .setName(_s('s_otdButton'))
      .setDesc(_s('s_otdButtonDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.onThisDayButton)
          .onChange(async (value) => {
            this.plugin.settings.onThisDayButton = value;
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.render();
          })
      );

    new Setting(containerEl)
      .setName(_s('s_otdDot'))
      .setDesc(_s('s_otdDotDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.onThisDayDot)
          .onChange(async (value) => {
            this.plugin.settings.onThisDayDot = value;
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.refresh();
          })
      );

    new Setting(containerEl)
      .setName(_s('s_otdExcerptMode'))
      .setDesc(_s('s_otdExcerptModeDesc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            'auto': _s('s_otdExcerptAuto'),
            'frontmatter': _s('s_otdExcerptFrontmatter'),
            'template': _s('s_otdExcerptTemplate'),
            'none': _s('s_otdExcerptNone'),
          })
          .setValue(this.plugin.settings.onThisDayExcerptMode)
          .onChange(async (value) => {
            this.plugin.settings.onThisDayExcerptMode = value;
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view?._otdProvider) leaf.view._otdProvider.invalidate();
            this.display(); // re-render to show/hide conditional fields
          })
      );

    // Conditional: only show when 'frontmatter' is selected
    if (this.plugin.settings.onThisDayExcerptMode === 'frontmatter') {
      new Setting(containerEl)
        .setName(_s('s_otdExcerptKey'))
        .setDesc(_s('s_otdExcerptKeyDesc'))
        .addText((text) =>
          text
            .setValue(this.plugin.settings.onThisDayExcerptKey || 'excerpt')
            .onChange(async (value) => {
              this.plugin.settings.onThisDayExcerptKey = value;
              await this.plugin.saveSettings();
              const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
              if (leaf?.view?._otdProvider) leaf.view._otdProvider.invalidate();
            })
        );
    }

    // Conditional: only show when 'template' is selected
    if (this.plugin.settings.onThisDayExcerptMode === 'template') {
      new Setting(containerEl)
        .setName(_s('s_otdTemplate'))
        .setDesc(_s('s_otdTemplateDesc'))
        .addText((text) =>
          text
            .setValue(this.plugin.settings.onThisDayExcerptTemplate || '{body}')
            .onChange(async (value) => {
              this.plugin.settings.onThisDayExcerptTemplate = value;
              await this.plugin.saveSettings();
              const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
              if (leaf?.view?._otdProvider) leaf.view._otdProvider.invalidate();
            })
        );
    }

    /* ======================
       Section: Other 其他
       ====================== */
    containerEl.createEl('h3', { text: '⚙️ ' + _s('s_exif') });

    new Setting(containerEl)
      .setName(_s('s_exifEnable'))
      .setDesc(_s('s_exifEnableDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showExif)
          .onChange(async (value) => {
            this.plugin.settings.showExif = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(_s('s_exifGeocode'))
      .setDesc(_s('s_exifGeocodeDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.exifReverseGeocode)
          .onChange(async (value) => {
            this.plugin.settings.exifReverseGeocode = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

/* ============================================================
   Folder Suggest Modal
   ============================================================ */
class FolderSuggestModal extends SuggestModal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  getSuggestions(query) {
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((f) => f instanceof TFolder);
    if (!query) return folders;
    return folders.filter((f) =>
      f.path.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(folder, el) {
    el.createEl('span', { text: folder.path });
  }

  onChooseSuggestion(folder) {
    this.onSubmit(folder.path);
  }
}

/* ============================================================
   On This Day Modal
   ============================================================ */

class OnThisDayModal {
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
    prevDayBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navigateDate(-1); });

    const dateInput = nav.createEl('input', {
      type: 'date',
      cls: 'cal-otd-date-input',
      attr: { 'aria-label': 'Choose date' },
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
    nextDayBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navigateDate(1); });

    const closeBtn = header.createDiv({ cls: 'cal-otd-close', text: '\u2715' });
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
      errEl.setText(_l(lang, 'unavailable'));
    }
  }

  _updateDateInput() {
    if (!this.dateInput) return;
    const year = this.month === 2 && this.day === 29 ? 2000 : new Date().getFullYear();
    this.dateInput.value = `${year}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`;
  }

  _renderGrid() {
    this.bodyEl.empty();
    const lang = this.plugin.settings.weatherLanguage;

    for (const entry of this.entries) {
      const card = this.bodyEl.createDiv({ cls: 'cal-otd-wall-card' });

      // Year badge
      const badge = card.createDiv({ cls: 'cal-otd-wall-badge' });
      badge.setText(_l(lang, 'otd_yearsAgo', new Date().getFullYear() - entry.year) + `  ·  ${entry.year}`);

      // Photo or text block
      if (entry.images && entry.images.length > 0) {
        const photo = card.createDiv({ cls: 'cal-otd-wall-photo' });
        this._setPhotoBackground(photo, entry.images[0], entry.dateStr);
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
        this.close();
        this.app.workspace.openLinkText(entry.dateStr, this.plugin.settings.dailyFolder, false);
      });
    }
  }

  _setPhotoBackground(bgEl, imageLink, dateStr) {
    try {
      const sourcePath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      this.plugin.thumbnailService.load(imageLink, sourcePath).then((result) => {
        if (result && bgEl.isConnected) bgEl.style.backgroundImage = `url(${result.url})`;
      });
    } catch (e) { /* silently fail */ }
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

function _formatDate(d, timezone) {
  return formatDateInTimeZone(d, timezone);
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
