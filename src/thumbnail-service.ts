import { classifyMediaLink, IMAGE_EXTENSIONS as IMAGE_TYPES, normalizeMediaLink } from './media-links';

export const IMAGE_EXTENSIONS = IMAGE_TYPES;
export const HEIC_EXTENSIONS = ['heic', 'heif'];

export interface ThumbnailResult {
  url: string;
  path: string;
  index: number;
}

export class ThumbnailService {
  private readonly app: any;
  private readonly heicCache: any;

  constructor(app: any, heicCache: any) {
    this.app = app;
    this.heicCache = heicCache;
  }

  isImageFile(file: any): boolean {
    return Boolean(file?.extension && IMAGE_EXTENSIONS.includes(String(file.extension).toLowerCase()));
  }

  isImageLink(link: string): boolean {
    return classifyMediaLink(link).kind === 'image';
  }

  resolve(link: string, sourcePath: string): any | null {
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
      const url = HEIC_EXTENSIONS.includes(ext)
        ? (await this.heicCache?.getThumbnail(file))?.dataUrl
        : this.app.vault.getResourcePath(file);
      return url ? { url, path: file.path, index } : null;
    } catch (_) {
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
