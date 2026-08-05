// @ts-nocheck
const { requestUrl } = require('obsidian');

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

function _parseExifData(exifBytes) {
  const dv = new DataView(exifBytes);
  let le = true; // little-endian default
  const r16 = (o) => dv.getUint16(o, le);
  const r32 = (o) => dv.getUint32(o, le);

  function _parseTiff(offset, depth) {
    if (depth > 2) return null;
    const bo = dv.getUint16(offset);
    if (bo === 0x4949) le = true;
    else if (bo === 0x4D4D) le = false;
    else return null;
    if (r16(offset + 2) !== 42) return null;
    const ifdOff = r32(offset + 4);
    if (ifdOff === 0) return null;
    return _readIfd(offset + ifdOff, offset, depth);
  }

  function _readIfd(ifdStart, tiffBase, depth) {
    const n = r16(ifdStart);
    if (n === 0 || n > 256) return null;
    const result = {};
    let gpsOff = null;
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const type = r16(eo + 2);
      const count = r32(eo + 4);
      const vo = eo + 8;
      if (tag === 0x8769) { // EXIF IFD
        const exifIfd = r32(vo);
        if (exifIfd > 0) {
          const d = _readIfd(tiffBase + exifIfd, tiffBase, depth + 1);
          if (d) Object.assign(result, d);
        }
        continue;
      }
      if (tag === 0x8825) { gpsOff = r32(vo); continue; } // GPS IFD
      const val = _readTag(eo, type, count, tiffBase);
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
    if (gpsOff !== null && gpsOff > 0) {
      const g = _readGps(tiffBase + gpsOff, tiffBase);
      if (g) Object.assign(result, g);
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function _readGps(ifdStart, tiffBase) {
    const n = r16(ifdStart);
    if (n === 0 || n > 64) return null;
    const r = {};
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const val = _readTag(eo, r16(eo + 2), r32(eo + 4), tiffBase);
      if (tag === 1) r.gpsLatRef = val;
      if (tag === 2) r.gpsLat = val;
      if (tag === 3) r.gpsLonRef = val;
      if (tag === 4) r.gpsLon = val;
    }
    if (r.gpsLat && Array.isArray(r.gpsLat) && r.gpsLat.length >= 3) {
      const lat = r.gpsLat[0] + r.gpsLat[1] / 60 + r.gpsLat[2] / 3600;
      r.gpsLatDecimal = r.gpsLatRef === 'S' ? -lat : lat;
    }
    if (r.gpsLon && Array.isArray(r.gpsLon) && r.gpsLon.length >= 3) {
      const lon = r.gpsLon[0] + r.gpsLon[1] / 60 + r.gpsLon[2] / 3600;
      r.gpsLonDecimal = r.gpsLonRef === 'W' ? -lon : lon;
    }
    return r;
  }

  function _readTag(entryOffset, type, count, tiffBase) {
    const dataOff = entryOffset + 8;
    const sizes = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };
    const sz = sizes[type] || 1;
    const total = count * sz;
    const vo = total <= 4 ? dataOff : (tiffBase + r32(dataOff));

    switch (type) {
      case 1: case 6: case 7:
        if (count === 1) return dv.getUint8(vo);
        const bytes = []; for (let i = 0; i < count; i++) bytes.push(dv.getUint8(vo + i));
        return bytes;
      case 2:
        let s = ''; for (let i = 0; i < count - 1; i++) s += String.fromCharCode(dv.getUint8(vo + i));
        return s.trim();
      case 3:
        if (count === 1) return r16(vo);
        const sa = []; for (let i = 0; i < count; i++) sa.push(r16(vo + i * 2));
        return sa;
      case 4:
        if (count === 1) return r32(vo);
        const la = []; for (let i = 0; i < count; i++) la.push(r32(vo + i * 4));
        return la;
      case 5: case 10:
        if (count === 1) { const n = r32(vo), d = r32(vo + 4); return d === 0 ? n : n / d; }
        const ra = [];
        for (let i = 0; i < count; i++) { const n = r32(vo + i * 8), d = r32(vo + i * 8 + 4); ra.push(d === 0 ? n : n / d); }
        return ra;
      case 9:
        if (count === 1) return dv.getInt32(vo, le);
        const sla = []; for (let i = 0; i < count; i++) sla.push(dv.getInt32(vo + i * 4, le));
        return sla;
      default: return dv.getUint8(vo);
    }
  }

  const result = _parseTiff(0, 0);
  return result;
}

/* ============================================================
   Format-specific EXIF extractors
   ============================================================ */

