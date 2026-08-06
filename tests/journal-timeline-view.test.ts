import { describe, expect, it, vi } from 'vitest';

import { feelingLabel } from '../src/i18n';
import { shouldOpenTimelineEntryFromKey } from '../src/journal-timeline-interaction';

describe('timeline interaction boundaries', () => {
  it('does not open an entry from Enter or Space inside interactive descendants', () => {
    const button = { closest: vi.fn(() => button) };
    const plain = { closest: vi.fn(() => null) };

    expect(shouldOpenTimelineEntryFromKey({ key: 'Enter', target: button })).toBe(false);
    expect(shouldOpenTimelineEntryFromKey({ key: ' ', target: button })).toBe(false);
    expect(shouldOpenTimelineEntryFromKey({ key: 'Enter', target: plain })).toBe(true);
    expect(shouldOpenTimelineEntryFromKey({ key: 'm', target: plain })).toBe(false);
  });

  it('keeps built-in label localization separate from custom labels', () => {
    expect(feelingLabel({ displayLanguage: 'zh' }, 'calm')).toBe('平静');
    expect(feelingLabel({ displayLanguage: 'en' }, 'custom label')).toBe('custom label');
  });
});
