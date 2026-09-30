// @ts-nocheck
import { PLUGIN_ID } from './plugin-identity';
import { LOCALE_TAGS } from './i18n';
import pluginManifest from '../manifest.json';

/**
 * Reverse geocoding language handling.
 *
 * Nominatim expects BCP-47 tags (`zh-TW`, `ja-JP`), while the plugin stores one
 * short code per supported UI language. Normalizing here keeps the geocoder
 * cache keys stable and language-specific for every supported language.
 */
const GEOCODER_LANGUAGES = ['en', 'zh', 'zh-tw', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

/**
 * Nominatim requires a User-Agent that names the application and offers a way
 * to contact its author (`https://operations.osmfoundation.org/policies/nominatim/`).
 * The version comes from the shipped plugin manifest so it cannot drift from a
 * release; an explicit override wins when a caller can supply one.
 */
export const GEOCODER_REPOSITORY_URL = 'https://github.com/Haoo-7/Obsidian-Dayline';
export const GEOCODER_FALLBACK_VERSION = '0.0.0';
export const GEOCODER_NEGATIVE_TTL_MS = 10 * 60 * 1000;
export const GEOCODER_REQUEST_TIMEOUT_MS = 10 * 1000;

function _normalizeGeocoderVersion(version) {
  const raw = typeof version === 'string' ? version.trim() : '';
  return /^\d+\.\d+(\.\d+)?([-+][0-9A-Za-z.-]+)?$/.test(raw) ? raw : GEOCODER_FALLBACK_VERSION;
}

/** Build the Nominatim User-Agent from a version, resolved defensively. */
export function resolveGeocoderUserAgent(version?: unknown): string {
  const resolved = version ?? pluginManifest?.version;
  return `ObsidianDayline/${_normalizeGeocoderVersion(resolved)} (+${GEOCODER_REPOSITORY_URL})`;
}

export const GEOCODER_USER_AGENT = resolveGeocoderUserAgent();

export function normalizeGeocoderLanguage(language) {
  const raw = String(language || '').trim().toLowerCase().replace(/_/g, '-');
  // Traditional Chinese scripts must be detected before the generic zh fallback.
  if (raw === 'zh-tw' || raw === 'zh-hk' || raw === 'zh-mo'
    || raw.startsWith('zh-hant') || raw.startsWith('zh-tw') || raw.startsWith('zh-hk')) {
    return 'zh-tw';
  }
  const base = raw.split('-')[0];
  return GEOCODER_LANGUAGES.includes(base) ? base : 'en';
}

export function geocoderLanguageTag(language) {
  return LOCALE_TAGS[normalizeGeocoderLanguage(language)] || LOCALE_TAGS.en;
}

let requestUrl;
function getRequestUrl() {
  if (!requestUrl) requestUrl = require('obsidian').requestUrl;
  return requestUrl;
}

/* ============================================================
   Lightweight JPEG EXIF Parser (zero-dependency)
   ============================================================ */

/**
 * Parse EXIF data from a JPEG ArrayBuffer.
 * Returns an object with human-readable values, or null if no EXIF found.
 */
/* ============================================================
   Shared TIFF/EXIF Parser (format-agnostic)
   Takes a DataView positioned at the TIFF header.
   ============================================================ */

const MAX_EXIF_BLOCK_BYTES = 8 * 1024 * 1024;
export const MAX_HEIC_TIFF_SCAN_BYTES = 16 * 1024 * 1024;

function _parseExifData(exifBytes) {
  if (!exifBytes || exifBytes.byteLength === 0 || exifBytes.byteLength > MAX_EXIF_BLOCK_BYTES) return null;
  const dv = new DataView(exifBytes);
  let le = true;
  const valid = (offset, length = 1) => Number.isSafeInteger(offset) && Number.isSafeInteger(length)
    && offset >= 0 && length >= 0 && offset <= dv.byteLength - length;
  const r16 = (offset) => valid(offset, 2) ? dv.getUint16(offset, le) : undefined;
  const r32 = (offset) => valid(offset, 4) ? dv.getUint32(offset, le) : undefined;
  const ri32 = (offset) => valid(offset, 4) ? dv.getInt32(offset, le) : undefined;

  function _parseTiff(offset, depth) {
    if (depth > 2 || !valid(offset, 8)) return null;
    const bo = r16(offset);
    if (bo === 0x4949) le = true;
    else if (bo === 0x4D4D) le = false;
    else return null;
    if (r16(offset + 2) !== 42) return null;
    const ifdOff = r32(offset + 4);
    if (!ifdOff || ifdOff > MAX_EXIF_BLOCK_BYTES) return null;
    return _readIfd(offset + ifdOff, offset, depth);
  }

  function _readIfd(ifdStart, tiffBase, depth) {
    if (depth > 2) return null;
    const n = r16(ifdStart);
    if (!n || n > 256 || !valid(ifdStart + 2, n * 12 + 4)) return null;
    const result = {};
    let gpsOff = null;
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const type = r16(eo + 2);
      const count = r32(eo + 4);
      const vo = eo + 8;
      if (tag === undefined || type === undefined || count === undefined) continue;
      if (tag === 0x8769) {
        const exifIfd = r32(vo);
        if (exifIfd && exifIfd <= MAX_EXIF_BLOCK_BYTES) {
          const nested = _readIfd(tiffBase + exifIfd, tiffBase, depth + 1);
          if (nested) Object.assign(result, nested);
        }
        continue;
      }
      if (tag === 0x8825) { gpsOff = r32(vo); continue; }
      const val = _readTag(eo, type, count, tiffBase);
      if (val === undefined) continue;
      switch (tag) {
        case 0x010F: result.make = val; break;
        case 0x0110: result.model = val; break;
        case 0x0131: result.software = val; break;
        case 0x9003: result.dateTimeOriginal = val; break;
        case 0x829A: result.exposureTime = val; break;
        case 0x829D: result.fNumber = val; break;
        case 0x8827: result.iso = val; break;
        case 0x920A: result.focalLength = val; break;
        case 0xA434: result.lensModel = val; break;
      }
    }
    if (gpsOff && gpsOff <= MAX_EXIF_BLOCK_BYTES) {
      const gps = _readGps(tiffBase + gpsOff, tiffBase);
      if (gps) Object.assign(result, gps);
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function _readGps(ifdStart, tiffBase) {
    const n = r16(ifdStart);
    if (!n || n > 64 || !valid(ifdStart + 2, n * 12 + 4)) return null;
    const result = {};
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const type = r16(eo + 2);
      const count = r32(eo + 4);
      if (tag === undefined || type === undefined || count === undefined) continue;
      const val = _readTag(eo, type, count, tiffBase);
      if (tag === 1) result.gpsLatRef = val;
      if (tag === 2) result.gpsLat = val;
      if (tag === 3) result.gpsLonRef = val;
      if (tag === 4) result.gpsLon = val;
    }
    const lat = _gpsDecimal(result.gpsLat, result.gpsLatRef);
    const lon = _gpsDecimal(result.gpsLon, result.gpsLonRef);
    // A camera without a fix writes `0/0` components and no Ref; storing that as
    // (0, 0) claimed a real location off the coast of Africa.
    if (lat !== undefined && lon !== undefined && !(lat === 0 && lon === 0)) {
      result.gpsLatDecimal = lat;
      result.gpsLonDecimal = lon;
    }
    return result;
  }

  /** Degrees from a DMS rational triple, or undefined when the fix is unusable. */
  function _gpsDecimal(parts, ref) {
    if (ref !== 'N' && ref !== 'S' && ref !== 'E' && ref !== 'W') return undefined;
    if (!Array.isArray(parts) || parts.length < 3) return undefined;
    // `_readTag` yields NaN for a zero denominator, which fails this check.
    if (!parts.every((part) => typeof part === 'number' && Number.isFinite(part))) return undefined;
    const degrees = parts[0] + parts[1] / 60 + parts[2] / 3600;
    if (!Number.isFinite(degrees)) return undefined;
    return ref === 'S' || ref === 'W' ? -degrees : degrees;
  }

  function _readTag(entryOffset, type, count, tiffBase) {
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    const size = sizes[type];
    if (!size || !Number.isSafeInteger(count) || count < 1 || count > MAX_EXIF_BLOCK_BYTES || count > Math.floor(MAX_EXIF_BLOCK_BYTES / size)) return undefined;
    const total = count * size;
    const dataOffset = entryOffset + 8;
    if (!valid(dataOffset, 4)) return undefined;
    const pointer = total <= 4 ? dataOffset : r32(dataOffset);
    if (pointer === undefined) return undefined;
    const valueOffset = total <= 4 ? pointer : tiffBase + pointer;
    if (!valid(valueOffset, total)) return undefined;
    switch (type) {
      case 1: case 6: case 7:
        if (count === 1) return dv.getUint8(valueOffset);
        return Array.from({ length: count }, (_, i) => dv.getUint8(valueOffset + i));
      case 2: {
        let text = '';
        for (let i = 0; i < Math.max(0, count - 1); i++) text += String.fromCharCode(dv.getUint8(valueOffset + i));
        return text.trim();
      }
      case 3:
        if (count === 1) return r16(valueOffset);
        return Array.from({ length: count }, (_, i) => r16(valueOffset + i * 2));
      case 4:
        if (count === 1) return r32(valueOffset);
        return Array.from({ length: count }, (_, i) => r32(valueOffset + i * 4));
      case 5: case 10: {
        const values = [];
        for (let i = 0; i < count; i++) {
          const readInteger = type === 10 ? ri32 : r32;
          const numerator = readInteger(valueOffset + i * 8);
          const denominator = readInteger(valueOffset + i * 8 + 4);
          if (numerator === undefined || denominator === undefined) return undefined;
          // 0/0 is how a camera writes "no value"; returning the numerator
          // turned it into the real coordinate (0, 0).
          values.push(denominator === 0 ? Number.NaN : numerator / denominator);
        }
        return count === 1 ? values[0] : values;
      }
      case 9:
        if (count === 1) return ri32(valueOffset);
        return Array.from({ length: count }, (_, i) => ri32(valueOffset + i * 4));
      default:
        return undefined;
    }
  }

  return _parseTiff(0, 0);
}

/* ============================================================
   Format-specific EXIF extractors
   ============================================================ */

/** Extract EXIF from JPEG (APP1 marker). */
function parseJpegExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null;
  let offset = 2;
  while (offset <= dv.byteLength - 4) {
    const marker = dv.getUint16(offset);
    if (marker === 0xFFE1) {
      const segmentLength = dv.getUint16(offset + 2);
      if (segmentLength < 8 || offset + 2 + segmentLength > dv.byteLength) return null;
      if (dv.getUint32(offset + 4) === 0x45786966) {
        return _parseExifData(arrayBuffer.slice(offset + 10, offset + 2 + segmentLength));
      }
    }
    if (marker < 0xFF00 || marker === 0xFFD8 || marker === 0xFFD9) break;
    const segLen = dv.getUint16(offset + 2);
    if (segLen < 2 || offset + 2 + segLen > dv.byteLength) break;
    offset += 2 + segLen;
  }
  return null;
}

