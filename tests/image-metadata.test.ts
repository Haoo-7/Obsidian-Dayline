import { describe, expect, it } from 'vitest';
import { MAX_HEIC_TIFF_SCAN_BYTES, formatExifForDisplay, parseImageExif } from '../src/image-metadata';

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

/** Minimal little-endian TIFF whose IFD0 carries only the camera Make tag. */
function tiffWithMake(make: string): Uint8Array {
  const count = make.length + 1;
  const tiff = new Uint8Array(Math.max(26, 18 + count));
  const view = new DataView(tiff.buffer);
  view.setUint16(0, 0x4949, false);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x010f, true);
  view.setUint16(12, 2, true);
  view.setUint32(14, count, true);
  for (let index = 0; index < make.length; index++) tiff[18 + index] = make.charCodeAt(index);
  return tiff;
}

function unsignedRationals(pairs: [number, number][]): Uint8Array {
  const bytes = new Uint8Array(pairs.length * 8);
  const view = new DataView(bytes.buffer);
  pairs.forEach(([numerator, denominator], index) => {
    view.setUint32(index * 8, numerator, true);
    view.setUint32(index * 8 + 4, denominator, true);
  });
  return bytes;
}

/** TIFF with an EXIF GPS IFD. Omitting a Ref mirrors a camera without a fix. */
function gpsTiff(spec: {
  lat: [number, number][];
  lon: [number, number][];
  latRef?: string;
  lonRef?: string;
}): Uint8Array {
  const entries: { tag: number; type: number; count: number; inline?: number; data?: Uint8Array }[] = [];
  if (spec.latRef) entries.push({ tag: 1, type: 2, count: 2, inline: spec.latRef.charCodeAt(0) });
  entries.push({ tag: 2, type: 5, count: 3, data: unsignedRationals(spec.lat) });
  if (spec.lonRef) entries.push({ tag: 3, type: 2, count: 2, inline: spec.lonRef.charCodeAt(0) });
  entries.push({ tag: 4, type: 5, count: 3, data: unsignedRationals(spec.lon) });

  const gpsIfdOffset = 26;
  const gpsIfdSize = 2 + entries.length * 12 + 4;
  let dataOffset = gpsIfdOffset + gpsIfdSize;
  const total = dataOffset + entries.reduce((sum, entry) => sum + (entry.data?.byteLength || 0), 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4949, false);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8825, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, gpsIfdOffset, true);
  view.setUint32(22, 0, true);
  view.setUint16(gpsIfdOffset, entries.length, true);
  entries.forEach((entry, index) => {
    const at = gpsIfdOffset + 2 + index * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.count, true);
    if (entry.data) {
      view.setUint32(at + 8, dataOffset, true);
      bytes.set(entry.data, dataOffset);
      dataOffset += entry.data.byteLength;
    } else {
      bytes[at + 8] = entry.inline as number;
    }
  });
  view.setUint32(gpsIfdOffset + 2 + entries.length * 12, 0, true);
  return bytes;
}

