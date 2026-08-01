"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/date-utils.ts
var date_utils_exports = {};
__export(date_utils_exports, {
  formatDate: () => formatDate,
  formatDateInTimeZone: () => formatDateInTimeZone,
  imageBasename: () => imageBasename,
  isPathInFolder: () => isPathInFolder,
  matchesDatePrefixedImage: () => matchesDatePrefixedImage,
  monthKey: () => monthKey,
  normalizeVaultPath: () => normalizeVaultPath,
  parseDateFromFilename: () => parseDateFromFilename,
  parseDateString: () => parseDateString,
  parseDiaryDate: () => parseDiaryDate
});
function parseDiaryDate(filename) {
  const match = DATE_FILENAME.exec(filename);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day, date: `${match[1]}-${match[2]}-${match[3]}` };
}
function parseDateString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?=$|T|[ _])/.exec(trimmed);
  if (!match) return null;
  const date = parseDiaryDate(`${match[1]}-${match[2]}-${match[3]}.md`);
  return date?.date ?? null;
}
function parseDateFromFilename(filename) {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const stem = basename.replace(/\.md$/i, "");
  const match = DATE_PREFIX.exec(stem);
  if (!match) return null;
  return parseDiaryDate(`${match[1]}-${match[2]}-${match[3]}.md`)?.date ?? null;
}
function normalizeVaultPath(path) {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/{2,}/g, "/").replace(/\/$/, "");
}
function isPathInFolder(path, folder) {
  const normalizedPath = normalizeVaultPath(path);
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder.length === 0 || normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}
function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function formatDateInTimeZone(date, timezone = "auto") {
  if (timezone && timezone !== "auto") {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
    } catch (_) {
    }
  }
  return formatDate(date);
}
function monthKey(year, month) {
  return `${year}-${month}`;
}
function imageBasename(link) {
  return link.split(/[\\/]/).pop()?.split("|", 1)[0] ?? "";
}
function matchesDatePrefixedImage(link, date) {
  const basename = imageBasename(link);
  return basename === date || new RegExp(`^${date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[ _-])`).test(basename);
}
var DATE_FILENAME, DATE_PREFIX;
var init_date_utils = __esm({
  "src/date-utils.ts"() {
    "use strict";
    DATE_FILENAME = /^(\d{4})-(\d{2})-(\d{2})\.md$/;
    DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?=$|[ _-])/;
  }
});

// src/excerpt.ts
var excerpt_exports = {};
__export(excerpt_exports, {
  extractExcerpt: () => extractExcerpt,
  isGenericJournalTitle: () => isGenericJournalTitle,
  renderExcerptTemplate: () => renderExcerptTemplate
});
function stripFrontmatter(content) {
  return content.replace(FRONTMATTER, "");
}
function freewriteSection(content) {
  const match = /(?:^|\n)#{1,6}\s*[^\n]*\bfreewrite\b[^\n]*(?:\n|$)([\s\S]*?)(?=\n#{1,6}\s+|$)/i.exec(content);
  return match ? match[1] : content;
}
function cleanMarkdown(content) {
  let text = stripFrontmatter(content).replace(FENCED_BLOCK, " ");
  text = freewriteSection(text);
  text = text.replace(/<div[^>]*class=["'][^"']*(?:dataview|metadata|callout)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, " ").replace(/^\s*(?:dataviewjs?|dv\.|INPUT\[|VIEW\[|BUTTON\[).*$/gim, " ").replace(/^\s*[-*+]\s+\[[ xX]\].*$/gm, " ").replace(/^\s*(?:[-*_]\s*){3,}$/gm, " ").replace(/^\s*#{0,6}\s*[<❮].*\d{4}-\d{2}-\d{2}.*[>❯].*$/gm, " ").replace(/^\s*#{1,6}\s*.*\b\d{4}\s*\/\s*Q[1-4]\b.*$/gim, " ").replace(/^\s*#{1,6}\s*(?:dataview|meta\s*bind|tasks?|habits?|tips?|relevant\s+project)\b.*$/gim, " ").replace(/^\s*(?:#[-\w\\]+\s*){2,}$/gm, " ").replace(/^\s*#{1,6}\s*(?:daily note|journal entry|freewrite)\s*$/gim, " ").replace(/!\[\[[^\]]*\]\]/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || target).replace(/`[^`]*`/g, " ").replace(/^\s*#{1,6}\s+/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*>\s?/gm, "").replace(/<[^>]+>/g, " ").replace(/[*_~]+/g, "").replace(/^\s*https?:\/\/\S+\s*$/gm, " ");
  return text.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter((paragraph) => paragraph && !/^\d{4}-\d{2}-\d{2}$/.test(paragraph)).join(" ").trim();
}
function extractExcerpt(content, maxLength = 160) {
  const text = cleanMarkdown(content);
  if (!text) return null;
  return text.length > maxLength ? `${text.substring(0, maxLength).trimEnd()}...` : text;
}
function isGenericJournalTitle(title, date) {
  const normalized = title.trim().replace(/\s+/g, " ").toLowerCase();
  return GENERIC_TITLES.has(normalized) || Boolean(date && normalized === date.toLowerCase());
}
function renderExcerptTemplate(template, date, year, frontmatter, body) {
  let result = template.replace(/\{body\}/g, body || "").replace(/\{year\}/g, String(year)).replace(/\{date\}/g, date);
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\{${escapedKey}\\}`, "g"), String(value));
  }
  return result.trim() || null;
}
var FRONTMATTER, FENCED_BLOCK, GENERIC_TITLES;
var init_excerpt = __esm({
  "src/excerpt.ts"() {
    "use strict";
    FRONTMATTER = /^\s*---[\s\S]*?---\s*/;
    FENCED_BLOCK = /^\s*(```|~~~)[\s\S]*?^\s*\1\s*$/gm;
    GENERIC_TITLES = /* @__PURE__ */ new Set(["daily note", "daily", "journal entry", "entry", "untitled", "freewrite"]);
  }
});

// src/journal-index.ts
var journal_index_exports = {};
__export(journal_index_exports, {
  DEFAULT_JOURNAL_SOURCES: () => DEFAULT_JOURNAL_SOURCES,
  JournalIndex: () => JournalIndex,
  normalizeLocation: () => normalizeLocation,
  resolveJournalDate: () => resolveJournalDate
});
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function readField(frontmatter, field) {
  const wanted = field.toLowerCase();
  const key = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === wanted);
  return key ? frontmatter[key] : void 0;
}
function firstString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return void 0;
}
function parseConfiguredDate(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const date = parseConfiguredDate(item);
      if (date) return date;
    }
    return null;
  }
  return parseDateString(value);
}
function resolveJournalDate(fileName, frontmatter, configuredDateField) {
  if (configuredDateField) {
    const configuredValue = readField(frontmatter, configuredDateField);
    if (configuredValue !== void 0) {
      const configuredDate = parseConfiguredDate(configuredValue);
      return configuredDate ? { date: configuredDate } : { date: null, reason: "invalid-date" };
    }
  }
  for (const field of ["date", "creationDate"]) {
    const value = readField(frontmatter, field);
    const date = parseConfiguredDate(value);
    if (date) return { date };
    if (value !== void 0) return { date: null, reason: "invalid-date" };
  }
  const filenameDate = parseDateFromFilename(fileName);
  return filenameDate ? { date: filenameDate } : { date: null, reason: /^(\d{4})-(\d{2})-(\d{2})(?=$|[ _-])/i.test(fileName.replace(/\.md$/i, "")) ? "invalid-date" : "missing-date" };
}
function asBoolean(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return ["true", "1", "yes", "y"].includes(value.toLowerCase());
  return false;
}
function parseNumber(value) {
  const result = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(result) ? result : void 0;
}
function normalizeLocation(frontmatter) {
  const raw = readField(frontmatter, "location");
  const location = typeof raw === "string" ? { name: raw.trim() } : asRecord(raw);
  const coordinates = readField(frontmatter, "coordinates") ?? location.coordinates;
  let latitude = parseNumber(readField(frontmatter, "latitude") ?? location.latitude);
  let longitude = parseNumber(readField(frontmatter, "longitude") ?? location.longitude);
  if ((latitude === void 0 || longitude === void 0) && typeof coordinates === "string") {
    const values = coordinates.split(/[;,\s]+/).map((value) => parseNumber(value));
    if (values.length >= 2 && values[0] !== void 0 && values[1] !== void 0) {
      latitude = values[0];
      longitude = values[1];
    }
  }
  const name = firstString(location.name ?? raw);
  if (!name && latitude === void 0 && longitude === void 0) return void 0;
  return { name, latitude, longitude };
}
function titleFromContent(fileName, content, frontmatter) {
  const explicit = firstString(readField(frontmatter, "title"));
  if (explicit) return explicit;
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  return heading || fileName.replace(/\.md$/i, "");
}
function sourceForPath(path, sources) {
  return sources.find((source) => source.enabled !== false && isPathInFolder(path, source.path));
}
function moodFromFrontmatter(frontmatter) {
  const score = parseNumber(readField(frontmatter, "mood"));
  if (score !== -2 && score !== -1 && score !== 0 && score !== 1 && score !== 2) return void 0;
  const rawLabels = readField(frontmatter, "mood_labels");
  const labels = Array.isArray(rawLabels) ? rawLabels.map(String).map((value) => value.trim()).filter(Boolean) : typeof rawLabels === "string" ? rawLabels.split(",").map((value) => value.trim()).filter(Boolean) : [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return { score, labels, recordedAt: now, updatedAt: now };
}
function mediaLinks(value) {
  if (!Array.isArray(value)) return typeof value === "string" ? [value] : [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const record = asRecord(item);
    return [record.link, record.url, record.path].filter((candidate) => typeof candidate === "string");
  });
}
var DEFAULT_JOURNAL_SOURCES, JournalIndex;
var init_journal_index = __esm({
  "src/journal-index.ts"() {
    "use strict";
    init_date_utils();
    init_excerpt();
    DEFAULT_JOURNAL_SOURCES = [
      { id: "daily", path: "Calendar/Daily", type: "daily", label: "Daily notes" }
    ];
    JournalIndex = class {
      constructor(app, getMood = () => void 0) {
        __publicField(this, "app");
        __publicField(this, "getMood");
        __publicField(this, "entries", /* @__PURE__ */ new Map());
        __publicField(this, "diagnostics", []);
        __publicField(this, "listeners", /* @__PURE__ */ new Set());
        __publicField(this, "refreshToken", 0);
        __publicField(this, "refreshPromise", null);
        __publicField(this, "currentSources", []);
        this.app = app;
        this.getMood = getMood;
      }
      get sources() {
        return this.currentSources.slice();
      }
      getDiagnostics() {
        return this.diagnostics.slice();
      }
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      getEntries() {
        return Array.from(this.entries.values()).sort((a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));
      }
      filter(filter = {}) {
        const query = filter.query?.trim().toLowerCase();
        return this.getEntries().filter((entry) => {
          if (filter.from && entry.date < filter.from) return false;
          if (filter.to && entry.date > filter.to) return false;
          if (filter.sourceId && entry.sourceId !== filter.sourceId) return false;
          if (filter.moodScore !== void 0 && entry.mood?.score !== filter.moodScore) return false;
          if (filter.favoriteOnly && !entry.favorite) return false;
          if (query && !`${entry.title} ${entry.excerpt} ${entry.path} ${entry.searchText || ""}`.toLowerCase().includes(query)) return false;
          return true;
        });
      }
      async refresh(settings) {
        const token = ++this.refreshToken;
        if (this.refreshPromise) await this.refreshPromise;
        const promise = this.rebuild(settings, token);
        this.refreshPromise = promise;
        try {
          await promise;
        } finally {
          if (this.refreshPromise === promise) this.refreshPromise = null;
        }
      }
      async refreshFile(path, settings) {
        const normalizedPath = normalizeVaultPath(path);
        this.entries.delete(normalizedPath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (file) {
          const entry = await this.readEntry(file, this.resolveSources(settings));
          if (entry) this.entries.set(entry.path, entry);
        }
        this.emit();
      }
      removeFile(path) {
        this.entries.delete(normalizeVaultPath(path));
        this.emit();
      }
      renameFile(oldPath, newPath) {
        const oldKey = normalizeVaultPath(oldPath);
        const entry = this.entries.get(oldKey);
        this.entries.delete(oldKey);
        if (entry) this.entries.set(normalizeVaultPath(newPath), { ...entry, path: normalizeVaultPath(newPath) });
        this.emit();
      }
      async detectSources(settings) {
        const sources = this.resolveSources(settings);
        const files = this.app.vault.getMarkdownFiles?.() ?? [];
        const noDate = [];
        const fields = {};
        for (const file of files) {
          const source = sourceForPath(file.path, sources);
          if (!source) continue;
          const cache = this.app.metadataCache.getFileCache(file);
          const frontmatter = asRecord(cache?.frontmatter);
          const resolved = resolveJournalDate(file.name, frontmatter, source.dateField);
          if (!resolved.date) noDate.push(file.path);
          const used = resolved.date ? source.dateField && readField(frontmatter, source.dateField) !== void 0 ? source.dateField : readField(frontmatter, "date") !== void 0 ? "date" : readField(frontmatter, "creationDate") !== void 0 ? "creationDate" : "filename" : "unrecognized";
          fields[used] = (fields[used] ?? 0) + 1;
        }
        return { files: files.filter((file) => sourceForPath(file.path, sources)).length, noDate, fields };
      }
      resolveSources(settings) {
        const configured = Array.isArray(settings.journalSources) ? settings.journalSources : [];
        if (configured.length > 0) {
          return configured.map((source, index) => ({
            ...source,
            id: source.id || `source-${index + 1}`,
            path: normalizeVaultPath(source.path),
            type: String(source.type) === "journal" ? "external" : source.type
          })).filter((source) => source.path.length > 0 && source.enabled !== false);
        }
        const dailyFolder = normalizeVaultPath(settings.dailyFolder || "Calendar/Daily");
        const result = DEFAULT_JOURNAL_SOURCES.map((source) => ({ ...source }));
        result[0].path = dailyFolder;
        return result;
      }
      async rebuild(settings, token) {
        const sources = this.resolveSources(settings);
        this.currentSources = sources;
        const next = /* @__PURE__ */ new Map();
        this.diagnostics.length = 0;
        const files = this.app.vault.getMarkdownFiles?.() ?? [];
        for (const file of files) {
          if (token !== this.refreshToken) return;
          const source = sourceForPath(file.path, sources);
          if (!source) continue;
          const entry = await this.readEntry(file, sources);
          if (entry) next.set(entry.path, entry);
        }
        if (token !== this.refreshToken) return;
        this.entries.clear();
        for (const [path, entry] of next) this.entries.set(path, entry);
        this.emit();
      }
      async readEntry(file, sources) {
        const path = normalizeVaultPath(file.path);
        const source = sourceForPath(path, sources);
        if (!source) return null;
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = asRecord(cache?.frontmatter);
        const resolved = resolveJournalDate(file.name, frontmatter, source.dateField);
        if (!resolved.date) {
          this.diagnostics.push({ path, reason: resolved.reason ?? "missing-date" });
          return null;
        }
        let content = "";
        try {
          content = await this.app.vault.cachedRead(file);
        } catch (error) {
          this.diagnostics.push({ path, reason: "read-failed", detail: String(error) });
        }
        const attachments = Array.isArray(cache?.embeds) ? cache.embeds.map((embed) => String(embed.link ?? "")).filter(Boolean) : [];
        attachments.push(...mediaLinks(readField(frontmatter, "media")));
        attachments.push(...mediaLinks(readField(frontmatter, "photos")));
        const favorite = asBoolean(readField(frontmatter, "favorite")) || asBoolean(readField(frontmatter, "starred")) || asBoolean(readField(frontmatter, "pinned"));
        const uuid = firstString(readField(frontmatter, "uuid"));
        const creationDate = firstString(readField(frontmatter, "creationDate"));
        const modifiedDate = firstString(readField(frontmatter, "modifiedDate"));
        const weather = asRecord(readField(frontmatter, "_calendar_weather"));
        const mood = this.getMood(path) ?? moodFromFrontmatter(frontmatter);
        return {
          path,
          date: resolved.date,
          title: titleFromContent(file.name, content, frontmatter),
          excerpt: extractExcerpt(content) ?? "",
          searchText: content,
          sourceId: source.id,
          sourcePath: source.path,
          sourceType: source.type,
          favorite,
          uuid,
          createdAt: creationDate,
          modifiedAt: modifiedDate ?? (file.stat?.mtime ? new Date(file.stat.mtime).toISOString() : void 0),
          location: normalizeLocation(frontmatter),
          attachments,
          activity: readField(frontmatter, "activity"),
          weather: Object.keys(weather).length > 0 ? weather : void 0,
          mood,
          frontmatter
        };
      }
      emit() {
        const entries = this.getEntries();
        for (const listener of this.listeners) listener(entries);
      }
    };
  }
});

// src/mood-store.ts
var mood_store_exports = {};
__export(mood_store_exports, {
  MoodStore: () => MoodStore
});
function safeVaultPath(path) {
  const normalized = normalizeVaultPath(path);
  return normalized.split("/").filter((part) => part && part !== "." && part !== "..").join("/") || DEFAULT_PATH;
}
function emptyMetadata() {
  return { schemaVersion: 1, entries: {}, orphans: {} };
}
function isScore(value) {
  return value === -2 || value === -1 || value === 0 || value === 1 || value === 2;
}
function validRecord(value) {
  if (!value || typeof value !== "object") return false;
  const record = value;
  return isScore(record.score) && Array.isArray(record.labels) && typeof record.recordedAt === "string" && typeof record.updatedAt === "string";
}
function normalizeMetadata(value) {
  const raw = value && typeof value === "object" ? value : {};
  const entries = {};
  const rawEntries = raw.entries && typeof raw.entries === "object" ? raw.entries : {};
  for (const [path, record] of Object.entries(rawEntries)) {
    if (validRecord(record)) entries[normalizeVaultPath(path)] = {
      score: record.score,
      labels: record.labels.map(String).filter(Boolean),
      recordedAt: record.recordedAt,
      updatedAt: record.updatedAt
    };
  }
  const orphans = {};
  const rawOrphans = raw.orphans && typeof raw.orphans === "object" ? raw.orphans : {};
  for (const [path, value2] of Object.entries(rawOrphans)) {
    const orphan = value2 && typeof value2 === "object" ? value2 : {};
    if (validRecord(orphan.record)) {
      orphans[path] = { record: orphan.record, orphanedAt: String(orphan.orphanedAt ?? (/* @__PURE__ */ new Date()).toISOString()) };
    }
  }
  return { schemaVersion: 1, entries, orphans };
}
function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}
var DEFAULT_PATH, MoodStore;
var init_mood_store = __esm({
  "src/mood-store.ts"() {
    "use strict";
    init_date_utils();
    DEFAULT_PATH = "Calendar/journal-metadata.json";
    MoodStore = class {
      constructor(app, settings = {}) {
        __publicField(this, "app");
        __publicField(this, "listeners", /* @__PURE__ */ new Set());
        __publicField(this, "data", emptyMetadata());
        __publicField(this, "path", DEFAULT_PATH);
        __publicField(this, "loaded", false);
        __publicField(this, "writeQueue", Promise.resolve());
        this.app = app;
        this.configure(settings);
      }
      configure(settings) {
        this.path = safeVaultPath(settings.moodMetadataPath || DEFAULT_PATH);
      }
      get metadataPath() {
        return this.path;
      }
      async load() {
        const adapter = this.adapter();
        try {
          if (!await adapter.exists(this.path)) {
            this.data = emptyMetadata();
            this.loaded = true;
            return;
          }
          this.data = normalizeMetadata(JSON.parse(await adapter.read(this.path)));
          this.loaded = true;
        } catch (error) {
          const restored = await this.readBackup();
          if (restored) {
            this.data = restored;
            this.loaded = true;
            return;
          }
          console.warn("[Dayline] Mood metadata could not be read:", error);
          this.data = emptyMetadata();
          this.loaded = true;
        }
      }
      get(path) {
        return this.data.entries[normalizeVaultPath(path)];
      }
      getAll() {
        return { ...this.data.entries };
      }
      getOrphans() {
        return { ...this.data.orphans ?? {} };
      }
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      async set(path, score, labels, settings = {}) {
        const normalizedPath = normalizeVaultPath(path);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const previous = this.data.entries[normalizedPath];
        const record = {
          score,
          labels: Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))),
          recordedAt: previous?.recordedAt ?? now,
          updatedAt: now
        };
        await this.mutate((data) => {
          data.entries[normalizedPath] = record;
          if (data.orphans) delete data.orphans[normalizedPath];
        });
        if (settings.mirrorMoodToFrontmatter) await this.mirrorToFrontmatter(normalizedPath, record);
        this.emit(normalizedPath, record);
        return record;
      }
      async rename(oldPath, newPath) {
        const oldKey = normalizeVaultPath(oldPath);
        const newKey = normalizeVaultPath(newPath);
        if (oldKey === newKey) return;
        const record = this.data.entries[oldKey];
        const orphan = this.data.orphans?.[oldKey];
        if (!record && !orphan) return;
        await this.mutate((data) => {
          if (data.entries[oldKey]) {
            data.entries[newKey] = data.entries[oldKey];
            delete data.entries[oldKey];
          }
          if (data.orphans?.[oldKey]) {
            data.orphans[newKey] = data.orphans[oldKey];
            delete data.orphans[oldKey];
          }
        });
        this.emit(newKey, this.get(newKey));
      }
      async removeToOrphan(path) {
        const key = normalizeVaultPath(path);
        const record = this.data.entries[key];
        if (!record) return;
        await this.mutate((data) => {
          data.orphans ?? (data.orphans = {});
          data.orphans[key] = { record, orphanedAt: (/* @__PURE__ */ new Date()).toISOString() };
          delete data.entries[key];
        });
        this.emit(key, void 0);
      }
      async restoreOrphan(orphanKey, destinationPath = orphanKey) {
        const source = this.data.orphans?.[orphanKey];
        if (!source) return void 0;
        const destination = safeVaultPath(destinationPath);
        await this.mutate((data) => {
          data.entries[destination] = source.record;
          delete data.orphans?.[orphanKey];
        });
        this.emit(destination, source.record);
        return source.record;
      }
      async importFrontmatter(filePaths, metadataCache) {
        let imported = 0;
        await this.mutate((data) => {
          for (const rawPath of filePaths) {
            const path = normalizeVaultPath(rawPath);
            if (data.entries[path]) continue;
            const file = this.app.vault.getAbstractFileByPath(path);
            const frontmatter = metadataCache.getFileCache(file)?.frontmatter ?? {};
            const score = Number(frontmatter.mood);
            if (!isScore(score)) continue;
            const labels = Array.isArray(frontmatter.mood_labels) ? frontmatter.mood_labels.map(String) : typeof frontmatter.mood_labels === "string" ? frontmatter.mood_labels.split(",") : [];
            const now = (/* @__PURE__ */ new Date()).toISOString();
            data.entries[path] = { score, labels, recordedAt: now, updatedAt: now };
            imported++;
          }
        });
        for (const path of filePaths) if (this.data.entries[normalizeVaultPath(path)]) this.emit(normalizeVaultPath(path), this.get(path));
        return imported;
      }
      async exportTo(destinationPath = `${this.path}.export.json`) {
        const destination = normalizeVaultPath(destinationPath);
        await this.writeJson(destination, JSON.stringify(this.data, null, 2));
        return destination;
      }
      async restoreFrom(raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        const next = normalizeMetadata(parsed);
        await this.mutate(() => next);
        for (const path of Object.keys(next.entries)) this.emit(path, next.entries[path]);
      }
      async checkIntegrity() {
        const invalidRecords = [];
        const missingFiles = [];
        try {
          if (await this.adapter().exists(this.path)) {
            const raw = JSON.parse(await this.adapter().read(this.path));
            const rawEntries = raw?.entries && typeof raw.entries === "object" ? raw.entries : {};
            for (const [path, record] of Object.entries(rawEntries)) {
              if (!validRecord(record)) invalidRecords.push(path);
            }
          }
        } catch (_) {
          invalidRecords.push(this.path);
        }
        for (const [path, record] of Object.entries(this.data.entries)) {
          if (!this.app.vault.getAbstractFileByPath(path)) missingFiles.push(path);
        }
        return { valid: invalidRecords.length === 0, invalidRecords, missingFiles };
      }
      async flush() {
        await this.writeQueue;
      }
      async mutate(mutator) {
        if (!this.loaded) await this.load();
        this.writeQueue = this.writeQueue.catch(() => void 0).then(async () => {
          const cloned = normalizeMetadata(JSON.parse(JSON.stringify(this.data)));
          const result = mutator(cloned);
          this.data = result && typeof result === "object" && "entries" in result ? result : cloned;
          await this.writeJsonAtomically(this.path, JSON.stringify(this.data, null, 2));
        });
        await this.writeQueue;
      }
      async mirrorToFrontmatter(path, record) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file || !this.app.fileManager?.processFrontMatter) return;
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter.mood = record.score;
          frontmatter.mood_labels = record.labels;
        });
      }
      async readBackup() {
        try {
          const backup = `${this.path}.bak`;
          if (await this.adapter().exists(backup)) return normalizeMetadata(JSON.parse(await this.adapter().read(backup)));
        } catch (_) {
          return void 0;
        }
        return void 0;
      }
      adapter() {
        return this.app.vault.adapter;
      }
      async writeJson(path, content) {
        await this.ensureParent(path);
        await this.adapter().write(path, content);
      }
      async writeJsonAtomically(path, content) {
        await this.ensureParent(path);
        const temp = `${path}.tmp`;
        const backup = `${path}.bak`;
        const adapter = this.adapter();
        await adapter.write(temp, content);
        try {
          if (await adapter.exists(path)) {
            if (await adapter.exists(backup)) await adapter.remove(backup);
            await adapter.rename(path, backup);
          }
          await adapter.rename(temp, path);
        } catch (error) {
          try {
            if (!await adapter.exists(path) && await adapter.exists(backup)) await adapter.rename(backup, path);
          } catch (_) {
          }
          throw error;
        }
      }
      async ensureParent(path) {
        const parent = parentPath(path);
        if (!parent) return;
        const adapter = this.adapter();
        if (!await adapter.exists(parent)) await adapter.mkdir(parent);
      }
      emit(path, record) {
        for (const listener of this.listeners) listener(path, record);
      }
    };
  }
});

// src/mood.ts
var mood_exports = {};
__export(mood_exports, {
  MOOD_LABELS: () => MOOD_LABELS,
  MOOD_LABEL_GROUPS: () => MOOD_LABEL_GROUPS,
  MOOD_LEVELS: () => MOOD_LEVELS,
  getMoodColor: () => getMoodColor,
  moodLabelsForScore: () => moodLabelsForScore,
  moveMoodScore: () => moveMoodScore
});
function moodLabelsForScore(score) {
  const ids = score === null ? MOOD_LABELS.map((label) => label.id) : MOOD_LABEL_GROUPS[score];
  return ids.map((id) => MOOD_LABELS.find((label) => label.id === id)).filter((label) => Boolean(label));
}
function moveMoodScore(score, direction) {
  const current = score === null ? 2 : score;
  const index = MOOD_LEVELS.findIndex((level) => level.score === current);
  return MOOD_LEVELS[Math.max(0, Math.min(MOOD_LEVELS.length - 1, index + direction))].score;
}
function getMoodColor(score) {
  return MOOD_LEVELS.find((level) => level.score === score)?.color ?? "var(--background-modifier-border)";
}
var MOOD_LEVELS, MOOD_LABELS, MOOD_LABEL_GROUPS;
var init_mood = __esm({
  "src/mood.ts"() {
    "use strict";
    MOOD_LEVELS = [
      { score: -2, labelKey: "veryLow", color: "#d84b76" },
      { score: -1, labelKey: "low", color: "#e68a3b" },
      { score: 0, labelKey: "neutral", color: "#d9bd4c" },
      { score: 1, labelKey: "good", color: "#56a86a" },
      { score: 2, labelKey: "veryGood", color: "#4b93d1" }
    ];
    MOOD_LABELS = [
      { id: "calm", label: "Calm" },
      { id: "grateful", label: "Grateful" },
      { id: "anxious", label: "Anxious" },
      { id: "tired", label: "Tired" },
      { id: "energized", label: "Energized" },
      { id: "hopeful", label: "Hopeful" },
      { id: "sad", label: "Sad" },
      { id: "focused", label: "Focused" },
      { id: "overwhelmed", label: "Overwhelmed" },
      { id: "lonely", label: "Lonely" },
      { id: "frustrated", label: "Frustrated" },
      { id: "thoughtful", label: "Thoughtful" },
      { id: "content", label: "Content" },
      { id: "joyful", label: "Joyful" },
      { id: "proud", label: "Proud" },
      { id: "inspired", label: "Inspired" }
    ];
    MOOD_LABEL_GROUPS = {
      [-2]: ["sad", "anxious", "overwhelmed", "lonely"],
      [-1]: ["tired", "frustrated", "anxious", "sad"],
      [0]: ["calm", "thoughtful", "content", "focused"],
      [1]: ["grateful", "hopeful", "energized", "focused"],
      [2]: ["joyful", "proud", "inspired", "grateful", "energized"]
    };
  }
});