/** Extract EXIF from PNG (eXIf chunk). */
function parsePngExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 8) return null;
  // PNG signature: 137 80 78 71 13 10 26 10
  if (dv.getUint32(0) !== 0x89504E47 || dv.getUint32(4) !== 0x0D0A1A0A) return null;
  let offset = 8;
  while (offset <= dv.byteLength - 12) {
    const len = dv.getUint32(offset); // chunk length (big-endian)
    const type = dv.getUint32(offset + 4); // chunk type (4 ASCII chars)
    if (len > dv.byteLength - offset - 12) break;
    if (type === 0x65584966) { // "eXIf"
      if (len > MAX_EXIF_BLOCK_BYTES) return null;
      // Chunk data starts at offset + 8, length is `len`
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + len));
    }
    if (type === 0x49454E44) break; // "IEND" — end of PNG
    offset += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }
  return null;
}

/** Extract EXIF from WebP (RIFF container, EXIF chunk). */
function parseWebpExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 16) return null;
  // RIFF header: "RIFF" + fileSize + "WEBP"
  if (dv.getUint32(0) !== 0x52494646) return null; // "RIFF"
  if (dv.getUint32(8) !== 0x57454250) return null; // "WEBP"
  let offset = 12;
  while (offset <= dv.byteLength - 8) {
    const fourCC = dv.getUint32(offset);
    const chunkSize = dv.getUint32(offset + 4, true); // little-endian!
    if (chunkSize > dv.byteLength - offset - 8) break;
    if (fourCC === 0x45584946) { // "EXIF"
      if (chunkSize > MAX_EXIF_BLOCK_BYTES) return null;
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + chunkSize));
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are padded to even
  }
  return null;
}