function isobmffBox(type: string, payload: Uint8Array): Uint8Array {
  const box = new Uint8Array(8 + payload.byteLength);
  new DataView(box.buffer).setUint32(0, box.byteLength, false);
  for (let index = 0; index < 4; index++) box[4 + index] = type.charCodeAt(index);
  box.set(payload, 8);
  return box;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

/** `infe` (version 2) entry naming an `Exif` item. */
function infeExif(itemId: number): Uint8Array {
  const payload = new Uint8Array(13);
  const view = new DataView(payload.buffer);
  view.setUint8(0, 2);
  view.setUint16(4, itemId);
  view.setUint16(6, 0);
  payload.set([0x45, 0x78, 0x69, 0x66], 8); // "Exif"
  return isobmffBox('infe', payload);
}

/** `iinf` (version 0) listing the given `infe` entries. */
function iinfWith(...entries: Uint8Array[]): Uint8Array {
  const payload = new Uint8Array(6);
  new DataView(payload.buffer).setUint16(4, entries.length, false);
  return isobmffBox('iinf', concatBytes([payload, ...entries]));
}

/** `iloc` (version 0) with one extent using 4-byte offset/length fields. */
function ilocWith(itemId: number, offset: number, length: number): Uint8Array {
  const payload = new Uint8Array(22);
  const view = new DataView(payload.buffer);
  view.setUint8(0, 0); // version
  view.setUint8(4, 0x44); // offset_size 4, length_size 4
  view.setUint8(5, 0x00); // base_offset_size 0
  view.setUint16(6, 1); // item_count
  view.setUint16(8, itemId);
  view.setUint16(10, 0); // data_reference_index
  view.setUint16(12, 1); // extent_count
  view.setUint32(14, offset);
  view.setUint32(18, length);
  return isobmffBox('iloc', payload);
}

/** `iloc` (version 1) with a construction_method field, as some writers emit. */
function ilocV1With(itemId: number, offset: number, length: number): Uint8Array {
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  view.setUint8(0, 1); // version 1
  view.setUint8(4, 0x44); // offset_size 4, length_size 4
  view.setUint8(5, 0x00); // base_offset_size 0, index_size 0
  view.setUint16(6, 1); // item_count
  view.setUint16(8, itemId);
  view.setUint16(10, 0); // construction_method 0 (plain file offset)
  view.setUint16(12, 0); // data_reference_index
  view.setUint16(14, 1); // extent_count
  view.setUint32(16, offset);
  view.setUint32(20, length);
  return isobmffBox('iloc', payload);
}

function heicFtyp(): Uint8Array {
  return isobmffBox('ftyp', new Uint8Array([0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])); // "heic"
}

/**
 * HEIC whose Exif item is declared through `iinf`/`iloc`. `exifHeader` is the
 * 4-byte `exif_tiff_header_offset` field plus any padding before the TIFF block,
 * and `decoy` precedes the real item inside `mdat` so a brute-force scan finds
 * the wrong TIFF header first.
 */
function heicWithExifItem(options: {
  tiff: Uint8Array;
  tiffHeaderOffset?: number;
  padding?: number;
  decoy?: Uint8Array;
  iloc?: (itemId: number, offset: number, length: number) => Uint8Array;
}): ArrayBuffer {
  const iloc = options.iloc || ilocWith;
  const ftyp = heicFtyp();
  // The extent offset depends on the meta box size, which does not depend on the
  // 4-byte offset value itself, so one placeholder pass fixes the layout.
  const metaSize = isobmffBox('meta', concatBytes([
    new Uint8Array(4), // version/flags
    iinfWith(infeExif(1)),
    iloc(1, 0, 0),
  ])).byteLength;
  const decoy = options.decoy || new Uint8Array(0);
  const exifBlock = new Uint8Array(4 + (options.padding || 0) + options.tiff.byteLength);
  new DataView(exifBlock.buffer).setUint32(0, options.tiffHeaderOffset || 0, false);
  exifBlock.set(options.tiff, 4 + (options.padding || 0));
  const mdatPayload = concatBytes([decoy, exifBlock]);
  const exifItemOffset = ftyp.byteLength + metaSize + 8 + decoy.byteLength;

  const meta = isobmffBox('meta', concatBytes([
    new Uint8Array(4),
    iinfWith(infeExif(1)),
    iloc(1, exifItemOffset, exifBlock.byteLength),
  ]));
  return concatBytes([ftyp, meta, isobmffBox('mdat', mdatPayload)]).buffer as ArrayBuffer;
}

describe('GPS rational hardening', () => {
  type GpsRaw = { gpsLatDecimal?: number; gpsLonDecimal?: number };
  const rawGps = (spec: Parameters<typeof gpsTiff>[0]): GpsRaw | null =>
    parseImageExif(jpegWithTiff(gpsTiff(spec))) as GpsRaw | null;

  it('returns NaN instead of the numerator when a rational denominator is zero', () => {
    const raw = rawGps({
      lat: [[0, 0], [0, 0], [0, 0]],
      lon: [[0, 0], [0, 0], [0, 0]],
      latRef: 'N',
      lonRef: 'E',
    });
    expect(raw?.gpsLatDecimal).toBeUndefined();
    expect(raw?.gpsLonDecimal).toBeUndefined();
    expect(formatExifForDisplay(raw)).toBeNull();
  });

  it('discards GPS when a reference is missing or the coordinates are both zero', () => {
    const missingRefs = rawGps({ lat: [[39, 1], [54, 1], [0, 1]], lon: [[116, 1], [24, 1], [0, 1]] });
    expect(missingRefs?.gpsLatDecimal).toBeUndefined();
    expect(missingRefs?.gpsLonDecimal).toBeUndefined();

    const bothZero = rawGps({
      lat: [[0, 1], [0, 1], [0, 1]],
      lon: [[0, 1], [0, 1], [0, 1]],
      latRef: 'N',
      lonRef: 'E',
    });
    expect(bothZero?.gpsLatDecimal).toBeUndefined();
    expect(bothZero?.gpsLonDecimal).toBeUndefined();
    expect(formatExifForDisplay(bothZero)).toBeNull();
  });

  it('keeps a complete fix with both references present', () => {
    const raw = rawGps({
      lat: [[39, 1], [54, 1], [0, 1]],
      lon: [[116, 1], [24, 1], [0, 1]],
      latRef: 'N',
      lonRef: 'E',
    });
    expect(formatExifForDisplay(raw)).toEqual([{ key: 'exif_gps', value: '39.9000, 116.4000' }]);
  });
});

describe('shutter speed formatting', () => {
  const shutter = (exposureTime: unknown): string | undefined => {
    const fields = formatExifForDisplay({ exposureTime }) as Array<{ key: string; value: string }> | null;
    return fields?.find((field) => field.key === 'exif_shutter')?.value;
  };

  it('shows a decimal shutter instead of a bogus 1/Ns fraction', () => {
    expect(shutter(0.8)).toBe('0.8s');
    expect(shutter(0.6)).toBe('0.6s');
    expect(shutter(0.5)).toBe('0.5s');
    expect(shutter(2)).toBe('2s');
    expect(shutter(0.25)).toBe('1/4s');
    expect(shutter(0.008)).toBe('1/125s');
  });

  it('omits zero, negative, and non-finite shutter values', () => {
    expect(shutter(0)).toBeUndefined();
    expect(shutter(-1)).toBeUndefined();
    expect(shutter(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(shutter(Number.NaN)).toBeUndefined();
  });
});

describe('HEIC container scanning', () => {
  it('rejects inputs shorter than the 12 bytes its header probe reads', () => {
    for (let length = 0; length < 12; length++) {
      const bytes = new Uint8Array(length);
      expect(() => parseImageExif(bytes.buffer)).not.toThrow();
      expect(parseImageExif(bytes.buffer)).toBeNull();
    }
  });

  it('reads the Exif item through iinf/iloc instead of scanning mdat', () => {
    const buffer = heicWithExifItem({
      tiff: tiffWithMake('CAM'),
      decoy: tiffWithMake('BAD'),
    });
    expect(parseImageExif(buffer)).toMatchObject({ make: 'CAM' });
  });

  it('honors the Exif item offset header and skips its 4-byte prefix', () => {
    const tiff = tiffWithMake('CAM');
    const buffer = heicWithExifItem({
      tiff,
      tiffHeaderOffset: 8,
      padding: 8,
      decoy: tiffWithMake('BAD'),
    });
    expect(parseImageExif(buffer)).toMatchObject({ make: 'CAM' });
  });

  it('reads a version 1 iloc with a construction_method field', () => {
    const buffer = heicWithExifItem({
      tiff: tiffWithMake('CAM'),
      decoy: tiffWithMake('BAD'),
      iloc: ilocV1With,
    });
    expect(parseImageExif(buffer)).toMatchObject({ make: 'CAM' });
  });
});
