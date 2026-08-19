// @ts-nocheck
/**
 * Dayline — a visual journal for calendars, timelines, moods, memories, weather, and photos.
 * Scans Calendar/Daily/ for notes with images, shows thumbnails in date cells.
 * Click a date to open that day's daily note.
 */
const { Plugin, ItemView, TFile, Notice, Modal, Menu, setIcon, Platform } = require('obsidian');
const { JournalIndex, startJournalIndexLoad, waitForJournalIndexStartup } = require('./journal-index');
const { subscribeJournalMetadataRefresh } = require('./journal-metadata-refresh');
const { MoodStore } = require('./mood-store');
const { MoodPickerModal, MoodRecoveryModal } = require('./mood-picker-modal');
const { saveMoodExport, serializeMoodCsv, serializeMoodJson } = require('./mood-export');
const { JournalTimelineView, JOURNAL_TIMELINE_VIEW } = require('./journal-timeline-view');
const { OnThisDayProvider, OnThisDayModal } = require('./on-this-day');
const { DaylineSettingsTab } = require('./settings-tab');
const { WeatherService, lookupWeatherCode, validateWeatherCoordinates } = require('./weather-service');
const { buildWeatherDetailParts, buildWeatherExtraParts, buildWeatherStatus } = require('./weather-display');
const { localize: _l } = require('./locale');
const { formatDateParts, getClockPartsInTimeZone, getTodayDate } = require('./date-utils');
const { ThumbnailService } = require('./thumbnail-service');
const { MediaService, formatMediaMetadataForDisplay } = require('./media-service');
const { aggregateCalendarDays, withWeatherOnlyDays } = require('./calendar-summary');
const { cachedMonthsReferencingMedia } = require('./calendar-media-refresh');
const { MEDIA_EXTENSIONS, IMAGE_EXTENSIONS: MEDIA_IMAGE_EXTENSIONS, classifyMediaLink, createMediaAttachment, normalizeMediaLink } = require('./media-links');
const { OverlayRegistry } = require('./overlay-registry');
const { SerialTaskQueue } = require('./task-queue');
const { formatCalendarMonth, getCalendarGridOffset, getCalendarWeekdays, getDisplayLanguage, moodLabel, t } = require('./i18n');
const { getMoodColor } = require('./mood');
const { shouldHandleCalendarMonthShortcut } = require('./calendar-keyboard');
const { calendarEntryAffectsDisplay, calendarMediaAccessibilityLabel, shouldShowCalendarMood, shouldShowCalendarWeatherCard, shouldShowCalendarWeatherBadge, shouldShowCalendarWeatherLocation } = require('./calendar-display');
const { ViewVisibilityController, normalizeViewVisibilitySettings } = require('./view-visibility-controller');
const { hasExistingImage } = require('./heic-embed');
const { ImageMetadataCache, HeicCache, HEIC_EXTS, ReverseGeocoder } = require('./image-metadata');
const { detectPlatformCapabilities, resolveCapabilityRoute } = require('./platform-capabilities');
const {
  getMediaControlOwner,
  shouldAddMediaInfoControl,
  shouldDismissMetadataFromPointer,
  shouldOpenCalendarDateFromPointer,
} = require('./media-interaction');
const { calendarCellTouchRouting } = require('./touch-targets');
const {
  MOBILE_DAYLINE_VIEW,
  bindMobileEmbeddedViewHost,
  createSerialDaylineModeSwitcher,
  getMobileDaylineLeaf,
  getMobileMarkdownLeaf,
  normalizeDaylineMobileMode,
} = require('./dayline-mobile');

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
  displayLanguage: 'zh',  // 'system' | 'en' | 'zh'; migrated from weatherLanguage
  weekStart: 'system', // 'system' | 'monday' | 'sunday'
  showCalendarMood: true,
  showCalendarWeatherCard: true,
  showCalendarWeatherBadge: true,
  showCalendarWeatherLocation: false,
  showCalendarEntryCount: true,
  weatherDisplayFields: ['feels', 'humidity'],
  showCalendarView: true,
  showTimelineView: false,
  showTimelineMoodTrend: true,
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
    this._geocoderSaveTimer = null;
    this._exifHoverToken = 0;
    this._exifTouchAnchor = null;
    this._exifDismissHandlers = null;
    this._otdRequestToken = 0;
    await this._migrateLegacyData();
    await this.loadSettings();
    this.capabilities = detectPlatformCapabilities({ Platform, app: this.app });
    this._applyCapabilityClasses();

    this.moodStore = new MoodStore(this.app, this.settings);
    await this.moodStore.load();
    this.journalIndex = new JournalIndex(this.app, (path) => this.moodStore.get(path));
    // Desktop indexes eagerly, but only after Obsidian has restored layout and
    // populated metadata embeds. Mobile remains lazy until Dayline is opened.
    if (!this.capabilities.isMobile) {
      this._desktopJournalIndexStartup = waitForJournalIndexStartup(this.app)
        // A vault mutation may invalidate the first rebuild. ensureReady()
        // retries until a complete rebuild has committed, while refresh()
        // intentionally resolves after an invalidated attempt.
        .then(() => this.journalIndex.ensureReady(this.settings));
      this._desktopJournalIndexStartup.catch((error) => {
        console.warn('[Dayline] Initial journal index refresh failed:', error?.message || error);
      });
    }
    this._reminderTimer = setInterval(() => this._maybeRemind(), 60 * 1000);

    // Load styles (manually installed plugins don't auto-load styles.css)
    this._loadStyles();

    // Initialize shared WeatherService (singleton across all calendar views)
    this.weatherService = new WeatherService(this);
    // Shared EXIF metadata cache (used by calendar tooltip + note-image tooltip)
    this.exifCache = new ImageMetadataCache(this.app);
    // HEIC thumbnail conversion cache
    this.heicCache = new HeicCache(this.app, this.capabilities);
    this.thumbnailService = new ThumbnailService(this.app, this.heicCache);
    // Unified image/video/audio metadata and cover service.
    this.mediaService = new MediaService(this.app, this.heicCache, {
      imageMetadata: this.exifCache,
      capabilities: this.capabilities,
    });
    // Reverse geocoder for EXIF GPS coordinates (Nominatim, free)
    this.geocoder = new ReverseGeocoder({
      cache: this.geocoderCache,
      getLanguage: () => this.settings.weatherLanguage || getDisplayLanguage(this.settings),
      onChange: () => this._saveGeocoderCache(),
    });

    // libheif is an optional desktop asset. Mobile and browser-only builds use
    // the HEIC service's null fallback instead of attempting a Node path load.
    this._libheifFactory = null;
    if (this.capabilities.isDesktop && resolveCapabilityRoute(this.capabilities, 'heic') === 'full') {
      try {
        const basePath = String(this.app.vault?.adapter?.basePath || '').replace(/[\\/]+$/, '');
        const dynamicRequire = typeof require === 'function' ? require : null;
        if (basePath && dynamicRequire) {
          this._libheifFactory = dynamicRequire(`${basePath}/.obsidian/plugins/dayline/libheif-bundle.js`);
        }
      } catch (e) {
        console.warn('[Dayline] Failed to load optional libheif:', e.message);
      }
    }
    // Track containers where we set position:relative so we can revert on unload
    this._hostPositionMarkers = new Set();
    this._overlayRegistry = new OverlayRegistry();
    this._overlayOriginalPositions = new Map();

    // Register the sidebar view
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.registerView(JOURNAL_TIMELINE_VIEW, (leaf) => new JournalTimelineView(leaf, this));
    this.registerView(MOBILE_DAYLINE_VIEW, (leaf) => new MobileDaylineView(leaf, this));

    this.viewVisibilityController = new ViewVisibilityController({
      workspace: this.app.workspace,
      initialState: this.settings,
      openers: {
        calendar: () => this._openCalendarView(),
        timeline: () => this._openTimelineView(),
      },
      onPersist: (kind, visible) => this._persistViewVisibility(kind, visible),
    });
    this._daylineRibbonEl = this.addRibbonIcon('calendar-range', 'Dayline', (event) => {
      if (this.capabilities?.isMobile) this._activateMobileMode(this._mobileDaylineLastMode || 'calendar');
      else this._showDaylineMenu(event);
    });
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
        const calendar = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view
          || this.app.workspace.getLeavesOfType(MOBILE_DAYLINE_VIEW)[0]?.view?.calendarView;
        if (calendar) {
          calendar.refreshWeather().catch((err) => {
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

    // Settings tab
    this.addSettingTab(new DaylineSettingsTab(this.app, this));

    // Initialize EXIF tooltip element (shared across calendar & note-image hover)
    this._exifTooltipEl = null;
    this._exifHoverTimer = null;
    this._ensureExifTooltip();
    this._installExifDismissHandlers();

    // Restore view visibility after Obsidian has restored the workspace layout.
    this.app.workspace.onLayoutReady(async () => {
      if (!this.capabilities.isMobile) {
        await this.viewVisibilityController.restore();
      }
      this._syncDaylineRibbon();
      // Trigger initial overlay sync once the layout is stable
      this._syncAllOverlays();
    });

    // Plugin-level overlay sync: react to file-open, active-leaf-change, layout-change
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        this._endExifHover();
        this._syncAllOverlays();
      })
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this._endExifHover();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          leaf.view?._handleActiveLeafChange?.();
        }
        for (const leaf of this.app.workspace.getLeavesOfType(MOBILE_DAYLINE_VIEW)) {
          leaf.view?.activeView?._handleActiveLeafChange?.();
        }
        this._syncAllOverlays();
      })
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this._endExifHover();
        this._syncAllOverlays();
        this._syncDaylineRibbon();
      })
    );
    this.registerEvent(this.app.vault.on('create', (file) => this._handleJournalCreateOrModify(file)));
    this.registerEvent(this.app.vault.on('modify', (file) => this._handleJournalCreateOrModify(file)));
    this.registerEvent(this.app.vault.on('delete', (file) => this._handleJournalDelete(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this._handleJournalRename(file, oldPath)));
    subscribeJournalMetadataRefresh({
      metadataCache: this.app.metadataCache,
      registerEvent: (eventRef) => this.registerEvent(eventRef),
      journalIndex: this.journalIndex,
      getSettings: () => this.settings,
      onError: (error, file) => console.warn('[Dayline] Journal metadata refresh failed:', file?.path, error?.message || error),
    });
  }

  /** Remove all note overlays and clear state on unload. */
  async onunload() {
    clearTimeout(this._weatherSaveTimer);
    clearTimeout(this._weatherCleanupTimer);
    clearTimeout(this._geocoderSaveTimer);
    clearTimeout(this._exifHoverTimer);
    clearInterval(this._reminderTimer);
    this._removeExifDismissHandlers();
    this._endExifHover();
    await this._flushWeatherCache();
    await this._flushGeocoderCache();
    await this._journalWriteQueue?.flush();
    await this.moodStore?.flush();
    await this.viewVisibilityController?.unload();
    this._removeAllOverlays();
    this._removeCapabilityClasses();
    this.mediaService?.dispose?.();
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
    const open = this.capabilities?.isMobile
      ? this.app.workspace.getLeavesOfType(MOBILE_DAYLINE_VIEW).length > 0
      : this.viewVisibilityController.isAnyOpen();
    ribbon.classList.toggle('is-active', open);
  }

  _applyCapabilityClasses() {
    const root = typeof document !== 'undefined' ? document.body : null;
    root?.classList.toggle('dayline-coarse-pointer', Boolean(this.capabilities?.coarsePointer));
    root?.classList.toggle('dayline-mobile', Boolean(this.capabilities?.isMobile));
  }

  _removeCapabilityClasses() {
    const root = typeof document !== 'undefined' ? document.body : null;
    root?.classList.remove('dayline-coarse-pointer', 'dayline-mobile');
  }

  _installExifDismissHandlers() {
    if (typeof document === 'undefined') return;
    const pointer = (event) => {
      const target = event.target;
      if (!shouldDismissMetadataFromPointer(target, this._exifTooltipEl)) return;
      this._endExifHover();
    };
    const keydown = (event) => {
      if (event.key === 'Escape') this._endExifHover();
    };
    const scroll = () => this._endExifHover();
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('scroll', scroll, true);
    this._exifDismissHandlers = { pointer, keydown, scroll };
  }

  _removeExifDismissHandlers() {
    const handlers = this._exifDismissHandlers;
    if (!handlers || typeof document === 'undefined') return;
    document.removeEventListener('pointerdown', handlers.pointer, true);
    document.removeEventListener('keydown', handlers.keydown, true);
    window.removeEventListener('scroll', handlers.scroll, true);
    this._exifDismissHandlers = null;
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
    if (this.capabilities?.isMobile) return this._activateMobileMode('timeline');
    const opened = await this.viewVisibilityController.open('timeline');
    this._syncDaylineRibbon();
    return opened;
  }

  async ensureJournalIndexReady() {
    if (this._desktopJournalIndexStartup) return this._desktopJournalIndexStartup;
    if (this.journalIndex?.ensureReady) return this.journalIndex.ensureReady(this.settings);
    if (this.journalIndex && !this.journalIndex.isReady) return this.journalIndex.refresh(this.settings);
  }

  async _activateMobileMode(mode) {
    const normalized = normalizeDaylineMobileMode(mode);
    const opened = await this._openMobileDayline(normalized);
    if (!opened) return false;
    this._mobileDaylineLastMode = normalized;
    this._syncDaylineRibbon();
    return true;
  }

  async _openMobileDayline(mode = 'calendar') {
    if (!this.capabilities?.isMobile) return false;
    if (this._mobileDaylineOpenPromise) {
      await this._mobileDaylineOpenPromise;
      const existing = this.app.workspace.getLeavesOfType(MOBILE_DAYLINE_VIEW)[0];
      await existing?.view?.setMode?.(mode);
      return Boolean(existing);
    }
    const task = (async () => {
      const leaf = getMobileDaylineLeaf(this.app.workspace, MOBILE_DAYLINE_VIEW);
      if (!leaf) throw new Error('could not create Dayline tab');
      await leaf.setViewState({ type: MOBILE_DAYLINE_VIEW, active: true });
      await this.app.workspace.revealLeaf?.(leaf);
      await leaf.view?.setMode?.(mode);
      return leaf;
    })();
    this._mobileDaylineOpenPromise = task;
    try {
      return Boolean(await task);
    } catch (error) {
      console.warn('[Dayline] Failed to open mobile Dayline:', error?.message || error);
      new Notice(t(this.settings, 'openNoteFailed', { error: error?.message || error }));
      return false;
    } finally {
      if (this._mobileDaylineOpenPromise === task) this._mobileDaylineOpenPromise = null;
    }
  }

  async openTimelineForDate(date) {
    const opened = await this.activateTimeline();
    if (!opened) return;
    const viewType = this.capabilities?.isMobile ? MOBILE_DAYLINE_VIEW : JOURNAL_TIMELINE_VIEW;
    const leaf = this.app.workspace.getLeavesOfType(viewType)[0];
    const view = leaf?.view;
    if (this.capabilities?.isMobile) await view?.setDateFilter?.(date);
    else view?.setDateFilter?.(date);
  }

  async openJournalFile(file) {
    const workspace = this.app.workspace;
    let leaf;
    if (this.capabilities?.isMobile) {
      leaf = getMobileMarkdownLeaf(workspace);
    } else {
      leaf = workspace.getLeaf('split');
    }
    if (!leaf) throw new Error('No markdown leaf is available');
    await leaf.openFile(file);
    return leaf;
  }

  async _openTimelineView() {
    if (this.capabilities?.isMobile) {
      await this._openMobileDayline('timeline');
      return;
    }
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
      await this.openJournalFile(file);
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
      customLabels: this.moodStore.getCustomLabels(),
      settings: this.settings,
      allowDateSelection: options.allowDateSelection === true,
      onDateChange: async (date) => {
        const nextPath = `${this.settings.dailyFolder}/${date}.md`;
        const nextEntry = this.journalIndex.getEntries().find((item) => item.path === nextPath);
        return {
          filePath: nextPath,
          initial: this.moodStore.get(nextPath) || nextEntry?.mood,
          customLabels: this.moodStore.getCustomLabels(),
        };
      },
      onSave: async ({ filePath, score, labels, note }) => {
        const targetPath = filePath || path;
        await this.ensureJournalFile(targetPath, '');
        await this.moodStore.set(targetPath, score, labels, this.settings, note);
        await this.journalIndex.refreshFile(targetPath, this.settings);
        this.refreshJournalViews();
        new Notice(`${t(this.settings, 'moodSaved')}: ${targetPath}`);
      },
    }).open();
  }

  openMoodRecovery() {
    new MoodRecoveryModal(this.app, {
      store: this.moodStore,
      settings: this.settings,
      onChanged: async () => {
        await this.journalIndex.refresh(this.settings);
        this.refreshJournalViews();
      },
    }).open();
  }

  async deleteMoodRecord(path) {
    const label = t(this.settings, 'deleteMoodConfirm');
    if (typeof window !== 'undefined' && !window.confirm(`${label}\n${path}`)) return false;
    try {
      const visibleMood = this.journalIndex.getEntries().find((entry) => entry.path === path)?.mood;
      const deleted = await this.moodStore.deleteRecord(path, true, visibleMood);
      if (!deleted) return false;
      await this.journalIndex.refresh(this.settings);
      this.refreshJournalViews();
      new Notice(t(this.settings, 'moodDeleted'));
      return true;
    } catch (error) {
      console.warn('[Dayline] Delete mood failed:', error?.message || error);
      new Notice(t(this.settings, 'moodDeleteFailed', { error: error?.message || error }));
      return false;
    }
  }

  async exportMood(format = 'json') {
    try {
      const metadata = this.moodStore.getMetadata();
      const content = format === 'csv' ? serializeMoodCsv(metadata) : serializeMoodJson(metadata);
      const stamp = new Date().toISOString().slice(0, 10);
      const path = await saveMoodExport(this.app, content, `dayline-moods-${stamp}.${format === 'csv' ? 'csv' : 'json'}`);
      new Notice(t(this.settings, 'moodExported', { path }));
    } catch (error) {
      new Notice(t(this.settings, 'moodExportFailed', { error: error?.message || error }));
    }
  }

  refreshJournalViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(JOURNAL_TIMELINE_VIEW)) leaf.view?.render?.();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const refresh = leaf.view?.refresh?.();
      if (refresh?.catch) refresh.catch((error) => console.warn('[Dayline] Calendar refresh failed:', error?.message || error));
    }
    for (const leaf of this.app.workspace.getLeavesOfType(MOBILE_DAYLINE_VIEW)) {
      const view = leaf.view;
      const refresh = view?.activeView?.render?.();
      if (refresh?.catch) refresh.catch((error) => console.warn('[Dayline] Mobile Dayline refresh failed:', error?.message || error));
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
    if (oldPath && MEDIA_EXTENSIONS.includes(String(oldPath).split('.').pop()?.toLowerCase())) {
      this._invalidateMediaCaches(oldPath);
    }
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
    if (!(file instanceof TFile) || !MEDIA_EXTENSIONS.includes(file.extension?.toLowerCase())) return;
    this._invalidateMediaCaches(file.path);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      leaf.view?._onMediaChanged?.(file);
    }
    for (const leaf of this.app.workspace.getLeavesOfType(JOURNAL_TIMELINE_VIEW)) {
      leaf.view?._onMediaChanged?.(file);
    }
    for (const leaf of this.app.workspace.getLeavesOfType(MOBILE_DAYLINE_VIEW)) {
      leaf.view?.activeView?._onMediaChanged?.(file);
    }
  }

  _invalidateMediaCaches(path) {
    if (!path) return;
    this.exifCache?.invalidate(path);
    this.heicCache?.invalidate(path);
    this.mediaService?.invalidate(path);
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
    for (const leaf of this.app.workspace.getLeavesOfType(MOBILE_DAYLINE_VIEW)) {
      leaf.view?.activeView?._syncNoteOverlays?.();
    }
  }

  /* ----- On This Day ----- */
  openOnThisDay(month, day) {
    const calendarLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const mobileView = this.app.workspace.getLeavesOfType(MOBILE_DAYLINE_VIEW)[0]?.view?.calendarView;
    const provider = calendarLeaf?.view?._otdProvider || mobileView?._otdProvider;
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

  _showExifTooltip(anchorEl, fields, loading, kind = 'image') {
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
      const noDataKey = kind === 'media' ? 'media_noData' : 'exif_noData';
      const noDataDescKey = kind === 'media' ? 'media_noDataDesc' : 'exif_noDataDesc';
      empty.appendChild(addText('div', '', _l(lang, noDataKey)));
      empty.appendChild(addText('div', 'cal-exif-tooltip-description', _l(lang, noDataDescKey)));
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

  _toggleExifTouch(anchorEl) {
    if (this._exifTouchAnchor === anchorEl && this._exifTooltipEl?.classList.contains('is-visible')) {
      this._endExifHover();
      return true;
    }
    this._exifTouchAnchor = anchorEl;
    return false;
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
    this._exifTouchAnchor = null;
    this._hideExifTooltip();
  }

  async loadSettings() {
    const data = await this.loadData() || {};
    // Extract weather cache separately so it doesn't get overwritten by saveSettings
    this.weatherCache = data.weatherCache || {};
    this.geocoderCache = data.geocoderCache && typeof data.geocoderCache === 'object' ? data.geocoderCache : {};
    // Delete stale cache entries to prevent data.json bloat
    this._cleanupWeatherCache();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data, normalizeViewVisibilitySettings(data));
    const legacyWeatherVisible = data.showCalendarWeather !== false;
    if (data.showCalendarWeatherCard === undefined) this.settings.showCalendarWeatherCard = legacyWeatherVisible;
    if (data.showCalendarWeatherBadge === undefined) this.settings.showCalendarWeatherBadge = legacyWeatherVisible;
    const rawDisplayLanguage = data.displayLanguage;
    this.settings.displayLanguage = rawDisplayLanguage === 'system' || rawDisplayLanguage === 'en' || rawDisplayLanguage === 'zh'
      ? rawDisplayLanguage
      : (data.weatherLanguage === 'en' ? 'en' : 'zh');
    this.settings.weatherLanguage = getDisplayLanguage({
      displayLanguage: this.settings.displayLanguage,
      weatherLanguage: data.weatherLanguage,
    });
    delete this.settings.weatherCache; // settings object shouldn't carry the cache
    delete this.settings.geocoderCache;
  }

  async saveSettings() {
    const settings = { ...this.settings };
    settings.weatherLanguage = getDisplayLanguage(settings);
    settings.showCalendarWeather = settings.showCalendarWeatherCard !== false || settings.showCalendarWeatherBadge !== false;
    settings.showCalendarView = settings.showCalendarView !== false;
    settings.showTimelineView = settings.showTimelineView === true;
    this.moodStore?.configure(settings);
    await this._enqueueDataWrite((data) => {
      Object.assign(data, settings);
      data.weatherCache = this.weatherCache || {};
      data.geocoderCache = this.geocoderCache || {};
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

  /** Save reverse-geocoder cache without touching settings. */
  _saveGeocoderCache() {
    if (this._geocoderSaveTimer) clearTimeout(this._geocoderSaveTimer);
    this._geocoderSaveTimer = setTimeout(() => {
      this._geocoderSaveTimer = null;
      this._flushGeocoderCache().catch((err) => {
        console.warn('[Dayline] Geocoder cache save failed:', err.message);
      });
    }, 500);
  }

  _flushGeocoderCache() {
    if (this._geocoderSaveTimer) {
      clearTimeout(this._geocoderSaveTimer);
      this._geocoderSaveTimer = null;
    }
    return this._enqueueDataWrite((data) => {
      data.geocoderCache = this.geocoderCache || {};
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
  container-type: inline-size;
}
.cal-calendar-content:focus-visible,
.cal-sidebar .view-content:focus-visible,
.cal-sidebar:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: -2px;
}
.dayline-settings-brand {
  display: flex;
  align-items: center;
  min-height: 32px;
  margin: -2px 0 14px;
}
.dayline-settings-brand svg {
  display: block;
  max-width: 132px;
  height: 32px;
}
.dayline-settings-action-row.setting-item {
  align-items: flex-start;
  min-width: 0;
}
.dayline-settings-action-row .setting-item-info {
  min-width: 0;
  overflow-wrap: anywhere;
}
.dayline-settings-action-row .setting-item-control {
  display: flex;
  flex: 0 1 24rem;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}
.dayline-settings-action-row .setting-item-control > button {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
@media (max-width: 560px) {
  .dayline-settings-action-row .setting-item-control {
    flex-basis: 100%;
    justify-content: flex-start;
  }
  .dayline-settings-action-row .setting-item-control > button {
    flex: 1 1 calc(50% - 3px);
  }
}
.dayline-weather-field-options { display: flex; flex-wrap: wrap; gap: 6px 10px; }
.dayline-weather-field-option { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.cal-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 2px 8px;
}
.cal-header > .cal-title {
  flex: 1;
  min-width: 0;
}
.cal-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.cal-nav {
  flex: 0 0 auto;
}
.cal-icon-button {
  width: 26px;
  height: 26px;
  padding: 3px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.cal-icon-button:hover,
.cal-icon-button:focus-visible {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
  outline: none;
}
.cal-icon-button.is-active {
  color: var(--text-accent);
  background: var(--background-modifier-hover);
}
.cal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-normal);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-title-button {
  border: 0;
  background: transparent;
  cursor: pointer;
  min-width: 0;
  padding: 4px 6px;
}
.cal-title-button:hover,
.cal-title-button:focus-visible {
  color: var(--text-accent);
  outline: none;
}
.cal-jump-panel {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 2px 8px;
  padding: 8px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-secondary);
}
.cal-filter-field {
  display: flex;
  flex: 1 1 90px;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  color: var(--text-muted);
  font-size: 10px;
}
.cal-filter-field input,
.cal-filter-field select {
  min-width: 0;
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
.cal-media-info-button {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 4px;
  border: 0;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.dayline-note-media-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 2px 4px;
  padding: 5px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 5px;
  color: var(--text-muted);
  vertical-align: middle;
}
.cal-entry-count {
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 4;
  min-width: 0;
  height: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  text-align: center;
  pointer-events: none;
  box-shadow: none;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
}
.cal-no-image .cal-entry-count {
  color: var(--text-muted);
  text-shadow: none;
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
  align-items: flex-start;
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
.cal-weather-location,
.cal-weather-extra,
.cal-weather-status {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-weather-location {
  color: var(--text-normal);
  font-weight: 500;
}
.cal-weather-status {
  color: var(--text-warning, var(--text-muted));
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
.journal-index-loading { display: flex; align-items: center; justify-content: center; min-height: 160px; padding: 24px; color: var(--text-muted); text-align: center; overflow-wrap: anywhere; }
.journal-index-load-error { color: var(--text-error); }
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
.journal-stat-periods { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; min-width: 0; }
.journal-stat-period-group { min-width: 0; overflow: hidden; }
.journal-stat-period-row { display: flex; justify-content: space-between; gap: 5px; min-width: 0; color: var(--text-muted); font-size: 11px; line-height: 1.6; }
.journal-stat-period-row span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.journal-stat-period-row span:last-child { flex: 0 0 auto; color: var(--text-faint); }
.journal-stat-period-empty { color: var(--text-faint); font-size: 11px; }
.journal-stat-mood-reports { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; min-width: 0; }
.journal-stat-label-trends { grid-column: 1 / -1; min-width: 0; }
.journal-stat-label-trend-row { display: flex; justify-content: space-between; gap: 8px; min-width: 0; color: var(--text-muted); font-size: 11px; line-height: 1.6; }
.journal-stat-label-trend-row span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.journal-stat-label-trend-row span:last-child { flex: 0 0 auto; color: var(--text-faint); }
.journal-timeline-list { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; min-width: 0; gap: 8px; }
.journal-timeline-entry { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; gap: 10px; padding: 10px; border: 1px solid var(--background-modifier-border); border-radius: 7px; box-shadow: inset 3px 0 0 var(--background-modifier-border); cursor: pointer; background: var(--background-primary); }
.journal-timeline-entry.has-thumbnail { grid-template-columns: minmax(0, 1fr) 88px; }
.journal-timeline-entry.mood-score-2 { box-shadow: inset 3px 0 0 #4b93d1; }
.journal-timeline-entry.mood-score-1 { box-shadow: inset 3px 0 0 #56a86a; }
.journal-timeline-entry.mood-score-0 { box-shadow: inset 3px 0 0 #d9bd4c; }
.journal-timeline-entry.mood-score--1 { box-shadow: inset 3px 0 0 #e68a3b; }
.journal-timeline-entry.mood-score--2 { box-shadow: inset 3px 0 0 #d84b76; }
.journal-timeline-entry:hover, .journal-timeline-entry:focus-visible { border-right-color: var(--interactive-accent); outline: none; }
.journal-timeline-entry-body { min-width: 0; overflow: hidden; }
.journal-timeline-entry-top { flex-wrap: wrap; gap: 4px 7px; min-width: 0; color: var(--text-muted); }
.journal-timeline-entry-actions { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
.journal-timeline-entry-actions button { width: 24px; height: 24px; padding: 4px; }
.journal-timeline-entry-date { flex: 0 1 auto; min-width: 0; max-width: 100%; margin: 0; overflow: hidden; color: var(--text-normal); font-size: 14px; font-weight: 600; }
.journal-timeline-entry-iso { display: none; }
.journal-timeline-favorite { flex: 0 0 auto; color: var(--text-accent); font-size: 11px; }
.journal-timeline-title { min-width: 0; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-normal); font-size: 13px; }
.journal-timeline-excerpt { min-width: 0; max-width: 100%; margin-top: 4px; overflow: hidden; overflow-wrap: anywhere; color: var(--text-muted); font-size: 12px; line-height: 1.45; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.journal-timeline-meta { flex-wrap: wrap; gap: 5px 10px; min-width: 0; margin-top: 6px; overflow-wrap: anywhere; color: var(--text-faint); font-size: 11px; }
.journal-timeline-mood-note { margin-top: 6px; overflow-wrap: anywhere; color: var(--text-muted); font-size: 12px; white-space: pre-wrap; }
.journal-timeline-thumbnail { position: relative; width: 88px; height: 88px; min-width: 88px; overflow: hidden; border-radius: 5px; background: var(--background-secondary); }
.journal-timeline-thumbnail img { display: block; width: 88px; height: 88px; object-fit: cover; opacity: 0; transition: opacity 0.15s ease; }
.journal-timeline-thumbnail.is-loaded img { opacity: 1; }
.journal-timeline-thumbnail-count { position: absolute; right: 4px; bottom: 4px; padding: 1px 4px; border-radius: 4px; background: rgba(0, 0, 0, 0.65); color: #fff; font-size: 10px; }
.journal-timeline-empty { min-width: 0; padding: 28px 8px; overflow-wrap: anywhere; color: var(--text-muted); text-align: center; }
.journal-mood-picker-modal { width: min(720px, calc(100vw - 32px)); max-width: calc(100vw - 32px); min-width: 0; box-sizing: border-box; }
.journal-mood-picker-modal .modal-content { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
.journal-mood-picker { container-type: inline-size; }
.journal-mood-picker h3 { margin-bottom: 4px; }
.journal-mood-date-field { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 10px; margin: 0 0 14px; color: var(--text-muted); font-size: 12px; }
.journal-mood-date-field label { flex: 1 1 120px; min-width: 0; }
.journal-mood-date-field input { flex: 0 1 180px; min-width: min(180px, 100%); max-width: 100%; }
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
.journal-mood-custom-label-field, .journal-mood-note-field { display: flex; gap: 7px; min-width: 0; margin-top: 12px; }
.journal-mood-custom-label-field input { flex: 1 1 auto; min-width: 0; }
.journal-mood-custom-label-field button { flex: 0 0 auto; }
.journal-mood-note-field { flex-direction: column; align-items: stretch; gap: 5px; }
.journal-mood-note-field textarea { width: 100%; min-height: 56px; resize: vertical; }
.dayline-mobile-shell .view-content { padding: 0; overflow: hidden; }
.dayline-mobile-view { display: flex; flex-direction: column; width: 100%; min-width: 0; height: 100%; min-height: 100%; overflow: hidden; }
.dayline-mobile-header { display: flex; align-items: center; justify-content: flex-end; min-height: 52px; padding: 4px max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left)); border-bottom: 1px solid var(--background-modifier-border); box-sizing: border-box; }
.dayline-mobile-mode-controls { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.dayline-mobile-mode-button { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 10px; border: 0; border-radius: 6px; color: var(--text-muted); background: transparent; }
.dayline-mobile-mode-button.is-active { color: var(--text-accent); background: var(--background-modifier-hover); }
.dayline-mobile-mode-button:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 2px; }
.dayline-mobile-mode-host { flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; max-width: 100%; overflow: hidden; box-sizing: border-box; }
.dayline-mobile-mode-host.cal-sidebar { padding-top: 8px; overflow-y: auto; }
.dayline-mobile-mode-host .journal-timeline-view { height: 100%; padding: 8px; }
.dayline-mobile-loading { display: flex; align-items: center; justify-content: center; min-height: 160px; padding: 24px; color: var(--text-muted); text-align: center; overflow-wrap: anywhere; }
.dayline-mobile-load-error { color: var(--text-warning, var(--text-muted)); }
.journal-mood-recovery-modal .modal-content { width: min(560px, calc(100vw - 20px)); max-width: calc(100vw - 20px); min-width: 0; box-sizing: border-box; }
.journal-mood-recovery-description { color: var(--text-muted); font-size: 12px; }
.journal-mood-recovery-list { display: grid; gap: 8px; min-width: 0; }
.journal-mood-recovery-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(140px, 0.8fr) auto; gap: 7px; align-items: center; min-width: 0; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 6px; }
.journal-mood-recovery-details { min-width: 0; overflow: hidden; }
.journal-mood-recovery-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-normal); font-size: 12px; }
.journal-mood-recovery-meta, .journal-mood-recovery-note { overflow-wrap: anywhere; color: var(--text-muted); font-size: 11px; }
.journal-mood-recovery-note { margin-top: 3px; white-space: pre-wrap; }
.journal-mood-recovery-empty { padding: 20px 0; color: var(--text-muted); text-align: center; }
.journal-mood-actions { justify-content: space-between; gap: 8px; margin-top: 22px; }
@media (max-width: 420px) {
  .journal-timeline-view { padding: 10px; }
  .journal-timeline-entry.has-thumbnail { grid-template-columns: minmax(0, 1fr) 72px; }
  .journal-timeline-thumbnail, .journal-timeline-thumbnail img { width: 72px; height: 72px; min-width: 72px; }
  .journal-stat-periods { grid-template-columns: minmax(0, 1fr); }
  .journal-stat-mood-reports { grid-template-columns: minmax(0, 1fr); }
  .journal-mood-recovery-row { grid-template-columns: minmax(0, 1fr); }
  .journal-mood-recovery-row button { justify-self: start; }
}
@media (prefers-reduced-motion: reduce) {
  .journal-mood-picker *, .journal-timeline-entry, .cal-note-overlay, .cal-note-overlay .spin {
    transition: none !important;
    animation: none !important;
  }
}
@media (pointer: coarse) {
  .cal-icon-button, .cal-weather-refresh, .dayline-note-media-info,
  .cal-otd-button, .cal-filter-field input, .cal-filter-field select,
  .journal-timeline-actions button, .journal-timeline-filter-row > button,
  .journal-timeline-view input, .journal-timeline-view select,
  .journal-timeline-entry-actions button, .journal-mood-picker button,
  .journal-mood-picker input, .journal-mood-picker textarea,
  .journal-mood-picker select, .journal-mood-recovery-row button,
  .cal-jump-apply, .cal-otd-close, .dayline-mobile-mode-button {
    min-width: 44px;
    min-height: 44px;
  }
  .cal-day-bg { outline-offset: 2px; }
  .journal-timeline-entry-actions { gap: 4px; }
  .journal-timeline-entry-actions button { width: 44px; height: 44px; padding: 10px; }
  .journal-timeline-actions button, .journal-timeline-filter-row > button { width: 44px; height: 44px; flex-basis: 44px; padding: 10px; }
  .cal-sidebar { padding-left: max(8px, env(safe-area-inset-left)); padding-right: max(8px, env(safe-area-inset-right)); }
}
@media (max-width: 420px) {
  .journal-mood-recovery-modal .modal-content { width: calc(100vw - 32px); max-width: calc(100vw - 32px); }
  .journal-mood-actions { flex-wrap: wrap; }
  .journal-mood-recovery-row { grid-template-columns: minmax(0, 1fr); }
  .journal-mood-recovery-row button { justify-self: stretch; }
  .journal-timeline-header { align-items: flex-start; }
  .journal-timeline-actions { flex-wrap: wrap; justify-content: flex-end; }
  .dayline-mobile-mode-host .journal-timeline-view { padding-left: 8px; padding-right: 8px; }
  .dayline-mobile-mode-host .journal-timeline-entry.has-thumbnail { grid-template-columns: minmax(0, 1fr) 76px; }
  .dayline-mobile-mode-host .journal-timeline-thumbnail,
  .dayline-mobile-mode-host .journal-timeline-thumbnail img { width: 76px; height: 76px; min-width: 76px; }
}
@container (max-width: 420px) {
  .journal-mood-scale { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 240px) {
  .cal-entry-count {
    right: 2px;
    bottom: 2px;
    height: auto;
    padding: 0;
    border-radius: 0;
    font-size: 8px;
    line-height: 1;
  }
}
@container (max-width: 300px) {
  .journal-mood-scale { grid-template-columns: minmax(0, 1fr); }
}
`;
    if (!style.parentElement) {
    document.head.appendChild(style);
}
  }

  async activateView() {
    if (this.capabilities?.isMobile) return this._activateMobileMode('calendar');
    const opened = await this.viewVisibilityController.open('calendar');
    this._syncDaylineRibbon();
    return opened;
  }

  async _openCalendarView() {
    const { workspace } = this.app;

    if (this.capabilities?.isMobile) {
      await this._openMobileDayline('calendar');
      return;
    }

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
  constructor(leaf, plugin, options = {}) {
    super(leaf);
    this.plugin = plugin;
    this.embedded = options.embedded === true;
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
    this._weatherRevalidation = null;
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
    // Unified media metadata and cover cache (shared across calendar/timeline).
    this.mediaService = plugin.mediaService;
    // Track processed note-image elements (cleared when view is destroyed)
    this._exifNoteImages = new WeakSet();
    this._exifNoteMediaControls = new WeakSet();
    // On This Day provider
    this._otdProvider = new OnThisDayProvider(plugin);
    // Cache for quick dot-marker lookup: Set<"MM-DD">
    this._otdDotCache = null;
    // Month-jump state is intentionally view-local.
    this._calendarJumpOpen = false;
    this._calendarKeydownHandler = null;
    this.closed = false;
    this.journalIndexError = null;
  }

  getViewType()   { return VIEW_TYPE; }
  getDisplayText(){ return t(this.plugin.settings, 'calendarTitle'); }
  getIcon()       { return 'calendar'; }

  /* ----- Lifecycle ----- */
  async onOpen() {
    this.closed = false;
    this.journalIndexError = null;
    this.containerEl.addClass('cal-sidebar');
    this.contentEl.addClass('cal-calendar-content');
    this.contentEl.setAttribute('tabindex', '0');
    this.contentEl.setAttribute('aria-label', t(this.plugin.settings, 'calendarTitle'));
    this._calendarKeydownHandler = (event) => {
      if (!shouldHandleCalendarMonthShortcut(event)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this._goToMonth(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this._goToMonth(1);
      }
    };
    this.contentEl.addEventListener('keydown', this._calendarKeydownHandler);
    this._unsubscribeIndex = this.plugin.journalIndex?.subscribe?.((_, change) => {
      this._onJournalIndexChanged(change)
        .catch((error) => console.warn('[Dayline] Calendar index refresh failed:', error?.message || error));
    });

    // Detect which date the user is currently viewing
    this._syncActiveDate();
    this.render();

    const indexWasReady = Boolean(this.plugin.journalIndex?.isReady);
    startJournalIndexLoad(
      () => this.plugin.ensureJournalIndexReady
        ? this.plugin.ensureJournalIndexReady()
        : this.plugin.journalIndex.refresh(this.plugin.settings),
      () => {
        if (this.closed) return;
        this.journalIndexError = null;
        const refresh = indexWasReady ? this.refresh() : Promise.resolve();
        refresh.catch((error) => {
          console.warn('[Dayline] Initial calendar month load failed:', error?.message || error);
          this.monthCache.delete(this._monthKey(this.displayMonth));
          new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
        });
      },
      (error) => {
        if (this.closed) return;
        this.journalIndexError = error;
        console.warn('[Dayline] Calendar journal index load failed:', error?.message || error);
        this.render();
      },
    );

  }

  onClose() {
    this.closed = true;
    if (this._calendarKeydownHandler) this.contentEl.removeEventListener('keydown', this._calendarKeydownHandler);
    this._calendarKeydownHandler = null;
    this._unsubscribeIndex?.();
    this._unsubscribeIndex = null;
    clearTimeout(this._refreshTimer);
    clearTimeout(this._exifNoteTimer);
    this.plugin._endExifHover();
    for (const observer of this._exifObservers?.values() || []) observer.disconnect();
    this._exifObservers?.clear();
    this._removeAllOverlaysFromViews();
    this._hostPositionMarkers.clear();
    if (!this.embedded) {
      this.plugin.viewVisibilityController?.viewClosed('calendar')
        .then(() => this.plugin._syncDaylineRibbon())
        .catch((error) => console.warn('[Dayline] Calendar close state sync failed:', error?.message || error));
    }
  }

  _handleActiveLeafChange() {
    this._syncActiveDate();
    // Defer to avoid race with click handler calling openFile.
    setTimeout(() => this.render(), 0);
  }

  /* ----- File change refresh (debounced) ----- */
  _onMediaChanged(file) {
    if (!(file instanceof TFile)) return;

    const extension = file.extension?.toLowerCase();
    if (!MEDIA_EXTENSIONS.includes(extension)) return;
    const affectedMonths = cachedMonthsReferencingMedia(
      this.monthCache,
      file.path,
      (attachment) => this._resolveMediaAttachmentPath(attachment),
    );
    if (!affectedMonths.size) return;
    for (const monthKey of affectedMonths) this.monthCache.delete(monthKey);
    if (!affectedMonths.has(this._monthKey(this.displayMonth))) return;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(async () => {
      try {
        await this.buildMonthCache(this.displayMonth);
        this.render();
      } catch (error) {
        console.warn('[Dayline] Calendar image refresh failed:', error?.message || error);
        this.monthCache.delete(this._monthKey(this.displayMonth));
        new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
      }
    }, 300);
  }

  _onImageChanged(file) { this._onMediaChanged(file); }

  _resolveMediaAttachmentPath(attachment) {
    if (!attachment || attachment.external) return undefined;
    const resolved = this.app.metadataCache?.getFirstLinkpathDest?.(attachment.normalizedLink, attachment.sourcePath);
    return resolved?.path;
  }

  async _onJournalIndexChanged(change) {
    if (change?.type !== 'file') {
      await this.refresh();
      return;
    }

    if (!calendarEntryAffectsDisplay(change.previous, change.entry)) return;

    const entries = [change.previous, change.entry].filter(Boolean);
    const dates = Array.from(new Set(entries.map((entry) => entry.date).filter(Boolean)));
    for (const path of new Set(entries.map((entry) => entry.path).filter(Boolean))) this.mediaService?.invalidate(path);
    if (!dates.length) return;

    const displayKey = this._monthKey(this.displayMonth);
    let displayAffected = false;
    for (const date of dates) {
      const [year, month] = date.split('-').map(Number);
      if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
      const monthKey = this._monthKey(new Date(year, month - 1, 1));
      this.monthCache.delete(monthKey);
      displayAffected = displayAffected || monthKey === displayKey;
      this._otdProvider?.refreshDateIndexFor?.(date.slice(5));
    }
    if (!displayAffected) return;
    await this.buildMonthCache(this.displayMonth);
    this.render();
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
    const cachedWeatherDates = Object.keys(this.plugin.weatherCache || {})
      .filter((dateStr) => dateStr.startsWith(prefix) && this.weather?.hasCachedSnapshot?.(dateStr));
    const recordSummaries = aggregateCalendarDays(
      (this.plugin.journalIndex?.getEntries?.() || []).filter((entry) => entry.date.startsWith(prefix)),
    );
    const summaries = withWeatherOnlyDays(recordSummaries, cachedWeatherDates, this.plugin.settings.dailyFolder);
    for (const [dateStr, summary] of summaries) {
      if (!dateStr.startsWith(prefix)) continue;
      if (this.plugin.settings.thumbnailFilter === 'date-prefixed') {
        summary.media = summary.media.filter((item) => {
          const fileName = item.normalizedLink.split(/[\\/]/).pop() || '';
          return fileName.startsWith(dateStr);
        });
        summary.images = summary.media.filter((item) => item.kind === 'image');
        if (summary.cover && !summary.media.some((item) => item.normalizedLink === summary.cover.normalizedLink)) {
          summary.cover = summary.media[0];
        }
      }
      if (summary.entries?.some((entry) => this.weather?.hasCachedSnapshot?.(dateStr, entry.path))) {
        summary.hasWeather = true;
      }
      map.set(dateStr, summary);
    }

    this.monthCache.set(key, map);
  }

  /* ----- Render the calendar ----- */
  render() {
    // Bump fetch token so stale async results are discarded
    this._fetchToken = (this._fetchToken || 0) + 1;

    const el = this.contentEl;
    el.empty();
    el.setAttribute('aria-label', t(this.plugin.settings, 'calendarTitle'));

    if (this.journalIndexError) {
      el.createDiv({ cls: 'journal-index-loading journal-index-load-error', text: t(this.plugin.settings, 'journalIndexLoadFailed', { error: this.journalIndexError?.message || this.journalIndexError }) });
      return;
    }
    if (!this.plugin.journalIndex?.isReady) {
      el.createDiv({ cls: 'journal-index-loading', text: t(this.plugin.settings, 'journalIndexLoading') });
      return;
    }

    // Ensure EXIF tooltip element exists (reused across renders)
    this._ensureExifTooltip();

    const year = this.displayMonth.getFullYear();
    const month = this.displayMonth.getMonth();
    const key = this._monthKey(this.displayMonth);
    const imageMap = this.monthCache.get(key) || new Map();

    // --- Header: month navigation and view-local controls ---
    const header = el.createDiv({ cls: 'cal-header' });
    const prevBtn = header.createEl('button', {
      cls: 'cal-nav cal-icon-button',
      attr: { type: 'button', 'aria-label': t(this.plugin.settings, 'previousMonth'), title: t(this.plugin.settings, 'previousMonth') },
    });
    setIcon(prevBtn, 'chevron-left');
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._goToMonth(-1);
    });

    const title = header.createEl('button', {
      cls: 'cal-title cal-title-button',
      attr: {
        type: 'button',
        'aria-label': t(this.plugin.settings, 'jumpToMonth'),
        title: t(this.plugin.settings, 'jumpToMonth'),
        'aria-expanded': String(this._calendarJumpOpen),
      },
    });
    title.setText(formatCalendarMonth(year, month + 1, this.plugin.settings));
    title.addEventListener('click', (event) => {
      event.stopPropagation();
      this._calendarJumpOpen = !this._calendarJumpOpen;
      this.render();
    });

    const nextBtn = header.createEl('button', {
      cls: 'cal-nav cal-icon-button',
      attr: { type: 'button', 'aria-label': t(this.plugin.settings, 'nextMonth'), title: t(this.plugin.settings, 'nextMonth') },
    });
    setIcon(nextBtn, 'chevron-right');
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._goToMonth(1);
    });

    const headerActions = header.createDiv({ cls: 'cal-header-actions' });
    const todayBtn = headerActions.createEl('button', {
      cls: 'cal-icon-button cal-today-button',
      attr: { type: 'button', 'aria-label': t(this.plugin.settings, 'today'), title: t(this.plugin.settings, 'today') },
    });
    setIcon(todayBtn, 'calendar-check');
    todayBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this._goToToday();
    });
    if (this._calendarJumpOpen) this._renderMonthJump(el);
    // Calendar records are intentionally unfiltered; the timeline owns filtering.

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
    const touchRouting = calendarCellTouchRouting(Boolean(this.plugin.capabilities?.coarsePointer));

    const firstDay = getCalendarGridOffset(year, month, this.plugin.settings);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = _daylineDate(this.plugin.settings);

    // Empty cells before the 1st
    for (let i = 0; i < firstDay; i++) {
      grid.createDiv({ cls: 'cal-day cal-day-empty' });
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatDateParts(year, month + 1, d);
      const dateEntry = imageMap.get(dateStr) || {
        date: dateStr, entries: [], entryCount: 0, sourceIds: [], hasRecord: false, hasWeather: false,
        path: null, primaryEntryPath: undefined, mood: undefined, media: [], images: [], cover: undefined,
      };
      const media = dateEntry.media || [];
      const images = dateEntry.images || media.filter((item) => item.kind === 'image');
      const cover = dateEntry.cover || media[0];
      const isToday = dateStr === todayStr;

      const cell = grid.createDiv({ cls: 'cal-day' });
      if (cover) cell.addClass('cal-has-image');
      else cell.addClass('cal-no-image');
      if (dateEntry.hasRecord) cell.addClass('cal-has-record');
      if (dateEntry.hasWeather) cell.addClass('cal-has-weather');
      cell.setAttribute('aria-label', `${dateStr}${dateEntry.entryCount ? `, ${dateEntry.entryCount} entries` : ''}${dateEntry.hasWeather ? ', weather available' : ''}`);
      if (isToday) cell.addClass('cal-today');
      if (dateStr === this.activeDate && !isToday) cell.addClass('cal-active');

      // Background image (first image as thumbnail)
      if (cover) {
        const bg = cell.createDiv({ cls: 'cal-day-bg' });
        const overlay = cell.createDiv({ cls: 'cal-day-overlay' });
        this._setBackground(bg, dateEntry);

        // Unified media metadata tooltip on hover. Images retain the legacy EXIF path.
        const firstMedia = cover;
        const mediaLabel = t(this.plugin.settings, 'mediaMetadata');
        cell.addEventListener('mouseenter', () => {
          // Never leave the keyboard-only name on the element while the pointer is over it.
          bg.removeAttribute('aria-label');
          this._onMediaEnter(cell, firstMedia);
        });
        cell.addEventListener('mouseleave', () => this._onExifLeave(cell));
        if (touchRouting.focusMediaBackground) {
          bg.tabIndex = 0;
          bg.setAttribute('role', 'img');
          bg.addEventListener('focusin', () => {
            const label = calendarMediaAccessibilityLabel(dateStr, mediaLabel, true);
            if (label) bg.setAttribute('aria-label', label);
            this._onMediaEnter(cell, firstMedia, true);
          });
          bg.addEventListener('focusout', () => {
            const label = calendarMediaAccessibilityLabel(dateStr, mediaLabel, false);
            if (label) bg.setAttribute('aria-label', label);
            else bg.removeAttribute('aria-label');
          });
        }
      }

      if (touchRouting.showEntryCountControl
        && this.plugin.settings.showCalendarEntryCount !== false
        && dateEntry.entryCount > 1) {
        cell.createEl('span', {
          cls: 'cal-entry-count',
          text: `+${dateEntry.entryCount - 1}`,
          attr: {
            'aria-label': `${dateEntry.entryCount} entries on ${dateStr}`,
          },
        });
      }

      // Weather badge for dates with cached weather
      const weatherEntry = dateEntry.entries?.find((entry) => this.weather.hasCachedSnapshot(dateStr, entry.path));
      const weatherPath = weatherEntry?.path || dateEntry.path;
      if (this.plugin.settings.weatherEnabled
        && shouldShowCalendarWeatherBadge(this.plugin.settings)
        && this.weather.hasCachedSnapshot(dateStr, weatherPath)) {
        const snap = this._readCachedWeather(dateStr, weatherPath);
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
      const moodPath = dateEntry.primaryEntryPath || dateEntry.path || dailyPath;
      if (touchRouting.showMoodControl && shouldShowCalendarMood(this.plugin.settings)) {
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
        if (!shouldOpenCalendarDateFromPointer(e.target)) return;
        e.stopPropagation();
        this._openNote(dateStr, dateEntry.primaryEntryPath || dateEntry.path);
      });
    }
  }

  _renderMonthJump(containerEl) {
    const panel = containerEl.createDiv({ cls: 'cal-jump-panel' });
    panel.setAttribute('aria-label', t(this.plugin.settings, 'jumpToMonth'));

    const yearLabel = panel.createEl('label', { cls: 'cal-filter-field' });
    yearLabel.createSpan({ text: t(this.plugin.settings, 'year') });
    const yearInput = yearLabel.createEl('input', {
      attr: { type: 'number', min: '1', max: '9999', inputmode: 'numeric', 'aria-label': t(this.plugin.settings, 'year') },
    });
    yearInput.value = String(this.displayMonth.getFullYear());

    const monthLabel = panel.createEl('label', { cls: 'cal-filter-field' });
    monthLabel.createSpan({ text: t(this.plugin.settings, 'month') });
    const monthSelect = monthLabel.createEl('select', { attr: { 'aria-label': t(this.plugin.settings, 'month') } });
    const locale = getDisplayLanguage(this.plugin.settings) === 'en' ? 'en-US' : 'zh-CN';
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
    for (let index = 0; index < 12; index++) {
      const option = monthSelect.createEl('option', {
        value: String(index),
        text: monthFormatter.format(new Date(Date.UTC(2020, index, 1))),
      });
      if (index === this.displayMonth.getMonth()) option.selected = true;
    }

    const apply = panel.createEl('button', {
      cls: 'cal-icon-button cal-jump-apply',
      attr: { type: 'button', 'aria-label': t(this.plugin.settings, 'apply'), title: t(this.plugin.settings, 'apply') },
    });
    setIcon(apply, 'check');
    apply.addEventListener('click', (event) => {
      event.stopPropagation();
      const nextYear = Math.max(1, Math.min(9999, Number.parseInt(yearInput.value, 10) || this.displayMonth.getFullYear()));
      const nextMonth = Math.max(0, Math.min(11, Number.parseInt(monthSelect.value, 10) || 0));
      this._jumpToMonth(nextYear, nextMonth);
    });
  }

  _goToToday() {
    const [year, month] = _daylineDate(this.plugin.settings).split('-').map(Number);
    this._jumpToMonth(year, month - 1);
  }

  _jumpToMonth(year, monthIndex) {
    this.displayMonth = new Date(year, monthIndex, 1);
    this._calendarJumpOpen = false;
    this.buildMonthCache(this.displayMonth).then(() => this.render()).catch((error) => {
      console.warn('[Dayline] Calendar month jump failed:', error?.message || error);
      this.monthCache.delete(this._monthKey(this.displayMonth));
      new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
    });
  }

  /* ----- EXIF Tooltip (delegates to plugin) ----- */

  _ensureExifTooltip() { this.plugin._ensureExifTooltip(); }
  _showExifTooltip(el, fields, loading, kind) { this.plugin._showExifTooltip(el, fields, loading, kind); }
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

  _onMediaEnter(cell, attachment, immediate = false) {
    if (!this.plugin.settings.showExif || !attachment) return;
    if (immediate && this.plugin._toggleExifTouch(cell)) return;
    const hoverToken = this.plugin._beginExifHover();
    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(cell, null, true, 'media');
        const metadata = await this.mediaService?.getMetadata?.(attachment);
        const fields = formatMediaMetadataForDisplay(metadata);
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(cell, fields, false, 'media');
      } catch (_) {
        this.plugin._hideExifTooltip();
      }
    }, immediate ? 0 : 500);
  }

  _onExifLeave(anchor) {
    if (this.plugin._exifTouchAnchor && (!anchor || this.plugin._exifTouchAnchor === anchor)) return;
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

    // Keep the connected card in place, but still ask WeatherService to
    // revalidate this date. Its cache/TTL and in-flight map make fresh checks
    // cheap and stale refreshes deduplicated.
    if (this._weatherCardDate === cardDate && this._weatherCardEl && this._weatherCardEl.isConnected) {
      this._revalidateConnectedWeatherCard(cardDate);
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
    const locationEl = shouldShowCalendarWeatherLocation(s)
      ? infoEl.createDiv({ cls: 'cal-weather-location' })
      : null;
    const detailEl = infoEl.createDiv({ cls: 'cal-weather-detail' });
    const extraEl = infoEl.createDiv({ cls: 'cal-weather-extra' });
    const statusEl = infoEl.createDiv({ cls: 'cal-weather-status' });
    tempEl.setText(_l(s.weatherLanguage, 'loading'));
    if (locationEl) locationEl.setText(`${_l(s.weatherLanguage, 'weatherLocation')}: ${s.weatherLocationName || `${parseFloat(s.weatherLatitude).toFixed(2)}, ${parseFloat(s.weatherLongitude).toFixed(2)}`}`);

    // Native Obsidian refresh icon button
    const refreshBtn = card.createEl('button', {
      cls: 'cal-weather-refresh',
      attr: { 'aria-label': _l(s.weatherLanguage, 'refresh'), title: _l(s.weatherLanguage, 'refresh') },
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

  _revalidateConnectedWeatherCard(dateStr) {
    if (this._weatherRevalidation?.date === dateStr) return this._weatherRevalidation.promise;

    const request = Promise.resolve()
      .then(() => this.weather.getSnapshot(dateStr))
      .then((snap) => {
        if (this._weatherCardDate !== dateStr || !this._weatherCardEl?.isConnected) return snap;
        const compatible = snap && this.weather.isSnapshotCompatible(snap) ? snap : null;
        this._weatherSnapshot = compatible;
        this._weatherError = !compatible;
        this._weatherLoading = false;
        this._updateWeatherCardUI();
        return compatible;
      })
      .catch((err) => {
        if (this._weatherCardDate === dateStr && this._weatherCardEl?.isConnected) {
          this._weatherError = true;
          this._weatherLoading = false;
          this._updateWeatherCardUI();
        }
        console.warn('[Dayline] Same-date weather revalidation failed:', err?.message || err);
        return null;
      });

    let tracked;
    tracked = request.finally(() => {
      if (this._weatherRevalidation?.promise === tracked) this._weatherRevalidation = null;
    });
    this._weatherRevalidation = { date: dateStr, promise: tracked };
    return tracked;
  }

  /* ----- Update weather card UI after async data arrives ----- */
  _updateWeatherCardUI() {
    const card = this._weatherCardEl;
    if (!card || !card.isConnected) return;
    const lang = this.plugin.settings.weatherLanguage;

    card.removeClass('cal-weather-loading');
    card.removeClass('cal-weather-error');

    const locationEl = card.querySelector('.cal-weather-location');
    const detailEl = card.querySelector('.cal-weather-detail');
    const extraEl = card.querySelector('.cal-weather-extra');
    const statusEl = card.querySelector('.cal-weather-status');
    if (this._weatherError) {
      card.addClass('cal-weather-error');
      const iconEl = card.querySelector('.cal-weather-icon');
      if (iconEl) { iconEl.src = ''; iconEl.alt = '⚠️'; }
      card.querySelector('.cal-weather-temp').setText(_l(lang, 'unavailable'));
      if (locationEl) locationEl.setText(`${_l(lang, 'weatherLocation')}: ${this.plugin.settings.weatherLocationName || ''}`);
      if (detailEl) detailEl.setText(_l(lang, 'checkSettings'));
      if (extraEl) extraEl.setText('');
      if (statusEl) statusEl.setText('');
      return;
    }

    const snap = this._weatherSnapshot;
    if (!snap) {
      const iconEl = card.querySelector('.cal-weather-icon');
      if (iconEl) iconEl.src = _iconUrl('overcast.svg');
      card.querySelector('.cal-weather-temp').setText('—');
      if (locationEl) locationEl.setText(`${_l(lang, 'weatherLocation')}: ${this.plugin.settings.weatherLocationName || ''}`);
      if (detailEl) detailEl.setText(_l(lang, 'noData'));
      if (extraEl) extraEl.setText('');
      if (statusEl) statusEl.setText('');
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

    const labels = {
      feels: _l(lang, 'feels'),
      humidity: _l(lang, 'humidity'),
      low: _l(lang, 'low'),
      precipitation: _l(lang, 'precipitation'),
      wind: _l(lang, 'wind'),
      sunrise: _l(lang, 'sunrise'),
      sunset: _l(lang, 'sunset'),
      cached: _l(lang, 'cached'),
      stale: _l(lang, 'stale'),
      offline: _l(lang, 'offline'),
    };
    if (locationEl) {
      locationEl.setText(`${_l(lang, 'weatherLocation')}: ${snap.location || ''}`);
      locationEl.title = snap.location || '';
    }
    const displayFields = Array.isArray(this.plugin.settings.weatherDisplayFields)
      ? this.plugin.settings.weatherDisplayFields
      : ['feels', 'humidity'];
    if (detailEl) {
      detailEl.setText(buildWeatherDetailParts(snap, labels)
        .filter((part) => part.startsWith(`${labels.feels} `)
          ? displayFields.includes('feels')
          : displayFields.includes('humidity'))
        .join(' · ') || '');
      detailEl.title = snap.location || '';
    }
    if (extraEl) {
      const displayFields = Array.isArray(this.plugin.settings.weatherDisplayFields)
        ? this.plugin.settings.weatherDisplayFields
        : ['feels', 'humidity'];
      const extraParts = buildWeatherExtraParts(
        snap,
        { ...labels, low: _l(lang, 'low') },
        lang,
        this.plugin.settings.weatherTimezone || 'auto',
      ).filter((part) => {
        if (part.startsWith(`${labels.feels} `)) return displayFields.includes('feels');
        if (part.startsWith(`${labels.humidity} `)) return displayFields.includes('humidity');
        if (part.startsWith(`${labels.low} `)) return displayFields.includes('low');
        if (part.startsWith(`${labels.precipitation} `)) return displayFields.includes('precipitation');
        if (part.startsWith(`${labels.wind} `)) return displayFields.includes('wind');
        if (part.startsWith(`${labels.sunrise} `)) return displayFields.includes('sunrise');
        if (part.startsWith(`${labels.sunset} `)) return displayFields.includes('sunset');
        return false;
      });
      extraEl.setText(extraParts.join(' · '));
    }
    if (statusEl) statusEl.setText(buildWeatherStatus(snap, labels).join(' · '));

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
  async _setBackground(bgEl, summary) {
    try {
      const result = await this.mediaService?.loadFirstCover?.(summary.media || [], summary.cover);
      if (result && bgEl.isConnected) {
        bgEl.style.backgroundImage = `url("${result.url}")`;
      }
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
        : (mdLeaves.length > 0
          ? mdLeaves[0]
          : (this.plugin.capabilities?.isMobile
            ? (this.app.workspace.getLeaf('tab') || this.app.workspace.getLeaf(true))
            : this.app.workspace.getLeaf(true)));
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
      img.tabIndex = 0;
      img.setAttribute('aria-label', t(this.plugin.settings, 'mediaMetadata'));
      img.addEventListener('mouseenter', (e) => this._onNoteImageEnter(e, img));
      img.addEventListener('mouseleave', () => this._onExifLeave(img));
      img.addEventListener('focusin', (e) => this._onNoteImageEnter(e, img, true));
      // Let the outer embed own the single touch affordance when Obsidian
      // renders an image inside an interactive embed wrapper.
      if (getMediaControlOwner(img) === img) {
        this._addNoteMediaInfoControl(img, () => this._onNoteImageEnter(null, img, true));
      }
    }
  }

  _processEmbedEls(embeds) {
    for (const el of embeds) {
      if (this._exifNoteImages.has(el)) continue;
      // Media Extended and Obsidian both render embeds through this outer
      // element. Resolve the owning Markdown leaf instead of activeLeaf so
      // split panes never borrow another note's relative path.
      const src = el.getAttribute('src') || '';
      const normalizedSrc = normalizeMediaLink(src);
      const classified = classifyMediaLink(normalizedSrc);
      const ext = classified.extension;
      if (!ext || !MEDIA_EXTENSIONS.includes(ext)) continue;
      this._exifNoteImages.add(el);
      el.tabIndex = 0;
      el.setAttribute('aria-label', t(this.plugin.settings, 'mediaMetadata'));
      el.addEventListener('mouseenter', (e) => MEDIA_IMAGE_EXTENSIONS.includes(ext)
        ? this._onNoteImageEnter(e, el)
        : this._onNoteMediaEnter(e, el));
      el.addEventListener('mouseleave', () => this._onExifLeave(el));
      el.addEventListener('focusin', (e) => MEDIA_IMAGE_EXTENSIONS.includes(ext)
        ? this._onNoteImageEnter(e, el, true)
        : this._onNoteMediaEnter(e, el, true));
      this._addNoteMediaInfoControl(el, () => MEDIA_IMAGE_EXTENSIONS.includes(ext)
        ? this._onNoteImageEnter(null, el, true)
        : this._onNoteMediaEnter(null, el, true));

      // For HEIC, also try to convert and display the image
      if (HEIC_EXTS.includes(ext) && !hasExistingImage(el) && !el.querySelector('.cal-heic-preview')) {
        this._convertHeicEmbed(el, normalizedSrc);
      }
    }
  }

  async _convertHeicEmbed(el, src) {
    if (resolveCapabilityRoute(this.plugin.capabilities, 'heic') === 'disabled') return;
    // Show loading indicator
    const loader = document.createElement('div');
    loader.className = 'cal-heic-preview';
    loader.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:60px;color:var(--text-muted);font-size:12px;';
    loader.textContent = t(this.plugin.settings, 'heicConverting');
    el.appendChild(loader);

    try {
      const notePath = this._notePathForElement(el);
      const file = this.app.metadataCache.getFirstLinkpathDest(src, notePath);
      if (!(file instanceof TFile)) return;

      const thumb = await this.plugin.heicCache.getThumbnail(file);
      if (!thumb) {
        loader.textContent = t(this.plugin.settings, 'heicConversionFailed');
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
      img.tabIndex = 0;
      img.setAttribute('aria-label', t(this.plugin.settings, 'mediaMetadata'));
      img.addEventListener('mouseenter', (e) => this._onNoteImageEnter(e, img));
      img.addEventListener('mouseleave', () => this._onExifLeave(img));
      img.addEventListener('focusin', (e) => this._onNoteImageEnter(e, img, true));
      this._addNoteMediaInfoControl(img, () => this._onNoteImageEnter(null, img, true));
      loader.replaceWith(img);
    } catch (_) {
      loader.textContent = t(this.plugin.settings, 'heicError');
    }
  }

  async _onNoteImageEnter(e, img, immediate = false) {
    if (!this.plugin.settings.showExif) return;
    if (immediate && this.plugin._toggleExifTouch(img)) return;
    if (!immediate) this.plugin._exifTouchAnchor = null;
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
    }, immediate ? 0 : 500);
  }

  async _onNoteMediaEnter(e, el, immediate = false) {
    if (!this.plugin.settings.showExif) return;
    if (immediate && this.plugin._toggleExifTouch(el)) return;
    if (!immediate) this.plugin._exifTouchAnchor = null;
    const hoverToken = this.plugin._beginExifHover();
    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        const src = el.getAttribute('src') || '';
        const attachment = createMediaAttachment(src, this._notePathForElement(el));
        if (!attachment) return;
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(el, null, true, 'media');
        const metadata = await this.mediaService?.getMetadata?.(attachment);
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(el, formatMediaMetadataForDisplay(metadata), false, 'media');
      } catch (_) {
        this.plugin._hideExifTooltip();
      }
    }, immediate ? 0 : 500);
  }

  _addNoteMediaInfoControl(el, open) {
    const owner = getMediaControlOwner(el);
    if (!this.plugin.capabilities?.coarsePointer || !shouldAddMediaInfoControl(owner, this._exifNoteMediaControls)) return;
    const link = owner?.closest?.('a');
    const reference = link || owner;
    const parent = reference?.parentElement;
    if (!parent) return;
    const button = document.createElement('button');
    button.className = 'dayline-note-media-info';
    button.type = 'button';
    button.setAttribute('aria-label', t(this.plugin.settings, 'mediaMetadata'));
    button.title = t(this.plugin.settings, 'mediaMetadata');
    setIcon(button, 'info');
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      open();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    parent.insertBefore(button, reference.nextSibling);
    this._exifNoteMediaControls.add(owner);
  }

  _notePathForElement(el) {
    const leaves = this.app.workspace.getLeavesOfType('markdown') || [];
    for (const leaf of leaves) {
      const container = leaf.containerEl || leaf.view?.containerEl;
      if (container?.contains?.(el)) return leaf.view?.file?.path || '';
    }
    return '';
  }

  _resolveImageFile(el) {
    const notePath = this._notePathForElement(el);

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

    let path = normalizeMediaLink(src);
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
   Mobile Dayline View
   ============================================================ */
class MobileDaylineView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.mode = 'calendar';
    this.activeView = null;
    this.calendarView = null;
    this.timelineView = null;
    this.modeHost = null;
    this.modeButtons = new Map();
    this.opening = false;
    this.closed = false;
    this._queueMode = createSerialDaylineModeSwitcher((mode) => this._applyMode(mode));
  }

  getViewType() { return MOBILE_DAYLINE_VIEW; }
  getDisplayText() { return 'Dayline'; }
  getIcon() { return 'calendar-range'; }

  async onOpen() {
    this.closed = false;
    this.containerEl.addClass('dayline-mobile-shell');
    const root = this.contentEl;
    root.empty();
    root.addClass('dayline-mobile-view');
    const header = root.createDiv({ cls: 'dayline-mobile-header' });
    const controls = header.createDiv({
      cls: 'dayline-mobile-mode-controls',
      attr: { role: 'group', 'aria-label': 'Dayline view' },
    });
    this._addModeButton(controls, 'calendar', 'calendar-days', t(this.plugin.settings, 'calendarTitle'));
    this._addModeButton(controls, 'timeline', 'list', t(this.plugin.settings, 'timelineTitle'));
    this.modeHost = root.createDiv({ cls: 'dayline-mobile-mode-host' });
    this.opening = true;
    this._renderLoading();
    try {
      await this.plugin.ensureJournalIndexReady();
      await this._showMode(this.mode);
    } catch (error) {
      console.warn('[Dayline] Mobile journal index load failed:', error?.message || error);
      this._renderLoadError(error);
    } finally {
      this.opening = false;
    }
  }

  async onClose() {
    this.closed = true;
    await this.activeView?.onClose?.();
    this.activeView = null;
    this.modeButtons.clear();
    this.plugin._syncDaylineRibbon();
  }

  async setMode(mode) {
    this.mode = normalizeDaylineMobileMode(mode);
    this._syncModeButtons();
    if (!this.opening && this.modeHost) await this._queueMode(this.mode);
  }

  async setDateFilter(date) {
    await this.setMode('timeline');
    this.timelineView?.setDateFilter?.(date);
  }

  async _applyMode(mode) {
    if (this.closed || this.opening || !this.modeHost) return;
    try {
      await this._showMode(mode);
    } catch (error) {
      console.warn('[Dayline] Mobile journal index reload failed:', error?.message || error);
      this._renderLoadError(error);
    }
  }

  _addModeButton(parent, mode, icon, label) {
    const button = parent.createEl('button', {
      cls: 'dayline-mobile-mode-button',
      attr: { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(this.mode === mode) },
    });
    setIcon(button, icon);
    button.addEventListener('click', () => this.setMode(mode));
    this.modeButtons.set(mode, button);
  }

  _syncModeButtons() {
    for (const [mode, button] of this.modeButtons) {
      const active = mode === this.mode;
      button.toggleClass('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  _renderLoading() {
    if (!this.modeHost) return;
    this.modeHost.empty();
    this.modeHost.createDiv({ cls: 'dayline-mobile-loading', text: t(this.plugin.settings, 'journalIndexLoading') });
  }

  _renderLoadError(error) {
    if (!this.modeHost) return;
    this.modeHost.empty();
    this.modeHost.createDiv({
      cls: 'dayline-mobile-loading dayline-mobile-load-error',
      text: t(this.plugin.settings, 'journalIndexLoadFailed', { error: error?.message || error }),
    });
  }

  _embeddedView(mode) {
    if (mode === 'timeline') {
      this.timelineView ??= new JournalTimelineView(this.leaf, this.plugin, { embedded: true });
      return this.timelineView;
    }
    this.calendarView ??= new CalendarView(this.leaf, this.plugin, { embedded: true });
    return this.calendarView;
  }

  async _showMode(mode) {
    if (this.closed || !this.modeHost) return;
    const next = this._embeddedView(mode);
    if (this.activeView === next) return;
    await this.activeView?.onClose?.();
    this.activeView = null;
    this.modeHost.empty();
    this.modeHost.classList.remove('cal-sidebar', 'cal-calendar-content', 'journal-timeline-view');
    bindMobileEmbeddedViewHost(next, this.modeHost);
    this.activeView = next;
    this._syncModeButtons();
    await next.onOpen();
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
