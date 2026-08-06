// @ts-nocheck
const { Modal, Notice } = require('obsidian');
const { MOOD_LEVELS, filterMoodLabelsForScore, moodLabelsForScore, moveMoodScore } = require('./mood');
const { feelingLabel, moodLabel, t } = require('./i18n');

const BUILT_IN_LABEL_IDS = new Set(moodLabelsForScore(null).map((item) => item.id));

function normalizeCustomLabels(value) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map(String)
      .map((label) => label.trim())
      .filter((label) => label && !BUILT_IN_LABEL_IDS.has(label)),
  )).sort((a, b) => a.localeCompare(b));
}

export class MoodPickerModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.filePath = options.filePath;
    this.settings = options.settings || {};
    this.initial = options.initial;
    this.onSave = options.onSave;
    this.onDateChange = options.onDateChange;
    this.allowDateSelection = options.allowDateSelection === true;
    this.date = options.date || extractDate(options.filePath);
    this.score = this.initial?.score ?? null;
    this.labels = new Set(this.initial?.labels ?? []);
    this.customLabels = normalizeCustomLabels(options.customLabels);
    for (const label of this.labels) {
      if (!BUILT_IN_LABEL_IDS.has(label) && !this.customLabels.includes(label)) this.customLabels.push(label);
    }
    this.note = this.initial?.note ?? '';
  }

  onOpen() {
    this.modalEl.addClass('journal-mood-picker-modal');
    this.contentEl.empty();
    this.contentEl.addClass('journal-mood-picker');
    this.renderScale();
    this.keyHandler = (event) => this.handleKeydown(event);
    this.scope?.register([], 'Escape', this.keyHandler);
    this.contentEl.addEventListener('keydown', this.keyHandler);
  }

  onClose() {
    this.contentEl.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
  }

  renderScale() {
    this.step = 1;
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: t(this.settings, 'moodTitle') });
    if (this.allowDateSelection) this.renderDateField();
    this.contentEl.createEl('p', { cls: 'journal-mood-step', text: t(this.settings, 'moodQuestion') });
    const scale = this.contentEl.createDiv({ cls: 'journal-mood-scale', attr: { role: 'radiogroup', 'aria-label': t(this.settings, 'moodQuestion') } });
    MOOD_LEVELS.forEach((level, index) => {
      const button = scale.createEl('button', {
        cls: 'journal-mood-level',
        attr: {
          type: 'button',
          role: 'radio',
          'aria-label': moodLabel(this.settings, level.score),
          'aria-checked': String(this.score === level.score),
          tabindex: this.score === level.score || (this.score === null && index === 2) ? '0' : '-1',
        },
      });
      button.style.setProperty('--journal-mood-color', level.color);
      button.createSpan({ cls: 'journal-mood-dot', attr: { 'aria-hidden': 'true' } });
      button.createSpan({ cls: 'journal-mood-level-label', text: moodLabel(this.settings, level.score) });
      button.addEventListener('click', () => {
        this.selectScore(level.score);
        this.renderLabels();
      });
    });
    this.contentEl.createDiv({
      cls: 'journal-mood-selected',
      text: this.score === null ? t(this.settings, 'chooseLevel') : `${t(this.settings, 'selected')}: ${moodLabel(this.settings, this.score)}`,
    });
  }

  renderDateField() {
    const field = this.contentEl.createDiv({ cls: 'journal-mood-date-field' });
    const label = field.createEl('label', { text: t(this.settings, 'moodDate') });
    const input = field.createEl('input', {
      attr: {
        type: 'date',
        value: this.date || '',
        'aria-label': t(this.settings, 'moodDate'),
        title: t(this.settings, 'moodDateDesc'),
      },
    });
    label.htmlFor = input.id = `dayline-mood-date-${Date.now()}`;
    input.addEventListener('change', () => this.changeDate(input.value, input));
  }

  selectScore(score) {
    this.score = score;
    const builtInIds = new Set(moodLabelsForScore(null).map((item) => item.id));
    const custom = Array.from(this.labels).filter((label) => !builtInIds.has(label));
    this.labels = new Set([...custom, ...filterMoodLabelsForScore(score, this.labels)]);
  }

  async changeDate(date, input) {
    if (!date || date === this.date) return;
    input.disabled = true;
    try {
      const result = await this.onDateChange?.(date);
      this.date = date;
      if (result) {
        this.filePath = result.filePath || this.filePath;
        this.initial = result.initial;
        this.score = this.initial?.score ?? null;
        this.labels = new Set(this.initial?.labels ?? []);
        this.customLabels = normalizeCustomLabels(result.customLabels || this.customLabels || []);
        for (const label of this.labels) if (!BUILT_IN_LABEL_IDS.has(label) && !this.customLabels.includes(label)) this.customLabels.push(label);
        this.note = this.initial?.note ?? '';
        if (this.score !== null) this.selectScore(this.score);
      }
      this.renderScale();
    } catch (error) {
      input.disabled = false;
      new Notice(`${t(this.settings, 'moodTitle')}: ${error.message || error}`);
    }
  }

  renderLabels() {
    this.step = 2;
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: t(this.settings, 'addFeelings') });
    if (this.allowDateSelection) this.renderDateField();
    this.contentEl.createEl('p', { cls: 'journal-mood-step', text: t(this.settings, 'chooseFeelings') });
    const group = this.contentEl.createDiv({ cls: 'journal-mood-labels', attr: { role: 'group', 'aria-label': t(this.settings, 'addFeelings') } });
    const builtIn = moodLabelsForScore(this.score);
    for (const item of builtIn) {
      const button = group.createEl('button', {
        cls: 'journal-mood-label',
        text: feelingLabel(this.settings, item.id),
        attr: { type: 'button', 'aria-pressed': String(this.labels.has(item.id)) },
      });
      button.addEventListener('click', () => {
        if (this.labels.has(item.id)) this.labels.delete(item.id);
        else this.labels.add(item.id);
        button.setAttribute('aria-pressed', String(this.labels.has(item.id)));
      });
    }
    const customIds = new Set(this.customLabels);
    for (const item of Array.from(customIds).sort((a, b) => a.localeCompare(b))) {
      const button = group.createEl('button', {
        cls: 'journal-mood-label journal-mood-label-custom',
        text: item,
        attr: { type: 'button', 'aria-pressed': String(this.labels.has(item)), 'data-custom-label': 'true' },
      });
      button.addEventListener('click', () => {
        if (this.labels.has(item)) this.labels.delete(item);
        else this.labels.add(item);
        button.setAttribute('aria-pressed', String(this.labels.has(item)));
      });
    }
    const customField = this.contentEl.createDiv({ cls: 'journal-mood-custom-label-field' });
    const customInput = customField.createEl('input', {
      attr: {
        type: 'text',
        maxlength: '48',
        placeholder: t(this.settings, 'customFeelingPlaceholder'),
        'aria-label': t(this.settings, 'customFeeling'),
      },
    });
    const addCustom = customField.createEl('button', { text: t(this.settings, 'addCustomFeeling'), attr: { type: 'button' } });
    const addLabel = () => {
      const value = String(customInput.value || '').trim();
      if (!value) return;
      if (!BUILT_IN_LABEL_IDS.has(value) && !this.customLabels.includes(value)) this.customLabels.push(value);
      this.labels.add(value);
      customInput.value = '';
      this.renderLabels();
    };
    addCustom.addEventListener('click', addLabel);
    customInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addLabel(); } });
    const noteField = this.contentEl.createDiv({ cls: 'journal-mood-note-field' });
    noteField.createEl('label', { text: t(this.settings, 'moodNote') });
    const noteInput = noteField.createEl('textarea', {
      attr: {
        rows: '3',
        maxlength: '2000',
        placeholder: t(this.settings, 'moodNotePlaceholder'),
        'aria-label': t(this.settings, 'moodNote'),
      },
    });
    noteInput.value = this.note || '';
    noteInput.addEventListener('input', () => { this.note = noteInput.value; });
    const actions = this.contentEl.createDiv({ cls: 'journal-mood-actions' });
    const back = actions.createEl('button', { text: t(this.settings, 'back'), attr: { type: 'button' } });
    back.addEventListener('click', () => this.renderScale());
    const save = actions.createEl('button', { text: t(this.settings, 'save'), cls: 'mod-cta', attr: { type: 'button' } });
    save.addEventListener('click', () => this.save());
    save.focus();
  }

  async save() {
    if (this.score === null) return;
    try {
      await this.onSave?.({ filePath: this.filePath, score: this.score, labels: Array.from(this.labels), note: this.note.trim() || null, customLabels: this.customLabels });
      this.close();
    } catch (error) {
      new Notice(`${t(this.settings, 'moodTitle')}: ${error.message || error}`);
    }
  }

  handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (this.step !== 1) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectScore(moveMoodScore(this.score, 1));
      this.renderScale();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectScore(moveMoodScore(this.score, -1));
      this.renderScale();
    } else if (event.key === 'Enter' && this.score !== null) {
      event.preventDefault();
      this.renderLabels();
    }
  }
}

