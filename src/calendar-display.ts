export interface CalendarDisplaySettings {
  showCalendarMood?: boolean;
  showCalendarWeatherCard?: boolean;
  showCalendarWeatherBadge?: boolean;
  showCalendarWeatherLocation?: boolean;
  /** Legacy combined weather visibility setting. */
  showCalendarWeather?: boolean;
}

/** Keep the media name available to keyboard users without creating a hover label. */
export function calendarMediaAccessibilityLabel(dateStr: string, mediaLabel: string, focused: boolean): string | null {
  return focused ? `${dateStr} ${mediaLabel}` : null;
}

/** Missing fields remain visible so older plugin data keeps its current UI. */
export function shouldShowCalendarMood(settings: CalendarDisplaySettings = {}): boolean {
  return settings.showCalendarMood !== false;
}

export function shouldShowCalendarWeather(settings: CalendarDisplaySettings = {}): boolean {
  return shouldShowCalendarWeatherCard(settings) || shouldShowCalendarWeatherBadge(settings);
}

export function shouldShowCalendarWeatherCard(settings: CalendarDisplaySettings = {}): boolean {
  return settings.showCalendarWeatherCard ?? settings.showCalendarWeather !== false;
}

export function shouldShowCalendarWeatherBadge(settings: CalendarDisplaySettings = {}): boolean {
  return settings.showCalendarWeatherBadge ?? settings.showCalendarWeather !== false;
}

/** Location is opt-in so existing settings do not add a second weather-card line. */
export function shouldShowCalendarWeatherLocation(settings: CalendarDisplaySettings = {}): boolean {
  return settings.showCalendarWeatherLocation === true;
}
