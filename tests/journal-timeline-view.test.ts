import { describe, expect, it, vi } from 'vitest';

import { feelingLabel } from '../src/i18n';
import { shouldOpenTimelineEntryFromKey, shouldOpenTimelineEntryFromPointer } from '../src/journal-timeline-interaction';
import { shouldShowTimelineMoodTrend, shouldShowTimelineTitles } from '../src/journal-timeline-display';

describe('timeline interaction boundaries', () => {
  it('does not open an entry from Enter or Space inside interactive descendants', () => {
    const button = { closest: vi.fn(() => button) };
    const plain = { closest: vi.fn(() => null) };

    expect(shouldOpenTimelineEntryFromKey({ key: 'Enter', target: button })).toBe(false);
    expect(shouldOpenTimelineEntryFromKey({ key: ' ', target: button })).toBe(false);
    expect(shouldOpenTimelineEntryFromKey({ key: 'Enter', target: plain })).toBe(true);
    expect(shouldOpenTimelineEntryFromKey({ key: 'm', target: plain })).toBe(false);
    expect(shouldOpenTimelineEntryFromPointer(button)).toBe(false);
    expect(shouldOpenTimelineEntryFromPointer(plain)).toBe(true);
  });

  it('keeps built-in label localization separate from custom labels', () => {
    expect(feelingLabel({ displayLanguage: 'zh' }, 'calm')).toBe('平静');
    expect(feelingLabel({ displayLanguage: 'en' }, 'custom label')).toBe('custom label');
  });
});

describe('timeline mood trend display', () => {
  it('shows the seven-day mood trend by default', () => {
    expect(shouldShowTimelineMoodTrend({})).toBe(true);
    expect(shouldShowTimelineMoodTrend({ showTimelineMoodTrend: true })).toBe(true);
  });

  it('hides the mood trend area when the setting is disabled', () => {
    expect(shouldShowTimelineMoodTrend({ showTimelineMoodTrend: false })).toBe(false);
  });

  it('shows timeline titles by default and respects the setting', () => {
    expect(shouldShowTimelineTitles({})).toBe(true);
    expect(shouldShowTimelineTitles({ showTimelineTitles: true })).toBe(true);
    expect(shouldShowTimelineTitles({ showTimelineTitles: false })).toBe(false);
  });
});
