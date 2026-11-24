// Escape hatches so any data can feed the context:
//   manual   – a JSON file (or inline `data`) the student or their AI keeps by hand
//   command  – any program that prints source JSON on stdout (scrapers, other tools)
//   url      – fetch source JSON or a context.json (cc/1) over HTTP
//   snapshot – merge another context.json (from the browser extension, another computer, a classmate's shared syllabus)
//   module   – a JS module path exporting { fetch(cfg, ctx) }
// Source JSON (docs/sources.md#source-json): { classes: [{id?, code, name?, ...}], items: [{title, class?, due?, kind?, url?, points?, status?, summary?}], announcements?: [...] }
import { getJSON } from "../core/fetchutil.js";
import { parseUserDate, parseInstant } from "../core/dates.js";
import { slug } from "../core/match.js";
import { CCError } from "../core/errors.js";

/** Normalize loose source JSON (or a cc/1 context) into a source result. */
export function normalize(raw, sourceId, type, tz) {
  if (!raw || typeof raw !== "object") throw new CCError("PARSE", `${type} source ${sourceId} did not produce a JSON object.`);
  if (raw.schema && /^cc\//.test(raw.schema)) {
    return {
      classes: (raw.classes || []).map((c) => ({ ...c, matchCode: c.code, sources: undefined })),
      items: (raw.items || []).filter((i) => i.source !== "user").map((i) => ({ ...i, refs: [i.id], due: i.due ? parseInstant(i.due.at) : null, unlockAt: parseInstant(i.unlockAt), lockAt: parseInstant(i.lockAt), lateDue: parseInstant(i.lateDue), submittedAt: parseInstant(i.submittedAt), status: i.status === "done" ? "todo" : i.status, user: undefined, dueCandidates: undefined, mentionedDates: undefined })),
      announcements: (raw.announcements || []).map((a) => ({ ...a, postedAt: parseInstant(a.postedAt) })),
    };
  }
  const classes = (raw.classes || []).map((c) => ({ id: c.id || `${type}:${sourceId}/${slug(c.code || c.name)}`, code: c.code || c.name, name: c.name || c.code, matchCode: c.code || c.name, instructors: c.instructors, meeting: c.meeting, url: c.url, links: c.links, policies: c.policies, syllabus: c.syllabus, gradeWeights: c.gradeWeights }));
  const items = (raw.items || []).map((i, k) => ({
    id: i.id || `${type}:${sourceId}/${slug((i.class || "") + "-" + (i.title || k), 80)}`, refs: i.refs || [], classId: i.classId || null, classCode: i.class || i.classCode || null,
    kind: i.kind, title: i.title, url: i.url || null, due: parseUserDate(i.due, tz), unlockAt: parseUserDate(i.unlockAt, tz), lockAt: parseUserDate(i.lockAt, tz),
    points: i.points ?? null, score: i.score ?? null, status: i.status || "todo", summary: i.summary || i.notes || "", links: i.links || [],
  }));
  const announcements = (raw.announcements || []).map((a, k) => ({ id: a.id || `${type}:${sourceId}/a${k}`, classCode: a.class || null, classId: a.classId || null, title: a.title, postedAt: parseUserDate(a.postedAt, tz), body: a.body || "", url: a.url || null }));
  return { classes, items, announcements };
}

export const manual = {
  type: "manual",
  title: "Manual file (JSON)",
  fields: { path: { about: "Path to a JSON file in source JSON format." }, data: { about: "Inline source JSON instead of a file." } },
  async fetch(cfg, ctx) {
    if (cfg.data) return normalize(cfg.data, cfg.id, "manual", ctx.tz);
    if (!cfg.path) throw new CCError("CONFIG_INVALID", "manual source needs path or data.");
    if (!ctx.readFile) throw new CCError("UNSUPPORTED", "manual files need the Node CLI.");
    let raw; try { raw = JSON.parse(await ctx.readFile(cfg.path)); } catch (e) { throw new CCError("PARSE", `Could not read ${cfg.path}: ${e.message}`); }
    return normalize(raw, cfg.id, "manual", ctx.tz);
  },
};

export const command = {
  type: "command",
  title: "Command that prints source JSON",
  fields: { command: { required: true, about: "Shell command. Must print source JSON (or a cc/1 context) on stdout and exit 0." }, timeoutSeconds: { about: "Default 120." } },
  async fetch(cfg, ctx) {
    if (!ctx.exec) throw new CCError("UNSUPPORTED", "command sources need the Node CLI.");
    const out = await ctx.exec(cfg.command, (cfg.timeoutSeconds || 120) * 1000);
    let raw; try { raw = JSON.parse(out); } catch { throw new CCError("PARSE", `The command for ${cfg.id} did not print JSON.`); }
    return normalize(raw, cfg.id, "command", ctx.tz);
  },
};

export const url = {
  type: "url",
  title: "URL returning source JSON",
  fields: { url: { required: true, secret: true, about: "HTTP(S) URL returning source JSON or a cc/1 context." }, headers: { about: "Extra headers (values may be secret refs)." } },
  async fetch(cfg, ctx) {
    const headers = {};
    for (const [k, v] of Object.entries(cfg.headers || {})) headers[k] = await ctx.secret(v, k);
    return normalize(await getJSON(ctx.http, await ctx.secret(cfg.url, "url"), { headers, what: cfg.id }), cfg.id, "url", ctx.tz);
  },
};

export const snapshot = {
  type: "snapshot",
  title: "Another context.json",
  fields: { path: { about: "Path to a context.json or to a folder holding one." }, url: { secret: true, about: "Or a URL returning one." } },
  async fetch(cfg, ctx) {
    let raw;
    if (cfg.url) raw = await getJSON(ctx.http, await ctx.secret(cfg.url, "url"), { what: cfg.id });
    else if (cfg.path && ctx.readFile) raw = JSON.parse(await ctx.readFile(/\.json$/i.test(cfg.path) ? cfg.path : cfg.path.replace(/[\\/]$/, "") + "/context.json"));
    else if (ctx.readSnapshot) raw = await ctx.readSnapshot(cfg.id);
    if (!raw) throw new CCError("NO_SNAPSHOT", `No snapshot for ${cfg.id} yet.`, { hint: "The browser extension or another computer must send one first (course-context serve receives them)." });
    return normalize(raw, cfg.id, "snapshot", ctx.tz);
  },
};

export const module = {
  type: "module",
  title: "JavaScript module",
  fields: { path: { required: true, about: "Path or URL of an ES module whose default export has fetch(cfg, ctx) returning source JSON." } },
  async fetch(cfg, ctx) {
    if (!ctx.importModule) throw new CCError("UNSUPPORTED", "module sources need the Node CLI.");
    const mod = await ctx.importModule(cfg.path);
    const impl = mod.default || mod;
    if (typeof impl.fetch !== "function") throw new CCError("CONFIG_INVALID", `${cfg.path} has no fetch export.`);
    return normalize(await impl.fetch(cfg, ctx), cfg.id, "module", ctx.tz);
  },
};
