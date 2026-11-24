// Shared destination helpers. A destination: { type, title, kind: "files"|"todo"|"event", fields, push(ctx) }.
// push ctx: { cfg, files, context, todos, state (persistent per-destination object, saved after push),
//             secret(ref, field), http (Node fetch wrapper), log(msg), dryRun, home }
// Return: { written: n, removed: n, unchanged: n, detail?: string, completedRemotely?: string[] }
// Safety rule for file destinations: only paths listed in our manifest are ever overwritten or deleted.
import crypto from "node:crypto";

export const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Content with snapshot timestamps removed, so "nothing changed but the clock" hashes the same. */
export const stable = (s) => String(s).replace(/^.*(generatedAt|fetchedAt|Snapshot taken|DTSTAMP|COMPLETED:|LAST-MODIFIED|SEQUENCE|taken \d{4}-|made by course-context).*$/gm, "");

/** Plan writes/removals against the last manifest {path: hash}. With o.stable, timestamp-only changes are skipped. */
export function plan(files, manifest = {}, o = {}) {
  const write = [], keep = {}, remove = [];
  for (const [p, body] of Object.entries(files)) { const h = sha(o.stable ? stable(body) : body); keep[p] = h; if (manifest[p] !== h) write.push(p); }
  for (const p of Object.keys(manifest)) if (!(p in files)) remove.push(p);
  return { write, remove, manifest: keep, unchanged: Object.keys(files).length - write.length };
}

/** Join a base folder and a relative path with forward slashes, no leading slash duplication. */
export const join = (...xs) => xs.filter((x) => x != null && x !== "").map((x, i) => (i === 0 ? String(x).replace(/\/+$/, "") : String(x).replace(/^\/+|\/+$/g, ""))).join("/");

/** Dropbox-API-Arg and similar headers must be ASCII: escape everything else as \uXXXX. */
export const asciiJSON = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export const mime = (p) => (p.endsWith(".md") ? "text/markdown; charset=utf-8" : p.endsWith(".json") ? "application/json" : p.endsWith(".ics") ? "text/calendar; charset=utf-8" : p.endsWith(".txt") ? "text/plain; charset=utf-8" : "application/octet-stream");
