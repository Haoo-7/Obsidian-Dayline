export interface JournalTimelineDisplaySettings {
  showTimelineMoodTrend?: boolean;
}

/** Keep the existing trend visible for settings created before this option existed. */
export function shouldShowTimelineMoodTrend(settings: JournalTimelineDisplaySettings = {}): boolean {
  return settings.showTimelineMoodTrend !== false;
}
