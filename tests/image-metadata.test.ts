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