/** Extract EXIF from JPEG (APP1 marker). */
function parseJpegExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null;
  let offset = 2;
  while (offset < dv.byteLength - 1) {
    const marker = dv.getUint16(offset);
    if (marker === 0xFFE1) {
      if (dv.getUint32(offset + 4) === 0x45786966) { // "Exif"
        return _parseExifData(arrayBuffer.slice(offset + 10));
      }
    }
    if (marker < 0xFF00 || marker === 0xFFD8 || marker === 0xFFD9) break;
    const segLen = dv.getUint16(offset + 2);
    if (segLen < 2) break;
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
  while (offset < dv.byteLength - 8) {
    const len = dv.getUint32(offset); // chunk length (big-endian)
    const type = dv.getUint32(offset + 4); // chunk type (4 ASCII chars)
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
  while (offset < dv.byteLength - 8) {
    const fourCC = dv.getUint32(offset);
    const chunkSize = dv.getUint32(offset + 4, true); // little-endian!
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
  const max = dv.byteLength - 8;
  for (let i = 0; i < max; i++) {
    const bo = dv.getUint16(i);
    if ((bo === 0x4949 || bo === 0x4D4D) && dv.getUint16(i + 2, bo === 0x4949) === 42) {
      // Found TIFF header — extract from here
      const exifSlice = arrayBuffer.slice(i);
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
    if (cached !== undefined) return cached;

    const pending = this._pending.get(filePath);
    if (pending) return pending;

    const promise = this._load(file);
    this._pending.set(filePath, promise);
    try {
      const result = await promise;
      this._cache.set(filePath, result);
      return result;
    } finally {
      this._pending.delete(filePath);
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

export class HeicCache {
  constructor(app) {
    this.app = app;
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
    const key = `${file.path}:${file.stat?.mtime || 0}`;
    if (this._cache.has(key)) return this._cache.get(key);
    if (this._pending.has(key)) return this._pending.get(key);

    const promise = this._convert(file);
    this._pending.set(key, promise);
    try {
      const result = await promise;
      if (result) this._cache.set(key, result);
      return result;
    } finally {
      this._pending.delete(key);
    }
  }

  async _convert(file) {
    try {
      const buf = await this.app.vault.readBinary(file);
      const libheif = await this._getLibheif();

      const decoder = new libheif.HeifDecoder();
      const images = decoder.decode(new Uint8Array(buf));
      if (!images || !images.length) return null;
      const img = images[0];

      const origW = img.get_width();
      const origH = img.get_height();

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

export class ReverseGeocoder {
  constructor() {
    this._cache = new Map();      // "lat,lon" → place name string
    this._pending = new Map();    // "lat,lon" → Promise (in-flight dedup)
    this._lastRequest = 0;        // rate limit: 1 req/s
    this._requestQueue = Promise.resolve();
  }

  /**
   * Look up a human-readable place name for coordinates.
   * Returns null if the lookup fails or has no result.
   */
  async lookup(lat, lon) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (this._cache.has(key)) return this._cache.get(key);
    if (this._pending.has(key)) return this._pending.get(key);

    this._requestQueue = this._requestQueue
      .catch(() => {})
      .then(() => this._doLookup(lat, lon, key));
    const promise = this._requestQueue;
    this._pending.set(key, promise);
    try {
      const result = await promise;
      this._cache.set(key, result);
      return result;
    } finally {
      this._pending.delete(key);
    }
  }

  async _doLookup(lat, lon, key) {
    // Respect Nominatim's 1 req/s rate limit
    const now = Date.now();
    const elapsed = now - this._lastRequest;
    if (elapsed < 1100) {
      await new Promise(r => setTimeout(r, 1100 - elapsed));
    }
    this._lastRequest = Date.now();

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&accept-language=zh`;
      const resp = await requestUrl({ url, headers: { 'User-Agent': 'ObsidianDayline/2.0' } });
      if (resp.status === 200 && resp.json) {
        const data = resp.json;
        // Use display_name: e.g. "广州市天河区..."
        // For cleaner output, prefer `address` sub-fields
        if (data.address) {
          const a = data.address;
          // Build a concise label: city + district + suburb
          const parts = [a.city || a.town || a.county, a.district || a.suburb, a.village].filter(Boolean);
          if (parts.length > 0) return parts.join(' · ');
          if (data.display_name) return data.display_name.split(',')[0];
        }
        if (data.display_name) return data.display_name.split(',')[0];
      }
    } catch (e) {
      // Silently fail — just show raw coordinates
    }
    return null;
  }

  invalidate() { this._cache.clear(); this._pending.clear(); }
}
