import { classifyMediaLink, createMediaAttachment, IMAGE_EXTENSIONS as IMAGE_TYPES, normalizeMediaLink } from './media-links';

export const IMAGE_EXTENSIONS = IMAGE_TYPES;
export const HEIC_EXTENSIONS = ['heic', 'heif'];

/**
 * Every HEIC/HEIF image a journal entry references: its media attachments plus
 * the frontmatter `cover` link, which the index stores separately from `media`.
 * Deduplicated by source note + link so the desktop pre-warm converts each
 * source file once.
 */
export function collectHeicAttachments(
  entries: Array<{ media?: any[]; cover?: string; path?: string }> | null | undefined,
): any[] {
  const collected: any[] = [];
  const seen = new Set<string>();
  const push = (attachment: any) => {
    if (!attachment || attachment.external || attachment.kind !== 'image') return;
    if (!HEIC_EXTENSIONS.includes(String(attachment.extension || '').toLowerCase())) return;
    const key = `${attachment.sourcePath}\u0000${attachment.normalizedLink}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(attachment);
  };
  for (const entry of entries || []) {
    for (const attachment of entry?.media || []) push(attachment);
    if (entry?.cover) push(createMediaAttachment(entry.cover, entry.path || ''));
  }
  return collected;
}

export interface ThumbnailResult {
  url: string;
  path: string;
  index: number;
}

export class ThumbnailService {
  private readonly app: any;
  private readonly heicCache: any;
  private readonly heicThumbStore: any;

  constructor(app: any, heicCache: any, heicThumbStore?: any) {
    this.app = app;
    this.heicCache = heicCache;
    this.heicThumbStore = heicThumbStore || null;
  }

  isImageFile(file: any): boolean {
    return Boolean(file?.extension && IMAGE_EXTENSIONS.includes(String(file.extension).toLowerCase()));
  }

  isImageLink(link: string): boolean {
    return classifyMediaLink(link).kind === 'image';
  }

  resolve(link: string, sourcePath: string): any {
    const normalized = normalizeMediaLink(link);
    if (normalized.toLowerCase().startsWith('http://') || normalized.toLowerCase().startsWith('https://')) return null;
    const file = this.app.metadataCache.getFirstLinkpathDest(normalized, sourcePath);
    return this.isImageFile(file) ? file : null;
  }

  async load(link: string, sourcePath: string, index = 0): Promise<ThumbnailResult | null> {
    const normalized = normalizeMediaLink(link);
    if (normalized.toLowerCase().startsWith('http://') || normalized.toLowerCase().startsWith('https://')) {
      return this.isImageLink(normalized) ? { url: normalized, path: normalized, index } : null;
    }
    const file = this.resolve(normalized, sourcePath);
    if (!file) return null;
    try {
      const ext = String(file.extension).toLowerCase();
      let url = null;
      if (HEIC_EXTENSIONS.includes(ext)) {
        url = (await this.heicCache?.getThumbnail(file))?.dataUrl || null;
        // Mobile never decodes: fall back to the JPEG the desktop wrote into
        // the shared cache, when it has synced.
        if (!url) url = (await this.heicThumbStore?.read?.(file))?.url || null;
      } else {
        url = this.app.vault.getResourcePath(file);
      }
      return url ? { url, path: file.path, index } : null;
    } catch {
      return null;
    }
  }

  async loadFirst(links: string[], sourcePath: string): Promise<ThumbnailResult | null> {
    for (let index = 0; index < links.length; index++) {
      const result = await this.load(links[index], sourcePath, index);
      if (result) return result;
    }
    return null;
  }
}
