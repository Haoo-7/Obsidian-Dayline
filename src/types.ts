export type WeatherUnits = 'metric' | 'imperial';

export interface WeatherSettings {
  weatherLatitude: string | number;
  weatherLongitude: string | number;
  weatherUnits: WeatherUnits | string;
  weatherTimezone?: string;
}

export interface WeatherSnapshot {
  date?: string;
  fetchedAt?: string;
  cachedAt?: string;
  latitude?: number | string;
  longitude?: number | string;
  units?: WeatherUnits | string;
  configKey?: string;
  location?: string;
  /** Daily precipitation probability, when Open-Meteo provides it. */
  precipitationProbability?: number | null;
  /** Current or daily maximum wind speed in the snapshot's configured units. */
  windSpeed?: number | null;
  /** Open-Meteo local wall-clock timestamp for sunrise. */
  sunrise?: string | null;
  /** Open-Meteo local wall-clock timestamp for sunset. */
  sunset?: string | null;
  /** Transient UI state; these flags are never canonical cache data. */
  stale?: boolean;
  offline?: boolean;
  [key: string]: unknown;
}

export interface ExifField {
  key: string;
  value: string;
}

export type MediaKind = 'image' | 'video' | 'audio' | 'unknown';

export interface MediaAttachment {
  /** The original link as written in Markdown/frontmatter. */
  link: string;
  /** A link without wikilink syntax, aliases, sizing hints, or URL fragments. */
  normalizedLink: string;
  /** The journal note that owns the attachment; used for relative link resolution. */
  sourcePath: string;
  kind: MediaKind;
  extension?: string;
  external: boolean;
}

export interface MediaMetadata {
  kind: MediaKind;
  duration?: number;
  width?: number;
  height?: number;
  rotation?: number;
  codec?: string;
  frameRate?: number;
  capturedAt?: string;
  make?: string;
  model?: string;
  lens?: string;
  aperture?: string;
  shutter?: string;
  iso?: string;
  focalLength?: string;
  software?: string;
  latitude?: number;
  longitude?: number;
  title?: string;
  artist?: string;
  album?: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  artwork?: { data: Uint8Array; mimeType: string };
}

export type JournalSourceType = 'daily' | 'external';

export type JournalMediaFilter = 'all' | 'any' | 'image' | 'video' | 'audio' | 'none';

export interface JournalSource {
  id: string;
  path: string;
  type: JournalSourceType;
  enabled?: boolean;
  dateField?: string;
  label?: string;
}

export interface MoodRecord {
  score: -2 | -1 | 0 | 1 | 2;
  labels: string[];
  /** Optional free-form context for the day's mood. */
  note?: string | null;
  recordedAt: string;
  updatedAt: string;
  /** Preserve forward-compatible fields written by newer versions/importers. */
  [key: string]: unknown;
}

export interface MoodMetadata {
  schemaVersion: 2;
  entries: Record<string, MoodRecord>;
  orphans?: Record<string, { record: MoodRecord; orphanedAt: string; [key: string]: unknown }>;
  /** User-created labels. Built-in labels remain defined by `src/mood.ts`. */
  customLabels?: string[];
  /** Preserve forward-compatible metadata fields. */
  [key: string]: unknown;
}

export interface JournalEntry {
  path: string;
  date: string;
  title: string;
  excerpt: string;
  sourceId: string;
  sourcePath: string;
  sourceType: JournalSourceType;
  sourceLabel?: string;
  favorite: boolean;
  uuid?: string;
  createdAt?: string;
  modifiedAt?: string;
  location?: { name?: string; latitude?: number; longitude?: number };
  attachments: string[];
  /** Derived, normalized media attachments. `attachments` remains for compatibility. */
  media?: MediaAttachment[];
  /** Explicit frontmatter cover link, when present. */
  cover?: string;
  /** Normalized, deduplicated Obsidian/frontmatter tags. */
  tags?: string[];
  searchText?: string;
  /** Alias retained for callers that distinguish normalized search from raw content. */
  normalizedSearchText?: string;
  weather?: WeatherSnapshot;
  mood?: MoodRecord;
  activity?: unknown;
  frontmatter: Record<string, unknown>;
}

export interface JournalDiagnostic {
  path: string;
  reason: 'outside-source' | 'missing-date' | 'invalid-date' | 'read-failed';
  detail?: string;
}

export interface JournalFilter {
  query?: string;
  from?: string;
  to?: string;
  sourceId?: string;
  moodScore?: number;
  favoriteOnly?: boolean;
  media?: JournalMediaFilter;
  /** Stable location key returned by the timeline location option helper. */
  location?: string;
  /** Normalized tag value without a leading #. */
  tag?: string;
}

export interface CalendarDaySummary {
  date: string;
  entries: JournalEntry[];
  entryCount: number;
  sourceIds: string[];
  hasRecord: boolean;
  hasWeather: boolean;
  primaryEntryPath?: string;
  /** All normalized media in stable entry/link order. */
  media: MediaAttachment[];
  /** Explicit cover first, otherwise the first media attachment. */
  cover?: MediaAttachment;
  /** Compatibility aliases used by existing calendar rendering code. */
  path?: string;
  mood?: MoodRecord;
  images?: MediaAttachment[];
}
