// @ts-nocheck
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('obsidian', () => ({ setIcon: (element, name) => { element.dataset.icon = name; } }));
import { JournalSourceSettingsEditor, validateJournalSources } from '../src/journal-source-settings';

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Event: dom.window.Event,
  });
  HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  HTMLElement.prototype.createEl = function (tag, options = {}) {
    const element = document.createElement(tag);
    if (options.text !== undefined) element.textContent = options.text;
    if (options.cls) element.className = options.cls;
    for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
    this.append(element);
    return element;
  };
  for (const [method, tag] of [['createDiv', 'div'], ['createSpan', 'span']]) {
    HTMLElement.prototype[method] = function (options = {}) { return this.createEl(tag, options); };
  }
});
afterEach(() => { document.body.replaceChildren(); });

function setup(sources = []) {
  const plugin = {
    settings: { displayLanguage: 'en', dailyFolder: 'Daily', journalSources: sources },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    journalIndex: { refresh: vi.fn().mockResolvedValue(undefined) },
    refreshJournalViews: vi.fn(),
  };
  const callbacks = { chooseFolder: vi.fn(), refreshCalendar: vi.fn().mockResolvedValue(undefined) };
  const editor = new JournalSourceSettingsEditor(plugin, callbacks);
  editor.mount(document.body);
  return { editor, plugin, callbacks };
}