/** Read a 4-character ISOBMFF box type at `offset`. */
function _readBoxType(dv, offset) {
  return String.fromCharCode(
    dv.getUint8(offset), dv.getUint8(offset + 1), dv.getUint8(offset + 2), dv.getUint8(offset + 3),
  );
}

/** Enumerate ISOBMFF boxes inside `[start, end)` without reading past `end`. */
function _readIsoBoxes(dv, start, end) {
  const boxes = [];
  let offset = start;
  while (offset >= start && offset + 8 <= end) {
    let size = dv.getUint32(offset);
    const type = _readBoxType(dv, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit `largesize` follows the type.
      if (offset + 16 > end) break;
      size = dv.getUint32(offset + 8) * 0x100000000 + dv.getUint32(offset + 12);
      headerSize = 16;
    } else if (size === 0) {
      // Extends to the end of the enclosing container.
      size = end - offset;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

/** Item id whose `infe` entry declares `itemType`, or null. */
function _readHeicItemId(dv, iinf, itemType) {
  if (iinf.end - iinf.start < 4) return null;
  const version = dv.getUint8(iinf.start);
  let offset = iinf.start + 4; // version + flags
  let count;
  if (version === 0) {
    if (offset + 2 > iinf.end) return null;
    count = dv.getUint16(offset);
    offset += 2;
  } else {
    if (offset + 4 > iinf.end) return null;
    count = dv.getUint32(offset);
    offset += 4;
  }
  for (let i = 0; i < count && offset + 8 <= iinf.end; i++) {
    const size = dv.getUint32(offset);
    const type = _readBoxType(dv, offset + 4);
    if (size < 8 || offset + size > iinf.end) break;
    if (type === 'infe') {
      const entry = { start: offset + 8, end: offset + size };
      if (entry.end - entry.start < 8) { offset += size; continue; }
      const entryVersion = dv.getUint8(entry.start);
      const typeOffset = entryVersion >= 3 ? entry.start + 10 : entry.start + 8;
      let entryType = null;
      if (entryVersion >= 2) {
        if (typeOffset + 4 <= entry.end) entryType = _readBoxType(dv, typeOffset);
      } else {
        // v0/v1 store a NUL-terminated item_name where the 4CC lives for v2+.
        let at = entry.start + 8;
        let name = '';
        while (at < entry.end && dv.getUint8(at) !== 0) { name += String.fromCharCode(dv.getUint8(at)); at++; }
        entryType = name || null;
      }
      if (entryType === itemType) {
        return entryVersion >= 3 && entry.start + 8 <= entry.end
          ? dv.getUint32(entry.start + 4)
          : dv.getUint16(entry.start + 4);
      }
    }
    offset += size;
  }
  return null;
}

/**
 * Extents declared by `iloc` for one item. Only construction method 0 (a plain
 * file offset) is returned; `idat`-relative extents are skipped.
 */
function _readHeicItemExtents(dv, iloc, itemId) {
  if (itemId === null || iloc.end - iloc.start < 8) return [];
  const version = dv.getUint8(iloc.start);
  let offset = iloc.start + 4; // version + flags
  const fieldSizes = dv.getUint8(offset);
  offset += 1;
  const offsetSize = (fieldSizes >> 4) & 0x0f;
  const lengthSize = fieldSizes & 0x0f;
  const baseFieldSizes = dv.getUint8(offset);
  offset += 1;
  const baseOffsetSize = (baseFieldSizes >> 4) & 0x0f;
  const indexSize = version === 1 || version === 2 ? (baseFieldSizes & 0x0f) : 0;
  if (offsetSize === 0 || offsetSize > 8 || lengthSize === 0 || lengthSize > 8
    || baseOffsetSize > 8 || indexSize > 8) {
    return [];
  }
  let count;
  if (version < 2) {
    if (offset + 2 > iloc.end) return [];
    count = dv.getUint16(offset);
    offset += 2;
  } else {
    if (offset + 4 > iloc.end) return [];
    count = dv.getUint32(offset);
    offset += 4;
  }

  const readField = (at, size) => {
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + dv.getUint8(at + i);
    return value;
  };

  const extents = [];
  for (let i = 0; i < count; i++) {
    const idSize = version < 2 ? 2 : 4;
    if (offset + idSize + 2 > iloc.end) break;
    const id = idSize === 2 ? dv.getUint16(offset) : dv.getUint32(offset);
    offset += idSize;
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      if (offset + 2 > iloc.end) break;
      constructionMethod = dv.getUint16(offset) & 0x0f;
      offset += 2;
    }
    if (offset + 2 + baseOffsetSize + 2 > iloc.end) break;
    offset += 2; // data_reference_index
    const baseOffset = readField(offset, baseOffsetSize);
    offset += baseOffsetSize;
    const extentCount = dv.getUint16(offset);
    offset += 2;
    for (let e = 0; e < extentCount; e++) {
      if (offset + indexSize + offsetSize + lengthSize > iloc.end) return extents;
      offset += indexSize; // extent_index is irrelevant for file offsets
      const extentOffset = readField(offset, offsetSize);
      offset += offsetSize;
      const extentLength = readField(offset, lengthSize);
      offset += lengthSize;
      if (id === itemId && constructionMethod === 0) {
        extents.push({ offset: baseOffset + extentOffset, length: extentLength });
      }
    }
  }
  return extents;
}

function _hasTiffHeader(dv, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 8 > dv.byteLength) return false;
  const byteOrder = dv.getUint16(offset);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4D4D) return false;
  return dv.getUint16(offset + 2, byteOrder === 0x4949) === 42;
}

