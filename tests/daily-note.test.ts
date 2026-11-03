import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import moment from 'moment';
import { parseDailyNotePath, resolveDailyNoteConfig, resolveDailyNotePath, resolveDailyNoteTarget } from '../src/daily-note';

function appWithDailyNotes(options = {}, enabled = true) {
  return { internalPlugins: { getPluginById: () => ({ enabled, instance: { options } }) } };
}

describe('daily note paths', () => {
  beforeEach(() => vi.stubGlobal('window', { moment }));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps custom creation paths when following is off', () => {
    const app = appWithDailyNotes({ folder: 'Official', format: 'YYYY/MM/DD', template: 'Templates/Day' });
    expect(resolveDailyNoteTarget(app, { dailyFolder: 'Custom' }, '2026-10-21')).toEqual({
      date: '2026-10-21', path: 'Custom/2026-10-21.md', folder: 'Custom', title: '2026-10-21',
    });
    expect(resolveDailyNoteConfig(app, {}).template).toBe('Templates/Day');
    expect(resolveDailyNoteTarget(app, { dailyFolder: '/' }, '2026-10-21').path).toBe('2026-10-21.md');
    expect(resolveDailyNoteTarget(app, { dailyFolder: '' }, '2026-10-21').path).toBe('Calendar/Daily/2026-10-21.md');
  });

  it('uses native defaults for the vault root and blank format', () => {
    const app = appWithDailyNotes({ folder: '', format: '' });
    const settings = { followDailyNotes: true, dailyFolder: 'Custom' };
    expect(resolveDailyNoteTarget(app, settings, '2026-10-21')).toEqual({
      date: '2026-10-21', path: '2026-10-21.md', folder: '', title: '2026-10-21',
    });
    const config = resolveDailyNoteConfig(app, settings);
    expect(parseDailyNotePath(config, '2026-10-21.md')).toBe('2026-10-21');
    expect(parseDailyNotePath(config, 'Other/2026-10-21.md')).toBeNull();
  });

  it('uses an independent custom format and template even when core Daily Notes is disabled', () => {
    const app = appWithDailyNotes({ folder: 'Official', format: 'YYYY-MM-DD', template: 'Official/Template' }, false);
    const settings = { dailyFolder: 'Journal', dailyNoteFormat: 'YY/MM/YYYY-MM-DD', dailyNoteTemplate: 'Templates/Custom' };
    const config = resolveDailyNoteConfig(app, settings);
    expect(config.template).toBe('Templates/Custom');
    expect(resolveDailyNoteTarget(app, settings, '2026-11-03').path).toBe('Journal/26/11/2026-11-03.md');
    expect(parseDailyNotePath(config, 'Journal/26/11/2026-11-03.md')).toBe('2026-11-03');
    expect(parseDailyNotePath(config, 'Journal/2026-11-03.md')).toBeNull();
  });

  it('lets an explicitly empty custom template override the legacy official template', () => {
    const app = appWithDailyNotes({ template: 'Templates/Official' });
    expect(resolveDailyNoteConfig(app, { dailyNoteTemplate: '' }).template).toBe('');
    expect(resolveDailyNoteConfig(app, { dailyNoteTemplate: 'Templates/Local.md' }).template).toBe('Templates/Local.md');
  });

  it('uses the official values while following without changing custom settings', () => {
    const app = appWithDailyNotes({ folder: 'Official', format: 'YYYY/MM/DD [entry]', template: 'Official/Template' });
    const settings = {
      followDailyNotes: true, dailyFolder: 'Custom', dailyNoteFormat: 'YY/MM/YYYY-MM-DD', dailyNoteTemplate: 'Custom/Template',
    };
    expect(resolveDailyNoteConfig(app, settings)).toMatchObject({
      folder: 'Official', format: 'YYYY/MM/DD [entry]', template: 'Official/Template',
    });
    expect(resolveDailyNoteConfig(app, { ...settings, followDailyNotes: false })).toMatchObject({
      folder: 'Custom', format: 'YY/MM/YYYY-MM-DD', template: 'Custom/Template',
    });
  });

  it('roundtrips full native paths and rejects unrelated or invalid dates', () => {
    const config = resolveDailyNoteConfig(appWithDailyNotes({ folder: 'Official', format: 'YYYY/MM/DD [entry]' }), { followDailyNotes: true });
    expect(parseDailyNotePath(config, 'Official/2024/02/29 entry.md')).toBe('2024-02-29');
    expect(parseDailyNotePath(config, 'Official/2026/02/30 entry.md')).toBeNull();
    expect(parseDailyNotePath(config, 'Official/2026/10/21.md')).toBeNull();
    expect(parseDailyNotePath(config, 'Other/2026/10/21 entry.md')).toBeNull();
  });

  it('never falls back to a custom folder when the native plugin is unavailable', () => {
    for (const app of [{}, appWithDailyNotes({}, false)]) {
      const settings = { followDailyNotes: true, dailyFolder: 'Custom' };
      expect(() => resolveDailyNoteTarget(app, settings, '2026-10-21')).toThrow('sourceDailyUnavailable');
      expect(resolveDailyNotePath(app, settings, '2026-10-21')).toBeNull();
    }
  });

  it('rejects invalid input dates and parent-directory formats before creation', () => {
    expect(() => resolveDailyNoteTarget({}, {}, '2026-02-30')).toThrow('sourceDailyInvalidDate');
    expect(() => resolveDailyNoteTarget(appWithDailyNotes({ format: '[../]YYYY-MM-DD' }), { followDailyNotes: true }, '2026-10-21')).toThrow('sourceDailyInvalidPath');
  });
});
