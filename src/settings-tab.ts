// @ts-nocheck
import { Notice, PluginSettingTab, Setting, SuggestModal, TFolder } from 'obsidian';
import { DISPLAY_LANGUAGE_ENDONYMS, DISPLAY_LANGUAGE_OPTIONS, getDisplayLanguage, t } from './i18n';
import { applyDeviceLocation, geolocationFailureKey, requestCurrentCoordinates } from './geolocation';
import { localize as _l } from './locale';
import compactWordmarkSvg from '../assets/dayline-wordmark-compact.svg';
import daylineLogoSvg from '../assets/dayline-logo.svg';
import { renderSettingsBrand } from './settings-brand';
import { calendarMoodMarker, shouldShowCalendarMoodStyle, shouldShowCalendarWrittenMarker } from './calendar-display';
import { shouldShowTimelineMoodTrend, shouldShowTimelineTitles } from './journal-timeline-display';
import { JournalSourceSettingsEditor } from './journal-source-settings';
import { normalizeOnThisDayEntryMode } from './on-this-day-entry';
import { DEFAULT_HEIC_THUMB_CACHE_DIR, normalizeHeicThumbCacheDir } from './heic-thumb-store';

const VIEW_TYPE = 'calendar-sidebar-view';

/** Delay before a settings text field commits while the user is still typing. */
export const SETTINGS_TEXT_COMMIT_DELAY_MS = 800;

export const DEFAULT_MOOD_METADATA_PATH = 'Calendar/journal-metadata.json';

export type SettingsFieldValidation =
  | { ok: true; value: string }
  | { ok: false; messageKey: string };

export type CoordinateFieldKind = 'latitude' | 'longitude';

const COORDINATE_LIMITS: Record<CoordinateFieldKind, number> = { latitude: 90, longitude: 180 };
const COORDINATE_RANGE_MESSAGE_KEYS: Record<CoordinateFieldKind, string> = {
  latitude: 'latitudeOutOfRange',
  longitude: 'longitudeOutOfRange',
};
// `parseFloat` accepts '39abc' as 39; only a plain decimal number is a coordinate.
const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Strict coordinate parsing for the settings fields. An empty value stays
 * allowed (it leaves weather without coordinates until the user configures
 * them), but anything that is not a plain decimal number, or that falls outside
 * the valid range, is reported for an inline message instead of being stored.
 */
export function parseCoordinateSettingValue(kind: CoordinateFieldKind, raw: unknown): SettingsFieldValidation {
  const value = String(raw ?? '').trim();
  if (value === '') return { ok: true, value: '' };
  if (!DECIMAL_NUMBER_PATTERN.test(value)) return { ok: false, messageKey: 'coordinateMustBeNumeric' };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false, messageKey: 'coordinateMustBeNumeric' };
  if (Math.abs(parsed) > COORDINATE_LIMITS[kind]) {
    return { ok: false, messageKey: COORDINATE_RANGE_MESSAGE_KEYS[kind] };
  }
  return { ok: true, value };
}

/**
 * Mood metadata must be a JSON file. Applying a half-typed path such as
 * `...metadata.js` used to save it and then reject the following load; empty
 * input falls back to the default path.
 */
export function normalizeMoodMetadataPath(raw: unknown): SettingsFieldValidation {
  const value = String(raw ?? '').trim();
  if (value === '') return { ok: true, value: DEFAULT_MOOD_METADATA_PATH };
  if (!/\.json$/i.test(value)) return { ok: false, messageKey: 'moodMetadataPathMustBeJson' };
  return { ok: true, value };
}

/**
 * The HEIC thumbnail cache is a vault-relative folder. Empty input disables the
 * cross-device cache. Hidden folders (a leading dot) keep the vault clean but
 * are skipped by Obsidian Sync, so any in-vault folder is accepted and the
 * choice is left to the user.
 */
export function normalizeHeicThumbCachePath(raw: unknown): SettingsFieldValidation {
  const value = String(raw ?? '').trim();
  if (value === '') return { ok: true, value: '' };
  if (/[\u0000-\u001f]/.test(value)) return { ok: false, messageKey: 'heicThumbCachePathInvalid' };
  const normalized = normalizeHeicThumbCacheDir(value);
  if (!normalized) return { ok: false, messageKey: 'heicThumbCachePathInvalid' };
  return { ok: true, value: normalized };
}

/**
 * The one-tap locate control needs a platform location service. Obsidian mobile
 * (iOS/Android) provides one; desktop Electron builds usually have no provider
 * key, where the request only produced POSITION_UNAVAILABLE errors and an
 * English notice. Those users can still type the coordinates. Widening this
 * needs real-device verification on desktop.
 */
