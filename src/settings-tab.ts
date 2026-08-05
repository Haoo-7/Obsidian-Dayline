// @ts-nocheck
const { PluginSettingTab, Setting, Notice, SuggestModal, TFolder } = require('obsidian');
const { t } = require('./i18n');
const { localize: _l } = require('./locale');

const VIEW_TYPE = 'calendar-sidebar-view';

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
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const refresh = leaf?.view?.refresh?.();
    if (refresh?.catch) refresh.catch((error) => this._notifyViewRefreshFailure(error));
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
            if (!(await this._saveSettings())) return;
            await this._refreshViews({ resetSource: true });
          });
      })
      .addExtraButton((btn) => {
        btn.setIcon('folder-search')
          .setTooltip(_s('s_browseFolders'))
          .onClick(() => {
            new FolderSuggestModal(this.app, (path) => {
              this.plugin.settings.dailyFolder = path;
              void this._saveSettings().then((saved) => {
                if (saved) return this._refreshViews({ resetSource: true });
              }).catch((error) => {
                const message = error?.message || String(error);
                this._notifyViewRefreshFailure({ message });
              });
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
            if (!(await this._saveSettings())) return;
            this._refreshCalendarView();
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
          if (!(await this._saveSettings())) return;
          await this._refreshViews();
        }));

    new Setting(containerEl)
      .setName(t(this.plugin.settings, 'showCalendarWeatherCard'))
      .setDesc(t(this.plugin.settings, 'showCalendarWeatherCardDesc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCalendarWeatherCard !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCalendarWeatherCard = value;
          if (!(await this._saveSettings())) return;
          await this._refreshViews();
        }));

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
            if (!(await this._saveSettings())) return;
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
          if (!(await this._saveSettings())) return;
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
        .setTooltip('Reminder hour')
        .onClick(() => {
          const value = window.prompt('Reminder hour (0-23)', String(this.plugin.settings.reminderHour ?? 21));
          const hour = Number(value);
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
            this.plugin.settings.reminderHour = hour;
            void this._saveSettings();
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
            if (!(await this._saveSettings())) return;
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
            if (!(await this._saveSettings())) return;
            this.display();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view._syncNoteOverlays();
            this._refreshCalendarView();
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
            if (!(await this._saveSettings())) return;
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
            if (!(await this._saveSettings())) return;
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
              if (!(await this._saveSettings())) return;
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
              if (!(await this._saveSettings())) return;
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
            await this._saveSettings();
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
            await this._saveSettings();
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
