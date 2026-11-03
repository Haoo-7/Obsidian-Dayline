// @ts-nocheck
import { setIcon } from 'obsidian';
import { getTodayDate, normalizeVaultPath } from './date-utils';
import { t } from './i18n';
import { parseDailyNotePath, resolveDailyNoteConfig, resolveDailyNoteTarget } from './daily-note';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function validateJournalSources(value, dailyFolder) {
  if (!Array.isArray(value)) throw new Error('sourceInvalidArray');
  const ids = new Set();
  const paths = new Set();
  let daily = false;
  // The daily source decides what indexing reads while note creation, mood
  // writes, and the reminder all use the daily folder. Require them to agree so
  // newly created journals cannot fall outside the indexed timeline.
  const normalizedDailyFolder = typeof dailyFolder === 'string' ? normalizeVaultPath(dailyFolder) : null;
  return value.map((source, index) => {
    const fail = (key) => { throw Object.assign(new Error(key), { row: index + 1 }); };
    if (!source || typeof source !== 'object' || Array.isArray(source)) fail('sourceInvalidRow');
    if (typeof source.path !== 'string' || !source.path.trim()) fail('sourcePathRequired');
    // "/" is the vault root and normalizes to an empty path; store it back as
    // "/" so an empty path keeps meaning "unset". A blank field stays an
    // unfinished row, and an explicit . or .. segment is still rejected.
    const path = normalizeVaultPath(source.path.trim());
    if (path.split('/').some(part => part === '.' || part === '..')) fail('sourcePathRequired');
    for (const key of ['id', 'label', 'dateField']) {
      if (source[key] !== undefined && typeof source[key] !== 'string') fail('sourceInvalidRow');
    }
    if (source.enabled !== undefined && typeof source.enabled !== 'boolean') fail('sourceInvalidRow');
    const type = source.type ?? 'external';
    if (type !== 'daily' && type !== 'external') fail('sourceInvalidType');
    const id = source.id?.trim() || `source-${index + 1}`;
    if (ids.has(id)) fail('sourceDuplicateId');
    ids.add(id);
    if (source.enabled !== false) {
      if (paths.has(path)) fail('sourceDuplicatePath');
      if (type === 'daily' && daily) fail('sourceMultipleDaily');
      if (type === 'daily' && normalizedDailyFolder !== null && path !== normalizedDailyFolder) {
        fail('sourceDailyMismatch');
      }
      paths.add(path);
      daily ||= type === 'daily';
    }
    return { ...source, id, path: path || '/', type };
  });
}

export class JournalSourceSettingsEditor {
  constructor(plugin, { chooseFolder, chooseTemplate, refreshCalendar }) {
    this.plugin = plugin;
    this.chooseFolder = chooseFolder;
    this.chooseTemplate = chooseTemplate;
    this.refreshCalendar = refreshCalendar;
    this.reset();
  }

  reset() {
    this.followDailyNotes = this.plugin.settings.followDailyNotes === true;
    const dailyFolder = this.plugin.settings.dailyFolder;
    // The vault root is shown as "/". A missing or empty setting keeps the
    // default folder, which is what older builds stored when the field was
    // cleared, so showing "/" there would flip those vaults to the root.
    this.dailyFolder = typeof dailyFolder === 'string' && dailyFolder.trim().length > 0
      ? (normalizeVaultPath(dailyFolder) || '/')
      : 'Calendar/Daily';
    const custom = resolveDailyNoteConfig(this.plugin.app, { ...this.plugin.settings, followDailyNotes: false });
    this.dailyNoteFormat = custom.format;
    this.dailyNoteTemplate = custom.template;
    this.sources = clone(this.plugin.settings.journalSources || []);
    this.jsonOpen = false;
    this.raw = '';
    this.dirty = false;
    this.error = null;
    this.saved = false;
  }

  label(key, values = {}) { return t(this.plugin.settings, key, values); }

  changed() {
    this.dirty = true;
    this.saved = false;
    this.error = null;
    this.updateState();
  }

  mount(container) {
    if (!this.dirty && !this.busy) this.reset();
    this.root = container.createDiv({ cls: 'dayline-source-editor' });
    this.fields = this.root.createDiv();
    this.renderFields();
    this.status = this.root.createDiv({ cls: 'dayline-source-status', attr: { 'aria-live': 'polite' } });
    const actions = this.root.createDiv({ cls: 'dayline-source-actions' });
    this.applyButton = actions.createEl('button', {
      text: this.label('sourceApply'), cls: 'mod-cta', attr: { type: 'button' },
    });
    this.applyButton.addEventListener('click', () => { void this.apply(); });
    this.resetButton = actions.createEl('button', { text: this.label('discardChanges'), attr: { type: 'button' } });
    this.resetButton.addEventListener('click', () => {
      if (this.busy) return;
      this.reset();
      this.renderFields();
      this.updateState();
      this.fields.querySelector('input')?.focus();
    });
    this.updateState();
  }

