// Where course-context keeps its files. One directory on every OS so agents can find it:
//   $COURSE_CONTEXT_HOME, else ~/.course-context
// Contents: config.json (0600, may hold secrets) · snapshot.json (last context) · state.json (last sync report,
// per-source last good data, oauth token cache) · inbox/ (snapshots received from the extension) · logs/
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function home() {
  return process.env.COURSE_CONTEXT_HOME ? path.resolve(expand(process.env.COURSE_CONTEXT_HOME)) : path.join(os.homedir(), ".course-context");
}
export const configPath = () => process.env.COURSE_CONTEXT_CONFIG ? path.resolve(expand(process.env.COURSE_CONTEXT_CONFIG)) : path.join(home(), "config.json");
export const snapshotPath = () => path.join(home(), "snapshot.json");
export const statePath = () => path.join(home(), "state.json");
export const inboxDir = () => path.join(home(), "inbox");
export const logDir = () => path.join(home(), "logs");
export const renderDir = () => path.join(home(), "render");

/** "~/x" → "/home/me/x"; also expands $VAR and %VAR%. */
export function expand(p) {
  if (!p) return p;
  let s = String(p);
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = path.join(os.homedir(), s.slice(1));
  s = s.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (m, k) => process.env[k] ?? m).replace(/%([A-Z_][A-Z0-9_]*)%/gi, (m, k) => process.env[k] ?? m);
  return s;
}

export function ensureDir(d, mode = 0o700) { fs.mkdirSync(d, { recursive: true, mode }); return d; }

/** Write a file atomically (temp + rename). */
export function writeAtomic(file, body, mode) {
  ensureDir(path.dirname(file));
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, body, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

export function readJSON(file, fallback = null) {
  try { return JSON.parse(stripJsonComments(fs.readFileSync(file, "utf8"))); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}

/** Remove // and /* *\/ comments and trailing commas (JSONC → JSON). Strings are respected. */
export function stripJsonComments(s) {
  let out = "", i = 0, q = false;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (q) { out += c; if (c === "\\") { out += n; i += 2; continue; } if (c === '"') q = false; i++; continue; }
    if (c === '"') { q = true; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export const hasComments = (s) => stripJsonComments(s).replace(/\s+/g, "") !== s.replace(/,(\s*[}\]])/g, "$1").replace(/\s+/g, "");
