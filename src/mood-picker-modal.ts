// @ts-nocheck
const { Modal, Notice } = require('obsidian');
const { MOOD_LEVELS, moodLabelsForScore, moveMoodScore } = require('./mood');
const { feelingLabel, moodLabel, t } = require('./i18n');

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
    const available = new Set(moodLabelsForScore(score).map((label) => label.id));
    this.labels = new Set(Array.from(this.labels).filter((id) => available.has(id)));
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
    for (const item of moodLabelsForScore(this.score)) {
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
      await this.onSave?.({ filePath: this.filePath, score: this.score, labels: Array.from(this.labels) });
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
      this.score = moveMoodScore(this.score, 1);
      this.renderScale();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.score = moveMoodScore(this.score, -1);
      this.renderScale();
    } else if (event.key === 'Enter' && this.score !== null) {
      event.preventDefault();
      this.renderLabels();
    }
  }
}

function extractDate(filePath) {
  const match = String(filePath || '').match(/(\d{4}-\d{2}-\d{2})(?:\.md)?$/);
  if (match) return match[1];
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