/**
 * Locate the TIFF header of the `Exif` item through the ISOBMFF `iinf`/`iloc`
 * boxes. The item payload starts with a 4-byte `exif_tiff_header_offset`, so the
 * TIFF block normally begins at `itemStart + 4` (some writers count the field
 * itself, so the declared offset is probed too).
 */
function _locateHeicExifBuffer(arrayBuffer, dv) {
  const meta = _readIsoBoxes(dv, 0, dv.byteLength).find((box) => box.type === 'meta');
  if (!meta || meta.start + 4 > meta.end) return null;
  // `meta` is a FullBox: its children start after version + flags.
  const children = _readIsoBoxes(dv, meta.start + 4, meta.end);
  const iinf = children.find((box) => box.type === 'iinf');
  const iloc = children.find((box) => box.type === 'iloc');
  if (!iinf || !iloc) return null;
  const itemId = _readHeicItemId(dv, iinf, 'Exif');
  const extent = _readHeicItemExtents(dv, iloc, itemId)[0];
  if (!extent || !Number.isSafeInteger(extent.offset) || extent.length <= 0) return null;
  const start = extent.offset;
  const end = Math.min(dv.byteLength, start + extent.length);
  if (start < 0 || start + 4 > end) return null;

  const declared = dv.getUint32(start);
  const probes = [start + 4, start];
  if (declared > 0) probes.unshift(start + declared, start + 4 + declared);
  for (const probe of probes) {
    if (probe + 8 <= end && _hasTiffHeader(dv, probe)) {
      return arrayBuffer.slice(probe, Math.min(end, probe + MAX_EXIF_BLOCK_BYTES));
    }
  }
  // Last resort: a bounded scan inside the located item, never the whole file.
  const scanEnd = Math.min(end - 8, start + 4096);
  for (let probe = start; probe < scanEnd; probe++) {
    if (_hasTiffHeader(dv, probe)) {
      return arrayBuffer.slice(probe, Math.min(end, probe + MAX_EXIF_BLOCK_BYTES));
    }
  }
  return null;
}

/** Extract EXIF from HEIC/HEIF (ISOBMFF container, Exif item via iinf/iloc). */
function parseHeicExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  // Preferred path: the Exif item the writer declared in `meta`. Searching the
  // first 16MB for a TIFF header can hit arbitrary bytes inside `mdat`.
  const located = _locateHeicExifBuffer(arrayBuffer, dv);
  if (located) return _parseExifData(located);

  // Fallback for containers whose item tables cannot be read: keep the previous
  // bounded scan so an unusual writer does not lose its metadata entirely.
  if (_readIsoBoxes(dv, 0, dv.byteLength).some((box) => box.type === 'meta')) return null;
  const scanEnd = Math.min(dv.byteLength, MAX_HEIC_TIFF_SCAN_BYTES);
  const max = Math.max(0, scanEnd - 8);
  for (let i = 0; i < max; i++) {
    if (_hasTiffHeader(dv, i)) {
      const exifSlice = arrayBuffer.slice(i, Math.min(arrayBuffer.byteLength, i + MAX_EXIF_BLOCK_BYTES));
      return _parseExifData(exifSlice);
    }
  }
  return null;
}