export function shouldShowUseCurrentLocationButton(
  capabilities?: { isMobileApp?: boolean; isIos?: boolean; isAndroid?: boolean } | null,
): boolean {
  if (!capabilities) return false;
  return Boolean(capabilities.isMobileApp || capabilities.isIos || capabilities.isAndroid);
}

/**
 * HEIC conversion only exists in the desktop build (the WASM decoder is
 * desktop-gated), so the "generate everything now" action is hidden where it
 * could not do any work.
 */
export function shouldShowHeicThumbCacheGenerate(capabilities?: { isDesktop?: boolean } | null): boolean {
  return Boolean(capabilities?.isDesktop);
}

/**
 * Resolve the locale for the settings descriptions at call time. Reading the
 * table frozen from `weatherLanguage` at load/save time mixed languages when the
 * display language followed the system and the system language changed.
 */
export function createSettingsLocalizer(
  settings: { displayLanguage?: string; weatherLanguage?: string },
): (key: string, ...args: unknown[]) => string {
  return (key, ...args) => _l(getDisplayLanguage(settings), key, ...args);
}

/**
 * Fill the display-language dropdown. `system` is the one locale-aware option
 * (an instruction, not a language name); every language is listed as an
 * endonym from `DISPLAY_LANGUAGE_ENDONYMS`, so an unfamiliar UI language is
 * always escapable.
 */
export function fillDisplayLanguageDropdown(dd, settings) {
  for (const option of DISPLAY_LANGUAGE_OPTIONS) {
    dd.addOption(option, option === 'system'
      ? t(settings, 'system')
      : DISPLAY_LANGUAGE_ENDONYMS[option]);
  }
}

export async function commitJournalSourceSettings(plugin, save = () => plugin.saveSettings()) {
  const saved = await save();
  if (saved === false) return false;
  await plugin.journalIndex.refresh(plugin.settings);
  plugin.refreshJournalViews();
  return true;
}

export const SETTINGS_SECTION_IDS = [
  'general',
  'calendar-journal',
  'mood',
  'weather',
  'media-privacy',
  'on-this-day',
  'data-maintenance',
];

export const SETTINGS_SECTION_LABEL_KEYS = {
  general: 'settingsGeneral',
  'calendar-journal': 'settingsCalendarJournal',
  mood: 'settingsMood',
  weather: 'settingsWeather',
  'media-privacy': 'settingsMediaPrivacy',
  'on-this-day': 'settingsOnThisDay',
  'data-maintenance': 'settingsDataMaintenance',
};

export const SETTINGS_ACTION_ROWS = {
  journalTools: ['openTimeline', 'detectImports'],
  moodExport: ['exportMoodCsvCommand', 'exportMoodJsonCommand'],
  metadataBackup: ['exportMetadataCommand', 'restoreMetadataCommand'],
  dataMaintenance: ['integrityCommand', 'importFrontmatterCommand'],
};

export function shouldShowWeatherSettings(settings) {
  return settings.weatherEnabled === true;
}

export function shouldShowCalendarWeatherOptions(settings) {
  return shouldShowWeatherSettings(settings);
}

export function shouldShowWeatherLocationOption(settings) {
  return shouldShowCalendarWeatherOptions(settings) && settings.showCalendarWeatherCard !== false;
}

export function shouldShowOnThisDayExcerptSettings(settings) {
  // The sidebar control is only one entry point; commands can always open On This Day.
  return true;
}

export function shouldShowExifGeocoding(settings) {
  return settings.showExif === true;
}

/**
 * Insert-time EXIF/GPS persistence is an opt-in write to the user's journal
 * frontmatter. The row resolves its strings through `t` (i18n) rather than the
 * frozen `_s` locale table so it works before the nine translations are
 * registered; `t` falls back to English and then to the raw key.
 */
export function addExifPersistMetadataSetting(containerEl, plugin, saveSettings = () => plugin.saveSettings()) {
  new Setting(containerEl)
    .setName(t(plugin.settings, 's_exifPersist'))
    .setDesc(t(plugin.settings, 's_exifPersistDesc'))
    .addToggle((toggle) => toggle
      .setValue(plugin.settings.exifPersistMetadata === true)
      .onChange(async (value) => {
        plugin.settings.exifPersistMetadata = value === true;
        await saveSettings();
      }));
}

export { shouldShowCalendarMoodStyle };

/* ============================================================
   Settings Tab
   ============================================================ */
