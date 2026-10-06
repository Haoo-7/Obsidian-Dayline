// @ts-nocheck
/**
 * Dayline — a visual journal for calendars, timelines, moods, memories, weather, and photos.
 * Scans Calendar/Daily/ for notes with images, shows thumbnails in date cells.
 * Click a date to open that day's daily note.
 */
const { Plugin, ItemView, TFile, Notice, Modal, Menu, setIcon, Platform, normalizePath } = require('obsidian');
const { PLUGIN_ID, LEGACY_PLUGIN_IDS } = require('./plugin-identity');
const { JournalIndex, startJournalIndexLoad, waitForJournalIndexStartup } = require('./journal-index');
const { subscribeJournalMetadataRefresh } = require('./journal-metadata-refresh');
const { MoodStore } = require('./mood-store');
const { MoodPickerModal, MoodRecoveryModal } = require('./mood-picker-modal');
const { saveMoodExport, serializeMoodCsv, serializeMoodJson } = require('./mood-export');
const { JournalTimelineView, JOURNAL_TIMELINE_VIEW } = require('./journal-timeline-view');
const { OnThisDayProvider, OnThisDayModal, closeOnThisDayModal } = require('./on-this-day');
const {
  normalizeOnThisDayEntryMode,
  onThisDayEntryDate,
  onThisDayStripMeta,
  onThisDayYearsAgo,
  parseOnThisDayMonthDay,
  pickOnThisDayPreview,
  shouldPreserveCalendarSelection,
  shouldShowHeaderOnThisDayEntry,
  shouldShowMergedOnThisDayEntry,
  clearOnThisDayStrip,
  resolveWeatherOnThisDayHost,
  createStandaloneOnThisDayHost,
  mountOnThisDayStrip,
} = require('./on-this-day-entry');
const { DaylineSettingsTab } = require('./settings-tab');
/* Lucide badge glyphs (ISC). Imported as raw markup so the inline <svg> can inherit
   currentColor; esbuild's `text` loader and vitest both resolve `?raw` to the source. */
const badgeSunSvg = require('../icons/badge-sun.svg?raw');
const { appendBadgeSvg } = require('./badge-svg');
const badgeCloudSunSvg = require('../icons/badge-cloud-sun.svg?raw');
const badgeCloudSvg = require('../icons/badge-cloud.svg?raw');
const badgeFogSvg = require('../icons/badge-fog.svg?raw');
const badgeDrizzleSvg = require('../icons/badge-drizzle.svg?raw');
const badgeRainSvg = require('../icons/badge-rain.svg?raw');
const badgeSnowSvg = require('../icons/badge-snow.svg?raw');
const badgeStormSvg = require('../icons/badge-storm.svg?raw');
const { WeatherService, lookupWeatherCode, validateWeatherCoordinates, weatherBadgeIcon } = require('./weather-service');
const { pruneWeatherCache, WEATHER_CACHE_MAX_ENTRIES } = require('./weather-cache');
const { weatherConditionLabel } = require('./weather-conditions');
const { buildWeatherCardParts, buildWeatherStatus, normalizeWeatherDisplayFields } = require('./weather-display');
const { localize: _l } = require('./locale');
const { formatDateParts, getClockPartsInTimeZone, getTodayDate, isPathInFolder, joinVaultPath, normalizeVaultPath, parentVaultPath } = require('./date-utils');
const { ThumbnailService } = require('./thumbnail-service');
const { MediaService, formatMediaMetadataForDisplay } = require('./media-service');
const { aggregateCalendarDays, withWeatherOnlyDays } = require('./calendar-summary');
const { cachedMonthsReferencingMedia } = require('./calendar-media-refresh');
const { MEDIA_EXTENSIONS, IMAGE_EXTENSIONS: MEDIA_IMAGE_EXTENSIONS, classifyMediaLink, createMediaAttachment, normalizeMediaLink } = require('./media-links');
const { OverlayRegistry } = require('./overlay-registry');
const { SerialTaskQueue } = require('./task-queue');
const { formatCalendarMonth, formatJournalDate, getCalendarGridOffset, getCalendarWeekdays, getDisplayLanguage, LOCALE_TAGS, moodLabel, normalizeDisplayLanguageSetting, t } = require('./i18n');
const { getMoodColor } = require('./mood');
const { shouldHandleCalendarMonthShortcut } = require('./calendar-keyboard');
const { calendarEntryAffectsDisplay, calendarMediaAccessibilityLabel, calendarMoodMarker, calendarMoodMarkerClass, isCurrentCalendarMonth, shouldShowCalendarMood, shouldShowCalendarWeatherCard, shouldShowCalendarWeatherBadge, shouldShowCalendarWeatherLocation, shouldShowCalendarWrittenMarker } = require('./calendar-display');
const { ViewVisibilityController, normalizeViewVisibilitySettings } = require('./view-visibility-controller');
const { hasExistingImage } = require('./heic-embed');
const { loadHeicCodec } = require('./heic-codec');
const { ImageMetadataCache, HeicCache, HEIC_EXTS, ReverseGeocoder } = require('./image-metadata');
const { detectPlatformCapabilities, resolveCapabilityRoute, usesPhoneLayout } = require('./platform-capabilities');
const { createMobileMarkdownQuickEntry } = require('./mobile-quick-entry');
const {
  getMediaControlOwner,
  shouldAddMediaInfoControl,
  shouldDismissMetadataFromPointer,
  shouldOpenCalendarDateFromPointer,
} = require('./media-interaction');
const { calendarCellTouchRouting, bindOpenOnPointer } = require('./touch-targets');
const { cssUrl } = require('./css-url');
const {
  DAYLINE_VIEW_TYPES,
  MOBILE_DAYLINE_VIEW,
  createSerialMobileDaylineModeController,
  getJournalOpenLeaf,
  getMobileDaylineLeaf,
  getMobileDaylineViewType,
  getPreferredDaylineLeaf,
  isAttachedWorkspaceLeaf,
  isJournalHostLeaf,
  isMainAreaLeaf,
  normalizeDaylineMobileMode,
  renderMobileDaylineModeControls,
  resolveMobileJournalLeaf,
} = require('./dayline-mobile');
const { collectMobileDiagnostics, formatMobileDiagnostics } = require('./mobile-diagnostics');

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
  weatherLanguage: 'zh',  // resolved DisplayLanguage ('en' | 'zh' | 'zh-tw' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru')
  displayLanguage: 'zh',  // 'system' | DisplayLanguage; canonical setting, migrated from weatherLanguage
  weekStart: 'system', // 'system' | 'monday' | 'sunday'
  showCalendarMood: true,
  calendarMoodMarker: 'dot',
  showCalendarWeatherCard: true,
  showCalendarWeatherBadge: true,
  showCalendarWeatherLocation: false,
  showCalendarEntryCount: true,
  // Day One-style written marker: journaled dates without a photo fill their cell.
  showCalendarWrittenMarker: true,
  weatherDisplayFields: ['feels', 'humidity'],
  showCalendarView: true,
  showTimelineView: false,
  showTimelineMoodTrend: true,
  showTimelineTitles: true,
  // Legacy combined weather visibility setting; retained for migration/downgrade compatibility.
  showCalendarWeather: true,
  // --- EXIF metadata ---
  showExif: true,         // show EXIF metadata tooltip on image hover
  exifReverseGeocode: false, // never send GPS coordinates unless explicitly enabled
  // Insert-time EXIF/GPS frontmatter persistence. Off by default: it writes to
  // the user's notes, so it must be an explicit opt-in.
  exifPersistMetadata: false,
  // --- On This Day settings ---
  onThisDayEntry: 'merged', // 'off' | 'merged' | 'header'
  onThisDayButton: true,  // derived from onThisDayEntry !== 'off'; kept for downgrade
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

/**
 * Merge a locally tracked cache over the on-disk snapshot by key. Replacing the
 * whole object would discard entries another device wrote through Obsidian Sync
 * between this instance's last load and its next debounced write.
 */
