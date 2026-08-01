export interface CalendarDisplaySettings {
  showCalendarMood?: boolean;
  showCalendarWeatherCard?: boolean;
  showCalendarWeatherBadge?: boolean;
  /** Legacy combined weather visibility setting. */
  showCalendarWeather?: boolean;
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