/** Compact recovery view for mood records orphaned by file deletion. */
export class MoodRecoveryModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.store = options.store;
    this.settings = options.settings || {};
    this.onChanged = options.onChanged;
  }

  onOpen() {
    this.modalEl.addClass('journal-mood-recovery-modal');
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  render() {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: t(this.settings, 'moodRecoveryTitle') });
    this.contentEl.createEl('p', { cls: 'journal-mood-recovery-description', text: t(this.settings, 'moodRecoveryDescription') });
    const orphans = Object.entries(this.store?.getOrphans?.() || {}).sort(([a], [b]) => a.localeCompare(b));
    if (orphans.length === 0) {
      this.contentEl.createDiv({ cls: 'journal-mood-recovery-empty', text: t(this.settings, 'moodRecoveryEmpty') });
      return;
    }
    const list = this.contentEl.createDiv({ cls: 'journal-mood-recovery-list' });
    for (const [path, orphan] of orphans) {
      const row = list.createDiv({ cls: 'journal-mood-recovery-row' });
      const details = row.createDiv({ cls: 'journal-mood-recovery-details' });
      details.createDiv({ cls: 'journal-mood-recovery-path', text: path });
      const record = orphan.record || {};
      details.createDiv({ cls: 'journal-mood-recovery-meta', text: `${moodLabel(this.settings, record.score)} · ${(record.labels || []).join(', ') || t(this.settings, 'noFeelings')}` });
      if (record.note) details.createDiv({ cls: 'journal-mood-recovery-note', text: record.note });
      const destination = row.createEl('input', { attr: { type: 'text', value: path, 'aria-label': t(this.settings, 'moodRestoreDestination'), title: t(this.settings, 'moodRestoreDestination') } });
      const restore = row.createEl('button', { text: t(this.settings, 'restoreMood'), attr: { type: 'button' } });
      restore.addEventListener('click', async () => {
        restore.disabled = true;
        try {
          await this.store.restoreOrphan(path, destination.value || path);
        } catch (error) {
          const message = String(error?.message || error);
          const canReplace = /already has a record/i.test(message);
          const confirmed = canReplace && (typeof window === 'undefined' || window.confirm(t(this.settings, 'moodRestoreConflict')));
          if (!confirmed) {
            new Notice(message);
            restore.disabled = false;
            return;
          }
          await this.store.restoreOrphan(path, destination.value || path, { replace: true });
        }
        try {
          await this.onChanged?.();
        } catch (error) {
          const message = String(error?.message || error);
          console.warn('[Dayline] Mood recovery refresh failed:', message);
          new Notice(t(this.settings, 'viewRefreshFailed', { error: message }));
        }
        this.render();
      });
    }
  }
}

function extractDate(filePath) {
  const match = String(filePath || '').match(/(\d{4}-\d{2}-\d{2})(?:\.md)?$/);
  if (match) return match[1];
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