// src/i18n.ts
var i18n_exports = {};
__export(i18n_exports, {
  feelingLabel: () => feelingLabel,
  formatJournalDate: () => formatJournalDate,
  getDisplayLanguage: () => getDisplayLanguage,
  moodLabel: () => moodLabel,
  moodLabelKey: () => moodLabelKey,
  t: () => t
});
function getDisplayLanguage(settings = {}) {
  return (settings.displayLanguage || settings.weatherLanguage) === "en" ? "en" : "zh";
}
function t(settings, key, values = {}) {
  let value = STRINGS[getDisplayLanguage(settings)][key] ?? STRINGS.en[key] ?? key;
  for (const [name, replacement] of Object.entries(values)) value = value.replace(`{${name}}`, String(replacement));
  return value;
}
function moodLabelKey(score) {
  return score === -2 ? "veryLow" : score === -1 ? "low" : score === 0 ? "neutral" : score === 1 ? "good" : "veryGood";
}
function moodLabel(settings, score) {
  return t(settings, moodLabelKey(score));
}
function feelingLabel(settings, id) {
  return t(settings, id);
}
function formatJournalDate(date, settings) {
  const value = /* @__PURE__ */ new Date(`${date}T12:00:00`);
  if (getDisplayLanguage(settings) === "en") {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", weekday: "short" }).format(value);
  }
  const parts = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).formatToParts(value);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const weekday = (parts.find((part) => part.type === "weekday")?.value ?? "").replace("\u5468", "");
  return `${month}\u6708${day}\u65E5 \u5468${weekday}`;
}
var STRINGS;
var init_i18n = __esm({
  "src/i18n.ts"() {
    "use strict";
    STRINGS = {
      zh: {
        timelineTitle: "\u65E5\u8BB0\u65F6\u95F4\u7EBF",
        searchJournal: "\u641C\u7D22\u65E5\u8BB0",
        openFilters: "\u6253\u5F00\u7B5B\u9009",
        closeFilters: "\u5173\u95ED\u7B5B\u9009",
        clearFilters: "\u6E05\u9664\u7B5B\u9009",
        fromDate: "\u5F00\u59CB\u65E5\u671F",
        toDate: "\u7ED3\u675F\u65E5\u671F",
        allMoods: "\u5168\u90E8\u5FC3\u60C5",
        favoritesOnly: "\u4EC5\u6536\u85CF",
        favorite: "\u6536\u85CF",
        media: "\u5F20\u56FE\u7247",
        noResults: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u65E5\u8BB0",
        currentStreak: "\u5F53\u524D\u8FDE\u7EED",
        longestStreak: "\u6700\u957F\u8FDE\u7EED",
        thisMonth: "\u672C\u6708\u5B8C\u6210",
        moodTrend: "\u8FD1\u4E03\u5929\u5FC3\u60C5",
        noMood: "\u6682\u65E0\u5FC3\u60C5\u8BB0\u5F55",
        recordMood: "\u8BB0\u5F55\u5F53\u524D\u65E5\u8BB0\u5FC3\u60C5",
        createDailyNote: "\u6253\u5F00\u6216\u521B\u5EFA\u4ECA\u65E5\u7B14\u8BB0",
        moodTitle: "\u8BB0\u5F55\u5FC3\u60C5",
        moodQuestion: "\u4ECA\u5929\u7684\u611F\u53D7\u5982\u4F55\uFF1F",
        chooseLevel: "\u9009\u62E9\u4E00\u4E2A\u5F3A\u5EA6",
        addFeelings: "\u6DFB\u52A0\u60C5\u7EEA\u6807\u7B7E",
        chooseFeelings: "\u9009\u62E9\u6240\u6709\u7B26\u5408\u7684\u6807\u7B7E",
        back: "\u8FD4\u56DE",
        save: "\u4FDD\u5B58",
        selected: "\u5DF2\u9009\u62E9",
        veryLow: "\u5F88\u4F4E",
        low: "\u8F83\u4F4E",
        neutral: "\u5E73\u7A33",
        good: "\u8F83\u597D",
        veryGood: "\u5F88\u597D",
        calm: "\u5E73\u9759",
        grateful: "\u611F\u6FC0",
        anxious: "\u7126\u8651",
        tired: "\u75B2\u60EB",
        energized: "\u7CBE\u529B\u5145\u6C9B",
        hopeful: "\u5145\u6EE1\u5E0C\u671B",
        sad: "\u96BE\u8FC7",
        focused: "\u4E13\u6CE8",
        overwhelmed: "\u4E0D\u582A\u91CD\u8D1F",
        lonely: "\u5B64\u72EC",
        frustrated: "\u6CAE\u4E27",
        thoughtful: "\u82E5\u6709\u6240\u601D",
        content: "\u6EE1\u8DB3",
        joyful: "\u559C\u60A6",
        proud: "\u81EA\u8C6A",
        inspired: "\u53D7\u5230\u9F13\u821E",
        moodDate: "\u8BB0\u5F55\u65E5\u671F",
        moodDateDesc: "\u53EF\u4EE5\u9009\u62E9\u4EFB\u610F\u65E5\u671F\uFF0C\u6DFB\u52A0\u6216\u4FEE\u6539\u90A3\u4E00\u5929\u7684\u5FC3\u60C5\u3002",
        moodSaved: "\u5FC3\u60C5\u5DF2\u4FDD\u5B58",
        metadataExported: "\u5FC3\u60C5\u5143\u6570\u636E\u5DF2\u5BFC\u51FA\u5230 {path}",
        metadataRestored: "\u5FC3\u60C5\u5143\u6570\u636E\u5907\u4EFD\u5DF2\u6062\u590D",
        metadataValid: "\u5FC3\u60C5\u5143\u6570\u636E\u5B8C\u6574",
        importedMoods: "\u5DF2\u5BFC\u5165 {count} \u6761\u5FC3\u60C5\u8BB0\u5F55",
        dailyReminder: "\u4ECA\u5929\u8FD8\u6CA1\u6709\u65E5\u8BB0\u8BB0\u5F55",
        language: "\u663E\u793A\u8BED\u8A00",
        languageDesc: "\u7EDF\u4E00\u63A7\u5236\u63D2\u4EF6\u754C\u9762\u3001\u63D0\u793A\u3001\u6807\u7B7E\u548C\u8F85\u52A9\u6587\u672C",
        chinese: "\u4E2D\u6587",
        english: "English",
        journalSources: "\u65E5\u8BB0\u6765\u6E90\u76EE\u5F55",
        journalSourcesDesc: "\u914D\u7F6E\u6BCF\u65E5\u7B14\u8BB0\u76EE\u5F55\u548C\u53EF\u9009\u5916\u90E8\u5BFC\u5165\u76EE\u5F55\u3002\u65E7\u7248\u72EC\u7ACB\u6761\u76EE\u6765\u6E90\u4E0D\u518D\u9ED8\u8BA4\u542F\u7528\u3002",
        moodMetadataPath: "\u5FC3\u60C5\u5143\u6570\u636E\u8DEF\u5F84",
        moodMetadataPathDesc: "vault \u5185 JSON \u8DEF\u5F84\uFF0CJSON \u662F\u5FC3\u60C5\u4E3B\u6570\u636E\u6E90\u3002",
        mirrorMood: "\u955C\u50CF\u5FC3\u60C5\u5230 frontmatter",
        mirrorMoodDesc: "\u5F00\u542F\u540E\u4FDD\u5B58\u5FC3\u60C5\u65F6\u624D\u5199\u5165 Markdown \u7684 mood \u548C mood_labels\u3002",
        reminder: "\u6BCF\u65E5\u63D0\u9192",
        reminderDesc: "\u4ECA\u5929\u6CA1\u6709\u65E5\u8BB0\u8BB0\u5F55\u65F6\u663E\u793A\u672C\u5730\u63D0\u9192\u3002",
        journalTools: "\u65E5\u8BB0\u5DE5\u5177",
        journalToolsDesc: "\u6253\u5F00\u65F6\u95F4\u7EBF\u6216\u68C0\u6D4B\u5916\u90E8\u5BFC\u5165\u76EE\u5F55\u3002",
        openTimeline: "\u6253\u5F00\u65F6\u95F4\u7EBF",
        detectImports: "\u68C0\u6D4B\u5BFC\u5165",
        weatherTimezone: "\u5929\u6C14\u65F6\u533A",
        weatherTimezoneDesc: "\u65E5\u8BB0\u65E5\u671F\u6BD4\u8F83\u548C Open-Meteo \u4F7F\u7528\u7684 IANA \u65F6\u533A\u3002auto \u4F7F\u7528\u7CFB\u7EDF\u65F6\u533A\u3002",
        calendarDisplay: "\u65E5\u5386\u663E\u793A",
        showCalendarMood: "\u663E\u793A\u65E5\u5386\u5FC3\u60C5\u6807\u8BB0",
        showCalendarMoodDesc: "\u5728\u65E5\u671F\u683C\u663E\u793A\u5FC3\u60C5\u989C\u8272\u6807\u8BB0\uFF1B\u5173\u95ED\u540E\u4E0D\u4F1A\u5220\u9664\u5FC3\u60C5\u8BB0\u5F55\u3002",
        showCalendarWeatherCard: "\u663E\u793A\u65E5\u5386\u5929\u6C14\u5361\u7247",
        showCalendarWeatherCardDesc: "\u663E\u793A\u6708\u5386\u9876\u90E8\u5929\u6C14\u5361\u7247\uFF1B\u5173\u95ED\u540E\u4E0D\u5F71\u54CD\u65E5\u671F\u683C\u5929\u6C14\u56FE\u6807\u3002",
        showCalendarWeatherBadge: "\u663E\u793A\u65E5\u671F\u5929\u6C14\u56FE\u6807",
        showCalendarWeatherBadgeDesc: "\u663E\u793A\u65E5\u671F\u683C\u53F3\u4E0A\u89D2\u5929\u6C14\u56FE\u6807\uFF1B\u5173\u95ED\u540E\u4E0D\u5F71\u54CD\u9876\u90E8\u5929\u6C14\u5361\u7247\u3002",
        openCalendar: "\u6253\u5F00 Dayline",
        refreshWeather: "\u5237\u65B0\u5F53\u524D\u65E5\u671F\u5929\u6C14",
        openOnThisDay: "\u6253\u5F00\u53BB\u5E74\u4ECA\u65E5",
        openTimelineCommand: "\u6253\u5F00\u65E5\u8BB0\u65F6\u95F4\u7EBF",
        newDailyCommand: "\u6253\u5F00\u6216\u521B\u5EFA\u4ECA\u65E5\u7B14\u8BB0",
        recordMoodCommand: "\u8BB0\u5F55\u5F53\u524D\u65E5\u8BB0\u5FC3\u60C5",
        exportMetadataCommand: "\u5BFC\u51FA\u5FC3\u60C5\u5143\u6570\u636E JSON",
        restoreMetadataCommand: "\u6062\u590D\u5FC3\u60C5\u5143\u6570\u636E\u5907\u4EFD",
        integrityCommand: "\u68C0\u67E5\u5FC3\u60C5\u5143\u6570\u636E\u5B8C\u6574\u6027",
        importFrontmatterCommand: "\u5BFC\u5165 frontmatter \u5FC3\u60C5\u5143\u6570\u636E",
        detectImportsCommand: "\u68C0\u6D4B\u65E5\u8BB0\u5BFC\u5165\u76EE\u5F55"
      },
      en: {
        timelineTitle: "Journal timeline",
        searchJournal: "Search journal",
        openFilters: "Open filters",
        closeFilters: "Close filters",
        clearFilters: "Clear filters",
        fromDate: "From date",
        toDate: "To date",
        allMoods: "All moods",
        favoritesOnly: "Favorites only",
        favorite: "Favorite",
        media: " media",
        noResults: "No journal entries match the filters",
        currentStreak: "Current streak",
        longestStreak: "Longest streak",
        thisMonth: "This month",
        moodTrend: "Mood, last 7 days",
        noMood: "No mood records",
        recordMood: "Record current journal mood",
        createDailyNote: "Open or create today's note",
        moodTitle: "Record mood",
        moodQuestion: "How did today feel?",
        chooseLevel: "Choose a level",
        addFeelings: "Add feelings",
        chooseFeelings: "Choose any that fit",
        back: "Back",
        save: "Save",
        selected: "Selected",
        veryLow: "Very low",
        low: "Low",
        neutral: "Steady",
        good: "Good",
        veryGood: "Very good",
        calm: "Calm",
        grateful: "Grateful",
        anxious: "Anxious",
        tired: "Tired",
        energized: "Energized",
        hopeful: "Hopeful",
        sad: "Sad",
        focused: "Focused",
        overwhelmed: "Overwhelmed",
        lonely: "Lonely",
        frustrated: "Frustrated",
        thoughtful: "Thoughtful",
        content: "Content",
        joyful: "Joyful",
        proud: "Proud",
        inspired: "Inspired",
        moodDate: "Mood date",
        moodDateDesc: "Choose any date to add or update its mood.",
        moodSaved: "Mood saved",
        metadataExported: "Mood metadata exported to {path}",
        metadataRestored: "Mood metadata backup restored",
        metadataValid: "Mood metadata is valid",
        importedMoods: "Imported {count} mood records",
        dailyReminder: "No note for today",
        language: "Display language",
        languageDesc: "Controls plugin views, notices, labels, and accessible text",
        chinese: "\u4E2D\u6587",
        english: "English",
        journalSources: "Journal source directories",
        journalSourcesDesc: "Configure the daily-notes directory and optional external import directories.",
        moodMetadataPath: "Mood metadata path",
        moodMetadataPathDesc: "Vault-relative JSON path. JSON is the primary mood store.",
        mirrorMood: "Mirror mood to frontmatter",
        mirrorMoodDesc: "When enabled, saving a mood writes mood and mood_labels to Markdown.",
        reminder: "Daily reminder",
        reminderDesc: "Show a local reminder when today has no note.",
        journalTools: "Journal tools",
        journalToolsDesc: "Open the timeline or inspect external import directories.",
        openTimeline: "Open timeline",
        detectImports: "Detect imports",
        weatherTimezone: "Weather timezone",
        weatherTimezoneDesc: "IANA timezone used for diary dates and Open-Meteo. auto uses the system timezone.",
        calendarDisplay: "Calendar display",
        showCalendarMood: "Show mood markers on calendar",
        showCalendarMoodDesc: "Show mood colors on date cells without deleting mood records when disabled.",
        showCalendarWeatherCard: "Show the calendar weather card",
        showCalendarWeatherCardDesc: "Show the weather card above the calendar; date-cell icons are unaffected.",
        showCalendarWeatherBadge: "Show date weather icons",
        showCalendarWeatherBadgeDesc: "Show weather icons in the top-right of date cells; the weather card is unaffected.",
        openCalendar: "Open Dayline",
        refreshWeather: "Refresh weather for active date",
        openOnThisDay: "Open On This Day",
        openTimelineCommand: "Open journal timeline",
        newDailyCommand: "Open or create today's note",
        recordMoodCommand: "Record current journal mood",
        exportMetadataCommand: "Export mood metadata JSON",
        restoreMetadataCommand: "Restore mood metadata backup",
        integrityCommand: "Check mood metadata integrity",
        importFrontmatterCommand: "Import frontmatter mood metadata",
        detectImportsCommand: "Detect journal import directories"
      }
    };
  }
});

// src/mood-picker-modal.ts
var mood_picker_modal_exports = {};
__export(mood_picker_modal_exports, {
  MoodPickerModal: () => MoodPickerModal
});
function extractDate(filePath) {
  const match = String(filePath || "").match(/(\d{4}-\d{2}-\d{2})(?:\.md)?$/);
  if (match) return match[1];
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
var Modal, Notice, MOOD_LEVELS2, moodLabelsForScore2, moveMoodScore2, feelingLabel2, moodLabel2, t2, MoodPickerModal;
var init_mood_picker_modal = __esm({
  "src/mood-picker-modal.ts"() {
    "use strict";
    ({ Modal, Notice } = require("obsidian"));
    ({ MOOD_LEVELS: MOOD_LEVELS2, moodLabelsForScore: moodLabelsForScore2, moveMoodScore: moveMoodScore2 } = (init_mood(), __toCommonJS(mood_exports)));
    ({ feelingLabel: feelingLabel2, moodLabel: moodLabel2, t: t2 } = (init_i18n(), __toCommonJS(i18n_exports)));
    MoodPickerModal = class extends Modal {
      constructor(app, options = {}) {
        super(app);
        this.filePath = options.filePath;
        this.settings = options.settings || {};
        this.initial = options.initial;
        this.onSave = options.onSave;
        this.onDateChange = options.onDateChange;
        this.allowDateSelection = options.allowDateSelection === true;
        this.date = options.date || extractDate(options.filePath);
        this.score = this.initial?.score ?? null;
        this.labels = new Set(this.initial?.labels ?? []);
      }
      onOpen() {
        this.modalEl.addClass("journal-mood-picker-modal");
        this.contentEl.empty();
        this.contentEl.addClass("journal-mood-picker");
        this.renderScale();
        this.keyHandler = (event) => this.handleKeydown(event);
        this.scope?.register([], "Escape", this.keyHandler);
        this.contentEl.addEventListener("keydown", this.keyHandler);
      }
      onClose() {
        this.contentEl.removeEventListener("keydown", this.keyHandler);
        this.contentEl.empty();
      }
      renderScale() {
        this.step = 1;
        this.contentEl.empty();
        this.contentEl.createEl("h3", { text: t2(this.settings, "moodTitle") });
        if (this.allowDateSelection) this.renderDateField();
        this.contentEl.createEl("p", { cls: "journal-mood-step", text: t2(this.settings, "moodQuestion") });
        const scale = this.contentEl.createDiv({ cls: "journal-mood-scale", attr: { role: "radiogroup", "aria-label": t2(this.settings, "moodQuestion") } });
        MOOD_LEVELS2.forEach((level, index) => {
          const button = scale.createEl("button", {
            cls: "journal-mood-level",
            attr: {
              type: "button",
              role: "radio",
              "aria-label": moodLabel2(this.settings, level.score),
              "aria-checked": String(this.score === level.score),
              tabindex: this.score === level.score || this.score === null && index === 2 ? "0" : "-1"
            }
          });
          button.style.setProperty("--journal-mood-color", level.color);
          button.createSpan({ cls: "journal-mood-dot", attr: { "aria-hidden": "true" } });
          button.createSpan({ cls: "journal-mood-level-label", text: moodLabel2(this.settings, level.score) });
          button.addEventListener("click", () => {
            this.selectScore(level.score);
            this.renderLabels();
          });
        });
        this.contentEl.createDiv({
          cls: "journal-mood-selected",
          text: this.score === null ? t2(this.settings, "chooseLevel") : `${t2(this.settings, "selected")}: ${moodLabel2(this.settings, this.score)}`
        });
      }
      renderDateField() {
        const field = this.contentEl.createDiv({ cls: "journal-mood-date-field" });
        const label = field.createEl("label", { text: t2(this.settings, "moodDate") });
        const input = field.createEl("input", {
          attr: {
            type: "date",
            value: this.date || "",
            "aria-label": t2(this.settings, "moodDate"),
            title: t2(this.settings, "moodDateDesc")
          }
        });
        label.htmlFor = input.id = `dayline-mood-date-${Date.now()}`;
        input.addEventListener("change", () => this.changeDate(input.value, input));
      }
      selectScore(score) {
        this.score = score;
        const available = new Set(moodLabelsForScore2(score).map((label) => label.id));
        this.labels = new Set(Array.from(this.labels).filter((id) => available.has(id)));
      }
      async changeDate(date, input) {
        if (!date || date === this.date) return;
        input.disabled = true;
        try {
          const result = await this.onDateChange?.(date);
          this.date = date;
          if (result) {
            this.filePath = result.filePath || this.filePath;
            this.initial = result.initial;
            this.score = this.initial?.score ?? null;
            this.labels = new Set(this.initial?.labels ?? []);
          }
          this.renderScale();
        } catch (error) {
          input.disabled = false;
          new Notice(`${t2(this.settings, "moodTitle")}: ${error.message || error}`);
        }
      }
      renderLabels() {
        this.step = 2;
        this.contentEl.empty();
        this.contentEl.createEl("h3", { text: t2(this.settings, "addFeelings") });
        if (this.allowDateSelection) this.renderDateField();
        this.contentEl.createEl("p", { cls: "journal-mood-step", text: t2(this.settings, "chooseFeelings") });
        const group = this.contentEl.createDiv({ cls: "journal-mood-labels", attr: { role: "group", "aria-label": t2(this.settings, "addFeelings") } });
        for (const item of moodLabelsForScore2(this.score)) {
          const button = group.createEl("button", {
            cls: "journal-mood-label",
            text: feelingLabel2(this.settings, item.id),
            attr: { type: "button", "aria-pressed": String(this.labels.has(item.id)) }
          });
          button.addEventListener("click", () => {
            if (this.labels.has(item.id)) this.labels.delete(item.id);
            else this.labels.add(item.id);
            button.setAttribute("aria-pressed", String(this.labels.has(item.id)));
          });
        }
        const actions = this.contentEl.createDiv({ cls: "journal-mood-actions" });
        const back = actions.createEl("button", { text: t2(this.settings, "back"), attr: { type: "button" } });
        back.addEventListener("click", () => this.renderScale());
        const save = actions.createEl("button", { text: t2(this.settings, "save"), cls: "mod-cta", attr: { type: "button" } });
        save.addEventListener("click", () => this.save());
        save.focus();
      }
      async save() {
        if (this.score === null) return;
        try {
          await this.onSave?.({ filePath: this.filePath, score: this.score, labels: Array.from(this.labels) });
          this.close();
        } catch (error) {
          new Notice(`${t2(this.settings, "moodTitle")}: ${error.message || error}`);
        }
      }
      handleKeydown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.close();
          return;
        }
        if (this.step !== 1) return;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          this.score = moveMoodScore2(this.score, 1);
          this.renderScale();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          this.score = moveMoodScore2(this.score, -1);
          this.renderScale();
        } else if (event.key === "Enter" && this.score !== null) {
          event.preventDefault();
          this.renderLabels();
        }
      }
    };
  }
});

// src/journal-stats.ts
var journal_stats_exports = {};
__export(journal_stats_exports, {
  calculateJournalStats: () => calculateJournalStats
});
function dateOnly(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function shiftDate(date, days) {
  const value = /* @__PURE__ */ new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return dateOnly(value);
}
function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function uniqueDates(entries) {
  return Array.from(new Set(entries.map((entry) => entry.date))).sort();
}
function calculateJournalStats(entries, today = /* @__PURE__ */ new Date()) {
  const dates = uniqueDates(entries);
  const dateSet = new Set(dates);
  let currentStreak = 0;
  let cursor = dateOnly(today);
  if (!dateSet.has(cursor)) cursor = shiftDate(cursor, -1);
  while (dateSet.has(cursor)) {
    currentStreak++;
    cursor = shiftDate(cursor, -1);
  }
  let longestStreak = 0;
  let run = 0;
  let previous;
  for (const date of dates) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = date;
  }
  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const todayString = dateOnly(today);
  const recordedThisMonth = dates.filter((date) => date.startsWith(monthPrefix) && date <= todayString).length;
  const monthCompletionRate = Math.round(recordedThisMonth / daysInMonth(today) * 100);
  const moodDistribution = {};
  const labelCounts = {};
  for (const entry of entries) {
    if (entry.mood) {
      const key = String(entry.mood.score);
      moodDistribution[key] = (moodDistribution[key] ?? 0) + 1;
      for (const label of entry.mood.labels) labelCounts[label] = (labelCounts[label] ?? 0) + 1;
    }
  }
  return {
    currentStreak,
    longestStreak,
    monthCompletionRate,
    moodDistribution,
    labelCounts,
    trend: entries.slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-14).map((entry) => ({ date: entry.date, score: entry.mood?.score }))
  };
}
var init_journal_stats = __esm({
  "src/journal-stats.ts"() {
    "use strict";
  }
});

