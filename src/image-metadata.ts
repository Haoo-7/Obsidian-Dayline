// @ts-nocheck
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
    if (Array.isArray(result.gpsLat) && result.gpsLat.length >= 3 && result.gpsLat.every(Number.isFinite)) {
      const lat = result.gpsLat[0] + result.gpsLat[1] / 60 + result.gpsLat[2] / 3600;
      if (Number.isFinite(lat)) result.gpsLatDecimal = result.gpsLatRef === 'S' ? -lat : lat;
    }
    if (Array.isArray(result.gpsLon) && result.gpsLon.length >= 3 && result.gpsLon.every(Number.isFinite)) {
      const lon = result.gpsLon[0] + result.gpsLon[1] / 60 + result.gpsLon[2] / 3600;
      if (Number.isFinite(lon)) result.gpsLonDecimal = result.gpsLonRef === 'W' ? -lon : lon;
    }
    return result;
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
          values.push(denominator === 0 ? numerator : numerator / denominator);
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
    if (len > MAX_EXIF_BLOCK_BYTES || offset + 12 + len > dv.byteLength) break;
    if (type === 0x65495866) { // "eXIf"
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
    if (chunkSize > MAX_EXIF_BLOCK_BYTES || offset + 8 + chunkSize > dv.byteLength) break;
    if (fourCC === 0x45584946) { // "EXIF"
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + chunkSize));
    }
    if (fourCC === 0x56503820) { // "VP8 " — image data, no more metadata after this
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are padded to even
  }
  return null;
}

/** Extract EXIF from HEIC/HEIF (ISOBMFF container — scan for TIFF header). */
function parseHeicExif(arrayBuffer) {
  // HEIC files store EXIF as raw TIFF data inside the meta/mdat boxes.
  // We scan for the TIFF byte-order marker (II=0x4949 or MM=0x4D4D)
  // followed by magic 42 (0x002A).
  const dv = new DataView(arrayBuffer);
  const scanEnd = Math.min(dv.byteLength, MAX_HEIC_TIFF_SCAN_BYTES);
  const max = Math.max(0, scanEnd - 8);
  for (let i = 0; i < max; i++) {
    const bo = dv.getUint16(i);
    if ((bo === 0x4949 || bo === 0x4D4D) && dv.getUint16(i + 2, bo === 0x4949) === 42) {
      // Found TIFF header — extract from here
      const exifSlice = arrayBuffer.slice(i, Math.min(arrayBuffer.byteLength, i + MAX_EXIF_BLOCK_BYTES));
      return _parseExifData(exifSlice);
    }
  }
  return null;
}

/** Unified entry point — auto-detects format and extracts EXIF. */
export function parseImageExif(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return null;
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint16(0);
  const magic4 = dv.getUint32(0);
  // Check for HEIC ftyp box at offset 4: size(4) + "ftyp" + brand
  const brand4 = dv.getUint32(8);
  const isHeic = (arrayBuffer.byteLength > 12 && dv.getUint32(4) === 0x66747970 && // "ftyp"
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
      if (raw.exposureTime >= 1) {
        shutter = raw.exposureTime + 's';
      } else {
        const denom = Math.round(1 / raw.exposureTime);
        shutter = '1/' + denom + 's';
      }
    } else {
      shutter = String(raw.exposureTime);
    }
    fields.push({ key: 'exif_shutter', value: shutter });
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
    } catch (_) {
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
  }

  _getLibheif() {
    if (!this._libheifReady) {
      const plugin = this.app.plugins?.plugins?.dayline;
      const factory = plugin?._libheifFactory;
      if (!factory) {
        return Promise.reject(new Error('libheif not loaded'));
      }
      // factory() may return a Promise or the libheif object directly
      this._libheifReady = Promise.resolve(factory());
    }
    return this._libheifReady;
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

    const promise = this._convert(file);
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

  async _convert(file) {
    try {
      // Check the factory before reading a potentially large HEIC file. The
      // capability route also disables this path on mobile without a factory.
      if (!this._hasLibheifFactory()) return null;
      const buf = await this.app.vault.readBinary(file);
      if (!buf || buf.byteLength > MAX_HEIC_BYTES) {
        console.warn('[Dayline] HEIC conversion skipped: file exceeds 100 MiB limit');
        return null;
      }
      const libheif = await this._getLibheif();
      const decoder = new libheif.HeifDecoder();
      const images = decoder.decode(new Uint8Array(buf));
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
      const canvas = document.createElement('canvas');
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

      const thumb = document.createElement('canvas');
      thumb.width = tw;
      thumb.height = th;
      const thumbCtx = thumb.getContext('2d');
      thumbCtx.drawImage(canvas, 0, 0, tw, th);

      const dataUrl = thumb.toDataURL('image/jpeg', 0.75);

      return { dataUrl, width: tw, height: th };
    } catch (e) {
      console.warn('[Dayline] HEIC conversion failed:', e.message || e);
      return null;
    }
  }

  _hasLibheifFactory() {
    const plugin = this.app.plugins?.plugins?.dayline;
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
    }
  }
}