  input(parent, key, value, onChange, options = {}) {
    const label = parent.createEl('label', { cls: 'dayline-source-field' });
    label.createSpan({ text: this.label(key) });
    const input = label.createEl('input', { attr: { type: 'text', 'aria-label': this.label(key), ...options } });
    input.value = value || '';
    input.addEventListener('input', () => {
      if (this.busy || input.disabled) return;
      onChange(input.value);
      this.changed();
    });
    return input;
  }

  iconButton(parent, key, icon, callback) {
    const button = parent.createEl('button', {
      cls: 'dayline-source-icon clickable-icon',
      attr: { type: 'button', 'aria-label': this.label(key), title: this.label(key) },
    });
    setIcon(button, icon);
    button.addEventListener('click', () => { if (!this.busy) callback(); });
    return button;
  }

  folderField(parent, key, value, onChange) {
    const row = parent.createDiv({ cls: 'dayline-source-folder' });
    const input = this.input(row, key, value, onChange);
    this.iconButton(row, 'sourceBrowse', 'folder-search', () => this.chooseFolder(path => {
      if (this.busy || input.disabled || !input.isConnected) return;
      input.value = path;
      onChange(path);
      this.changed();
      input.focus();
    }));
    return input;
  }

  renderFields() {
    this.fields.empty();
    const config = resolveDailyNoteConfig(this.plugin.app, this.draftSettings());
    const daily = this.fields.createDiv({ cls: 'dayline-source-daily-fields' });
    daily.hidden = this.followDailyNotes;
    this.folderField(daily, 'sourceDailyFolder', this.followDailyNotes ? config.folder : this.dailyFolder,
      value => { this.dailyFolder = value; }).placeholder = '/';
    this.input(daily, 'sourceDailyFormat', this.followDailyNotes ? config.format : this.dailyNoteFormat,
      value => { this.dailyNoteFormat = value; }, { placeholder: 'YYYY/MM/YYYY-MM-DD' });
    const templateRow = daily.createDiv({ cls: 'dayline-source-folder' });
    const template = this.input(templateRow, 'sourceDailyTemplate',
      this.followDailyNotes ? config.template : this.dailyNoteTemplate,
      value => { this.dailyNoteTemplate = value; }, { placeholder: this.label('sourceDailyNoTemplate') });
    if (this.chooseTemplate) {
      this.iconButton(templateRow, 'sourceDailyTemplate', 'file-search', () => this.chooseTemplate(path => {
        if (this.busy || template.disabled || !template.isConnected) return;
        template.value = this.dailyNoteTemplate = path;
        this.changed();
        template.focus();
      }));
    }
    this.preview = this.fields.createEl('output', { cls: 'dayline-source-preview', attr: { 'aria-live': 'polite' } });
    const follow = this.fields.createEl('label', { cls: 'dayline-source-follow dayline-source-enabled' });
    const checkbox = follow.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = this.followDailyNotes;
    follow.createSpan({ text: this.label('sourceFollowDailyNotes') });
    checkbox.addEventListener('change', () => {
      this.followDailyNotes = checkbox.checked;
      this.renderFields();
      this.changed();
      this.fields.querySelector('.dayline-source-follow input')?.focus();
    });
    if (this.followDailyNotes) {
      const official = this.fields.createDiv({
        cls: 'dayline-source-official',
        attr: { role: 'region', 'aria-label': this.label('sourceDailyOfficial') },
      });
      official.createEl('p', { cls: 'dayline-source-official-title', text: this.label('sourceDailyOfficial') });
      const values = official.createEl('dl', { cls: 'dayline-source-official-values' });
      for (const [key, value] of [
        ['sourceFolder', config.folder || '/'],
        ['sourceDailyFormat', config.format],
        ['sourceDailyTemplate', config.template || this.label('sourceDailyNoTemplate')],
      ]) {
        values.createEl('dt', { text: this.label(key) });
        values.createEl('dd', { text: value });
      }
      official.append(this.preview);
    }
    const list = this.fields.createDiv({ cls: 'dayline-source-list' });
    list.hidden = this.jsonOpen;
    if (!Array.isArray(this.sources)) {
      this.jsonOpen = true;
      this.raw = JSON.stringify(this.sources, null, 2);
      list.hidden = true;
    } else {
      for (const [index, source] of this.sources.entries()) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
          this.jsonOpen = true;
          this.raw = JSON.stringify(this.sources, null, 2);
          list.hidden = true;
          break;
        }
        const row = list.createEl('fieldset', { cls: 'dayline-source-row' });
        row.createEl('legend', { text: this.label('sourceNumber', { number: index + 1 }) });
        this.folderField(row, 'sourceFolder', source.path, value => { source.path = value; });
        this.input(row, 'sourceName', source.label, value => { source.label = value; });
        const typeLabel = row.createEl('label', { cls: 'dayline-source-field' });
        typeLabel.createSpan({ text: this.label('sourceType') });
        const type = typeLabel.createEl('select', { cls: 'dropdown' });
        for (const [value, key] of [['external', 'sourceExternal'], ['daily', 'sourceDaily']]) {
          type.createEl('option', { text: this.label(key), attr: { value } });
        }
        type.value = source.type || 'external';
        type.addEventListener('change', () => { source.type = type.value; this.changed(); });
        this.input(row, 'sourceDateField', source.dateField, value => { source.dateField = value; });
        const tools = row.createDiv({ cls: 'dayline-source-row-actions' });
        const enabledLabel = tools.createEl('label', { cls: 'dayline-source-enabled' });
        const enabled = enabledLabel.createEl('input', { attr: { type: 'checkbox' } });
        enabled.checked = source.enabled !== false;
        enabledLabel.createSpan({ text: this.label('sourceEnabled') });
        enabled.addEventListener('change', () => { source.enabled = enabled.checked; this.changed(); });
        this.iconButton(tools, 'sourceRemove', 'trash-2', () => {
          this.sources.splice(index, 1);
          this.renderFields();
          this.changed();
          const rows = this.fields.querySelectorAll('.dayline-source-row');
          (rows[Math.min(index, rows.length - 1)]?.querySelector('input') || this.addButton).focus();
        });
      }
      if (!this.sources.length) list.createEl('p', { cls: 'setting-item-description', text: this.label('sourceNoAdditional') });
    }
    this.addButton = list.createEl('button', { attr: { type: 'button' }, cls: 'dayline-source-add' });
    setIcon(this.addButton.createSpan(), 'plus');
    this.addButton.createSpan({ text: this.label('sourceAdd') });
    this.addButton.addEventListener('click', () => {
      const ids = new Set(this.sources.map((source, index) => source.id || `source-${index + 1}`));
      let number = 1;
      while (ids.has(`source-${number}`)) number++;
      this.sources.push({ id: `source-${number}`, path: '', type: 'external', enabled: true });
      this.renderFields();
      this.changed();
      this.fields.querySelector('.dayline-source-row:last-of-type input')?.focus();
    });
    const advanced = this.fields.createEl('details', { cls: 'dayline-source-advanced' });
    advanced.open = this.jsonOpen;
    const summary = advanced.createEl('summary', { text: this.label('sourceAdvanced') });
    const json = advanced.createEl('textarea', {
      attr: { rows: '7', spellcheck: 'false', 'aria-label': this.label('sourceAdvanced') },
    });
    json.value = this.jsonOpen ? this.raw : JSON.stringify(this.sources, null, 2);
    json.addEventListener('input', () => { this.raw = json.value; this.changed(); });
    advanced.addEventListener('toggle', () => {
      if (!advanced.isConnected || advanced.open === this.jsonOpen) return;
      if (this.busy) { advanced.open = this.jsonOpen; return; }
      if (advanced.open) {
        this.jsonOpen = true;
        json.value = this.raw = JSON.stringify(this.sources, null, 2);
        list.hidden = true;
      } else {
        try {
          this.sources = validateJournalSources(JSON.parse(this.raw), this.followDailyNotes ? undefined : this.dailyFolder || '/');
          this.jsonOpen = false;
          this.error = null;
          this.renderFields();
          this.fields.querySelector('summary')?.focus();
          this.updateState();
        } catch (error) {
          advanced.open = true;
          this.showError(error);
          json.focus();
        }
      }
    });
    summary.setAttribute('aria-label', this.label('sourceAdvanced'));
  }

  showError(error) {
    const key = error instanceof SyntaxError ? 'sourceInvalidArray' : error.message;
    const message = this.label(key);
    this.error = key.startsWith('source')
      ? (error.row ? this.label('sourceRowError', { row: error.row, error: message }) : message)
      : this.label('settingsSaveFailed', { error: error?.message || String(error) });
    this.updateState();
  }

  draftSettings() {
    return {
      ...this.plugin.settings,
      followDailyNotes: this.followDailyNotes,
      dailyFolder: this.dailyFolder.trim() || '/',
      dailyNoteFormat: this.dailyNoteFormat.trim() || 'YYYY-MM-DD',
      dailyNoteTemplate: this.dailyNoteTemplate.trim(),
    };
  }

  updateState() {
    if (!this.root) return;
    this.root.setAttribute('aria-busy', String(Boolean(this.busy)));
    for (const input of this.fields.querySelectorAll('input, select, textarea, button')) {
      input.disabled = Boolean(this.busy) || (this.followDailyNotes && Boolean(input.closest('.dayline-source-daily-fields')));
    }
    try {
      const target = resolveDailyNoteTarget(this.plugin.app, this.draftSettings(), getTodayDate());
      this.preview.textContent = this.label('sourceDailyPreview', { path: target.path });
    } catch (error) {
      this.preview.textContent = this.label(error.message);
    }
    this.applyButton.disabled = Boolean(this.busy) || (!this.dirty && !this.refreshNeeded);
    this.resetButton.disabled = Boolean(this.busy) || !this.dirty;
    this.applyButton.textContent = this.label(this.busy ? 'saving' : this.refreshNeeded ? 'retry' : 'sourceApply');
    this.status.textContent = this.error || (this.saved ? this.label('sourceSaved') : this.dirty ? this.label('sourceUnsaved') : '');
    this.status.classList.toggle('is-error', Boolean(this.error));
    this.status.setAttribute('role', this.error ? 'alert' : 'status');
  }

  async apply() {
    if (this.busy) return;
    let sources;
    let dailyFolder;
    try {
      // Validate the daily folder first so the source check can compare against
      // the value that will actually be saved.
      const dailyRaw = this.dailyFolder.trim();
      const normalizedDaily = normalizeVaultPath(dailyRaw);
      if (normalizedDaily.split('/').some(part => part === '.' || part === '..')) throw new Error('sourceDailyRequired');
      dailyFolder = normalizedDaily || '/';
      sources = validateJournalSources(this.jsonOpen ? JSON.parse(this.raw) : this.sources, this.followDailyNotes ? undefined : dailyFolder);
      if (!this.followDailyNotes) {
        const draft = this.draftSettings();
        const target = resolveDailyNoteTarget(this.plugin.app, draft, '2024-02-29');
        if (parseDailyNotePath(resolveDailyNoteConfig(this.plugin.app, draft), target.path) !== target.date) {
          throw new Error('sourceDailyInvalidDate');
        }
        if (draft.dailyNoteTemplate && (
          /[\\:\u0000-\u001f]/.test(draft.dailyNoteTemplate)
          || draft.dailyNoteTemplate.split('/').some(part => part === '.' || part === '..')
        )) throw new Error('sourceDailyInvalidPath');
      }
    } catch (error) {
      this.showError(error);
      return;
    }
    this.busy = true;
    this.error = null;
    this.updateState();
    const settings = this.plugin.settings;
    const keys = ['dailyFolder', 'dailyNoteFormat', 'dailyNoteTemplate', 'journalSources', 'followDailyNotes'];
    const previous = Object.fromEntries(keys.filter(key => Object.hasOwn(settings, key)).map(key => [key, settings[key]]));
    try {
      if (this.dirty) {
        settings.dailyFolder = dailyFolder;
        settings.followDailyNotes = this.followDailyNotes;
        settings.dailyNoteFormat = this.dailyNoteFormat.trim() || 'YYYY-MM-DD';
        settings.dailyNoteTemplate = this.dailyNoteTemplate.trim();
        settings.journalSources = clone(sources);
        try {
          const saved = await this.plugin.saveSettings();
          if (saved === false) throw new Error(this.label('sourceSaveRejected'));
        } catch (error) {
          for (const key of keys) delete settings[key];
          Object.assign(settings, previous);
          throw error;
        }
        this.sources = sources;
        this.dailyFolder = dailyFolder;
        this.raw = JSON.stringify(sources, null, 2);
        this.dirty = false;
        this.renderFields();
        this.updateState();
      }
      this.refreshNeeded = true;
      await this.plugin.journalIndex.refresh(this.plugin.settings);
      this.plugin.refreshJournalViews();
      await this.refreshCalendar();
      this.refreshNeeded = false;
      this.saved = true;
    } catch (error) {
      if (this.refreshNeeded && !this.dirty) {
        this.error = this.label('sourceRefreshFailed', { error: error?.message || String(error) });
      } else {
        this.showError(error);
      }
    } finally {
      this.busy = false;
      this.updateState();
    }
  }
}