// src/journal-timeline-view.ts
var journal_timeline_view_exports = {};
__export(journal_timeline_view_exports, {
  JOURNAL_TIMELINE_VIEW: () => JOURNAL_TIMELINE_VIEW,
  JournalTimelineView: () => JournalTimelineView
});
var ItemView, Notice2, TFile, setIcon, calculateJournalStats2, MOOD_LEVELS3, getMoodColor2, formatJournalDate2, getDisplayLanguage2, moodLabel3, t3, isGenericJournalTitle2, JOURNAL_TIMELINE_VIEW, JournalTimelineView;
var init_journal_timeline_view = __esm({
  "src/journal-timeline-view.ts"() {
    "use strict";
    ({ ItemView, Notice: Notice2, TFile, setIcon } = require("obsidian"));
    ({ calculateJournalStats: calculateJournalStats2 } = (init_journal_stats(), __toCommonJS(journal_stats_exports)));
    ({ MOOD_LEVELS: MOOD_LEVELS3, getMoodColor: getMoodColor2 } = (init_mood(), __toCommonJS(mood_exports)));
    ({ formatJournalDate: formatJournalDate2, getDisplayLanguage: getDisplayLanguage2, moodLabel: moodLabel3, t: t3 } = (init_i18n(), __toCommonJS(i18n_exports)));
    ({ isGenericJournalTitle: isGenericJournalTitle2 } = (init_excerpt(), __toCommonJS(excerpt_exports)));
    JOURNAL_TIMELINE_VIEW = "journal-timeline-view";
    JournalTimelineView = class extends ItemView {
      constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.index = plugin.journalIndex;
        this.filter = {};
        this.filterMenuOpen = false;
        this.renderToken = 0;
        this.thumbnailObserver = null;
        this.thumbnailVisibilityChecks = /* @__PURE__ */ new Map();
        this.thumbnailScrollTimer = null;
        this.thumbnailScrollHandler = () => {
          if (this.thumbnailScrollTimer) return;
          this.thumbnailScrollTimer = setTimeout(() => {
            this.thumbnailScrollTimer = null;
            for (const check of this.thumbnailVisibilityChecks.values()) check();
          }, 50);
        };
      }
      getViewType() {
        return JOURNAL_TIMELINE_VIEW;
      }
      getDisplayText() {
        return t3(this.plugin.settings, "timelineTitle");
      }
      getIcon() {
        return "list";
      }
      async onOpen() {
        this.contentEl.addEventListener("scroll", this.thumbnailScrollHandler, { passive: true });
        this.unsubscribe = this.index.subscribe(() => this.render());
        await this.index.refresh(this.plugin.settings);
        this.render();
      }
      onClose() {
        this.renderToken++;
        this.thumbnailObserver?.disconnect();
        this.thumbnailObserver = null;
        this.contentEl.removeEventListener("scroll", this.thumbnailScrollHandler);
        if (this.thumbnailScrollTimer) clearTimeout(this.thumbnailScrollTimer);
        this.thumbnailScrollTimer = null;
        this.thumbnailVisibilityChecks.clear();
        this.unsubscribe?.();
        this.unsubscribe = null;
      }
      render() {
        const root = this.contentEl;
        root.empty();
        root.addClass("journal-timeline-view");
        this.renderToken++;
        const header = root.createDiv({ cls: "journal-timeline-header" });
        const heading = header.createDiv({ cls: "journal-timeline-heading" });
        heading.createEl("h2", { text: t3(this.plugin.settings, "timelineTitle") });
        heading.createDiv({ cls: "journal-timeline-count", text: String(this.index.filter(this.filter).length) });
        const actions = header.createDiv({ cls: "journal-timeline-actions" });
        const moodButton = actions.createEl("button", {
          attr: { type: "button", "aria-label": t3(this.plugin.settings, "recordMood"), title: t3(this.plugin.settings, "recordMood") }
        });
        setIcon(moodButton, "heart-pulse");
        moodButton.addEventListener("click", () => this.plugin.recordCurrentMood());
        const newButton = actions.createEl("button", {
          attr: { type: "button", "aria-label": t3(this.plugin.settings, "createDailyNote"), title: t3(this.plugin.settings, "createDailyNote") }
        });
        setIcon(newButton, "file-plus-2");
        newButton.addEventListener("click", () => this.plugin.createDailyNoteForToday());
        this.renderFilters(root);
        this.renderStats(root);
        this.renderList(root.createDiv({ cls: "journal-timeline-list" }));
      }
      renderFilters(root) {
        const filters = root.createDiv({ cls: "journal-timeline-filter-area" });
        const row = filters.createDiv({ cls: "journal-timeline-filter-row" });
        const query = row.createEl("input", {
          attr: { type: "search", placeholder: t3(this.plugin.settings, "searchJournal"), "aria-label": t3(this.plugin.settings, "searchJournal") }
        });
        query.value = this.filter.query ?? "";
        query.addEventListener("input", () => {
          this.filter.query = query.value || void 0;
          this.updateResults();
        });
        const filterButton = row.createEl("button", {
          attr: {
            type: "button",
            "aria-label": this.filterMenuOpen ? t3(this.plugin.settings, "closeFilters") : t3(this.plugin.settings, "openFilters"),
            "aria-expanded": String(this.filterMenuOpen),
            title: this.filterMenuOpen ? t3(this.plugin.settings, "closeFilters") : t3(this.plugin.settings, "openFilters")
          }
        });
        setIcon(filterButton, "list-filter");
        filterButton.addEventListener("click", () => {
          this.filterMenuOpen = !this.filterMenuOpen;
          this.render();
        });
        const menu = filters.createDiv({ cls: "journal-timeline-filter-menu" });
        if (!this.filterMenuOpen) menu.addClass("is-hidden");
        const from = menu.createEl("input", { attr: { type: "date", "aria-label": t3(this.plugin.settings, "fromDate"), title: t3(this.plugin.settings, "fromDate") } });
        from.value = this.filter.from ?? "";
        from.addEventListener("change", () => {
          this.filter.from = from.value || void 0;
          this.updateResults();
        });
        const to = menu.createEl("input", { attr: { type: "date", "aria-label": t3(this.plugin.settings, "toDate"), title: t3(this.plugin.settings, "toDate") } });
        to.value = this.filter.to ?? "";
        to.addEventListener("change", () => {
          this.filter.to = to.value || void 0;
          this.updateResults();
        });
        const mood = menu.createEl("select", { attr: { "aria-label": t3(this.plugin.settings, "allMoods"), title: t3(this.plugin.settings, "allMoods") } });
        mood.createEl("option", { text: t3(this.plugin.settings, "allMoods"), attr: { value: "" } });
        for (const level of MOOD_LEVELS3) {
          const option = mood.createEl("option", { text: moodLabel3(this.plugin.settings, level.score), attr: { value: String(level.score) } });
          option.style.color = level.color;
        }
        mood.value = this.filter.moodScore === void 0 ? "" : String(this.filter.moodScore);
        mood.addEventListener("change", () => {
          this.filter.moodScore = mood.value === "" ? void 0 : Number(mood.value);
          this.updateResults();
        });
        const favorite = menu.createEl("label", { cls: "journal-timeline-favorite-filter" });
        const checkbox = favorite.createEl("input", { attr: { type: "checkbox" } });
        checkbox.checked = Boolean(this.filter.favoriteOnly);
        favorite.createSpan({ text: t3(this.plugin.settings, "favoritesOnly") });
        checkbox.addEventListener("change", () => {
          this.filter.favoriteOnly = checkbox.checked;
          this.updateResults();
        });
        const clear = menu.createEl("button", { attr: { type: "button", "aria-label": t3(this.plugin.settings, "clearFilters"), title: t3(this.plugin.settings, "clearFilters") } });
        setIcon(clear, "x");
        clear.addEventListener("click", () => {
          this.filter = {};
          this.updateResults();
          this.render();
        });
        this.renderFilterSummary(filters);
      }
      renderFilterSummary(root) {
        const active = [];
        if (this.filter.from) active.push({ key: "from", label: `${t3(this.plugin.settings, "fromDate")}: ${this.filter.from}` });
        if (this.filter.to) active.push({ key: "to", label: `${t3(this.plugin.settings, "toDate")}: ${this.filter.to}` });
        if (this.filter.moodScore !== void 0) active.push({ key: "moodScore", label: moodLabel3(this.plugin.settings, this.filter.moodScore) });
        if (this.filter.favoriteOnly) active.push({ key: "favoriteOnly", label: t3(this.plugin.settings, "favorite") });
        if (active.length === 0) return;
        const summary = root.createDiv({ cls: "journal-timeline-filter-summary" });
        for (const item of active) {
          const chip = summary.createEl("button", { cls: "journal-filter-chip", text: `${item.label} \xD7`, attr: { type: "button", "aria-label": `${t3(this.plugin.settings, "clearFilters")}: ${item.label}` } });
          chip.addEventListener("click", () => {
            delete this.filter[item.key];
            this.render();
          });
        }
      }
      renderStats(root) {
        const stats = calculateJournalStats2(this.index.getEntries());
        const section = root.createDiv({ cls: "journal-timeline-stats", attr: { "aria-label": t3(this.plugin.settings, "moodTrend") } });
        const values = [
          [t3(this.plugin.settings, "currentStreak"), `${stats.currentStreak}`],
          [t3(this.plugin.settings, "longestStreak"), `${stats.longestStreak}`],
          [t3(this.plugin.settings, "thisMonth"), `${stats.monthCompletionRate}%`]
        ];
        for (const [label, value] of values) {
          const item = section.createDiv({ cls: "journal-stat" });
          item.createDiv({ cls: "journal-stat-value", text: value });
          item.createDiv({ cls: "journal-stat-label", text: label });
        }
        const trend = section.createDiv({ cls: "journal-stat-trend" });
        trend.createDiv({ cls: "journal-stat-label", text: t3(this.plugin.settings, "moodTrend") });
        const grid = trend.createDiv({ cls: "journal-stat-trend-grid" });
        const recent = stats.trend.slice(-7);
        for (const item of recent) {
          const cell = grid.createDiv({ cls: "journal-stat-trend-cell" });
          cell.style.backgroundColor = getMoodColor2(item.score);
          cell.setAttribute("aria-label", `${item.date}: ${item.score === void 0 ? t3(this.plugin.settings, "noMood") : moodLabel3(this.plugin.settings, item.score)}`);
          cell.title = cell.getAttribute("aria-label");
        }
      }
      updateResults() {
        const count = this.contentEl.querySelector(".journal-timeline-count");
        const entries = this.index.filter(this.filter);
        if (count) count.setText(String(entries.length));
        const list = this.contentEl.querySelector(".journal-timeline-list");
        if (list) this.renderList(list, entries);
        const area = this.contentEl.querySelector(".journal-timeline-filter-area");
        if (area) {
          const oldSummary = area.querySelector(".journal-timeline-filter-summary");
          oldSummary?.remove();
          this.renderFilterSummary(area);
        }
      }
      renderList(list, entries = this.index.filter(this.filter)) {
        this.renderToken++;
        this.thumbnailObserver?.disconnect();
        this.thumbnailObserver = null;
        this.thumbnailVisibilityChecks.clear();
        list.empty();
        if (entries.length === 0) {
          list.createDiv({ cls: "journal-timeline-empty", text: t3(this.plugin.settings, "noResults") });
          return;
        }
        for (const entry of entries) this.renderEntry(list, entry, this.renderToken);
      }
      renderEntry(list, entry, token) {
        const imageLinks = entry.attachments.filter((link) => this.plugin.thumbnailService?.isImageLink(link));
        const scoreClass = entry.mood ? `mood-score-${entry.mood.score}` : "mood-score-none";
        const card = list.createEl("article", { cls: `journal-timeline-entry ${scoreClass}${imageLinks.length ? " has-thumbnail" : ""}` });
        card.tabIndex = 0;
        card.dataset.path = entry.path;
        const body = card.createDiv({ cls: "journal-timeline-entry-body" });
        const top = body.createDiv({ cls: "journal-timeline-entry-top" });
        top.createEl("h3", { cls: "journal-timeline-entry-date", text: formatJournalDate2(entry.date, this.plugin.settings) });
        top.createEl("time", { cls: "journal-timeline-entry-iso", text: entry.date, attr: { datetime: entry.date } });
        if (entry.favorite) top.createSpan({ cls: "journal-timeline-favorite", text: t3(this.plugin.settings, "favorite") });
        if (entry.title && !isGenericJournalTitle2(entry.title, entry.date)) body.createDiv({ cls: "journal-timeline-title", text: entry.title });
        if (entry.excerpt) body.createDiv({ cls: "journal-timeline-excerpt", text: entry.excerpt });
        const meta = body.createDiv({ cls: "journal-timeline-meta" });
        if (entry.location?.name) meta.createSpan({ text: entry.location.name });
        if (imageLinks.length > 0) meta.createSpan({ text: `${imageLinks.length}${t3(this.plugin.settings, "media")}` });
        let thumbnail;
        if (imageLinks.length > 0) {
          thumbnail = card.createDiv({ cls: "journal-timeline-thumbnail" });
          const image = thumbnail.createEl("img", { attr: { alt: entry.title || entry.date, loading: "lazy" } });
          if (imageLinks.length > 1) thumbnail.createSpan({ cls: "journal-timeline-thumbnail-count", text: `+${imageLinks.length - 1}` });
          this.observeThumbnail(card, thumbnail, image, entry, imageLinks, token);
        }
        const open = () => this.openEntry(entry.path);
        card.addEventListener("click", open);
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
          if (event.key.toLowerCase() === "m") {
            event.preventDefault();
            this.plugin.openMoodPicker(entry.path);
          }
        });
      }
      observeThumbnail(card, container, image, entry, links, token) {
        let started = false;
        const load = async () => {
          if (started) return;
          started = true;
          const result = await this.plugin.thumbnailService.loadFirst(links, entry.path);
          if (token !== this.renderToken || !container.isConnected || !card.isConnected) return;
          if (!result) {
            card.removeClass("has-thumbnail");
            container.remove();
            return;
          }
          image.src = result.url;
          container.addClass("is-loaded");
        };
        if (typeof IntersectionObserver === "undefined") {
          load();
          return;
        }
        this.thumbnailObserver ?? (this.thumbnailObserver = new IntersectionObserver((observations) => {
          for (const observation of observations) {
            if (!observation.isIntersecting) continue;
            this.thumbnailObserver.unobserve(observation.target);
            load();
          }
        }, { rootMargin: "160px" }));
        this.thumbnailObserver.observe(container);
        const checkVisible = () => {
          if (token !== this.renderToken || !container.isConnected) return;
          const rootRect = this.contentEl.getBoundingClientRect();
          const rect = container.getBoundingClientRect();
          if (rect.bottom >= rootRect.top - 160 && rect.top <= rootRect.bottom + 160) load();
        };
        this.thumbnailVisibilityChecks.set(container, checkVisible);
        setTimeout(checkVisible, 50);
      }
      async openEntry(path) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          new Notice2(`${t3(this.plugin.settings, "timelineTitle")}: ${path}`);
          return;
        }
        await this.app.workspace.getLeaf("split").openFile(file);
      }
    };
  }
});

// src/thumbnail-service.ts
var thumbnail_service_exports = {};
__export(thumbnail_service_exports, {
  HEIC_EXTENSIONS: () => HEIC_EXTENSIONS,
  IMAGE_EXTENSIONS: () => IMAGE_EXTENSIONS,
  ThumbnailService: () => ThumbnailService
});
var IMAGE_EXTENSIONS, HEIC_EXTENSIONS, ThumbnailService;
var init_thumbnail_service = __esm({
  "src/thumbnail-service.ts"() {
    "use strict";
    IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif"];
    HEIC_EXTENSIONS = ["heic", "heif"];
    ThumbnailService = class {
      constructor(app, heicCache) {
        __publicField(this, "app");
        __publicField(this, "heicCache");
        this.app = app;
        this.heicCache = heicCache;
      }
      isImageFile(file) {
        return Boolean(file?.extension && IMAGE_EXTENSIONS.includes(String(file.extension).toLowerCase()));
      }
      isImageLink(link) {
        const clean = String(link || "").split("|", 1)[0].split(/[\\/]/).pop() || "";
        return IMAGE_EXTENSIONS.includes(clean.split(".").pop()?.toLowerCase() || "");
      }
      resolve(link, sourcePath) {
        const file = this.app.metadataCache.getFirstLinkpathDest(String(link).split("|", 1)[0], sourcePath);
        return this.isImageFile(file) ? file : null;
      }
      async load(link, sourcePath, index = 0) {
        const file = this.resolve(link, sourcePath);
        if (!file) return null;
        try {
          const ext = String(file.extension).toLowerCase();
          const url = HEIC_EXTENSIONS.includes(ext) ? (await this.heicCache?.getThumbnail(file))?.dataUrl : this.app.vault.getResourcePath(file);
          return url ? { url, path: file.path, index } : null;
        } catch (_) {
          return null;
        }
      }
      async loadFirst(links, sourcePath) {
        for (let index = 0; index < links.length; index++) {
          const result = await this.load(links[index], sourcePath, index);
          if (result) return result;
        }
        return null;
      }
    };
  }
});

// src/calendar-display.ts
var calendar_display_exports = {};
__export(calendar_display_exports, {
  shouldShowCalendarMood: () => shouldShowCalendarMood,
  shouldShowCalendarWeather: () => shouldShowCalendarWeather,
  shouldShowCalendarWeatherBadge: () => shouldShowCalendarWeatherBadge,
  shouldShowCalendarWeatherCard: () => shouldShowCalendarWeatherCard
});
function shouldShowCalendarMood(settings = {}) {
  return settings.showCalendarMood !== false;
}
function shouldShowCalendarWeather(settings = {}) {
  return shouldShowCalendarWeatherCard(settings) || shouldShowCalendarWeatherBadge(settings);
}
function shouldShowCalendarWeatherCard(settings = {}) {
  return settings.showCalendarWeatherCard ?? settings.showCalendarWeather !== false;
}
function shouldShowCalendarWeatherBadge(settings = {}) {
  return settings.showCalendarWeatherBadge ?? settings.showCalendarWeather !== false;
}
var init_calendar_display = __esm({
  "src/calendar-display.ts"() {
    "use strict";
  }
});

