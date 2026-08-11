import { describe, expect, it, vi } from 'vitest';
import { AUDIO_ARTWORK_MAX_BYTES, MediaService, formatMediaMetadataForDisplay, scaleVideoCoverDimensions } from '../src/media-service';
import { createMediaAttachment } from '../src/media-links';

describe('media service', () => {
  it('allows remote images as covers but never fetches remote video metadata', async () => {
    let inputs = 0;
    const service = new MediaService({}, undefined, { inputFactory: () => { inputs++; return {}; } });
    const image = createMediaAttachment('https://cdn.example.test/photo.jpg', 'note.md')!;
    const video = createMediaAttachment('https://cdn.example.test/movie.mov', 'note.md')!;
    await expect(service.loadCover(image)).resolves.toMatchObject({ url: image.normalizedLink });
    await expect(service.getMetadata(video)).resolves.toBeNull();
    expect(inputs).toBe(0);
  });

  it('skips heavy parsing and cover extraction when capabilities disable it', async () => {
    let inputs = 0;
    const file = { path: 'Media/movie.mov', extension: 'mov' };
    const service = new MediaService({
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://movie' },
    }, undefined, {
      inputFactory: () => { inputs += 1; return {}; },
      capabilities: { routes: {
        mediaMetadata: 'disabled', mediaCover: 'disabled', heic: 'disabled', audioArtwork: 'disabled', attachment: 'disabled',
      } },
    } as any);
    const video = createMediaAttachment('movie.mov', 'note.md')!;
    await expect(service.getMetadata(video)).resolves.toBeNull();
    await expect(service.loadCover(video)).resolves.toBeNull();
    expect(inputs).toBe(0);
  });

  it('keeps ordinary image covers available when mobile disables heavy media covers', async () => {
    const file = { path: 'Photos/photo.jpg', extension: 'jpg' };
    const service = new MediaService({
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://photo' },
    }, undefined, {
      capabilities: { routes: {
        mediaMetadata: 'fallback', mediaCover: 'disabled', heic: 'disabled', audioArtwork: 'disabled', attachment: 'full',
      } },
    } as any);
    const image = createMediaAttachment('photo.jpg', 'Calendar/Daily/2026-08-06.md')!;
    await expect(service.loadCover(image)).resolves.toMatchObject({ url: 'resource://photo' });
  });

  it('uses embedded audio artwork and exposes normalized tags', async () => {
    const file = { path: 'voice.mp3', extension: 'mp3' };
    const track = {
      getDurationFromMetadata: async () => 12,
      getCodec: async () => 'mp3',
      getBitrate: async () => 128_000,
      getSampleRate: async () => 48_000,
      getNumberOfChannels: async () => 2,
    };
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://voice' },
    };
    const input = {
      getMetadataTags: async () => ({
        title: 'Voice memo', artist: 'Author', album: 'Notes',
        images: [{ kind: 'coverFront', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }],
      }),
      getPrimaryAudioTrack: async () => track,
      dispose: () => undefined,
    };
    const service = new MediaService(app, undefined, { inputFactory: () => input });
    const attachment = createMediaAttachment('voice.mp3', 'Calendar/Daily/2026-08-06.md')!;
    await expect(service.getMetadata(attachment)).resolves.toMatchObject({ kind: 'audio', title: 'Voice memo', duration: 12, channels: 2 });
    await expect(service.loadCover(attachment)).resolves.toMatchObject({ attachment });
    service.dispose();
  });

  it('invalidates caches when either the source note or linked media file changes', async () => {
    const file = { path: 'Photos/movie.mov', extension: 'mov' };
    let inputs = 0;
    const track = {
      getDurationFromMetadata: async () => 4,
      getDisplayWidth: async () => 1920,
      getDisplayHeight: async () => 1080,
      getRotation: async () => 0,
      getCodec: async () => 'h264',
    };
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://movie' },
    };
    const service = new MediaService(app, undefined, {
      inputFactory: () => {
        inputs += 1;
        return {
          getMetadataTags: async () => ({}),
          getPrimaryVideoTrack: async () => track,
          dispose: () => undefined,
        };
      },
    });
    const attachment = createMediaAttachment('Photos/movie.mov', 'Notes/2026-08-06.md')!;
    await service.getMetadata(attachment);
    service.invalidate('Photos/movie.mov');
    await service.getMetadata(attachment);
    service.invalidate('Notes/2026-08-06.md');
    await service.getMetadata(attachment);
    expect(inputs).toBe(3);
  });

  it('invalidates caches by the resolved vault path for relative links and aliases', async () => {
    const file = { path: 'Media/actual.mov', extension: 'mov' };
    let inputs = 0;
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://actual-movie' },
    };
    const track = {
      getDurationFromMetadata: async () => 4,
      getDisplayWidth: async () => 1_920,
      getDisplayHeight: async () => 1_080,
      getRotation: async () => 0,
      getCodec: async () => 'h264',
    };
    const service = new MediaService(app, undefined, {
      inputFactory: () => {
        inputs += 1;
        return {
          getMetadataTags: async () => ({}),
          getPrimaryVideoTrack: async () => track,
          dispose: () => undefined,
        };
      },
    });
    const attachment = createMediaAttachment('relative-alias.mov', 'Notes/2026-08-06.md')!;
    await service.getMetadata(attachment);
    service.invalidate(file.path);
    await service.getMetadata(attachment);
    expect(inputs).toBe(2);
  });

  it('reads QuickTime location, camera, and creation tags from the raw metadata map', async () => {
    const file = { path: 'IMG_9011.mov', extension: 'mov' };
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://movie' },
    };
    const track = {
      getDurationFromMetadata: async () => 33,
      getDisplayWidth: async () => 1_440,
      getDisplayHeight: async () => 1_920,
      getRotation: async () => 90,
      getCodec: async () => 'hevc',
    };
    const input = {
      getMetadataTags: async () => ({
        raw: {
          'com.apple.quicktime.location.ISO6709': '+37.3318-122.0312+000.000/',
          'com.apple.quicktime.make': 'Apple',
          'com.apple.quicktime.model': 'iPhone 13 mini',
          'com.apple.quicktime.software': '26.5.2',
          'com.apple.quicktime.creationdate': '2026-08-05T09:25:46.000Z',
        },
      }),
      getPrimaryVideoTrack: async () => track,
      dispose: () => undefined,
    };
    const service = new MediaService(app, undefined, { inputFactory: () => input });
    const attachment = createMediaAttachment('IMG_9011.mov', 'Calendar/Daily/2026-08-05.md')!;
    await expect(service.getMetadata(attachment)).resolves.toMatchObject({
      kind: 'video',
      make: 'Apple',
      model: 'iPhone 13 mini',
      software: '26.5.2',
      capturedAt: '2026-08-05T09:25:46.000Z',
      latitude: 37.3318,
      longitude: -122.0312,
    });
  });

  it('rejects invalid and oversized audio artwork before creating a cover blob', async () => {
    const file = { path: 'voice.mp3', extension: 'mp3' };
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://voice' },
    };
    const track = {
      getDurationFromMetadata: async () => 1,
      getCodec: async () => 'mp3',
      getBitrate: async () => 1,
      getSampleRate: async () => 1,
      getNumberOfChannels: async () => 1,
    };
    const makeService = (image: any) => new MediaService(app, undefined, {
      inputFactory: () => ({
        getMetadataTags: async () => ({ images: [image] }),
        getPrimaryAudioTrack: async () => track,
        dispose: () => undefined,
      }),
    });
    const attachment = createMediaAttachment('voice.mp3', 'note.md')!;
    const invalidMetadata = await makeService({ mimeType: 'text/html', data: new Uint8Array([1]) }).getMetadata(attachment);
    expect(invalidMetadata).toMatchObject({ kind: 'audio' });
    expect(invalidMetadata?.artwork).toBeUndefined();
    await expect(makeService({ mimeType: 'image/png', data: new Uint8Array(AUDIO_ARTWORK_MAX_BYTES + 1) }).loadCover(attachment))
      .resolves.toBeNull();
  });

  it('revokes a blob cover that resolves after in-flight invalidation', async () => {
    const file = { path: 'voice.mp3', extension: 'mp3' };
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://voice' },
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const track = {
      getDurationFromMetadata: async () => 1,
      getCodec: async () => 'mp3',
      getBitrate: async () => 1,
      getSampleRate: async () => 1,
      getNumberOfChannels: async () => 1,
    };
    const service = new MediaService(app, undefined, {
      inputFactory: () => ({
        getMetadataTags: async () => {
          await gate;
          return { images: [{ kind: 'coverFront', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }] };
        },
        getPrimaryAudioTrack: async () => track,
        dispose: () => undefined,
      }),
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending-invalidation');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const attachment = createMediaAttachment('voice.mp3', 'Notes/2026-08-06.md')!;
    try {
      const pending = service.loadCover(attachment);
      service.invalidate(attachment.sourcePath);
      release();
      await expect(pending).resolves.toBeNull();
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:pending-invalidation');
    } finally {
      service.dispose();
      vi.restoreAllMocks();
    }
  });

  it('revokes a blob cover that resolves after disposal', async () => {
    const file = { path: 'voice.mp3', extension: 'mp3' };
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://voice' },
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const track = {
      getDurationFromMetadata: async () => 1,
      getCodec: async () => 'mp3',
      getBitrate: async () => 1,
      getSampleRate: async () => 1,
      getNumberOfChannels: async () => 1,
    };
    const service = new MediaService(app, undefined, {
      inputFactory: () => ({
        getMetadataTags: async () => {
          await gate;
          return { images: [{ kind: 'coverFront', mimeType: 'image/png', data: new Uint8Array([4, 5, 6]) }] };
        },
        getPrimaryAudioTrack: async () => track,
        dispose: () => undefined,
      }),
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending-disposal');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const attachment = createMediaAttachment('voice.mp3', 'Notes/2026-08-06.md')!;
    try {
      const pending = service.loadCover(attachment);
      service.dispose();
      release();
      await expect(pending).resolves.toBeNull();
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:pending-disposal');
    } finally {
      service.dispose();
      vi.restoreAllMocks();
    }
  });

  it('revokes cached blob covers on invalidation, disposal, and cache eviction', async () => {
    let objectUrlIndex = 0;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cached-${++objectUrlIndex}`);
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const track = {
      getDurationFromMetadata: async () => 1,
      getCodec: async () => 'mp3',
      getBitrate: async () => 1,
      getSampleRate: async () => 1,
      getNumberOfChannels: async () => 1,
    };
    const app = {
      metadataCache: { getFirstLinkpathDest: (link: string) => ({ path: `Media/${link}`, extension: 'mp3' }) },
      vault: { getResourcePath: (file: any) => `resource://${file.path}` },
    };
    const service = new MediaService(app, undefined, {
      inputFactory: () => ({
        getMetadataTags: async () => ({ images: [{ kind: 'coverFront', mimeType: 'image/png', data: new Uint8Array([7]) }] }),
        getPrimaryAudioTrack: async () => track,
        dispose: () => undefined,
      }),
    });
    try {
      const first = createMediaAttachment('first.mp3', 'Notes/2026-08-06.md')!;
      await service.loadCover(first);
      service.invalidate(first.sourcePath);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-1');

      const second = createMediaAttachment('second.mp3', 'Notes/2026-08-06.md')!;
      await service.loadCover(second);
      service.dispose();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-2');

      const evictionService = new MediaService(app, undefined, {
        inputFactory: () => ({
          getMetadataTags: async () => ({ images: [{ kind: 'coverFront', mimeType: 'image/png', data: new Uint8Array([8]) }] }),
          getPrimaryAudioTrack: async () => track,
          dispose: () => undefined,
        }),
      });
      for (let index = 0; index < 49; index += 1) {
        const attachment = createMediaAttachment(`eviction-${index}.mp3`, 'Notes/2026-08-06.md')!;
        await evictionService.loadCover(attachment);
      }
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-3');
      evictionService.dispose();
      expect(createObjectURL).toHaveBeenCalledTimes(51);
    } finally {
      service.dispose();
      vi.restoreAllMocks();
    }
  });

  it('preserves the complete image EXIF camera string in the unified formatter', async () => {
    const file = { path: 'IMG_9011.JPG', extension: 'jpg' };
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://image' },
    };
    const service = new MediaService(app, undefined, {
      imageMetadata: { get: async () => [{ key: 'exif_camera', value: 'Apple iPhone 13 mini' }] },
    });
    const attachment = createMediaAttachment('IMG_9011.JPG', 'Notes/2026-08-06.md')!;
    const metadata = await service.getMetadata(attachment);
    expect(metadata).toMatchObject({ kind: 'image', make: 'Apple', model: 'iPhone 13 mini' });
    expect(formatMediaMetadataForDisplay(metadata)).toContainEqual({ key: 'exif_camera', value: 'Apple iPhone 13 mini' });
  });

  it('preserves complete image EXIF fields for calendar tooltips', async () => {
    const file = { path: 'IMG_9011.JPG', extension: 'jpg' };
    const app = {
      metadataCache: { getFirstLinkpathDest: () => file },
      vault: { getResourcePath: () => 'resource://image' },
    };
    const fields = [
      { key: 'exif_camera', value: 'Apple iPhone 13 mini' },
      { key: 'exif_lens', value: 'iPhone 13 mini back dual wide camera' },
      { key: 'exif_date', value: '2026:08:08 08:53:31' },
      { key: 'exif_aperture', value: 'f/1.6' },
      { key: 'exif_shutter', value: '1/122s' },
      { key: 'exif_iso', value: '100' },
      { key: 'exif_focal', value: '5mm' },
      { key: 'exif_gps', value: '23.5479, 116.3436' },
      { key: 'exif_software', value: '26.5.2' },
    ];
    const service = new MediaService(app, undefined, {
      imageMetadata: { get: async () => fields },
    });
    const attachment = createMediaAttachment('IMG_9011.JPG', 'Calendar/Daily/2026-08-08.md')!;

    const metadata = await service.getMetadata(attachment);

    expect(formatMediaMetadataForDisplay(metadata)).toEqual(fields);
  });

  it('scales only finite, positive video dimensions to the cover edge', () => {
    expect(scaleVideoCoverDimensions(1_920, 1_080)).toEqual({ width: 1_024, height: 576 });
    expect(scaleVideoCoverDimensions(640, 480)).toEqual({ width: 640, height: 480 });
    expect(scaleVideoCoverDimensions(0, 480)).toBeNull();
    expect(scaleVideoCoverDimensions(Number.NaN, 480)).toBeNull();
    expect(scaleVideoCoverDimensions(Number.POSITIVE_INFINITY, 480)).toBeNull();
  });

  it('formats camera and software tags for video tooltips', () => {
    expect(formatMediaMetadataForDisplay({
      kind: 'video', make: 'Apple', model: 'iPhone 13 mini', software: '26.5.2', bitrate: 2_000_000,
    })).toEqual([
      { key: 'media_camera', value: 'Apple iPhone 13 mini' },
      { key: 'media_software', value: '26.5.2' },
      { key: 'media_bitrate', value: '2000 kbps' },
    ]);
  });
});