/** Unified entry point — auto-detects format and extracts EXIF. */
export function parseImageExif(arrayBuffer) {
  // The format probes below read up to `getUint32(8)`, so anything shorter than
  // 12 bytes must be rejected before the first read.
  if (!arrayBuffer || arrayBuffer.byteLength < 12) return null;
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint16(0);
  const magic4 = dv.getUint32(0);
  // Check for HEIC ftyp box at offset 4: size(4) + "ftyp" + brand
  const brand4 = dv.getUint32(8);
  const isHeic = (dv.getUint32(4) === 0x66747970 && // "ftyp"
    (brand4 === 0x68656963 || brand4 === 0x68656978 || brand4 === 0x68657663 || // heic/heix/hevc
     brand4 === 0x6865696D || brand4 === 0x68656973 || brand4 === 0x6865766D || // heim/heis/hevm
     brand4 === 0x68657673 || brand4 === 0x6D696631 || brand4 === 0x6D736631));  // hevs/mif1/msf1

  // JPEG: 0xFFD8
  if (magic === 0xFFD8) return parseJpegExif(arrayBuffer);
  // PNG: 0x89504E47
  if (magic4 === 0x89504E47) return parsePngExif(arrayBuffer);
  // WebP: 0x52494646 ("RIFF")
  if (magic4 === 0x52494646) return parseWebpExif(arrayBuffer);
  // HEIC/HEIF: ISOBMFF container
  if (isHeic) return parseHeicExif(arrayBuffer);

  return null;
}

/**
 * Format raw EXIF data into human-readable display fields.
 * Returns null if no meaningful data was found.
 */
export function formatExifForDisplay(raw) {
  if (!raw) return null;

  const fields = [];

  // Camera: Make + Model
  if (raw.make || raw.model) {
    const make = raw.make || '';
    const model = raw.model || '';
    fields.push({ key: 'exif_camera', value: (make + ' ' + model).trim() });
  }

  // Lens
  if (raw.lensModel) {
    fields.push({ key: 'exif_lens', value: raw.lensModel });
  }

  // Date
  if (raw.dateTimeOriginal) {
    let dt = raw.dateTimeOriginal;
    if (typeof dt === 'string' && dt.includes(' ')) {
      dt = dt.replace(' ', '  '); // add spacing
    }
    fields.push({ key: 'exif_date', value: dt });
  }

  // Aperture
  if (raw.fNumber !== undefined && raw.fNumber !== null) {
    const f = typeof raw.fNumber === 'number' ? raw.fNumber.toFixed(1) : String(raw.fNumber);
    fields.push({ key: 'exif_aperture', value: 'f/' + f });
  }

  // Shutter speed
  if (raw.exposureTime !== undefined && raw.exposureTime !== null) {
    let shutter;
    if (typeof raw.exposureTime === 'number') {
      const seconds = raw.exposureTime;
      if (Number.isFinite(seconds) && seconds > 0) {
        if (seconds >= 1) {
          shutter = seconds + 's';
        } else {
          // Rounding 1/t produced "1/1s" for 0.8 and "1/2s" for 0.6, and
          // "1/Infinitys" for 0. A fraction is only meaningful when 1/t is
          // essentially an integer and t is below the range where the rounded
          // denominator misleads.
          const denominator = 1 / seconds;
          const rounded = Math.round(denominator);
          const nearInteger = rounded >= 1 && Math.abs(denominator - rounded) <= Math.max(0.01, rounded * 0.005);
          shutter = seconds >= 0.3 || !nearInteger
            ? Number(seconds.toPrecision(4)) + 's'
            : '1/' + rounded + 's';
        }
      }
    } else {
      shutter = String(raw.exposureTime);
    }
    if (shutter !== undefined) fields.push({ key: 'exif_shutter', value: shutter });
  }

  // ISO
  if (raw.iso !== undefined && raw.iso !== null) {
    fields.push({ key: 'exif_iso', value: String(raw.iso) });
  }

  // Focal length
  if (raw.focalLength !== undefined && raw.focalLength !== null) {
    const fl = typeof raw.focalLength === 'number'
      ? Math.round(raw.focalLength) + 'mm'
      : String(raw.focalLength);
    fields.push({ key: 'exif_focal', value: fl });
  }

  // GPS
  if (raw.gpsLatDecimal !== undefined && raw.gpsLonDecimal !== undefined) {
    const lat = raw.gpsLatDecimal.toFixed(4);
    const lon = raw.gpsLonDecimal.toFixed(4);
    fields.push({ key: 'exif_gps', value: lat + ', ' + lon });
  }

  // Software
  if (raw.software) {
    fields.push({ key: 'exif_software', value: raw.software });
  }

  return fields.length > 0 ? fields : null;
}

/* ============================================================
   Image Metadata Cache
   ============================================================ */

export class ImageMetadataCache {
  /**
   * @param {import('obsidian').App} app
   */
  constructor(app) {
    this.app = app;
    /** @type {Map<string, { fields: Array<{key:string,value:string}> } | null>} */
    this._cache = new Map();
    /** @type {Map<string, Promise>} */
    this._pending = new Map();
  }

  /**
   * Get formatted EXIF fields for an image file.
   * @param {import('obsidian').TFile} file
   * @returns {Promise<Array<{key:string,value:string}> | null>}
   */
  async get(file) {
    const filePath = file.path;
    const cached = this._cache.get(filePath);
    if (cached !== undefined) {
      this._cache.delete(filePath);
      this._cache.set(filePath, cached);
      return cached;
    }

    const pending = this._pending.get(filePath);
    if (pending) return pending;

    const promise = this._load(file);
    this._pending.set(filePath, promise);
    try {
      const result = await promise;
      if (this._pending.get(filePath) === promise) {
        this._cache.set(filePath, result);
        while (this._cache.size > 128) this._cache.delete(this._cache.keys().next().value);
      }
      return result;
    } finally {
      if (this._pending.get(filePath) === promise) this._pending.delete(filePath);
    }
  }

