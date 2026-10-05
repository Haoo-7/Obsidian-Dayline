import { describe, expect, it, vi } from 'vitest';

import { feelingLabel } from '../src/i18n';
import { isGenericJournalTitle } from '../src/excerpt';
import { shouldOpenTimelineEntryFromKey, shouldOpenTimelineEntryFromPointer } from '../src/journal-timeline-interaction';
import { displayedTimelineTitle, shouldShowTimelineMoodTrend, shouldShowTimelineTitles, timelineDayGroups } from '../src/journal-timeline-display';

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

describe('timeline day grouping', () => {
  it('marks a run of adjacent same-date entries so only the first card repeats the date', () => {
    // Two notes written on the same day used to render as two unrelated days:
    // a separator between them and a repeated weekday/day glyph on each card.
    const groups = timelineDayGroups([
      { date: '2026-10-04' },
      { date: '2026-10-04' },
      { date: '2026-10-04' },
      { date: '2026-10-05' },
    ]);
    expect(groups).toEqual([
      { sameDayAsPrevious: false, sameDayAsNext: true },
      { sameDayAsPrevious: true, sameDayAsNext: true },
      { sameDayAsPrevious: true, sameDayAsNext: false },
      { sameDayAsPrevious: false, sameDayAsNext: false },
    ]);
  });

  it('groups by adjacency, so a repeated date after another day stands alone', () => {
    const groups = timelineDayGroups([
      { date: '2026-10-04' },
      { date: '2026-10-05' },
      { date: '2026-10-04' },
    ]);
    expect(groups.map((group) => group.sameDayAsPrevious)).toEqual([false, false, false]);
    expect(groups.map((group) => group.sameDayAsNext)).toEqual([false, false, false]);
  });
});

describe('timeline card title', () => {
  it('shows a generic title the user typed into the inline editor', () => {
    // The regression: frontmatter `title: Freewrite` rendered as the placeholder,
    // so the title looked unsaved. Only inferred titles may be filtered.
    expect(displayedTimelineTitle({ title: 'Freewrite', explicitTitle: true }, isGenericJournalTitle)).toBe('Freewrite');
    expect(displayedTimelineTitle({ title: 'Daily note', explicitTitle: true }, isGenericJournalTitle)).toBe('Daily note');
  });

  it('still hides template filler and the date-only title', () => {
    expect(displayedTimelineTitle({ title: 'Freewrite' }, isGenericJournalTitle)).toBe('');
    expect(displayedTimelineTitle({ title: 'Daily note' }, isGenericJournalTitle)).toBe('');
    expect(displayedTimelineTitle({ title: '2026-07-18', date: '2026-07-18' }, isGenericJournalTitle)).toBe('');
    expect(displayedTimelineTitle({}, isGenericJournalTitle)).toBe('');
  });

  it('keeps a real inferred title', () => {
    expect(displayedTimelineTitle({ title: 'Low tide', date: '2026-07-18' }, isGenericJournalTitle)).toBe('Low tide');
  });
});
