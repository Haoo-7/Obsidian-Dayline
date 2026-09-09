import { describe, expect, it } from 'vitest';
import { MAX_HEIC_TIFF_SCAN_BYTES, parseImageExif } from '../src/image-metadata';

function jpegWithTiff(tiff: Uint8Array): ArrayBuffer {
  const payload = new Uint8Array(6 + tiff.byteLength);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  payload.set(tiff, 6);
  const result = new Uint8Array(2 + 2 + 2 + payload.byteLength + 2);
  const view = new DataView(result.buffer);
  view.setUint16(0, 0xffd8, false);
  view.setUint16(2, 0xffe1, false);
  view.setUint16(4, payload.byteLength + 2, false);
  result.set(payload, 6);
  result.set([0xff, 0xd9], 6 + payload.byteLength);
  return result.buffer;
}

function cameraTiff(): Uint8Array {
  const tiff = new Uint8Array(30);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, 0x4949, false);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x010f, true);
  view.setUint16(12, 2, true);
  view.setUint32(14, 4, true);
  tiff.set([0x43, 0x41, 0x4d, 0x00], 18);
  return tiff;
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const paddedLength = data.byteLength + (data.byteLength % 2);
  const chunk = new Uint8Array(8 + paddedLength);
  const view = new DataView(chunk.buffer);
  for (let index = 0; index < 4; index++) chunk[index] = type.charCodeAt(index);
  view.setUint32(4, data.byteLength, true);
  chunk.set(data, 8);
  return chunk;
}

function webpWithChunks(...chunks: Uint8Array[]): ArrayBuffer {
  const byteLength = 12 + chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(bytes.buffer).setUint32(4, byteLength - 8, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  let offset = 12;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  for (let index = 0; index < 4; index++) chunk[4 + index] = type.charCodeAt(index);
  chunk.set(data, 8);
  return chunk;
}

function pngWithChunks(...chunks: Uint8Array[]): ArrayBuffer {
  const byteLength = 8 + chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

describe('image metadata parser hardening', () => {
  it('rejects truncated JPEG segments without throwing', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49,
    ]);
    expect(() => parseImageExif(bytes.buffer)).not.toThrow();
    expect(parseImageExif(bytes.buffer)).toBeNull();
  });

  it('rejects oversized or truncated PNG/WebP metadata chunks', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0xff, 0xff, 0xff, 0xff, 0x65, 0x58, 0x69, 0x66,
    ]);
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x45, 0x58, 0x49, 0x46,
      0xff, 0xff, 0xff, 0xff,
    ]);
    expect(() => parseImageExif(png.buffer)).not.toThrow();
    expect(() => parseImageExif(webp.buffer)).not.toThrow();
    expect(parseImageExif(png.buffer)).toBeNull();
    expect(parseImageExif(webp.buffer)).toBeNull();
  });

  it('finds WebP EXIF after image data and after an image chunk larger than the metadata limit', () => {
    const exif = webpChunk('EXIF', cameraTiff());
    expect(parseImageExif(webpWithChunks(webpChunk('VP8 ', new Uint8Array(1)), exif))).toMatchObject({ make: 'CAM' });
    expect(parseImageExif(webpWithChunks(webpChunk('VP8 ', new Uint8Array(8 * 1024 * 1024 + 1)), exif)))
      .toMatchObject({ make: 'CAM' });
  });

  it('finds PNG EXIF after an image chunk larger than the metadata limit', () => {
    const exif = pngChunk('eXIf', cameraTiff());
    expect(parseImageExif(pngWithChunks(exif))).toMatchObject({ make: 'CAM' });
    expect(parseImageExif(pngWithChunks(pngChunk('IDAT', new Uint8Array(8 * 1024 * 1024 + 1)), exif)))
      .toMatchObject({ make: 'CAM' });
  });

  it('bounds malicious TIFF count and offset values', () => {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0x4949, false);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 1, true);
    view.setUint16(10, 0x010f, true);
    view.setUint16(12, 2, true);
    view.setUint32(14, 0xffffffff, true);
    expect(() => parseImageExif(bytes.buffer)).not.toThrow();
    expect(parseImageExif(bytes.buffer)).toBeNull();
  });

  it('stops self-referential EXIF IFD recursion', () => {
    const tiff = new Uint8Array(32);
    const view = new DataView(tiff.buffer);
    view.setUint16(0, 0x4949, false);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 1, true);
    view.setUint16(10, 0x8769, true);
    view.setUint16(12, 4, true);
    view.setUint32(14, 1, true);
    view.setUint32(18, 8, true);
    expect(() => parseImageExif(jpegWithTiff(tiff))).not.toThrow();
    expect(parseImageExif(jpegWithTiff(tiff))).toBeNull();
  });

  it('decodes signed TIFF rationals and bounds HEIC scanning', () => {
    const tiff = new Uint8Array(48);
    const view = new DataView(tiff.buffer);
    view.setUint16(0, 0x4949, false);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 1, true);
    view.setUint16(10, 0x829a, true);
    view.setUint16(12, 10, true);
    view.setUint32(14, 1, true);
    view.setUint32(18, 26, true);
    view.setInt32(26, -1, true);
    view.setInt32(30, 2, true);
    expect((parseImageExif(jpegWithTiff(tiff)) as any)?.exposureTime).toBe(-0.5);

    const oversized = new Uint8Array(MAX_HEIC_TIFF_SCAN_BYTES + 32);
    const header = new DataView(oversized.buffer);
    header.setUint32(4, 0x66747970, false);
    header.setUint32(8, 0x68656963, false);
    const late = new DataView(oversized.buffer, MAX_HEIC_TIFF_SCAN_BYTES + 1);
    late.setUint16(0, 0x4949, false);
    late.setUint16(2, 42, true);
    expect(parseImageExif(oversized.buffer)).toBeNull();
  });
});