  async _load(file) {
    try {
      const buf = await this.app.vault.readBinary(file);
      const raw = parseImageExif(buf);
      if (!raw) return null;
      return formatExifForDisplay(raw);
    } catch {
      return null;
    }
  }

  /** Invalidate cache for a specific file, or all files if no path given. */
  invalidate(filePath) {
    if (filePath) {
      this._cache.delete(filePath);
      this._pending.delete(filePath);
    } else {
      this._cache.clear();
      this._pending.clear();
    }
  }
}

/* ============================================================
   HEIC Thumbnail Cache (libheif-js powered)
   ============================================================ */

export const HEIC_EXTS = ['heic', 'heif'];
export const MAX_HEIC_BYTES = 100 * 1024 * 1024;
export const MAX_HEIC_PIXELS = 50 * 1000 * 1000;
export const MAX_HEIC_EDGE = 8192;

export class HeicCache {
  constructor(app, capabilities?: any) {
    this.app = app;
    this.capabilities = capabilities;
    /** @type {Map<string, {dataUrl:string, width:number, height:number}>} */
    this._cache = new Map();
    /** @type {Map<string, Promise>} */
    this._pending = new Map();
    this._libheifReady = null;
    // One decoder for the whole cache: libheif's `decode()` only frees the
    // previous context when the same instance decodes again, and conversions are
    // already serialized through `_conversionQueue`.
    this._decoder = null;
    this._conversionQueue = Promise.resolve();
  }

  _getLibheif() {
    if (!this._libheifReady) {
      const plugin = this.app.plugins?.plugins?.[PLUGIN_ID];
      const factory = plugin?._libheifFactory;
      if (!factory) {
        return Promise.reject(new Error('libheif not loaded'));
      }
      // factory() may return a Promise or the libheif object directly
      this._libheifReady = Promise.resolve(factory()).catch((error) => {
        // A single failed WASM instantiation must not disable HEIC for the rest
        // of the session.
        this._libheifReady = null;
        throw error;
      });
    }
    return this._libheifReady;
  }

  /** Reuse the cache's decoder, creating it on first use. */
  _getDecoder(libheif) {
    if (!this._decoder) this._decoder = new libheif.HeifDecoder();
    return this._decoder;
  }

  /**
   * Release the WASM context that `decode()` allocated. `image.free()` only
   * releases the image handle, so without this each conversion would retain one
   * file's worth of heap until the next decode on the same instance.
   */
  _freeDecoderContext(libheif, decoder) {
    if (!decoder?.decoder || typeof libheif?.heif_context_free !== 'function') return;
    try {
      libheif.heif_context_free(decoder.decoder);
    } catch {
      // Native cleanup must never mask the conversion result.
    }
    decoder.decoder = null;
  }

  /**
   * Get a JPEG data URL thumbnail for a HEIC file.
   * @param {import('obsidian').TFile} file
   * @returns {Promise<{dataUrl:string, width:number, height:number}|null>}
   */
  async getThumbnail(file) {
    if (this.capabilities?.routes?.heic === 'disabled') return null;
    const key = `${file.path}:${file.stat?.mtime || 0}`;
    if (this._cache.has(key)) {
      const value = this._cache.get(key);
      this._cache.delete(key);
      this._cache.set(key, value);
      return value;
    }
    if (this._pending.has(key)) return this._pending.get(key);

    const promise = this._scheduleConversion(file);
    this._pending.set(key, promise);
    try {
      const result = await promise;
      if (result && this._pending.get(key) === promise) {
        this._cache.delete(key);
        this._cache.set(key, result);
        while (this._cache.size > 48) this._cache.delete(this._cache.keys().next().value);
      }
      return result;
    } finally {
      if (this._pending.get(key) === promise) this._pending.delete(key);
    }
  }