// src/plugin.ts
var { Plugin, ItemView: ItemView2, TFolder, TFile: TFile2, Notice: Notice3, Modal: Modal2, PluginSettingTab, Setting, SuggestModal, requestUrl, setIcon: setIcon2 } = require("obsidian");
var { JournalIndex: JournalIndex2 } = (init_journal_index(), __toCommonJS(journal_index_exports));
var { MoodStore: MoodStore2 } = (init_mood_store(), __toCommonJS(mood_store_exports));
var { MoodPickerModal: MoodPickerModal2 } = (init_mood_picker_modal(), __toCommonJS(mood_picker_modal_exports));
var { JournalTimelineView: JournalTimelineView2, JOURNAL_TIMELINE_VIEW: JOURNAL_TIMELINE_VIEW2 } = (init_journal_timeline_view(), __toCommonJS(journal_timeline_view_exports));
var { formatDateInTimeZone: formatDateInTimeZone2 } = (init_date_utils(), __toCommonJS(date_utils_exports));
var { ThumbnailService: ThumbnailService2 } = (init_thumbnail_service(), __toCommonJS(thumbnail_service_exports));
var { getDisplayLanguage: getDisplayLanguage3, moodLabel: moodLabel4, t: t4 } = (init_i18n(), __toCommonJS(i18n_exports));
var { getMoodColor: getMoodColor3 } = (init_mood(), __toCommonJS(mood_exports));
var { shouldShowCalendarMood: shouldShowCalendarMood2, shouldShowCalendarWeatherCard: shouldShowCalendarWeatherCard2, shouldShowCalendarWeatherBadge: shouldShowCalendarWeatherBadge2 } = (init_calendar_display(), __toCommonJS(calendar_display_exports));
var VIEW_TYPE = "calendar-sidebar-view";
var OVERLAY_ATTR = "data-cal-weather-overlay";
var DEFAULT_SETTINGS = {
  dailyFolder: "Calendar/Daily",
  thumbnailFilter: "all",
  // 'all' | 'date-prefixed'
  // --- Weather settings ---
  weatherEnabled: false,
  weatherLatitude: "",
  weatherLongitude: "",
  weatherLocationName: "",
  weatherUnits: "metric",
  // 'metric' | 'imperial'
  weatherAutoFetch: true,
  // auto-fetch weather when opening a daily note
  weatherTtlHours: 2,
  // cache TTL in hours before re-fetch
  weatherTimezone: "auto",
  // Open-Meteo timezone mode
  weatherLanguage: "zh",
  // 'en' | 'zh' — display language for weather labels
  displayLanguage: "zh",
  // global plugin language; migrated from weatherLanguage
  showCalendarMood: true,
  showCalendarWeatherCard: true,
  showCalendarWeatherBadge: true,
  // Legacy combined weather visibility setting; retained for migration/downgrade compatibility.
  showCalendarWeather: true,
  // --- EXIF metadata ---
  showExif: true,
  // show EXIF metadata tooltip on image hover
  exifReverseGeocode: false,
  // never send GPS coordinates unless explicitly enabled
  // --- On This Day settings ---
  onThisDayDot: false,
  // show accent dots on cells with past-year entries
  onThisDayButton: true,
  // show sidebar button to open On This Day modal
  onThisDayExcerptMode: "auto",
  // 'auto' | 'frontmatter' | 'template' | 'none'
  onThisDayExcerptKey: "excerpt",
  // frontmatter key when mode is 'frontmatter'
  onThisDayExcerptTemplate: "{body}",
  // template when mode is 'template'
  // --- Journal index and mood metadata ---
  journalSources: [],
  moodMetadataPath: "Calendar/journal-metadata.json",
  mirrorMoodToFrontmatter: false,
  reminderEnabled: false,
  reminderHour: 21
};
var DaylinePlugin = class extends Plugin {
  async onload() {
    this._dataWriteQueue = Promise.resolve();
    this._weatherSaveTimer = null;
    this._weatherCleanupTimer = null;
    this._exifHoverToken = 0;
    this._otdRequestToken = 0;
    await this._migrateLegacyData();
    await this.loadSettings();
    this.moodStore = new MoodStore2(this.app, this.settings);
    await this.moodStore.load();
    this.journalIndex = new JournalIndex2(this.app, (path) => this.moodStore.get(path));
    await this.journalIndex.refresh(this.settings);
    this._reminderTimer = setInterval(() => this._maybeRemind(), 60 * 1e3);
    this._loadStyles();
    this.weatherService = new WeatherService(this);
    this.exifCache = new ImageMetadataCache(this.app);
    this.heicCache = new HeicCache(this.app);
    this.thumbnailService = new ThumbnailService2(this.app, this.heicCache);
    this.geocoder = new ReverseGeocoder();
    try {
      const path = require("path");
      const pluginDir = path.join(this.app.vault.adapter.basePath, ".obsidian", "plugins", "dayline");
      const libheifFactory = require(path.join(pluginDir, "libheif-bundle.js"));
      this._libheifFactory = libheifFactory;
    } catch (e) {
      console.warn("[Dayline] Failed to load libheif:", e.message);
      this._libheifFactory = null;
    }
    this._hostPositionMarkers = /* @__PURE__ */ new Set();
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.registerView(JOURNAL_TIMELINE_VIEW2, (leaf) => new JournalTimelineView2(leaf, this));
    this.addCommand({
      id: "open-calendar-sidebar",
      name: t4(this.settings, "openCalendar"),
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "refresh-weather",
      name: t4(this.settings, "refreshWeather"),
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) {
          leaf.view.refreshWeather().catch((err) => {
            console.warn("[Dayline] Refresh weather failed:", err.message);
          });
        }
      }
    });
    this.addCommand({
      id: "open-on-this-day",
      name: t4(this.settings, "openOnThisDay"),
      callback: () => {
        const today = /* @__PURE__ */ new Date();
        this.openOnThisDay(today.getMonth() + 1, today.getDate());
      }
    });
    this.addCommand({
      id: "open-journal-timeline",
      name: t4(this.settings, "openTimelineCommand"),
      callback: () => this.activateTimeline()
    });
    this.addCommand({
      id: "new-daily-note",
      name: t4(this.settings, "newDailyCommand"),
      callback: () => this.createDailyNoteForToday()
    });
    this.addCommand({
      id: "record-current-mood",
      name: t4(this.settings, "recordMoodCommand"),
      callback: () => this.recordCurrentMood()
    });
    this.addCommand({
      id: "export-journal-metadata",
      name: t4(this.settings, "exportMetadataCommand"),
      callback: async () => {
        const path = await this.moodStore.exportTo();
        new Notice3(t4(this.settings, "metadataExported", { path }));
      }
    });
    this.addCommand({
      id: "restore-journal-metadata-backup",
      name: t4(this.settings, "restoreMetadataCommand"),
      callback: async () => {
        try {
          const backupPath = `${this.moodStore.metadataPath}.bak`;
          const raw = await this.app.vault.adapter.read(backupPath);
          await this.moodStore.restoreFrom(raw);
          await this.journalIndex.refresh(this.settings);
          this.refreshJournalViews();
          new Notice3(t4(this.settings, "metadataRestored"));
        } catch (error) {
          new Notice3(`Could not restore journal metadata: ${error.message || error}`);
        }
      }
    });
    this.addCommand({
      id: "check-journal-metadata-integrity",
      name: t4(this.settings, "integrityCommand"),
      callback: async () => {
        const result = await this.moodStore.checkIntegrity();
        new Notice3(result.valid && result.missingFiles.length === 0 ? t4(this.settings, "metadataValid") : `Metadata check: ${result.invalidRecords.length} invalid, ${result.missingFiles.length} missing files`);
      }
    });
    this.addCommand({
      id: "import-frontmatter-mood-metadata",
      name: t4(this.settings, "importFrontmatterCommand"),
      callback: async () => {
        const count = await this.moodStore.importFrontmatter(
          this.journalIndex.getEntries().map((entry) => entry.path),
          this.app.metadataCache
        );
        await this.journalIndex.refresh(this.settings);
        this.refreshJournalViews();
        new Notice3(t4(this.settings, "importedMoods", { count }));
      }
    });
    this.addCommand({
      id: "detect-journal-import-directories",
      name: t4(this.settings, "detectImportsCommand"),
      callback: async () => {
        const result = await this.journalIndex.detectSources(this.settings);
        const fields = Object.entries(result.fields).map(([key, value]) => `${key}: ${value}`).join(", ");
        new Notice3(`${result.files} journal files; ${result.noDate.length} without date. ${fields}`);
      }
    });
    this.addSettingTab(new DaylineSettingsTab(this.app, this));
    this._exifTooltipEl = null;
    this._exifHoverTimer = null;
    this._ensureExifTooltip();
    this.app.workspace.onLayoutReady(() => {
      this.activateView();
      this._syncAllOverlays();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", () => this._syncAllOverlays())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this._syncAllOverlays())
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this._syncAllOverlays())
    );
    this.registerEvent(this.app.vault.on("create", (file) => this._handleJournalCreateOrModify(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this._handleJournalCreateOrModify(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this._handleJournalDelete(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this._handleJournalRename(file, oldPath)));
  }
  /** Remove all note overlays and clear state on unload. */
  async onunload() {
    clearTimeout(this._weatherSaveTimer);
    clearTimeout(this._weatherCleanupTimer);
    clearTimeout(this._exifHoverTimer);
    clearInterval(this._reminderTimer);
    this._exifHoverToken++;
    await this._flushWeatherCache();
    await this.moodStore?.flush();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JOURNAL_TIMELINE_VIEW2);
    this._removeAllOverlays();
    this._exifTooltipEl?.remove();
    this._exifTooltipEl = null;
    document.getElementById("dayline-styles")?.remove();
    document.getElementById("calendar-sidebar-styles")?.remove();
  }
  async _migrateLegacyData() {
    const adapter = this.app.vault?.adapter;
    if (!adapter?.exists || !adapter?.read || !adapter?.write) return;
    const legacyPath = ".obsidian/plugins/calendar-sidebar/data.json";
    const currentPath = ".obsidian/plugins/dayline/data.json";
    try {
      if (await adapter.exists(currentPath) || !await adapter.exists(legacyPath)) return;
      await adapter.write(currentPath, await adapter.read(legacyPath));
      console.info("[Dayline] Migrated Calendar Sidebar settings and weather cache.");
    } catch (error) {
      console.warn("[Dayline] Legacy data migration failed:", error);
    }
  }
  async activateTimeline() {
    const existing = this.app.workspace.getLeavesOfType(JOURNAL_TIMELINE_VIEW2);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: JOURNAL_TIMELINE_VIEW2, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  async createDailyNoteForToday() {
    const date = _formatDate(/* @__PURE__ */ new Date());
    const path = `${this.settings.dailyFolder}/${date}.md`;
    const file = await this.ensureJournalFile(path, "");
    await this.app.workspace.getLeaf("split").openFile(file);
    await this.journalIndex.refreshFile(path, this.settings);
  }
  async recordCurrentMood() {
    const activeFile = this.app.workspace.activeLeaf?.view?.file;
    const sources = this.journalIndex.resolveSources(this.settings);
    const activeIsJournal = activeFile?.extension === "md" && sources.some((source) => activeFile.path === source.path || activeFile.path.startsWith(`${source.path}/`));
    const path = activeIsJournal ? activeFile.path : `${this.settings.dailyFolder}/${_formatDate(/* @__PURE__ */ new Date())}.md`;
    this.openMoodPicker(path, { allowDateSelection: true, ensureFile: false });
  }
  async openMoodPicker(path, options = {}) {
    if (path && options.ensureFile !== false) await this.ensureJournalFile(path, "");
    const entry = this.journalIndex.getEntries().find((item) => item.path === path);
    new MoodPickerModal2(this.app, {
      filePath: path,
      initial: this.moodStore.get(path) || entry?.mood,
      settings: this.settings,
      allowDateSelection: options.allowDateSelection === true,
      onDateChange: async (date) => {
        const nextPath = `${this.settings.dailyFolder}/${date}.md`;
        const nextEntry = this.journalIndex.getEntries().find((item) => item.path === nextPath);
        return {
          filePath: nextPath,
          initial: this.moodStore.get(nextPath) || nextEntry?.mood
        };
      },
      onSave: async ({ filePath, score, labels }) => {
        const targetPath = filePath || path;
        await this.ensureJournalFile(targetPath, "");
        await this.moodStore.set(targetPath, score, labels, this.settings);
        await this.journalIndex.refreshFile(targetPath, this.settings);
        this.refreshJournalViews();
        new Notice3(`${t4(this.settings, "moodSaved")}: ${targetPath}`);
      }
    }).open();
  }
  refreshJournalViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(JOURNAL_TIMELINE_VIEW2)) leaf.view?.render?.();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view?.render?.();
  }
  _maybeRemind() {
    if (!this.settings.reminderEnabled) return;
    const now = /* @__PURE__ */ new Date();
    if (now.getHours() !== Number(this.settings.reminderHour ?? 21) || now.getMinutes() !== 0) return;
    const date = _formatDate(now);
    if (this.journalIndex.getEntries().some((entry) => entry.date === date)) return;
    new Notice3(t4(this.settings, "dailyReminder"));
  }
  async ensureFolder(path) {
    const normalized = String(path || "").replace(/\\/g, "/").replace(/\/$/, "");
    if (!normalized || this.app.vault.getAbstractFileByPath(normalized)) return;
    const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    if (parent) await this.ensureFolder(parent);
    try {
      await this.app.vault.createFolder(normalized);
    } catch (_) {
    }
  }
  async ensureJournalFile(path, content) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile2) return existing;
    await this.ensureFolder(path.slice(0, path.lastIndexOf("/")));
    return this.app.vault.create(path, content);
  }
  _handleJournalCreateOrModify(file) {
    if (!(file instanceof TFile2) || file.extension !== "md") return;
    this.journalIndex.refreshFile(file.path, this.settings).then(() => this.refreshJournalViews());
  }
  _handleJournalDelete(file) {
    if (!(file instanceof TFile2) || file.extension !== "md") return;
    this.moodStore.removeToOrphan(file.path).catch(() => {
    });
    this.journalIndex.removeFile(file.path);
    this.refreshJournalViews();
  }
  _handleJournalRename(file, oldPath) {
    if (!(file instanceof TFile2) || file.extension !== "md") return;
    this.moodStore.rename(oldPath, file.path).catch(() => {
    });
    this.journalIndex.renameFile(oldPath, file.path);
    this.journalIndex.refreshFile(file.path, this.settings).then(() => this.refreshJournalViews());
  }
  /** Remove all overlay elements from markdown view containers. */
  _removeAllOverlays() {
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
    this._overlayRefreshHandlers = null;
    for (const container of this._hostPositionMarkers || []) {
      if (container.style.position === "relative") {
        container.style.removeProperty("position");
      }
    }
    this._hostPositionMarkers?.clear();
  }
  /** Plugin-level overlay sync — delegates to each CalendarView instance, then cleans stale ones. */
  _syncAllOverlays() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && typeof view._syncNoteOverlays === "function") {
        view._syncNoteOverlays();
      }
    }
  }
  /* ----- On This Day ----- */
  openOnThisDay(month, day) {
    const calendarLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const provider = calendarLeaf?.view?._otdProvider;
    if (!provider) return;
    const token = ++this._otdRequestToken;
    provider.getEntries(month, day).then((entries) => {
      if (token !== this._otdRequestToken) return;
      new OnThisDayModal(this.app, this, provider, month, day, entries).open();
    }).catch((err) => {
      console.warn("[Dayline] On This Day load failed:", err.message);
    });
  }
  /* ----- Shared EXIF Tooltip (used by calendar view + note-image hover) ----- */
  _ensureExifTooltip() {
    if (this._exifTooltipEl) return;
    const tip = document.createElement("div");
    tip.className = "cal-exif-tooltip";
    document.body.appendChild(tip);
    this._exifTooltipEl = tip;
  }
  _showExifTooltip(anchorEl, fields, loading) {
    const tip = this._exifTooltipEl;
    if (!tip || !anchorEl?.isConnected) return;
    const lang = this.settings.weatherLanguage;
    tip.replaceChildren();
    const addText = (tag, className, value) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.textContent = String(value ?? "");
      return el;
    };
    if (loading) {
      tip.appendChild(addText("div", "cal-exif-tooltip-loading", _l(lang, "exif_loading")));
    } else if (!fields || fields.length === 0) {
      const empty = addText("div", "cal-exif-tooltip-empty", "");
      empty.appendChild(addText("div", "", _l(lang, "exif_noData")));
      empty.appendChild(addText("div", "cal-exif-tooltip-description", _l(lang, "exif_noDataDesc")));
      tip.appendChild(empty);
    } else {
      for (const f of fields) {
        const row = addText("div", "cal-exif-tooltip-row", "");
        row.appendChild(addText("span", "cal-exif-tooltip-label", _l(lang, f.key)));
        row.appendChild(addText("span", "cal-exif-tooltip-value", f.value));
        tip.appendChild(row);
      }
    }
    const rect = anchorEl.getBoundingClientRect();
    const tipW = tip.offsetWidth || 180;
    let left = rect.right + 6;
    if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 6;
    if (left < 4) left = 4;
    let top = rect.top;
    const tipH = tip.offsetHeight || 100;
    if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
    if (top < 4) top = 4;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
    tip.classList.add("is-visible");
  }
  _hideExifTooltip() {
    if (this._exifTooltipEl) this._exifTooltipEl.classList.remove("is-visible");
  }
  _beginExifHover() {
    clearTimeout(this._exifHoverTimer);
    this._hideExifTooltip();
    return ++this._exifHoverToken;
  }
  _isCurrentExifHover(token) {
    return token === this._exifHoverToken;
  }
  _endExifHover() {
    clearTimeout(this._exifHoverTimer);
    this._exifHoverToken++;
    this._hideExifTooltip();
  }
  async loadSettings() {
    const data = await this.loadData() || {};
    this.weatherCache = data.weatherCache || {};
    this._cleanupWeatherCache();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    const legacyWeatherVisible = data.showCalendarWeather !== false;
    if (data.showCalendarWeatherCard === void 0) this.settings.showCalendarWeatherCard = legacyWeatherVisible;
    if (data.showCalendarWeatherBadge === void 0) this.settings.showCalendarWeatherBadge = legacyWeatherVisible;
    this.settings.displayLanguage = getDisplayLanguage3({ displayLanguage: data.displayLanguage, weatherLanguage: data.weatherLanguage });
    this.settings.weatherLanguage = this.settings.displayLanguage;
    delete this.settings.weatherCache;
  }
  async saveSettings() {
    const settings = { ...this.settings };
    settings.weatherLanguage = settings.displayLanguage || settings.weatherLanguage || "zh";
    settings.showCalendarWeather = settings.showCalendarWeatherCard !== false || settings.showCalendarWeatherBadge !== false;
    this.moodStore?.configure(settings);
    await this._enqueueDataWrite((data) => {
      Object.assign(data, settings);
      data.weatherCache = this.weatherCache || {};
    });
  }
  /** Save weather cache without touching settings. Debounced to avoid excessive writes. */
  _saveWeatherCache() {
    if (this._weatherSaveTimer) clearTimeout(this._weatherSaveTimer);
    this._weatherSaveTimer = setTimeout(() => {
      this._weatherSaveTimer = null;
      this._flushWeatherCache().catch((err) => {
        console.warn("[Dayline] Weather cache save failed:", err.message);
      });
    }, 2e3);
  }
  _enqueueDataWrite(mutator) {
    this._dataWriteQueue = (this._dataWriteQueue || Promise.resolve()).catch(() => {
    }).then(async () => {
      const data = await this.loadData() || {};
      await mutator(data);
      await this.saveData(data);
    });
    return this._dataWriteQueue;
  }
  _flushWeatherCache() {
    if (this._weatherSaveTimer) {
      clearTimeout(this._weatherSaveTimer);
      this._weatherSaveTimer = null;
    }
    return this._enqueueDataWrite((data) => {
      data.weatherCache = this.weatherCache || {};
    });
  }
  /** Remove cache entries older than 90 days. */
  _cleanupWeatherCache() {
    if (!this.weatherCache) return;
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1e3;
    let removed = 0;
    for (const [key, entry] of Object.entries(this.weatherCache)) {
      if (entry && entry.fetchedAt) {
        const timestamp = new Date(entry.fetchedAt).getTime();
        if (!Number.isFinite(timestamp) || timestamp < cutoff) {
          delete this.weatherCache[key];
          removed++;
        }
      }
    }
    if (removed > 0) {
      clearTimeout(this._weatherCleanupTimer);
      this._weatherCleanupTimer = setTimeout(() => {
        this._weatherCleanupTimer = null;
        this._saveWeatherCache();
      }, 5e3);
    }
  }
  _loadStyles() {
    const styleId = "dayline-styles";
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
    }
    style.id = styleId;
    style.textContent = `
.cal-sidebar {
  padding: 8px 6px;
  user-select: none;
  overflow: hidden;
}
.cal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px 8px;
}
.cal-nav {
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-muted);
  line-height: 1;
}
.cal-nav:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.cal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-normal);
}
.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  padding: 2px 0 4px;
  gap: 2px;
}
.cal-weekday {
  padding: 2px 0;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal-day {
  position: relative;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  transition: box-shadow 0.15s ease;
}
.cal-day:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}
.cal-day:active {
  transform: scale(0.95);
}
.cal-day-empty {
  pointer-events: none;
  visibility: hidden;
}
.cal-no-image {
  background: var(--background-secondary-alt);
}
.cal-no-image .cal-day-num {
  color: var(--text-muted);
}
.cal-day-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: 0;
}
.cal-day-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1;
  pointer-events: none;
}
.cal-day-num {
  position: relative;
  z-index: 2;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  line-height: 1;
  pointer-events: none;
}
.cal-today {
  /* Full accent fill */
  background: var(--color-accent) !important;
}
.cal-today.cal-has-image .cal-day-overlay {
  background: rgba(0, 0, 0, 0.55);
}
.cal-today .cal-day-num {
  color: #fff;
}
.cal-today:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}
/* Active (currently viewed date) \u2014 accent border only, transparent bg */
.cal-active:not(.cal-today) {
  box-shadow: 0 0 0 2px var(--color-accent);
}
.cal-active:not(.cal-today):hover {
  box-shadow: 0 0 0 2px var(--color-accent), 0 0 0 4px var(--interactive-accent-hover);
}
/* When today is also the active date, today styling takes precedence */

/* --- EXIF tooltip --- */
.cal-exif-tooltip {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  max-width: 240px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  /* Frosted glass */
  background: rgba(30, 30, 30, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.9);
}
.cal-exif-tooltip.is-visible {
  opacity: 1;
}
.cal-exif-tooltip-row {
  display: flex;
  gap: 6px;
  white-space: nowrap;
}
.cal-exif-tooltip-label {
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
  min-width: 36px;
}
.cal-exif-tooltip-value {
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-exif-tooltip-loading {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
}
.cal-exif-tooltip-empty {
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  font-size: 11px;
}
.cal-exif-tooltip-description {
  font-size: 10px;
  margin-top: 2px;
}

/* --- Weather card --- */
.cal-weather-card {
  margin: 4px 2px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  min-height: 0;
}
.cal-weather-icon {
  width: 36px;
  height: 36px;
  object-fit: contain;
  flex-shrink: 0;
}
.cal-weather-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cal-weather-temp {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-normal);
  line-height: 1.2;
}
.cal-weather-detail {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
button.cal-weather-refresh {
  cursor: pointer;
  padding: 0;
  border: none;
  background: none !important;
  box-shadow: none !important;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s ease;
  opacity: 0.65;
}
button.cal-weather-refresh:hover {
  color: var(--text-normal);
  opacity: 1;
  background: none !important;
}
.cal-weather-setup {
  margin: 4px 2px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
  border: 1px dashed var(--background-modifier-border);
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}
.cal-weather-loading {
  opacity: 0.6;
}
.cal-weather-error {
  opacity: 0.7;
}
/* --- Weather badge on day cells --- */
.cal-weather-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  object-fit: contain;
  z-index: 3;
  pointer-events: none;
}

/* --- Daily note weather overlay (Day One style frosted-glass chip) --- */
.cal-note-overlay {
  position: absolute;
  top: 48px;
  right: 8px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 10px;
  /* Frosted glass \u2014 progressive enhancement with rgba fallback */
  background: rgba(40, 40, 45, 0.72);
  background: color-mix(in srgb, var(--background-secondary) 60%, transparent);
  backdrop-filter: blur(8px) saturate(130%);
  -webkit-backdrop-filter: blur(8px) saturate(130%);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border: 1px solid color-mix(in srgb, var(--background-modifier-border) 50%, transparent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: var(--text-normal);
  pointer-events: auto;
  max-width: 320px;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.cal-note-overlay.is-visible {
  opacity: 1;
  transform: translateY(0);
}
.cal-note-overlay .cal-overlay-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}
.cal-note-overlay .cal-overlay-info {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  overflow: hidden;
}
.cal-note-overlay .cal-overlay-temp {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal);
  line-height: 1.3;
}
.cal-note-overlay .cal-overlay-detail {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-note-overlay button.cal-overlay-refresh {
  cursor: pointer;
  padding: 0;
  border: none;
  background: none !important;
  box-shadow: none !important;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  opacity: 0.65;
}
.cal-note-overlay button.cal-overlay-refresh:hover {
  color: var(--text-normal);
  opacity: 1;
  background: none !important;
}
.cal-note-overlay .is-loading {
  opacity: 0.5;
}
.cal-note-overlay .spin {
  animation: cal-spin 1s linear infinite;
}
@keyframes cal-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .cal-note-overlay,
  .cal-note-overlay.is-visible {
    transition: none;
  }
  .cal-note-overlay .spin {
    animation-duration: 2s;
  }
}
/* --- On This Day --- */
.cal-otd-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.cal-otd-button:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.cal-otd-dot {
  position: absolute;
  bottom: 3px;
  right: 3px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-accent);
  opacity: 0.5;
  z-index: 3;
  pointer-events: none;
}
/* --- On This Day Modal (photo wall) --- */
.cal-otd-modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.cal-otd-panel {
  width: 560px;
  max-height: 85vh;
  background: var(--background-primary);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.theme-light .cal-otd-panel {
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0,0,0,0.06);
}
.theme-dark .cal-otd-panel {
  background: rgba(40,40,40,0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.1);
}
.cal-otd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}
.cal-otd-header-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-normal);
}
.cal-otd-close {
  cursor: pointer;
  font-size: 16px;
  color: var(--text-muted);
  width: 28px; height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background 0.15s;
}
.cal-otd-close:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.cal-otd-date-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cal-otd-date-input {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal);
  background: transparent;
  border: none;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  min-width: 110px;
  text-align: center;
  font-family: inherit;
  outline: none;
}
.cal-otd-date-input:hover {
  background: var(--background-modifier-hover);
}
.cal-otd-date-input::-webkit-calendar-picker-indicator {
  opacity: 0.5;
  cursor: pointer;
}
.cal-otd-date-input::-webkit-calendar-picker-indicator:hover {
  opacity: 1;
}
.cal-otd-empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 13px;
}
/* 2-column photo wall */
.cal-otd-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 0 16px 16px;
  overflow-y: auto;
}
.cal-otd-wall-card {
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.15s;
  background: var(--background-secondary-alt);
}
.cal-otd-wall-card:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}
.cal-otd-wall-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 8px 10px 4px;
}
.cal-otd-wall-photo {
  width: 100%;
  aspect-ratio: 1;
  background-size: cover;
  background-position: center top;
}
.cal-otd-wall-text {
  padding: 16px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 80px;
}
.cal-otd-wall-text-empty {
  font-style: italic;
  opacity: 0.5;
}
.cal-otd-wall-excerpt {
  padding: 6px 10px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (max-width: 480px) {
  .cal-otd-panel { width: 94vw; }
  .cal-otd-grid { grid-template-columns: 1fr; }
}
.cal-mood-button {
  position: absolute;
  left: 2px;
  bottom: 2px;
  z-index: 4;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cal-mood-empty { opacity: 0; }
.cal-day:hover .cal-mood-empty, .cal-mood-empty:focus-visible { opacity: 1; }
.cal-mood-empty .cal-mood-dot { width: 8px; height: 8px; border: 1px solid var(--text-faint); background: transparent; }
.cal-mood-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--journal-mood-color); }
.cal-mood-button:hover .cal-mood-dot { box-shadow: 0 0 0 2px color-mix(in srgb, var(--journal-mood-color) 35%, transparent); }
.cal-mood-button.mood-2 { --journal-mood-color: #4b93d1; }
.cal-mood-button.mood-1 { --journal-mood-color: #56a86a; }
.cal-mood-button.mood-0 { --journal-mood-color: #d9bd4c; }
.cal-mood-button.mood--1 { --journal-mood-color: #e68a3b; }
.cal-mood-button.mood--2 { --journal-mood-color: #d84b76; }
.journal-timeline-view { box-sizing: border-box; width: 100%; min-width: 0; padding: 14px; overflow-x: hidden; overflow-y: auto; }
.journal-timeline-header, .journal-timeline-entry-top, .journal-timeline-meta, .journal-timeline-actions, .journal-timeline-filter-row, .journal-timeline-filter-menu, .journal-mood-actions { display: flex; align-items: center; min-width: 0; }
.journal-timeline-header { justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.journal-timeline-heading { display: flex; align-items: baseline; gap: 7px; min-width: 0; overflow: hidden; }
.journal-timeline-heading h2 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; font-size: 18px; }
.journal-timeline-count { flex: 0 0 auto; color: var(--text-muted); font-size: 12px; }
.journal-timeline-actions { flex: 0 0 auto; gap: 4px; }
.journal-timeline-actions button, .journal-timeline-filter-row > button { width: 28px; height: 28px; padding: 5px; flex: 0 0 28px; }
.journal-timeline-filter-area, .journal-timeline-filter-row, .journal-timeline-filter-summary { width: 100%; min-width: 0; }
.journal-timeline-filter-row { gap: 6px; margin-bottom: 6px; }
.journal-timeline-filter-row input[type='search'] { flex: 1 1 auto; width: 1px; min-width: 0; }
.journal-timeline-filter-menu { flex-wrap: wrap; gap: 6px; padding: 7px; margin-bottom: 6px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); }
.journal-timeline-filter-menu.is-hidden { display: none; }
.journal-timeline-filter-menu input[type='date'], .journal-timeline-filter-menu select { flex: 1 1 100px; min-width: 0; max-width: 160px; }
.journal-timeline-favorite-filter { display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: var(--text-muted); font-size: 12px; }
.journal-timeline-filter-summary { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.journal-filter-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 7px; font-size: 11px; }
.journal-timeline-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; min-width: 0; margin-bottom: 12px; }
.journal-stat { min-width: 0; overflow: hidden; padding: 6px 0; border-bottom: 1px solid var(--background-modifier-border); }
.journal-stat-value { font-size: 15px; color: var(--text-normal); }
.journal-stat-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 11px; }
.journal-stat-trend { grid-column: 1 / -1; min-width: 0; }
.journal-stat-trend-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-top: 4px; }
.journal-stat-trend-cell { min-width: 0; height: 7px; border-radius: 3px; }
.journal-timeline-list { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; min-width: 0; gap: 8px; }
.journal-timeline-entry { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; gap: 10px; padding: 10px; border: 1px solid var(--background-modifier-border); border-left: 4px solid var(--background-modifier-border); border-radius: 7px; cursor: pointer; background: var(--background-primary); }
.journal-timeline-entry.has-thumbnail { grid-template-columns: minmax(0, 1fr) 88px; }
.journal-timeline-entry.mood-score-2 { border-left-color: #4b93d1; }
.journal-timeline-entry.mood-score-1 { border-left-color: #56a86a; }
.journal-timeline-entry.mood-score-0 { border-left-color: #d9bd4c; }
.journal-timeline-entry.mood-score--1 { border-left-color: #e68a3b; }
.journal-timeline-entry.mood-score--2 { border-left-color: #d84b76; }
.journal-timeline-entry:hover, .journal-timeline-entry:focus-visible { border-right-color: var(--interactive-accent); outline: none; }
.journal-timeline-entry-body { min-width: 0; overflow: hidden; }
.journal-timeline-entry-top { flex-wrap: wrap; gap: 4px 7px; min-width: 0; color: var(--text-muted); }
.journal-timeline-entry-date { flex: 0 1 auto; min-width: 0; max-width: 100%; margin: 0; overflow: hidden; color: var(--text-normal); font-size: 14px; font-weight: 600; }
.journal-timeline-entry-iso { display: none; }
.journal-timeline-favorite { flex: 0 0 auto; color: var(--text-accent); font-size: 11px; }
.journal-timeline-title { min-width: 0; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-normal); font-size: 13px; }
.journal-timeline-excerpt { min-width: 0; max-width: 100%; margin-top: 4px; overflow: hidden; overflow-wrap: anywhere; color: var(--text-muted); font-size: 12px; line-height: 1.45; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.journal-timeline-meta { flex-wrap: wrap; gap: 5px 10px; min-width: 0; margin-top: 6px; overflow-wrap: anywhere; color: var(--text-faint); font-size: 11px; }
.journal-timeline-thumbnail { position: relative; width: 88px; height: 88px; min-width: 88px; overflow: hidden; border-radius: 5px; background: var(--background-secondary); }
.journal-timeline-thumbnail img { display: block; width: 88px; height: 88px; object-fit: cover; opacity: 0; transition: opacity 0.15s ease; }
.journal-timeline-thumbnail.is-loaded img { opacity: 1; }
.journal-timeline-thumbnail-count { position: absolute; right: 4px; bottom: 4px; padding: 1px 4px; border-radius: 4px; background: rgba(0, 0, 0, 0.65); color: #fff; font-size: 10px; }
.journal-timeline-empty { min-width: 0; padding: 28px 8px; overflow-wrap: anywhere; color: var(--text-muted); text-align: center; }
.journal-mood-picker-modal .modal-content { min-width: 320px; }
.journal-mood-picker h3 { margin-bottom: 4px; }
.journal-mood-date-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 14px; color: var(--text-muted); font-size: 12px; }
.journal-mood-date-field input { min-width: 0; max-width: 150px; }
.journal-mood-step { color: var(--text-muted); margin: 0 0 16px; }
.journal-mood-scale { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; }
.journal-mood-level { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; min-height: 76px; gap: 6px; color: var(--journal-mood-color); border: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
.journal-mood-level:hover, .journal-mood-level:focus-visible, .journal-mood-level[aria-checked='true'] { border-color: var(--journal-mood-color); outline: none; }
.journal-mood-level[aria-checked='true'] { box-shadow: 0 0 0 2px color-mix(in srgb, var(--journal-mood-color) 35%, transparent); }
.journal-mood-level[aria-checked='true']::after { content: '\u2713'; position: absolute; top: 3px; right: 5px; font-size: 12px; }
.journal-mood-dot { display: block; width: 24px; height: 24px; flex: 0 0 24px; border-radius: 50%; background: var(--journal-mood-color); }
.journal-mood-level-label { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.journal-mood-selected { color: var(--text-muted); text-align: center; font-size: 12px; margin-top: 10px; }
.journal-mood-labels { display: flex; flex-wrap: wrap; gap: 7px; }
.journal-mood-label[aria-pressed='true'] { border-color: var(--interactive-accent); color: var(--text-accent); background: var(--background-modifier-hover); }
.journal-mood-actions { justify-content: space-between; gap: 8px; margin-top: 22px; }
@media (max-width: 420px) {
  .journal-timeline-view { padding: 10px; }
  .journal-timeline-entry.has-thumbnail { grid-template-columns: minmax(0, 1fr) 72px; }
  .journal-timeline-thumbnail, .journal-timeline-thumbnail img { width: 72px; height: 72px; min-width: 72px; }
}
@media (prefers-reduced-motion: reduce) {
  .journal-mood-picker *, .journal-timeline-entry { transition: none !important; animation: none !important; }
}
`;
    if (!style.parentElement) {
      document.head.appendChild(style);
    }
  }
  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      for (const duplicate of existing.slice(1)) {
        workspace.detachLeaf(duplicate);
      }
      workspace.revealLeaf(existing[0]);
      return;
    }
    let leaf = workspace.getLeftLeaf(true);
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
    }
    if (!leaf) {
      new Notice3("Dayline: could not create calendar leaf");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
    try {
      const ls = workspace.leftSplit;
      if (ls && ls.children && ls.containerEl) {
        let calContainer, feContainer;
        for (const child of ls.children) {
          if (!child.children) continue;
          for (const lf of child.children) {
            const vt = lf.view?.getViewType?.();
            if (vt === VIEW_TYPE) calContainer = child;
            if (vt === "file-explorer") feContainer = child;
          }
        }
        if (calContainer && feContainer) {
          const idx = ls.children.indexOf(calContainer);
          if (idx > 0) {
            ls.children.splice(idx, 1);
            ls.children.splice(0, 0, calContainer);
          }
          ls.containerEl.insertBefore(
            calContainer.containerEl,
            feContainer.containerEl
          );
        }
      }
    } catch (_) {
    }
  }
};
var WMO_CODES = [
  { code: 0, condition: "Clear sky", icon: "clear-day.svg" },
  { code: 1, condition: "Mainly clear", icon: "clear-day.svg" },
  { code: 2, condition: "Partly cloudy", icon: "partly-cloudy-day.svg" },
  { code: 3, condition: "Overcast", icon: "overcast.svg" },
  { code: 45, condition: "Foggy", icon: "fog.svg" },
  { code: 48, condition: "Depositing rime fog", icon: "fog.svg" },
  { code: 51, condition: "Light drizzle", icon: "drizzle.svg" },
  { code: 53, condition: "Moderate drizzle", icon: "drizzle.svg" },
  { code: 55, condition: "Dense drizzle", icon: "drizzle.svg" },
  { code: 61, condition: "Slight rain", icon: "rain.svg" },
  { code: 63, condition: "Moderate rain", icon: "rain.svg" },
  { code: 65, condition: "Heavy rain", icon: "rain.svg" },
  { code: 71, condition: "Slight snow fall", icon: "snow.svg" },
  { code: 73, condition: "Moderate snow fall", icon: "snow.svg" },
  { code: 75, condition: "Heavy snow fall", icon: "snow.svg" },
  { code: 77, condition: "Snow grains", icon: "snow.svg" },
  { code: 80, condition: "Slight rain showers", icon: "rain.svg" },
  { code: 81, condition: "Moderate rain showers", icon: "rain.svg" },
  { code: 82, condition: "Violent rain showers", icon: "rain.svg" },
  { code: 85, condition: "Slight snow showers", icon: "snow.svg" },
  { code: 86, condition: "Heavy snow showers", icon: "snow.svg" },
  { code: 95, condition: "Thunderstorm", icon: "thunderstorms.svg" },
  { code: 96, condition: "Thunderstorm w/ hail", icon: "thunderstorms.svg" },
  { code: 99, condition: "Thunderstorm w/ heavy hail", icon: "thunderstorms.svg" }
];
function _lookupWmo(code) {
  const entry = WMO_CODES.find((w) => w.code === code);
  return entry || { condition: `Weather code ${code}`, icon: "overcast.svg" };
}
function _validateCoords(lat, lng) {
  const n = parseFloat(lat);
  const g = parseFloat(lng);
  return typeof n === "number" && !isNaN(n) && n >= -90 && n <= 90 && typeof g === "number" && !isNaN(g) && g >= -180 && g <= 180;
}
function _weatherConfigKey(settings) {
  const lat = parseFloat(settings.weatherLatitude);
  const lng = parseFloat(settings.weatherLongitude);
  return JSON.stringify({
    latitude: Number.isFinite(lat) ? Number(lat.toFixed(6)) : null,
    longitude: Number.isFinite(lng) ? Number(lng.toFixed(6)) : null,
    units: settings.weatherUnits === "imperial" ? "imperial" : "metric",
    timezone: settings.weatherTimezone || "auto",
    apiVersion: "open-meteo-v1"
  });
}
function _snapshotMatchesWeatherConfig(snapshot, settings) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const expected = _weatherConfigKey(settings);
  if (snapshot.configKey === expected) {
    _normalizeSnapshotLocation(snapshot, settings);
    return true;
  }
  const lat = parseFloat(settings.weatherLatitude);
  const lng = parseFloat(settings.weatherLongitude);
  const snapshotLat = parseFloat(snapshot.latitude);
  const snapshotLng = parseFloat(snapshot.longitude);
  const sameLocation = Number.isFinite(snapshotLat) && Number.isFinite(snapshotLng) && Math.abs(snapshotLat - lat) < 1e-6 && Math.abs(snapshotLng - lng) < 1e-6;
  const sameUnits = snapshot.units === (settings.weatherUnits === "imperial" ? "imperial" : "metric");
  if (sameLocation && sameUnits) {
    snapshot.configKey = expected;
    _normalizeSnapshotLocation(snapshot, settings);
    return true;
  }
  return false;
}
function _normalizeSnapshotLocation(snapshot, settings) {
  const lat = parseFloat(settings.weatherLatitude);
  const lng = parseFloat(settings.weatherLongitude);
  snapshot.location = settings.weatherLocationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
}
var WeatherService = class {
  constructor(plugin) {
    this.plugin = plugin;
    this._inFlight = /* @__PURE__ */ new Map();
    this._memoryCache = /* @__PURE__ */ new Map();
  }
  /**
   * Get weather snapshot for a given date string (YYYY-MM-DD).
   * Reads existing frontmatter snapshot first; fetches only when missing/stale.
   * Returns cached snapshot or fetched data, never blocks caller.
   */
  async getSnapshot(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return null;
    const requestKey = `${dateStr}|${this._configKey()}`;
    if (this._inFlight.has(requestKey)) {
      return this._inFlight.get(requestKey);
    }
    const promise = this._fetchOrUseCached(dateStr).finally(() => {
      if (this._inFlight.get(requestKey) === promise) this._inFlight.delete(requestKey);
    });
    this._inFlight.set(requestKey, promise);
    return promise;
  }
  /** Check if we should fetch or use cached data.
   * Accepts either a frontmatter snapshot ({fetchedAt}) or a memory cache record ({snapshot, cachedAt}). */
  _shouldFetch(record, ttlHours) {
    if (record && typeof record === "object" && "cachedAt" in record) {
      if (!record.cachedAt) return true;
      const timestamp2 = new Date(record.cachedAt).getTime();
      if (!Number.isFinite(timestamp2)) return true;
      const ageMs2 = Date.now() - timestamp2;
      return ageMs2 > ttlHours * 60 * 60 * 1e3;
    }
    if (!record) return true;
    if (!record.fetchedAt) return true;
    const timestamp = new Date(record.fetchedAt).getTime();
    if (!Number.isFinite(timestamp)) return true;
    const ageMs = Date.now() - timestamp;
    return ageMs > ttlHours * 60 * 60 * 1e3;
  }
  _configKey() {
    return _weatherConfigKey(this.plugin.settings);
  }
  isSnapshotCompatible(snapshot) {
    return _snapshotMatchesWeatherConfig(snapshot, this.plugin.settings);
  }
  getCachedSnapshot(dateStr) {
    const entry = this.plugin.weatherCache?.[dateStr];
    if (entry && this.isSnapshotCompatible(entry)) return entry;
    const path = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
    const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile2) {
      const cache = this.plugin.app.metadataCache.getFileCache(existingFile);
      const snap = cache?.frontmatter?._calendar_weather;
      if (snap && this.isSnapshotCompatible(snap)) return snap;
    }
    return null;
  }
  /** Fetch from Open-Meteo or return cached snapshot from plugin data. */
  async _fetchOrUseCached(dateStr) {
    const s = this.plugin.settings;
    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits;
    const ttlHours = s.weatherTtlHours || 2;
    const locationName = s.weatherLocationName || "";
    const _normIcon = (entry) => {
      if (entry && typeof entry.icon === "string" && !entry.icon.endsWith(".svg") && entry.weatherCode != null) {
        const wmo = _lookupWmo(entry.weatherCode);
        entry.icon = wmo.icon;
      }
    };
    const cacheEntry = this.plugin.weatherCache?.[dateStr];
    if (cacheEntry && this.isSnapshotCompatible(cacheEntry) && cacheEntry.fetchedAt && !this._shouldFetch(cacheEntry, ttlHours)) {
      _normIcon(cacheEntry);
      return cacheEntry;
    }
    const path = `${s.dailyFolder}/${dateStr}.md`;
    const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile2) {
      const cache = this.plugin.app.metadataCache.getFileCache(existingFile);
      const snap = cache?.frontmatter?._calendar_weather;
      if (snap && typeof snap === "object" && this.isSnapshotCompatible(snap) && !this._shouldFetch(snap, ttlHours)) {
        _normIcon(snap);
        this.plugin.weatherCache = this.plugin.weatherCache || {};
        this.plugin.weatherCache[dateStr] = { ...snap };
        this.plugin._saveWeatherCache();
        return snap;
      }
    }
    const cachedRecord = this._memoryCache.get(dateStr);
    if (cachedRecord && cachedRecord.configKey === this._configKey() && !this._shouldFetch(cachedRecord, ttlHours)) {
      return cachedRecord.snapshot;
    }
    const weather = await this._fetchFromOpenMeteo(lat, lng, dateStr, units, locationName);
    if (!weather) {
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: (/* @__PURE__ */ new Date()).toISOString(), configKey: this._configKey() });
      return null;
    }
    await this._persistSnapshot(dateStr, weather);
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: (/* @__PURE__ */ new Date()).toISOString(), configKey: this._configKey() });
    return weather;
  }
  /** Call Open-Meteo API for current + forecast data. */
  async _fetchFromOpenMeteo(lat, lng, dateStr, units, locationName) {
    const isToday = dateStr === _formatDate(/* @__PURE__ */ new Date(), this.plugin.settings.weatherTimezone);
    const timezone = this.plugin.settings.weatherTimezone || "auto";
    const dailyParams = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      daily: "temperature_2m_max,temperature_2m_min,weathercode,relative_humidity_2m_max,apparent_temperature_max",
      timezone,
      start_date: dateStr,
      end_date: dateStr
    });
    if (units === "imperial") {
      dailyParams.set("temperature_unit", "fahrenheit");
      dailyParams.set("wind_speed_unit", "mph");
    } else {
      dailyParams.set("temperature_unit", "celsius");
      dailyParams.set("wind_speed_unit", "kmh");
    }
    let baseUrl, url;
    if (isToday) {
      const combinedParams = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lng),
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code",
        daily: "temperature_2m_max,temperature_2m_min,weathercode,relative_humidity_2m_max,apparent_temperature_max",
        timezone,
        start_date: dateStr,
        end_date: dateStr
      });
      if (units === "imperial") {
        combinedParams.set("temperature_unit", "fahrenheit");
        combinedParams.set("wind_speed_unit", "mph");
      } else {
        combinedParams.set("temperature_unit", "celsius");
        combinedParams.set("wind_speed_unit", "kmh");
      }
      baseUrl = "https://api.open-meteo.com/v1/forecast";
      url = `${baseUrl}?${combinedParams.toString()}`;
    } else {
      baseUrl = dateStr < _formatDate(/* @__PURE__ */ new Date(), this.plugin.settings.weatherTimezone) ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
      url = `${baseUrl}?${dailyParams.toString()}`;
    }
    let response;
    try {
      response = await requestUrl({ url, timeout: 1e4 });
    } catch (err) {
      console.warn("[Dayline] Weather fetch failed:", err.message);
      return null;
    }
    if (response.status !== 200 || !response.json) {
      console.warn("[Dayline] Weather API returned status", response.status);
      return null;
    }
    const json = response.json;
    if (isToday && json.current) {
      const cur = json.current;
      const code2 = typeof cur.weather_code === "number" ? cur.weather_code : null;
      if (code2 !== null) {
        const wmo2 = _lookupWmo(code2);
        const tempCur = typeof cur.temperature_2m === "number" ? Math.round(cur.temperature_2m) : null;
        const feelsCur = typeof cur.apparent_temperature === "number" ? Math.round(cur.apparent_temperature) : null;
        const humCur = typeof cur.relative_humidity_2m === "number" ? cur.relative_humidity_2m : null;
        let high = null, low = null, feelsLike2 = null, humidity2 = null;
        if (json.daily) {
          const dates2 = json.daily.time || [];
          const idx2 = dates2.indexOf(dateStr);
          if (idx2 >= 0) {
            high = typeof json.daily.temperature_2m_max?.[idx2] === "number" ? json.daily.temperature_2m_max[idx2] : null;
            low = typeof json.daily.temperature_2m_min?.[idx2] === "number" ? json.daily.temperature_2m_min[idx2] : null;
            feelsLike2 = typeof json.daily.apparent_temperature_max?.[idx2] === "number" ? json.daily.apparent_temperature_max[idx2] : null;
            humidity2 = typeof json.daily.relative_humidity_2m_max?.[idx2] === "number" ? json.daily.relative_humidity_2m_max[idx2] : null;
          }
        }
        return {
          fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
          date: dateStr,
          location: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
          latitude: lat,
          longitude: lng,
          temperature: tempCur,
          feelsLike: feelsCur,
          humidity: humCur,
          weatherCode: code2,
          condition: wmo2.condition,
          icon: wmo2.icon,
          high,
          low,
          temperatureLabel: "Now",
          units,
          configKey: this._configKey()
        };
      }
    }
    const dailyData = await this._dailyOnlyFetch(lat, lng, dateStr, dailyParams, units);
    if (!dailyData) return null;
    if (dailyData.status !== 200 || !dailyData.json) {
      console.warn("[Dayline] Daily weather fetch returned unexpected response");
      return null;
    }
    const dailyJson = dailyData.json;
    if (!dailyJson?.daily) {
      console.warn('[Dayline] Daily weather data missing "daily" field');
      return null;
    }
    const daily = dailyJson.daily;
    const dates = daily.time || [];
    const idx = dates.indexOf(dateStr);
    if (idx === -1) {
      console.warn(`[Dayline] Weather data unavailable for ${dateStr}`);
      return null;
    }
    const code = daily.weathercode?.[idx];
    const tempMax = daily.temperature_2m_max?.[idx];
    const tempMin = daily.temperature_2m_min?.[idx];
    const feelsLike = daily.apparent_temperature_max?.[idx];
    const humidity = daily.relative_humidity_2m_max?.[idx];
    if (typeof code !== "number") return null;
    const wmo = _lookupWmo(code);
    return {
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      date: dateStr,
      location: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
      latitude: lat,
      longitude: lng,
      temperature: typeof tempMax === "number" ? Math.round(tempMax) : null,
      feelsLike: typeof feelsLike === "number" ? Math.round(feelsLike) : null,
      humidity: typeof humidity === "number" ? humidity : null,
      weatherCode: code,
      condition: wmo.condition,
      icon: wmo.icon,
      high: typeof tempMax === "number" ? tempMax : null,
      low: typeof tempMin === "number" ? tempMin : null,
      temperatureLabel: "High",
      units,
      configKey: this._configKey()
    };
  }
  /** Fetch only daily data (for non-today dates or fallback). */
  async _dailyOnlyFetch(lat, lng, dateStr, params, units) {
    const baseUrl = (() => {
      return dateStr < _formatDate(/* @__PURE__ */ new Date(), this.plugin.settings.weatherTimezone) ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
    })();
    const url = `${baseUrl}?${params.toString()}`;
    try {
      return await requestUrl({ url, timeout: 8e3 });
    } catch (err) {
      console.warn("[Dayline] Daily weather fetch failed:", err.message);
      return null;
    }
  }
  /** Persist weather snapshot to plugin data (no more YAML pollution). */
  async _persistSnapshot(dateStr, weather) {
    if (weather?.configKey && weather.configKey !== this._configKey()) return;
    if (!this.plugin.weatherCache) this.plugin.weatherCache = {};
    this.plugin.weatherCache[dateStr] = { ...weather, configKey: this._configKey() };
    this.plugin._saveWeatherCache();
  }
  /** Force refresh weather for a specific date (bypasses TTL check). */
  async forceRefresh(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return null;
    for (const key of this._inFlight.keys()) {
      if (key.startsWith(`${dateStr}|`)) this._inFlight.delete(key);
    }
    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits;
    const locationName = s.weatherLocationName || "";
    const weather = await this._fetchFromOpenMeteo(lat, lng, dateStr, units, locationName);
    if (!weather) {
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: (/* @__PURE__ */ new Date()).toISOString(), configKey: this._configKey() });
      return null;
    }
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: (/* @__PURE__ */ new Date()).toISOString(), configKey: this._configKey() });
    this._persistSnapshot(dateStr, weather).catch((err) => {
      console.warn("[Dayline] Async weather persistence failed:", err.message);
    });
    return weather;
  }
  /** Check if a date has a valid cached snapshot (for badge display). */
  hasCachedSnapshot(dateStr) {
    if (!this.plugin.settings.weatherEnabled) return false;
    return !!this.getCachedSnapshot(dateStr);
  }
  /** Bulk-fetch weather for a list of dates with 2s delay between requests. */
  async bulkBackfill(dateStrs, onProgress) {
    let done = 0;
    const total = dateStrs.length;
    for (const dateStr of dateStrs) {
      const entry = this.plugin.weatherCache?.[dateStr];
      if (entry && this.isSnapshotCompatible(entry) && entry.fetchedAt && !this._shouldFetch(entry, this.plugin.settings.weatherTtlHours || 2)) {
        done++;
        onProgress?.(done, total, dateStr, true);
        continue;
      }
      try {
        await this.forceRefresh(dateStr);
      } catch (e) {
        console.warn("[Dayline] Backfill failed for", dateStr, e.message);
      }
      done++;
      onProgress?.(done, total, dateStr, false);
      if (done < total) await new Promise((r) => setTimeout(r, 2e3));
    }
    this.plugin._saveWeatherCache();
    return done;
  }
};
var LOCALE = {
  en: {
    now: "Now",
    high: "High",
    feels: "Feels",
    humidity: "Humidity",
    low: "Low",
    loading: "Loading...",
    unavailable: "Unavailable",
    checkSettings: "Check settings or try again",
    noData: "No weather data available",
    refresh: "Refresh weather",
    setupHint: "\u26A0\uFE0F  Set latitude & longitude in settings to enable weather",
    setupAria: "Weather requires configured coordinates.",
    weatherUpdated: (d) => `Weather updated for ${d}`,
    noDataFor: (d) => `No weather data available for ${d}`,
    refreshFailed: (e) => `Failed to refresh weather: ${e}`,
    // Settings tab
    s_dailyFolder: "Daily notes folder",
    s_dailyFolderDesc: "Path to your daily notes folder (relative to vault root). Notes should be named YYYY-MM-DD.md",
    s_thumbnailFilter: "Thumbnail filter",
    s_thumbnailFilterDesc: "Which embedded images to show as date thumbnails",
    s_thumbnailAll: "All embedded images",
    s_thumbnailDate: "Only date-prefixed (YYYY-MM-DD_*)",
    s_weather: "Weather",
    s_weatherEnable: "Enable weather",
    s_weatherEnableDesc: "Show weather info for dates in Dayline",
    s_latitude: "Latitude",
    s_latitudeDesc: "Your latitude (e.g. 39.9042 for Beijing)",
    s_longitude: "Longitude",
    s_longitudeDesc: "Your longitude (e.g. 116.4074 for Beijing)",
    s_locationName: "Location name",
    s_locationNameDesc: "Display name (optional, shown in tooltip)",
    s_tempUnits: "Temperature units",
    s_tempUnitsDesc: "Display temperature in Celsius or Fahrenheit",
    s_autoFetch: "Auto-fetch weather",
    s_autoFetchDesc: "Automatically fetch weather when opening a daily note",
    s_cacheTtl: "Cache TTL (hours)",
    s_cacheTtlDesc: "How long to keep cached weather before re-fetching",
    s_language: "Language / \u8BED\u8A00",
    s_languageDesc: "Display language for weather labels",
    s_browseFolders: "Browse folders",
    s_celsius: "Celsius (\xB0C)",
    s_fahrenheit: "Fahrenheit (\xB0F)",
    s_english: "English",
    s_chinese: "\u4E2D\u6587",
    // EXIF tooltip
    s_exif: "EXIF Metadata",
    s_exifEnable: "Show image EXIF metadata",
    s_exifEnableDesc: "Display camera settings and capture info when hovering over images",
    s_exifGeocode: "Resolve GPS locations",
    s_exifGeocodeDesc: "Send EXIF GPS coordinates to OpenStreetMap Nominatim to show place names",
    exif_loading: "Reading...",
    exif_noData: "No EXIF data",
    exif_noDataDesc: "This image does not contain camera metadata",
    exif_camera: "Camera",
    exif_lens: "Lens",
    exif_date: "Date",
    exif_aperture: "Aperture",
    exif_shutter: "Shutter",
    exif_iso: "ISO",
    exif_focal: "Focal Length",
    exif_gps: "GPS",
    exif_software: "Software",
    // On This Day
    otd_title: "On This Day",
    otd_button: (m, d) => `\u{1F4C5} ${m}/${d}`,
    otd_emptyYear: "No entry for this day",
    otd_noMemories: "No memories for this day yet",
    otd_yearsAgo: (n) => `${n} year${n > 1 ? "s" : ""} ago`,
    otd_emptyExcerpt: "(no text)",
    otd_close: "Close",
    otd_openNote: "Open note",
    otd_prev: "Previous year",
    otd_next: "Next year",
    s_otd: "On This Day",
    s_otdDot: "Show markers on calendar",
    s_otdDotDesc: "Display a small dot on dates with past-year entries",
    s_otdButton: "Show sidebar button",
    s_otdButtonDesc: "Display an On This Day button below the weather card",
    s_otdExcerptMode: "Excerpt mode",
    s_otdExcerptModeDesc: "How to generate text previews for past entries",
    s_otdExcerptAuto: "Auto-extract from note body",
    s_otdExcerptFrontmatter: "From frontmatter field",
    s_otdExcerptNone: "No excerpt",
    s_otdExcerptTemplate: "Custom template",
    s_otdExcerptTemplateDesc: "Use {body}, {year}, {date}, or any frontmatter key like {mood}",
    s_otdTemplate: "Template",
    s_otdTemplateDesc: "Template string for custom excerpt mode",
    s_otdExcerptKey: "Frontmatter field name",
    s_otdExcerptKeyDesc: "Which frontmatter key to read (only used in frontmatter mode)",
    // Weather backfill
    s_backfill: "Bulk backfill weather",
    s_backfillDesc: "Fetch historical weather for all past diary dates (may take several minutes)",
    s_backfillBtn: "Start backfill",
    s_backfillStarted: (n) => `Backfilling ${n} days...`,
    s_backfillProgress: (done, total) => `Backfill: ${done}/${total}`,
    s_backfillDone: (n) => `Backfill complete: ${n} days`,
    s_backfillAllDone: "All dates already have weather data"
  },
  zh: {
    now: "\u73B0\u5728",
    high: "\u6700\u9AD8",
    feels: "\u4F53\u611F",
    humidity: "\u6E7F\u5EA6",
    low: "\u6700\u4F4E",
    loading: "\u52A0\u8F7D\u4E2D...",
    unavailable: "\u4E0D\u53EF\u7528",
    checkSettings: "\u68C0\u67E5\u8BBE\u7F6E\u6216\u91CD\u8BD5",
    noData: "\u6682\u65E0\u5929\u6C14\u6570\u636E",
    refresh: "\u5237\u65B0\u5929\u6C14",
    setupHint: "\u26A0\uFE0F  \u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u7ECF\u7EAC\u5EA6\u4EE5\u542F\u7528\u5929\u6C14",
    setupAria: "\u5929\u6C14\u9700\u8981\u914D\u7F6E\u5750\u6807\u3002",
    weatherUpdated: (d) => `\u5DF2\u66F4\u65B0 ${d} \u7684\u5929\u6C14`,
    noDataFor: (d) => `${d} \u6682\u65E0\u5929\u6C14\u6570\u636E`,
    refreshFailed: (e) => `\u5237\u65B0\u5929\u6C14\u5931\u8D25\uFF1A${e}`,
    // Settings tab
    s_dailyFolder: "\u65E5\u8BB0\u6587\u4EF6\u5939",
    s_dailyFolderDesc: "\u65E5\u8BB0\u6587\u4EF6\u6240\u5728\u7684\u6587\u4EF6\u5939\u8DEF\u5F84\uFF08\u76F8\u5BF9\u4E8E vault \u6839\u76EE\u5F55\uFF09\uFF0C\u6587\u4EF6\u547D\u540D\u683C\u5F0F YYYY-MM-DD.md",
    s_thumbnailFilter: "\u7F29\u7565\u56FE\u7B5B\u9009",
    s_thumbnailFilterDesc: "\u9009\u62E9\u54EA\u4E9B\u5D4C\u5165\u56FE\u7247\u4F5C\u4E3A\u65E5\u671F\u7F29\u7565\u56FE",
    s_thumbnailAll: "\u6240\u6709\u5D4C\u5165\u56FE\u7247",
    s_thumbnailDate: "\u4EC5\u65E5\u671F\u524D\u7F00 (YYYY-MM-DD_*)",
    s_weather: "\u5929\u6C14",
    s_weatherEnable: "\u542F\u7528\u5929\u6C14",
    s_weatherEnableDesc: "\u5728\u65E5\u5386\u4FA7\u8FB9\u680F\u4E2D\u663E\u793A\u65E5\u671F\u5929\u6C14\u4FE1\u606F",
    s_latitude: "\u7EAC\u5EA6",
    s_latitudeDesc: "\u6240\u5728\u5730\u7EAC\u5EA6\uFF08\u5982 \u5317\u4EAC 39.9042\uFF09",
    s_longitude: "\u7ECF\u5EA6",
    s_longitudeDesc: "\u6240\u5728\u5730\u7ECF\u5EA6\uFF08\u5982 \u5317\u4EAC 116.4074\uFF09",
    s_locationName: "\u4F4D\u7F6E\u540D\u79F0",
    s_locationNameDesc: "\u663E\u793A\u540D\u79F0\uFF08\u53EF\u9009\uFF0C\u9F20\u6807\u60AC\u505C\u65F6\u663E\u793A\uFF09",
    s_tempUnits: "\u6E29\u5EA6\u5355\u4F4D",
    s_tempUnitsDesc: "\u9009\u62E9\u6444\u6C0F\u5EA6\u6216\u534E\u6C0F\u5EA6",
    s_autoFetch: "\u81EA\u52A8\u83B7\u53D6\u5929\u6C14",
    s_autoFetchDesc: "\u6253\u5F00\u65E5\u8BB0\u65F6\u81EA\u52A8\u83B7\u53D6\u5929\u6C14\u6570\u636E",
    s_cacheTtl: "\u7F13\u5B58\u65F6\u957F\uFF08\u5C0F\u65F6\uFF09",
    s_cacheTtlDesc: "\u5929\u6C14\u6570\u636E\u7F13\u5B58\u7684\u6709\u6548\u65F6\u957F\uFF0C\u8FC7\u671F\u540E\u91CD\u65B0\u83B7\u53D6",
    s_language: "\u8BED\u8A00 / Language",
    s_languageDesc: "\u5929\u6C14\u6807\u7B7E\u7684\u663E\u793A\u8BED\u8A00",
    s_browseFolders: "\u6D4F\u89C8\u6587\u4EF6\u5939",
    s_celsius: "\u6444\u6C0F (\xB0C)",
    s_fahrenheit: "\u534E\u6C0F (\xB0F)",
    s_english: "English",
    s_chinese: "\u4E2D\u6587",
    // EXIF tooltip
    s_exif: "EXIF \u4FE1\u606F",
    s_exifEnable: "\u663E\u793A\u56FE\u7247 EXIF \u4FE1\u606F",
    s_exifEnableDesc: "\u9F20\u6807\u60AC\u505C\u5728\u65E5\u5386\u56FE\u7247\u4E0A\u65F6\uFF0C\u663E\u793A\u76F8\u673A\u53C2\u6570\u548C\u62CD\u6444\u6570\u636E",
    s_exifGeocode: "\u89E3\u6790 GPS \u5730\u70B9",
    s_exifGeocodeDesc: "\u5C06 EXIF GPS \u5750\u6807\u53D1\u9001\u5230 OpenStreetMap Nominatim \u4EE5\u663E\u793A\u5730\u540D",
    exif_loading: "\u8BFB\u53D6\u4E2D...",
    exif_noData: "\u65E0 EXIF \u4FE1\u606F",
    exif_noDataDesc: "\u8FD9\u5F20\u56FE\u7247\u6CA1\u6709\u5305\u542B\u62CD\u6444\u5143\u6570\u636E",
    exif_camera: "\u76F8\u673A",
    exif_lens: "\u955C\u5934",
    exif_date: "\u62CD\u6444\u65F6\u95F4",
    exif_aperture: "\u5149\u5708",
    exif_shutter: "\u5FEB\u95E8",
    exif_iso: "ISO",
    exif_focal: "\u7126\u8DDD",
    exif_gps: "GPS",
    exif_software: "\u8F6F\u4EF6",
    // On This Day
    otd_title: "\u53BB\u5E74\u4ECA\u65E5",
    otd_button: (m, d) => `\u{1F4C5} ${m}\u6708${d}\u65E5`,
    otd_emptyYear: "\u8FD9\u4E00\u5929\u8FD8\u6CA1\u6709\u8BB0\u5F55",
    otd_noMemories: "\u8FD8\u6CA1\u6709\u5F80\u5E74\u7684\u4ECA\u5929",
    otd_yearsAgo: (n) => `${n}\u5E74\u524D`,
    otd_emptyExcerpt: "\uFF08\u65E0\u6587\u5B57\u5185\u5BB9\uFF09",
    otd_close: "\u5173\u95ED",
    otd_openNote: "\u6253\u5F00\u7B14\u8BB0",
    otd_prev: "\u4E0A\u4E00\u5E74",
    otd_next: "\u4E0B\u4E00\u5E74",
    s_otd: "\u53BB\u5E74\u4ECA\u65E5",
    s_otdDot: "\u65E5\u5386\u4E0A\u663E\u793A\u6807\u8BB0",
    s_otdDotDesc: "\u5728\u6709\u5F80\u5E74\u8BB0\u5F55\u7684\u65E5\u671F\u683C\u5B50\u4E0A\u663E\u793A\u5C0F\u5706\u70B9\u6807\u8BB0",
    s_otdButton: "\u663E\u793A\u4FA7\u8FB9\u680F\u6309\u94AE",
    s_otdButtonDesc: "\u5728\u5929\u6C14\u5361\u7247\u4E0B\u65B9\u663E\u793A\u300C\u53BB\u5E74\u4ECA\u65E5\u300D\u6309\u94AE",
    s_otdExcerptMode: "\u6458\u8981\u6A21\u5F0F",
    s_otdExcerptModeDesc: "\u5982\u4F55\u751F\u6210\u5F80\u5E74\u65E5\u8BB0\u7684\u6587\u5B57\u9884\u89C8",
    s_otdExcerptAuto: "\u81EA\u52A8\u63D0\u53D6\u6B63\u6587",
    s_otdExcerptFrontmatter: "\u4ECE frontmatter \u5B57\u6BB5",
    s_otdExcerptNone: "\u4E0D\u663E\u793A\u6458\u8981",
    s_otdExcerptTemplate: "\u81EA\u5B9A\u4E49\u6A21\u677F",
    s_otdExcerptTemplateDesc: "\u4F7F\u7528 {body}\u3001{year}\u3001{date} \u6216\u4EFB\u610F frontmatter \u952E\u5982 {mood}",
    s_otdTemplate: "\u6A21\u677F",
    s_otdTemplateDesc: "\u81EA\u5B9A\u4E49\u6458\u8981\u7684\u6A21\u677F\u5B57\u7B26\u4E32",
    s_otdExcerptKey: "Frontmatter \u5B57\u6BB5\u540D",
    s_otdExcerptKeyDesc: "\u8BFB\u53D6\u54EA\u4E2A frontmatter \u952E\uFF08\u4EC5 frontmatter \u6A21\u5F0F\u4E0B\u4F7F\u7528\uFF09",
    // Weather backfill
    s_backfill: "\u56DE\u586B\u5386\u53F2\u5929\u6C14",
    s_backfillDesc: "\u4E3A\u6240\u6709\u5DF2\u6709\u65E5\u8BB0\u4F46\u7F3A\u5C11\u5929\u6C14\u6570\u636E\u7684\u65E5\u671F\u6279\u91CF\u62C9\u53D6\u5929\u6C14\uFF08\u7EA6\u9700\u6570\u5206\u949F\uFF09",
    s_backfillBtn: "\u5F00\u59CB\u56DE\u586B",
    s_backfillStarted: (n) => `\u5F00\u59CB\u56DE\u586B ${n} \u5929\u2026\u2026`,
    s_backfillProgress: (done, total) => `\u56DE\u586B\u4E2D: ${done}/${total}`,
    s_backfillDone: (n) => `\u56DE\u586B\u5B8C\u6210: ${n} \u5929`,
    s_backfillAllDone: "\u6240\u6709\u65E5\u671F\u5DF2\u6709\u5929\u6C14\u6570\u636E"
  }
};
function _l(lang, key, ...args) {
  const entry = LOCALE[lang]?.[key];
  return typeof entry === "function" ? entry(...args) : entry ?? key;
}
function _parseExifData(exifBytes) {
  const dv = new DataView(exifBytes);
  let le = true;
  const r16 = (o) => dv.getUint16(o, le);
  const r32 = (o) => dv.getUint32(o, le);
  function _parseTiff(offset, depth) {
    if (depth > 2) return null;
    const bo = dv.getUint16(offset);
    if (bo === 18761) le = true;
    else if (bo === 19789) le = false;
    else return null;
    if (r16(offset + 2) !== 42) return null;
    const ifdOff = r32(offset + 4);
    if (ifdOff === 0) return null;
    return _readIfd(offset + ifdOff, offset, depth);
  }
  function _readIfd(ifdStart, tiffBase, depth) {
    const n = r16(ifdStart);
    if (n === 0 || n > 256) return null;
    const result2 = {};
    let gpsOff = null;
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const type = r16(eo + 2);
      const count = r32(eo + 4);
      const vo = eo + 8;
      if (tag === 34665) {
        const exifIfd = r32(vo);
        if (exifIfd > 0) {
          const d = _readIfd(tiffBase + exifIfd, tiffBase, depth + 1);
          if (d) Object.assign(result2, d);
        }
        continue;
      }
      if (tag === 34853) {
        gpsOff = r32(vo);
        continue;
      }
      const val = _readTag(eo, type, count, tiffBase);
      switch (tag) {
        case 271:
          result2.make = val;
          break;
        case 272:
          result2.model = val;
          break;
        case 305:
          result2.software = val;
          break;
        case 36867:
          result2.dateTimeOriginal = val;
          break;
        case 33434:
          result2.exposureTime = val;
          break;
        case 33437:
          result2.fNumber = val;
          break;
        case 34855:
          result2.iso = val;
          break;
        case 37386:
          result2.focalLength = val;
          break;
        case 42036:
          result2.lensModel = val;
          break;
      }
    }
    if (gpsOff !== null && gpsOff > 0) {
      const g = _readGps(tiffBase + gpsOff, tiffBase);
      if (g) Object.assign(result2, g);
    }
    return Object.keys(result2).length > 0 ? result2 : null;
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
      r.gpsLatDecimal = r.gpsLatRef === "S" ? -lat : lat;
    }
    if (r.gpsLon && Array.isArray(r.gpsLon) && r.gpsLon.length >= 3) {
      const lon = r.gpsLon[0] + r.gpsLon[1] / 60 + r.gpsLon[2] / 3600;
      r.gpsLonDecimal = r.gpsLonRef === "W" ? -lon : lon;
    }
    return r;
  }
  function _readTag(entryOffset, type, count, tiffBase) {
    const dataOff = entryOffset + 8;
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    const sz = sizes[type] || 1;
    const total = count * sz;
    const vo = total <= 4 ? dataOff : tiffBase + r32(dataOff);
    switch (type) {
      case 1:
      case 6:
      case 7:
        if (count === 1) return dv.getUint8(vo);
        const bytes = [];
        for (let i = 0; i < count; i++) bytes.push(dv.getUint8(vo + i));
        return bytes;
      case 2:
        let s = "";
        for (let i = 0; i < count - 1; i++) s += String.fromCharCode(dv.getUint8(vo + i));
        return s.trim();
      case 3:
        if (count === 1) return r16(vo);
        const sa = [];
        for (let i = 0; i < count; i++) sa.push(r16(vo + i * 2));
        return sa;
      case 4:
        if (count === 1) return r32(vo);
        const la = [];
        for (let i = 0; i < count; i++) la.push(r32(vo + i * 4));
        return la;
      case 5:
      case 10:
        if (count === 1) {
          const n = r32(vo), d = r32(vo + 4);
          return d === 0 ? n : n / d;
        }
        const ra = [];
        for (let i = 0; i < count; i++) {
          const n = r32(vo + i * 8), d = r32(vo + i * 8 + 4);
          ra.push(d === 0 ? n : n / d);
        }
        return ra;
      case 9:
        if (count === 1) return dv.getInt32(vo, le);
        const sla = [];
        for (let i = 0; i < count; i++) sla.push(dv.getInt32(vo + i * 4, le));
        return sla;
      default:
        return dv.getUint8(vo);
    }
  }
  const result = _parseTiff(0, 0);
  return result;
}
function parseJpegExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 4 || dv.getUint16(0) !== 65496) return null;
  let offset = 2;
  while (offset < dv.byteLength - 1) {
    const marker = dv.getUint16(offset);
    if (marker === 65505) {
      if (dv.getUint32(offset + 4) === 1165519206) {
        return _parseExifData(arrayBuffer.slice(offset + 10));
      }
    }
    if (marker < 65280 || marker === 65496 || marker === 65497) break;
    const segLen = dv.getUint16(offset + 2);
    if (segLen < 2) break;
    offset += 2 + segLen;
  }
  return null;
}
function parsePngExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 8) return null;
  if (dv.getUint32(0) !== 2303741511 || dv.getUint32(4) !== 218765834) return null;
  let offset = 8;
  while (offset < dv.byteLength - 8) {
    const len = dv.getUint32(offset);
    const type = dv.getUint32(offset + 4);
    if (type === 1699305574) {
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + len));
    }
    if (type === 1229278788) break;
    offset += 12 + len;
  }
  return null;
}
function parseWebpExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 16) return null;
  if (dv.getUint32(0) !== 1380533830) return null;
  if (dv.getUint32(8) !== 1464156752) return null;
  let offset = 12;
  while (offset < dv.byteLength - 8) {
    const fourCC = dv.getUint32(offset);
    const chunkSize = dv.getUint32(offset + 4, true);
    if (fourCC === 1163413830) {
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + chunkSize));
    }
    if (fourCC === 1448097824) {
      break;
    }
    offset += 8 + chunkSize + chunkSize % 2;
  }
  return null;
}
function parseHeicExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const max = dv.byteLength - 8;
  for (let i = 0; i < max; i++) {
    const bo = dv.getUint16(i);
    if ((bo === 18761 || bo === 19789) && dv.getUint16(i + 2, bo === 18761) === 42) {
      const exifSlice = arrayBuffer.slice(i);
      return _parseExifData(exifSlice);
    }
  }
  return null;
}
function parseImageExif(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return null;
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint16(0);
  const magic4 = dv.getUint32(0);
  const brand4 = dv.getUint32(8);
  const isHeic = arrayBuffer.byteLength > 12 && dv.getUint32(4) === 1718909296 && // "ftyp"
  (brand4 === 1751476579 || brand4 === 1751476600 || brand4 === 1751479907 || // heic/heix/hevc
  brand4 === 1751476589 || brand4 === 1751476595 || brand4 === 1751479917 || // heim/heis/hevm
  brand4 === 1751479923 || brand4 === 1835623985 || brand4 === 1836279345);
  if (magic === 65496) return parseJpegExif(arrayBuffer);
  if (magic4 === 2303741511) return parsePngExif(arrayBuffer);
  if (magic4 === 1380533830) return parseWebpExif(arrayBuffer);
  if (isHeic) return parseHeicExif(arrayBuffer);
  return null;
}
function formatExifForDisplay(raw) {
  if (!raw) return null;
  const fields = [];
  if (raw.make || raw.model) {
    const make = raw.make || "";
    const model = raw.model || "";
    fields.push({ key: "exif_camera", value: (make + " " + model).trim() });
  }
  if (raw.lensModel) {
    fields.push({ key: "exif_lens", value: raw.lensModel });
  }
  if (raw.dateTimeOriginal) {
    let dt = raw.dateTimeOriginal;
    if (typeof dt === "string" && dt.includes(" ")) {
      dt = dt.replace(" ", "  ");
    }
    fields.push({ key: "exif_date", value: dt });
  }
  if (raw.fNumber !== void 0 && raw.fNumber !== null) {
    const f = typeof raw.fNumber === "number" ? raw.fNumber.toFixed(1) : String(raw.fNumber);
    fields.push({ key: "exif_aperture", value: "f/" + f });
  }
  if (raw.exposureTime !== void 0 && raw.exposureTime !== null) {
    let shutter;
    if (typeof raw.exposureTime === "number") {
      if (raw.exposureTime >= 1) {
        shutter = raw.exposureTime + "s";
      } else {
        const denom = Math.round(1 / raw.exposureTime);
        shutter = "1/" + denom + "s";
      }
    } else {
      shutter = String(raw.exposureTime);
    }
    fields.push({ key: "exif_shutter", value: shutter });
  }
  if (raw.iso !== void 0 && raw.iso !== null) {
    fields.push({ key: "exif_iso", value: String(raw.iso) });
  }
  if (raw.focalLength !== void 0 && raw.focalLength !== null) {
    const fl = typeof raw.focalLength === "number" ? Math.round(raw.focalLength) + "mm" : String(raw.focalLength);
    fields.push({ key: "exif_focal", value: fl });
  }
  if (raw.gpsLatDecimal !== void 0 && raw.gpsLonDecimal !== void 0) {
    const lat = raw.gpsLatDecimal.toFixed(4);
    const lon = raw.gpsLonDecimal.toFixed(4);
    fields.push({ key: "exif_gps", value: lat + ", " + lon });
  }
  if (raw.software) {
    fields.push({ key: "exif_software", value: raw.software });
  }
  return fields.length > 0 ? fields : null;
}
var ImageMetadataCache = class {
  /**
   * @param {import('obsidian').App} app
   */
  constructor(app) {
    this.app = app;
    this._cache = /* @__PURE__ */ new Map();
    this._pending = /* @__PURE__ */ new Map();
  }
  /**
   * Get formatted EXIF fields for an image file.
   * @param {import('obsidian').TFile} file
   * @returns {Promise<Array<{key:string,value:string}> | null>}
   */
  async get(file) {
    const filePath = file.path;
    const cached = this._cache.get(filePath);
    if (cached !== void 0) return cached;
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
};
var HEIC_EXTS = ["heic", "heif"];
var HeicCache = class {
  constructor(app) {
    this.app = app;
    this._cache = /* @__PURE__ */ new Map();
    this._pending = /* @__PURE__ */ new Map();
    this._libheifReady = null;
  }
  _getLibheif() {
    if (!this._libheifReady) {
      const plugin = this.app.plugins?.plugins?.dayline;
      const factory = plugin?._libheifFactory;
      if (!factory) {
        return Promise.reject(new Error("libheif not loaded"));
      }
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
      const canvas = document.createElement("canvas");
      canvas.width = origW;
      canvas.height = origH;
      const ctx = canvas.getContext("2d");
      const imageData = ctx.createImageData(origW, origH);
      await new Promise((resolve, reject) => {
        img.display(imageData, (displayData) => {
          if (!displayData) return reject(new Error("libheif display failed"));
          resolve(displayData);
        });
      });
      ctx.putImageData(imageData, 0, 0);
      const maxDim = 900;
      let tw = origW, th = origH;
      if (origW > maxDim || origH > maxDim) {
        const scale = maxDim / Math.max(origW, origH);
        tw = Math.round(origW * scale);
        th = Math.round(origH * scale);
      }
      const thumb = document.createElement("canvas");
      thumb.width = tw;
      thumb.height = th;
      const thumbCtx = thumb.getContext("2d");
      thumbCtx.drawImage(canvas, 0, 0, tw, th);
      const dataUrl = thumb.toDataURL("image/jpeg", 0.75);
      return { dataUrl, width: tw, height: th };
    } catch (e) {
      console.warn("[Dayline] HEIC conversion failed:", e.message || e);
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
};
var ReverseGeocoder = class {
  constructor() {
    this._cache = /* @__PURE__ */ new Map();
    this._pending = /* @__PURE__ */ new Map();
    this._lastRequest = 0;
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
    this._requestQueue = this._requestQueue.catch(() => {
    }).then(() => this._doLookup(lat, lon, key));
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
    const now = Date.now();
    const elapsed = now - this._lastRequest;
    if (elapsed < 1100) {
      await new Promise((r) => setTimeout(r, 1100 - elapsed));
    }
    this._lastRequest = Date.now();
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&accept-language=zh`;
      const resp = await requestUrl({ url, headers: { "User-Agent": "ObsidianDayline/2.0" } });
      if (resp.status === 200 && resp.json) {
        const data = resp.json;
        if (data.address) {
          const a = data.address;
          const parts = [a.city || a.town || a.county, a.district || a.suburb, a.village].filter(Boolean);
          if (parts.length > 0) return parts.join(" \xB7 ");
          if (data.display_name) return data.display_name.split(",")[0];
        }
        if (data.display_name) return data.display_name.split(",")[0];
      }
    } catch (e) {
    }
    return null;
  }
  invalidate() {
    this._cache.clear();
    this._pending.clear();
  }
};
var OnThisDayProvider = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this._dateIndex = null;
    this._otdCache = /* @__PURE__ */ new Map();
  }
  /** Build a Set of all MM-DD that have diary entries (one-time scan). */
  async _ensureDateIndex() {
    if (this._dateIndex) return;
    const folderPath = this.plugin.settings.dailyFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this._dateIndex = /* @__PURE__ */ new Set();
      return;
    }
    const today = /* @__PURE__ */ new Date();
    const thisYear = today.getFullYear();
    const index = /* @__PURE__ */ new Set();
    for (const child of folder.children) {
      if (!(child instanceof TFile2) || child.extension !== "md") continue;
      const match = child.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!match) continue;
      if (parseInt(match[1]) >= thisYear) continue;
      index.add(`${match[2]}-${match[3]}`);
    }
    this._dateIndex = index;
  }
  /** Quick check: does any year have a diary for this MM-DD? */
  async hasEntries(month, day) {
    await this._ensureDateIndex();
    const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return this._dateIndex.has(key);
  }
  /** Full entries for a given MM-DD (images + excerpts). */
  async getEntries(month, day) {
    await this._ensureDateIndex();
    const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (this._otdCache.has(key)) return this._otdCache.get(key);
    const folderPath = this.plugin.settings.dailyFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this._otdCache.set(key, []);
      return [];
    }
    const entries = [];
    const today = /* @__PURE__ */ new Date();
    const thisYear = today.getFullYear();
    for (const child of folder.children) {
      if (!(child instanceof TFile2) || child.extension !== "md") continue;
      const match = child.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!match) continue;
      const year = parseInt(match[1]);
      if (match[2] !== String(month).padStart(2, "0") || match[3] !== String(day).padStart(2, "0")) continue;
      if (year >= thisYear) continue;
      const cache = this.app.metadataCache.getFileCache(child);
      const embeds = cache?.embeds || [];
      const images = embeds.map((e) => e.link).filter((link) => link && IMAGE_EXTS.includes(link.split(".").pop()?.toLowerCase()));
      let excerpt = null;
      const mode = this.plugin.settings.onThisDayExcerptMode;
      if (mode === "frontmatter") {
        const fmKey = this.plugin.settings.onThisDayExcerptKey || "excerpt";
        const fm = cache?.frontmatter;
        if (fm && fm[fmKey]) excerpt = String(fm[fmKey]).trim();
      } else if (mode === "template") {
        try {
          const content = await this.app.vault.read(child);
          const tpl = this.plugin.settings.onThisDayExcerptTemplate || "{body}";
          excerpt = _renderExcerptTemplate(tpl, child.name.replace(/\.md$/, ""), year, cache?.frontmatter || {}, _extractExcerpt(content));
        } catch (e) {
        }
      } else if (mode !== "none") {
        try {
          const content = await this.app.vault.read(child);
          excerpt = _extractExcerpt(content);
        } catch (e) {
        }
      }
      entries.push({ year, dateStr: child.name.replace(/\.md$/, ""), images, excerpt });
    }
    entries.sort((a, b) => b.year - a.year);
    if (entries.length > 0) {
      this._otdCache.set(key, entries);
    }
    return entries;
  }
  /** Invalidate cache for a specific MM-DD, or all. */
  invalidate(mmdd) {
    if (mmdd) {
      this._otdCache.delete(mmdd);
    } else {
      this._otdCache.clear();
      this._dateIndex = null;
    }
  }
};
function _extractExcerpt(content) {
  let text = content.replace(/^---[\s\S]*?---\n*/, "");
  text = text.replace(/!\[\[.*?\]\]/g, "");
  text = text.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/[*_~`]+/g, "");
  text = text.replace(/={2,}/g, "");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s/gm, "");
  text = text.replace(/\n+/g, " ");
  text = text.replace(/\s{2,}/g, " ").trim();
  if (text.length > 100) text = text.substring(0, 100) + "...";
  return text || null;
}
function _renderExcerptTemplate(template, dateStr, year, frontmatter, bodyText) {
  let result = template;
  result = result.replace(/\{body\}/g, bodyText || "");
  result = result.replace(/\{year\}/g, String(year));
  result = result.replace(/\{date\}/g, dateStr);
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "string" || typeof value === "number") {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\{${escapedKey}\\}`, "g"), String(value));
    }
  }
  result = result.trim();
  return result || null;
}
var CalendarView = class extends ItemView2 {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
    this.displayMonth = /* @__PURE__ */ new Date();
    this.displayMonth.setDate(1);
    this.displayMonth.setHours(0, 0, 0, 0);
    this.monthCache = /* @__PURE__ */ new Map();
    this._refreshTimer = null;
    this.activeDate = null;
    this.weather = plugin.weatherService;
    this._weatherCardEl = null;
    this._weatherCardDate = null;
    this._weatherSnapshot = null;
    this._weatherLoading = false;
    this._weatherError = false;
    this._fetchToken = 0;
    this._overlayLeaves = /* @__PURE__ */ new WeakSet();
    this._overlayInFlight = /* @__PURE__ */ new WeakMap();
    this._overlayVersions = /* @__PURE__ */ new WeakMap();
    this._hostPositionMarkers = /* @__PURE__ */ new Set();
    this.exifCache = plugin.exifCache;
    this._exifNoteImages = /* @__PURE__ */ new WeakSet();
    this._otdProvider = new OnThisDayProvider(plugin);
    this._otdDotCache = null;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Calendar";
  }
  getIcon() {
    return "calendar";
  }
  /* ----- Lifecycle ----- */
  async onOpen() {
    this.containerEl.addClass("cal-sidebar");
    await this.buildMonthCache(this.displayMonth);
    this._otdProvider._ensureDateIndex().then(() => {
      this._otdDotCache = this._otdProvider._dateIndex;
      if (this.plugin.settings.onThisDayDot) this.render();
    });
    this._syncActiveDate();
    this.render();
    this.registerEvent(
      this.app.vault.on("modify", (file) => this._onFileChanged(file))
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => this._onFileChanged(file))
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this._onFileChanged(file))
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this._syncActiveDate();
        setTimeout(() => this.render(), 0);
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this._syncNoteOverlays())
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this._syncNoteOverlays())
    );
  }
  onClose() {
    clearTimeout(this._refreshTimer);
    clearTimeout(this._exifNoteTimer);
    this.plugin._endExifHover();
    for (const observer of this._exifObservers?.values() || []) observer.disconnect();
    this._exifObservers?.clear();
    this._removeAllOverlaysFromViews();
    for (const container of this._hostPositionMarkers) {
      if (container.style.position === "relative") container.style.removeProperty("position");
      this.plugin._hostPositionMarkers?.delete(container);
    }
    this._hostPositionMarkers.clear();
  }
  /* ----- File change refresh (debounced) ----- */
  _onFileChanged(file) {
    if (!(file instanceof TFile2)) return;
    const extension = file.extension?.toLowerCase();
    if (IMAGE_EXTS.includes(extension)) {
      this.exifCache?.invalidate(file.path);
      this.plugin.heicCache?.invalidate(file.path);
      clearTimeout(this._refreshTimer);
      this._refreshTimer = setTimeout(async () => {
        this.monthCache.clear();
        await this.buildMonthCache(this.displayMonth);
        this.render();
      }, 300);
      return;
    }
    if (extension !== "md") return;
    const folderPrefix = this.plugin.settings.dailyFolder + "/";
    if (!file.path.startsWith(folderPrefix)) return;
    if (this.exifCache) this.exifCache.invalidate();
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(async () => {
      const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]) - 1;
        const key = `${year}-${month}`;
        this.monthCache.delete(key);
        if (this._otdProvider) {
          this._otdProvider.invalidate(`${match[2]}-${match[3]}`);
          this._otdProvider._dateIndex = null;
        }
        this._otdDotCache = null;
        await this.buildMonthCache(this.displayMonth);
      } else {
        this.monthCache.delete(this._monthKey(this.displayMonth));
        if (this._otdProvider) {
          this._otdProvider.invalidate();
          this._otdProvider._dateIndex = null;
        }
        this._otdDotCache = null;
        await this.buildMonthCache(this.displayMonth);
      }
      if (this._otdProvider && this.plugin.settings.onThisDayDot) {
        this._otdProvider._ensureDateIndex().then(() => {
          this._otdDotCache = this._otdProvider._dateIndex;
        });
      }
      this.render();
    }, 300);
  }
  /* ----- Public refresh (called from plugin) ----- */
  async refresh() {
    this.monthCache.delete(this._monthKey(this.displayMonth));
    if (this.exifCache) this.exifCache.invalidate();
    if (this._otdProvider) this._otdProvider.invalidate();
    this._otdDotCache = null;
    await this.buildMonthCache(this.displayMonth);
    this.render();
    if (this._otdProvider && this.plugin.settings.onThisDayDot) {
      this._otdProvider._ensureDateIndex().then(() => {
        this._otdDotCache = this._otdProvider._dateIndex;
        this.render();
      });
    }
  }
  /* ----- Month cache key ----- */
  _monthKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }
  /* ----- Build cache for a given month ----- */
  async buildMonthCache(monthDate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const key = this._monthKey(monthDate);
    if (this.monthCache.has(key)) return;
    this.monthCache.set(key, /* @__PURE__ */ new Map());
    const folderPath = this.plugin.settings.dailyFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return;
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const map = /* @__PURE__ */ new Map();
    for (const child of folder.children) {
      if (!(child instanceof TFile2) || child.extension !== "md") continue;
      const dateMatch = child.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!dateMatch || dateMatch[1] !== String(year) || dateMatch[2] !== String(month + 1).padStart(2, "0")) continue;
      const dateStr = child.name.replace(/\.md$/, "");
      const cache = this.app.metadataCache.getFileCache(child);
      if (!cache) continue;
      const embeds = cache.embeds || [];
      let images = embeds.map((e) => e.link).filter((link) => link && IMAGE_EXTS.includes(link.split(".").pop()?.toLowerCase()));
      if (this.plugin.settings.thumbnailFilter === "date-prefixed") {
        images = images.filter((link) => {
          const fileName = String(link).split(/[\\/]/).pop() || "";
          return fileName.startsWith(dateStr);
        });
      }
      if (images.length > 0) {
        map.set(dateStr, images);
      }
    }
    this.monthCache.set(key, map);
  }
  /* ----- Render the calendar ----- */
  render() {
    this._fetchToken = (this._fetchToken || 0) + 1;
    const el = this.contentEl;
    el.empty();
    this._ensureExifTooltip();
    const year = this.displayMonth.getFullYear();
    const month = this.displayMonth.getMonth();
    const key = this._monthKey(this.displayMonth);
    const imageMap = this.monthCache.get(key) || /* @__PURE__ */ new Map();
    const header = el.createDiv({ cls: "cal-header" });
    const prevBtn = header.createEl("span", { cls: "cal-nav" });
    prevBtn.setText("\u25C0");
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._goToMonth(-1);
    });
    const title = header.createEl("span", { cls: "cal-title" });
    title.setText(`${year}\u5E74${month + 1}\u6708`);
    const nextBtn = header.createEl("span", { cls: "cal-nav" });
    nextBtn.setText("\u25B6");
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._goToMonth(1);
    });
    this._renderWeatherCard(el);
    if (this.plugin.settings.onThisDayButton) {
      const otdBtn = el.createDiv({ cls: "cal-otd-button" });
      const todayDate = /* @__PURE__ */ new Date();
      const tm = todayDate.getMonth() + 1, td = todayDate.getDate();
      otdBtn.setText(_l(this.plugin.settings.weatherLanguage, "otd_button", tm, td));
      otdBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = /* @__PURE__ */ new Date();
        this.plugin.openOnThisDay(d.getMonth() + 1, d.getDate());
      });
    }
    const wd = el.createDiv({ cls: "cal-weekdays" });
    for (const day of ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"]) {
      wd.createEl("span", { cls: "cal-weekday", text: day });
    }
    const grid = el.createDiv({ cls: "cal-grid" });
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth2 = new Date(year, month + 1, 0).getDate();
    const today = /* @__PURE__ */ new Date();
    const todayStr = _formatDate(today);
    for (let i = 0; i < firstDay; i++) {
      grid.createDiv({ cls: "cal-day cal-day-empty" });
    }
    for (let d = 1; d <= daysInMonth2; d++) {
      const dateObj = new Date(year, month, d);
      const dateStr = _formatDate(dateObj);
      const images = imageMap.get(dateStr) || [];
      const isToday = dateStr === todayStr;
      const cell = grid.createDiv({ cls: "cal-day" });
      if (images.length > 0) cell.addClass("cal-has-image");
      else cell.addClass("cal-no-image");
      if (isToday) cell.addClass("cal-today");
      if (dateStr === this.activeDate && !isToday) cell.addClass("cal-active");
      if (images.length > 0) {
        const bg = cell.createDiv({ cls: "cal-day-bg" });
        const overlay = cell.createDiv({ cls: "cal-day-overlay" });
        this._setBackground(bg, images[0], dateStr);
        const firstImage = images[0];
        cell.addEventListener("mouseenter", () => this._onExifEnter(cell, firstImage, dateStr));
        cell.addEventListener("mouseleave", () => this._onExifLeave());
      }
      if (this.plugin.settings.weatherEnabled && shouldShowCalendarWeatherBadge2(this.plugin.settings) && this.weather.hasCachedSnapshot(dateStr)) {
        const snap = this._readCachedWeather(dateStr);
        if (snap) {
          const badge = cell.createEl("img", { cls: "cal-weather-badge" });
          badge.src = _iconUrl(snap.icon) || "";
          badge.alt = snap.condition;
          badge.setAttribute("aria-label", `${snap.condition}, ${snap.temperature}${this._unitSymbol(snap.units)}`);
          badge.title = `${snap.condition} \xB7 ${snap.temperature}${this._unitSymbol(snap.units)}`;
        }
      }
      const dailyPath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      const mood = shouldShowCalendarMood2(this.plugin.settings) ? this.plugin.moodStore?.get(dailyPath) || this.plugin.journalIndex?.getEntries().find((entry) => entry.path === dailyPath)?.mood : void 0;
      if (shouldShowCalendarMood2(this.plugin.settings)) {
        const moodButton = cell.createEl("button", {
          cls: `cal-mood-button ${mood ? `mood-${mood.score}` : "cal-mood-empty"}`,
          attr: {
            type: "button",
            "aria-label": `${t4(this.plugin.settings, "recordMood")}: ${dateStr}`,
            title: mood ? moodLabel4(this.plugin.settings, mood.score) : `${t4(this.plugin.settings, "recordMood")}: ${dateStr}`
          }
        });
        if (mood) moodButton.style.setProperty("--journal-mood-color", getMoodColor3(mood.score));
        moodButton.createSpan({ cls: "cal-mood-dot", attr: { "aria-hidden": "true" } });
        moodButton.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.plugin.openMoodPicker(dailyPath, { allowDateSelection: true, ensureFile: false });
        });
      }
      if (this.plugin.settings.onThisDayDot && this._otdDotCache) {
        const mmdd = `${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (this._otdDotCache.has(mmdd) && dateStr !== todayStr) {
          cell.createDiv({ cls: "cal-otd-dot" });
        }
      }
      const num = cell.createEl("span", { cls: "cal-day-num", text: String(d) });
      cell.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this._openNote(dateStr);
      });
    }
  }
  /* ----- EXIF Tooltip (delegates to plugin) ----- */
  _ensureExifTooltip() {
    this.plugin._ensureExifTooltip();
  }
  _showExifTooltip(el, fields, loading) {
    this.plugin._showExifTooltip(el, fields, loading);
  }
  _hideExifTooltip() {
    this.plugin._hideExifTooltip();
  }
  /** Mouse entered a day cell with an image — start the hover timer. */
  _onExifEnter(cell, imageLink, dateStr) {
    if (!this.plugin.settings.showExif) return;
    const hoverToken = this.plugin._beginExifHover();
    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        const sourcePath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
        const file = this.app.metadataCache.getFirstLinkpathDest(imageLink, sourcePath);
        if (!(file instanceof TFile2)) return;
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(cell, null, true);
        const fields = await this.exifCache.get(file);
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(cell, fields, false);
        if (this.plugin.settings.exifReverseGeocode && fields && this.plugin.geocoder) {
          const gpsField = fields.find((f) => f.key === "exif_gps");
          if (gpsField) {
            const parts = gpsField.value.split(",").map((s) => parseFloat(s.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              const place = await this.plugin.geocoder.lookup(parts[0], parts[1]);
              if (place && this.plugin._isCurrentExifHover(hoverToken)) {
                gpsField.value = place;
                this.plugin._showExifTooltip(cell, fields, false);
              }
            }
          }
        }
      } catch (_) {
        this.plugin._hideExifTooltip();
      }
    }, 500);
  }
  _onExifLeave() {
    this.plugin._endExifHover();
  }
  /* ----- Read cached weather from plugin data (no more YAML pollution) ----- */
  _readCachedWeather(dateStr) {
    const entry = this.weather.getCachedSnapshot(dateStr);
    if (entry && typeof entry === "object") {
      if (typeof entry.icon === "string" && !entry.icon.endsWith(".svg") && entry.weatherCode != null) {
        entry.icon = _lookupWmo(entry.weatherCode).icon;
      }
      return entry;
    }
    return null;
  }
  /* ----- Render weather card below month header (idempotent) ----- */
  _renderWeatherCard(containerEl) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled || !shouldShowCalendarWeatherCard2(s)) {
      return;
    }
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) {
      const hint = containerEl.createDiv({ cls: "cal-weather-setup" });
      hint.setText(_l(s.weatherLanguage, "setupHint"));
      hint.setAttribute("aria-label", _l(s.weatherLanguage, "setupAria"));
      return;
    }
    const cardDate = this.activeDate || _formatDate(/* @__PURE__ */ new Date());
    if (this._weatherCardDate === cardDate && this._weatherCardEl && this._weatherCardEl.isConnected) {
      return;
    }
    const sameCardDate = this._weatherCardDate === cardDate;
    const existingSnap = sameCardDate && this._weatherSnapshot && this.weather.isSnapshotCompatible(this._weatherSnapshot) ? this._weatherSnapshot : null;
    this._weatherCardDate = cardDate;
    this._weatherSnapshot = existingSnap;
    this._weatherLoading = !existingSnap;
    this._weatherError = false;
    const card = containerEl.createDiv({
      cls: this._weatherLoading ? "cal-weather-card cal-weather-loading" : "cal-weather-card"
    });
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    this._weatherCardEl = card;
    const iconEl = card.createEl("img", { cls: "cal-weather-icon" });
    const loading = this._weatherLoading ? "\u231B\uFE0F" : "";
    if (loading) iconEl.alt = loading;
    else {
      iconEl.src = _iconUrl("overcast.svg");
      iconEl.alt = "weather";
    }
    const infoEl = card.createDiv({ cls: "cal-weather-info" });
    const tempEl = infoEl.createDiv({ cls: "cal-weather-temp" });
    const detailEl = infoEl.createDiv({ cls: "cal-weather-detail" });
    tempEl.setText(_l(s.weatherLanguage, "loading"));
    detailEl.setText(cardDate);
    const refreshBtn = card.createEl("button", {
      cls: "cal-weather-refresh",
      attr: { "aria-label": "Refresh weather", title: "Refresh weather" }
    });
    setIcon2(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._performRefresh(cardDate, refreshBtn).catch((err) => {
        console.warn("[Dayline] Refresh weather from card failed:", err.message);
      });
    });
    if (this._weatherLoading) {
      this._fetchWeatherForDate(cardDate);
    } else {
      this._updateWeatherCardUI();
    }
  }
  /* ----- Update weather card UI after async data arrives ----- */
  _updateWeatherCardUI() {
    const card = this._weatherCardEl;
    if (!card || !card.isConnected) return;
    const lang = this.plugin.settings.weatherLanguage;
    card.removeClass("cal-weather-loading");
    if (this._weatherError) {
      card.addClass("cal-weather-error");
      const iconEl2 = card.querySelector(".cal-weather-icon");
      if (iconEl2) {
        iconEl2.src = "";
        iconEl2.alt = "\u26A0\uFE0F";
      }
      card.querySelector(".cal-weather-temp").setText(_l(lang, "unavailable"));
      card.querySelector(".cal-weather-detail").setText(_l(lang, "checkSettings"));
      return;
    }
    const snap = this._weatherSnapshot;
    if (!snap) {
      const iconEl2 = card.querySelector(".cal-weather-icon");
      if (iconEl2) iconEl2.src = _iconUrl("overcast.svg");
      card.querySelector(".cal-weather-temp").setText("\u2014");
      card.querySelector(".cal-weather-detail").setText(_l(lang, "noData"));
      return;
    }
    const iconEl = card.querySelector(".cal-weather-icon");
    if (iconEl) {
      iconEl.src = _iconUrl(snap.icon) || "";
      iconEl.alt = snap.condition;
      iconEl.title = snap.condition;
    }
    const tempEl = card.querySelector(".cal-weather-temp");
    const unitSym = this._unitSymbol(snap.units);
    const labelKey = snap.temperatureLabel === "Now" ? "now" : "high";
    const label = _l(lang, labelKey);
    tempEl.setText(`${label} ${snap.temperature ?? "?"}${unitSym}`);
    const detailEl = card.querySelector(".cal-weather-detail");
    const parts = [];
    if (snap.feelsLike != null) parts.push(`${_l(lang, "feels")} ${snap.feelsLike}${unitSym}`);
    if (snap.humidity != null) parts.push(`${_l(lang, "humidity")} ${snap.humidity}%`);
    if (snap.low != null) parts.push(`${_l(lang, "low")} ${snap.low}${unitSym}`);
    detailEl.setText(parts.join(" \xB7 ") || snap.location);
    detailEl.title = snap.location;
    card.removeAttribute("aria-live");
  }
  /* ----- Fetch weather for a date in the background ----- */
  async _fetchWeatherForDate(dateStr) {
    const token = this._fetchToken;
    try {
      const snap = await this.weather.getSnapshot(dateStr);
      if (token !== this._fetchToken || this._weatherCardDate !== dateStr) return;
      this._weatherSnapshot = snap;
      this._weatherError = !snap;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
    } catch (err) {
      if (token !== this._fetchToken || this._weatherCardDate !== dateStr) return;
      this._weatherError = true;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
    }
  }
  /* ----- Explicit weather refresh (command / button) ----- */
  async refreshWeather(dateStr) {
    dateStr = dateStr || this.activeDate || _formatDate(/* @__PURE__ */ new Date());
    await this._performRefresh(dateStr, null);
  }
  /* ----- Perform a refresh with loading/disabled state on the button ----- */
  async _performRefresh(dateStr, btnEl) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return;
    let wasLoading = false;
    if (btnEl) {
      btnEl.setAttribute("disabled", "");
      btnEl.addClass("is-loading");
      wasLoading = true;
    } else {
      this._weatherLoading = true;
    }
    const renderToken = this._fetchToken;
    try {
      const snap = await this.weather.forceRefresh(dateStr);
      if (renderToken !== this._fetchToken || this._weatherCardDate !== dateStr) return;
      this._weatherSnapshot = snap;
      this._weatherError = !snap;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      this.render();
      const lang = this.plugin.settings.weatherLanguage;
      if (snap) {
        new Notice3(_l(lang, "weatherUpdated", dateStr));
      } else {
        new Notice3(_l(lang, "noDataFor", dateStr));
      }
    } catch (err) {
      this._weatherError = true;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      const lang = this.plugin.settings.weatherLanguage;
      new Notice3(_l(lang, "refreshFailed", err.message || "unknown error"));
    } finally {
      if (wasLoading && btnEl) {
        btnEl.removeAttribute("disabled");
        btnEl.removeClass("is-loading");
      }
    }
  }
  /* ----- Unit symbol helper ----- */
  _unitSymbol(units) {
    return units === "imperial" ? "\xB0F" : "\xB0C";
  }
  /* ----- Resolve and set background image ----- */
  async _setBackground(bgEl, link, dateStr) {
    try {
      const sourcePath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      const result = await this.plugin.thumbnailService.load(link, sourcePath);
      if (result && bgEl.isConnected) bgEl.style.backgroundImage = `url("${result.url}")`;
    } catch (_) {
    }
  }
  /* ----- Navigate months ----- */
  _goToMonth(delta) {
    const newMonth = new Date(this.displayMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    this.displayMonth = newMonth;
    this.buildMonthCache(this.displayMonth).then(() => this.render());
  }
  /* ----- Open (or create + open) daily note ----- */
  _openNote(dateStr) {
    const path = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    const openFileInLeaf = (f) => {
      const activeLeaf = this.app.workspace.activeLeaf;
      const isMarkdown = activeLeaf?.view?.getViewType?.() === "markdown";
      const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
      const leaf = isMarkdown ? activeLeaf : mdLeaves.length > 0 ? mdLeaves[0] : this.app.workspace.getLeaf(true);
      leaf.openFile(f).then(() => {
        this._syncActiveDate(leaf);
        this.render();
        this._triggerWeatherAfterOpen(dateStr);
      });
    };
    if (file instanceof TFile2) {
      openFileInLeaf(file);
    } else {
      new CreateNoteModal(this.app, dateStr, () => {
        this._createDailyNote(path, dateStr).then((created) => {
          openFileInLeaf(created);
          setTimeout(() => this._triggerWeatherAfterOpen(dateStr), 500);
        });
      }).open();
    }
  }
  /* ----- Trigger weather fetch after note open/create (non-blocking) ----- */
  _triggerWeatherAfterOpen(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled || !s.weatherAutoFetch) return;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return;
    const token = this._fetchToken;
    this.weather.getSnapshot(dateStr).then((snap) => {
      if (snap && token === this._fetchToken && this._weatherCardDate === dateStr) {
        this._weatherSnapshot = snap;
        this._weatherLoading = false;
        this._weatherError = false;
        this._updateWeatherCardUI();
      }
    }).catch((err) => {
      console.warn("[Dayline] Weather fetch after note open failed:", err.message);
    });
  }
  /* ----- Sync weather overlays on all markdown leaves ----- */
  _syncNoteOverlays() {
    const s = this.plugin.settings;
    this._scheduleExifNoteAttach();
    if (!s.weatherEnabled) {
      this._removeAllOverlaysFromViews();
      return;
    }
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) {
      this._removeAllOverlaysFromViews();
      return;
    }
    const dailyFolder = s.dailyFolder;
    const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
    const validDailyFiles = /* @__PURE__ */ new Set();
    for (const leaf of mdLeaves) {
      const file = leaf.view?.file;
      if (!(file instanceof TFile2)) continue;
      if (!file.path.startsWith(dailyFolder + "/")) continue;
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) continue;
      validDailyFiles.add(file.path);
      if (this._overlayInFlight.has(leaf)) {
        continue;
      }
      this._createOrUpdateOverlay(leaf, file);
    }
    for (const leaf of mdLeaves) {
      const file = leaf.view?.file;
      const path = file ? file.path : null;
      if (path && validDailyFiles.has(path)) continue;
      const overlay = leaf.containerEl?.querySelector(`[${OVERLAY_ATTR}]`);
      if (overlay) {
        overlay.remove();
      }
    }
  }
  _invalidateOverlayRequests() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      this._overlayVersions.set(leaf, (this._overlayVersions.get(leaf) || 0) + 1);
    }
    this._removeAllOverlaysFromViews();
  }
  /* ----- EXIF hover on daily note embedded images ----- */
  _scheduleExifNoteAttach() {
    clearTimeout(this._exifNoteTimer);
    this._exifNoteTimer = setTimeout(() => {
      if (!this.plugin.settings.showExif) return;
      const dailyFolder = this.plugin.settings.dailyFolder;
      const activeDailyLeaves = /* @__PURE__ */ new Set();
      const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
      for (const leaf of mdLeaves) {
        const file = leaf.view?.file;
        if (!(file instanceof TFile2)) continue;
        if (!file.path.startsWith(dailyFolder + "/")) continue;
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) continue;
        activeDailyLeaves.add(leaf);
        this._observeNoteImages(leaf);
      }
      if (this._exifObservers) {
        for (const [leaf, obs] of this._exifObservers) {
          if (!activeDailyLeaves.has(leaf)) {
            obs.disconnect();
            this._exifObservers.delete(leaf);
          }
        }
      }
    }, 300);
  }
  _observeNoteImages(leaf) {
    if (!this._exifObservers) this._exifObservers = /* @__PURE__ */ new Map();
    if (this._exifObservers.has(leaf)) return;
    const container = leaf.view?.containerEl || leaf.containerEl;
    if (!container) return;
    this._processImageEls(container.querySelectorAll("img"));
    this._processEmbedEls(container.querySelectorAll(".internal-embed"));
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === "IMG") this._processImageEls([node]);
            if (node.classList?.contains("internal-embed")) this._processEmbedEls([node]);
            if (node.querySelectorAll) {
              this._processImageEls(node.querySelectorAll("img"));
              this._processEmbedEls(node.querySelectorAll(".internal-embed"));
            }
          }
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    this._exifObservers.set(leaf, observer);
  }
  _processImageEls(images) {
    for (const img of images) {
      if (this._exifNoteImages.has(img)) continue;
      this._exifNoteImages.add(img);
      img.addEventListener("mouseenter", (e) => this._onNoteImageEnter(e, img));
      img.addEventListener("mouseleave", () => this._onExifLeave());
    }
  }
  _processEmbedEls(embeds) {
    for (const el of embeds) {
      if (this._exifNoteImages.has(el)) continue;
      const src = el.getAttribute("src") || "";
      const ext = src.split(".").pop()?.toLowerCase();
      if (!ext || !IMAGE_EXTS.includes(ext)) continue;
      this._exifNoteImages.add(el);
      el.addEventListener("mouseenter", (e) => this._onNoteImageEnter(e, el));
      el.addEventListener("mouseleave", () => this._onExifLeave());
      if (HEIC_EXTS.includes(ext) && !el.querySelector(".cal-heic-preview")) {
        this._convertHeicEmbed(el, src);
      }
    }
  }
  async _convertHeicEmbed(el, src) {
    const loader = document.createElement("div");
    loader.className = "cal-heic-preview";
    loader.style.cssText = "display:flex;align-items:center;justify-content:center;min-height:60px;color:var(--text-muted);font-size:12px;";
    loader.textContent = "Converting HEIC...";
    el.appendChild(loader);
    try {
      const notePath = this.app.workspace.activeLeaf?.view?.file?.path || "";
      const file = this.app.metadataCache.getFirstLinkpathDest(src, notePath);
      if (!(file instanceof TFile2)) return;
      const thumb = await this.plugin.heicCache.getThumbnail(file);
      if (!thumb) {
        loader.textContent = "HEIC conversion failed";
        return;
      }
      const img = document.createElement("img");
      img.src = thumb.dataUrl;
      img.style.cssText = "max-width:100%;height:auto;display:block;";
      img.setAttribute("data-cal-exif", "1");
      this._exifNoteImages.add(img);
      img.addEventListener("mouseenter", (e) => this._onNoteImageEnter(e, img));
      img.addEventListener("mouseleave", () => this._onExifLeave());
      loader.replaceWith(img);
    } catch (_) {
      loader.textContent = "HEIC error";
    }
  }
  async _onNoteImageEnter(e, img) {
    if (!this.plugin.settings.showExif) return;
    const hoverToken = this.plugin._beginExifHover();
    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        const file = this._resolveImageFile(img);
        if (!(file instanceof TFile2)) return;
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(img, null, true);
        const fields = await this.exifCache.get(file);
        if (!this.plugin._isCurrentExifHover(hoverToken)) return;
        this.plugin._showExifTooltip(img, fields, false);
      } catch (_) {
        this.plugin._hideExifTooltip();
      }
    }, 500);
  }
  _resolveImageFile(el) {
    const leaf = this.app.workspace.activeLeaf;
    const notePath = leaf?.view?.file?.path || "";
    if (el.classList && el.classList.contains("internal-embed")) {
      const embedSrc = el.getAttribute("src");
      if (embedSrc && notePath) {
        const f = this.app.metadataCache.getFirstLinkpathDest(embedSrc, notePath);
        if (f instanceof TFile2) return f;
      }
    }
    let parent = el.parentElement;
    while (parent) {
      if (parent.classList.contains("internal-embed")) {
        const embedSrc = parent.getAttribute("src");
        if (embedSrc && notePath) {
          const f = this.app.metadataCache.getFirstLinkpathDest(embedSrc, notePath);
          if (f instanceof TFile2) return f;
        }
        break;
      }
      parent = parent.parentElement;
    }
    const src = el.getAttribute("src");
    if (!src) return null;
    let path = decodeURIComponent(src);
    const qIdx = path.indexOf("?");
    if (qIdx > 0) path = path.substring(0, qIdx);
    const appIdx = path.indexOf("://");
    if (appIdx > 0) {
      const afterHost = path.indexOf("/", appIdx + 3);
      if (afterHost > 0) {
        path = path.substring(afterHost + 1);
      }
    }
    const vaultPath = (this.app.vault.adapter.basePath || "").replace(/\\/g, "/");
    const normalized = path.replace(/\\/g, "/");
    if (vaultPath && normalized.startsWith(vaultPath)) {
      const relative = normalized.substring(vaultPath.length + 1);
      const f = this.app.vault.getAbstractFileByPath(relative);
      if (f instanceof TFile2) return f;
    }
    const fileName = normalized.split("/").pop();
    if (fileName) {
      const f = this.app.vault.getAbstractFileByPath(fileName);
      if (f instanceof TFile2) return f;
    }
    return null;
  }
  /* ----- Mount or update weather overlay on a single markdown leaf ----- */
  async _createOrUpdateOverlay(leaf, file) {
    const dateStr = file.name.replace(/\.md$/, "");
    const container = leaf.containerEl;
    if (!container) return;
    const inFlightPromise = (async () => {
      try {
        await this._buildOverlayForLeaf(leaf, file, dateStr);
      } catch (err) {
        console.warn("[Dayline] Overlay build failed:", err.message);
      } finally {
        this._overlayInFlight.delete(leaf);
        if (leaf.view?.file === file && !leaf.containerEl?.querySelector(`[${OVERLAY_ATTR}]`)) {
          this._syncNoteOverlays();
        }
      }
    })();
    this._overlayInFlight.set(leaf, inFlightPromise);
  }
  /* ----- Build overlay content and mount it into the given leaf ----- */
  async _buildOverlayForLeaf(leaf, file, dateStr) {
    const container = leaf.containerEl;
    if (!container) return;
    const myVersion = (this._overlayVersions.get(leaf) || 0) + 1;
    this._overlayVersions.set(leaf, myVersion);
    const currentFile = leaf.view?.file;
    if (currentFile !== file || !(currentFile instanceof TFile2)) return;
    const cache = this.app.metadataCache.getFileCache(currentFile);
    let snap = this.weather.getCachedSnapshot(dateStr) || cache?.frontmatter?._calendar_weather || null;
    if (snap && !this.weather.isSnapshotCompatible(snap)) snap = null;
    if (snap && typeof snap.icon === "string" && !snap.icon.endsWith(".svg") && snap.weatherCode != null) {
      snap.icon = _lookupWmo(snap.weatherCode).icon;
    }
    const isStale = snap && typeof snap === "object" ? this.weather._shouldFetch(snap, this.plugin.settings.weatherTtlHours || 2) : true;
    if (!snap || isStale) {
      const fetched = await this.weather.getSnapshot(dateStr);
      if (fetched) snap = fetched;
    }
    if (snap && !this.weather.isSnapshotCompatible(snap)) snap = null;
    const latestFile = leaf.view?.file;
    if (latestFile !== file || !(latestFile instanceof TFile2)) return;
    if (myVersion < (this._overlayVersions.get(leaf) || 0)) return;
    if (!snap) return;
    const oldEl = container.querySelector(`[${OVERLAY_ATTR}]`);
    if (oldEl) oldEl.remove();
    this._ensureHostPosition(container);
    const overlay = container.createDiv({
      cls: "cal-note-overlay",
      attr: { [OVERLAY_ATTR]: "true" }
    });
    const iconEl = overlay.createEl("img", { cls: "cal-overlay-icon" });
    iconEl.src = _iconUrl(snap.icon) || "";
    iconEl.alt = snap.condition || "";
    iconEl.title = snap.condition;
    const infoEl = overlay.createDiv({ cls: "cal-overlay-info" });
    const tempEl = infoEl.createDiv({ cls: "cal-overlay-temp" });
    const detailEl = infoEl.createDiv({ cls: "cal-overlay-detail" });
    const lang = this.plugin.settings.weatherLanguage;
    const unitSym = this._unitSymbol(snap.units);
    const labelKey = snap.temperatureLabel === "Now" ? "now" : "high";
    tempEl.setText(`${_l(lang, labelKey)} ${snap.temperature ?? "?"}${unitSym}`);
    const parts = [];
    if (snap.feelsLike != null) parts.push(`${_l(lang, "feels")} ${snap.feelsLike}${unitSym}`);
    if (snap.humidity != null) parts.push(`${_l(lang, "humidity")} ${snap.humidity}%`);
    detailEl.setText(parts.join(" \xB7 ") || "");
    detailEl.title = snap.condition;
    const refreshLabel = _l(lang, "refresh");
    const refreshBtn = overlay.createEl("button", {
      cls: "cal-overlay-refresh",
      attr: { "aria-label": refreshLabel, title: refreshLabel }
    });
    setIcon2(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._performOverlayRefresh(dateStr, refreshBtn, overlay).catch((err) => {
        console.warn("[Dayline] Overlay refresh failed:", err.message);
      });
    });
    requestAnimationFrame(() => {
      overlay.addClass("is-visible");
    });
  }
  /* ----- Ensure containerEl has position:relative for absolute overlay placement ----- */
  _ensureHostPosition(container) {
    if (this._hostPositionMarkers.has(container)) return;
    const computedStyle = getComputedStyle(container);
    if (computedStyle.position !== "static") return;
    container.style.position = "relative";
    this._hostPositionMarkers.add(container);
    this.plugin._hostPositionMarkers?.add(container);
  }
  /* ----- Refresh weather for an overlay ----- */
  async _performOverlayRefresh(dateStr, btnEl, overlayEl) {
    if (!overlayEl?.isConnected) return;
    btnEl.setAttribute("disabled", "");
    btnEl.addClass("is-loading");
    try {
      const snap = await this.weather.forceRefresh(dateStr);
      if (!snap || !overlayEl.isConnected) return;
      const tempEl = overlayEl.querySelector(".cal-overlay-temp");
      const detailEl = overlayEl.querySelector(".cal-overlay-detail");
      const iconEl = overlayEl.querySelector(".cal-overlay-icon");
      const unitSym = this._unitSymbol(snap.units);
      const lang = this.plugin.settings.weatherLanguage;
      const labelKey = snap.temperatureLabel === "Now" ? "now" : "high";
      if (tempEl) tempEl.textContent = `${_l(lang, labelKey)} ${snap.temperature ?? "?"}${unitSym}`;
      if (iconEl) {
        iconEl.src = _iconUrl(snap.icon) || "";
        iconEl.title = snap.condition;
      }
      const parts = [];
      if (snap.feelsLike != null) parts.push(`${_l(lang, "feels")} ${snap.feelsLike}${unitSym}`);
      if (snap.humidity != null) parts.push(`${_l(lang, "humidity")} ${snap.humidity}%`);
      if (detailEl) detailEl.textContent = parts.join(" \xB7 ") || "";
    } catch (err) {
      console.warn("[Dayline] Overlay refresh failed:", err.message);
    } finally {
      if (btnEl?.isConnected) {
        btnEl.removeAttribute("disabled");
        btnEl.removeClass("is-loading");
      }
    }
  }
  /* ----- Remove all overlays from markdown view containers ----- */
  _removeAllOverlaysFromViews() {
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
  }
  /* ----- Create daily note from template ----- */
  async _createDailyNote(path, dateStr) {
    const dnPlugin = this.app.internalPlugins.getPluginById("daily-notes");
    const templatePath = dnPlugin?.instance?.options?.template;
    if (templatePath) {
      const templateFile = this.app.vault.getAbstractFileByPath(templatePath + ".md");
      if (templateFile instanceof TFile2) {
        const tp = this.app.plugins.getPlugin("templater-obsidian")?.templater;
        if (tp && tp.create_new_note_from_template) {
          await tp.create_new_note_from_template(templateFile, this.plugin.settings.dailyFolder, dateStr, false);
          const created = this.app.vault.getAbstractFileByPath(path);
          if (created instanceof TFile2) return created;
        }
        const content = await this.app.vault.read(templateFile);
        return this.app.vault.create(path, content);
      }
    }
    return this.app.vault.create(path, "");
  }
  /* ----- Sync active date from the currently viewed leaf ----- */
  _syncActiveDate(leaf) {
    leaf = leaf || this.app.workspace.activeLeaf;
    if (!leaf) {
      this._clearActiveDate();
      return;
    }
    const file = leaf.view?.file;
    if (!(file instanceof TFile2)) {
      this._clearActiveDate();
      return;
    }
    const folderPrefix = this.plugin.settings.dailyFolder + "/";
    if (!file.path.startsWith(folderPrefix)) {
      this._clearActiveDate();
      return;
    }
    const match = file.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (match) {
      const newDate = match[1];
      if (newDate !== this.activeDate) {
        this._weatherCardDate = null;
        this._weatherSnapshot = null;
        this._weatherLoading = false;
        this._weatherError = false;
      }
      this.activeDate = newDate;
    } else {
      this._clearActiveDate();
    }
  }
  _clearActiveDate() {
    if (this.activeDate === null) return;
    this.activeDate = null;
    this._weatherCardDate = null;
    this._weatherSnapshot = null;
    this._weatherLoading = false;
    this._weatherError = false;
  }
  /* ----- Bulk weather backfill for all past dates ----- */
  async startWeatherBackfill() {
    const folderPath = this.plugin.settings.dailyFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return;
    const dateStrs = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile2) || child.extension !== "md") continue;
      const match = child.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!match) continue;
      const ds = match[0].replace(/\.md$/, "");
      if (!this.weather.hasCachedSnapshot(ds)) dateStrs.push(ds);
    }
    if (dateStrs.length === 0) {
      new Notice3(_l(this.plugin.settings.weatherLanguage, "s_backfillAllDone"));
      return;
    }
    const lang = this.plugin.settings.weatherLanguage;
    new Notice3(_l(lang, "s_backfillStarted", dateStrs.length));
    await this.weather.bulkBackfill(dateStrs, (done, total) => {
      if (done % 5 === 0 || done === total) {
        new Notice3(_l(lang, "s_backfillProgress", done, total));
      }
    });
    new Notice3(_l(lang, "s_backfillDone", dateStrs.length));
    this.render();
  }
};
var DaylineSettingsTab = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  async _refreshViews({ resetSource = false } = {}) {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    await Promise.all(leaves.map(async (leaf) => {
      const view = leaf.view;
      if (!view) return;
      if (resetSource) {
        view.monthCache?.clear();
        view._otdProvider?.invalidate();
        view._otdDotCache = null;
      }
      view._invalidateOverlayRequests?.();
      if (typeof view.refresh === "function") await view.refresh();
      view._syncNoteOverlays?.();
    }));
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const _s = (key, ...args) => _l(this.plugin.settings.weatherLanguage, key, ...args);
    containerEl.createEl("h2", { text: "Dayline" });
    containerEl.createEl("h3", { text: "\u{1F4D3} " + _s("s_dailyFolder") });
    new Setting(containerEl).setName(_s("s_dailyFolder")).setDesc(_s("s_dailyFolderDesc")).addSearch((cb) => {
      this.folderInput = cb;
      cb.setValue(this.plugin.settings.dailyFolder).setPlaceholder("Calendar/Daily").onChange(async (value) => {
        this.plugin.settings.dailyFolder = value.replace(/\/+$/, "");
        await this.plugin.saveSettings();
        await this._refreshViews({ resetSource: true });
      });
    }).addExtraButton((btn) => {
      btn.setIcon("folder-search").setTooltip(_s("s_browseFolders")).onClick(() => {
        new FolderSuggestModal(this.app, (path) => {
          this.plugin.settings.dailyFolder = path;
          this.plugin.saveSettings().then(() => this._refreshViews({ resetSource: true }));
          this.folderInput.setValue(path);
        }).open();
      });
    });
    new Setting(containerEl).setName(_s("s_thumbnailFilter")).setDesc(_s("s_thumbnailFilterDesc")).addDropdown(
      (dd) => dd.addOption("all", _s("s_thumbnailAll")).addOption("date-prefixed", _s("s_thumbnailDate")).setValue(this.plugin.settings.thumbnailFilter).onChange(async (value) => {
        this.plugin.settings.thumbnailFilter = value;
        await this.plugin.saveSettings();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view?.refresh) leaf.view.refresh();
      })
    );
    containerEl.createEl("h3", { text: t4(this.plugin.settings, "calendarDisplay") });
    new Setting(containerEl).setName(t4(this.plugin.settings, "showCalendarMood")).setDesc(t4(this.plugin.settings, "showCalendarMoodDesc")).addToggle((toggle) => toggle.setValue(this.plugin.settings.showCalendarMood !== false).onChange(async (value) => {
      this.plugin.settings.showCalendarMood = value;
      await this.plugin.saveSettings();
      await this._refreshViews();
    }));
    new Setting(containerEl).setName(t4(this.plugin.settings, "showCalendarWeatherCard")).setDesc(t4(this.plugin.settings, "showCalendarWeatherCardDesc")).addToggle((toggle) => toggle.setValue(this.plugin.settings.showCalendarWeatherCard !== false).onChange(async (value) => {
      this.plugin.settings.showCalendarWeatherCard = value;
      await this.plugin.saveSettings();
      await this._refreshViews();
    }));
    new Setting(containerEl).setName(t4(this.plugin.settings, "showCalendarWeatherBadge")).setDesc(t4(this.plugin.settings, "showCalendarWeatherBadgeDesc")).addToggle((toggle) => toggle.setValue(this.plugin.settings.showCalendarWeatherBadge !== false).onChange(async (value) => {
      this.plugin.settings.showCalendarWeatherBadge = value;
      await this.plugin.saveSettings();
      await this._refreshViews();
    }));
    containerEl.createEl("h3", { text: t4(this.plugin.settings, "journalSources") });
    new Setting(containerEl).setName(t4(this.plugin.settings, "journalSources")).setDesc(t4(this.plugin.settings, "journalSourcesDesc")).addTextArea((text) => {
      text.setValue(JSON.stringify(this.plugin.settings.journalSources || [], null, 2));
      text.inputEl.rows = 5;
      text.inputEl.addClass("calendar-sidebar-source-json");
      text.onChange(async (value) => {
        try {
          const parsed = JSON.parse(value || "[]");
          if (!Array.isArray(parsed)) throw new Error("Sources must be an array");
          this.plugin.settings.journalSources = parsed;
          await this.plugin.saveSettings();
          await this.plugin.journalIndex.refresh(this.plugin.settings);
          this.plugin.refreshJournalViews();
        } catch (_) {
          new Notice3("Journal sources must be a valid JSON array");
        }
      });
    });
    new Setting(containerEl).setName(t4(this.plugin.settings, "moodMetadataPath")).setDesc(t4(this.plugin.settings, "moodMetadataPathDesc")).addText((text) => text.setValue(this.plugin.settings.moodMetadataPath).setPlaceholder("Calendar/journal-metadata.json").onChange(async (value) => {
      const next = value.trim() || "Calendar/journal-metadata.json";
      this.plugin.settings.moodMetadataPath = next;
      await this.plugin.saveSettings();
      this.plugin.moodStore.configure(this.plugin.settings);
      await this.plugin.moodStore.load();
      await this.plugin.journalIndex.refresh(this.plugin.settings);
      this.plugin.refreshJournalViews();
    }));
    new Setting(containerEl).setName(t4(this.plugin.settings, "mirrorMood")).setDesc(t4(this.plugin.settings, "mirrorMoodDesc")).addToggle((toggle) => toggle.setValue(Boolean(this.plugin.settings.mirrorMoodToFrontmatter)).onChange(async (value) => {
      this.plugin.settings.mirrorMoodToFrontmatter = value;
      await this.plugin.saveSettings();
    }));
    new Setting(containerEl).setName(t4(this.plugin.settings, "reminder")).setDesc(t4(this.plugin.settings, "reminderDesc")).addToggle((toggle) => toggle.setValue(Boolean(this.plugin.settings.reminderEnabled)).onChange(async (value) => {
      this.plugin.settings.reminderEnabled = value;
      await this.plugin.saveSettings();
    })).addExtraButton((button) => button.setIcon("clock-3").setTooltip("Reminder hour").onClick(() => {
      const value = window.prompt("Reminder hour (0-23)", String(this.plugin.settings.reminderHour ?? 21));
      const hour = Number(value);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
        this.plugin.settings.reminderHour = hour;
        this.plugin.saveSettings();
      }
    }));
    new Setting(containerEl).setName(t4(this.plugin.settings, "journalTools")).setDesc(t4(this.plugin.settings, "journalToolsDesc")).addButton((button) => button.setButtonText(t4(this.plugin.settings, "openTimeline")).onClick(() => this.plugin.activateTimeline())).addButton((button) => button.setButtonText(t4(this.plugin.settings, "detectImports")).onClick(async () => {
      const result = await this.plugin.journalIndex.detectSources(this.plugin.settings);
      new Notice3(`${result.files} files, ${result.noDate.length} without a date`);
    }));
    containerEl.createEl("h3", { text: "\u{1F324}\uFE0F " + _s("s_weather") });
    new Setting(containerEl).setName(_s("s_weatherEnable")).setDesc(_s("s_weatherEnableDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.weatherEnabled).onChange(async (value) => {
        this.plugin.settings.weatherEnabled = value;
        await this.plugin.saveSettings();
        await this._refreshViews();
      })
    );
    new Setting(containerEl).setName(_s("s_latitude")).setDesc(_s("s_latitudeDesc")).addText(
      (text) => text.setPlaceholder("39.9042").setValue(String(this.plugin.settings.weatherLatitude)).onChange(async (value) => {
        this.plugin.settings.weatherLatitude = value.trim();
        await this.plugin.saveSettings();
        await this._refreshViews();
      })
    );
    new Setting(containerEl).setName(_s("s_longitude")).setDesc(_s("s_longitudeDesc")).addText(
      (text) => text.setPlaceholder("116.4074").setValue(String(this.plugin.settings.weatherLongitude)).onChange(async (value) => {
        this.plugin.settings.weatherLongitude = value.trim();
        await this.plugin.saveSettings();
        await this._refreshViews();
      })
    );
    new Setting(containerEl).setName(_s("s_locationName")).setDesc(_s("s_locationNameDesc")).addText(
      (text) => text.setPlaceholder(_s("s_locationName")).setValue(String(this.plugin.settings.weatherLocationName)).onChange(async (value) => {
        this.plugin.settings.weatherLocationName = value.trim();
        await this.plugin.saveSettings();
        await this._refreshViews();
      })
    );
    new Setting(containerEl).setName(_s("s_tempUnits")).setDesc(_s("s_tempUnitsDesc")).addDropdown(
      (dd) => dd.addOption("metric", _s("s_celsius")).addOption("imperial", _s("s_fahrenheit")).setValue(this.plugin.settings.weatherUnits).onChange(async (value) => {
        this.plugin.settings.weatherUnits = value;
        await this.plugin.saveSettings();
        await this._refreshViews();
      })
    );
    new Setting(containerEl).setName(t4(this.plugin.settings, "weatherTimezone")).setDesc(t4(this.plugin.settings, "weatherTimezoneDesc")).addText((text) => text.setPlaceholder("auto or Asia/Shanghai").setValue(String(this.plugin.settings.weatherTimezone || "auto")).onChange(async (value) => {
      this.plugin.settings.weatherTimezone = value.trim() || "auto";
      await this.plugin.saveSettings();
      await this._refreshViews();
    }));
    new Setting(containerEl).setName(_s("s_autoFetch")).setDesc(_s("s_autoFetchDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.weatherAutoFetch).onChange(async (value) => {
        this.plugin.settings.weatherAutoFetch = value;
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName(_s("s_cacheTtl")).setDesc(_s("s_cacheTtlDesc")).addText(
      (text) => text.setPlaceholder("2").setValue(String(this.plugin.settings.weatherTtlHours)).onChange(async (value) => {
        const n = parseInt(value, 10);
        this.plugin.settings.weatherTtlHours = isNaN(n) || n < 1 ? 2 : n;
        await this.plugin.saveSettings();
        await this._refreshViews();
      })
    );
    new Setting(containerEl).setName(t4(this.plugin.settings, "language")).setDesc(t4(this.plugin.settings, "languageDesc")).addDropdown(
      (dd) => dd.addOption("en", t4(this.plugin.settings, "english")).addOption("zh", t4(this.plugin.settings, "chinese")).setValue(this.plugin.settings.displayLanguage).onChange(async (value) => {
        this.plugin.settings.displayLanguage = value;
        this.plugin.settings.weatherLanguage = value;
        await this.plugin.saveSettings();
        this.display();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) {
          leaf.view._syncNoteOverlays();
          leaf.view.refresh();
        }
        this.plugin.refreshJournalViews();
      })
    );
    new Setting(containerEl).setName(_s("s_backfill")).setDesc(_s("s_backfillDesc")).addButton(
      (btn) => btn.setButtonText(_s("s_backfillBtn")).onClick(async () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) leaf.view.startWeatherBackfill();
      })
    );
    containerEl.createEl("h3", { text: "\u{1F4C5} " + _s("s_otd") });
    new Setting(containerEl).setName(_s("s_otdButton")).setDesc(_s("s_otdButtonDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.onThisDayButton).onChange(async (value) => {
        this.plugin.settings.onThisDayButton = value;
        await this.plugin.saveSettings();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) leaf.view.render();
      })
    );
    new Setting(containerEl).setName(_s("s_otdDot")).setDesc(_s("s_otdDotDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.onThisDayDot).onChange(async (value) => {
        this.plugin.settings.onThisDayDot = value;
        await this.plugin.saveSettings();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) leaf.view.refresh();
      })
    );
    new Setting(containerEl).setName(_s("s_otdExcerptMode")).setDesc(_s("s_otdExcerptModeDesc")).addDropdown(
      (dropdown) => dropdown.addOptions({
        "auto": _s("s_otdExcerptAuto"),
        "frontmatter": _s("s_otdExcerptFrontmatter"),
        "template": _s("s_otdExcerptTemplate"),
        "none": _s("s_otdExcerptNone")
      }).setValue(this.plugin.settings.onThisDayExcerptMode).onChange(async (value) => {
        this.plugin.settings.onThisDayExcerptMode = value;
        await this.plugin.saveSettings();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view?._otdProvider) leaf.view._otdProvider.invalidate();
        this.display();
      })
    );
    if (this.plugin.settings.onThisDayExcerptMode === "frontmatter") {
      new Setting(containerEl).setName(_s("s_otdExcerptKey")).setDesc(_s("s_otdExcerptKeyDesc")).addText(
        (text) => text.setValue(this.plugin.settings.onThisDayExcerptKey || "excerpt").onChange(async (value) => {
          this.plugin.settings.onThisDayExcerptKey = value;
          await this.plugin.saveSettings();
          const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
          if (leaf?.view?._otdProvider) leaf.view._otdProvider.invalidate();
        })
      );
    }
    if (this.plugin.settings.onThisDayExcerptMode === "template") {
      new Setting(containerEl).setName(_s("s_otdTemplate")).setDesc(_s("s_otdTemplateDesc")).addText(
        (text) => text.setValue(this.plugin.settings.onThisDayExcerptTemplate || "{body}").onChange(async (value) => {
          this.plugin.settings.onThisDayExcerptTemplate = value;
          await this.plugin.saveSettings();
          const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
          if (leaf?.view?._otdProvider) leaf.view._otdProvider.invalidate();
        })
      );
    }
    containerEl.createEl("h3", { text: "\u2699\uFE0F " + _s("s_exif") });
    new Setting(containerEl).setName(_s("s_exifEnable")).setDesc(_s("s_exifEnableDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showExif).onChange(async (value) => {
        this.plugin.settings.showExif = value;
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName(_s("s_exifGeocode")).setDesc(_s("s_exifGeocodeDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.exifReverseGeocode).onChange(async (value) => {
        this.plugin.settings.exifReverseGeocode = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
var FolderSuggestModal = class extends SuggestModal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  getSuggestions(query) {
    const folders = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder);
    if (!query) return folders;
    return folders.filter(
      (f) => f.path.toLowerCase().includes(query.toLowerCase())
    );
  }
  renderSuggestion(folder, el) {
    el.createEl("span", { text: folder.path });
  }
  onChooseSuggestion(folder) {
    this.onSubmit(folder.path);
  }
};
var OnThisDayModal = class {
  constructor(app, plugin, provider, month, day, entries) {
    this.app = app;
    this.plugin = plugin;
    this.provider = provider;
    this.month = month;
    this.day = day;
    this.entries = entries || [];
    this._requestToken = 0;
    this._closed = false;
    this._onKey = this._onKeyDown.bind(this);
  }
  open() {
    const lang = this.plugin.settings.weatherLanguage;
    this.backdrop = document.createElement("div");
    this.backdrop.className = "cal-otd-modal";
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.close();
    });
    const panel = document.createElement("div");
    panel.className = "cal-otd-panel";
    this.panel = panel;
    const header = panel.createDiv({ cls: "cal-otd-header" });
    header.createDiv({ cls: "cal-otd-header-title", text: _l(lang, "otd_title") });
    const nav = header.createDiv({ cls: "cal-otd-date-nav" });
    const prevDayBtn = nav.createDiv({ cls: "cal-otd-nav-btn", text: "\u25C0" });
    prevDayBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._navigateDate(-1);
    });
    const dateInput = nav.createEl("input", {
      type: "date",
      cls: "cal-otd-date-input",
      attr: { "aria-label": "Choose date" }
    });
    dateInput.addEventListener("change", () => {
      const parts = dateInput.value.split("-");
      if (parts.length === 3) {
        this.month = parseInt(parts[1]);
        this.day = parseInt(parts[2]);
        this._navigateDate(0);
      }
    });
    this.dateInput = dateInput;
    this._updateDateInput();
    const nextDayBtn = nav.createDiv({ cls: "cal-otd-nav-btn", text: "\u25B6" });
    nextDayBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._navigateDate(1);
    });
    const closeBtn = header.createDiv({ cls: "cal-otd-close", text: "\u2715" });
    closeBtn.addEventListener("click", () => this.close());
    this.bodyEl = panel.createDiv({ cls: "cal-otd-grid" });
    if (this.entries.length === 0) {
      const emptyMsg = this.bodyEl.createDiv({ cls: "cal-otd-empty-state" });
      emptyMsg.setText(_l(lang, "otd_noMemories"));
    } else {
      this._renderGrid();
    }
    this.backdrop.appendChild(panel);
    document.body.appendChild(this.backdrop);
    document.addEventListener("keydown", this._onKey);
  }
  close() {
    this._closed = true;
    this._requestToken++;
    document.removeEventListener("keydown", this._onKey);
    if (this.backdrop && this.backdrop.parentElement) {
      this.backdrop.parentElement.removeChild(this.backdrop);
    }
  }
  _onKeyDown(e) {
    if (e.key === "Escape") {
      this.close();
    } else if (e.key === "ArrowLeft") {
      this._navigateDate(-1);
    } else if (e.key === "ArrowRight") {
      this._navigateDate(1);
    }
  }
  async _navigateDate(delta) {
    if (!this.provider) return;
    const d = new Date(2e3, this.month - 1, this.day + delta);
    this.month = d.getMonth() + 1;
    this.day = d.getDate();
    const lang = this.plugin.settings.weatherLanguage;
    this._updateDateInput();
    this.bodyEl.empty();
    const loadingEl = this.bodyEl.createDiv({ cls: "cal-otd-empty-state" });
    loadingEl.setText(_l(lang, "loading"));
    const requestToken = ++this._requestToken;
    try {
      this.entries = await this.provider.getEntries(this.month, this.day);
      if (this._closed || requestToken !== this._requestToken) return;
      this.bodyEl.empty();
      if (this.entries.length === 0) {
        const emptyMsg = this.bodyEl.createDiv({ cls: "cal-otd-empty-state" });
        emptyMsg.setText(_l(lang, "otd_noMemories"));
      } else {
        this._renderGrid();
      }
    } catch (e) {
      if (this._closed || requestToken !== this._requestToken) return;
      this.bodyEl.empty();
      const errEl = this.bodyEl.createDiv({ cls: "cal-otd-empty-state" });
      errEl.setText(_l(lang, "unavailable"));
    }
  }
  _updateDateInput() {
    if (!this.dateInput) return;
    const year = this.month === 2 && this.day === 29 ? 2e3 : (/* @__PURE__ */ new Date()).getFullYear();
    this.dateInput.value = `${year}-${String(this.month).padStart(2, "0")}-${String(this.day).padStart(2, "0")}`;
  }
  _renderGrid() {
    this.bodyEl.empty();
    const lang = this.plugin.settings.weatherLanguage;
    for (const entry of this.entries) {
      const card = this.bodyEl.createDiv({ cls: "cal-otd-wall-card" });
      const badge = card.createDiv({ cls: "cal-otd-wall-badge" });
      badge.setText(_l(lang, "otd_yearsAgo", (/* @__PURE__ */ new Date()).getFullYear() - entry.year) + `  \xB7  ${entry.year}`);
      if (entry.images && entry.images.length > 0) {
        const photo = card.createDiv({ cls: "cal-otd-wall-photo" });
        this._setPhotoBackground(photo, entry.images[0], entry.dateStr);
      } else if (entry.excerpt) {
        const textBlock = card.createDiv({ cls: "cal-otd-wall-text" });
        textBlock.setText(entry.excerpt);
      }
      if (entry.images && entry.images.length > 0 && entry.excerpt) {
        card.createDiv({ cls: "cal-otd-wall-excerpt", text: entry.excerpt });
      }
      card.addEventListener("click", () => {
        this.close();
        this.app.workspace.openLinkText(entry.dateStr, this.plugin.settings.dailyFolder, false);
      });
    }
  }
  _setPhotoBackground(bgEl, imageLink, dateStr) {
    try {
      const sourcePath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      this.plugin.thumbnailService.load(imageLink, sourcePath).then((result) => {
        if (result && bgEl.isConnected) bgEl.style.backgroundImage = `url(${result.url})`;
      });
    } catch (e) {
    }
  }
};
var CreateNoteModal = class extends Modal2 {
  constructor(app, dateStr, onConfirm) {
    super(app);
    this.dateStr = dateStr;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Create Daily Note" });
    contentEl.createEl("p", { text: `No daily note found for ${this.dateStr}. Create one?` });
    const btnDiv = contentEl.createDiv({ cls: "modal-button-container" });
    btnDiv.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const confirmBtn = btnDiv.createEl("button", { text: "Create", cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }
  onClose() {
    if (this._exifObservers) {
      for (const obs of this._exifObservers.values()) obs.disconnect();
      this._exifObservers.clear();
    }
    const { contentEl } = this;
    contentEl.empty();
  }
};
var IMAGE_EXTS = ["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "avif", "tiff", "tif", "bmp"];
function _formatDate(d, timezone) {
  return formatDateInTimeZone2(d, timezone);
}
var SVG_ICONS = {
  "clear-day.svg": `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="clear-day"><g id="Sun"><circle id="Core" cx="64" cy="63.9999" r="19.5" fill="url(#a)" stroke="#F8AF18"/><g id="Rays"><path d="M61 19C61 17.3431 62.3431 16 64 16C65.6568 16 67 17.3431 67 19V33C67 34.6569 65.6568 36 64 36C62.3431 36 61 34.6569 61 33V19Z" fill="#F8AF18"/><path d="M93.6985 30.0589C94.87 28.8873 96.7696 28.8873 97.9411 30.0589C99.1127 31.2304 99.1127 33.1299 97.9411 34.3015L88.0416 44.201C86.8701 45.3726 84.9706 45.3726 83.799 44.201C82.6274 43.0294 82.6274 41.1299 83.799 39.9584L93.6985 30.0589Z" fill="#F8AF18"/><path d="M109 61C110.657 61 112 62.3432 112 64C112 65.6569 110.657 67 109 67H95C93.3431 67 92 65.6569 92 64C92 62.3432 93.3431 61 95 61H109Z" fill="#F8AF18"/><path d="M97.9411 93.6985C99.1127 94.8701 99.1127 96.7696 97.9411 97.9411C96.7696 99.1127 94.8701 99.1127 93.6985 97.9411L83.799 88.0416C82.6274 86.8701 82.6274 84.9706 83.799 83.799C84.9706 82.6274 86.8701 82.6274 88.0416 83.799L97.9411 93.6985Z" fill="#F8AF18"/><path d="M61 95C61 93.3431 62.3431 92 64 92C65.6568 92 67 93.3431 67 95V109C67 110.657 65.6568 112 64 112C62.3431 112 61 110.657 61 109V95Z" fill="#F8AF18"/><path d="M39.9584 83.799C41.1299 82.6274 43.0294 82.6274 44.201 83.799C45.3726 84.9706 45.3726 86.8701 44.201 88.0416L34.3015 97.9411C33.1299 99.1127 31.2304 99.1127 30.0589 97.9411C28.8873 96.7696 28.8873 94.87 30.0589 93.6985L39.9584 83.799Z" fill="#F8AF18"/><path d="M33 61C34.6569 61 36 62.3431 36 64C36 65.6568 34.6569 67 33 67H19C17.3431 67 16 65.6568 16 64C16 62.3431 17.3431 61 19 61H33Z" fill="#F8AF18"/><path d="M44.201 39.9584C45.3726 41.1299 45.3726 43.0294 44.201 44.201C43.0294 45.3726 41.1299 45.3726 39.9584 44.201L30.0589 34.3015C28.8873 33.1299 28.8873 31.2305 30.0589 30.0589C31.2305 28.8873 33.1299 28.8873 34.3015 30.0589L44.201 39.9584Z" fill="#F8AF18"/></g></g></g><defs><linearGradient id="a" x1="64" y1="43.9999" x2="64" y2="83.9999" gradientUnits="userSpaceOnUse"><stop stop-color="#FBBF24"/><stop offset="1" stop-color="#F8AF18"/></linearGradient></defs></svg>')}`,
  "partly-cloudy-day.svg": `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#pcc)"><g id="Sky"><g id="Sun"><circle id="Core" cx="39" cy="51" r="8.5" fill="url(#pcg1)" stroke="#F8AF18"/><g id="Rays"><path d="M37.6875 31.3125C37.6875 30.5876 38.2751 30 39 30C39.7249 30 40.3125 30.5876 40.3125 31.3125V37.4375C40.3125 38.1624 39.7249 38.75 39 38.75C38.2751 38.75 37.6875 38.1624 37.6875 37.4375V31.3125Z" fill="#F8AF18"/><path d="M51.9931 36.1508C52.5056 35.6382 53.3367 35.6382 53.8492 36.1508C54.3618 36.6633 54.3618 37.4943 53.8492 38.0069L49.5182 42.3379C49.0056 42.8505 48.1746 42.8505 47.6621 42.3379C47.1495 41.8254 47.1495 40.9944 47.6621 40.4818L51.9931 36.1508Z" fill="#F8AF18"/><path d="M58.6875 49.6875C59.4124 49.6875 60 50.2751 60 51C60 51.7249 59.4124 52.3125 58.6875 52.3125H52.5625C51.8376 52.3125 51.25 51.7249 51.25 51C51.25 50.2751 51.8376 49.6875 52.5625 49.6875H58.6875Z" fill="#F8AF18"/><path d="M53.8492 63.9931C54.3618 64.5057 54.3618 65.3367 53.8492 65.8492C53.3367 66.3618 52.5056 66.3618 51.9931 65.8492L47.6621 61.5182C47.1495 61.0057 47.1495 60.1746 47.6621 59.6621C48.1746 59.1495 49.0057 59.1495 49.5182 59.6621L53.8492 63.9931Z" fill="#F8AF18"/><path d="M37.6875 64.5625C37.6875 63.8376 38.2751 63.25 39 63.25C39.7249 63.25 40.3125 63.8376 40.3125 64.5625V70.6875C40.3125 71.4124 39.7249 72 39 72C38.2751 72 37.6875 71.4124 37.6875 70.6875V64.5625Z" fill="#F8AF18"/><path d="M28.4818 59.6621C28.9943 59.1495 29.8254 59.1495 30.3379 59.6621C30.8505 60.1746 30.8505 61.0056 30.3379 61.5182L26.0069 65.8492C25.4943 66.3618 24.6633 66.3618 24.1508 65.8492C23.6382 65.3367 23.6382 64.5056 24.1508 63.9931L28.4818 59.6621Z" fill="#F8AF18"/><path d="M25.4375 49.6875C26.1624 49.6875 26.75 50.2751 26.75 51C26.75 51.7249 26.1624 52.3125 25.4375 52.3125H19.3125C18.5876 52.3125 18 51.7249 18 51C18 50.2751 18.5876 49.6875 19.3125 49.6875H25.4375Z" fill="#F8AF18"/><path d="M30.3379 40.4818C30.8505 40.9944 30.8505 41.8254 30.3379 42.3379C29.8254 42.8505 28.9944 42.8505 28.4818 42.3379L24.1508 38.0069C23.6382 37.4944 23.6382 36.6633 24.1508 36.1508C24.6633 35.6382 25.4944 35.6382 26.0069 36.1508L30.3379 40.4818Z" fill="#F8AF18"/></g></g><g id="Clouds"><g id="Cloud"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#pcg2)" stroke="#E6EFFC"/></g></g></g></g><defs><linearGradient id="pcg1" x1="39" y1="42" x2="39" y2="60" gradientUnits="userSpaceOnUse"><stop stop-color="#FBBF24"/><stop offset="1" stop-color="#F8AF18"/></linearGradient><linearGradient id="pcg2" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="pcc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
  "overcast.svg": `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#ovc)"><g id="Sky"><g id="Clouds"><g id="Secondary Cloud"><path d="M83.8392 48.6934C86.2444 44.9584 91.2146 43.529 95.3177 45.1768C99.3609 46.8006 101.814 51.1888 100.71 55.4365L100.54 56.0898L101.215 56.0615C104.496 55.924 107.5 58.4646 107.5 61.7744C107.5 64.9759 104.669 67.4999 101.489 67.5H74.9769C71.7679 67.5008 68.8449 65.1182 68.5287 61.9072C68.2136 58.7068 70.6168 55.8414 73.764 55.2705L74.2552 55.1816L74.1674 54.6904C73.7734 52.4931 74.8117 50.2493 76.6849 49.0273C78.6105 47.7713 81.177 47.7069 83.1683 48.8564L83.5814 49.0938L83.8392 48.6934Z" fill="url(#ovg1)" stroke="#94A3B8"/></g><g id="Cloud"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#ovg2)" stroke="#E6EFFC"/></g></g></g></g><defs><linearGradient id="ovg1" x1="88.0002" y1="44" x2="88.0002" y2="68" gradientUnits="userSpaceOnUse"><stop stop-color="#B0BCCD"/><stop offset="1" stop-color="#94A3B8"/></linearGradient><linearGradient id="ovg2" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="ovc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
  "fog.svg": `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#fc)"><g id="Clouds"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#fg1)" stroke="#E6EFFC"/></g><g id="Precipitation"><path d="M40 95H88" stroke="#E2E8F0" stroke-width="3" stroke-linecap="round"/><path d="M40 103H88" stroke="#E2E8F0" stroke-width="3" stroke-linecap="round"/></g></g><defs><linearGradient id="fg1" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="fc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
  "drizzle.svg": `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#dzc)"><g id="Clouds"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#dzg1)" stroke="#E6EFFC"/></g><g id="Precipitation"><path d="M52 95V98" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/><path d="M64 87V90" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/><path d="M76 95V98" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/></g></g><defs><linearGradient id="dzg1" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="dzc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
  "rain.svg": `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#rc)"><g id="Clouds"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#rg1)" stroke="#E6EFFC"/></g><g id="Precipitation"><path d="M52 91V103" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/><path d="M64 83V95" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/><path d="M76 91V103" stroke="#0A5AD4" stroke-width="4" stroke-linecap="round"/></g></g><defs><linearGradient id="rg1" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="rc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
  "snow.svg": `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#snc)"><g id="Clouds"><path d="M55.2623 48.4746C60.1227 40.6111 70.2975 37.38 78.8151 40.9434C87.3214 44.5023 92.138 54.0026 89.903 62.9648L89.7418 63.6143L90.4108 63.585C97.4203 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7717 88.4997 90.9772 88.5H37.9537C31.1275 88.5018 25.2029 83.1709 24.5592 76.3604C23.9158 69.5518 28.7369 63.2124 35.443 61.9453L35.9264 61.8535L35.8424 61.3691C35.0256 56.6239 37.1258 51.7168 41.1051 49.0127C45.0951 46.3014 50.4459 46.1537 54.5797 48.6396L55.0026 48.8945L55.2623 48.4746Z" fill="url(#sng1)" stroke="#E6EFFC"/></g><g id="Snowflakes"><path d="M52.578 98.366l-1.205-.689c.106-.444.105-.908-.003-1.353l1.208-.69c.095-.054.18-.126.247-.214.067-.087.117-.186.146-.292.028-.107.036-.218.021-.326a.72.72 0 00-.106-.31.63.63 0 00-.514-.39.63.63 0 00-.639.084L51.528 94.876c-.335-.317-.741-.55-1.184-.676V92.82a.62.62 0 00-.187-.582.647.647 0 00-.876 0 .62.62 0 00-.187.582v1.38c-.442.128-.848.36-1.185.674L47.266 94.185a.63.63 0 00-.639-.084.63.63 0 00-.514.39.72.72 0 00-.106.31.692.692 0 00.021.326.62.62 0 00.146.293c.068.087.152.16.248.214l1.204.688c-.106.445-.105.909.003 1.353l-1.208.69a.632.632 0 00-.247.214.62.62 0 00-.146.293.692.692 0 00-.021.326.72.72 0 00.106.31.63.63 0 00.514.39c.216.057.445.027.639-.084l1.206-.69c.334.318.74.55 1.184.675v1.382a.62.62 0 00.187.582.647.647 0 00.876 0 .62.62 0 00.187-.582v-1.382c.441-.13.847-.36 1.184-.674l1.206.69a.63.63 0 00.639.084.63.63 0 00.514-.39.72.72 0 00.106-.31.692.692 0 00-.021-.326.62.62 0 00-.146-.293.632.632 0 00-.247-.214zm-4.712-.28a.75.75 0 01-.37-.32.785.785 0 01-.096-.384.69.69 0 01.033-.284.66.66 0 01.159-.265.721.721 0 011.03-.02.78.78 0 01.37.32c.082.143.125.302.126.464 0 .162-.044.321-.126.464a.721.721 0 01-1.03-.02.78.78 0 01-.096.045zm15.002.28l-1.205-.689c.106-.444.105-.908-.003-1.353l1.208-.69c.095-.054.18-.126.247-.214.067-.087.117-.186.146-.292.028-.107.036-.218.021-.326a.72.72 0 00-.106-.31.63.63 0 00-.514-.39.63.63 0 00-.639.084L66.528 94.876c-.335-.317-.741-.55-1.184-.676V92.82a.62.62 0 00-.187-.582.647.647 0 00-.876 0 .62.62 0 00-.187.582v1.38c-.442.128-.848.36-1.185.674L62.266 94.185a.63.63 0 00-.639-.084.63.63 0 00-.514.39.72.72 0 00-.106.31.692.692 0 00.021.326.62.62 0 00.146.293c.068.087.152.16.248.214l1.204.688c-.106.445-.105.909.003 1.353l-1.208.69a.632.632 0 00-.247.214.62.62 0 00-.146.293.692.692 0 00-.021.326.72.72 0 00.106.31.63.63 0 00.514.39c.216.057.445.027.639-.084l1.206-.69c.334.318.74.55 1.184.675v1.382a.62.62 0 00.187.582.647.647 0 00.876 0 .62.62 0 00.187-.582v-1.382c.441-.13.847-.36 1.184-.674l1.206.69a.63.63 0 00.639.084.63.63 0 00.514-.39.72.72 0 00.106-.31.692.692 0 00-.021-.326.62.62 0 00-.146-.293.632.632 0 00-.247-.214zm-4.712-.28a.75.75 0 01-.37-.32.785.785 0 01-.096-.384.69.69 0 01.033-.284.66.66 0 01.159-.265.721.721 0 011.03-.02.78.78 0 01.37.32c.082.143.125.302.126.464 0 .162-.044.321-.126.464a.721.721 0 01-1.03-.02.78.78 0 01-.096.045zm15.002.28l-1.205-.689c.106-.444.105-.908-.003-1.353l1.208-.69c.095-.054.18-.126.247-.214.067-.087.117-.186.146-.292.028-.107.036-.218.021-.326a.72.72 0 00-.106-.31.63.63 0 00-.514-.39.63.63 0 00-.639.084L81.528 94.876c-.335-.317-.741-.55-1.184-.676V92.82a.62.62 0 00-.187-.582.647.647 0 00-.876 0 .62.62 0 00-.187.582v1.38c-.442.128-.848.36-1.185.674L77.266 94.185a.63.63 0 00-.639-.084.63.63 0 00-.514.39.72.72 0 00-.106.31.692.692 0 00.021.326.62.62 0 00.146.293c.068.087.152.16.248.214l1.204.688c-.106.445-.105.909.003 1.353l-1.208.69a.632.632 0 00-.247.214.62.62 0 00-.146.293.692.692 0 00-.021.326.72.72 0 00.106.31.63.63 0 00.514.39c.216.057.445.027.639-.084l1.206-.69c.334.318.74.55 1.184.675v1.382a.62.62 0 00.187.582.647.647 0 00.876 0 .62.62 0 00.187-.582v-1.382c.441-.13.847-.36 1.184-.674l1.206.69a.63.63 0 00.639.084.63.63 0 00.514-.39.72.72 0 00.106-.31.692.692 0 00-.021-.326.62.62 0 00-.146-.293.632.632 0 00-.247-.214zm-4.712-.28a.75.75 0 01-.37-.32.785.785 0 01-.096-.384.69.69 0 01.033-.284.66.66 0 01.159-.265.721.721 0 011.03-.02.78.78 0 01.37.32c.082.143.125.302.126.464 0 .162-.044.321-.126.464a.721.721 0 01-1.03-.02.78.78 0 01-.096.045z" fill="#86C3DB"/></g></g><defs><linearGradient id="sng1" x1="64.0008" y1="39" x2="64.0008" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><clipPath id="snc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`,
  "thunderstorms.svg": `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#tsc)"><g id="Clouds"><path d="M55.2625 48.4746C60.1228 40.6111 70.2976 37.38 78.8152 40.9434C87.3215 44.5023 92.1381 54.0026 89.9031 62.9648L89.7419 63.6143L90.4109 63.585C97.4205 63.2791 103.5 68.9917 103.5 76.0283C103.5 82.8395 97.7719 88.4997 90.9773 88.5H37.9539C31.1276 88.5018 25.203 83.1709 24.5593 76.3604C23.9159 69.5518 28.7371 63.2124 35.4431 61.9453L35.9265 61.8535L35.8425 61.3691C35.0258 56.6239 37.1259 51.7168 41.1052 49.0127C45.0952 46.3014 50.4461 46.1537 54.5798 48.6396L55.0027 48.8945L55.2625 48.4746Z" fill="url(#tsg1)" stroke="#E6EFFC"/></g><g id="Lightning"><path d="M71.1729 68.5L63.5566 83.041L63.1729 83.7725H75.002L56.9521 107.892L60.4893 91.0117L60.6162 90.4092H52.7041L60.3555 68.5H71.1729Z" fill="url(#tsg2)" stroke="#F6A823"/></g></g><defs><linearGradient id="tsg1" x1="64.0009" y1="39" x2="64.0009" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="#F3F7FE"/><stop offset="1" stop-color="#E6EFFC"/></linearGradient><linearGradient id="tsg2" x1="64.528" y1="66.0377" x2="84.4144" y2="77.4572" gradientUnits="userSpaceOnUse"><stop stop-color="#F7B23B"/><stop offset="1" stop-color="#F6A823"/></linearGradient><clipPath id="tsc"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>')}`
};
function _iconUrl(iconFile) {
  return SVG_ICONS[iconFile] || "";
}
var plugin_default = DaylinePlugin;

// src/main.ts
module.exports = plugin_default;
