/**
 * "Check for updates" for the settings support section.
 *
 * Dayline is listed in Obsidian's community catalogue, so the check asks the
 * same place the app's own plugin updater does: the published statistics file in
 * `obsidianmd/obsidian-releases`. That file is served by GitHub's raw CDN, which
 * reaches users who cannot open `api.github.com`, and it lists exactly the
 * versions that were approved into the catalogue — not whatever the repository
 * happens to contain today.
 *
 * It lives apart from the settings DOM so the parsing, the comparison and the
 * failure branches are unit-testable without a network.
 */

/** Published-version record the community plugin browser uses. */
export const COMMUNITY_STATS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json';

/** Dayline's catalogue id, i.e. the key it appears under in that file. */
export const PLUGIN_ID = 'dayline-journal';

/**
 * The catalogue is ~630 KB compressed (2.8 MB of JSON for ~2 000 plugins), so a
 * repeat click must not download it again. Ten minutes is short enough that a
 * release published while the pane is open still shows up.
 */
export const STATS_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * `requestUrl` has no timeout of its own: a socket that never answers would
 * leave the button stuck on "checking". The check gives up and says so instead.
 */
export const UPDATE_TIMEOUT_MS = 15_000;

export type UpdateCheckStatus = 'current' | 'update' | 'error';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  /** Newest published version, when the catalogue listed one. */
  version?: string;
  /** Short reason, already user-readable enough to sit after a colon. */
  error?: string;
}

/** The subset of Obsidian's `RequestUrlParam`/`RequestUrlResponse` we use. */
export interface UpdateRequestResponse {
  status?: number;
  json?: unknown;
  text?: string;
}
export type UpdateRequest = (params: {
  url: string;
  headers?: Record<string, string>;
  throw?: boolean;
}) => Promise<UpdateRequestResponse>;

let obsidianRequest: UpdateRequest | undefined;
function getRequest(): UpdateRequest {
  if (!obsidianRequest) obsidianRequest = (require('obsidian') as { requestUrl: UpdateRequest }).requestUrl;
  return obsidianRequest;
}

/**
 * Numeric parts of a version. Catalogue keys are bare versions (`2.10.1`), but
 * tags carry a `v` and may carry a suffix; only the dotted numbers decide
 * ordering, and anything else is not comparable.
 */
export function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(String(value ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `1` when `candidate` is newer than `current`, `0` when equal, `-1` when older. */
export function compareVersions(candidate: string, current: string): number {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

/**
 * Newest published version in one catalogue entry.
 *
 * The entry looks like `{ downloads: 12, updated: 1699…, "2.9.0": 4, "2.10.0": 9 }`:
 * versions are the keys, counts are the values. Sorting by number rather than by
 * string is the whole job — `"2.10.0" < "2.9.0"` as text.
 */
export function latestPublishedVersion(stats: unknown, pluginId: string = PLUGIN_ID): string | null {
  if (!stats || typeof stats !== 'object') return null;
  const entry = (stats as Record<string, unknown>)[pluginId];
  if (!entry || typeof entry !== 'object') return null;

  let newest: string | null = null;
  for (const key of Object.keys(entry as Record<string, unknown>)) {
    if (!parseVersion(key)) continue;
    if (newest === null || compareVersions(key, newest) > 0) newest = key;
  }
  return newest;
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? 'unknown error');
}

function readJson(response: UpdateRequestResponse): unknown {
  if (response.json && typeof response.json === 'object') return response.json;
  if (typeof response.text === 'string' && response.text.trim() !== '') {
    try {
      return JSON.parse(response.text);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Compare the running version with the newest one in the community catalogue.
 *
 * Never throws: a failed check is a `status: 'error'` result, because the caller
 * turns it into a notice and the settings pane has to stay usable offline.
 */
let cachedStats: { at: number; stats: unknown } | null = null;

/** Drop the cached catalogue. Exposed for tests and for a future manual refresh. */
export function clearUpdateCache(): void {
  cachedStats = null;
}

/** Reject with `timed out` when the platform never answers. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function checkForUpdate(
  currentVersion: string,
  pluginId: string = PLUGIN_ID,
  request: UpdateRequest = getRequest(),
  now: number = Date.now(),
): Promise<UpdateCheckResult> {
  let stats: unknown;
  const fresh = cachedStats && now - cachedStats.at < STATS_CACHE_TTL_MS ? cachedStats.stats : null;

  if (fresh) {
    stats = fresh;
  } else {
    let response: UpdateRequestResponse;
    try {
      response = await withTimeout(request({ url: COMMUNITY_STATS_URL, throw: false }), UPDATE_TIMEOUT_MS);
    } catch (error) {
      return { status: 'error', error: describe(error) };
    }

    const status = typeof response?.status === 'number' ? response.status : 0;
    if (status >= 400) return { status: 'error', error: `HTTP ${status}` };

    stats = readJson(response ?? {});
    if (!stats) return { status: 'error', error: 'unreadable response' };
    cachedStats = { at: now, stats };
  }

  if (!(stats as Record<string, unknown>)[pluginId]) {
    // Not in the catalogue (yet): a local build, or a listing that is still pending.
    return { status: 'error', error: 'not listed in the community catalogue' };
  }

  const latest = latestPublishedVersion(stats, pluginId);
  if (!latest) return { status: 'error', error: 'no published version' };

  return compareVersions(latest, currentVersion) > 0
    ? { status: 'update', version: latest }
    : { status: 'current', version: latest };
}