  _scheduleConversion(file) {
    const operation = this._conversionQueue.then(() => this._convert(file));
    this._conversionQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async _convert(file) {
    let images = [];
    let libheif = null;
    let decoder = null;
    try {
      const fileSize = Number(file.stat?.size);
      if (Number.isFinite(fileSize) && fileSize > MAX_HEIC_BYTES) {
        console.warn('[Dayline] HEIC conversion skipped: file exceeds 100 MiB limit');
        return null;
      }
      // Check the factory before reading a potentially large HEIC file. The
      // capability route also disables this path on mobile without a factory.
      if (!this._hasLibheifFactory()) return null;
      const buf = await this.app.vault.readBinary(file);
      if (!buf || buf.byteLength > MAX_HEIC_BYTES) {
        console.warn('[Dayline] HEIC conversion skipped: file exceeds 100 MiB limit');
        return null;
      }
      libheif = await this._getLibheif();
      decoder = this._getDecoder(libheif);
      images = decoder.decode(new Uint8Array(buf)) || [];
      if (!images || !images.length) return null;
      const img = images[0];

      const origW = img.get_width();
      const origH = img.get_height();
      if (!Number.isSafeInteger(origW) || !Number.isSafeInteger(origH)
        || origW <= 0 || origH <= 0 || origW > MAX_HEIC_EDGE || origH > MAX_HEIC_EDGE
        || origW * origH > MAX_HEIC_PIXELS) {
        console.warn('[Dayline] HEIC conversion skipped: dimensions exceed resource limits');
        return null;
      }

      // Decode to canvas
      const canvas = createEl('canvas');
      canvas.width = origW;
      canvas.height = origH;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(origW, origH);

      await new Promise((resolve, reject) => {
        img.display(imageData, (displayData) => {
          if (!displayData) return reject(new Error('libheif display failed'));
          resolve(displayData);
        });
      });

      ctx.putImageData(imageData, 0, 0);

      // Scale down to max 900px for thumbnails
      const maxDim = 900;
      let tw = origW, th = origH;
      if (origW > maxDim || origH > maxDim) {
        const scale = maxDim / Math.max(origW, origH);
        tw = Math.round(origW * scale);
        th = Math.round(origH * scale);
      }

      const thumb = createEl('canvas');
      thumb.width = tw;
      thumb.height = th;
      const thumbCtx = thumb.getContext('2d');
      thumbCtx.drawImage(canvas, 0, 0, tw, th);

      const dataUrl = thumb.toDataURL('image/jpeg', 0.75);

      return { dataUrl, width: tw, height: th };
    } catch (e) {
      console.warn('[Dayline] HEIC conversion failed:', e.message || e);
      return null;
    } finally {
      for (const image of images) {
        try {
          image?.free?.();
        } catch {
          // A failed native cleanup must not prevent the remaining handles from being released.
        }
      }
      // Release the WASM context only after its image handles are gone.
      this._freeDecoderContext(libheif, decoder);
    }
  }

  _hasLibheifFactory() {
    const plugin = this.app.plugins?.plugins?.[PLUGIN_ID];
    return typeof plugin?._libheifFactory === 'function';
  }

  invalidate(filePath) {
    if (filePath) {
      for (const key of this._cache.keys()) if (key.startsWith(`${filePath}:`)) this._cache.delete(key);
      for (const key of this._pending.keys()) if (key.startsWith(`${filePath}:`)) this._pending.delete(key);
    } else {
      this._cache.clear();
      this._pending.clear();
      this._libheifReady = null;
      // The cached decoder belongs to the libheif instance being dropped.
      this._decoder = null;
    }
  }
}

/* ============================================================
   Reverse Geocoder (Nominatim, free, no API key)
   ============================================================ */

export const GEOCODER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const GEOCODER_CACHE_MAX_ENTRIES = 256;
/** Coordinates are only needed to name a place, so 3 decimals (~110m) suffice. */
export const GEOCODER_COORDINATE_DECIMALS = 3;

export class ReverseGeocoder {
  constructor(options = {}) {
    this._cache = new Map();      // "lat,lon|language" -> { name, cachedAt }
    this._pending = new Map();    // "lat,lon|language" -> Promise (in-flight dedup)
    this._failed = new Map();     // "lat,lon|language" -> timestamp (negative cache)
    this._persistentCache = options.cache && typeof options.cache === 'object' ? options.cache : null;
    this._onChange = options.onChange;
    this._now = options.now || (() => Date.now());
    this._ttlMs = Math.max(1, Number(options.ttlMs ?? GEOCODER_CACHE_TTL_MS));
    this._maxEntries = Math.max(1, Math.floor(Number(options.maxEntries ?? GEOCODER_CACHE_MAX_ENTRIES)));
    this._minRequestIntervalMs = Math.max(0, Number(options.minRequestIntervalMs ?? 1000));
    this._negativeTtlMs = Math.max(0, Number(options.negativeTtlMs ?? GEOCODER_NEGATIVE_TTL_MS));
    this._requestTimeoutMs = Math.max(1, Number(options.requestTimeoutMs ?? GEOCODER_REQUEST_TIMEOUT_MS));
    this._sleep = options.sleep || ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
    this._request = options.request || ((request) => getRequestUrl()(request));
    // The User-Agent identifies the plugin, as Nominatim's usage policy requires.
    this._userAgent = typeof options.userAgent === 'string' && options.userAgent.trim()
      ? options.userAgent.trim()
      : resolveGeocoderUserAgent(options.pluginVersion ?? options.app?.plugins?.manifests?.[PLUGIN_ID]?.version);
    this._getLanguage = options.getLanguage || (() => 'en');
    this._lastRequest = 0;        // rate limit: 1 req/s
    this._requestQueue = Promise.resolve();
    this._loadPersistentCache();
  }

  _normalizeLanguage(language) {
    return normalizeGeocoderLanguage(language);
  }

  _normalizeCoordinates(lat, lon) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    // Truncating to 3 decimals here keeps the Nominatim request, the cache key
    // and the memory key on the same rounded location.
    const factor = 10 ** GEOCODER_COORDINATE_DECIMALS;
    return {
      latitude: Math.round(latitude * factor) / factor,
      longitude: Math.round(longitude * factor) / factor,
    };
  }

  _key(lat, lon, language) {
    return `${lat.toFixed(GEOCODER_COORDINATE_DECIMALS)},${lon.toFixed(GEOCODER_COORDINATE_DECIMALS)}|${this._normalizeLanguage(language)}`;
  }

  _record(raw, fallbackNow = this._now()) {
    if (typeof raw === 'string' && raw.trim()) {
      // A legacy successful-name value gets a bounded timestamp.
      return { name: raw.trim(), cachedAt: new Date(fallbackNow).toISOString() };
    }
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    const cachedAt = new Date(raw.cachedAt).getTime();
    if (!Number.isFinite(cachedAt)) return null;
    return { name: raw.name.trim(), cachedAt: new Date(cachedAt).toISOString() };
  }