/* ============================================================
   Reverse Geocoder (Nominatim, free, no API key)
   ============================================================ */

export const GEOCODER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const GEOCODER_CACHE_MAX_ENTRIES = 256;

export class ReverseGeocoder {
  constructor(options = {}) {
    this._cache = new Map();      // "lat,lon|language" -> { name, cachedAt }
    this._pending = new Map();    // "lat,lon|language" -> Promise (in-flight dedup)
    this._persistentCache = options.cache && typeof options.cache === 'object' ? options.cache : null;
    this._onChange = options.onChange;
    this._now = options.now || (() => Date.now());
    this._ttlMs = Math.max(1, Number(options.ttlMs ?? GEOCODER_CACHE_TTL_MS));
    this._maxEntries = Math.max(1, Math.floor(Number(options.maxEntries ?? GEOCODER_CACHE_MAX_ENTRIES)));
    this._minRequestIntervalMs = Math.max(0, Number(options.minRequestIntervalMs ?? 1000));
    this._sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this._request = options.request || ((request) => getRequestUrl()(request));
    this._getLanguage = options.getLanguage || (() => 'en');
    this._lastRequest = 0;        // rate limit: 1 req/s
    this._requestQueue = Promise.resolve();
    this._loadPersistentCache();
  }

  _normalizeLanguage(language) {
    return String(language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  _normalizeCoordinates(lat, lon) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
  }

  _key(lat, lon, language) {
    return `${lat.toFixed(5)},${lon.toFixed(5)}|${this._normalizeLanguage(language)}`;
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
    const ordered = [...this._cache.entries()]
      .sort((a, b) => Date.parse(b[1].cachedAt) - Date.parse(a[1].cachedAt));
    for (const [key] of ordered.slice(this._maxEntries)) {
      this._cache.delete(key);
      if (this._persistentCache) delete this._persistentCache[key];
      changed = true;
    }
    if (changed && notify) this._onChange?.();
    return changed;
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
    this._prune();
    const cached = this._cache.get(key);
    if (cached) return cached.name;
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
        if (this._persistentCache) this._persistentCache[key] = record;
        this._prune(this._now());
        this._onChange?.();
      }
      return result;
    } finally {
      this._pending.delete(key);
    }
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
        'accept-language': language,
      });
      const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
      const resp = await this._request({ url, headers: { 'User-Agent': 'ObsidianDayline/2.0' } });
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
    } catch (e) {
      // Silently fail — just show raw coordinates.
    }
    return null;
  }

  invalidate() {
    this._cache.clear();
    this._pending.clear();
    if (this._persistentCache) {
      for (const key of Object.keys(this._persistentCache)) delete this._persistentCache[key];
      this._onChange?.();
    }
  }
}
