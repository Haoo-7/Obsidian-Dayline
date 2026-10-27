import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkForUpdate,
  clearUpdateCache,
  COMMUNITY_STATS_URL,
  compareVersions,
  latestPublishedVersion,
  parseVersion,
  STATS_CACHE_TTL_MS,
  UPDATE_TIMEOUT_MS,
  type UpdateRequest,
} from '../src/plugin-update-check';

// The catalogue is cached for the session, so every case starts from a cold one.
beforeEach(() => { clearUpdateCache(); });

function respond(body: unknown, status = 200): UpdateRequest {
  return async () => ({ status, json: body });
}

/** One catalogue entry, shaped like the published statistics file. */
function catalogue(versions: string[], downloads = 1555) {
  const entry: Record<string, number> = { downloads, updated: 1792311591000 };
  versions.forEach((version, index) => { entry[version] = index + 1; });
  return { 'dayline-journal': entry, 'some-other-plugin': { downloads: 1, '0.0.1': 1 } };
}

describe('release version comparison', () => {
  it('reads the numbers out of a version and ignores a suffix', () => {
    expect(parseVersion('v2.10.1')).toEqual([2, 10, 1]);
    expect(parseVersion('2.10.1-beta.2')).toEqual([2, 10, 1]);
    expect(parseVersion('release-2')).toBeNull();
  });

  it('orders numerically rather than lexically', () => {
    // '2.9.0' > '2.10.0' as strings; the whole check would invert without this.
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1);
    expect(compareVersions('v2.10.1', '2.10.1')).toBe(0);
  });
});

describe('reading the published catalogue entry', () => {
  it('picks the newest version key, not the first or the last', () => {
    expect(latestPublishedVersion(catalogue(['2.9.4', '2.10.0', '2.3.6']))).toBe('2.10.0');
  });

  it('ignores the non-version keys in the entry', () => {
    // downloads and updated are numbers, not versions, and must not win.
    expect(latestPublishedVersion(catalogue(['2.10.1']))).toBe('2.10.1');
  });

  it('returns null for a plugin that is not listed', () => {
    expect(latestPublishedVersion(catalogue(['2.10.1']), 'not-a-plugin')).toBeNull();
    expect(latestPublishedVersion(null)).toBeNull();
  });
});

describe('checking for a newer published release', () => {
  it('asks the community catalogue, not the GitHub API', async () => {
    const request = vi.fn(respond(catalogue(['2.10.1'])));
    await checkForUpdate('2.10.1', 'dayline-journal', request as unknown as UpdateRequest);

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: COMMUNITY_STATS_URL,
      throw: false,
    }));
    expect(COMMUNITY_STATS_URL).toContain('obsidianmd/obsidian-releases');
  });

  it('reports an update when the catalogue is ahead of the running version', async () => {
    const result = await checkForUpdate('2.9.4', 'dayline-journal', respond(catalogue(['2.9.4', '2.10.1'])));
    expect(result).toEqual({ status: 'update', version: '2.10.1' });
  });

  it('treats the running version as current, and a newer local build too', async () => {
    expect((await checkForUpdate('2.10.1', 'dayline-journal', respond(catalogue(['2.10.1'])))).status).toBe('current');
    expect((await checkForUpdate('2.11.0', 'dayline-journal', respond(catalogue(['2.10.1'])))).status).toBe('current');
  });

  it('says so when the plugin is not in the catalogue yet', async () => {
    const result = await checkForUpdate('2.10.1', 'not-listed', respond(catalogue(['2.10.1'])));
    expect(result.status).toBe('error');
    expect(result.error).toContain('not listed');
  });

  it('turns a network failure into a result rather than throwing', async () => {
    const request: UpdateRequest = async () => { throw new Error('offline'); };
    expect(await checkForUpdate('2.10.1', 'dayline-journal', request))
      .toEqual({ status: 'error', error: 'offline' });
  });

  it('reports an HTTP failure instead of parsing it', async () => {
    const result = await checkForUpdate('2.10.1', 'dayline-journal', respond({}, 502));
    expect(result).toEqual({ status: 'error', error: 'HTTP 502' });
  });

  it('refuses a response it cannot read', async () => {
    const result = await checkForUpdate('2.10.1', 'dayline-journal', async () => ({ status: 200, text: 'not json' }));
    expect(result.status).toBe('error');
  });
});

describe('keeping the check cheap and bounded', () => {
  it('downloads the 630 KB catalogue once, then reuses it', async () => {
    const request = vi.fn(respond(catalogue(['2.10.1'])));
    const call = () => checkForUpdate('2.10.1', 'dayline-journal', request as unknown as UpdateRequest, 1_000);

    await call();
    await call();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cached catalogue is stale', async () => {
    const request = vi.fn(respond(catalogue(['2.10.1'])));
    const send = request as unknown as UpdateRequest;

    await checkForUpdate('2.10.1', 'dayline-journal', send, 0);
    await checkForUpdate('2.10.1', 'dayline-journal', send, STATS_CACHE_TTL_MS + 1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('gives up instead of leaving the button spinning forever', async () => {
    vi.useFakeTimers();
    try {
      const request: UpdateRequest = () => new Promise(() => {});
      const pending = checkForUpdate('2.10.1', 'dayline-journal', request);
      await vi.advanceTimersByTimeAsync(UPDATE_TIMEOUT_MS + 1);
      await expect(pending).resolves.toEqual({ status: 'error', error: 'timed out' });
    } finally {
      vi.useRealTimers();
    }
  });
});
