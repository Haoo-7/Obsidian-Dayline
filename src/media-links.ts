import type { MediaAttachment, MediaKind } from './types';

export const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'tiff', 'tif', 'bmp',
];
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ogv', '3gp'];
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus'];
export const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

function decode(value: string): string {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

/**
 * Normalize Obsidian wikilinks and Markdown embed values without resolving them.
 * This deliberately leaves remote URLs intact so the browser can display images.
 */
export function normalizeMediaLink(value: unknown): string {
  if (typeof value !== 'string') return '';
  let link = value.trim();
  if (!link) return '';

  const wikilink = /^!?\[\[([\s\S]*?)\]\]$/.exec(link);
  if (wikilink) link = wikilink[1];
  else if (link.startsWith('!')) link = link.slice(1).trim();

  // Obsidian uses `|width` and `|alias` after the target. The target itself
  // can contain URL query parameters, so only split the wikilink form here.
  if (wikilink || value.trim().startsWith('[[') || value.trim().startsWith('![[')) {
    link = link.split('|', 1)[0];
  }
  const normalized = link.trim();
  // Keep external URLs byte-for-byte intact. Decoding the complete URL can
  // change its meaning (`%2F`, signed query values, or a CDN cache key).
  return /^https?:\/\//i.test(normalized) ? normalized : decode(normalized);
}

function extensionFromLink(link: string): string {
  let path = link;
  try {
    if (/^https?:\/\//i.test(link)) path = new URL(link).pathname;
  } catch (_) {
    // Keep the raw value; classification will simply return unknown.
  }
  path = path.split(/[?#]/, 1)[0];
  const filename = path.split(/[\\/]/).pop() || '';
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function classifyMediaLink(value: unknown): { kind: MediaKind; extension?: string } {
  const normalized = normalizeMediaLink(value);
  const extension = extensionFromLink(normalized);
  if (!extension) return { kind: 'unknown' };
  if (IMAGE_EXTENSIONS.includes(extension)) return { kind: 'image', extension };
  if (VIDEO_EXTENSIONS.includes(extension)) return { kind: 'video', extension };
  if (AUDIO_EXTENSIONS.includes(extension)) return { kind: 'audio', extension };
  return { kind: 'unknown', extension };
}

export function isExternalMediaLink(value: unknown): boolean {
  return /^https?:\/\//i.test(normalizeMediaLink(value));
}

export function isDisplayableMedia(attachment: Pick<MediaAttachment, 'kind'>): boolean {
  return attachment.kind === 'image' || attachment.kind === 'video' || attachment.kind === 'audio';
}

export function createMediaAttachment(value: unknown, sourcePath = ''): MediaAttachment | null {
  const link = typeof value === 'string' ? value.trim() : '';
  const normalizedLink = normalizeMediaLink(value);
  if (!link || !normalizedLink) return null;
  const classified = classifyMediaLink(normalizedLink);
  return {
    link,
    normalizedLink,
    sourcePath,
    kind: classified.kind,
    extension: classified.extension,
    external: isExternalMediaLink(normalizedLink),
  };
}

export function mediaAttachmentsFromLinks(values: unknown[], sourcePath = ''): MediaAttachment[] {
  const result: MediaAttachment[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const attachment = createMediaAttachment(value, sourcePath);
    if (!attachment) continue;
    const key = attachment.normalizedLink;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attachment);
  }
  return result;
}

export function mediaLinksFromValue(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item] : [];
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return [record.link, record.url, record.path]
      .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  });
}

export function dedupeMediaLinks(values: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const link = value.trim();
    const normalized = normalizeMediaLink(link);
    if (!normalized) continue;
    const key = normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}