export class DaylineSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this._pendingFieldFlushes = new Set();
  }

  async _saveSettings() {
    try {
      await this.plugin.saveSettings();
      return true;
    } catch (error) {
      const message = error?.message || String(error);
      console.warn('[Dayline] Settings save failed:', message);
      new Notice(t(this.plugin.settings, 'settingsSaveFailed', { error: message }));
      return false;
    }
  }

  _notifyViewRefreshFailure(error) {
    const message = error?.message || String(error);
    console.warn('[Dayline] Settings view refresh failed:', message);
    new Notice(t(this.plugin.settings, 'viewRefreshFailed', { error: message }));
  }

  _refreshCalendarView() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (!view) continue;
      view._syncNoteOverlays?.();
      const refresh = view.refresh?.();
      if (refresh?.catch) refresh.catch((error) => this._notifyViewRefreshFailure(error));
    }
  }

  async _refreshViews({ resetSource = false, throwOnError = false } = {}) {
    try {
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
    } catch (error) {
      if (throwOnError) throw error;
      this._notifyViewRefreshFailure(error);
    }
  }

  /**
   * Flush a debounced text field immediately, e.g. when the settings pane is
   * closed before the typing pause elapsed.
   */
  _flushPendingFieldCommits() {
    const pending = [...this._pendingFieldFlushes];
    this._pendingFieldFlushes.clear();
    for (const flush of pending) flush();
  }

  hide() {
    this._flushPendingFieldCommits();
    super.hide();
  }

  /**
   * Text settings fields commit on blur or after a short pause in typing, never
   * on every keystroke: intermediate values used to be saved and each one could
   * trigger several weather requests. Invalid text stays in the field with an
   * inline message and never reaches the settings object.
   */
  _bindValidatedTextField(text, { field, parse, showError, clearError, apply }) {
    let timer = null;
    const clearTimer = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };
    const commit = async () => {
      clearTimer();
      const result = parse(text.getValue());
      if (!result.ok) {
        showError(result.messageKey);
        return;
      }
      clearError();
      if (this.plugin.settings[field] === result.value) return;
      this.plugin.settings[field] = result.value;
      if (!(await this._saveSettings())) return;
      await apply();
    };
    const flush = () => { if (timer !== null) void commit(); };
    const schedule = () => {
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        void commit();
      }, SETTINGS_TEXT_COMMIT_DELAY_MS);
    };
    text.inputEl.addEventListener('input', schedule);
    text.inputEl.addEventListener('blur', () => { void commit(); });
    this._pendingFieldFlushes.add(flush);
  }

  _addValidatedTextField(containerEl, { name, description, placeholder, field, initialValue, parse, localizeError, apply }) {
    const setting = new Setting(containerEl).setName(name).setDesc(description);
    setting.addText((text) => {
      text.setPlaceholder(placeholder);
      text.setValue(String(initialValue));
      this._bindValidatedTextField(text, {
        field,
        parse,
        showError: (key) => setting.setDesc(localizeError(key)),
        clearError: () => setting.setDesc(description),
        apply,
      });
      return text;
    });
    return setting;
  }

  async _reloadMoodMetadataStore() {
    try {
      this.plugin.moodStore.configure(this.plugin.settings);
      await this.plugin.moodStore.load();
      await this.plugin.journalIndex.refresh(this.plugin.settings);
      this.plugin.refreshJournalViews();
    } catch (error) {
      const message = error?.message || String(error);
      console.warn('[Dayline] Mood metadata path change failed:', message);
      new Notice(t(this.plugin.settings, 'moodMetadataPathFailed'));
    }
  }

  /**
   * Settings action: convert every missing HEIC thumbnail in one run. The
   * background pre-warm stops at a per-session cap; this ignores it and reports
   * progress inline in the row's description.
   */
  async _fillHeicThumbCache(setting, button) {
    const plugin = this.plugin;
    if (!plugin.heicThumbStore?.enabled) {
      new Notice(t(plugin.settings, 'heicThumbCacheGenerateDisabled'));
      return;
    }
    if (typeof plugin.fillHeicThumbCache !== 'function') return;
    button?.setDisabled?.(true);
    const idleDescription = t(plugin.settings, 'heicThumbCacheGenerateDesc');
    try {
      const result = await plugin.fillHeicThumbCache(({ done, total }) => {
        setting?.setDesc?.(t(plugin.settings, 'heicThumbCacheGenerateProgress', { done, total }));
      });
      if (result?.skipped) {
        new Notice(t(plugin.settings, 'heicThumbCacheGenerateBusy'));
      } else {
        new Notice(t(plugin.settings, 'heicThumbCacheGenerateDone', { count: result?.converted ?? 0 }));
      }
    } finally {
      button?.setDisabled?.(false);
      setting?.setDesc?.(idleDescription);
    }
  }

  async _fillWeatherCoordinatesFromDevice(button) {
    // Commit text still pending in the coordinate fields first, so a stale
    // keystroke cannot overwrite the reading once it arrives.
    this._flushPendingFieldCommits();
    const settings = this.plugin.settings;
    button?.setDisabled?.(true);
    button?.setButtonText?.(t(settings, 'locating'));
    try {
      const coords = await requestCurrentCoordinates();
      const { clearedLocationName } = applyDeviceLocation(settings, coords);
      if (!(await this._saveSettings())) return;
      new Notice(t(settings, clearedLocationName ? 'locationUpdatedNameCleared' : 'locationUpdated'));
      this.display();
      await this._refreshViews();
    } catch (error) {
      // The provider message is English and platform-specific: log it for
      // debugging, show the localized code-based notice.
      console.debug('[Dayline] Geolocation failed:', error?.message || error);
      new Notice(t(settings, geolocationFailureKey(error)));
    } finally {
      button?.setDisabled?.(false);
      button?.setButtonText?.(t(this.plugin.settings, 'locateButton'));
    }
  }

  _addSection(containerEl, id) {
    const setting = new Setting(containerEl)
      .setName(t(this.plugin.settings, SETTINGS_SECTION_LABEL_KEYS[id]))
      .setHeading();
    setting.settingEl.dataset.daylineSettingsSection = id;
  }

  _addActionRow(setting, id) {
    setting.settingEl.addClass('dayline-settings-action-row');
    setting.settingEl.dataset.daylineSettingsActionRow = id;
    return setting;
  }

  display() {
    this._flushPendingFieldCommits();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('dayline-settings-container');
    const _s = createSettingsLocalizer(this.plugin.settings);

    renderSettingsBrand(containerEl, { markSvg: daylineLogoSvg, wordmarkSvg: compactWordmarkSvg });

    this._addSection(containerEl, 'general');

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'language'))
      .setDesc(t(this.plugin.settings, 'languageDesc'))
      .addDropdown((dd) => {
        fillDisplayLanguageDropdown(dd, this.plugin.settings);
        return dd
          .setValue(this.plugin.settings.displayLanguage)
          .onChange(async (value) => {
            this.plugin.settings.displayLanguage = value;
            this.plugin.settings.weatherLanguage = getDisplayLanguage({ displayLanguage: value });
            if (!(await this._saveSettings())) return;
            this.display();
            this._refreshCalendarView();
            this.plugin.refreshJournalViews();
          });
      });

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'weekStart'))
      .setDesc(t(this.plugin.settings, 'weekStartDesc'))
      .addDropdown((dd) => dd
        .addOption('system', t(this.plugin.settings, 'weekStartSystem'))
        .addOption('monday', t(this.plugin.settings, 'weekStartMonday'))
        .addOption('sunday', t(this.plugin.settings, 'weekStartSunday'))
        .setValue(this.plugin.settings.weekStart || 'system')
        .onChange(async (value) => {
          this.plugin.settings.weekStart = value;
          if (!(await this._saveSettings())) return;
          this._refreshCalendarView();
        }));

    this._addSection(containerEl, 'calendar-journal');

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'journalSources'));
    this.sourceEditor ??= new JournalSourceSettingsEditor(this.plugin, {
      chooseFolder: (onSubmit) => new FolderSuggestModal(this.app, onSubmit).open(),
      refreshCalendar: () => this._refreshViews({ resetSource: true, throwOnError: true }),
    });
    this.sourceEditor.mount(containerEl);

    new Setting(containerEl)
      .setName(_s('s_thumbnailFilter'))
      .setDesc(_s('s_thumbnailFilterDesc'))
      .addDropdown((dd) => dd
        .addOption('all', _s('s_thumbnailAll'))
        .addOption('date-prefixed', _s('s_thumbnailDate'))
        .setValue(this.plugin.settings.thumbnailFilter)
        .onChange(async (value) => {
          this.plugin.settings.thumbnailFilter = value;
          if (!(await this._saveSettings())) return;
          this._refreshCalendarView();
        }));

    this._addActionRow(new Setting(containerEl)
      .setName(t(this.plugin.settings, 'journalTools'))
      .setDesc(t(this.plugin.settings, 'journalToolsDesc')), 'journalTools')
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'openTimeline'))
        .onClick(() => this.plugin.activateTimeline()))
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'detectImports'))
        .onClick(async () => {
          const result = await this.plugin.journalIndex.detectSources(this.plugin.settings);
          new Notice(t(this.plugin.settings, 'detectImportsResult', result));
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showTimelineMoodTrend'))
      .setDesc(t(this.plugin.settings, 'showTimelineMoodTrendDesc'))
      .addToggle((toggle) => toggle
        .setValue(shouldShowTimelineMoodTrend(this.plugin.settings))
        .onChange(async (value) => {
          this.plugin.settings.showTimelineMoodTrend = value;
          if (!(await this._saveSettings())) return;
          this.plugin.refreshJournalViews();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showTimelineTitles'))
      .setDesc(t(this.plugin.settings, 'showTimelineTitlesDesc'))
      .addToggle((toggle) => toggle
        .setValue(shouldShowTimelineTitles(this.plugin.settings))
        .onChange(async (value) => {
          this.plugin.settings.showTimelineTitles = value;
          if (!(await this._saveSettings())) return;
          this.plugin.refreshJournalViews();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showCalendarMood'))
      .setDesc(t(this.plugin.settings, 'showCalendarMoodDesc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCalendarMood !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCalendarMood = value;
          if (!(await this._saveSettings())) return;
          this.display();
          await this._refreshViews();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showCalendarWrittenMarker'))
      .setDesc(t(this.plugin.settings, 'showCalendarWrittenMarkerDesc'))
      .addToggle((toggle) => toggle
        .setValue(shouldShowCalendarWrittenMarker(this.plugin.settings))
        .onChange(async (value) => {
          this.plugin.settings.showCalendarWrittenMarker = value;
          if (!(await this._saveSettings())) return;
          await this._refreshViews();
        }));

    if (shouldShowCalendarMoodStyle(this.plugin.settings)) {
      new Setting(containerEl)
        .setName(t(this.plugin.settings, 'calendarMoodMarker'))
        .setDesc(t(this.plugin.settings, 'calendarMoodMarkerDesc'))
        .addDropdown((dd) => dd
          .addOption('dot', t(this.plugin.settings, 'calendarMoodMarkerDot'))
          .addOption('bar', t(this.plugin.settings, 'calendarMoodMarkerBar'))
          .setValue(calendarMoodMarker(this.plugin.settings))
          .onChange(async (value) => {
            this.plugin.settings.calendarMoodMarker = value === 'bar' ? 'bar' : 'dot';
            if (!(await this._saveSettings())) return;
            await this._refreshViews();
          }));
    }

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showCalendarEntryCount'))
      .setDesc(t(this.plugin.settings, 'showCalendarEntryCountDesc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCalendarEntryCount !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCalendarEntryCount = value;
          if (!(await this._saveSettings())) return;
          await this._refreshViews();
        }));

    if (shouldShowCalendarWeatherOptions(this.plugin.settings)) {
      new Setting(containerEl)
        .setName(t(this.plugin.settings, 'showCalendarWeatherCard'))
        .setDesc(t(this.plugin.settings, 'showCalendarWeatherCardDesc'))
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.showCalendarWeatherCard !== false)
          .onChange(async (value) => {
            this.plugin.settings.showCalendarWeatherCard = value;
            if (!(await this._saveSettings())) return;
            this.display();
            await this._refreshViews();
          }));

      if (shouldShowWeatherLocationOption(this.plugin.settings)) {
        new Setting(containerEl)
          .setName(t(this.plugin.settings, 'showCalendarWeatherLocation'))
          .setDesc(t(this.plugin.settings, 'showCalendarWeatherLocationDesc'))
          .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.showCalendarWeatherLocation === true)
            .onChange(async (value) => {
              this.plugin.settings.showCalendarWeatherLocation = value;
              if (!(await this._saveSettings())) return;
              await this._refreshViews();
            }));
      }

      new Setting(containerEl)
        .setName(t(this.plugin.settings, 'showCalendarWeatherBadge'))
        .setDesc(t(this.plugin.settings, 'showCalendarWeatherBadgeDesc'))
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.showCalendarWeatherBadge !== false)
          .onChange(async (value) => {
            this.plugin.settings.showCalendarWeatherBadge = value;
            if (!(await this._saveSettings())) return;
            await this._refreshViews();
          }));
    }

    this._addSection(containerEl, 'mood');

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'mirrorMood'))
      .setDesc(t(this.plugin.settings, 'mirrorMoodDesc'))
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.settings.mirrorMoodToFrontmatter))
        .onChange(async (value) => {
          this.plugin.settings.mirrorMoodToFrontmatter = value;
          await this._saveSettings();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'reminder'))
      .setDesc(t(this.plugin.settings, 'reminderDesc'))
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.settings.reminderEnabled))
        .onChange(async (value) => {
          this.plugin.settings.reminderEnabled = value;
          await this._saveSettings();
        }))
      .addExtraButton((button) => button
        .setIcon('clock-3')
        .setTooltip(t(this.plugin.settings, 'reminderHour'))
        .onClick(() => {
          const value = window.prompt(t(this.plugin.settings, 'reminderHourPrompt'), String(this.plugin.settings.reminderHour ?? 21));
          const hour = Number(value);
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
            this.plugin.settings.reminderHour = hour;
            void this._saveSettings();
          }
        }));

    this._addSection(containerEl, 'weather');

    new Setting(containerEl)
      .setName(_s('s_weatherEnable'))
      .setDesc(_s('s_weatherEnableDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.weatherEnabled)
          .onChange(async (value) => {
            this.plugin.settings.weatherEnabled = value;
            if (!(await this._saveSettings())) return;
            this.display();
            await this._refreshViews();
          })
      );

    if (shouldShowWeatherSettings(this.plugin.settings)) {

    this._addValidatedTextField(containerEl, {
      name: _s('s_latitude'),
      description: _s('s_latitudeDesc'),
      placeholder: '39.9042',
      field: 'weatherLatitude',
      initialValue: this.plugin.settings.weatherLatitude,
      parse: (raw) => parseCoordinateSettingValue('latitude', raw),
      localizeError: (key) => t(this.plugin.settings, key),
      apply: () => this._refreshViews(),
    });

    this._addValidatedTextField(containerEl, {
      name: _s('s_longitude'),
      description: _s('s_longitudeDesc'),
      placeholder: '116.4074',
      field: 'weatherLongitude',
      initialValue: this.plugin.settings.weatherLongitude,
      parse: (raw) => parseCoordinateSettingValue('longitude', raw),
      localizeError: (key) => t(this.plugin.settings, key),
      apply: () => this._refreshViews(),
    });

    if (shouldShowUseCurrentLocationButton(this.plugin.capabilities)) {
      new Setting(containerEl)
        .setName(t(this.plugin.settings, 'useCurrentLocation'))
        .setDesc(t(this.plugin.settings, 'useCurrentLocationDesc'))
        .addButton((button) => button
          .setButtonText(t(this.plugin.settings, 'locateButton'))
          .onClick(async () => {
            await this._fillWeatherCoordinatesFromDevice(button);
          }));
    }

    new Setting(containerEl)
      .setName(_s('s_locationName'))
      .setDesc(_s('s_locationNameDesc'))
      .addText((text) =>
        text
          .setPlaceholder(_s('s_locationName'))
          .setValue(String(this.plugin.settings.weatherLocationName))
          .onChange(async (value) => {
            this.plugin.settings.weatherLocationName = value.trim();
            if (!(await this._saveSettings())) return;
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
            if (!(await this._saveSettings())) return;
            await this._refreshViews();
          })
      );

    const weatherFieldsSetting = new Setting(containerEl)
      .setName(t(this.plugin.settings, 'weatherExtraFields'))
      .setDesc(t(this.plugin.settings, 'weatherExtraFieldsDesc'));
    weatherFieldsSetting.settingEl.addClass('dayline-weather-fields-setting');
    {
        const control = weatherFieldsSetting.controlEl.createDiv({ cls: 'dayline-weather-field-options' });
        const fields = [
          ['feels', 'weatherFieldFeels'],
          ['humidity', 'weatherFieldHumidity'],
          ['low', 'weatherFieldLow'],
          ['precipitation', 'weatherFieldPrecipitation'],
          ['wind', 'weatherFieldWind'],
          ['sunrise', 'weatherFieldSunrise'],
          ['sunset', 'weatherFieldSunset'],
        ];
        const selected = new Set(Array.isArray(this.plugin.settings.weatherDisplayFields)
          ? this.plugin.settings.weatherDisplayFields
          : ['feels', 'humidity']);
        for (const [value, labelKey] of fields) {
          const label = control.createEl('label', { cls: 'dayline-weather-field-option' });
          const input = label.createEl('input', { attr: { type: 'checkbox', value } });
          input.checked = selected.has(value);
          label.createSpan({ text: t(this.plugin.settings, labelKey) });
          const applyDisplayField = async () => {
            if (input.checked) selected.add(value); else selected.delete(value);
            this.plugin.settings.weatherDisplayFields = fields.map(([key]) => key).filter((key) => selected.has(key));
            if (!(await this._saveSettings())) return;
            await this._refreshViews();
          };
          input.addEventListener('change', () => { void applyDisplayField(); });
        }
    }

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'weatherTimezone'))
      .setDesc(t(this.plugin.settings, 'weatherTimezoneDesc'))
      .addText((text) => text
        .setPlaceholder(t(this.plugin.settings, 'timezonePlaceholder'))
        .setValue(String(this.plugin.settings.weatherTimezone || 'auto'))
        .onChange(async (value) => {
          this.plugin.settings.weatherTimezone = value.trim() || 'auto';
          if (!(await this._saveSettings())) return;
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
            await this._saveSettings();
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
            if (!(await this._saveSettings())) return;
            await this._refreshViews();
          })
      );

    }

    this._addSection(containerEl, 'media-privacy');

    new Setting(containerEl)
      .setName(_s('s_exifEnable'))
      .setDesc(_s('s_exifEnableDesc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showExif)
        .onChange(async (value) => {
          this.plugin.settings.showExif = value;
          if (!(await this._saveSettings())) return;
          this.display();
        }));

    addExifPersistMetadataSetting(containerEl, this.plugin, () => this._saveSettings());

    if (shouldShowExifGeocoding(this.plugin.settings)) {
      new Setting(containerEl)
        .setName(_s('s_exifGeocode'))
        .setDesc(_s('s_exifGeocodeDesc'))
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.exifReverseGeocode)
          .onChange(async (value) => {
            this.plugin.settings.exifReverseGeocode = value;
            await this._saveSettings();
          }));
    }

    this._addValidatedTextField(containerEl, {
      name: t(this.plugin.settings, 'heicThumbCachePath'),
      description: t(this.plugin.settings, 'heicThumbCachePathDesc'),
      placeholder: DEFAULT_HEIC_THUMB_CACHE_DIR,
      field: 'heicThumbCachePath',
      initialValue: this.plugin.settings.heicThumbCachePath ?? DEFAULT_HEIC_THUMB_CACHE_DIR,
      parse: (raw) => normalizeHeicThumbCachePath(raw),
      localizeError: (key) => t(this.plugin.settings, key),
      apply: () => { this.plugin.heicThumbStore?.reconfigure?.(); },
    });

    if (shouldShowHeicThumbCacheGenerate(this.plugin.capabilities)) {
      const generateRow = new Setting(containerEl)
        .setName(t(this.plugin.settings, 'heicThumbCacheGenerate'))
        .setDesc(t(this.plugin.settings, 'heicThumbCacheGenerateDesc'));
      generateRow.addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'heicThumbCacheGenerate'))
        .onClick(async () => {
          await this._fillHeicThumbCache(generateRow, button);
        }));
    }

    this._addSection(containerEl, 'on-this-day');

    new Setting(containerEl)
      .setName(_s('s_otdEntry'))
      .setDesc(_s('s_otdEntryDesc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            off: _s('s_otdEntryOff'),
            merged: _s('s_otdEntryMerged'),
            header: _s('s_otdEntryHeader'),
          })
          .setValue(normalizeOnThisDayEntryMode(this.plugin.settings))
          .onChange(async (value) => {
            this.plugin.settings.onThisDayEntry = normalizeOnThisDayEntryMode({ onThisDayEntry: value });
            this.plugin.settings.onThisDayButton = this.plugin.settings.onThisDayEntry !== 'off';
            if (!(await this._saveSettings())) return;
            this.display();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.render();
          })
      );

    if (shouldShowOnThisDayExcerptSettings(this.plugin.settings)) {
      new Setting(containerEl)
        .setName(_s('s_otdExcerptMode'))
        .setDesc(_s('s_otdExcerptModeDesc'))
        .addDropdown((dropdown) => dropdown
          .addOptions({
            auto: _s('s_otdExcerptAuto'),
            frontmatter: _s('s_otdExcerptFrontmatter'),
            template: _s('s_otdExcerptTemplate'),
            none: _s('s_otdExcerptNone'),
          })
          .setValue(this.plugin.settings.onThisDayExcerptMode)
          .onChange(async (value) => {
            this.plugin.settings.onThisDayExcerptMode = value;
            if (!(await this._saveSettings())) return;
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            leaf?.view?._otdProvider?.invalidate();
            this.display();
          }));

      if (this.plugin.settings.onThisDayExcerptMode === 'frontmatter') {
        new Setting(containerEl)
          .setName(_s('s_otdExcerptKey'))
          .setDesc(_s('s_otdExcerptKeyDesc'))
          .addText((text) => text
            .setValue(this.plugin.settings.onThisDayExcerptKey || 'excerpt')
            .onChange(async (value) => {
              this.plugin.settings.onThisDayExcerptKey = value;
              if (!(await this._saveSettings())) return;
              this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?._otdProvider?.invalidate();
            }));
      }

      if (this.plugin.settings.onThisDayExcerptMode === 'template') {
        new Setting(containerEl)
          .setName(_s('s_otdTemplate'))
          .setDesc(_s('s_otdTemplateDesc'))
          .addText((text) => text
            .setValue(this.plugin.settings.onThisDayExcerptTemplate || '{body}')
            .onChange(async (value) => {
              this.plugin.settings.onThisDayExcerptTemplate = value;
              if (!(await this._saveSettings())) return;
              this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?._otdProvider?.invalidate();
            }));
      }
    }

    this._addSection(containerEl, 'data-maintenance');

    this._addValidatedTextField(containerEl, {
      name: t(this.plugin.settings, 'moodMetadataPath'),
      description: t(this.plugin.settings, 'moodMetadataPathDesc'),
      placeholder: DEFAULT_MOOD_METADATA_PATH,
      field: 'moodMetadataPath',
      initialValue: this.plugin.settings.moodMetadataPath,
      parse: (raw) => normalizeMoodMetadataPath(raw),
      localizeError: (key) => t(this.plugin.settings, key),
      apply: () => this._reloadMoodMetadataStore(),
    });

    this._addActionRow(new Setting(containerEl)
      .setName(t(this.plugin.settings, 'moodExport'))
      .setDesc(t(this.plugin.settings, 'moodExportDesc')), 'moodExport')
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'exportMoodCsvCommand'))
        .onClick(() => this.plugin.exportMood('csv')))
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'exportMoodJsonCommand'))
        .onClick(() => this.plugin.exportMood('json')));

    this._addActionRow(new Setting(containerEl)
      .setName(t(this.plugin.settings, 'metadataBackup'))
      .setDesc(t(this.plugin.settings, 'metadataBackupDesc')), 'metadataBackup')
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'exportMetadataCommand'))
        .onClick(async () => {
          try {
            const path = await this.plugin.moodStore.exportTo();
            new Notice(t(this.plugin.settings, 'metadataExported', { path }));
          } catch (error) {
            new Notice(t(this.plugin.settings, 'metadataExportFailed', { error: error?.message || error }));
          }
        }))
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'restoreMetadataCommand'))
        .onClick(async () => {
          try {
            await this.plugin.moodStore.restoreBackup();
            await this.plugin.journalIndex.refresh(this.plugin.settings);
            this.plugin.refreshJournalViews();
            new Notice(t(this.plugin.settings, 'metadataRestored'));
          } catch (error) {
            new Notice(t(this.plugin.settings, 'metadataRestoreFailed', { error: error?.message || error }));
          }
        }));

    this._addActionRow(new Setting(containerEl)
      .setName(t(this.plugin.settings, 'dataMaintenance'))
      .setDesc(t(this.plugin.settings, 'dataMaintenanceDesc')), 'dataMaintenance')
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'integrityCommand'))
        .onClick(async () => {
          const result = await this.plugin.moodStore.checkIntegrity();
          new Notice(result.valid
            ? t(this.plugin.settings, 'metadataValid')
            : t(this.plugin.settings, 'metadataIntegrityIssues', {
              metadata: result.invalidMetadata.length,
              records: result.invalidRecords.length,
              orphans: result.invalidOrphans.length,
              missing: result.missingFiles.length,
            }));
        }))
      .addButton((button) => button
        .setButtonText(t(this.plugin.settings, 'importFrontmatterCommand'))
        .onClick(async () => {
          const count = await this.plugin.moodStore.importFrontmatter(
            this.plugin.journalIndex.getEntries().map((entry) => entry.path),
            this.app.metadataCache,
          );
          await this.plugin.journalIndex.refresh(this.plugin.settings);
          this.plugin.refreshJournalViews();
          new Notice(t(this.plugin.settings, 'importedMoods', { count }));
        }));

    const orphanCount = Object.keys(this.plugin.moodStore?.getOrphans?.() || {}).length;
    if (orphanCount > 0) {
      new Setting(containerEl)
        .setName(t(this.plugin.settings, 'moodRecoveryTitle'))
        .setDesc(t(this.plugin.settings, 'moodRecoveryDescription'))
        .addButton((button) => button
          .setButtonText(t(this.plugin.settings, 'moodRecoveryCommand'))
          .onClick(() => this.plugin.openMoodRecovery()));
    }

    if (shouldShowWeatherSettings(this.plugin.settings)) {
      new Setting(containerEl)
        .setName(_s('s_backfill'))
        .setDesc(_s('s_backfillDesc'))
        .addButton((btn) => btn
          .setButtonText(_s('s_backfillBtn'))
          .onClick(async () => {
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.startWeatherBackfill();
          }));
    }
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
    el.createSpan({ text: folder.path });
  }

  onChooseSuggestion(folder) {
    this.onSubmit(folder.path);
  }
}
