// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  Modal: class {
    app: unknown;
    modalEl = document.createElement('div');
    contentEl = document.createElement('div');

    constructor(app: unknown) {
      this.app = app;
      this.contentEl.classList.add('modal-content');
      this.modalEl.append(this.contentEl);
      document.body.append(this.modalEl);
    }

    close() {
      (this as { onClose?: () => void }).onClose?.();
      this.modalEl.remove();
    }
  },
}));

import { t } from '../src/i18n';
import { WeatherTemperatureModal } from '../src/weather-temperature-modal';

function mount(options: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const modal = new WeatherTemperatureModal({}, {
    dateStr: '2026-10-26',
    units: 'metric',
    defaultTime: '15:30',
    onSubmit,
    ...options,
  });
  modal.onOpen();
  const root = (modal as unknown as { contentEl: HTMLElement }).contentEl;
  return {
    modal,
    onSubmit,
    root,
    temp: root.querySelector('.dayline-weather-temp-input') as HTMLInputElement,
    time: root.querySelector('.dayline-weather-time-input') as HTMLInputElement,
    save: root.querySelector('.dayline-weather-temp-save') as HTMLButtonElement,
    clear: root.querySelector('.dayline-weather-temp-clear') as HTMLButtonElement | null,
    error: root.querySelector('.dayline-weather-temp-error') as HTMLElement,
  };
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(input: HTMLInputElement, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}


function pointer(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'button', { value: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function press(target: HTMLElement, key: string, extra: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
}

afterEach(() => document.body.replaceChildren());

describe('weather temperature modal', () => {
  it('prefills the current reading and time and allows saving immediately', () => {
    const { temp, time, save } = mount({ initialCelsius: 20, initialTime: '15:30' });

    expect(temp.value).toBe('20');
    expect(time.value).toBe('15:30');
    expect(save.disabled).toBe(false);
  });

  it('converts a stored Celsius reading into the active unit', () => {
    const { temp } = mount({ units: 'imperial', initialCelsius: 20 });

    expect(temp.value).toBe('68');
  });

  it('submits the parsed Celsius value with the wall clock', () => {
    const { modal, onSubmit, temp, time } = mount();

    type(temp, '18');
    time.value = '09:05';
    (modal as unknown as { submitCurrent: () => void }).submitCurrent();

    expect(onSubmit).toHaveBeenCalledWith(18, '09:05');
  });

  it('converts imperial input back to Celsius before submitting', () => {
    const { modal, onSubmit, temp } = mount({ units: 'imperial' });

    type(temp, '68');
    (modal as unknown as { submitCurrent: () => void }).submitCurrent();

    expect(onSubmit).toHaveBeenCalledWith(20, '15:30');
  });

  it('falls back to the default clock when the time is cleared', () => {
    const { modal, onSubmit, temp, time } = mount();

    type(temp, '18');
    time.value = '';
    (modal as unknown as { submitCurrent: () => void }).submitCurrent();

    expect(onSubmit).toHaveBeenCalledWith(18, '15:30');
  });

  it('submits on Enter', () => {
    const { onSubmit, temp } = mount();

    type(temp, '18');
    key(temp, 'Enter');

    expect(onSubmit).toHaveBeenCalledWith(18, '15:30');
  });

  it('closes on Escape without submitting', () => {
    const { modal, onSubmit, temp } = mount();

    type(temp, '18');
    const event = key(temp, 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect((modal as unknown as { contentEl: HTMLElement }).contentEl.childElementCount).toBe(0);
  });

  it('does not submit a malformed value and explains why', () => {
    const { modal, onSubmit, temp, save, error } = mount();

    type(temp, 'abc');

    expect(save.disabled).toBe(true);
    expect(error.textContent).toBe(t({}, 'weatherTemperatureInvalid'));
    expect(error.classList.contains('is-visible')).toBe(true);

    (modal as unknown as { submitCurrent: () => void }).submitCurrent();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the clear action only for a date that already has a reading', () => {
    expect(mount().clear).toBeNull();

    const { modal, onSubmit, clear } = mount({ hasManual: true, initialCelsius: 18 });
    expect(clear).not.toBeNull();
    (clear as HTMLButtonElement).click();

    expect(onSubmit).toHaveBeenCalledWith(null, null);
    expect((modal as unknown as { contentEl: HTMLElement }).contentEl.childElementCount).toBe(0);
  });

  it('prefills an existing reading so editing keeps the recorded time', () => {
    const { temp, time } = mount({ hasManual: true, initialCelsius: 18, initialTime: '07:45' });

    expect(temp.value).toBe('18');
    expect(time.value).toBe('07:45');
  });

  it('submits only once even when two activations race', () => {
    const { modal, onSubmit, temp } = mount();

    type(temp, '18');
    const instance = modal as unknown as { submitCurrent: () => void };
    instance.submitCurrent();
    instance.submitCurrent();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('weather temperature rail', () => {
  function mountWithRail(options: Record<string, unknown> = {}) {
    const mounted = mount(options);
    const rail = mounted.root.querySelector('.cal-wt-rail') as HTMLElement;
    const track = mounted.root.querySelector('.cal-wt-track') as HTMLElement;
    track.getBoundingClientRect = () => ({
      left: 0, right: 400, top: 0, bottom: 22, width: 400, height: 22, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
    return { ...mounted, rail, track };
  }

  it('exposes the current value and the rail bounds to assistive tech', () => {
    const { rail } = mountWithRail({ initialCelsius: 29 });

    expect(rail.getAttribute('role')).toBe('slider');
    expect(rail.getAttribute('aria-valuemin')).toBe('-20');
    expect(rail.getAttribute('aria-valuemax')).toBe('45');
    expect(rail.getAttribute('aria-valuenow')).toBe('29');
  });

  it('positions the thumb from the typed value', () => {
    const { rail, temp } = mountWithRail();

    type(temp, '29');

    expect(Number(rail.style.getPropertyValue('--wt-ratio'))).toBeCloseTo(49 / 65, 4);
  });

  it('pins the thumb at an end for a value outside the rail range', () => {
    const { rail, temp } = mountWithRail();

    type(temp, '60');
    expect(Number(rail.style.getPropertyValue('--wt-ratio'))).toBe(1);

    type(temp, '-40');
    expect(Number(rail.style.getPropertyValue('--wt-ratio'))).toBe(0);
    expect(temp.value).toBe('-40');
  });

  it('sets the value by dragging the rail', () => {
    const { rail, temp } = mountWithRail();

    rail.dispatchEvent(pointer('pointerdown', 300));
    expect(temp.value).toBe('29');

    rail.dispatchEvent(pointer('pointermove', 0));
    expect(temp.value).toBe('-20');

    rail.dispatchEvent(pointer('pointerup', 0));
    expect(rail.getAttribute('aria-valuenow')).toBe('-20');
  });

  it('stops following the pointer after release', () => {
    const { rail, temp } = mountWithRail();

    rail.dispatchEvent(pointer('pointerdown', 300));
    rail.dispatchEvent(pointer('pointerup', 300));
    rail.dispatchEvent(pointer('pointermove', 0));

    expect(temp.value).toBe('29');
  });

  it('steps with the arrow keys, faster with shift and page keys', () => {
    const { rail, temp } = mountWithRail({ initialCelsius: 20 });

    press(rail, 'ArrowUp');
    expect(temp.value).toBe('21');

    press(rail, 'ArrowDown');
    press(rail, 'ArrowDown');
    expect(temp.value).toBe('19');

    press(rail, 'ArrowRight', { shiftKey: true });
    expect(temp.value).toBe('24');

    press(rail, 'PageDown');
    expect(temp.value).toBe('14');
  });

  it('jumps to the rail ends with Home and End', () => {
    const { rail, temp } = mountWithRail({ initialCelsius: 20 });

    press(rail, 'Home');
    expect(temp.value).toBe('-20');

    press(rail, 'End');
    expect(temp.value).toBe('45');
  });

  it('converts the rail range and steps to Fahrenheit', () => {
    const { rail, temp } = mountWithRail({ units: 'imperial', initialCelsius: 20 });

    expect(rail.getAttribute('aria-valuemin')).toBe('-4');
    expect(rail.getAttribute('aria-valuemax')).toBe('113');
    expect(temp.value).toBe('68');

    press(rail, 'ArrowUp');
    expect(temp.value).toBe('69');
  });
});

describe('weather temperature header and meta', () => {
  it('shows the localized date without a redundant title', () => {
    const { root } = mount({ dateStr: '2026-10-08', settings: { displayLanguage: 'zh' } });

    expect(root.querySelector('.cal-wt-date')?.textContent).toBe('10月8日 周四');
  });

  it('marks the reading as manual only when one exists', () => {
    // The unit already says it is a temperature, so a plain reading has no meta.
    const plain = mount({ settings: { displayLanguage: 'zh' } });
    expect(plain.root.querySelector('.cal-wt-meta')).toBeNull();

    const manual = mount({ settings: { displayLanguage: 'zh' }, hasManual: true });
    expect(manual.root.querySelector('.cal-wt-meta')?.textContent).toBe('手动');
  });

  it('uses Obsidian\'s primary button for record', () => {
    const { root } = mount({ settings: { displayLanguage: 'zh' } });
    expect(root.querySelector('.cal-wt-save')?.classList.contains('mod-cta')).toBe(true);
    expect(root.querySelector('.cal-wt-cancel')?.classList.contains('mod-cta')).toBe(false);
  });
});
