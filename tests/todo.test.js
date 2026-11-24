// To-do app and cloud-file destinations against fake APIs (same shapes as the real services), in-process.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-todo-"));
process.env.COURSE_CONTEXT_HOME = tmp;
const { runSync } = await import("../src/node/sync.js");
const config = await import("../src/node/config.js");

const db = { objects: new Map(), log: [], hooks: [], files: new Map() };
let n = 0;
const newId = () => String(++n);
let server, base;

function route(req, body) {
  const u = new URL(req.url, "http://x"), p = u.pathname, m = req.method;
  const obj = (id) => db.objects.get(id);
  const J = (o, s = 200) => ({ s, o });
  db.log.push(`${m} ${p}`);
  let r;
  // Todoist v1
  if (p === "/todoist/projects" && m === "GET") return J({ results: [], next_cursor: null });
  if (p === "/todoist/projects" && m === "POST") return J({ id: "proj" + newId(), name: body.name });
  if (p === "/todoist/tasks" && m === "POST") { const id = "td" + newId(); db.objects.set(id, { ...body, id, checked: false }); return J({ id }); }
  if ((r = /^\/todoist\/tasks\/completed\/by_completion_date$/.exec(p))) return J({ items: [...db.objects.values()].filter((o) => o.id.startsWith("td") && o.checked).map((o) => ({ id: o.id })), next_cursor: null });
  if ((r = /^\/todoist\/tasks\/(\w+)\/close$/.exec(p))) { obj(r[1]).checked = true; return { s: 204, o: null }; }
  if ((r = /^\/todoist\/tasks\/(\w+)$/.exec(p))) { const o = obj(r[1]); if (m === "POST") { Object.assign(o, body); return J(o); } return o && !o.checked ? J(o) : J({ error: "not found" }, 404); }
  // Google Tasks
  if (p === "/gt/users/@me/lists" && m === "GET") return J({ items: [] });
  if (p === "/gt/users/@me/lists" && m === "POST") return J({ id: "gl1", title: body.title });
  if ((r = /^\/gt\/lists\/(\w+)\/tasks$/.exec(p)) && m === "POST") { const id = "gt" + newId(); db.objects.set(id, { ...body, id, status: "needsAction" }); return J({ id }); }
  if ((r = /^\/gt\/lists\/\w+\/tasks\/(\w+)$/.exec(p))) { const o = obj(r[1]); if (m === "PATCH") Object.assign(o, body); return J(o); }
  // Microsoft To Do
  if (p === "/ms/me/todo/lists" && m === "GET") return J({ value: [{ id: "x", displayName: "Tasks" }] });
  if (p === "/ms/me/todo/lists" && m === "POST") return J({ id: "ml1", displayName: body.displayName });
  if ((r = /^\/ms\/me\/todo\/lists\/\w+\/tasks$/.exec(p)) && m === "POST") { const id = "ms" + newId(); db.objects.set(id, { ...body, id, status: "notStarted" }); return J({ id }); }
  if ((r = /^\/ms\/me\/todo\/lists\/\w+\/tasks\/(\w+)$/.exec(p))) { const o = obj(r[1]); if (m === "PATCH") Object.assign(o, body); return J(o); }
  // TickTick
  if (p === "/tt/project" && m === "GET") return J([]);
  if (p === "/tt/project" && m === "POST") return J({ id: "tp1", name: body.name });
  if (p === "/tt/task" && m === "POST") { const id = "tt" + newId(); db.objects.set(id, { ...body, id, status: 0 }); return J({ id, projectId: body.projectId }); }
  if ((r = /^\/tt\/task\/(\w+)$/.exec(p)) && m === "POST") { assert.equal(body.id, r[1]); assert.ok(body.projectId); Object.assign(obj(r[1]), body); return J(obj(r[1])); }
  if ((r = /^\/tt\/project\/\w+\/task\/(\w+)\/complete$/.exec(p))) { obj(r[1]).status = 2; return { s: 200, o: null }; }
  if ((r = /^\/tt\/project\/\w+\/task\/(\w+)$/.exec(p))) return J(obj(r[1]));
  // Notion (2025-09-03)
  if (/^\/notion\/databases\/\w+$/.test(p)) { assert.equal(req.headers["notion-version"], "2025-09-03"); return J({ id: "db", data_sources: [{ id: "ds1", name: "Tasks" }] }); }
  if (p === "/notion/data_sources/ds1") return J({ properties: { Name: { type: "title" }, Due: { type: "date" }, Done: { type: "checkbox" }, Class: { type: "select" }, URL: { type: "url" } } });
  if (p === "/notion/pages" && m === "POST") { assert.equal(body.parent.data_source_id, "ds1"); const id = "np" + newId(); db.objects.set(id, { id, properties: body.properties }); return J({ id }); }
  if ((r = /^\/notion\/pages\/(\w+)$/.exec(p))) { const o = obj(r[1]); if (m === "PATCH") Object.assign(o.properties, body.properties); return J(o); }
  // CalDAV
  if ((r = /^\/dav\/tasks\/(.+)\.ics$/.exec(p))) {
    if (m === "PUT") { if (req.headers["if-none-match"] === "*" && db.files.has(p)) return { s: 412, o: null }; db.files.set(p, body); return { s: 201, o: null }; }
    return db.files.has(p) ? { s: 200, o: db.files.get(p), raw: true } : { s: 404, o: null };
  }
  // webhook
  if (p === "/hook") { db.hooks.push(body); return J({ ok: true }); }
  // files: Google Drive, OneDrive, Dropbox, WebDAV
  if (p === "/gd/drive/v3/files" && m === "GET") return J({ files: [] });
  if (p === "/gd/drive/v3/files" && m === "POST") return J({ id: "gdf" + newId() });
  if (p === "/gd/upload/drive/v3/files" && m === "POST") { assert.match(req.headers["content-type"], /multipart\/related/); const id = "gd" + newId(); db.files.set(id, body); return J({ id }); }
  if ((r = /^\/gd\/(upload\/)?drive\/v3\/files\/(\w+)$/.exec(p))) { if (m === "PATCH" && r[1]) db.files.set(r[2], body); return J({ id: r[2], trashed: false }); }
  if (p.startsWith("/od/me/drive/root:/") && m === "PUT") { db.files.set(decodeURIComponent(p), body); return J({ id: "x" }, 201); }
  if (p === "/db/2/files/upload") { const arg = req.headers["dropbox-api-arg"]; assert.ok(/^[\x00-\x7f]*$/.test(arg)); db.files.set(JSON.parse(arg).path, body); return J({}); }
  if (p.startsWith("/wd/")) { if (m === "MKCOL") return { s: 201, o: null }; if (m === "PUT") { db.files.set(decodeURIComponent(p), body); return { s: 201, o: null }; } }
  return J({ error: "no route " + m + " " + p }, 404);
}

