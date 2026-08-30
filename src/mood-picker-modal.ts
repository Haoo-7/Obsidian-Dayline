// @ts-nocheck
import { Modal, Notice } from 'obsidian';
import { filterMoodLabelsForScore, getMoodColor, moodLabelsForScore } from './mood';
import { drawFluidMood, FluidMoodControl } from './fluid-mood-control';
import { feelingLabel, moodLabel, t } from './i18n';

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
    this.fluidControl?.destroy();
    this.fluidControl = null;
    this.contentEl.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
  }

  resetContent(step) {
    this.fluidControl?.destroy();
    this.fluidControl = null;
    this.step = step;
    this.contentEl.empty();
    this.contentEl.classList.toggle('is-scale-step', step === 1);
    this.contentEl.classList.toggle('is-label-step', step === 2);
    this.setActiveColor(getMoodColor(this.score ?? 0));
  }

  setActiveColor(color) {
    this.modalEl.style.setProperty('--journal-mood-active', color);
    this.contentEl.style.setProperty('--journal-mood-active', color);
  }

  renderHeader(title, question) {
    const header = this.contentEl.createDiv({ cls: 'journal-mood-header' });
    const copy = header.createDiv({ cls: 'journal-mood-header-copy' });
    copy.createEl('h3', { text: title });
    copy.createEl('p', { cls: 'journal-mood-step', text: question });
    if (this.allowDateSelection) this.renderDateField(header);
    return header;
  }

  renderScale() {
    this.resetContent(1);
    this.renderHeader(t(this.settings, 'moodTitle'), t(this.settings, 'moodQuestion'));
    const panel = this.contentEl.createDiv({ cls: 'journal-mood-panel journal-mood-scale-panel' });
    const controlHost = panel.createDiv();
    const actions = this.contentEl.createDiv({ cls: 'journal-mood-actions journal-mood-scale-actions' });
    const next = actions.createEl('button', {
      text: t(this.settings, 'continue'),
      cls: 'mod-cta journal-mood-continue',
      attr: { type: 'button' },
    });
    next.disabled = this.score === null;
    next.addEventListener('click', () => {
      if (this.score !== null) this.renderLabels();
    });
    this.fluidControl = new FluidMoodControl(controlHost, {
      initialScore: this.score,
      accessibleLabel: t(this.settings, 'moodQuestion'),
      emptyLabel: t(this.settings, 'chooseLevel'),
      labelForScore: (score) => moodLabel(this.settings, score),
      onPreview: (_value, color) => this.setActiveColor(color),
      onCommit: (score) => {
        this.selectScore(score);
        this.setActiveColor(getMoodColor(score));
        next.disabled = false;
      },
      onActivate: () => {
        if (this.score !== null) this.renderLabels();
      },
    });
    this.fluidControl.focus();
  }

  renderDateField(parent = this.contentEl) {
    const field = parent.createDiv({ cls: 'journal-mood-date-field' });
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
    this.resetContent(2);
    this.renderHeader(t(this.settings, 'addFeelings'), t(this.settings, 'chooseFeelings'));

    const summary = this.contentEl.createDiv({ cls: 'journal-mood-summary' });
    const summaryCanvas = summary.createEl('canvas', { cls: 'journal-mood-summary-canvas', attr: { 'aria-hidden': 'true' } });
    drawFluidMood(summaryCanvas, this.score ?? 0, 0, { width: 76, height: 76, pixelRatio: 2 });
    const summaryCopy = summary.createDiv({ cls: 'journal-mood-summary-copy' });
    summaryCopy.createSpan({ cls: 'journal-mood-summary-label', text: t(this.settings, 'selected') });
    summaryCopy.createEl('strong', { text: moodLabel(this.settings, this.score) });

    const form = this.contentEl.createDiv({ cls: 'journal-mood-form' });
    const feelings = form.createDiv({ cls: 'journal-mood-field-group' });
    feelings.createEl('label', { cls: 'journal-mood-field-label', text: t(this.settings, 'chooseFeelings') });
    const group = feelings.createDiv({ cls: 'journal-mood-labels', attr: { role: 'group', 'aria-label': t(this.settings, 'addFeelings') } });
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
    const customField = feelings.createDiv({ cls: 'journal-mood-custom-label-field' });
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
    const noteField = form.createDiv({ cls: 'journal-mood-note-field' });
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
    save.addEventListener('click', () => this.save(save));
    save.focus();
  }

  async save(saveButton) {
    if (this.score === null) return;
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.classList.add('is-loading');
    }
    try {
      await this.onSave?.({ filePath: this.filePath, score: this.score, labels: Array.from(this.labels), note: this.note.trim() || null, customLabels: this.customLabels });
      this.close();
    } catch (error) {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.classList.remove('is-loading');
      }
      new Notice(`${t(this.settings, 'moodTitle')}: ${error.message || error}`);
    }
  }

  handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
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
