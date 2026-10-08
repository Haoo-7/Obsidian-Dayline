import { describe, expect, it } from 'vitest';
import { ThumbnailService, collectHeicAttachments } from '../src/thumbnail-service';

describe('thumbnail service', () => {
  it('resolves relative image links and skips missing files', async () => {
    const files: Record<string, any> = {
      'Assets/photo.jpg': { path: 'Assets/photo.jpg', extension: 'jpg' },
      'Assets/photo.heic': { path: 'Assets/photo.heic', extension: 'heic' },
    };
    const app = {
      metadataCache: { getFirstLinkpathDest: (link: string) => files[link] ?? null },
      vault: { getResourcePath: (file: any) => `resource://${file.path}` },
    };
    const heicCache = { getThumbnail: async () => ({ dataUrl: 'data:image/jpeg;base64,thumb' }) };
    const service = new ThumbnailService(app, heicCache);
    expect(service.isImageLink('Assets/photo.jpg')).toBe(true);
    expect(service.isImageLink('Assets/note.md')).toBe(false);
    await expect(service.loadFirst(['missing.png', 'Assets/photo.jpg'], 'Calendar/Daily/2026-07-18.md')).resolves.toMatchObject({
      url: 'resource://Assets/photo.jpg', index: 1,
    });
    await expect(service.load('Assets/photo.heic', 'Calendar/Daily/2026-07-18.md')).resolves.toMatchObject({
      url: 'data:image/jpeg;base64,thumb',
    });
  });

  it('falls back to the shared thumbnail cache when no decoder is available', async () => {
    const files: Record<string, any> = {
      'Assets/photo.heic': { path: 'Assets/photo.heic', extension: 'heic' },
    };
    const app = {
      metadataCache: { getFirstLinkpathDest: (link: string) => files[link] ?? null },
      vault: { getResourcePath: (file: any) => `resource://${file.path}` },
    };
    const service = new ThumbnailService(app, { getThumbnail: async () => null }, {
      read: async (file: any) => ({ url: `blob:${file.path}` }),
    });

    await expect(service.load('Assets/photo.heic', 'Calendar/Daily/2026-07-18.md'))
      .resolves.toMatchObject({ url: 'blob:Assets/photo.heic' });
  });
});

describe('HEIC journal attachment collection', () => {
  it('collects embedded HEIC images and the separately stored frontmatter cover', () => {
    const entries = [{
      path: 'Daily/2026-10-08.md',
      cover: '[[Photos/cover.heic]]',
      media: [
        { link: '![[Photos/embed.heic]]', normalizedLink: 'Photos/embed.heic', sourcePath: 'Daily/2026-10-08.md', kind: 'image', extension: 'heic', external: false },
        { link: '![[Photos/photo.jpg]]', normalizedLink: 'Photos/photo.jpg', sourcePath: 'Daily/2026-10-08.md', kind: 'image', extension: 'jpg', external: false },
        { link: 'https://cdn.example.test/remote.heic', normalizedLink: 'https://cdn.example.test/remote.heic', sourcePath: 'Daily/2026-10-08.md', kind: 'image', extension: 'heic', external: true },
      ],
    }];

    expect(collectHeicAttachments(entries).map((attachment) => attachment.normalizedLink))
      .toEqual(['Photos/embed.heic', 'Photos/cover.heic']);
  });

  it('dedupes the same source file referenced as both cover and embed', () => {
    const media = { link: 'x', normalizedLink: 'Photos/embed.heic', sourcePath: 'Daily/a.md', kind: 'image', extension: 'heic', external: false };
    const collected = collectHeicAttachments([
      { path: 'Daily/a.md', cover: 'Photos/embed.heic', media: [media] },
      { path: 'Daily/a.md', media: [media] },
    ]);

    expect(collected).toHaveLength(1);
    expect(collected[0].normalizedLink).toBe('Photos/embed.heic');
  });
});
