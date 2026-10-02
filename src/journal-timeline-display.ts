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
