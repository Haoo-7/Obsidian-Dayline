// @ts-nocheck
import { setIcon } from 'obsidian';
import { normalizeVaultPath } from './date-utils';
import { t } from './i18n';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function validateJournalSources(value) {
  if (!Array.isArray(value)) throw new Error('sourceInvalidArray');
  const ids = new Set();
  const paths = new Set();
  let daily = false;
  return value.map((source, index) => {
    const fail = (key) => { throw Object.assign(new Error(key), { row: index + 1 }); };
    if (!source || typeof source !== 'object' || Array.isArray(source)) fail('sourceInvalidRow');
    if (typeof source.path !== 'string' || !source.path.trim()) fail('sourcePathRequired');
    const path = normalizeVaultPath(source.path.trim());
    if (!path || path.split('/').some(part => part === '.' || part === '..')) fail('sourcePathRequired');
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
      paths.add(path);
      daily ||= type === 'daily';
    }
    return { ...source, id, path, type };
  });
}

export class JournalSourceSettingsEditor {
  constructor(plugin, { chooseFolder, refreshCalendar }) {
    this.plugin = plugin;
    this.chooseFolder = chooseFolder;
    this.refreshCalendar = refreshCalendar;
    this.reset();
  }

  reset() {
    this.dailyFolder = this.plugin.settings.dailyFolder || 'Calendar/Daily';
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
    const input = label.createEl('input', { attr: { type: 'text', ...options } });
    input.value = value || '';
    input.addEventListener('input', () => {
      if (this.busy) return;
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
      if (this.busy || !input.isConnected) return;
      input.value = path;
      onChange(path);
      this.changed();
      input.focus();
    }));
    return input;
  }

  renderFields() {
    this.fields.empty();
    this.folderField(this.fields, 'sourceDailyFolder', this.dailyFolder, value => { this.dailyFolder = value; });
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
          this.sources = validateJournalSources(JSON.parse(this.raw));
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

  updateState() {
    if (!this.root) return;
    this.root.setAttribute('aria-busy', String(Boolean(this.busy)));
    for (const input of this.fields.querySelectorAll('input, select, textarea, button')) input.disabled = Boolean(this.busy);
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
      sources = validateJournalSources(this.jsonOpen ? JSON.parse(this.raw) : this.sources);
      dailyFolder = normalizeVaultPath(this.dailyFolder.trim());
      if (!dailyFolder || dailyFolder.split('/').some(part => part === '.' || part === '..')) throw new Error('sourceDailyRequired');
    } catch (error) {
      this.showError(error);
      return;
    }
    this.busy = true;
    this.error = null;
    this.updateState();
    const settings = this.plugin.settings;
    const previous = { dailyFolder: settings.dailyFolder, journalSources: settings.journalSources };
    try {
      if (this.dirty) {
        settings.dailyFolder = dailyFolder;
        settings.journalSources = clone(sources);
        try {
          const saved = await this.plugin.saveSettings();
          if (saved === false) throw new Error(this.label('sourceSaveRejected'));
        } catch (error) {
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
