import { joinVaultPath, normalizeVaultPath, parentVaultPath, parseDiaryDate } from './date-utils';

export interface DailyNoteSettings {
  dailyFolder?: string;
  dailyNoteFormat?: string;
  dailyNoteTemplate?: string;
  followDailyNotes?: boolean;
}

export interface DailyNoteConfig {
  followDailyNotes: boolean;
  available: boolean;
  folder: string;
  format: string;
  template: string;
}

export interface DailyNoteTarget {
  date: string;
  path: string;
  folder: string;
  title: string;
}

export function resolveDailyNoteConfig(app: any, settings: DailyNoteSettings): DailyNoteConfig {
  const core = app?.internalPlugins?.getPluginById?.('daily-notes');
  const options = core?.instance?.options || {};
  const followDailyNotes = settings.followDailyNotes === true;
  return {
    followDailyNotes,
    available: !followDailyNotes || core?.enabled === true,
    folder: normalizeVaultPath(followDailyNotes
      ? String(options.folder || '')
      : settings.dailyFolder?.trim() || 'Calendar/Daily'),
    format: String((followDailyNotes ? options.format : settings.dailyNoteFormat) || 'YYYY-MM-DD'),
    // An unset value retains the template used by older versions. Once the
    // editor saves a selection, an empty string explicitly means no template.
    template: String(followDailyNotes || settings.dailyNoteTemplate === undefined
      ? options.template || '' : settings.dailyNoteTemplate),
  };
}

export function resolveDailyNoteTarget(app: any, settings: DailyNoteSettings, date: string): DailyNoteTarget {
  const config = resolveDailyNoteConfig(app, settings);
  if (!config.available) throw new Error('sourceDailyUnavailable');
  if (!parseDiaryDate(`${date}.md`)) throw new Error('sourceDailyInvalidDate');
  let relative = date;
  if (config.format !== 'YYYY-MM-DD') {
    // Obsidian supplies Moment in each app window; do not bundle a second copy.
    const moment = typeof window === 'undefined' ? undefined : (window as any).moment;
    if (typeof moment !== 'function') throw new Error('sourceDailyInvalidDate');
    relative = moment(date, 'YYYY-MM-DD', true).format(config.format);
  }
  const path = joinVaultPath(config.folder, `${relative.trim()}.md`);
  if (!relative.trim() || /[\\:\u0000-\u001f]/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('sourceDailyInvalidPath');
  }
  return { date, path, folder: parentVaultPath(path), title: path.split('/').pop()!.slice(0, -3) };
}

export function parseDailyNotePath(config: DailyNoteConfig, path: string): string | null {
  if (!config.available) return null;
  const normalized = normalizeVaultPath(path);
  const prefix = config.folder ? `${config.folder}/` : '';
  if (!normalized.startsWith(prefix) || !normalized.endsWith('.md')) return null;
  const relative = normalized.slice(prefix.length, -3);
  if (config.format === 'YYYY-MM-DD') return parseDiaryDate(`${relative}.md`)?.date ?? null;
  const moment = typeof window === 'undefined' ? undefined : (window as any).moment;
  if (typeof moment !== 'function') return null;
  const day = moment(relative, config.format, true);
  return day.isValid() && day.format(config.format) === relative ? day.format('YYYY-MM-DD') : null;
}

/** Read-only surfaces must remain usable when the selected source is unavailable. */
export function resolveDailyNotePath(app: any, settings: DailyNoteSettings, date: string): string | null {
  try {
    return resolveDailyNoteTarget(app, settings, date).path;
  } catch {
    return null;
  }
}
