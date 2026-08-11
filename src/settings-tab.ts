// @ts-nocheck
import { Notice, PluginSettingTab, Setting, SuggestModal, TFolder } from 'obsidian';
import { getDisplayLanguage, t } from './i18n';
import { localize as _l } from './locale';
import compactWordmarkSvg from '../assets/dayline-wordmark-compact.svg';
import { shouldShowTimelineMoodTrend } from './journal-timeline-display';

const VIEW_TYPE = 'calendar-sidebar-view';

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

/* ============================================================
   Settings Tab
   ============================================================ */
export class DaylineSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
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

  async _refreshViews({ resetSource = false } = {}) {
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
      this._notifyViewRefreshFailure(error);
    }
  }

  _addSection(containerEl, id) {
    const heading = containerEl.createEl('h3', { text: t(this.plugin.settings, SETTINGS_SECTION_LABEL_KEYS[id]) });
    heading.dataset.daylineSettingsSection = id;
  }

  _addActionRow(setting, id) {
    setting.settingEl.addClass('dayline-settings-action-row');
    setting.settingEl.dataset.daylineSettingsActionRow = id;
    return setting;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const _s = (key, ...args) => _l(this.plugin.settings.weatherLanguage, key, ...args);

    const brand = containerEl.createDiv({ cls: 'dayline-settings-brand', attr: { 'aria-label': 'Dayline' } });
    try {
      const parsed = new DOMParser().parseFromString(compactWordmarkSvg, 'image/svg+xml');
      const svg = parsed.documentElement;
      if (svg?.tagName?.toLowerCase() === 'svg' && !parsed.querySelector('parsererror')) {
        parsed.querySelectorAll('script').forEach((script) => script.remove());
        parsed.querySelectorAll('*').forEach((node) => {
          for (const attribute of Array.from(node.attributes)) {
            if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name);
          }
        });
        const clone = document.importNode(svg, true);
        clone.setAttribute('role', 'img');
        clone.setAttribute('aria-label', 'Dayline');
        clone.setAttribute('width', '132');
        clone.setAttribute('height', '32');
        brand.appendChild(clone);
      }
    } catch (_) {
      brand.setText('Dayline');
    }

    this._addSection(containerEl, 'general');

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'language'))
      .setDesc(t(this.plugin.settings, 'languageDesc'))
      .addDropdown((dd) => dd
        .addOption('system', t(this.plugin.settings, 'system'))
        .addOption('en', t(this.plugin.settings, 'english'))
        .addOption('zh', t(this.plugin.settings, 'chinese'))
        .setValue(this.plugin.settings.displayLanguage)
        .onChange(async (value) => {
          this.plugin.settings.displayLanguage = value;
          this.plugin.settings.weatherLanguage = getDisplayLanguage({ displayLanguage: value });
          if (!(await this._saveSettings())) return;
          this.display();
          this._refreshCalendarView();
          this.plugin.refreshJournalViews();
        }));

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
      .setName(_s('s_dailyFolder'))
      .setDesc(_s('s_dailyFolderDesc'))
      .addSearch((cb) => {
        this.folderInput = cb;
        cb.setValue(this.plugin.settings.dailyFolder)
          .setPlaceholder('Calendar/Daily')
          .onChange(async (value) => {
            this.plugin.settings.dailyFolder = value.replace(/\/+$/, '');
            if (!(await this._saveSettings())) return;
            await this._refreshViews({ resetSource: true });
          });
      })
      .addExtraButton((btn) => btn
        .setIcon('folder-search')
        .setTooltip(_s('s_browseFolders'))
        .onClick(() => {
          new FolderSuggestModal(this.app, (path) => {
            this.plugin.settings.dailyFolder = path;
            void this._saveSettings().then((saved) => {
              if (saved) return this._refreshViews({ resetSource: true });
            }).catch((error) => this._notifyViewRefreshFailure(error));
            this.folderInput.setValue(path);
          }).open();
        }));

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
            if (!(await this._saveSettings())) return;
            await this.plugin.journalIndex.refresh(this.plugin.settings);
            this.plugin.refreshJournalViews();
          } catch (_) {
            new Notice(t(this.plugin.settings, 'invalidJournalSources'));
          }
        });
      });

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
      .setName(t(this.plugin.settings, 'showCalendarMood'))
      .setDesc(t(this.plugin.settings, 'showCalendarMoodDesc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCalendarMood !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCalendarMood = value;
          if (!(await this._saveSettings())) return;
          await this._refreshViews();
        }));

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

    new Setting(containerEl)
      .setName(_s('s_latitude'))
      .setDesc(_s('s_latitudeDesc'))
      .addText((text) =>
        text
          .setPlaceholder('39.9042')
          .setValue(String(this.plugin.settings.weatherLatitude))
          .onChange(async (value) => {
            this.plugin.settings.weatherLatitude = value.trim();
            if (!(await this._saveSettings())) return;
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
            if (!(await this._saveSettings())) return;
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
          input.addEventListener('change', async () => {
            if (input.checked) selected.add(value); else selected.delete(value);
            this.plugin.settings.weatherDisplayFields = fields.map(([key]) => key).filter((key) => selected.has(key));
            if (!(await this._saveSettings())) return;
            await this._refreshViews();
          });
        }
    }

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'weatherTimezone'))
      .setDesc(t(this.plugin.settings, 'weatherTimezoneDesc'))
      .addText((text) => text
        .setPlaceholder('auto or Asia/Shanghai')
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

    this._addSection(containerEl, 'on-this-day');

    new Setting(containerEl)
      .setName(_s('s_otdButton'))
      .setDesc(_s('s_otdButtonDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.onThisDayButton)
          .onChange(async (value) => {
            this.plugin.settings.onThisDayButton = value;
            if (!(await this._saveSettings())) return;
            this.display();
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
            if (!(await this._saveSettings())) return;
            this._refreshCalendarView();
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

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'moodMetadataPath'))
      .setDesc(t(this.plugin.settings, 'moodMetadataPathDesc'))
      .addText((text) => text
        .setValue(this.plugin.settings.moodMetadataPath)
        .setPlaceholder('Calendar/journal-metadata.json')
        .onChange(async (value) => {
          const next = value.trim() || 'Calendar/journal-metadata.json';
          this.plugin.settings.moodMetadataPath = next;
          if (!(await this._saveSettings())) return;
          this.plugin.moodStore.configure(this.plugin.settings);
          await this.plugin.moodStore.load();
          await this.plugin.journalIndex.refresh(this.plugin.settings);
          this.plugin.refreshJournalViews();
        }));

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
    el.createEl('span', { text: folder.path });
  }

  onChooseSuggestion(folder) {
    this.onSubmit(folder.path);
  }
}
