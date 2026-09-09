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