function _mergeCacheByKey(diskValue, localValue) {
  const disk = diskValue && typeof diskValue === 'object' ? diskValue : {};
  const local = localValue && typeof localValue === 'object' ? localValue : {};
  return { ...disk, ...local };
}

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
    this._mobileDiagnosticEvents = [];
    this._mobileTimelineFilter = {};
    this._mobileDaylineModeController = null;
    this._mobileJournalLeaf = null;
    this._mobileDaylineLastViewTypeValue = null;
    this._lastReminderDate = null;
    this._otdRequestToken = 0;
    // Insert-time EXIF sync state: one run per note at a time, with a coalesced
    // rerun when an event arrives while that run is still in flight.
    this._exifPersistInFlight = new Map();
    this._exifPersistPending = new Set();
    await this._migrateLegacyData();
    await this.loadSettings();
    this.capabilities = detectPlatformCapabilities({ Platform, app: this.app });
    this._mobileQuickEntry = createMobileMarkdownQuickEntry(this);
    this._recordMobileDiagnostic('plugin-loaded');
    this._applyCapabilityClasses();
    // U-11: rotation and split-screen resizes change Obsidian's phone/tablet
    // layout without a reload, so capabilities are re-probed from the live
    // viewport instead of being frozen at load.
    this._bindCapabilityRefresh();

    this.moodStore = new MoodStore(this.app, this.settings);
    await this.moodStore.load();
    // M-01: a metadata file written by a newer plugin puts the store in
    // read-only mode. Say so once, instead of failing every mood edit silently.
    this._warnIfMoodStoreReadOnly();
    this.journalIndex = new JournalIndex(this.app, (path) => this.moodStore.getForIndex(path));
    // Desktop indexes eagerly, but only after Obsidian has restored layout and
    // populated metadata embeds. Mobile stays lazy until Dayline is opened, and
    // waits for the same `resolved` state there (see ensureJournalIndexReady):
    // restoring the layout can otherwise build the first index while
    // metadataCache.getFileCache() still returns null, dropping frontmatter
    // dates and embedded images.
    if (!this.capabilities.isMobile) {
      this._desktopJournalIndexStartup = this._startJournalIndexAfterMetadataResolved();
    }
    this._reminderTimer = window.setInterval(() => this._maybeRemind(), 60 * 1000);

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
      // The geocoder turns this language code into an Accept-Language tag.
      getLanguage: () => getDisplayLanguage(this.settings),
      onChange: () => this._saveGeocoderCache(),
    });

    // HEIC decoding ships inside main.js: Obsidian's installer only downloads
    // main.js, manifest.json and styles.css, so a decoder file next to the
    // plugin never reached community-store installs. The embedded WASM is
    // imported and instantiated lazily, on the first conversion.
    this._libheifFactory = null;
    if (this.capabilities.isDesktop && resolveCapabilityRoute(this.capabilities, 'heic') === 'full') {
      this._libheifFactory = loadHeicCodec;
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
      if (this._usesPhoneDaylineMode()) void this._activateMobileMode(this._mobileDaylineLastMode || 'calendar');
      else this._showDaylineMenu(event);
    });
    this._syncDaylineRibbon();

    // Command to open the calendar (in case it gets closed)
    // P-16: keep the returned command objects so a language change can refresh
    // their names without a reload.
    this._localizedCommands = {
      openCalendar: this.addCommand({
        id: 'open-calendar-sidebar',
        name: t(this.settings, 'openCalendar'),
        callback: () => this.activateView(),
      }),

      // Command to refresh weather for the active date
      refreshWeather: this.addCommand({
        id: 'refresh-weather',
        name: t(this.settings, 'refreshWeather'),
        callback: () => {
          void this.refreshActiveWeather();
        },
      }),

      // Command: Open On This Day modal
      openOnThisDay: this.addCommand({
        id: 'open-on-this-day',
        name: t(this.settings, 'openOnThisDay'),
        callback: () => {
          const [, month, day] = _daylineDate(this.settings).split('-').map(Number);
          this.openOnThisDay(month, day);
        },
      }),

      openTimelineCommand: this.addCommand({
        id: 'open-journal-timeline',
        name: t(this.settings, 'openTimelineCommand'),
        callback: () => this.activateTimeline(),
      }),
      newDailyCommand: this.addCommand({
        id: 'new-daily-note',
        name: t(this.settings, 'newDailyCommand'),
        callback: () => this.createDailyNoteForToday(),
      }),
      recordMoodCommand: this.addCommand({
        id: 'record-current-mood',
        name: t(this.settings, 'recordMoodCommand'),
        callback: () => this.recordCurrentMood(),
      }),
      copyDiagnosticsCommand: this.addCommand({
        id: 'copy-mobile-diagnostics',
        name: t(this.settings, 'copyDiagnosticsCommand'),
        callback: () => this._copyMobileDiagnostics(),
      }),
    };

    // Settings tab
    this.addSettingTab(new DaylineSettingsTab(this.app, this));

    // Initialize EXIF tooltip element (shared across calendar & note-image hover)
    this._exifTooltipEl = null;
    this._exifHoverTimer = null;
    this._ensureExifTooltip();
    this._installExifDismissHandlers();

    // Restore view visibility after Obsidian has restored the workspace layout.
    this.app.workspace.onLayoutReady(async () => {
      if (!this._usesPhoneDaylineMode()) {
        await this.viewVisibilityController.restore();
      }
      this._syncDaylineRibbon();
      // Trigger initial overlay sync once the layout is stable
      this._syncAllOverlays();
      this._mobileQuickEntry?.sync();
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
        this._syncAllOverlays();
        this._mobileQuickEntry?.sync();
      })
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this._endExifHover();
        this._syncAllOverlays();
        this._syncDaylineRibbon();
        this._mobileQuickEntry?.sync();
      })
    );
    this.registerEvent(this.app.vault.on('create', (file) => this._handleJournalCreate(file)));
    this.registerEvent(this.app.vault.on('modify', (file) => this._handleVaultModify(file)));
    this.registerEvent(this.app.vault.on('delete', (file) => this._handleJournalDelete(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this._handleJournalRename(file, oldPath)));
    // `changed` is the only event that carries the parsed embed list, so the
    // insert-time EXIF sync hangs off it rather than off the raw vault events.
    this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => {
      void this._syncJournalEmbedExif(file, cache);
    }));
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
    window.clearTimeout(this._weatherSaveTimer);
    window.clearTimeout(this._weatherCleanupTimer);
    window.clearTimeout(this._geocoderSaveTimer);
    window.clearTimeout(this._exifHoverTimer);
    window.clearInterval(this._reminderTimer);
    this._removeExifDismissHandlers();
    this._endExifHover();
    // Synchronous teardown runs first. Obsidian does not await onunload, so a
    // slow or failing flush must never postpone (or skip) the DOM cleanup, and a
    // fast disable/enable must not let this instance's cleanup run after the
    // next instance has applied its own classes and overlays.
    this._removeAllOverlays();
    // J-08: the On This Day panel is a document-level overlay; it must not
    // outlive the plugin instance that opened it.
    closeOnThisDayModal?.();
    this._unbindCapabilityRefresh();
    this._mobileQuickEntry?.dispose();
    this._mobileQuickEntry = null;
    this._removeCapabilityClasses();
    this.mediaService?.dispose?.();
    this._exifTooltipEl?.remove();
    this._exifTooltipEl = null;
    document.getElementById('calendar-sidebar-styles')?.remove();
    // Cache and queue flushes are best effort: each rejection is isolated and
    // reported so one failed write cannot skip the others.
    const flushes = [
      () => this._flushWeatherCache(),
      () => this._flushGeocoderCache(),
      () => this._journalWriteQueue?.flush(),
      () => this.moodStore?.flush(),
      () => this.viewVisibilityController?.unload(),
    ];
    const results = await Promise.allSettled(flushes.map((flush) => Promise.resolve().then(flush)));
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[Dayline] Unload flush failed:', result.reason?.message || result.reason);
      }
    }
  }

  _persistViewVisibility(kind, visible) {
    const key = kind === 'calendar' ? 'showCalendarView' : 'showTimelineView';
    this.settings[key] = visible;
    return this.saveSettings();
  }

  /**
   * P-16: command names are captured by Obsidian at registration, so a language
   * change used to need a reload. Re-resolve them from the current settings.
   */
  _refreshCommandNames() {
    const commands = this._localizedCommands;
    if (!commands) return;
    for (const [key, command] of Object.entries(commands)) {
      if (command && typeof command === 'object') command.name = t(this.settings, key);
    }
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
    const open = this._usesPhoneDaylineMode()
      ? this._mobileDaylineViewTypes().some((viewType) => this.app.workspace.getLeavesOfType(viewType).length > 0)
      : this.viewVisibilityController.isAnyOpen();
    ribbon.classList.toggle('is-active', open);
  }

  _applyCapabilityClasses() {
    const root = typeof document !== 'undefined' ? document.body : null;
    root?.classList.toggle('dayline-coarse-pointer', Boolean(this.capabilities?.coarsePointer));
    root?.classList.toggle('dayline-mobile', Boolean(this.capabilities?.isMobile));
    // Mirror the same layout decision the routing uses, so CSS can never
    // disagree with which workspace path the plugin actually took.
    root?.classList.toggle('dayline-phone', this._usesPhoneDaylineMode());
    root?.classList.toggle('dayline-tablet', Boolean(this.capabilities?.isTabletLayout));
  }

  /**
   * Obsidian's phone interface gives a plugin a single leaf and no sidebar, so
   * Dayline swaps that tab between calendar and timeline. Tablets keep the
   * desktop workspace — ribbon, pin-able sidebars, stacked tabs — and must use
   * the sidebar placement path, or the calendar lands in a main tab and covers
   * the note the user was reading.
   */
  _usesPhoneDaylineMode() {
    return usesPhoneLayout(this.capabilities);
  }

  _recordMobileDiagnostic(name) {
    if (!Array.isArray(this._mobileDiagnosticEvents)) this._mobileDiagnosticEvents = [];
    this._mobileDiagnosticEvents.push({ name: String(name), at: new Date().toISOString() });
    if (this._mobileDiagnosticEvents.length > 20) this._mobileDiagnosticEvents.splice(0, this._mobileDiagnosticEvents.length - 20);
  }

  async _copyMobileDiagnostics() {
    const text = formatMobileDiagnostics(collectMobileDiagnostics(this));
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
        if (!document.body) throw new Error('document body is unavailable');
        const input = document.body.createEl('textarea', { cls: 'dayline-mobile-diagnostics-clipboard' });
        input.value = text;
        input.setAttribute('readonly', 'true');
        try {
          input.select();
          if (!document.execCommand('copy')) throw new Error('clipboard copy command failed');
        } finally {
          input.remove();
        }
      } else {
        throw new Error('clipboard is unavailable');
      }
      new Notice(t(this.settings, 'diagnosticsCopied'));
    } catch (error) {
      console.warn('[Dayline] Could not copy mobile diagnostics:', error?.message || error);
      new Notice(t(this.settings, 'diagnosticsCopyFailed'));
    }
  }

  _removeCapabilityClasses() {
    const root = typeof document !== 'undefined' ? document.body : null;
    root?.classList.remove('dayline-coarse-pointer', 'dayline-mobile', 'dayline-phone', 'dayline-tablet');
  }

  /**
   * Re-probe capabilities against the live viewport. Obsidian re-derives its
   * phone/tablet layout from a media query on resize and `css-change`, so a
   * rotated phone or a narrow iPad split must not keep the capabilities that
   * were detected at load (U-11). The existing object is mutated in place so
   * every service constructed with a reference to it stays current.
   */
  _refreshPlatformCapabilities() {
    const next = detectPlatformCapabilities({ Platform, app: this.app });
    if (this.capabilities && typeof this.capabilities === 'object') Object.assign(this.capabilities, next);
    else this.capabilities = next;
    this._applyCapabilityClasses();
    this._mobileQuickEntry?.sync();
    this._syncDaylineRibbon();
    return this.capabilities;
  }

  _bindCapabilityRefresh() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this._unbindCapabilityRefresh();
    this._capabilityRefreshHandler = () => this._refreshPlatformCapabilities();
    window.addEventListener('resize', this._capabilityRefreshHandler);
    window.addEventListener('css-change', this._capabilityRefreshHandler);
  }

  _unbindCapabilityRefresh() {
    const handler = this._capabilityRefreshHandler;
    if (!handler || typeof window === 'undefined') return;
    window.removeEventListener('resize', handler);
    window.removeEventListener('css-change', handler);
    this._capabilityRefreshHandler = null;
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
    const configDir = String(this.app.vault?.configDir || '').replace(/[\\/]+$/, '');
    // An empty config directory would build `undefined/plugins/...` style paths.
    if (!configDir) return;
    const dataPath = (pluginId) => `${configDir}/plugins/${pluginId}/data.json`;
    // A manual install can live in a folder whose name differs from the plugin
    // id (for example `dayline-main`), so the current data file is resolved from
    // the running manifest instead of an assumed folder name.
    const manifestDir = String(this.manifest?.dir || '').replace(/[\\/]+$/, '');
    const currentPath = manifestDir ? normalizePath(`${manifestDir}/data.json`) : dataPath(PLUGIN_ID);
    try {
      if (await adapter.exists(currentPath)) return;
      for (const legacyId of LEGACY_PLUGIN_IDS) {
        const legacyPath = dataPath(legacyId);
        if (!(await adapter.exists(legacyPath))) continue;
        await adapter.write(currentPath, await adapter.read(legacyPath));
        // `debug` is one of the console methods the plugin guidelines allow;
        // `info` is treated as unnecessary logging during review.
        console.debug(`[Dayline] Migrated ${legacyId} settings and weather cache.`);
        return;
      }
    } catch (error) {
      console.warn('[Dayline] Legacy data migration failed:', error);
    }
  }

  async activateTimeline() {
    if (this._usesPhoneDaylineMode()) return this._activateMobileMode('timeline');
    const opened = await this.viewVisibilityController.open('timeline');
    this._syncDaylineRibbon();
    return opened;
  }

  /**
   * Wait for Obsidian to finish restoring the layout and resolving metadata
   * before the first index build. A vault mutation may invalidate the first
   * rebuild: ensureReady() retries until a complete rebuild has committed, while
   * refresh() intentionally resolves after an invalidated attempt.
   */
  _startJournalIndexAfterMetadataResolved() {
    const startup = waitForJournalIndexStartup(this.app).then(() => (
      this.journalIndex?.ensureReady
        ? this.journalIndex.ensureReady(this.settings)
        : this.journalIndex?.refresh?.(this.settings)
    ));
    startup.catch((error) => {
      console.warn('[Dayline] Initial journal index refresh failed:', error?.message || error);
    });
    return startup;
  }

  async ensureJournalIndexReady() {
    // Mobile skips the eager desktop start and builds lazily, but its first
    // build must still await `resolved` for the same reason (J-13).
    if (!this._desktopJournalIndexStartup) {
      this._desktopJournalIndexStartup = this._startJournalIndexAfterMetadataResolved();
    }
    return this._desktopJournalIndexStartup;
  }

  _mobileDaylineViewTypes() {
    return [...DAYLINE_VIEW_TYPES];
  }

  _mobileDaylineViewType(mode) {
    return getMobileDaylineViewType(mode, VIEW_TYPE, JOURNAL_TIMELINE_VIEW);
  }

  _getMobileDaylineLeaf() {
    return getMobileDaylineLeaf(this.app.workspace, this._mobileDaylineViewTypes());
  }

  _getMobileLastLeaf() {
    const lastViewType = this._mobileDaylineLastViewType();
    const preferred = getPreferredDaylineLeaf(this.app.workspace, lastViewType);
    if (preferred) return preferred;
    const workspace = this.app.workspace;
    const activeLeaf = workspace?.activeLeaf;
    if (activeLeaf && this._mobileDaylineViewTypes().includes(activeLeaf?.view?.getViewType?.())) return activeLeaf;
    return null;
  }

  _mobileDaylineLastViewType() {
    if (typeof this._mobileDaylineLastViewTypeValue === 'string') return this._mobileDaylineLastViewTypeValue;
    return null;
  }

  _getMobileJournalLeaf() {
    const leaf = this._mobileJournalLeaf;
    if (!leaf) return null;
    // A remembered leaf can outlive a tab the user closed; opening a note into
    // it would lose the note silently.
    if (isJournalHostLeaf(leaf) && isAttachedWorkspaceLeaf(this.app.workspace, leaf) && isMainAreaLeaf(this.app.workspace, leaf)) {
      return leaf;
    }
    this._mobileJournalLeaf = null;
    return null;
  }

  _getMobileTimelineFilter() {
    return { ...(this._mobileTimelineFilter || {}) };
  }

  _setMobileTimelineFilter(filter) {
    this._mobileTimelineFilter = filter && typeof filter === 'object' ? { ...filter } : {};
  }

  _getMobileDaylineModeController() {
    if (!this._mobileDaylineModeController) {
      this._mobileDaylineModeController = createSerialMobileDaylineModeController({
        getLeaf: () => this._getMobileDaylineLeaf(),
        getViewType: (mode) => this._mobileDaylineViewType(mode),
        revealLeaf: (leaf) => this.app.workspace.revealLeaf?.(leaf),
        onApplied: ({ mode, viewType }) => {
          this._mobileDaylineLastMode = mode;
          this._mobileDaylineLastViewTypeValue = viewType;
          this._syncDaylineRibbon();
        },
      });
    }
    return this._mobileDaylineModeController;
  }

  _openDaylineDrawerLeaf(preferredLeaf = null) {
    const workspace = this.app.workspace;
    if (preferredLeaf) return preferredLeaf;
    const lastLeaf = this._getMobileLastLeaf();
    if (lastLeaf) return lastLeaf;
    try {
      const rightLeaf = workspace?.getRightLeaf?.(false);
      if (rightLeaf) return rightLeaf;
    } catch {
      // Older mobile hosts may not expose drawer routing; fall through.
    }
    return this._getMobileDaylineLeaf();
  }

  _requestMobileDaylineMode(mode, preferredLeaf = null, afterApply = null) {
    return this._getMobileDaylineModeController().request(mode, preferredLeaf, afterApply || undefined);
  }

  async _redirectLegacyMobileDaylineLeaf(leaf) {
    if (!leaf) return false;
    const opened = await this._openMobileDayline(this._mobileDaylineLastMode || 'calendar', leaf);
    if (!opened) return false;
    this._recordMobileDiagnostic('legacy-mobile-view-redirect');
    return true;
  }

  async _activateMobileMode(mode, afterApply = null) {
    const normalized = normalizeDaylineMobileMode(mode);
    this._recordMobileDiagnostic(`mode-request:${normalized}`);
    return this._openMobileDayline(normalized, null, afterApply);
  }

  async _openMobileDayline(mode = 'calendar', preferredLeaf = null, afterApply = null) {
    if (!this.capabilities?.isMobile) return false;
    try {
      // Dayline opens in the right drawer, so a note opened from a date can
      // take over the main area and keep the tab count at one. Prefer the
      // last Dayline leaf before falling back to a fresh right drawer leaf.
      const leaf = this._openDaylineDrawerLeaf(preferredLeaf);
      await this._requestMobileDaylineMode(mode, leaf, afterApply);
      return true;
    } catch (error) {
      this._recordMobileDiagnostic('mobile-view-open-failed');
      console.warn('[Dayline] Failed to open mobile Dayline:', error?.message || error);
      new Notice(t(this.settings, 'openNoteFailed', { error: error?.message || error }));
      return false;
    }
  }

  async openTimelineForDate(date) {
    if (this._usesPhoneDaylineMode()) {
      this._setMobileTimelineFilter({ from: date, to: date });
      await this._activateMobileMode('timeline', ({ leaf }) => leaf?.view?.setDateFilter?.(date));
      return;
    }
    const opened = await this.activateTimeline();
    if (!opened) return;
    this.app.workspace.getLeavesOfType(JOURNAL_TIMELINE_VIEW)[0]?.view?.setDateFilter?.(date);
  }

  async openJournalFile(file) {
    const workspace = this.app.workspace;
    const phoneMode = this._usesPhoneDaylineMode();
    // Only the phone interface lacks tabs to reuse, so only there may this
    // create one. Tablets and desktop share the active or first Markdown leaf.
    // On phones Dayline lives in a right drawer, so the note must take a
    // main-area leaf (an empty tab, or the leaf a previous note occupied) and
    // never the Dayline drawer leaf, or the calendar would be replaced and a
    // fresh drawer leaf would pile up on every later open.
    const journalLeaf = phoneMode ? this._getMobileJournalLeaf() : null;
    const leaf = phoneMode
      ? resolveMobileJournalLeaf(workspace, journalLeaf)
      : getJournalOpenLeaf(workspace, false);
    if (!leaf) throw new Error('No markdown leaf is available');
    // Only main-area leaves may be remembered as the phone journal leaf.
    if (phoneMode && !journalLeaf && isMainAreaLeaf(workspace, leaf)) this._mobileJournalLeaf = leaf;
    await leaf.openFile(file);
    await workspace.revealLeaf?.(leaf);
    workspace.setActiveLeaf?.(leaf, { focus: true });
    return leaf;
  }

  async _openTimelineView() {
    if (this._usesPhoneDaylineMode()) {
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
    const path = joinVaultPath(this.settings.dailyFolder, `${date}.md`);
    try {
      const file = await this.createDailyNoteForDate(date);
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
      && sources.some((source) => isPathInFolder(activeFile.path, source.path));
    const path = activeIsJournal
      ? activeFile.path
      : joinVaultPath(this.settings.dailyFolder, `${_daylineDate(this.settings)}.md`);
    void this.openMoodPicker(path, { allowDateSelection: true, ensureFile: false });
  }

  async saveJournalTitle(path, title) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Journal file not found: ${path}`);
    const sources = this.journalIndex.resolveSources(this.settings);
    const isJournal = sources.some((source) => isPathInFolder(path, source.path));
    if (!isJournal) throw new Error(`Not a journal file: ${path}`);

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const value = String(title || '').trim();
      if (value) frontmatter.title = value;
      else delete frontmatter.title;
    });
    // P-17: the journal index subscription redraws the calendar and timeline
    // for this change; rendering the views again here doubled the work.
    await this.journalIndex.refreshFile(file.path, this.settings);
  }

  /**
   * Ensure the file behind a mood edit exists. A journal path that is exactly
   * the configured daily note must go through createDailyNoteForDate: creating
   * it empty here would bypass the Daily Notes template and Templater, and the
   * blank file would later be opened as "today's note" (P-07).
   */
  async _ensureMoodJournalFile(path) {
    const date = this._dailyNoteDateForPath(path);
    if (date) return this.createDailyNoteForDate(date);
    return this.ensureJournalFile(path, '');
  }

  /** The date when `path` is exactly the configured daily note for that date. */
  _dailyNoteDateForPath(path) {
    const folder = normalizeVaultPath(this.settings?.dailyFolder || '');
    const name = String(path || '').split('/').pop()?.replace(/\.md$/i, '') || '';
    if (!folder || !/^\d{4}-\d{2}-\d{2}$/.test(name)) return null;
    return normalizeVaultPath(path) === joinVaultPath(folder, `${name}.md`) ? name : null;
  }

  /** M-01: a future `schemaVersion` puts the store in read-only mode. */
  _moodStoreIsReadOnly() {
    return this.moodStore?.readOnly === true;
  }

  /**
   * Tell the user why mood editing is unavailable instead of letting every
   * write fail with an unhandled rejection. Returns true when the caller must
   * stop.
   */
  _warnIfMoodStoreReadOnly() {
    if (!this._moodStoreIsReadOnly()) return false;
    new Notice(t(this.settings, 'moodMetadataReadOnly'));
    return true;
  }

  async openMoodPicker(path, options = {}) {
    if (this._warnIfMoodStoreReadOnly()) return;
    if (path && options.ensureFile !== false) await this._ensureMoodJournalFile(path);
    const entry = this.journalIndex.getEntries().find((item) => item.path === path);
    new MoodPickerModal(this.app, {
      filePath: path,
      initial: this.moodStore.get(path) || entry?.mood,
      customLabels: this.moodStore.getCustomLabels(),
      settings: this.settings,
      allowDateSelection: options.allowDateSelection === true,
      onDateChange: async (date) => {
        const nextPath = joinVaultPath(this.settings.dailyFolder, `${date}.md`);
        const nextEntry = this.journalIndex.getEntries().find((item) => item.path === nextPath);
        return {
          filePath: nextPath,
          initial: this.moodStore.get(nextPath) || nextEntry?.mood,
          customLabels: this.moodStore.getCustomLabels(),
        };
      },
      onSave: async ({ filePath, score, labels, note }) => {
        const targetPath = filePath || path;
        await this._ensureMoodJournalFile(targetPath);
        await this.moodStore.set(targetPath, score, labels, this.settings, note);
        // P-17: the journal index subscription owns the redraw; forcing one
        // here rendered the calendar a second time for the same edit.
        await this.journalIndex.refreshFile(targetPath, this.settings);
        new Notice(`${t(this.settings, 'moodSaved')}: ${targetPath}`);
      },
    }).open();
  }

  openMoodRecovery() {
    if (this._warnIfMoodStoreReadOnly()) return;
    new MoodRecoveryModal(this.app, {
      store: this.moodStore,
      settings: this.settings,
      onChanged: async () => {
        await this.journalIndex.refresh(this.settings);
      },
    }).open();
  }

  async deleteMoodRecord(path) {
    if (this._warnIfMoodStoreReadOnly()) return false;
    const label = t(this.settings, 'deleteMoodConfirm');
    if (typeof window !== 'undefined' && !window.confirm(`${label}\n${path}`)) return false;
    try {
      const visibleMood = this.journalIndex.getEntries().find((entry) => entry.path === path)?.mood;
      const deleted = await this.moodStore.deleteRecord(path, true, visibleMood);
      if (!deleted) return false;
      await this.journalIndex.refresh(this.settings);
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
  }

  _maybeRemind() {
    if (!this.settings.reminderEnabled) return;
    const now = new Date();
    const date = _daylineDate(this.settings, now);
    // The interval is throttled in the background, so it can land well after the
    // configured minute. A per-day marker fires once and never twice.
    if (this._lastReminderDate === date) return;
    const clock = getClockPartsInTimeZone(now, this.settings.weatherTimezone || 'auto');
    const reminderHour = Number(this.settings.reminderHour ?? 21);
    if (!(clock.hour >= reminderHour)) return;
    if (this._hasJournalEntryForDate(date)) return;
    this._lastReminderDate = date;
    new Notice(t(this.settings, 'dailyReminder'));
  }

  /**
   * Whether the day's journal already exists. The phone index is built lazily,
   * so an empty entry list only means it is not ready yet; fall back to the vault
   * so a note the user did write is never reported as missing (P-06).
   */
  _hasJournalEntryForDate(date) {
    if (this.journalIndex?.isReady && typeof this.journalIndex.getEntries === 'function') {
      return this.journalIndex.getEntries().some((entry) => entry.date === date);
    }
    const path = joinVaultPath(this.settings.dailyFolder, `${date}.md`);
    return Boolean(this.app?.vault?.getAbstractFileByPath?.(path));
  }

  /**
   * Create the configured daily note for `dateStr`.
   *
   * Two callers can ask for the same date in the same tick (a mood save plus
   * the click that opened the cell, for example). The check-then-create below
   * used to make the loser throw "File already exists", so the in-flight
   * creation is cached per path (P-13).
   */
  async createDailyNoteForDate(dateStr) {
    const folder = normalizeVaultPath(this.settings.dailyFolder);
    const path = joinVaultPath(folder, `${dateStr}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;

    if (!this._dailyNoteCreations) this._dailyNoteCreations = new Map();
    const inFlight = this._dailyNoteCreations.get(path);
    if (inFlight) return inFlight;

    const creation = this._createDailyNoteFile(folder, path, dateStr);
    // Registered synchronously, before the first await inside creation, so a
    // second caller in the same tick resolves to the same promise.
    this._dailyNoteCreations.set(path, creation);
    try {
      return await creation;
    } finally {
      if (this._dailyNoteCreations.get(path) === creation) this._dailyNoteCreations.delete(path);
    }
  }

  async _createDailyNoteFile(folder, path, dateStr) {
    await this.ensureFolder(folder);
    const dnPlugin = this.app.internalPlugins?.getPluginById?.('daily-notes');
    const templatePath = dnPlugin?.instance?.options?.template;
    if (templatePath) {
      const templateFile = this.app.vault.getAbstractFileByPath(String(templatePath).replace(/\.md$/, '') + '.md');
      if (templateFile instanceof TFile) {
        const tp = this.app.plugins?.getPlugin?.('templater-obsidian')?.templater;
        if (tp?.create_new_note_from_template) {
          await tp.create_new_note_from_template(templateFile, folder, dateStr, false);
          const created = this.app.vault.getAbstractFileByPath(path);
          if (created instanceof TFile) return created;
        }
        const content = await this.app.vault.read(templateFile);
        return this._createVaultFile(path, _resolveDailyNoteTemplate(content, dateStr));
      }
    }
    return this._createVaultFile(path, '');
  }

  /**
   * The file may have been created by another plugin while this call was in
   * flight; re-query instead of surfacing its "already exists" error.
   */
  async _createVaultFile(path, content) {
    try {
      return await this.app.vault.create(path, content);
    } catch (error) {
      const created = this.app.vault.getAbstractFileByPath(path);
      if (created instanceof TFile) return created;
      throw error;
    }
  }

  async ensureFolder(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (!normalized || this.app.vault.getAbstractFileByPath(normalized)) return;
    const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    if (parent) await this.ensureFolder(parent);
    try { await this.app.vault.createFolder(normalized); } catch { /* folder may have been created concurrently */ }
  }

  async ensureJournalFile(path, content) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    // A file at the vault root has no parent folder to create. Deriving it from
    // lastIndexOf would also mangle a root-level name into a bogus folder.
    await this.ensureFolder(parentVaultPath(path));
    return this.app.vault.create(path, content);
  }

  /** Route a vault modify to the mood metadata store or the journal index. */
  _handleVaultModify(file) {
    if (this._isMoodMetadataFile(file)) {
      this._reloadMoodMetadataFromDisk();
      return;
    }
    this._handleJournalCreateOrModify(file);
  }

  _moodMetadataPath() {
    const path = this.settings?.moodMetadataPath;
    return typeof path === 'string' && path.length > 0 ? normalizeVaultPath(path) : '';
  }

  _isMoodMetadataFile(file) {
    const target = this._moodMetadataPath();
    if (!target || !file?.path) return false;
    return normalizeVaultPath(file.path) === target;
  }

  /**
   * Another device (or Obsidian Sync) rewrote the mood metadata JSON, so the
   * in-memory store is stale. The store owns the reload entry point; call it
   * defensively because older store builds may not expose it.
   */
  _reloadMoodMetadataFromDisk() {
    const store = this.moodStore;
    if (!store || typeof store.reloadFromDisk !== 'function') return;
    Promise.resolve(store.reloadFromDisk())
      .then(() => this.refreshJournalViews())
      .catch((error) => console.warn('[Dayline] Mood metadata reload failed:', error?.message || error));
  }

  /**
   * Shared vault-event fan-out. The journal index refresh for Markdown is owned
   * by the `metadataCache.changed` subscription: doing it here as well rebuilt
   * every entry twice per save (P-17).
   */
  _handleJournalCreateOrModify(file) {
    this._notifyCalendarImageChange(file);
  }

  /**
   * A note recreated at a path that was renamed or deleted used to keep its
   * delete tombstone, which permanently hid a frontmatter mood on the new note
   * (M-05). Only a create may clear it: the tombstone is stale exactly when it
   * predates the new file's creation time.
   */
  _handleJournalCreate(file) {
    this._handleJournalCreateOrModify(file);
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    const path = file.path;
    const ctime = file.stat?.ctime;
    // A sync engine that replaces a note emits delete then create: the delete
    // moved the mood to the recovery list, so the create puts it back instead
    // of hiding it until the user restores it by hand.
    Promise.resolve(this.moodStore?.clearStaleTombstone?.(path, ctime))
      .then((cleared) => Promise.resolve(this.moodStore?.autoRecoverOrphan?.(path, ctime)).then((recovered) => recovered || cleared))
      .then((changed) => {
        // The mood only becomes visible after the store changed, which is later
        // than the `changed` redraw that indexed the empty note.
        if (changed) return this.journalIndex.refreshFile(path, this.settings);
        return undefined;
      })
      .catch((error) => console.warn('[Dayline] Mood recovery after note create failed:', error?.message || error));
  }

  _handleJournalDelete(file) {
    this._notifyCalendarImageChange(file);
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this._queueJournalWrite(
      'move deleted mood to orphan',
      () => this.moodStore.removeToOrphan(file.path),
      (detail) => t(this.settings, 'moodMoveToOrphanFailed', { error: detail }),
    );
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
      new Notice(t(this.settings, 'moodMetadataRenameFailed', { error: error?.message || error }));
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
  }

  _invalidateMediaCaches(path) {
    if (!path) return;
    this.exifCache?.invalidate(path);
    this.heicCache?.invalidate(path);
    this.mediaService?.invalidate(path);
  }

  _queueJournalWrite(label, task, formatNotice) {
    return this._journalWriteQueue.add(task).catch((error) => {
      console.warn(`[Dayline] ${label} failed:`, error?.message || error);
      const detail = error?.message || error;
      new Notice(formatNotice ? formatNotice(detail) : `${label}: ${detail}`);
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
    if (!provider) {
      // P-16: the command used to do nothing at all when no calendar view was
      // open, which read as a broken command rather than a missing view.
      new Notice(t(this.settings, 'calendarViewRequired'));
      return;
    }
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
    const tip = createDiv();
    tip.className = 'cal-exif-tooltip';
    document.body.appendChild(tip);
    this._exifTooltipEl = tip;
  }

  _showExifTooltip(anchorEl, fields, loading, kind = 'image') {
    const tip = this._exifTooltipEl;
    if (!tip || !anchorEl?.isConnected) return;
    // U-08: `t()` resolves a `'system'` language live, so the `_l` locale table
    // must be resolved the same way or the interface mixes languages.
    const lang = getDisplayLanguage(this.settings);
    tip.replaceChildren();

    const addText = (tag, className, value) => {
      const el = createEl(tag);
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
    window.clearTimeout(this._exifHoverTimer);
    this._hideExifTooltip();
    return ++this._exifHoverToken;
  }

  _isCurrentExifHover(token) {
    return token === this._exifHoverToken;
  }

  _endExifHover() {
    window.clearTimeout(this._exifHoverTimer);
    this._exifHoverToken++;
    this._exifTouchAnchor = null;
    this._hideExifTooltip();
  }

  /* ----- Insert-time EXIF/GPS persistence ----- */

  /**
   * Sync the EXIF record for every image embedded in a journal note. This is an
   * insert-time feature: a record is written only when the image has no record
   * yet, or when the version (mtime+size) recorded for it no longer matches the
   * file. A current record is never rewritten — that is exactly what keeps the
   * frontmatter write below from re-triggering `changed` and looping (P-10).
   */
  _syncJournalEmbedExif(file, cache = null) {
    if (this.settings?.exifPersistMetadata !== true) return Promise.resolve();
    if (!(file instanceof TFile) || file.extension !== 'md') return Promise.resolve();
    const path = file.path;
    if (!this._exifPersistInFlight) this._exifPersistInFlight = new Map();
    if (!this._exifPersistPending) this._exifPersistPending = new Set();
    if (this._exifPersistInFlight.has(path)) {
      // Coalesce per note: a second event while a sync is in flight must not
      // start a parallel write. It is re-checked once the current run settles,
      // and that rerun writes nothing when every embed is already current.
      this._exifPersistPending.add(path);
      return this._exifPersistInFlight.get(path);
    }
    const sources = this.journalIndex?.resolveSources?.(this.settings) || [];
    if (!sources.length || !sources.some((source) => isPathInFolder(path, source.path))) return Promise.resolve();

    const run = this._runJournalEmbedExifSync(file, cache)
      .catch((error) => {
        console.warn('[Dayline] EXIF insert-time sync failed:', path, error?.message || error);
      })
      .then(() => {
        if (this._exifPersistInFlight.get(path) === run) this._exifPersistInFlight.delete(path);
        if (this._exifPersistPending.delete(path)) void this._syncJournalEmbedExif(file, null);
      });
    this._exifPersistInFlight.set(path, run);
    return run;
  }

  async _runJournalEmbedExifSync(file, cache) {
    const fileCache = cache || this.app.metadataCache.getFileCache(file);
    const embeds = Array.isArray(fileCache?.embeds) ? fileCache.embeds : [];
    for (const embed of embeds) {
      const link = embed?.link;
      if (!link) continue;
      const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
      if (!(target instanceof TFile)) continue;
      const extension = String(target.extension || '').toLowerCase();
      if (!MEDIA_IMAGE_EXTENSIONS.includes(extension)) continue;
      await this._getPersistedExifFields(target, file.path, link);
    }
  }

  /** `{ mtime, size }` for a media file, or null when the adapter cannot stat it. */
  async _statMediaVersion(file) {
    const statPromise = this.app.vault?.adapter?.stat?.(file.path);
    const stat = statPromise ? await statPromise.catch(() => null) : null;
    return stat ? { mtime: Number(stat.mtime) || 0, size: Number(stat.size) || 0 } : null;
  }

  /**
   * A persisted record is current while its stored version still matches the
   * file on disk. Without a readable stat nothing can be proven changed, so the
   * record is left alone rather than rewritten forever.
   */
  _exifRecordIsCurrent(record, version) {
    if (!version) return true;
    return Number(record?.mtime) === version.mtime && Number(record?.size) === version.size;
  }

  /**
   * Resolve the stored place name for a GPS pair and append it as its own
   * `exif_place` field. The `exif_gps` value is a coordinate string that used to
   * be a shared array from metadataCache/exifCache, so it is never overwritten
   * with a place name (W-02); only the caller's private copy is touched.
   */
  async _addExifPlace(fields) {
    if (!this.settings.exifReverseGeocode || !this.geocoder) return;
    const gps = fields.find((field) => field.key === 'exif_gps')?.value;
    if (!gps) return;
    const [latitude, longitude] = String(gps).split(',').map((value) => Number.parseFloat(value.trim()));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const place = await Promise.resolve(this.geocoder.lookup(latitude, longitude)).catch(() => null);
    if (!place) return;
    const existing = fields.find((field) => field.key === 'exif_place');
    if (existing) existing.value = place;
    else fields.push({ key: 'exif_place', value: place });
  }

  /**
   * EXIF fields for one embedded image, always as private copies. A record that
   * is still current is returned as a copy; otherwise the EXIF is read and the
   * record plus top-level `latitude`/`longitude` are persisted.
   */
  async _getPersistedExifFields(file, notePath, imageLink, options = {}) {
    const note = this.app.vault.getAbstractFileByPath(notePath);
    const normalizedLink = normalizeMediaLink(imageLink);
    const frontmatter = note instanceof TFile
      ? this.app.metadataCache.getFileCache(note)?.frontmatter
      : null;
    const records = Array.isArray(frontmatter?._dayline_media_metadata)
      ? frontmatter._dayline_media_metadata
      : [];
    const cached = records.find((record) => record
      && (record.normalizedLink === normalizedLink || record.link === imageLink));
    const version = await this._statMediaVersion(file);
    if (Array.isArray(cached?.fields) && this._exifRecordIsCurrent(cached, version)) {
      return cached.fields.map((field) => ({ ...field }));
    }
    const read = await this.exifCache.get(file);
    if (!Array.isArray(read) || read.length === 0) return [];
    const fields = read.map((field) => ({ ...field }));
    if (options.reverseGeocode !== false) await this._addExifPlace(fields);
    if (note instanceof TFile && options.persist !== false) {
      // W-14: the write is awaited and its rejection handled here — no call site
      // may fire-and-forget it with a bare `void`.
      try {
        await this._persistExifFields(note, normalizedLink, fields, version);
      } catch (error) {
        console.warn('[Dayline] EXIF frontmatter persist failed:', note.path, error?.message || error);
      }
    }
    return fields;
  }

  async _persistExifFields(note, normalizedLink, fields, version = null) {
    if (!(note instanceof TFile) || !Array.isArray(fields) || fields.length === 0) return;
    // Only ever write copies: the caller's array may still alias the
    // metadataCache frontmatter object or the shared exifCache entry.
    const storedFields = fields.map((field) => ({ ...field }));
    await this.app.fileManager.processFrontMatter(note, (frontmatter) => {
      const records = Array.isArray(frontmatter._dayline_media_metadata)
        ? frontmatter._dayline_media_metadata.filter((record) => record?.normalizedLink !== normalizedLink)
        : [];
      const record = { normalizedLink, fields: storedFields };
      if (version) { record.mtime = version.mtime; record.size = version.size; }
      frontmatter._dayline_media_metadata = [...records, record];
      const gps = storedFields.find((field) => field.key === 'exif_gps')?.value;
      if (gps && frontmatter.latitude == null && frontmatter.longitude == null) {
        const [latitude, longitude] = String(gps).split(',').map((value) => Number.parseFloat(value.trim()));
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          frontmatter.latitude = latitude;
          frontmatter.longitude = longitude;
        }
      }
    });
  }

  async loadSettings() {
    const raw = await this.loadData();
    // U-07: a fresh install follows the system language instead of showing
    // Chinese to an English-system user. Anyone with persisted settings keeps
    // the value they stored.
    const hasPersistedSettings = Boolean(raw) && typeof raw === 'object' && Object.keys(raw).length > 0;
    const data = raw || {};
    // Extract weather cache separately so it doesn't get overwritten by saveSettings
    this.weatherCache = data.weatherCache || {};
    this.geocoderCache = data.geocoderCache && typeof data.geocoderCache === 'object' ? data.geocoderCache : {};
    // Delete stale cache entries to prevent data.json bloat
    this._cleanupWeatherCache();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data, normalizeViewVisibilitySettings(data));
    const legacyWeatherVisible = data.showCalendarWeather !== false;
    if (data.showCalendarWeatherCard === undefined) this.settings.showCalendarWeatherCard = legacyWeatherVisible;
    if (data.showCalendarWeatherBadge === undefined) this.settings.showCalendarWeatherBadge = legacyWeatherVisible;
    this.settings.displayLanguage = hasPersistedSettings ? normalizeDisplayLanguageSetting(data) : 'system';
    this.settings.weatherLanguage = getDisplayLanguage({
      displayLanguage: this.settings.displayLanguage,
      weatherLanguage: data.weatherLanguage,
    });
    this.settings.calendarMoodMarker = calendarMoodMarker(this.settings);
    this.settings.onThisDayEntry = normalizeOnThisDayEntryMode(this.settings);
    this.settings.onThisDayButton = this.settings.onThisDayEntry !== 'off';
    delete this.settings.weatherCache; // settings object shouldn't carry the cache
    delete this.settings.geocoderCache;
  }

  async saveSettings() {
    const settings = { ...this.settings };
    settings.weatherLanguage = getDisplayLanguage(settings);
    settings.onThisDayEntry = normalizeOnThisDayEntryMode(settings);
    settings.onThisDayButton = settings.onThisDayEntry !== 'off';
    settings.showCalendarWeather = settings.showCalendarWeatherCard !== false || settings.showCalendarWeatherBadge !== false;
    settings.showCalendarView = settings.showCalendarView !== false;
    settings.showTimelineView = settings.showTimelineView === true;
    this.moodStore?.configure(settings);
    // P-16: a display-language change must be reflected in the command palette
    // without restarting Obsidian. Done before the write so a save failure
    // cannot leave the names stale.
    this._refreshCommandNames();
    await this._enqueueDataWrite((data) => {
      Object.assign(data, settings);
      // Merge by key: another device may have written cache entries through
      // Obsidian Sync since this instance loaded its copy.
      data.weatherCache = _mergeCacheByKey(data.weatherCache, this.weatherCache);
      data.geocoderCache = _mergeCacheByKey(data.geocoderCache, this.geocoderCache);
    });
  }

  /**
   * Obsidian Sync (or another device) can rewrite data.json while this instance
   * is idle. Re-read it before the next save, or this instance's in-memory
   * settings and caches would overwrite the synced values.
   */
  async onExternalSettingsChange() {
    try {
      await this.loadSettings();
      this.moodStore?.configure?.(this.settings);
      this.refreshJournalViews();
      this._refreshCommandNames();
      this._syncDaylineRibbon();
    } catch (error) {
      console.warn('[Dayline] External settings reload failed:', error?.message || error);
    }
  }

  /** Save weather cache without touching settings. Debounced to avoid excessive writes. */
  _saveWeatherCache() {
    if (this._weatherSaveTimer) window.clearTimeout(this._weatherSaveTimer);
    this._weatherSaveTimer = window.setTimeout(() => {
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
      window.clearTimeout(this._weatherSaveTimer);
      this._weatherSaveTimer = null;
    }
    return this._enqueueDataWrite((data) => {
      data.weatherCache = _mergeCacheByKey(data.weatherCache, this.weatherCache);
    });
  }

  /** Save reverse-geocoder cache without touching settings. */
  _saveGeocoderCache() {
    if (this._geocoderSaveTimer) window.clearTimeout(this._geocoderSaveTimer);
    this._geocoderSaveTimer = window.setTimeout(() => {
      this._geocoderSaveTimer = null;
      this._flushGeocoderCache().catch((err) => {
        console.warn('[Dayline] Geocoder cache save failed:', err.message);
      });
    }, 500);
  }

  _flushGeocoderCache() {
    if (this._geocoderSaveTimer) {
      window.clearTimeout(this._geocoderSaveTimer);
      this._geocoderSaveTimer = null;
    }
    return this._enqueueDataWrite((data) => {
      data.geocoderCache = _mergeCacheByKey(data.geocoderCache, this.geocoderCache);
    });
  }

  /**
   * Bound the weather cache by entry count. Weather is no longer written to
   * frontmatter, so this cache is the only copy of backfilled history; the old
   * 90-day `fetchedAt` sweep deleted it permanently (W-04).
   */
  _cleanupWeatherCache() {
    if (!this.weatherCache) return;
    const removed = pruneWeatherCache(this.weatherCache, { maxEntries: WEATHER_CACHE_MAX_ENTRIES });
    if (removed > 0) {
      // Schedule cleanup persist (no urgency)
      window.clearTimeout(this._weatherCleanupTimer);
      this._weatherCleanupTimer = window.setTimeout(() => {
        this._weatherCleanupTimer = null;
        this._saveWeatherCache();
      }, 5000);
    }
  }


  /**
   * Refresh weather for the active date. The command has no view when the
   * calendar is closed, which used to make it fail silently (P-16).
   */
  async refreshActiveWeather() {
    const calendar = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (!calendar) {
      new Notice(t(this.settings, 'calendarViewRequired'));
      return;
    }
    try {
      await calendar.refreshWeather();
    } catch (error) {
      console.warn('[Dayline] Refresh weather failed:', error?.message || error);
    }
  }

  async activateView() {
    if (this._usesPhoneDaylineMode()) return this._activateMobileMode('calendar');
    const opened = await this.viewVisibilityController.open('calendar');
    this._syncDaylineRibbon();
    return opened;
  }

  async _openCalendarView() {
    const { workspace } = this.app;

    if (this._usesPhoneDaylineMode()) {
      await this._openMobileDayline('calendar');
      return;
    }

    // Create a vertical-split leaf in the left sidebar.
    let leaf = workspace.getLeftLeaf(true);
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
    }
    if (!leaf) {
      new Notice(t(this.settings, 'calendarLeafCreateFailed'));
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
    } catch {
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
    // P-17: coalesced repaint. A burst of triggers (a date click plus the
    // active-leaf-change it causes) must rebuild the grid once.
    this._renderScheduled = false;
    this._renderFrame = null;
    this._renderTimer = null;
    // P-20: repaint at midnight so the "today" highlight moves on its own.
    this._midnightTimer = null;
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
    this._overlayDates = new WeakMap();
    // Per-leaf version counter to discard stale async mounts
    this._overlayVersions = new WeakMap();
    this._overlayGeneration = 0;
    // Track containers where we set position:relative so we can revert on unload
    this._hostPositionMarkers = new Set();
    // Containers whose shared overlays are claimed by this view
    this._overlayContainers = new Set();
    // EXIF metadata cache (shared with plugin)
    this.exifCache = plugin.exifCache;
    // Unified media metadata and cover cache (shared across calendar/timeline).
    this.mediaService = plugin.mediaService;
    // Track processed note-image elements (cleared when view is destroyed)
    this._exifNoteMediaControls = new WeakSet();
    // element → disposers. A Map (not a Set) so Live Preview rebuilds can
    // release the entry for a detached node instead of accumulating closures
    // that pin the node until the view closes (P-12).
    this._exifNoteDisposers = new Map();
    // On This Day provider
    this._otdProvider = new OnThisDayProvider(plugin);
    // Set<"MM-DD"> of past-year memories, for the header button's badge
    this._otdDotCache = null;
    this._otdStripToken = 0;
    // Month-jump state is intentionally view-local.
    this._calendarJumpOpen = false;
    this._calendarKeydownHandler = null;
    this.closed = false;
    this.journalIndexError = null;
    this._hasOpened = false;
  }

  getViewType()   { return VIEW_TYPE; }
  getDisplayText(){ return t(this.plugin.settings, 'calendarTitle'); }
  getIcon()       { return 'calendar'; }

  _renderMobileModeControls(root) {
    if (!usesPhoneLayout(this.plugin.capabilities)) return;
    renderMobileDaylineModeControls(root, {
      activeMode: 'calendar',
      labels: {
        calendar: t(this.plugin.settings, 'calendarTitle'),
        timeline: t(this.plugin.settings, 'timelineTitle'),
      },
      groupLabel: t(this.plugin.settings, 'daylineViewGroupLabel'),
      onSelect: (mode) => mode === 'timeline'
        ? this.plugin.activateTimeline()
        : this.plugin.activateView(),
      setIcon,
    });
  }

  /* ----- Lifecycle ----- */
  async onOpen() {
    this.closed = false;
    this.journalIndexError = null;
    const root = this.contentEl;
    this.containerEl.addClass('cal-sidebar');
    this._syncCalendarMoodMarkerClass();
    if (usesPhoneLayout(this.plugin.capabilities)) this.containerEl.addClass('dayline-mobile-native-view');
    root.removeClass('journal-timeline-view');
    root.addClass('cal-calendar-content');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-label', t(this.plugin.settings, 'calendarTitle'));
    this._calendarKeydownHandler = (event) => {
      if (!shouldHandleCalendarMonthShortcut(event)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void this._goToMonth(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void this._goToMonth(1);
      }
    };
    root.addEventListener('keydown', this._calendarKeydownHandler);
    // P-20: the "today" highlight must move at midnight, not only on the next
    // unrelated redraw.
    this._scheduleMidnightRefresh();
    this._unsubscribeIndex = this.plugin.journalIndex?.subscribe?.((_, change) => {
      this._onJournalIndexChanged(change)
        .catch((error) => console.warn('[Dayline] Calendar index refresh failed:', error?.message || error));
    });

    // Detect which date the user is currently viewing
    this._syncActiveDate();
    if (usesPhoneLayout(this.plugin.capabilities) && !this._hasOpened) this._syncDisplayMonthToActiveDate();
    this._hasOpened = true;
    this.render();

    const indexWasReady = Boolean(this.plugin.journalIndex?.isReady);
    startJournalIndexLoad(
      () => this.plugin.ensureJournalIndexReady
        ? this.plugin.ensureJournalIndexReady()
        : this.plugin.journalIndex.refresh(this.plugin.settings),
      () => {
        if (this.closed) return;
        this.journalIndexError = null;
        // A legacy mobile view can redirect while the first index build is
        // committing. Render explicitly when that completion notification
        // races the subscription established above.
        const refresh = indexWasReady ? this.refresh() : Promise.resolve().then(() => this.render());
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
    this._overlayGeneration = (this._overlayGeneration || 0) + 1;
    this._fetchToken++;
    const root = this.contentEl;
    if (this._calendarKeydownHandler) root.removeEventListener('keydown', this._calendarKeydownHandler);
    this._calendarKeydownHandler = null;
    this._unsubscribeIndex?.();
    this._unsubscribeIndex = null;
    // J-08: the memory wall is owned by this view's provider, so closing the
    // view closes the panel instead of leaving it floating over the workspace.
    this._otdProvider?.closeModal?.();
    this._clearMidnightRefresh();
    this._cancelScheduledRender();
    window.clearTimeout(this._refreshTimer);
    window.clearTimeout(this._exifNoteTimer);
    this.plugin._endExifHover();
    for (const observer of this._exifObservers?.values() || []) observer.disconnect();
    this._exifObservers?.clear();
    this._disposeNoteMediaInstrumentation();
    this._removeAllOverlaysFromViews();
    this._hostPositionMarkers.clear();
    if (!usesPhoneLayout(this.plugin.capabilities)) {
      this.plugin.viewVisibilityController?.viewClosed('calendar')
        .then(() => this.plugin._syncDaylineRibbon())
        .catch((error) => console.warn('[Dayline] Calendar close state sync failed:', error?.message || error));
    } else {
      this.plugin._syncDaylineRibbon();
    }
    this.containerEl.removeClass('cal-sidebar');
    this.containerEl.removeClass('cal-mood-marker-dot');
    this.containerEl.removeClass('cal-mood-marker-bar');
    this.containerEl.removeClass('dayline-mobile-native-view');
    root.removeClass('cal-calendar-content');
    root.removeClass('cal-mood-marker-dot');
    root.removeClass('cal-mood-marker-bar');
  }

  /**
   * Coalesce every render trigger into one repaint per frame (P-17). Clicking a
   * date fires `active-leaf-change` and the click handler together, which used
   * to rebuild the whole grid twice.
   */
  _scheduleRender() {
    if (this.closed || this._renderScheduled) return;
    this._renderScheduled = true;
    const run = () => {
      this._renderScheduled = false;
      this._renderFrame = null;
      this._renderTimer = null;
      if (!this.closed) this.render();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this._renderFrame = window.requestAnimationFrame(run);
    } else if (typeof window !== 'undefined') {
      this._renderTimer = window.setTimeout(run, 0);
    } else {
      run();
    }
  }

  _cancelScheduledRender() {
    if (this._renderFrame != null && typeof window !== 'undefined') window.cancelAnimationFrame?.(this._renderFrame);
    if (this._renderTimer != null && typeof window !== 'undefined') window.clearTimeout(this._renderTimer);
    this._renderFrame = null;
    this._renderTimer = null;
    this._renderScheduled = false;
  }

  /** Repaint shortly after the next local midnight so "today" stays correct. */
  _scheduleMidnightRefresh() {
    this._clearMidnightRefresh();
    if (typeof window === 'undefined') return;
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());
    this._midnightTimer = window.setTimeout(() => {
      this._midnightTimer = null;
      if (this.closed) return;
      this.render();
      this._scheduleMidnightRefresh();
    }, delay);
  }

  _clearMidnightRefresh() {
    if (this._midnightTimer == null) return;
    if (typeof window !== 'undefined') window.clearTimeout(this._midnightTimer);
    this._midnightTimer = null;
  }

  _handleActiveLeafChange() {
    const previousMonth = this._monthKey(this.displayMonth);
    const activeView = this.app.workspace.activeLeaf?.view;
    if (shouldPreserveCalendarSelection(activeView, this)) return;
    this._syncActiveDate();
    if (usesPhoneLayout(this.plugin.capabilities) && this.activeDate) {
      const nextMonth = this._monthKey(this._monthStartForDate(this.activeDate) || this.displayMonth);
      if (nextMonth !== previousMonth) {
        this.displayMonth = this._monthStartForDate(this.activeDate) || this.displayMonth;
        this.monthCache.delete(nextMonth);
        this.buildMonthCache(this.displayMonth)
          .then(() => this._scheduleRender())
          .catch((error) => console.warn('[Dayline] Active-date month sync failed:', error?.message || error));
        return;
      }
    }
    // Defer so the click handler that is already opening the file coalesces
    // into the same repaint instead of rendering the grid a second time.
    this._scheduleRender();
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
    window.clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => {
      void (async () => {
        try {
          await this.buildMonthCache(this.displayMonth);
          this.render();
        } catch (error) {
          console.warn('[Dayline] Calendar image refresh failed:', error?.message || error);
          this.monthCache.delete(this._monthKey(this.displayMonth));
          new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
        }
      })();
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

    const entries = [change.previous, change.entry].filter(Boolean);
    // OTD excerpts depend on journal prose/frontmatter even when the calendar
    // projection is unchanged. Invalidate its content cache independently.
    const otdDates = Array.from(new Set(entries.map((entry) => entry.date).filter(Boolean)));
    if (!calendarEntryAffectsDisplay(change.previous, change.entry)) {
      for (const date of otdDates) this._otdProvider?.invalidate?.(date.slice(5));
      return;
    }

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
    // The shared EXIF cache is invalidated per changed file, not wholesale:
    // clearing it here made every unrelated refresh re-read every image (P-17).
    if (this._otdProvider) this._otdProvider.invalidate();
    this._otdDotCache = null;
    await this.buildMonthCache(this.displayMonth);
    this.render();
    // Rebuild the past-year index the header button's badge reads
    if (this._otdProvider && shouldShowHeaderOnThisDayEntry(this.plugin.settings)) {
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

  _monthStartForDate(dateStr) {
    const [year, month] = String(dateStr || '').split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    // Use midday so a host timezone/DST transition cannot move the month back
    // across a midnight boundary while the mobile view is settling.
    return new Date(year, month - 1, 1, 12, 0, 0, 0);
  }

  _syncDisplayMonthToActiveDate() {
    const month = this._monthStartForDate(this.activeDate);
    if (month) this.displayMonth = month;
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
    if (this.closed) return;
    // Capture at repaint time, not when an async navigation started.
    const active = this.contentEl.ownerDocument.activeElement;
    const focusKey = this.contentEl.contains(active)
      ? active?.getAttribute('data-calendar-focus')
      : null;
    const jumpYear = this.contentEl.querySelector('[data-calendar-focus="jump-year"]');
    const jumpMonth = this.contentEl.querySelector('[data-calendar-focus="jump-month"]');
    const jumpDraft = this._calendarJumpOpen && jumpYear && jumpMonth
      ? { year: jumpYear.value, month: jumpMonth.value } : null;
    this._renderCalendar();
    if (jumpDraft) {
      const year = this.contentEl.querySelector('[data-calendar-focus="jump-year"]');
      const month = this.contentEl.querySelector('[data-calendar-focus="jump-month"]');
      if (year) year.value = jumpDraft.year;
      if (month) month.value = jumpDraft.month;
    }
    if (focusKey) {
      const target = this.contentEl.querySelector(`[data-calendar-focus="${focusKey}"]`)
        || (focusKey.startsWith('jump-') ? this.contentEl.querySelector('.cal-title-button') : null);
      target?.focus({ preventScroll: true });
    }
  }

  _syncCalendarMoodMarkerClass() {
    const markerClass = calendarMoodMarkerClass(this.plugin.settings);
    for (const el of [this.containerEl, this.contentEl]) {
      if (!el) continue;
      el.removeClass('cal-mood-marker-dot');
      el.removeClass('cal-mood-marker-bar');
      el.addClass(markerClass);
    }
  }

  _renderCalendar() {
    // Bump fetch token so stale async results are discarded
    this._fetchToken = (this._fetchToken || 0) + 1;
    this._syncCalendarMoodMarkerClass();

    const el = this.contentEl;
    el.empty();
    el.setAttribute('aria-label', t(this.plugin.settings, 'calendarTitle'));
    this._renderMobileModeControls(el);

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
    const todayStr = _daylineDate(this.plugin.settings);
    const key = this._monthKey(this.displayMonth);
    const imageMap = this.monthCache.get(key) || new Map();

    // --- Header: month navigation and view-local controls ---
    const header = el.createDiv({ cls: 'cal-header' });
    const prevBtn = header.createEl('button', {
      cls: 'cal-nav cal-icon-button',
      attr: { type: 'button', 'data-calendar-focus': 'previous', 'aria-label': t(this.plugin.settings, 'previousMonth'), title: t(this.plugin.settings, 'previousMonth') },
    });
    setIcon(prevBtn, 'chevron-left');
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      prevBtn.focus({ preventScroll: true });
      void this._goToMonth(-1);
    });

    const title = header.createEl('button', {
      cls: 'cal-title cal-title-button',
      attr: {
        type: 'button',
        'data-calendar-focus': 'title',
        'aria-label': t(this.plugin.settings, 'jumpToMonth'),
        title: t(this.plugin.settings, 'jumpToMonth'),
        'aria-expanded': String(this._calendarJumpOpen),
      },
    });
    title.setText(formatCalendarMonth(year, month + 1, this.plugin.settings));
    title.addEventListener('click', (event) => {
      event.stopPropagation();
      title.focus({ preventScroll: true });
      this._calendarJumpOpen = !this._calendarJumpOpen;
      this.render();
    });
    title.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this._calendarJumpOpen) return;
      event.preventDefault();
      event.stopPropagation();
      this._calendarJumpOpen = false;
      this.render();
    });

    const nextBtn = header.createEl('button', {
      cls: 'cal-nav cal-icon-button',
      attr: { type: 'button', 'data-calendar-focus': 'next', 'aria-label': t(this.plugin.settings, 'nextMonth'), title: t(this.plugin.settings, 'nextMonth') },
    });
    setIcon(nextBtn, 'chevron-right');
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      nextBtn.focus({ preventScroll: true });
      void this._goToMonth(1);
    });

    const headerActions = header.createDiv({ cls: 'cal-header-actions' });
    this._renderOnThisDayHeader(headerActions);
    if (!isCurrentCalendarMonth(this.displayMonth, todayStr)) {
      const todayBtn = headerActions.createEl('button', {
        cls: 'cal-icon-button cal-today-button',
        attr: { type: 'button', 'data-calendar-focus': 'today', 'aria-label': t(this.plugin.settings, 'today'), title: t(this.plugin.settings, 'today') },
      });
      setIcon(todayBtn, 'calendar-check');
      todayBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        todayBtn.focus({ preventScroll: true });
        void this._goToToday();
      });
    }
    if (this._calendarJumpOpen) this._renderMonthJump(el);
    // Calendar records are intentionally unfiltered; the timeline owns filtering.

    // --- Weather card (below header, above weekdays) ---
    this._renderWeatherCard(el);

    // --- On This Day entry (merged weather-card strip, or header icon) ---
    this._renderOnThisDayEntry(el);

    // --- Weekday row ---
    const wd = el.createDiv({ cls: 'cal-weekdays' });
    for (const day of getCalendarWeekdays(this.plugin.settings)) {
      wd.createSpan({ cls: 'cal-weekday', text: day });
    }

    // --- Grid ---
    const grid = el.createDiv({ cls: 'cal-grid' });
    const touchRouting = calendarCellTouchRouting(
      Boolean(this.plugin.capabilities?.coarsePointer),
      usesPhoneLayout(this.plugin.capabilities),
    );

    const firstDay = getCalendarGridOffset(year, month, this.plugin.settings);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

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
      const cover = dateEntry.cover || media[0];
      const isToday = dateStr === todayStr;

      // Day cells are buttons: keyboard and screen-reader users must be able to
      // reach and activate the same open-journal path the pointer uses. The
      // `data-calendar-focus` key lets `render()` put focus back on this exact
      // date after the grid is rebuilt.
      const cell = grid.createDiv({
        cls: 'cal-day',
        attr: {
          role: 'button',
          tabindex: '0',
          'data-calendar-focus': `day-${dateStr}`,
        },
      });
      if (cover) cell.addClass('cal-has-image');
      else cell.addClass('cal-no-image');
      if (dateEntry.hasRecord) cell.addClass('cal-has-record');
      // Day One-style written marker: a journaled date without a photo fills
      // the whole cell with the accent colour; photo dates already fill with
      // the image itself.
      if (dateEntry.hasRecord && !cover && shouldShowCalendarWrittenMarker(this.plugin.settings)) cell.addClass('cal-written');
      if (dateEntry.hasWeather) cell.addClass('cal-has-weather');
      const entryCountLabel = t(this.plugin.settings, dateEntry.entryCount === 1 ? 'calendarEntryCountOne' : 'calendarEntryCount', { count: dateEntry.entryCount });
      // U-02: the raw ISO date is not what a screen reader should read out.
      const localizedDate = formatJournalDate(dateStr, this.plugin.settings);
      cell.setAttribute('aria-label', [
        dateEntry.entryCount
          ? t(this.plugin.settings, 'calendarEntriesOnDate', { date: localizedDate, entries: entryCountLabel })
          : localizedDate,
        dateEntry.hasWeather ? t(this.plugin.settings, 'calendarWeatherAvailable') : '',
      ].filter(Boolean).join(', '));
      if (isToday) cell.addClass('cal-today');
      if (dateStr === this.activeDate && !isToday) cell.addClass('cal-active');

      // Background image (first image as thumbnail)
      if (cover) {
        const mobileImage = Boolean(this.plugin.capabilities?.isMobile);
        const bg = mobileImage
          ? cell.createEl('img', {
            cls: 'cal-day-bg',
            attr: {
              alt: '',
              loading: 'lazy',
              decoding: 'async',
              'aria-hidden': 'true',
            },
          })
          : cell.createDiv({ cls: 'cal-day-bg' });
        cell.createDiv({ cls: 'cal-day-overlay' });
        if (mobileImage) {
          bg.addEventListener('load', () => bg.addClass('is-loaded'));
          bg.addEventListener('error', () => {
            bg.removeAttribute('src');
            bg.removeClass('is-loaded');
            cell.removeClass('cal-has-image');
            cell.addClass('cal-no-image');
          });
        }
        void this._setBackground(bg, dateEntry);

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
          bg.removeAttribute('aria-hidden');
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
        cell.createSpan({
          cls: 'cal-entry-count',
          text: `+${dateEntry.entryCount - 1}`,
          attr: {
            'aria-label': t(this.plugin.settings, 'calendarEntriesOnDate', { date: dateStr, entries: entryCountLabel }),
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
          const iconFile = weatherBadgeIcon(snap);
          const category = BADGE_ICON_CATEGORY[iconFile] ?? 'weather-cat-cloud';
          const badge = cell.createSpan({ cls: `cal-weather-badge ${category}` });
          appendBadgeSvg(badge, BADGE_SVG[iconFile] ?? BADGE_SVG['badge-cloud.svg']);
          const condition = weatherConditionLabel(snap, this.plugin.settings);
          badge.setAttribute('aria-label', `${condition}, ${snap.temperature}${this._unitSymbol(snap.units)}`);
          badge.title = `${condition} · ${snap.temperature}${this._unitSymbol(snap.units)}`;
        }
      }

      // Mood is stored outside Markdown. A frontmatter-only mood remains
      // visible through the index until the user explicitly imports it.
      const dailyPath = joinVaultPath(this.plugin.settings.dailyFolder, `${dateStr}.md`);
      // P-14: read the mood from the same path the picker edits. With several
      // configured sources the primary entry and today's daily note can differ,
      // and the cell used to display one while editing the other.
      const moodPath = dateEntry.primaryEntryPath || dateEntry.path || dailyPath;
      const mood = shouldShowCalendarMood(this.plugin.settings)
        ? this.plugin.moodStore?.get(moodPath)
          || dateEntry.mood
        : undefined;
      // Only offer the control where a mood is already recorded or the date has a
      // journal entry. Rendering an empty frame on every date littered the grid
      // with targets that claimed taps meant for the date itself.
      const hasMoodTarget = Boolean(mood) || Boolean(dateEntry.hasRecord);
      if (touchRouting.showMoodControl && shouldShowCalendarMood(this.plugin.settings) && hasMoodTarget) {
        // The mood level is carried by color plus the hover `title`. A non-color
        // visual cue (marker size) was tried for M-11 and reverted by the
        // maintainer: at 6-10px it was too subtle to help anyone and it put the
        // marker's shape at risk, so the pip is deliberately left uniform.
        const moodButton = cell.createEl('button', {
          cls: `cal-mood-button ${mood ? `mood-${mood.score}` : 'cal-mood-empty'}`,
          attr: {
            type: 'button',
            'aria-label': `${t(this.plugin.settings, 'recordMood')}: ${localizedDate}`,
            title: mood ? moodLabel(this.plugin.settings, mood.score) : `${t(this.plugin.settings, 'recordMood')}: ${localizedDate}`,
          },
        });
        if (mood) moodButton.style.setProperty('--journal-mood-color', getMoodColor(mood.score));
        moodButton.createSpan({ cls: 'cal-mood-dot', attr: { 'aria-hidden': 'true' } });
        // Claim the press so the cell's date gesture never starts here.
        moodButton.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
        });
        // Open on the tap's final event. Opening on pointerdown placed the modal
        // under the finger before release, so the trailing click landed on the
        // modal backdrop — which Obsidian uses to dismiss — and the picker only
        // survived while the finger was held down.
        moodButton.addEventListener('click', (event) => {
          event.stopPropagation();
          void this.plugin.openMoodPicker(moodPath, { allowDateSelection: true, ensureFile: false });
        });
      }

      // Date number
      cell.createSpan({ cls: 'cal-day-num', text: String(d) });

      const openDate = () => this._openNote(dateStr, dateEntry.primaryEntryPath || dateEntry.path);
      bindOpenOnPointer(cell, {
        coarsePointer: this.plugin.capabilities?.coarsePointer,
        shouldOpen: shouldOpenCalendarDateFromPointer,
        keyboard: true,
        onOpen: openDate,
      });
    }
  }

  _renderMonthJump(containerEl) {
    const panel = containerEl.createDiv({ cls: 'cal-jump-panel' });
    panel.setAttribute('aria-label', t(this.plugin.settings, 'jumpToMonth'));
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this._calendarJumpOpen = false;
      this.contentEl.querySelector('.cal-title-button')?.focus({ preventScroll: true });
      this.render();
    });

    const yearLabel = panel.createEl('label', { cls: 'cal-filter-field' });
    yearLabel.createSpan({ text: t(this.plugin.settings, 'year') });
    const yearInput = yearLabel.createEl('input', {
      attr: { type: 'number', min: '1', max: '9999', inputmode: 'numeric', 'data-calendar-focus': 'jump-year', 'aria-label': t(this.plugin.settings, 'year') },
    });
    yearInput.value = String(this.displayMonth.getFullYear());

    const monthLabel = panel.createEl('label', { cls: 'cal-filter-field' });
    monthLabel.createSpan({ text: t(this.plugin.settings, 'month') });
    const monthSelect = monthLabel.createEl('select', { attr: { 'data-calendar-focus': 'jump-month', 'aria-label': t(this.plugin.settings, 'month') } });
    const locale = LOCALE_TAGS[getDisplayLanguage(this.plugin.settings)] || 'en-US';
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
      attr: { type: 'button', 'data-calendar-focus': 'jump-apply', 'aria-label': t(this.plugin.settings, 'apply'), title: t(this.plugin.settings, 'apply') },
    });
    setIcon(apply, 'check');
    const applyJump = () => {
      apply.focus({ preventScroll: true });
      const nextYear = Math.max(1, Math.min(9999, Number.parseInt(yearInput.value, 10) || this.displayMonth.getFullYear()));
      const nextMonth = Math.max(0, Math.min(11, Number.parseInt(monthSelect.value, 10) || 0));
      void this._jumpToMonth(nextYear, nextMonth);
    };
    apply.addEventListener('click', (event) => {
      event.stopPropagation();
      applyJump();
    });
    // P-08: typing a year and pressing Enter must apply the jump; the number
    // input has no implicit submit inside the panel.
    yearInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      applyJump();
    });
  }

  _goToToday() {
    const [year, month] = _daylineDate(this.plugin.settings).split('-').map(Number);
    return this._jumpToMonth(year, month - 1);
  }

  _jumpToMonth(year, monthIndex) {
    // P-20: build the target on a fixed base year and then set the real year.
    // `new Date(year, ...)`/`Date.UTC(year, ...)` maps years 0-99 onto
    // 1900-1999, which made a jump to year 42 render as 1942 while the grid
    // offset (fixed in i18n's utcDateOf) used year 42. The panel keeps its
    // 1-9999 range, so the construction has to be correct for every year.
    const targetMonth = new Date(0);
    targetMonth.setFullYear(year, monthIndex, 1);
    targetMonth.setHours(12, 0, 0, 0);
    this.displayMonth = targetMonth;
    this._calendarJumpOpen = false;
    return this.buildMonthCache(targetMonth).then(() => this.render()).catch((error) => {
      console.warn('[Dayline] Calendar month jump failed:', error?.message || error);
      this.monthCache.delete(this._monthKey(targetMonth));
      new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
    });
  }

  /* ----- EXIF Tooltip (delegates to plugin) ----- */

  _ensureExifTooltip() { this.plugin._ensureExifTooltip(); }
  _showExifTooltip(el, fields, loading, kind) { this.plugin._showExifTooltip(el, fields, loading, kind); }
  _hideExifTooltip() { this.plugin._hideExifTooltip(); }

  _onMediaEnter(cell, attachment, immediate = false) {
    if (!this.plugin.settings.showExif || !attachment) return;
    if (immediate && this.plugin._toggleExifTouch(cell)) return;
    const hoverToken = this.plugin._beginExifHover();
    this.plugin._exifHoverTimer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!this.plugin._isCurrentExifHover(hoverToken)) return;
          this.plugin._showExifTooltip(cell, null, true, 'media');
          const metadata = await this.mediaService?.getMetadata?.(attachment);
          const fields = formatMediaMetadataForDisplay(metadata);
          if (!this.plugin._isCurrentExifHover(hoverToken)) return;
          this.plugin._showExifTooltip(cell, fields, false, 'media');
        } catch {
          this.plugin._hideExifTooltip();
        }
      })();
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
    // U-08: resolve the locale at call time so a `'system'` setting follows the
    // OS language without a reload.
    const lang = getDisplayLanguage(s);
    if (!s.weatherEnabled || !shouldShowCalendarWeatherCard(s)) {
      // Don't show anything when weather is disabled — avoid intrusive UI
      return;
    }

    if (!validateWeatherCoordinates(s.weatherLatitude, s.weatherLongitude)) {
      const hint = containerEl.createDiv({ cls: 'cal-weather-setup' });
      hint.setText(_l(lang, 'setupHint'));
      hint.setAttribute('aria-label', _l(lang, 'setupAria'));
      return;
    }

    // Use activeDate or today for the card
    const cardDate = this.activeDate || _daylineDate(this.plugin.settings);

    // `_renderCalendar` empties the container before calling this method, which
    // detached the previously rendered card and made the revalidation branch
    // below unreachable (P-09). Re-attach the preserved node first so a redraw
    // revalidates the same-date card instead of rebuilding and refetching it.
    if (this._weatherCardDate === cardDate && this._weatherCardEl && !this._weatherCardEl.isConnected) {
      containerEl.appendChild(this._weatherCardEl);
    }

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
    this._weatherCardEl = card;
    const main = card.createDiv({ cls: 'cal-weather-main' });
    main.setAttribute('role', 'status');
    main.setAttribute('aria-live', 'polite');

    const iconEl = main.createEl('img', { cls: 'cal-weather-icon' });
    const loading = this._weatherLoading ? '\u231B\uFE0F' : '';
    if (loading) iconEl.alt = loading;
    else { iconEl.src = _iconUrl('overcast.svg'); iconEl.alt = t(this.plugin.settings, 'weatherIconAlt'); }

    const infoEl = main.createDiv({ cls: 'cal-weather-info' });
    const tempEl = infoEl.createDiv({ cls: 'cal-weather-temp' });
    const locationEl = shouldShowCalendarWeatherLocation(s)
      ? infoEl.createDiv({ cls: 'cal-weather-location' })
      : null;
    infoEl.createDiv({ cls: 'cal-weather-detail' });
    infoEl.createDiv({ cls: 'cal-weather-extra' });
    infoEl.createDiv({ cls: 'cal-weather-status' });
    tempEl.setText(_l(lang, 'loading'));
    if (locationEl) locationEl.setText(`${_l(lang, 'weatherLocation')}: ${s.weatherLocationName || `${parseFloat(s.weatherLatitude).toFixed(2)}, ${parseFloat(s.weatherLongitude).toFixed(2)}`}`);

    // Native Obsidian refresh icon button
    const refreshBtn = main.createEl('button', {
      cls: 'cal-weather-refresh',
      attr: { 'aria-label': _l(lang, 'refresh'), title: _l(lang, 'refresh') },
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
      void this._fetchWeatherForDate(cardDate);
    } else {
      this._updateWeatherCardUI();
    }
  }

  _onThisDayTargetDate() {
    return onThisDayEntryDate(this.activeDate, _daylineDate(this.plugin.settings));
  }

  _openOnThisDayForDate(dateStr) {
    const parsed = parseOnThisDayMonthDay(dateStr || this._onThisDayTargetDate());
    if (!parsed) return;
    this.plugin.openOnThisDay(parsed.month, parsed.day);
  }

  _bindOnThisDayOpener(el, dateStr) {
    const open = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._openOnThisDayForDate(dateStr || el.dataset?.otdDate);
    };
    el.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    el.addEventListener('click', open);
  }

  _renderOnThisDayHeader(headerActions) {
    if (!shouldShowHeaderOnThisDayEntry(this.plugin.settings)) return;
    const dateStr = this._onThisDayTargetDate();
    const lang = getDisplayLanguage(this.plugin.settings);
    const label = _l(lang, 'otd_title');
    const btn = headerActions.createEl('button', {
      cls: 'cal-icon-button cal-otd-header-button',
      attr: {
        type: 'button',
        'data-calendar-focus': 'on-this-day',
        'data-otd-date': dateStr,
        'aria-label': label,
        title: label,
      },
    });
    setIcon(btn, 'history');
    const mmdd = dateStr.slice(5);
    if (this._otdDotCache?.has(mmdd)) {
      btn.createDiv({ cls: 'cal-otd-header-badge', attr: { 'aria-hidden': 'true' } });
    }
    this._bindOnThisDayOpener(btn, dateStr);
  }

  _renderOnThisDayEntry(containerEl) {
    const token = this._otdStripToken = (this._otdStripToken || 0) + 1;
    clearOnThisDayStrip(containerEl);
    if (!shouldShowMergedOnThisDayEntry(this.plugin.settings) || !this._otdProvider) return;

    const dateStr = this._onThisDayTargetDate();
    const parsed = parseOnThisDayMonthDay(dateStr);
    if (!parsed) return;

    this._otdProvider.getEntries(parsed.month, parsed.day).then((entries) => {
      if (this.closed || token !== this._otdStripToken || !containerEl.isConnected) return;
      this._mountMergedOnThisDayStrip(containerEl, dateStr, parsed.month, parsed.day, entries);
    }).catch((error) => {
      if (this.closed || token !== this._otdStripToken) return;
      console.warn('[Dayline] On This Day strip failed:', error?.message || error);
    });
  }

  _mountMergedOnThisDayStrip(containerEl, dateStr, month, day, entries) {
    clearOnThisDayStrip(containerEl);
    const preview = pickOnThisDayPreview(entries);
    if (!preview) return;

    const host = resolveWeatherOnThisDayHost(containerEl) || createStandaloneOnThisDayHost(containerEl);
    const lang = getDisplayLanguage(this.plugin.settings);
    // "How long ago" is measured from today, the same basis the provider uses to
    // pick which years are past. The browsed date only supplies the month/day:
    // deriving the year from `dateStr` made a memory from the year already on
    // screen read as "0年前" and handed back the open note as a past year.
    const todayYear = Number(_daylineDate(this.plugin.settings).slice(0, 4));
    const yearsAgo = onThisDayYearsAgo(preview.year, todayYear);
    const title = _l(lang, 'otd_title');
    const meta = onThisDayStripMeta(_l(lang, 'otd_yearsAgo', yearsAgo), _l(lang, 'otd_entryDate', month, day));
    const strip = mountOnThisDayStrip(host, {
      title,
      meta,
      ariaLabel: `${title}, ${meta}`,
      dateStr,
    });

    const photo = strip.querySelector('.cal-otd-strip-photo');
    const chevron = strip.querySelector('.cal-otd-strip-chevron');
    if (chevron) setIcon(chevron, 'chevron-right');
    if (photo && preview.image) {
      const notePath = preview.imageNotePath || joinVaultPath(this.plugin.settings.dailyFolder, `${preview.imageDateStr || dateStr}.md`);
      this.plugin.thumbnailService?.load(preview.image, notePath)
        .then((result) => {
          // J-06: quote and escape the resource path; vault names routinely
          // contain parentheses and spaces, which unquoted `url(...)` drops.
          if (result && photo.isConnected) photo.style.backgroundImage = cssUrl(result.url);
        })
        .catch((error) => console.warn('[Dayline] On This Day thumbnail load failed:', error?.message || error));
    } else if (photo) {
      photo.classList.add('is-empty');
      setIcon(photo, 'history');
    }

    this._bindOnThisDayOpener(strip, dateStr);
  }

  _revalidateConnectedWeatherCard(dateStr) {
    if (this._weatherRevalidation?.date === dateStr) return this._weatherRevalidation.promise;

    const request = Promise.resolve()
      .then(() => this.weather.getSnapshot(dateStr))
      .then((snap) => {
        if (this._weatherCardDate !== dateStr || !this._weatherCardEl?.isConnected) return snap;
        const compatible = snap && this.weather.isSnapshotCompatible(snap) ? snap : null;
        this._weatherSnapshot = compatible;
        this._weatherError = !compatible && dateStr >= _daylineDate(this.plugin.settings);
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
    const lang = getDisplayLanguage(this.plugin.settings);

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
      const condition = weatherConditionLabel(snap, this.plugin.settings);
      iconEl.alt = condition;
      iconEl.title = condition;
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
    const displayFields = normalizeWeatherDisplayFields(this.plugin.settings.weatherDisplayFields);
    const weatherParts = buildWeatherCardParts(
      snap,
      { ...labels, low: _l(lang, 'low') },
      displayFields,
      lang,
      this.plugin.settings.weatherTimezone || 'auto',
    );
    if (detailEl) {
      detailEl.setText(weatherParts.detail.join(' · ') || '');
      detailEl.title = snap.location || '';
    }
    if (extraEl) extraEl.setText(weatherParts.extra.join(' · '));
    if (statusEl) statusEl.setText(buildWeatherStatus(snap, labels).join(' · '));

    card.querySelector('.cal-weather-main')?.removeAttribute('aria-live');
  }

  /* ----- Fetch weather for a date in the background ----- */
  async _fetchWeatherForDate(dateStr) {
    const token = this._fetchToken;
    try {
      const snap = await this.weather.getSnapshot(dateStr);
      // Discard stale results if render() was called again since we started fetching
      if (token !== this._fetchToken || this._weatherCardDate !== dateStr) return;
      this._weatherSnapshot = snap;
      // A past date with no snapshot is "no data", not a failure: passive
      // browsing never fetches settled history, so null is the policy result.
      this._weatherError = !snap && dateStr >= _daylineDate(this.plugin.settings);
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      // Do NOT call full render here — it would recreate the card and trigger another fetch.
      // Weather badges on day cells will appear on the next normal render cycle.
    } catch {
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
    // P-15: a redraw or navigation while this request is in flight must not let
    // the result (or the error) paint onto whichever date is now on screen.
    const isCurrent = () => renderToken === this._fetchToken && this._weatherCardDate === dateStr;
    const abandonLoadingState = () => {
      // The newer render owns the card, but this view must never be left
      // claiming a refresh is still running.
      if (!btnEl) this._weatherLoading = false;
    };
    try {
      const snap = await this.weather.forceRefresh(dateStr);
      if (!isCurrent()) {
        abandonLoadingState();
        return;
      }
      this._weatherSnapshot = snap;
      this._weatherError = !snap;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      this.render();
      const lang = getDisplayLanguage(this.plugin.settings);
      if (snap) {
        new Notice(_l(lang, 'weatherUpdated', dateStr));
      } else {
        new Notice(_l(lang, 'noDataFor', dateStr));
      }
    } catch (err) {
      if (isCurrent()) {
        this._weatherError = true;
        this._weatherLoading = false;
        this._updateWeatherCardUI();
        const lang = getDisplayLanguage(this.plugin.settings);
        new Notice(_l(lang, 'refreshFailed', err.message || t(this.plugin.settings, 'unknownError')));
      } else {
        abandonLoadingState();
      }
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
      if (this.plugin.capabilities?.isMobile) {
        const directUrl = this._resolveImmediateImageResource(summary);
        if (directUrl && bgEl.isConnected) {
          this._applyBackgroundResource(bgEl, directUrl);
          return;
        }
      }
      const result = await this.mediaService?.loadFirstCover?.(summary.media || [], summary.cover);
      if (result && bgEl.isConnected) {
        this._applyBackgroundResource(bgEl, result.url);
      }
    } catch {
      // silent
    }
  }

  _applyBackgroundResource(bgEl, resource) {
    if (String(bgEl.tagName || '').toLowerCase() === 'img') bgEl.src = resource;
    else bgEl.style.backgroundImage = `url("${resource}")`;
  }

  _resolveImmediateImageResource(summary) {
    const candidate = summary?.cover || summary?.media?.find?.((item) => item?.kind === 'image');
    if (!candidate || candidate.kind !== 'image') return null;
    if (candidate.external) return candidate.normalizedLink || candidate.link || null;
    const extension = String(candidate.extension || candidate.normalizedLink || '')
      .split(/[.?|/\\]/).pop()?.toLowerCase();
    if (extension === 'heic' || extension === 'heif') return null;
    const file = this.app.metadataCache?.getFirstLinkpathDest?.(candidate.normalizedLink, candidate.sourcePath)
      || this.app.vault?.getAbstractFileByPath?.(candidate.normalizedLink);
    return file ? this.app.vault?.getResourcePath?.(file) || null : null;
  }

  /* ----- Navigate months ----- */
  _goToMonth(delta) {
    const newMonth = new Date(this.displayMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    this.displayMonth = newMonth;

    return this.buildMonthCache(newMonth).then(() => this.render()).catch((error) => {
      console.warn('[Dayline] Calendar month load failed:', error?.message || error);
      this.monthCache.delete(this._monthKey(newMonth));
      new Notice(t(this.plugin.settings, 'calendarMonthLoadFailed', { error: error?.message || error }));
    });
  }

  /* ----- Open (or create + open) daily note ----- */
  _openNote(dateStr, indexedPath) {
    const indexedFile = indexedPath && this.app.vault.getAbstractFileByPath(indexedPath);
    const path = indexedFile instanceof TFile
      ? indexedPath
      : joinVaultPath(this.plugin.settings.dailyFolder, `${dateStr}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);

    const openFileInLeaf = (f) => {
      this.plugin.openJournalFile(f).then((leaf) => {
        this._syncActiveDate(leaf);
        // P-17: opening the file also fires `active-leaf-change`; both triggers
        // coalesce into a single grid rebuild.
        this._scheduleRender();
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
      new CreateNoteModal(this.app, this.plugin.settings, dateStr, () => {
        this._createDailyNote(path, dateStr).then((created) => {
          openFileInLeaf(created);
          // Trigger weather after note is created and opened
          window.setTimeout(() => this._triggerWeatherAfterOpen(dateStr), 500);
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
    if (this.closed) return;
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
      this._overlayDates.set(leaf, entry.date);

      // Check if there's already an in-flight request for this leaf — skip if so
      if (this._overlayInFlight.has(leaf)) {
        continue;
      }

      void this._createOrUpdateOverlay(leaf, file, entry.date);
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
      this._overlayDates.delete(leaf);
      this._releaseOverlay(leaf.containerEl);
    }
  }

  _invalidateOverlayRequests() {
    this._overlayGeneration = (this._overlayGeneration || 0) + 1;
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      this._overlayVersions.set(leaf, (this._overlayVersions.get(leaf) || 0) + 1);
    }
    this._removeAllOverlaysFromViews();
  }

  /* ----- EXIF hover on daily note embedded images ----- */

  _scheduleExifNoteAttach() {
    // Debounce: clear previous timer so we don't attach observers multiple times
    window.clearTimeout(this._exifNoteTimer);
    this._exifNoteTimer = window.setTimeout(() => {
      if (this.closed || !this.plugin.settings.showExif) return;

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
    if (this.closed) return;
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
      let removedElement = false;
      for (const m of mutations) {
        for (const node of m.removedNodes) {
          if (node.nodeType === 1) removedElement = true;
        }
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
      // Release instrumentation for nodes Live Preview detached. A node that was
      // merely moved is connected again by the time this microtask runs, so it
      // keeps its listeners (and is not re-instrumented twice).
      if (removedElement) this._releaseDetachedNoteMedia();
    });

    observer.observe(container, { childList: true, subtree: true });
    this._exifObservers.set(leaf, observer);
  }

  _noteMediaDisposers() {
    if (!(this._exifNoteDisposers instanceof Map)) this._exifNoteDisposers = new Map();
    return this._exifNoteDisposers;
  }

  /** Drop one element's listeners/controls, restoring the attributes we changed. */
  _releaseNoteMediaEntry(el) {
    if (!(this._exifNoteDisposers instanceof Map)) return;
    const disposers = this._exifNoteDisposers.get(el);
    if (!disposers) return;
    this._exifNoteDisposers.delete(el);
    for (const dispose of disposers) dispose();
  }

  /** Release instrumentation for every tracked element no longer in the DOM. */
  _releaseDetachedNoteMedia() {
    if (!(this._exifNoteDisposers instanceof Map)) return;
    for (const el of Array.from(this._exifNoteDisposers.keys())) {
      if (!el.isConnected) this._releaseNoteMediaEntry(el);
    }
  }

  _processImageEls(images) {
    if (this.closed) return;
    for (const img of images) {
      if (this._noteMediaDisposers().has(img)) continue;
      // Live Preview scatters CodeMirror placeholder widgets
      // (img.cm-widgetBuffer) through the editor, and neither they nor
      // sourceless / non-image nodes can resolve to note media. Mirror the
      // embed path's extension validation so only real images are instrumented.
      if (img.classList?.contains('cm-widgetBuffer')) continue;
      const src = img.getAttribute('src') || '';
      if (classifyMediaLink(normalizeMediaLink(src)).kind !== 'image') continue;
      this._bindNoteMediaHover(img, {
        onEnter: (e) => this._onNoteImageEnter(e, img),
        onLeave: () => this._onExifLeave(img),
        onFocus: (e) => this._onNoteImageEnter(e, img, true),
      });
      // Let the outer embed own the single touch affordance when Obsidian
      // renders an image inside an interactive embed wrapper.
      if (getMediaControlOwner(img) === img) {
        this._addNoteMediaInfoControl(img, () => this._onNoteImageEnter(null, img, true));
      }
    }
  }

  _processEmbedEls(embeds) {
    if (this.closed) return;
    for (const el of embeds) {
      if (this._noteMediaDisposers().has(el)) continue;
      // Media Extended and Obsidian both render embeds through this outer
      // element. Resolve the owning Markdown leaf instead of activeLeaf so
      // split panes never borrow another note's relative path.
      const src = el.getAttribute('src') || '';
      const normalizedSrc = normalizeMediaLink(src);
      const classified = classifyMediaLink(normalizedSrc);
      const ext = classified.extension;
      if (!ext || !MEDIA_EXTENSIONS.includes(ext)) continue;
      this._bindNoteMediaHover(el, {
        onEnter: (e) => MEDIA_IMAGE_EXTENSIONS.includes(ext)
          ? this._onNoteImageEnter(e, el)
          : this._onNoteMediaEnter(e, el),
        onLeave: () => this._onExifLeave(el),
        onFocus: (e) => MEDIA_IMAGE_EXTENSIONS.includes(ext)
          ? this._onNoteImageEnter(e, el, true)
          : this._onNoteMediaEnter(e, el, true),
      });
      this._addNoteMediaInfoControl(el, () => MEDIA_IMAGE_EXTENSIONS.includes(ext)
        ? this._onNoteImageEnter(null, el, true)
        : this._onNoteMediaEnter(null, el, true));

      // For HEIC, also try to convert and display the image
      if (HEIC_EXTS.includes(ext) && !hasExistingImage(el) && !el.querySelector('.cal-heic-preview')) {
        void this._convertHeicEmbed(el, normalizedSrc);
      }
    }
  }

  async _convertHeicEmbed(el, src) {
    if (this.closed) return;
    if (resolveCapabilityRoute(this.plugin.capabilities, 'heic') === 'disabled') return;
    // Show loading indicator
    const loader = el.createDiv({ cls: 'cal-heic-preview' });
    loader.textContent = t(this.plugin.settings, 'heicConverting');

    try {
      const notePath = this._notePathForElement(el);
      const file = this.app.metadataCache.getFirstLinkpathDest(src, notePath);
      if (!(file instanceof TFile)) {
        // P-11: nothing to convert, so the "converting" loader must not stay
        // behind claiming a conversion is still in flight.
        loader.remove();
        return;
      }

      const thumb = await this.plugin.heicCache.getThumbnail(file);
      if (this.closed) {
        loader.remove();
        return;
      }
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
      const img = loader.createEl('img', { cls: 'cal-heic-preview-image' });
      img.src = thumb.dataUrl;
      img.setAttribute('data-cal-exif', '1');
      this._bindNoteMediaHover(img, {
        onEnter: (e) => this._onNoteImageEnter(e, img),
        onLeave: () => this._onExifLeave(img),
        onFocus: (e) => this._onNoteImageEnter(e, img, true),
      });
      this._addNoteMediaInfoControl(img, () => this._onNoteImageEnter(null, img, true));
      loader.replaceWith(img);
    } catch {
      loader.textContent = t(this.plugin.settings, 'heicError');
    }
  }

  async _onNoteImageEnter(e, img, immediate = false) {
    if (!this.plugin.settings.showExif) return;
    if (immediate && this.plugin._toggleExifTouch(img)) return;
    if (!immediate) this.plugin._exifTouchAnchor = null;
    const hoverToken = this.plugin._beginExifHover();

    this.plugin._exifHoverTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const file = this._resolveImageFile(img);
          if (!(file instanceof TFile)) return;

          if (!this.plugin._isCurrentExifHover(hoverToken)) return;
          this.plugin._showExifTooltip(img, null, true);
          const fields = await this.exifCache.get(file);
          if (!this.plugin._isCurrentExifHover(hoverToken)) return;
          this.plugin._showExifTooltip(img, fields, false);
        } catch {
          this.plugin._hideExifTooltip();
        }
      })();
    }, immediate ? 0 : 500);
  }

  async _onNoteMediaEnter(e, el, immediate = false) {
    if (!this.plugin.settings.showExif) return;
    if (immediate && this.plugin._toggleExifTouch(el)) return;
    if (!immediate) this.plugin._exifTouchAnchor = null;
    const hoverToken = this.plugin._beginExifHover();
    this.plugin._exifHoverTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const src = el.getAttribute('src') || '';
          const attachment = createMediaAttachment(src, this._notePathForElement(el));
          if (!attachment) return;
          if (!this.plugin._isCurrentExifHover(hoverToken)) return;
          this.plugin._showExifTooltip(el, null, true, 'media');
          const metadata = await this.mediaService?.getMetadata?.(attachment);
          if (!this.plugin._isCurrentExifHover(hoverToken)) return;
          this.plugin._showExifTooltip(el, formatMediaMetadataForDisplay(metadata), false, 'media');
        } catch {
          this.plugin._hideExifTooltip();
        }
      })();
    }, immediate ? 0 : 500);
  }

  _bindNoteMediaHover(el, { onEnter, onLeave, onFocus }) {
    // Editor placeholder widgets are not media; never stamp them.
    if (el.classList?.contains('cm-widgetBuffer')) return;
    const disposers = this._noteMediaDisposers();
    // Live Preview can rebuild the same node instance; release the previous
    // listeners first so they never stack (and so the previous attributes are
    // the ones captured below).
    this._releaseNoteMediaEntry(el);
    const hadTabIndex = el.hasAttribute('tabindex');
    const previousTabIndex = hadTabIndex ? el.getAttribute('tabindex') : null;
    const hadAriaLabel = el.hasAttribute('aria-label');
    const previousAriaLabel = hadAriaLabel ? el.getAttribute('aria-label') : null;
    el.tabIndex = 0;
    el.setAttribute('aria-label', t(this.plugin.settings, 'mediaMetadata'));
    const enter = (e) => onEnter(e);
    const leave = () => onLeave();
    const focus = (e) => onFocus(e);
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    el.addEventListener('focusin', focus);
    disposers.set(el, [() => {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
      el.removeEventListener('focusin', focus);
      if (hadTabIndex) el.setAttribute('tabindex', previousTabIndex);
      else el.removeAttribute('tabindex');
      if (hadAriaLabel) el.setAttribute('aria-label', previousAriaLabel);
      else el.removeAttribute('aria-label');
    }]);
  }

  _disposeNoteMediaInstrumentation() {
    const entries = this._exifNoteDisposers instanceof Map
      ? Array.from(this._exifNoteDisposers.values())
      : [];
    this._exifNoteDisposers = new Map();
    this._exifNoteMediaControls = new WeakSet();
    for (const disposers of entries) {
      for (const dispose of disposers) dispose();
    }
  }

  _addNoteMediaInfoControl(el, open) {
    const owner = getMediaControlOwner(el);
    if (!this.plugin.capabilities?.coarsePointer || !shouldAddMediaInfoControl(owner, this._exifNoteMediaControls)) return;
    const link = owner?.closest?.('a');
    const reference = link || owner;
    const parent = reference?.parentElement;
    if (!parent) return;
    const button = createEl('button');
    button.className = 'dayline-note-media-info';
    button.type = 'button';
    button.setAttribute('aria-label', t(this.plugin.settings, 'mediaMetadata'));
    button.title = t(this.plugin.settings, 'mediaMetadata');
    setIcon(button, 'info');
    const onPointerDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      open();
    };
    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener('pointerdown', onPointerDown);
    button.addEventListener('click', onClick);
    parent.insertBefore(button, reference.nextSibling);
    this._exifNoteMediaControls.add(owner);
    // The control belongs to the media element that produced it, so releasing
    // that element also removes the button it injected.
    const disposers = this._noteMediaDisposers();
    const dispose = () => {
      button.removeEventListener('pointerdown', onPointerDown);
      button.removeEventListener('click', onClick);
      button.remove();
    };
    const existing = disposers.get(el);
    if (existing) existing.push(dispose);
    else disposers.set(el, [dispose]);
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
    const vaultPath = (this.app.vault?.adapter?.basePath || '').replace(/\\/g, '/');
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
    if (this.closed) return;
    const dateStr = indexedDate || file.name.replace(/\.md$/, '');
    const container = leaf.containerEl;
    if (!container) return;
    const generation = this._overlayGeneration || 0;

    // Record in-flight promise for this leaf to prevent concurrent duplicates
    const inFlightPromise = (async () => {
      try {
        await this._buildOverlayForLeaf(leaf, file, dateStr);
      } catch (err) {
        console.warn('[Dayline] Overlay build failed:', err.message);
      } finally {
        // Clean up in-flight marker
        this._overlayInFlight.delete(leaf);
        // Empty weather is terminal. Only a changed target warrants another sync.
        if (!this.closed && (leaf.view?.file !== file || generation !== (this._overlayGeneration || 0)
          || this._overlayDates.get(leaf) !== dateStr)) {
          this._syncNoteOverlays();
        }
      }
    })();
    this._overlayInFlight.set(leaf, inFlightPromise);
  }

  /* ----- Build overlay content and mount it into the given leaf ----- */
  async _buildOverlayForLeaf(leaf, file, dateStr) {
    const container = leaf.containerEl;
    if (!container || this.closed) return;
    const generation = this._overlayGeneration || 0;

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
    // W-04: the overlay knows which date it is for, so a historical date with a
    // final archive snapshot is not refetched on the short TTL.
    const isStale = snap && typeof snap === 'object'
      ? this.weather._shouldFetch(snap, this.plugin.settings.weatherTtlHours || 2, dateStr)
      : true;

    // If no valid snapshot, trigger a background fetch
    if (!snap || isStale) {
      const fetched = await this.weather.getSnapshot(dateStr);
      if (fetched) snap = fetched;
    }

    if (snap && !this.weather.isSnapshotCompatible(snap)) snap = null;

    // Final re-check: file may have changed during fetch
    const latestFile = leaf.view?.file;
    if (this.closed || generation !== (this._overlayGeneration || 0)
      || this._overlayDates.get(leaf) !== dateStr
      || latestFile !== file || !(latestFile instanceof TFile)) return;

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
    if (usesPhoneLayout(this.plugin.capabilities)) {
      const header = container.querySelector?.('.view-header');
      if (header?.getBoundingClientRect) {
        const hostRect = container.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const top = Math.max(8, headerRect.bottom - hostRect.top + 8);
        if (Number.isFinite(top)) overlay.style.top = `${Math.round(top)}px`;
      }
    }

    // Icon
    const iconEl = overlay.createEl('img', { cls: 'cal-overlay-icon' });
    iconEl.src = _iconUrl(snap.icon) || '';
    const condition = weatherConditionLabel(snap, this.plugin.settings);
    iconEl.alt = condition;
    iconEl.title = condition;

    // Info column
    const infoEl = overlay.createDiv({ cls: 'cal-overlay-info' });
    const tempEl = infoEl.createDiv({ cls: 'cal-overlay-temp' });
    const detailEl = infoEl.createDiv({ cls: 'cal-overlay-detail' });

    const lang = getDisplayLanguage(this.plugin.settings);
    const unitSym = this._unitSymbol(snap.units);
    const labelKey = snap.temperatureLabel === 'Now' ? 'now' : 'high';
    tempEl.setText(`${_l(lang, labelKey)} ${snap.temperature ?? '?'}${unitSym}`);

    const parts = [];
    if (snap.feelsLike != null) parts.push(`${_l(lang, 'feels')} ${snap.feelsLike}${unitSym}`);
    if (snap.humidity != null) parts.push(`${_l(lang, 'humidity')} ${snap.humidity}%`);
    detailEl.setText(parts.join(' · ') || '');
    detailEl.title = condition;

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
    window.requestAnimationFrame(() => {
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
    container.setCssStyles({ position: 'relative' });
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
      const lang = getDisplayLanguage(this.plugin.settings);
      const labelKey = snap.temperatureLabel === 'Now' ? 'now' : 'high';
      if (tempEl) tempEl.textContent = `${_l(lang, labelKey)} ${snap.temperature ?? '?'}${unitSym}`;
      if (iconEl) {
        iconEl.src = _iconUrl(snap.icon) || '';
        iconEl.title = weatherConditionLabel(snap, this.plugin.settings);
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
    return this.plugin.createDailyNoteForDate(dateStr);
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
    const newDate = indexedEntry?.date
      || (fallbackMatch && isPathInFolder(file.path, this.plugin.settings.dailyFolder) ? fallbackMatch[1] : null);
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
    const lang = getDisplayLanguage(this.plugin.settings);

    if (missingDates.length === 0) {
      new Notice(_l(lang, 's_backfillAllDone'));
      return;
    }

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
   Legacy Mobile Dayline View
   ============================================================ */
class MobileDaylineView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.redirecting = false;
    this.redirectTimer = null;
  }

  getViewType() { return MOBILE_DAYLINE_VIEW; }
  getDisplayText() { return 'Dayline'; }
  getIcon() { return 'calendar-range'; }

  async onOpen() {
    if (this.redirecting) return;
    this.redirecting = true;
    // Let Obsidian finish opening the restored legacy view before replacing it.
    this.redirectTimer = window.setTimeout(() => {
      this.redirectTimer = null;
      this.plugin._redirectLegacyMobileDaylineLeaf(this.leaf)
        .catch((error) => {
          console.warn('[Dayline] Could not migrate legacy mobile view:', error?.message || error);
          new Notice(t(this.plugin.settings, 'openNoteFailed', { error: error?.message || error }));
        })
        .finally(() => { this.redirecting = false; });
    }, 0);
  }

  onClose() {
    if (this.redirectTimer) window.clearTimeout(this.redirectTimer);
    this.redirectTimer = null;
  }
}

/* ============================================================
   Create Note Confirm Modal
   ============================================================ */
class CreateNoteModal extends Modal {
  constructor(app, settings, dateStr, onConfirm) {
    super(app);
    this.settings = settings;
    this.dateStr = dateStr;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: t(this.settings, 'createNoteTitle') });
    contentEl.createEl('p', { text: t(this.settings, 'createNotePrompt', { date: this.dateStr }) });

    const btnDiv = contentEl.createDiv({ cls: 'modal-button-container' });
    btnDiv.createEl('button', { text: t(this.settings, 'cancel') })
      .addEventListener('click', () => this.close());
    const confirmBtn = btnDiv.createEl('button', { text: t(this.settings, 'createNoteAction'), cls: 'mod-cta' });
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
function _daylineDate(settings, date = new Date()) {
  return getTodayDate(settings?.weatherTimezone || 'auto', date);
}

/**
 * Substitute the Daily Notes tokens Dayline supports: `{{date}}`, `{{title}}`,
 * `{{time}}`, and the formatted `{{date:FORMAT}}` / `{{time:FORMAT}}` variants.
 * Obsidian bundles moment as `window.moment`, so the format strings behave
 * exactly like the core Daily Notes plugin's. Unknown tokens are left alone.
 */
function _resolveDailyNoteTemplate(content, dateStr) {
  const source = String(content ?? '');
  const title = String(dateStr ?? '');
  const moment = typeof window !== 'undefined' ? window.moment : undefined;
  const supportsMoment = typeof moment === 'function';
  const day = supportsMoment ? moment(title, 'YYYY-MM-DD', true) : null;
  const now = supportsMoment ? moment() : null;
  const usable = (value) => Boolean(value && typeof value.format === 'function' && value.isValid?.() !== false);
  return source.replace(/\{\{(date|time|title)(?::([^}]*))?\}\}/g, (match, name, format) => {
    if (name === 'title') return title;
    if (name === 'date') {
      if (usable(day)) return day.format(format || 'YYYY-MM-DD');
      return format ? match : title;
    }
    // `time` is "now": the note is being created at this moment.
    if (usable(now)) return now.format(format || 'HH:mm');
    return format ? match : '';
  });
}

/* ============================================================
   Weather SVGs, inlined for zero I/O.
   Scene illustrations: Meteocons Fill (MIT, @meteocons/svg-static).
   Calendar badges are Lucide (ISC) outline glyphs, imported as raw markup
   from `icons/badge-*.svg` — see the BADGE_SVG table below.
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

/* Lucide badge glyphs, imported as raw markup so the inline <svg> inherits currentColor.
   Single source of truth: these are the same files shipped under `icons/`. */
const BADGE_SVG: Record<string, string> = {
  'badge-sun.svg': badgeSunSvg,
  'badge-cloud-sun.svg': badgeCloudSunSvg,
  'badge-cloud.svg': badgeCloudSvg,
  'badge-fog.svg': badgeFogSvg,
  'badge-drizzle.svg': badgeDrizzleSvg,
  'badge-rain.svg': badgeRainSvg,
  'badge-snow.svg': badgeSnowSvg,
  'badge-storm.svg': badgeStormSvg,
};

/* Maps badge icon filename → CSS condition category class. */
const BADGE_ICON_CATEGORY: Record<string, string> = {
  'badge-sun.svg': 'weather-cat-sun',
  'badge-cloud-sun.svg': 'weather-cat-cloud-sun',
  'badge-cloud.svg': 'weather-cat-cloud',
  'badge-fog.svg': 'weather-cat-fog',
  'badge-drizzle.svg': 'weather-cat-drizzle',
  'badge-rain.svg': 'weather-cat-rain',
  'badge-snow.svg': 'weather-cat-snow',
  'badge-storm.svg': 'weather-cat-storm',
};

export default DaylinePlugin;
