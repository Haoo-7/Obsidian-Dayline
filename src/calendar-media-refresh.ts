import type { CalendarDaySummary, MediaAttachment } from './types';
import { normalizeVaultPath } from './date-utils';
import { normalizeMediaLink } from './media-links';

type MonthCache = Map<string, Map<string, CalendarDaySummary>>;
type ResolveAttachment = (attachment: MediaAttachment) => string | undefined;

function normalizedPath(value: unknown): string {
  return typeof value === 'string' ? normalizeVaultPath(value.trim()) : '';
}

function attachmentPaths(attachment: MediaAttachment): Set<string> {
  return new Set([
    normalizedPath(attachment.normalizedLink),
    normalizedPath(attachment.link),
    normalizedPath(normalizeMediaLink(attachment.link)),
  ].filter(Boolean));
}

/**
 * Return only cached months whose day summaries refer to a changed vault file.
 * Uncached months are intentionally left alone: they will resolve the current
 * resource when first displayed. A cached month with an unresolvable local
 * attachment is included conservatively because a deleted or renamed alias
 * has no path left for an exact comparison.
 */
export function cachedMonthsReferencingMedia(
  monthCache: MonthCache,
  filePath: string,
  resolveAttachment: ResolveAttachment,
): Set<string> {
  const affected = new Set<string>();
  const normalizedFilePath = normalizedPath(filePath);
  if (!normalizedFilePath) return affected;

  for (const [monthKey, days] of monthCache) {
    let unresolvedLocalMedia = false;
    for (const summary of days.values()) {
      const candidates = summary.cover ? [summary.cover, ...(summary.media || [])] : (summary.media || []);
      for (const attachment of candidates) {
        if (attachment.external) continue;

        // Keep direct path matches independent of metadata-cache resolution so
        // deleted or renamed files can still invalidate their old cache entry.
        if (attachmentPaths(attachment).has(normalizedFilePath)) {
          affected.add(monthKey);
          unresolvedLocalMedia = false;
          break;
        }

        let resolvedPath: string | undefined;
        try {
          resolvedPath = resolveAttachment(attachment);
        } catch (_) {
          // A stale metadata cache is equivalent to an unresolved attachment.
        }
        const normalizedResolvedPath = normalizedPath(resolvedPath);
        if (normalizedResolvedPath === normalizedFilePath) {
          affected.add(monthKey);
          unresolvedLocalMedia = false;
          break;
        }
        if (!normalizedResolvedPath) unresolvedLocalMedia = true;
      }
      if (affected.has(monthKey)) break;
    }

    // If Obsidian cannot resolve any local attachment in this cached month,
    // the old target may have been renamed or deleted behind an alias. There
    // is no reliable path to compare, so invalidate the month conservatively.
    if (!affected.has(monthKey) && unresolvedLocalMedia) affected.add(monthKey);
  }
  return affected;
}
