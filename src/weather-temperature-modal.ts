// @ts-nocheck
import { Modal } from 'obsidian';
import { formatJournalDate, t } from './i18n';
import { bindMoodModalViewport } from './mood-modal-viewport';
import {
  celsiusToDisplay,
  clockTimeFromParts,
  displayToCelsius,
  formatTemperatureValue,
  normalizeManualTime,
  parseTemperatureInput,
  unitSymbolFor,
} from './weather-manual';

export const WEATHER_TEMPERATURE_MODAL_CLASS = 'dayline-weather-temperature-modal';

/**
 * The temperature rail spans the everyday outdoor range. A reading outside it
 * still displays its true value; only the thumb pins to an end, because the
 * rail is a sense of place, not the input itself.
 */
export const WEATHER_RAIL_MIN_C = -20;
export const WEATHER_RAIL_MAX_C = 45;
export const WEATHER_RAIL_TICKS_C = [-20, 0, 20, 40];

/**
 * Records the temperature the user felt at a specific moment.
 *
 * Temperature is not a single daily number: 12°C in the morning and 22°C in the
 * afternoon are both true. The reading therefore carries the wall clock it
 * refers to, and this form asks for both values so a backfilled day is not
 * silently stamped with the moment it happened to be typed.
 *
 * The number is the protagonist; the rail gives it a place on a real scale and
 * is draggable, so "how warm was it" is answered by feel as well as by digits.
 */
