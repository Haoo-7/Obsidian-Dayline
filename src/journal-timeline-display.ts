export interface JournalTimelineDisplaySettings {
  showTimelineMoodTrend?: boolean;
  showTimelineTitles?: boolean;
}

/** Keep the existing trend visible for settings created before this option existed. */
export function shouldShowTimelineMoodTrend(settings: JournalTimelineDisplaySettings = {}): boolean {
  return settings.showTimelineMoodTrend !== false;
}

/** Titles are enabled by default for settings created before this option existed. */
export function shouldShowTimelineTitles(settings: JournalTimelineDisplaySettings = {}): boolean {
  return settings.showTimelineTitles !== false;
}

export interface TimelineTitleCandidate {
  title?: string;
  date?: string;
  /** True when the title came from frontmatter the user wrote. */
  explicitTitle?: boolean;
}

/**
 * The title a card may display, or `''` for the placeholder.
 *
 * Template filler such as `Daily note` or `Freewrite` must not become every
 * card's title, but a frontmatter title is a deliberate choice by the user —
 * the inline title editor writes one — so it is never screened out, even when
 * it reads exactly like that filler.
 */
export function displayedTimelineTitle(
  entry: TimelineTitleCandidate,
  isGeneric: (title: string, date?: string) => boolean,
): string {
  if (!entry.title) return '';
  if (entry.explicitTitle) return entry.title;
  return isGeneric(entry.title, entry.date) ? '' : entry.title;
}

export interface TimelineDayGroup {
  /** An earlier adjacent entry has the same journal date. */
  sameDayAsPrevious: boolean;
  /** A later adjacent entry has the same journal date. */
  sameDayAsNext: boolean;
}

/**
 * Day-group membership for a run of timeline entries.
 *
 * Entries are sorted by date, so same-date entries are adjacent, and adjacent
 * entries sharing a journal date render as one visible day: only the first
 * card shows the weekday/day glyph and the earlier card drops the separator
 * below it. Neighbors are read from the list passed in — pass the full
 * filtered list, not the rendered page, so a "show more" boundary cannot
 * split a group.
 */
export function timelineDayGroups(entries: ReadonlyArray<{ date?: string }>): TimelineDayGroup[] {
  return entries.map((entry, index) => {
    const previous = entries[index - 1];
    const next = entries[index + 1];
    return {
      sameDayAsPrevious: Boolean(previous) && previous.date === entry.date,
      sameDayAsNext: Boolean(next) && next.date === entry.date,
    };
  });
}