function input(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function toggle(details, open) {
  details.open = open;
  details.dispatchEvent(new Event('toggle'));
}

describe('journal source validation', () => {
  it('keeps IDs and unknown fields while normalizing compatible legacy rows', () => {
    const raw = [{ path: 'Imports\\Entries/', label: 'Entries', extra: { enabled: 1 } }];
    expect(validateJournalSources(raw)).toEqual([{
      path: 'Imports/Entries', id: 'source-1', type: 'external', label: 'Entries', extra: { enabled: 1 },
    }]);
    expect(raw[0].path).toBe('Imports\\Entries/');
  });

  it.each([
    [{}, 'sourceInvalidArray'],
    [[null], 'sourceInvalidRow'],
    [[{ path: '' }], 'sourcePathRequired'],
    [[{ path: '../Daily' }], 'sourcePathRequired'],
    [[{ path: 'Daily', enabled: 'false' }], 'sourceInvalidRow'],
    [[{ path: 'Daily', type: 'bad' }], 'sourceInvalidType'],
    [[{ id: 'same', path: 'A' }, { id: 'same', path: 'B' }], 'sourceDuplicateId'],
    [[{ path: 'A' }, { path: 'A/' }], 'sourceDuplicatePath'],
    [[{ path: 'A', type: 'daily' }, { path: 'B', type: 'daily' }], 'sourceMultipleDaily'],
  ])('rejects invalid source contracts without saving', (raw, key) => {
    expect(() => validateJournalSources(raw)).toThrow(key);
  });
});

describe('journal source form', () => {
  it('does not save typing or folder selection until Apply and preserves custom metadata', async () => {
    const { editor, plugin, callbacks } = setup([{ id: 'import', path: 'Old', type: 'external', extra: 'keep' }]);
    input(editor.fields.querySelector('input'), 'New/Daily');
    editor.fields.querySelector('[aria-label="Choose folder"]').click();
    callbacks.chooseFolder.mock.calls[0][0]('Chosen/Daily');
    expect(plugin.settings.dailyFolder).toBe('Daily');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    await editor.apply();
    expect(plugin.settings.dailyFolder).toBe('Chosen/Daily');
    expect(plugin.settings.journalSources[0].extra).toBe('keep');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.journalIndex.refresh).toHaveBeenCalledAfter(plugin.saveSettings);
    expect(callbacks.refreshCalendar).toHaveBeenCalledTimes(1);
    expect(editor.status.textContent).toBe('Sources saved');
  });

  it('keeps invalid JSON local, shows an inline error and recovers without notices', async () => {
    const { editor, plugin } = setup();
    toggle(editor.fields.querySelector('details'), true);
    const json = editor.fields.querySelector('textarea');
    input(json, '[{');
    await editor.apply();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(plugin.settings.journalSources).toEqual([]);
    expect(json.value).toBe('[{');
    expect(editor.status.getAttribute('role')).toBe('alert');
    expect(editor.status.textContent).toContain('JSON');
    input(json, '[{"path":"Imports","type":"external"}]');
    await editor.apply();
    expect(plugin.settings.journalSources[0].path).toBe('Imports');
    expect(editor.dirty).toBe(false);
  });

  it('rolls back in-memory settings on save failure and retains the editable draft for retry', async () => {
    const { editor, plugin } = setup();
    plugin.saveSettings.mockRejectedValueOnce(new Error('disk unavailable'));
    input(editor.fields.querySelector('input'), 'New/Daily');
    await editor.apply();
    expect(plugin.settings.dailyFolder).toBe('Daily');
    expect(editor.dailyFolder).toBe('New/Daily');
    expect(editor.dirty).toBe(true);
    expect(editor.applyButton.disabled).toBe(false);
    expect(editor.status.textContent).toContain('disk unavailable');
    expect(plugin.journalIndex.refresh).not.toHaveBeenCalled();
    await editor.apply();
    expect(plugin.settings.dailyFolder).toBe('New/Daily');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
  });

  it('retries an index failure without rolling back persisted settings or saving twice', async () => {
    const { editor, plugin } = setup();
    plugin.journalIndex.refresh.mockRejectedValueOnce(new Error('index unavailable'));
    input(editor.fields.querySelector('input'), 'New/Daily');
    await editor.apply();
    expect(plugin.settings.dailyFolder).toBe('New/Daily');
    expect(editor.status.textContent).toContain('Sources saved, but');
    expect(editor.applyButton.textContent).toBe('Retry');
    await editor.apply();
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.journalIndex.refresh).toHaveBeenCalledTimes(2);
    expect(editor.status.textContent).toBe('Sources saved');
  });

  it('locks the rebuilt form through index refresh and ignores duplicate Apply', async () => {
    const { editor, plugin } = setup();
    let done;
    plugin.journalIndex.refresh.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    input(editor.fields.querySelector('input'), 'New/Daily');
    const pending = editor.apply();
    await vi.waitFor(() => expect(plugin.journalIndex.refresh).toHaveBeenCalled());
    expect([...editor.fields.querySelectorAll('input,select,button,textarea')].every(el => el.disabled)).toBe(true);
    await editor.apply();
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    done();
    await pending;
    expect(editor.fields.querySelector('input').disabled).toBe(false);
  });

  it('preserves incomplete drafts when the settings page rerenders and supports discard', () => {
    const { editor, plugin } = setup();
    editor.addButton.click();
    const path = editor.fields.querySelector('.dayline-source-row input');
    input(path, 'Unfinished');
    plugin.settings.displayLanguage = 'zh';
    document.body.replaceChildren();
    editor.mount(document.body);
    expect(editor.fields.querySelector('.dayline-source-row input').value).toBe('Unfinished');
    expect(editor.status.textContent).toBe('有未应用的更改');
    editor.resetButton.click();
    expect(editor.sources).toEqual([]);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('removes only a draft row and chooses a noncolliding ID for legacy sources', async () => {
    const { editor, plugin } = setup([{ path: 'Imports' }]);
    editor.addButton.click();
    expect(editor.sources[1].id).toBe('source-2');
    const remove = editor.fields.querySelectorAll('[aria-label="Remove source"]')[1];
    remove.click();
    expect(editor.sources).toEqual([{ path: 'Imports' }]);
    expect(plugin.settings.journalSources).toEqual([{ path: 'Imports' }]);
    await editor.apply();
    expect(plugin.settings.journalSources[0].id).toBe('source-1');
  });
});
