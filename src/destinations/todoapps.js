// To-do app destinations. Each adapter maps the engine's create/update/complete/isCompleted onto one app.
// Engine rules: src/destinations/todoengine.js. Field references: docs/destinations.md#todo-apps.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncTodos } from "./todoengine.js";
import { CCError, httpError } from "../core/errors.js";

const run = promisify(execFile);
const LIST = "Course Context";

async function call(http, url, opts, what) {
  const r = await http.request(url, opts);
  const t = await r.text();
  if (r.status === 404 || r.status === 410) return { _gone: true };
  if (!r.ok) throw httpError(r.status, url, what);
  try { return t ? JSON.parse(t) : {}; } catch { return { _text: t }; }
}

// ── Todoist (API v1) ──
export const todoist = {
  type: "todoist", kind: "todo", title: "Todoist",
  fields: {
    token: { required: true, secret: true, about: "Todoist API token: Todoist → Settings → Integrations → Developer → API token." },
    project: { about: `Project name to put tasks in (default "${LIST}"; created if missing).` },
    labels: { about: 'Labels to add, e.g. ["school"].' },
    prefixClass: { about: "true (default): title starts with [CLASS]." },
    horizonDays: { about: "Only sync work due within this many days (default 60). Undated work is included unless includeUndated is false." },
  },
  async push(ctx) {
    const { cfg, state, secret, http } = ctx;
    const API = cfg.apiBase || "https://api.todoist.com/api/v1";
    const H = { Authorization: "Bearer " + (await secret(cfg.token, "token")) };
    if (!state.projectId) {
      const name = cfg.project || LIST;
      let cursor = null, found = null;
      do {
        const r = await call(http, `${API}/projects${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`, { headers: H }, "Todoist");
        const list = Array.isArray(r) ? r : r.results || [];
        found = list.find((p) => p.name === name);
        cursor = Array.isArray(r) ? null : r.next_cursor;
      } while (!found && cursor);
      state.projectId = found ? found.id : (await call(http, `${API}/projects`, { method: "POST", headers: H, json: { name } }, "Todoist")).id;
    }
    const body = (t) => ({ content: t.displayTitle, description: t.notes, priority: t.priority === "high" ? 4 : 1, ...(t.due ? { due_datetime: new Date(t.due).toISOString() } : {}), ...(cfg.labels ? { labels: cfg.labels } : {}) });
    // GET /tasks/{id} may answer 404 for completed tasks, so read recent completions once per sync
    let completedIds = null;
    const completed = async () => {
      if (completedIds) return completedIds;
      completedIds = new Set();
      let cursor = null, n = 0;
      const since = new Date(Date.now() - 89 * 864e5).toISOString(), until = new Date().toISOString();
      do {
        const r = await call(http, `${API}/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=200${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, { headers: H }, "Todoist").catch(() => ({}));
        for (const t of r.items || r.results || []) completedIds.add(String(t.id || t.task_id));
        cursor = r.next_cursor;
      } while (cursor && ++n < 10);
      return completedIds;
    };
    return syncTodos({
      create: async (t) => (await call(http, `${API}/tasks`, { method: "POST", headers: H, json: { ...body(t), project_id: state.projectId } }, "Todoist")).id,
      update: async (id, t) => { const r = await call(http, `${API}/tasks/${id}`, { method: "POST", headers: H, json: { ...body(t), ...(t.due ? {} : { due_string: "no date" }) } }, "Todoist"); if (r._gone) throw new CCError("NOT_FOUND", "task gone"); },
      complete: async (id) => { await call(http, `${API}/tasks/${id}/close`, { method: "POST", headers: H }, "Todoist"); },
      isCompleted: async (id) => {
        const r = await call(http, `${API}/tasks/${id}`, { headers: H }, "Todoist");
        if (!r._gone && !r.is_deleted) return !!(r.checked || r.completed_at);
        if (r.is_deleted) return null;
        return (await completed()).has(String(id)) ? true : null;
      },
    }, ctx);
  },
};

// ── Google Tasks ──
export const googleTasks = {
  type: "google-tasks", kind: "todo", title: "Google Tasks",
  fields: {
    token: { required: true, secret: true, about: "OAuth access token or oauth refresh object (provider google) with scope https://www.googleapis.com/auth/tasks." },
    list: { about: `Task list name (default "${LIST}"; created if missing).` },
    prefixClass: { about: "true (default): title starts with [CLASS]." }, horizonDays: { about: "Default 60." },
  },
  async push(ctx) {
    const { cfg, state, secret, http } = ctx;
    const API = cfg.apiBase || "https://tasks.googleapis.com/tasks/v1";
    const H = { Authorization: "Bearer " + (await secret(cfg.token, "token")) };
    if (!state.listId) {
      const name = cfg.list || LIST;
      const r = await call(http, `${API}/users/@me/lists?maxResults=100`, { headers: H }, "Google Tasks");
      const hit = (r.items || []).find((l) => l.title === name);
      state.listId = hit ? hit.id : (await call(http, `${API}/users/@me/lists`, { method: "POST", headers: H, json: { title: name } }, "Google Tasks")).id;
    }
    const L = encodeURIComponent(state.listId);
    // Google Tasks keeps only the date of `due`; the time goes into notes.
    const body = (t) => ({ title: t.displayTitle, notes: (t.dueTime ? `Due ${t.dueDate} ${t.dueTime} (${t.timezone}).\n` : "") + t.notes, due: t.dueDate ? `${t.dueDate}T00:00:00.000Z` : null });
    return syncTodos({
      create: async (t) => (await call(http, `${API}/lists/${L}/tasks`, { method: "POST", headers: H, json: body(t) }, "Google Tasks")).id,
      update: async (id, t) => { await call(http, `${API}/lists/${L}/tasks/${encodeURIComponent(id)}`, { method: "PATCH", headers: H, json: body(t) }, "Google Tasks"); },
      complete: async (id) => { await call(http, `${API}/lists/${L}/tasks/${encodeURIComponent(id)}`, { method: "PATCH", headers: H, json: { status: "completed" } }, "Google Tasks"); },
      isCompleted: async (id) => { const r = await call(http, `${API}/lists/${L}/tasks/${encodeURIComponent(id)}`, { headers: H }, "Google Tasks"); if (r._gone || r.deleted) return null; return r.status === "completed"; },
    }, ctx);
  },
};

// ── Microsoft To Do (Graph) ──
export const microsoftTodo = {
  type: "microsoft-todo", kind: "todo", title: "Microsoft To Do",
  fields: {
    token: { required: true, secret: true, about: "Graph access token or oauth refresh object (provider microsoft) with Tasks.ReadWrite." },
    list: { about: `List name (default "${LIST}"; created if missing).` }, prefixClass: { about: "Default true." }, horizonDays: { about: "Default 60." },
  },
  async push(ctx) {
    const { cfg, state, secret, http } = ctx;
    const API = (cfg.apiBase || "https://graph.microsoft.com/v1.0") + "/me/todo";
    const H = { Authorization: "Bearer " + (await secret(cfg.token, "token")) };
    if (!state.listId) {
      const name = cfg.list || LIST;
      const r = await call(http, `${API}/lists`, { headers: H }, "Microsoft To Do");
      const hit = (r.value || []).find((l) => l.displayName === name);
      state.listId = hit ? hit.id : (await call(http, `${API}/lists`, { method: "POST", headers: H, json: { displayName: name } }, "Microsoft To Do")).id;
    }
    const L = `${API}/lists/${encodeURIComponent(state.listId)}/tasks`;
    // To Do keeps only the date of dueDateTime: send the local due date at midnight, the time goes into the body.
    // PATCH accepts only HTML bodies, so the body is always sent as escaped HTML.
    const html = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    const body = (t) => ({ title: t.displayTitle, body: { content: html((t.dueTime ? `Due ${t.dueDate} ${t.dueTime} (${t.timezone}).\n` : "") + t.notes), contentType: "html" }, importance: t.priority === "high" ? "high" : "normal", dueDateTime: t.dueDate ? { dateTime: `${t.dueDate}T00:00:00`, timeZone: "UTC" } : null });
    return syncTodos({
      create: async (t) => (await call(http, L, { method: "POST", headers: H, json: { ...body(t), ...(t.url ? { linkedResources: [{ webUrl: t.url, applicationName: "Course Context", displayName: t.title.slice(0, 200) }] } : {}) } }, "Microsoft To Do")).id,
      update: async (id, t) => { await call(http, `${L}/${encodeURIComponent(id)}`, { method: "PATCH", headers: H, json: body(t) }, "Microsoft To Do"); },
      complete: async (id) => { await call(http, `${L}/${encodeURIComponent(id)}`, { method: "PATCH", headers: H, json: { status: "completed" } }, "Microsoft To Do"); },
      isCompleted: async (id) => { const r = await call(http, `${L}/${encodeURIComponent(id)}`, { headers: H }, "Microsoft To Do"); return r._gone ? null : r.status === "completed"; },
    }, ctx);
  },
};

// ── TickTick / Dida365 open API ──
export const ticktick = {
  type: "ticktick", kind: "todo", title: "TickTick (or Dida365)",
  fields: {
    token: { required: true, secret: true, about: "OAuth access token from https://developer.ticktick.com (scope tasks:read tasks:write), or an oauth refresh object (provider ticktick)." },
    region: { about: '"ticktick" (default) or "dida365".' }, project: { about: `Project name (default "${LIST}").` }, prefixClass: { about: "Default true." }, horizonDays: { about: "Default 60." },
  },
  async push(ctx) {
    const { cfg, state, secret, http } = ctx;
    const API = cfg.apiBase || (cfg.region === "dida365" ? "https://api.dida365.com/open/v1" : "https://api.ticktick.com/open/v1");
    const H = { Authorization: "Bearer " + (await secret(cfg.token, "token")) };
    if (!state.projectId) {
      const name = cfg.project || LIST;
      const list = await call(http, `${API}/project`, { headers: H }, "TickTick");
      const hit = (Array.isArray(list) ? list : []).find((p) => p.name === name);
      state.projectId = hit ? hit.id : (await call(http, `${API}/project`, { method: "POST", headers: H, json: { name } }, "TickTick")).id;
    }
    const P = state.projectId;
    const fmt = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, "+0000");
    const body = (t) => ({ title: t.displayTitle, content: t.notes, projectId: P, priority: t.priority === "high" ? 5 : 0, timeZone: t.timezone, isAllDay: false, ...(t.due ? { dueDate: fmt(t.due) } : {}) });
    return syncTodos({
      create: async (t) => (await call(http, `${API}/task`, { method: "POST", headers: H, json: body(t) }, "TickTick")).id,
      update: async (id, t) => { await call(http, `${API}/task/${id}`, { method: "POST", headers: H, json: { id, ...body(t) } }, "TickTick"); },
      complete: async (id) => { await call(http, `${API}/project/${P}/task/${id}/complete`, { method: "POST", headers: H }, "TickTick"); },
      isCompleted: async (id) => { const r = await call(http, `${API}/project/${P}/task/${id}`, { headers: H }, "TickTick"); if (r._gone || !r.id) return null; return r.status === 2; },
    }, ctx);
  },
};

// ── Notion database ──
export const notion = {
  type: "notion", kind: "todo", title: "Notion database",
  fields: {
    token: { required: true, secret: true, about: "Notion internal integration secret (https://www.notion.so/profile/integrations). Share the database with the integration." },
    database: { required: true, about: "Database id (the 32-character id in the database URL)." },
    dataSource: { about: "Data source id, when the database has more than one (default: the first)." },
    properties: { about: 'Property names: {"title":"Name","due":"Due","done":"Done","class":"Class","url":"URL","priority":"Priority"}. title is required in the database; the others are used when present. done must be a checkbox, class and priority selects, due a date, url a URL.' },
    prefixClass: { about: "Default false for Notion (class goes in its own property when it exists)." }, horizonDays: { about: "Default 60." },
  },
  async push(ctx) {
    const { cfg, state, secret, http } = ctx;
    const API = cfg.apiBase || "https://api.notion.com/v1";
    // Notion-Version 2025-09-03: a database holds data sources; pages are created in a data source.
    const H = { Authorization: "Bearer " + (await secret(cfg.token, "token")), "Notion-Version": "2025-09-03" };
    const db = String(cfg.database).replace(/-/g, "").replace(/^.*([0-9a-f]{32}).*$/i, "$1");
    if (!state.schema || !state.dataSource) {
      const d = await call(http, `${API}/databases/${db}`, { headers: H }, "Notion");
      if (d._gone) throw new CCError("NOT_FOUND", "Notion database not found.", { hint: "Check the id and share the database with the integration (••• → Connections)." });
      const dsId = cfg.dataSource || (d.data_sources && d.data_sources[0] && d.data_sources[0].id);
      if (!dsId) throw new CCError("NOT_FOUND", "The Notion database has no data source.", { hint: "Open the database in Notion and make sure it is a full database, not a linked view." });
      const ds = await call(http, `${API}/data_sources/${dsId}`, { headers: H }, "Notion");
      state.dataSource = dsId;
      state.schema = Object.fromEntries(Object.entries(ds.properties || {}).map(([k, v]) => [k, v.type]));
    }
    const names = { title: Object.keys(state.schema).find((k) => state.schema[k] === "title"), due: "Due", done: "Done", class: "Class", url: "URL", priority: "Priority", ...(cfg.properties || {}) };
    const has = (k, type) => names[k] && state.schema[names[k]] === type;
    const props = (t, done) => {
      const p = { [names.title]: { title: [{ text: { content: (cfg.prefixClass ? t.displayTitle : t.title).slice(0, 1900) } }] } };
      if (has("due", "date")) p[names.due] = t.due ? { date: { start: t.due } } : { date: null };
      if (has("done", "checkbox")) p[names.done] = { checkbox: !!done };
      if (has("class", "select") && t.class) p[names.class] = { select: { name: t.class.replace(/,/g, " ").slice(0, 100) } };
      if (has("class", "rich_text") && t.class) p[names.class] = { rich_text: [{ text: { content: t.class } }] };
      if (has("url", "url")) p[names.url] = { url: t.url || null };
      if (has("priority", "select")) p[names.priority] = { select: { name: t.priority === "high" ? "High" : "Normal" } };
      return p;
    };
    return syncTodos({
      create: async (t) => (await call(http, `${API}/pages`, { method: "POST", headers: H, json: { parent: { type: "data_source_id", data_source_id: state.dataSource }, properties: props(t, false), children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: t.notes.slice(0, 1900) } }] } }] } }, "Notion")).id,
      update: async (id, t) => { await call(http, `${API}/pages/${id}`, { method: "PATCH", headers: H, json: { properties: props(t, false) } }, "Notion"); },
      complete: async (id, t) => { if (has("done", "checkbox")) await call(http, `${API}/pages/${id}`, { method: "PATCH", headers: H, json: { properties: { [names.done]: { checkbox: true } } } }, "Notion"); },
      isCompleted: has("done", "checkbox") ? async (id) => { const r = await call(http, `${API}/pages/${id}`, { headers: H }, "Notion"); if (r._gone || r.archived || r.in_trash) return null; return !!(r.properties && r.properties[names.done] && r.properties[names.done].checkbox); } : undefined,
    }, { ...ctx, cfg: { prefixClass: false, ...cfg } });
  },
};

// ── CalDAV tasks (VTODO): Apple Reminders via iCloud, Nextcloud Tasks, Fastmail, Synology, Radicale, Thunderbird ──
export const caldav = {
  type: "caldav", kind: "todo", title: "CalDAV tasks (VTODO)",
  fields: {
    url: { required: true, about: "Task collection URL (a calendar that supports VTODO), ending in /." },
    username: { about: "CalDAV username." }, password: { secret: true, about: "Password or app-specific password." },
    prefixClass: { about: "Default true." }, horizonDays: { about: "Default 60." },
  },
  async push(ctx) {
    const { cfg, secret, http } = ctx;
    const base = String(cfg.url).replace(/\/?$/, "/");
    const H = cfg.username ? { Authorization: "Basic " + Buffer.from(`${await secret(cfg.username, "username")}:${await secret(cfg.password, "password")}`).toString("base64") } : {};
    const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
    const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const ics = (uid, t, done) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//course-context//EN", "BEGIN:VTODO", `UID:${uid}`, `DTSTAMP:${stamp(Date.now())}`, `LAST-MODIFIED:${stamp(Date.now())}`, `SEQUENCE:${Math.floor(Date.now() / 1000) - 1700000000}`, `SUMMARY:${esc(t.displayTitle)}`, `DESCRIPTION:${esc(t.notes)}`, ...(t.due ? [`DUE:${stamp(Date.parse(t.due))}`] : []), ...(t.url ? [`URL:${t.url}`] : []), `PRIORITY:${t.priority === "high" ? 1 : 5}`, ...(done ? ["STATUS:COMPLETED", `COMPLETED:${stamp(Date.now())}`, "PERCENT-COMPLETE:100"] : ["STATUS:NEEDS-ACTION"]), "END:VTODO", "END:VCALENDAR"].join("\r\n") + "\r\n";
    const put = async (uid, t, done, create) => { const r = await http.request(`${base}${uid}.ics`, { method: "PUT", headers: { ...H, "Content-Type": "text/calendar; charset=utf-8", ...(create ? { "If-None-Match": "*" } : {}) }, body: ics(uid, t, done) }); await r.text(); if (!r.ok && !(create && r.status === 412)) throw httpError(r.status, base, "CalDAV"); };
    return syncTodos({
      create: async (t) => { const uid = "cc-" + t.id.replace(/[^\w.-]/g, "_").slice(-120); await put(uid, t, false, true); return uid; },
      update: async (uid, t) => put(uid, t, false, false),
      complete: async (uid, t) => put(uid, t, true, false),
      isCompleted: async (uid) => { const r = await http.request(`${base}${uid}.ics`, { headers: H }); const s = await r.text(); if (r.status === 404) return null; if (!r.ok) throw httpError(r.status, base, "CalDAV"); return /STATUS:COMPLETED/.test(s); },
    }, ctx);
  },
};

// ── Apple Reminders (macOS, local, through osascript) ──
export const appleReminders = {
  type: "apple-reminders", kind: "todo", title: "Apple Reminders (macOS)",
  fields: { list: { about: `Reminders list (default "${LIST}"; created if missing).` }, prefixClass: { about: "Default true." }, horizonDays: { about: "Default 60." } },
  async push(ctx) {
    if (process.platform !== "darwin") throw new CCError("UNSUPPORTED", "Apple Reminders works on macOS only.", { hint: "On other systems use caldav with iCloud, or todo.ics." });
    const list = ctx.cfg.list || LIST;
    const jxa = async (fn, arg) => {
      const script = `function run(argv){const a=JSON.parse(argv[0]);const R=Application("Reminders");let L=R.lists.whose({name:a.list})();L=L.length?L[0]:(()=>{const n=R.List({name:a.list});R.lists.push(n);return n;})();${fn}}`;
      const { stdout } = await run("osascript", ["-l", "JavaScript", "-e", script, JSON.stringify({ list, ...arg })], { timeout: 60000 });
      return stdout.trim();
    };
    const fields = (t) => ({ name: t.displayTitle, body: t.notes, due: t.due ? Date.parse(t.due) : null, high: t.priority === "high" });
    return syncTodos({
      create: (t) => jxa(`const r=R.Reminder({name:a.name,body:a.body,priority:a.high?1:0});L.reminders.push(r);if(a.due)r.dueDate=new Date(a.due);return r.id();`, fields(t)),
      update: (id, t) => jxa(`const r=L.reminders.byId(a.id);r.name=a.name;r.body=a.body;r.priority=a.high?1:0;r.dueDate=a.due?new Date(a.due):null;return "ok";`, { id, ...fields(t) }),
      complete: (id) => jxa(`L.reminders.byId(a.id).completed=true;return "ok";`, { id }),
      isCompleted: async (id) => { try { return (await jxa(`return String(L.reminders.byId(a.id).completed());`, { id })) === "true"; } catch { return null; } },
    }, ctx);
  },
};

// ── Things 3 (macOS, local, AppleScript) ──
export const things = {
  type: "things", kind: "todo", title: "Things 3 (macOS)",
  fields: { tags: { about: "Comma-separated tag names to add." }, prefixClass: { about: "Default true." }, horizonDays: { about: "Default 60." } },
  async push(ctx) {
    if (process.platform !== "darwin") throw new CCError("UNSUPPORTED", "Things works on macOS only.");
    const as = async (lines) => (await run("osascript", lines.flatMap((l) => ["-e", l]), { timeout: 60000 })).stdout.trim();
    const q = (s) => '"' + String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n") + '"';
    const dateLines = (t) => {
      if (!t.dueDate) return [];
      const [y, m, d] = t.dueDate.split("-").map(Number);
      return ["set dd to current date", `set year of dd to ${y}`, "set day of dd to 1", `set month of dd to ${m}`, `set day of dd to ${d}`, "set time of dd to 0"];
    };
    return syncTodos({
      create: (t) => as([...dateLines(t), 'tell application "Things3"', `set t to make new to do with properties {name:${q(t.displayTitle)}, notes:${q(t.notes)}${ctx.cfg.tags ? `, tag names:${q(ctx.cfg.tags)}` : ""}}`, ...(t.dueDate ? ["set due date of t to dd"] : []), "return id of t", "end tell"]),
      update: (id, t) => as([...dateLines(t), 'tell application "Things3"', `set t to to do id ${q(id)}`, `set name of t to ${q(t.displayTitle)}`, `set notes of t to ${q(t.notes)}`, ...(t.dueDate ? ["set due date of t to dd"] : []), "end tell"]),
      complete: (id) => as(['tell application "Things3"', `set status of to do id ${q(id)} to completed`, "end tell"]),
      isCompleted: async (id) => { try { const s = await as(['tell application "Things3"', `return status of to do id ${q(id)} as string`, "end tell"]); return s === "completed" ? true : s === "canceled" ? null : false; } catch { return null; } },
    }, ctx);
  },
};