before(async () => {
  server = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      let body = b; try { body = b ? JSON.parse(b) : {}; } catch { /* raw */ }
      let out; try { out = route(req, body); } catch (e) { out = { s: 500, o: { error: String(e.message) } }; }
      res.writeHead(out.s, { "Content-Type": out.raw ? "text/calendar" : "application/json" });
      res.end(out.o == null ? "" : out.raw ? out.o : JSON.stringify(out.o));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const due = (d) => new Date(Date.now() + d * 864e5).toISOString();
  const c = config.blankConfig("America/Los_Angeles");
  c.sources = [{ id: "m", type: "manual", data: { classes: [{ code: "MATH 4B", name: "Linear Algebra" }], items: [
    { id: "w1", title: "Homework 7", class: "MATH 4B", due: due(2), url: "https://lms.example/a/7", points: 10 },
    { id: "w2", title: "Read chapter 9 ünïcödé", class: "MATH 4B", due: due(4) },
    { id: "w3", title: "Old graded", class: "MATH 4B", due: due(-2), status: "graded" },
  ] } }];
  c.destinations = [
    { id: "todoist", type: "todoist", token: "t", apiBase: base + "/todoist" },
    { id: "gtasks", type: "google-tasks", token: "t", apiBase: base + "/gt" },
    { id: "mstodo", type: "microsoft-todo", token: "t", apiBase: base + "/ms" },
    { id: "tick", type: "ticktick", token: "t", apiBase: base + "/tt" },
    { id: "notion", type: "notion", token: "t", database: "0123456789abcdef0123456789abcdef", apiBase: base + "/notion" },
    { id: "dav", type: "caldav", url: base + "/dav/tasks/", username: "u", password: "p" },
    { id: "hook", type: "webhook", url: base + "/hook" },
    { id: "gd", type: "gdrive", token: "t", apiBase: base + "/gd" },
    { id: "od", type: "onedrive", token: "t", apiBase: base + "/od" },
    { id: "dbx", type: "dropbox", token: "t", apiBase: base + "/db" },
    { id: "wd", type: "webdav", url: base + "/wd/Course Context", username: "u", password: "p" },
    { id: "folder", type: "folder", path: path.join(tmp, "out") },
  ];
  config.save(c);
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("first sync creates one task per open item in every app and uploads files", async () => {
  const r = await runSync();
  for (const d of r.destinations) assert.equal(d.ok, true, `${d.id}: ${JSON.stringify(d.error)}`);
  for (const id of ["todoist", "gtasks", "mstodo", "tick", "notion", "dav"]) assert.match(r.destinations.find((d) => d.id === id).detail, /^2 created/, id);
  const gt = [...db.objects.values()].filter((o) => o.id.startsWith("gt"));
  assert.ok(gt.every((t) => /T00:00:00\.000Z$/.test(t.due)), "Google Tasks due must be a date at midnight UTC");
  const ms = [...db.objects.values()].find((o) => o.id.startsWith("ms"));
  assert.match(ms.dueDateTime.dateTime, /^\d{4}-\d{2}-\d{2}T00:00:00$/);
  assert.equal(db.hooks.length, 1); assert.equal(db.hooks[0].changes.added.length, 2);
  assert.ok([...db.files.keys()].some((k) => /Course Context\/now\.md$/.test(k)), [...db.files.keys()].join(","));
  assert.ok(db.files.has("/Course Context/now.md"), "dropbox path");
});

test("second sync without changes writes nothing", async () => {
  const before = db.log.length;
  const r = await runSync({ noFetch: true });
  for (const d of r.destinations.filter((x) => ["todoist", "gtasks", "mstodo", "tick", "notion", "dav"].includes(x.id))) assert.match(d.detail, /^0 created, 0 updated, 0 completed/, d.id);
  assert.ok(!db.log.slice(before).some((l) => /^(PUT|PATCH|POST) \/(todoist|gt|ms|tt|notion|dav)\//.test(l)), db.log.slice(before).join("\n"));
  assert.equal(db.hooks.length, 1);
});

test("done locally completes everywhere; done in an app becomes done locally", async () => {
  const c = config.load();
  c.user.items.w1 = { done: true };
  config.save(c);
  let r = await runSync({ noFetch: true });
  for (const id of ["todoist", "gtasks", "mstodo", "tick", "notion", "dav"]) assert.match(r.destinations.find((d) => d.id === id).detail, /1 completed/, id + " " + r.destinations.find((d) => d.id === id).detail);
  assert.equal(db.hooks.at(-1).changes.completed.length, 1);
  // the student ticks the other task in Google Tasks
  const other = [...db.objects.values()].find((o) => o.id.startsWith("gt") && o.status !== "completed");
  other.status = "completed";
  r = await runSync({ noFetch: true });
  assert.equal(r.completedInTodoApps.length, 1);
  const after = config.load();
  assert.equal(Object.values(after.user.items).filter((x) => x.done).length, 2);
  r = await runSync({ noFetch: true });
  for (const id of ["todoist", "mstodo", "tick", "notion", "dav"]) assert.match(r.destinations.find((d) => d.id === id).detail, /1 completed/, id);
});
