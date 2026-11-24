// Operations shared by the MCP server and the HTTP API. Reads the snapshot; writes only the student's layer
// in config.json (never an LMS). `from` (a context.json path, a folder holding one, or an http(s) URL) makes
// the store read-only: used on computers that only see the synced folder, not the sources.
import fs from "node:fs";
import path from "node:path";
import * as config from "./config.js";
import { runSync, readSnapshot, readState } from "./sync.js";
import { renderFiles } from "../core/render.js";
import { toTodos } from "../core/todo.js";
import { findClass } from "../core/match.js";
import { CCError } from "../core/errors.js";
import { parseUserDate, isoLocal } from "../core/dates.js";
import { expand, configPath, snapshotPath } from "./paths.js";
import { VERSION } from "./version.js";

const DAY = 864e5;
const OPEN = new Set(["todo", "missing"]);

export function makeStore({ from } = {}) {
  let cache = null, cacheAt = 0;
  async function context() {
    if (from) {
      if (cache && Date.now() - cacheAt < 30000) return cache;
      if (/^https?:\/\//i.test(from)) { const r = await fetch(from, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new CCError("NO_SNAPSHOT", `${from} answered ${r.status}.`); cache = await r.json(); }
      else { const p = path.resolve(expand(from)); const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, "context.json") : p; if (!fs.existsSync(f)) throw new CCError("NO_SNAPSHOT", `No context.json at ${f}.`, { hint: "Check the path; the folder must be a course-context output folder." }); cache = JSON.parse(fs.readFileSync(f, "utf8")); }
      cacheAt = Date.now();
      return cache;
    }
    const c = readSnapshot();
    if (!c) throw new CCError("NO_SNAPSHOT", "No snapshot yet.", { hint: config.exists() ? "Run a sync first: course-context sync (MCP: sync_now)." : "course-context is not set up. Follow https://github.com/imanimal/course-context/blob/main/llms-install.md" });
    return c;
  }
  const writable = () => { if (from) throw new CCError("READ_ONLY", "This server reads a shared snapshot and cannot change it.", { hint: "Make changes on the computer that runs course-context sync." }); };
  async function editUser(fn) {
    writable();
    const c = config.load();
    const out = fn(c);
    config.save(c);
    const report = await runSync({ noFetch: true });
    return { ...out, resynced: { ok: report.ok, destinations: report.destinations.map((d) => ({ id: d.id, ok: d.ok })) } };
  }
  const ops = {
    readOnly: !!from,
    context,
    async files() { const c = await context(); return renderFiles(c); },
    async overview() { const f = await this.files(); return f["now.md"]; },
    async file(p) { const f = await this.files(); if (!(p in f)) throw new CCError("NOT_FOUND", `No file ${p}.`, { hint: "Files: " + Object.keys(f).join(", ") }); return f[p]; },
    async status() {
      const s = readState();
      let c = null; try { c = await context(); } catch { /* none */ }
      const ageH = c ? Math.round((Date.now() - Date.parse(c.generatedAt)) / 36e5 * 10) / 10 : null;
      return {
        version: VERSION, readOnly: !!from, configPath: from ? null : configPath(), snapshotPath: from || snapshotPath(),
        snapshot: c ? { generatedAt: c.generatedAt, ageHours: ageH, stale: ageH > 24, timezone: c.timezone, classes: c.classes.length, items: c.items.length, open: c.items.filter((i) => OPEN.has(i.status)).length } : null,
        sources: c ? c.sources : [], lastSync: s.lastSync ? { at: s.lastSync.at, ok: s.lastSync.ok, destinations: s.lastSync.destinations } : null,
        configured: from ? null : config.exists() ? (() => { const k = config.load(); return { sources: k.sources.map((x) => ({ id: x.id, type: x.type })), destinations: k.destinations.map((x) => ({ id: x.id, type: x.type })) }; })() : null,
      };
    },
    async classes() {
      const c = await context();
      return c.classes.map((k) => ({ id: k.id, code: k.code, nick: k.nick, name: k.name, slug: k.slug, mode: k.mode, term: k.term, instructors: k.instructors, grade: k.grade, open: c.items.filter((i) => i.classId === k.id && OPEN.has(i.status)).length, url: k.url }));
    },
    async getClass(q) {
      const c = await context();
      const k = findClass(q, c.classes);
      if (!k) throw new CCError("NOT_FOUND", `No class matches "${q}".`, { hint: "Classes: " + c.classes.map((x) => x.nick || x.code).join(", ") });
      const f = renderFiles(c);
      return { class: k, markdown: f[`classes/${k.slug}/class.md`], work: f[`classes/${k.slug}/work.md`] };
    },
    async listWork(q = {}) {
      const c = await context();
      const now = Date.now();
      let list = c.items;
      if (q.class) { const k = findClass(q.class, c.classes); if (!k) throw new CCError("NOT_FOUND", `No class matches "${q.class}".`); list = list.filter((i) => i.classId === k.id); }
      const status = q.status || "open";
      if (status === "open") list = list.filter((i) => OPEN.has(i.status));
      else if (status === "done") list = list.filter((i) => !OPEN.has(i.status));
      else if (status !== "all") list = list.filter((i) => i.status === status);
      if (q.kind) list = list.filter((i) => i.kind === q.kind);
      if (q.dueWithinDays != null) list = list.filter((i) => (i.due ? Date.parse(i.due.at) <= now + q.dueWithinDays * DAY : q.includeUndated !== false));
      if (q.includeUndated === false) list = list.filter((i) => i.due);
      if (!q.includePast && status === "all") list = list.filter((i) => !i.due || Date.parse(i.due.at) > now - (q.pastDays ?? 14) * DAY || OPEN.has(i.status));
      if (q.query) { const w = String(q.query).toLowerCase().split(/\s+/).filter(Boolean); list = list.filter((i) => w.every((x) => (i.title + " " + i.summary + " " + (i.user && i.user.note || "")).toLowerCase().includes(x))); }
      const total = list.length, limit = Math.min(q.limit || 50, 500);
      const cls = new Map(c.classes.map((k) => [k.id, k]));
      const items = list.slice(0, limit).map((i) => (q.format === "detailed" ? i : { id: i.id, title: i.title, class: cls.get(i.classId) ? cls.get(i.classId).nick || cls.get(i.classId).code : null, kind: i.kind, status: i.status, due: i.due ? i.due.at : null, dueSource: i.due ? i.due.source : null, points: i.points, url: i.url, ...(i.mentionedDates && i.mentionedDates.length && !i.due ? { mentioned: i.mentionedDates.map((m) => m.text) } : {}) }));
      return { snapshot: c.generatedAt, timezone: c.timezone, total, returned: items.length, truncated: total > items.length, items };
    },
    async getItem(id) {
      const c = await context();
      const it = c.items.find((i) => i.id === id) || c.items.find((i) => i.id.endsWith(id));
      if (!it) throw new CCError("NOT_FOUND", `No item ${id}.`, { hint: "Use list_work or search to find ids." });
      return { ...it, class: c.classes.find((k) => k.id === it.classId) || null };
    },
    async search(query, limit = 20) {
      const c = await context();
      const w = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!w.length) throw new CCError("USAGE", "query is empty.");
      const hit = (s) => w.every((x) => String(s || "").toLowerCase().includes(x));
      const items = c.items.filter((i) => hit(`${i.title} ${i.summary} ${i.kind} ${i.user && i.user.note || ""}`)).slice(0, limit).map((i) => ({ type: "item", id: i.id, title: i.title, due: i.due ? i.due.at : null, status: i.status, url: i.url }));
      const anns = c.announcements.filter((a) => hit(`${a.title} ${a.body}`)).slice(0, limit).map((a) => ({ type: "announcement", id: a.id, title: a.title, postedAt: a.postedAt, url: a.url, excerpt: a.body.slice(0, 300) }));
      const classes = c.classes.filter((k) => hit(`${k.code} ${k.name} ${k.nick || ""} ${k.notes || ""} ${k.syllabus || ""} ${k.policies || ""}`)).map((k) => ({ type: "class", id: k.id, code: k.code, name: k.name }));
      return { query, results: [...classes, ...items, ...anns].slice(0, limit) };
    },
    async announcements({ class: cq, days = 14, limit = 20 } = {}) {
      const c = await context();
      let list = c.announcements.filter((a) => !a.postedAt || Date.parse(a.postedAt) > Date.now() - days * DAY);
      if (cq) { const k = findClass(cq, c.classes); if (!k) throw new CCError("NOT_FOUND", `No class matches "${cq}".`); list = list.filter((a) => a.classId === k.id); }
      return { total: list.length, announcements: list.slice(0, limit) };
    },
    async todo(o = {}) { const c = await context(); return { schema: "cc-todo/1", generatedAt: c.generatedAt, timezone: c.timezone, todos: toTodos(c, o) }; },
    async sync(o = {}) { writable(); return runSync(o); },
    async updateItem(id, patch) {
      if (String(id).startsWith("task:")) return this.updateTask(id, patch);
      const c0 = await context();
      const it = c0.items.find((i) => i.id === id);
      if (!it) throw new CCError("NOT_FOUND", `No item ${id}.`);
      const tz = c0.timezone;
      return editUser((c) => {
        const cur = { ...(c.user.items[id] || {}) };
        if (patch.done !== undefined) cur.done = !!patch.done;
        if (patch.due !== undefined) { if (patch.due === null || patch.due === "") delete cur.due; else { const t = parseUserDate(patch.due, tz); if (t == null) throw new CCError("USAGE", `Cannot read due date "${patch.due}".`, { hint: "Use ISO 8601, e.g. 2026-12-04T23:59 or 2026-12-04." }); cur.due = isoLocal(t, tz); } }
        if (patch.note !== undefined) { if (patch.note) cur.note = String(patch.note); else delete cur.note; }
        if (patch.priority !== undefined) cur.priority = !!patch.priority;
        if (patch.hidden !== undefined) cur.hidden = !!patch.hidden;
        c.user.items[id] = cur;
        return { ok: true, id, user: cur };
      });
    },
    async updateClass(q, patch) {
      const c0 = await context();
      const k = findClass(q, c0.classes);
      if (!k) throw new CCError("NOT_FOUND", `No class matches "${q}".`);
      if (patch.mode && !["active", "priority", "ghost", "hidden"].includes(patch.mode)) throw new CCError("USAGE", "mode must be active, priority, ghost or hidden.");
      return editUser((c) => {
        const cur = { ...(c.user.classes[k.id] || {}) };
        for (const f of ["nick", "mode", "notes"]) if (patch[f] !== undefined) { if (patch[f] === null || patch[f] === "") delete cur[f]; else cur[f] = String(patch[f]); }
        if (patch.links) cur.links = patch.links;
        c.user.classes[k.id] = cur;
        return { ok: true, id: k.id, user: cur };
      });
    },
    async addTask({ title, due, class: cq, note }) {
      if (!title) throw new CCError("USAGE", "title is required.");
      const c0 = await context();
      let classId = null;
      if (cq) { const k = findClass(cq, c0.classes); if (!k) throw new CCError("NOT_FOUND", `No class matches "${cq}".`); classId = k.id; }
      if (due && parseUserDate(due, c0.timezone) == null) throw new CCError("USAGE", `Cannot read due date "${due}".`);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      return editUser((c) => { c.user.tasks.push({ id, title: String(title), due: due || null, classId, note: note || null, done: false }); return { ok: true, id: "task:" + id }; });
    },
    async updateTask(id, patch) {
      const tid = String(id).replace(/^task:/, "");
      return editUser((c) => {
        const t = c.user.tasks.find((x) => x.id === tid);
        if (!t) throw new CCError("NOT_FOUND", `No task ${id}.`);
        if (patch.delete) { c.user.tasks = c.user.tasks.filter((x) => x !== t); return { ok: true, id, deleted: true }; }
        for (const f of ["title", "due", "note"]) if (patch[f] !== undefined) t[f] = patch[f];
        if (patch.done !== undefined) t.done = !!patch.done;
        return { ok: true, id, task: t };
      });
    },
  };
  return ops;
}
