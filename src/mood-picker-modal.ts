// @ts-nocheck
import { Modal, Notice, setIcon } from 'obsidian';
import { filterMoodLabelsForScore, getMoodColor, moodLabelsForScore } from './mood';
import { drawFluidMood, FluidMoodControl } from './fluid-mood-control';
import { feelingLabel, moodLabel, t } from './i18n';
import { bindMoodModalViewport } from './mood-modal-viewport';

const BUILT_IN_LABEL_IDS = new Set(moodLabelsForScore(null).map((item) => item.id));

function normalizeCustomLabels(value) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map(String)
      .map((label) => label.trim())
      .filter((label) => label && !BUILT_IN_LABEL_IDS.has(label)),
  )).sort((a, b) => a.localeCompare(b));
}

function createMoodDraft(initial, customLabels) {
  const labels = [...(initial?.labels ?? [])];
  return {
    score: initial?.score ?? 0,
    labels,
    customLabels: normalizeCustomLabels([...(customLabels || []), ...labels]),
    note: initial?.note ?? '',
    customText: '',
  };
}

function draftFingerprint(draft) {
  return JSON.stringify({
    ...draft,
    labels: [...draft.labels].sort(),
    customLabels: [...draft.customLabels].sort(),
  });
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
    this.restoreDraft(createMoodDraft(this.initial, options.customLabels));
    const draft = this.snapshotDraft();
    this.drafts = new Map([[this.filePath, { draft, baseline: draftFingerprint(draft) }]]);
    this.pendingOperation = null;
    this.closed = false;
  }

  onOpen() {
    this.ownerWindow = this.contentEl.ownerDocument.defaultView;
    this.opener = this.contentEl.ownerDocument.activeElement;
    this.modalEl.addClass('journal-mood-picker-modal');
    this.contentEl.empty();
    this.contentEl.addClass('journal-mood-picker');
    this.disposeViewport = bindMoodModalViewport(this.modalEl, this.contentEl);
    this.renderScale();
    this.keyHandler = (event) => this.handleKeydown(event);
    this.escapeHandler = this.scope?.register([], 'Escape', this.keyHandler);
    this.contentEl.addEventListener('keydown', this.keyHandler);
    // The fluid slider is not a native input, so disabled alone cannot lock it.
    this.lockedEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown', 'click', 'input', 'change'];
    this.blockLockedInteraction = (event) => {
      if (!this.isLocked() || event.key === 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of this.lockedEvents) this.contentEl.addEventListener(type, this.blockLockedInteraction, true);
  }

  onClose() {
    this.closed = true;
    this.ownerWindow.clearTimeout(this.focusTimer);
    this.disposeViewport?.();
    this.disposeViewport = null;
    this.fluidControl?.destroy();
    this.fluidControl = null;
    if (this.escapeHandler) this.scope?.unregister?.(this.escapeHandler);
    this.contentEl.removeEventListener('keydown', this.keyHandler);
    for (const type of this.lockedEvents || []) this.contentEl.removeEventListener(type, this.blockLockedInteraction, true);
    this.contentEl.empty();
    this.drafts.clear();
  }

  snapshotDraft() {
    return {
      score: this.score,
      labels: Array.from(this.labels),
      customLabels: [...this.customLabels],
      note: this.note,
      customText: this.customText,
    };
  }

  restoreDraft(draft) {
    this.score = draft.score;
    this.labels = new Set(draft.labels);
    this.customLabels = [...draft.customLabels];
    this.note = draft.note;
    this.customText = draft.customText;
  }

  cacheDraft() {
    this.drafts.get(this.filePath).draft = this.snapshotDraft();
  }

  isLocked() {
    return this.closed || Boolean(this.pendingOperation);
  }

  updateControls() {
    const locked = this.isLocked();
    for (const control of this.contentEl.querySelectorAll('button, input, textarea, select')) {
      control.disabled = locked;
    }
    const slider = this.contentEl.querySelector('[role="slider"]');
    if (slider) {
      slider.setAttribute('aria-disabled', String(locked));
      slider.tabIndex = locked ? -1 : 0;
      slider.inert = locked;
    }
    this.contentEl.setAttribute('aria-busy', String(Boolean(this.pendingOperation)));
    if (this.saveButton) {
      const saving = this.pendingOperation === 'saving';
      this.saveButton.textContent = t(this.settings, saving ? 'saving' : this.saveFailed ? 'retry' : 'save');
      this.saveButton.classList.toggle('is-loading', saving);
    }
  }

  clearError() {
    this.errorEl?.remove();
    this.errorEl = null;
  }

  showError(key, error) {
    this.clearError();
    this.errorEl = this.contentEl.createDiv({
      cls: 'journal-mood-error',
      text: t(this.settings, key, { error: String(error?.message || error) }),
      attr: { role: 'alert' },
    });
  }

  close() {
    if (this.closed || this.pendingOperation) return;
    super.close();
    if (this.opener?.isConnected) this.opener.focus();
  }

  resetContent(step) {
    this.ownerWindow.clearTimeout(this.focusTimer);
    this.fluidControl?.destroy();
    this.fluidControl = null;
    this.step = step;
    this.contentEl.empty();
    this.contentEl.scrollTop = 0;
    this.errorEl = null;
    this.saveButton = null;
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
    copy.createEl('h3', { text: title, attr: { tabindex: '-1' } });
    copy.createEl('p', { cls: 'journal-mood-step', text: question });
    if (this.allowDateSelection) this.renderDateField(header);
    return header;
  }

  renderScale() {
    if (this.isLocked()) return;
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
    // Neutral is a valid default, so the user can continue immediately.
    next.disabled = false;
    next.addEventListener('click', () => {
      if (this.isLocked()) return;
      this.renderLabels();
    });
    this.fluidControl = new FluidMoodControl(controlHost, {
      initialScore: this.score,
      accessibleLabel: t(this.settings, 'moodQuestion'),
      emptyLabel: t(this.settings, 'chooseLevel'),
      labelForScore: (score) => moodLabel(this.settings, score),
      onPreview: (_value, color) => this.setActiveColor(color),
      onCommit: (score) => {
        this.selectScore(score);
        next.disabled = false;
      },
      onActivate: () => {
        if (this.score !== null) this.renderLabels();
      },
    });
    // Obsidian's Modal may autofocus the first form control after onOpen.
    // Restore focus to the mood control after that pass so the date input
    // remains touch-selectable without opening the native picker on launch.
    this.fluidControl.focus();
    this.focusTimer = this.ownerWindow.setTimeout(() => {
      if (!this.isLocked()) this.fluidControl?.focus();
    }, 0);
  }

  renderDateField(parent = this.contentEl) {
    const field = parent.createDiv({ cls: 'journal-mood-date-field' });
    const label = field.createEl('label', { text: t(this.settings, 'moodDate') });
    const input = field.createEl('input', {
      attr: {
        type: 'date',
        value: this.date || '',
        tabindex: '0',
        'aria-label': t(this.settings, 'moodDate'),
        title: t(this.settings, 'moodDateDesc'),
      },
    });
    label.htmlFor = input.id = `dayline-mood-date-${Date.now()}`;
    input.addEventListener('change', () => this.changeDate(input.value, input));
  }

  selectScore(score) {
    if (this.isLocked()) return;
    this.score = score;
    const builtInIds = new Set(moodLabelsForScore(null).map((item) => item.id));
    const custom = Array.from(this.labels).filter((label) => !builtInIds.has(label));
    this.labels = new Set([...custom, ...filterMoodLabelsForScore(score, this.labels)]);
  }

  async changeDate(date, input) {
    if (this.isLocked()) return;
    if (!date || date === this.date) {
      if (input) input.value = this.date || '';
      return;
    }
    this.cacheDraft();
    const previousDate = this.date;
    this.pendingOperation = 'changing-date';
    this.ownerWindow.clearTimeout(this.focusTimer);
    this.clearError();
    this.updateControls();
    try {
      const result = await this.onDateChange?.(date);
      const filePath = result?.filePath || this.filePath;
      if (!this.drafts.has(filePath)) {
        const draft = createMoodDraft(result?.initial, result?.customLabels || this.customLabels);
        this.drafts.set(filePath, { draft, baseline: draftFingerprint(draft) });
      }
      this.filePath = filePath;
      this.date = date;
      this.initial = result?.initial;
      this.restoreDraft(this.drafts.get(filePath).draft);
      this.saveFailed = false;
      this.pendingOperation = null;
      this.renderScale();
    } catch (error) {
      if (input) input.value = previousDate || '';
      this.showError('moodDateChangeFailed', error);
    } finally {
      this.pendingOperation = null;
      this.updateControls();
    }
  }

  renderLabels() {
    if (this.isLocked()) return;
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
    const labelButtons = new Map();
    const updateLabel = (button, id) => {
      const selected = this.labels.has(id);
      button.setAttribute('aria-pressed', String(selected));
    };
    const addLabelButton = (id, text, custom = false) => {
      const button = group.createEl('button', {
        cls: `journal-mood-label${custom ? ' journal-mood-label-custom' : ''}`,
        attr: { type: 'button', ...(custom ? { 'data-custom-label': 'true' } : {}) },
      });
      button.createSpan({ cls: 'journal-mood-label-text', text });
      const icon = button.createSpan({ cls: 'journal-mood-label-check', attr: { 'aria-hidden': 'true' } });
      setIcon(icon, 'check');
      labelButtons.set(id, button);
      updateLabel(button, id);
      button.addEventListener('click', () => {
        if (this.isLocked()) return;
        if (this.labels.has(id)) this.labels.delete(id);
        else this.labels.add(id);
        updateLabel(button, id);
      });
    };
    for (const item of moodLabelsForScore(this.score)) addLabelButton(item.id, feelingLabel(this.settings, item.id));
    for (const item of [...this.customLabels].sort((a, b) => a.localeCompare(b))) {
      addLabelButton(item, item, true);
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
    customInput.value = this.customText;
    customInput.addEventListener('input', () => {
      if (!this.isLocked()) this.customText = customInput.value;
    });
    const addCustom = customField.createEl('button', { text: t(this.settings, 'addCustomFeeling'), attr: { type: 'button' } });
    const addLabel = () => {
      if (this.isLocked()) return;
      const value = String(customInput.value || '').trim();
      if (!value) return;
      if (!BUILT_IN_LABEL_IDS.has(value) && !this.customLabels.includes(value)) this.customLabels.push(value);
      this.labels.add(value);
      if (labelButtons.has(value)) updateLabel(labelButtons.get(value), value);
      else addLabelButton(value, feelingLabel(this.settings, value), !BUILT_IN_LABEL_IDS.has(value));
      this.customText = '';
      customInput.value = '';
      customInput.focus();
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
    noteInput.addEventListener('input', () => {
      if (!this.isLocked()) this.note = noteInput.value;
    });
    const actions = this.contentEl.createDiv({ cls: 'journal-mood-actions' });
    const back = actions.createEl('button', { text: t(this.settings, 'back'), attr: { type: 'button' } });
    back.addEventListener('click', () => this.renderScale());
    const save = actions.createEl('button', { text: t(this.settings, 'save'), cls: 'mod-cta', attr: { type: 'button' } });
    this.saveButton = save;
    save.addEventListener('click', () => this.save(save));
    this.updateControls();
    this.contentEl.querySelector('h3')?.focus();
  }

  async save(saveButton = this.saveButton) {
    if (this.score === null || this.isLocked()) return;
    const snapshot = {
      filePath: this.filePath,
      score: this.score,
      labels: Array.from(this.labels),
      note: this.note.trim() || null,
      customLabels: [...this.customLabels],
    };
    this.pendingOperation = 'saving';
    this.saveFailed = false;
    this.ownerWindow.clearTimeout(this.focusTimer);
    this.clearError();
    this.updateControls();
    try {
      await this.onSave?.(snapshot);
      this.pendingOperation = null;
      this.note = snapshot.note ?? '';
      const noteInput = this.contentEl.querySelector('textarea');
      if (noteInput) noteInput.value = this.note;
      const draft = this.snapshotDraft();
      this.drafts.set(snapshot.filePath, { draft, baseline: draftFingerprint(draft) });
      this.updateControls();
      this.close();
    } catch (error) {
      this.pendingOperation = null;
      this.saveFailed = true;
      this.showError('moodSaveFailed', error);
      this.updateControls();
      saveButton?.focus();
    }
  }

  handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return false;
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
          try {
            await this.store.restoreOrphan(path, destination.value || path);
          } catch (error) {
            const message = String(error?.message || error);
            const canReplace = /already has a record/i.test(message);
            const confirmed = canReplace && (typeof window === 'undefined' || window.confirm(t(this.settings, 'moodRestoreConflict')));
            if (!confirmed) throw error;
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
        } catch (error) {
          const message = String(error?.message || error);
          new Notice(message);
        } finally {
          restore.disabled = false;
        }
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