export class WeatherTemperatureModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.settings = options.settings || {};
    this.dateStr = String(options.dateStr || '');
    this.units = options.units === 'imperial' ? 'imperial' : 'metric';
    this.initialCelsius = Number.isFinite(Number(options.initialCelsius))
      ? Number(options.initialCelsius)
      : null;
    this.hasManual = options.hasManual === true;
    this.defaultTime = typeof options.defaultTime === 'string' && options.defaultTime
      ? options.defaultTime
      : WeatherTemperatureModal.localClock();
    this.initialTime = typeof options.initialTime === 'string' && options.initialTime
      ? options.initialTime
      : this.defaultTime;
    this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : () => {};
    this.disposeViewport = null;
    this.submitted = false;
    this.dragging = false;
    this.lastCelsius = this.initialCelsius;
  }

  static localClock() {
    const now = new Date();
    return clockTimeFromParts({ hour: now.getHours(), minute: now.getMinutes() });
  }

  text(key, values) {
    return t(this.settings, key, values);
  }

  onOpen() {
    this.modalEl.addClass(WEATHER_TEMPERATURE_MODAL_CLASS);
    const { contentEl } = this;
    contentEl.empty();
    this.disposeViewport = bindMoodModalViewport(this.modalEl, contentEl);
    const dateLabel = formatJournalDate(this.dateStr, this.settings);
    this.modalEl.setAttribute('aria-label', this.text('weatherTemperatureTitle', { date: dateLabel }));

    const head = contentEl.createDiv({ cls: 'cal-wt-head' });
    head.createSpan({ cls: 'cal-wt-date', text: dateLabel });

    // --- Readout: the number is the hero and stays directly editable ---
    const readout = contentEl.createDiv({ cls: 'cal-wt-readout' });
    this.inputEl = readout.createEl('input', {
      cls: 'cal-wt-value dayline-weather-temp-input',
      attr: {
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': this.text('weatherTemperatureLabel'),
        'aria-describedby': 'dayline-weather-temp-error',
      },
    });
    this.inputEl.value = this.initialCelsius == null
      ? ''
      : formatTemperatureValue(celsiusToDisplay(this.initialCelsius, this.units));
    readout.createSpan({ cls: 'cal-wt-unit', text: unitSymbolFor(this.units) });

    // The unit already says this is a temperature (the input carries the label
    // for screen readers), so the meta slot only appears to flag a manual reading.
    if (this.hasManual) {
      const meta = readout.createSpan({ cls: 'cal-wt-meta' });
      meta.createSpan({ text: this.text('weatherManualBadge') });
    }

    // --- Rail: the same value, drawn as a position on a scale ---
    this.railEl = contentEl.createDiv({
      cls: 'cal-wt-rail',
      attr: {
        role: 'slider',
        tabindex: '0',
        'aria-label': this.text('weatherTemperatureLabel'),
        'aria-valuemin': String(Math.round(celsiusToDisplay(WEATHER_RAIL_MIN_C, this.units))),
        'aria-valuemax': String(Math.round(celsiusToDisplay(WEATHER_RAIL_MAX_C, this.units))),
        title: this.text('weatherTemperatureDesc'),
      },
    });
    this.trackEl = this.railEl.createDiv({ cls: 'cal-wt-track' });
    this.thumbEl = this.railEl.createDiv({ cls: 'cal-wt-thumb' });

    const ticks = contentEl.createDiv({ cls: 'cal-wt-ticks' });
    WEATHER_RAIL_TICKS_C.forEach((celsius, index) => {
      const tick = ticks.createSpan({
        cls: index === 0 ? 'cal-wt-tick is-first' : 'cal-wt-tick',
        text: String(Math.round(celsiusToDisplay(celsius, this.units))),
      });
      tick.style.left = `${this.ratioForCelsius(celsius) * 100}%`;
    });

    this.errorEl = contentEl.createDiv({
      cls: 'cal-wt-error dayline-weather-temp-error',
      attr: { id: 'dayline-weather-temp-error', role: 'alert' },
    });
    this.errorEl.setText('');

    // --- Footer: the moment it refers to, then the actions ---
    const foot = contentEl.createDiv({ cls: 'cal-wt-foot' });
    const timeWrap = foot.createEl('label', { cls: 'cal-wt-time' });
    timeWrap.createSpan({ cls: 'cal-wt-time-label', text: this.text('weatherTimeLabel') });
    this.timeEl = timeWrap.createEl('input', {
      cls: 'dayline-weather-time-input',
      attr: { type: 'time', step: '60' },
    });
    this.timeEl.value = normalizeManualTime(this.initialTime, this.defaultTime);

    const actions = foot.createDiv({ cls: 'cal-wt-actions' });
    if (this.hasManual) {
      const clearBtn = actions.createEl('button', {
        cls: 'cal-wt-clear dayline-weather-temp-clear',
        text: this.text('weatherClearManual'),
      });
      clearBtn.addEventListener('click', () => this.submit(null));
    }
    const cancelBtn = actions.createEl('button', {
      cls: 'cal-wt-cancel',
      text: this.text('cancel'),
    });
    cancelBtn.addEventListener('click', () => this.close());

    this.saveBtn = actions.createEl('button', {
      cls: 'mod-cta cal-wt-save dayline-weather-temp-save',
      text: this.text('weatherRecord'),
    });
    this.saveBtn.addEventListener('click', () => this.submitCurrent());

    this.bindEvents();
    this.syncValueWidth();
    this.syncRail();
    this.refreshValidity();
    // The rail is the primary control, so it takes focus: the number keeps a
    // clean face instead of opening with a full-width text selection. Deferred
    // because the host focuses the first field while the modal is mounting.
    window.setTimeout(() => {
      if (this.railEl?.isConnected) this.railEl.focus();
    }, 0);
  }

  bindEvents() {
    const { contentEl } = this;
    contentEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.submitCurrent();
      }
    });

    this.inputEl.addEventListener('input', () => {
      this.syncValueWidth();
      this.syncRail();
      this.refreshValidity();
    });
    this.timeEl.addEventListener('input', () => this.refreshValidity());

    this.railEl.addEventListener('keydown', (event) => this.onRailKeydown(event));
    this.railEl.addEventListener('pointerdown', (event) => this.onRailPointerDown(event));
    this.railEl.addEventListener('pointermove', (event) => this.onRailPointerMove(event));
    this.railEl.addEventListener('pointerup', (event) => this.endRailDrag(event));
    this.railEl.addEventListener('pointercancel', (event) => this.endRailDrag(event));
  }

  onRailPointerDown(event) {
    if (typeof event.button === 'number' && event.button !== 0) return;
    this.dragging = true;
    this.railEl.setPointerCapture?.(event.pointerId);
    this.applyPointer(event.clientX);
    event.preventDefault();
  }

  onRailPointerMove(event) {
    if (!this.dragging) return;
    this.applyPointer(event.clientX);
    event.preventDefault();
  }

  endRailDrag(event) {
    if (!this.dragging) return;
    this.dragging = false;
    this.railEl.releasePointerCapture?.(event.pointerId);
  }

  onRailKeydown(event) {
    const step = event.shiftKey ? 5 : 1;
    const current = this.parseInput().ok ? Number(this.inputEl.value) : 0;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + step;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - step;
    else if (event.key === 'PageUp') next = current + 10;
    else if (event.key === 'PageDown') next = current - 10;
    else if (event.key === 'Home') next = Math.round(celsiusToDisplay(WEATHER_RAIL_MIN_C, this.units));
    else if (event.key === 'End') next = Math.round(celsiusToDisplay(WEATHER_RAIL_MAX_C, this.units));
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.applyDisplayValue(next);
  }

  ratioForCelsius(celsius) {
    const clamped = Math.min(WEATHER_RAIL_MAX_C, Math.max(WEATHER_RAIL_MIN_C, Number(celsius)));
    return (clamped - WEATHER_RAIL_MIN_C) / (WEATHER_RAIL_MAX_C - WEATHER_RAIL_MIN_C);
  }

  applyPointer(clientX) {
    const rect = this.trackEl?.getBoundingClientRect?.();
    if (!rect || !rect.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const celsius = WEATHER_RAIL_MIN_C + ratio * (WEATHER_RAIL_MAX_C - WEATHER_RAIL_MIN_C);
    this.applyDisplayValue(Math.round(celsiusToDisplay(celsius, this.units)));
  }

  applyDisplayValue(display) {
    this.inputEl.value = String(Math.round(display * 10) / 10);
    this.syncValueWidth();
    this.syncRail();
    this.refreshValidity();
  }

  /** Ch-sized width so the huge number never leaves a fixed gutter. */
  syncValueWidth() {
    if (!this.inputEl) return;
    const chars = Math.max(1, String(this.inputEl.value ?? '').length);
    this.inputEl.style.width = `calc(${chars}ch + 6px)`;
  }

  /** Keep the thumb and the ARIA value in step with the field. */
  syncRail() {
    if (!this.railEl) return;
    const parsed = this.parseInput();
    if (parsed.ok) this.lastCelsius = parsed.celsius;
    const celsius = Number.isFinite(this.lastCelsius) ? this.lastCelsius : 0;
    this.railEl.style.setProperty('--wt-ratio', String(this.ratioForCelsius(celsius)));
    const display = Number(this.inputEl?.value);
    this.railEl.setAttribute('aria-valuenow', String(Number.isFinite(display) ? display : ''));
  }

  /** Validate without side effects; drives both the error text and Save's state. */
  parseInput() {
    return parseTemperatureInput(this.inputEl?.value, this.units);
  }

  refreshValidity() {
    const parsed = this.parseInput();
    if (this.saveBtn) this.saveBtn.disabled = !parsed.ok;
    if (this.errorEl) {
      this.errorEl.setText(parsed.ok ? '' : this.text(parsed.messageKey));
      if (parsed.ok) this.errorEl.removeClass('is-visible');
      else this.errorEl.addClass('is-visible');
    }
    return parsed;
  }

  submitCurrent() {
    const parsed = this.refreshValidity();
    if (!parsed.ok) return;
    const time = normalizeManualTime(this.timeEl?.value, this.defaultTime);
    this.submit(parsed.celsius, time);
  }

  submit(celsius, time = null) {
    if (this.submitted) return;
    this.submitted = true;
    this.onSubmit(celsius, celsius == null ? null : time);
    this.close();
  }

  onClose() {
    this.disposeViewport?.();
    this.disposeViewport = null;
    this.contentEl.empty();
  }
}