  _loadPersistentCache() {
    if (!this._persistentCache) return;
    const now = this._now();
    let changed = false;
    for (const [key, raw] of Object.entries(this._persistentCache)) {
      // Keys without a language belong to the old memory-only shape and are
      // ignored rather than guessed into the wrong locale.
      if (!key.includes('|')) {
        delete this._persistentCache[key];
        changed = true;
        continue;
      }
      const record = this._record(raw, now);
      if (!record || now - Date.parse(record.cachedAt) > this._ttlMs) {
        delete this._persistentCache[key];
        changed = true;
        continue;
      }
      this._cache.set(key, record);
    }
    changed = this._prune(now, false) || changed;
    if (changed) this._onChange?.();
  }

  _prune(now = this._now(), notify = true) {
    let changed = false;
    for (const [key, record] of this._cache.entries()) {
      if (!record?.name || !Number.isFinite(Date.parse(record.cachedAt))
        || now - Date.parse(record.cachedAt) > this._ttlMs) {
        this._cache.delete(key);
        if (this._persistentCache) delete this._persistentCache[key];
        changed = true;
      }
    }
    for (const [key, failedAt] of this._failed.entries()) {
      if (now - failedAt > this._negativeTtlMs) this._failed.delete(key);
    }
    const ordered = [...this._cache.entries()]
      .sort((a, b) => Date.parse(b[1].cachedAt) - Date.parse(a[1].cachedAt));
    for (const [key] of ordered.slice(this._maxEntries)) {
      this._cache.delete(key);
      if (this._persistentCache) delete this._persistentCache[key];
      changed = true;
    }
    while (this._failed.size > this._maxEntries) {
      this._failed.delete(this._failed.keys().next().value);
    }
    if (changed && notify) this._onChange?.();
    return changed;
  }

  _isNegativelyCached(key, now) {
    if (this._negativeTtlMs <= 0) return false;
    const failedAt = this._failed.get(key);
    if (failedAt === undefined) return false;
    if (now - failedAt > this._negativeTtlMs) {
      this._failed.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Look up a human-readable place name for coordinates.
   * Returns null if the lookup fails or has no result.
   */
  async lookup(lat, lon, language = this._getLanguage()) {
    const coordinates = this._normalizeCoordinates(lat, lon);
    if (!coordinates) return null;
    const effectiveLanguage = this._normalizeLanguage(language);
    const key = this._key(coordinates.latitude, coordinates.longitude, effectiveLanguage);
    const now = this._now();
    this._prune(now);
    const cached = this._cache.get(key);
    if (cached) return cached.name;
    // A recent failure is not retried; that would put the whole serial queue
    // behind a service that is already refusing requests.
    if (this._isNegativelyCached(key, now)) return null;
    if (this._pending.has(key)) return this._pending.get(key);

    this._requestQueue = this._requestQueue
      .catch(() => {})
      .then(() => this._doLookup(coordinates.latitude, coordinates.longitude, effectiveLanguage));
    const promise = this._requestQueue;
    this._pending.set(key, promise);
    try {
      const result = await promise;
      // A failed lookup is never stored as a successful name.
      if (result) {
        const record = { name: result, cachedAt: new Date(this._now()).toISOString() };
        this._cache.set(key, record);
        this._failed.delete(key);
        if (this._persistentCache) this._persistentCache[key] = record;
        this._prune(this._now());
        this._onChange?.();
      } else {
        this._failed.set(key, this._now());
        this._prune(this._now(), false);
      }
      return result;
    } finally {
      this._pending.delete(key);
    }
  }

  /** Reject a request that never settles so it cannot block the queue forever. */
  _withTimeout(promise) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = window.setTimeout(
          () => reject(new Error(`geocoder request timed out after ${this._requestTimeoutMs}ms`)),
          this._requestTimeoutMs,
        );
      }),
    ]).finally(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
  }

  async _doLookup(lat, lon, language) {
    // Respect Nominatim's 1 req/s rate limit.
    const now = this._now();
    const elapsed = now - this._lastRequest;
    if (this._lastRequest > 0 && elapsed < this._minRequestIntervalMs) {
      await this._sleep(this._minRequestIntervalMs - elapsed);
    }
    this._lastRequest = this._now();

    try {
      const params = new URLSearchParams({
        format: 'json',
        lat: String(lat),
        lon: String(lon),
        zoom: '12',
        'accept-language': geocoderLanguageTag(language),
      });
      const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
      const resp = await this._withTimeout(this._request({
        url,
        headers: { 'User-Agent': this._userAgent },
      }));
      if (resp.status === 200 && resp.json) {
        const data = resp.json;
        // Prefer concise address sub-fields over the full display name.
        if (data.address) {
          const a = data.address;
          const parts = [a.city || a.town || a.county, a.district || a.suburb, a.village].filter(Boolean);
          if (parts.length > 0) return parts.join(' · ');
          if (data.display_name) return data.display_name.split(',')[0];
        }
        if (data.display_name) return data.display_name.split(',')[0];
      }
    } catch {
      // Silently fail — just show raw coordinates.
    }
    return null;
  }

  invalidate() {
    this._cache.clear();
    this._pending.clear();
    this._failed.clear();
    if (this._persistentCache) {
      for (const key of Object.keys(this._persistentCache)) delete this._persistentCache[key];
      this._onChange?.();
    }
  }
}
