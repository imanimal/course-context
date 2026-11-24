// config.json: the one file that says what to read, where to write, and the student's own layer.
// Reference: docs/config.md and schema/config.schema.json. Every mutation here is idempotent:
// adding a source or destination with an id that exists replaces that entry.
import fs from "node:fs";
import crypto from "node:crypto";
import { configPath, readJSON, writeAtomic, home, ensureDir } from "./paths.js";
import { CCError } from "../core/errors.js";
import { localZone, validZone } from "../core/dates.js";
import { SOURCES } from "../sources/index.js";
import { DESTINATIONS } from "../destinations/index.js";
import { slug } from "../core/match.js";

export const DEFAULT_OPTIONS = { horizonDays: 14, pastDays: 45, announcementDays: 14, maxSummary: 1200, folderName: "Course Context" };

export function blankConfig(tz) {
  return { version: 1, timezone: tz && validZone(tz) ? tz : localZone(), sources: [], destinations: [], server: { host: "127.0.0.1", port: 8787, token: newToken() }, user: { classes: {}, items: {}, tasks: [] }, options: { ...DEFAULT_OPTIONS } };
}

export const newToken = () => crypto.randomBytes(24).toString("base64url");

export function exists() { return fs.existsSync(configPath()); }

/** Load config; with `create`, make a blank one when missing. */
export function load({ create = false } = {}) {
  let c = readJSON(configPath(), null);
  if (!c) {
    if (!create) throw new CCError("CONFIG_MISSING", `No config at ${configPath()}.`, { hint: "Run: course-context init (or course-context setup)." });
    c = blankConfig();
    save(c);
  }
  return normalize(c);
}

export function normalize(c) {
  c.version = c.version || 1;
  if (!c.timezone || !validZone(c.timezone)) c.timezone = localZone();
  c.sources = Array.isArray(c.sources) ? c.sources : [];
  c.destinations = Array.isArray(c.destinations) ? c.destinations : [];
  c.server = { host: "127.0.0.1", port: 8787, ...(c.server || {}) };
  if (!c.server.token) c.server.token = newToken();
  c.user = { classes: {}, items: {}, tasks: [], ...(c.user || {}) };
  c.options = { ...DEFAULT_OPTIONS, ...(c.options || {}) };
  return c;
}

export function save(c) {
  ensureDir(home());
  writeAtomic(configPath(), JSON.stringify(c, null, 2) + "\n", 0o600);
  try { fs.chmodSync(configPath(), 0o600); } catch { /* windows */ }
}

/** Make an id from type + host/url/path: "canvas-ucsb", "ics-moodle-school-edu". */
export function makeId(kind, entry, taken) {
  const hint = entry.host || entry.url || entry.remote || entry.path || entry.email || entry.username || "";
  let h = "";
  try { h = new URL(/^\w+:\/\//.test(hint) ? hint.replace(/^webcals?:/, "https:") : "https://" + hint).host.split(".").filter((x) => !["www", "com", "edu", "org", "net", "instructure"].includes(x))[0] || ""; } catch { h = ""; }
  const base = slug([entry.type, h].filter(Boolean).join("-"), 30);
  let id = base, k = 2;
  while (taken.includes(id)) id = `${base}-${k++}`;
  return id;
}

function validateEntry(kind, e) {
  const reg = kind === "source" ? SOURCES : DESTINATIONS;
  const mod = reg[e.type];
  if (!mod) throw new CCError("USAGE", `Unknown ${kind} type "${e.type}".`, { hint: `Valid types: ${Object.keys(reg).join(", ")}. Run: course-context types` });
  const missing = Object.entries(mod.fields || {}).filter(([k, f]) => f.required && (e[k] == null || e[k] === "")).map(([k]) => k);
  if (missing.length) throw new CCError("NEEDS_INPUT", `${kind} ${e.type} needs: ${missing.join(", ")}.`, { hint: missing.map((k) => `${k}: ${mod.fields[k].about}`).join(" | "), missing });
  return mod;
}

/** Add or replace a source/destination. Returns {entry, created}. */
export function upsert(c, kind, entry) {
  const list = kind === "source" ? c.sources : c.destinations;
  validateEntry(kind, entry);
  let i = entry.id ? list.findIndex((x) => x.id === entry.id) : -1;
  if (i < 0 && !entry.id) {
    // same type and same target → update instead of duplicating (agents re-run setup)
    const key = (x) => [x.type, x.host, x.url, x.path, x.remote, x.email, x.username].map((v) => (v == null ? "" : String(v).toLowerCase())).join("|");
    i = list.findIndex((x) => key(x) === key(entry));
  }
  if (i >= 0) { const merged = { ...list[i], ...entry, id: list[i].id }; for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k]; list[i] = merged; return { entry: merged, created: false }; }
  const e = { ...entry, id: entry.id || makeId(kind, entry, list.map((x) => x.id)) };
  for (const k of Object.keys(e)) if (e[k] === null || e[k] === undefined) delete e[k];
  list.push(e);
  return { entry: e, created: true };
}

export function remove(c, kind, id) {
  const list = kind === "source" ? c.sources : c.destinations;
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new CCError("NOT_FOUND", `No ${kind} with id ${id}.`, { hint: `Run: course-context ${kind === "source" ? "source" : "dest"} list` });
  list.splice(i, 1);
}

/** Config with secret values masked (for status output and MCP). */
export function redacted(c) {
  const secretKeys = new Set(["token", "password", "cookie", "secret", "key", "refreshToken", "clientSecret", "apiKey"]);
  const mask = (v, k) => {
    if (v == null) return v;
    if (typeof v === "string") {
      if (/^(env|file|cmd|keychain):/.test(v)) return v;
      if (secretKeys.has(k) || (k === "url" && /token|key=|secret|\/feeds\/|export_execute|private/i.test(v))) return v.length > 8 ? v.slice(0, 4) + "…(" + v.length + " chars)" : "…";
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => mask(x, k));
    if (typeof v === "object") { const o = {}; for (const [kk, vv] of Object.entries(v)) o[kk] = mask(vv, kk); return o; }
    return v;
  };
  return mask(c, "");
}
