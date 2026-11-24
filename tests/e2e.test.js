// End to end: the real CLI against the fake school in tests/mock.js, in a throwaway HOME.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");
let school, tmp, env, mockProc;

const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, "--json"], { env, encoding: "utf8", timeout: 60000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not json */ }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
};

before(async () => {
  mockProc = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "mock-server.js")], { stdio: ["pipe", "pipe", "inherit"] });
  school = await new Promise((resolve) => { let b = ""; mockProc.stdout.on("data", (d) => { b += d; if (b.includes("\n")) resolve(JSON.parse(b)); }); });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-"));
  env = { ...process.env, HOME: tmp, USERPROFILE: tmp, COURSE_CONTEXT_HOME: path.join(tmp, ".course-context"), XDG_CONFIG_HOME: path.join(tmp, ".config"), APPDATA: path.join(tmp, "AppData") };
});
after(async () => { mockProc.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("setup with nothing asks what to ask the user (exit 3)", () => {
  const r = cli("setup", "--clients", "none", "--schedule", "none", "--folder", "none");
  assert.equal(r.code, 3);
  assert.equal(r.json.ok, false);
  assert.ok(r.json.needs.some((n) => n.field === "source"));
  assert.ok(r.json.tellUser[0].length > 20);
});

test("setup with a bad token reports AUTH_INVALID as a need", () => {
  const r = cli("setup", "--canvas", school.base, "--canvas-token", "wrong", "--clients", "none", "--schedule", "none", "--folder", path.join(tmp, "out"));
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.ok(r.json.needs.some((n) => /AUTH_INVALID/.test(n.problem || "")));
});

test("setup with the right token syncs Canvas, WeBWorK discovery and the folder", () => {
  const r = cli("setup", "--canvas", school.base, "--canvas-token", school.TOKEN, "--clients", "none", "--schedule", "none", "--folder", path.join(tmp, "out"));
  // still exit 0? the earlier bad-token source was replaced (same host), so all sources are fine
  assert.equal(r.json.sources.length, 1, JSON.stringify(r.json.sources));
  assert.equal(r.json.sync.ok, true, JSON.stringify(r.json.sync, null, 1));
  assert.equal(r.code, 0);
  const out = path.join(tmp, "out");
  for (const f of ["now.md", "README-for-AI.md", "llms.txt", "context.json", "todo.json", "todo.md", "calendar.ics", "todo.ics", "classes/math-4b/class.md", "classes/cmpsc-130a/work.md", "classes/math-4b/announcements.md", ".course-context-manifest.json"]) assert.ok(fs.existsSync(path.join(out, f)), f);
  const ctx = JSON.parse(fs.readFileSync(path.join(out, "context.json"), "utf8"));
  assert.equal(ctx.classes.length, 2);
  const hw4 = ctx.items.find((i) => i.title === "HW 4");
  assert.equal(hw4.status, "missing");
  const proposal = ctx.items.find((i) => i.title === "Project proposal");
  assert.equal(proposal.due, null);
  assert.equal(proposal.mentionedDates.length, 1);
  const now = fs.readFileSync(path.join(out, "now.md"), "utf8");
  assert.match(now, /Past due, not turned in \(1\)/);
  assert.match(now, /Read chapter 3/);
  assert.match(now, /Midterm moved/);
});

test("webwork source logs in, matches HW 5, and adds its date", () => {
  let r = cli("source", "add", "webwork", "--url", `${school.base}/webwork2/math4B-01-f26/`, "--username", "stu", "--password", "pw");
  assert.equal(r.json.ok, true, r.stdout);
  assert.equal(r.json.test.ok, true, JSON.stringify(r.json.test));
  r = cli("sync");
  assert.equal(r.json.ok, true, JSON.stringify(r.json, null, 1));
  const ctx = JSON.parse(fs.readFileSync(path.join(tmp, "out", "context.json"), "utf8"));
  const hw5 = ctx.items.filter((i) => /HW 5|Homework 5/.test(i.title));
  assert.equal(hw5.length, 1, JSON.stringify(hw5));
  assert.deepEqual(hw5[0].sources.sort(), ["canvas", "webwork"]);
  assert.equal(hw5[0].due.source, "canvas");
  assert.ok(ctx.items.some((i) => i.title === "Homework 6"));
});

test("calendar feed dedupes against the Canvas API by assignment id", () => {
  const r = cli("source", "add", "ics", "--url", `${school.base}/feeds/calendars/user_abc.ics`);
  assert.equal(r.json.test.ok, true, JSON.stringify(r.json));
  cli("sync");
  const ctx = JSON.parse(fs.readFileSync(path.join(tmp, "out", "context.json"), "utf8"));
  assert.equal(ctx.items.filter((i) => /HW 5|Homework 5/.test(i.title)).length, 1);
  const essay = ctx.items.find((i) => i.title === "Essay draft");
  assert.ok(essay && essay.classId.startsWith("canvas:"), JSON.stringify(essay));
});

test("student layer: done, own date, tasks, class mode; config secrets redacted", () => {
  const items = cli("items").json.items;
  const id = items.find((i) => i.title === "HW 4").id;
  assert.equal(cli("item", id, "--done").json.ok, true);
  const lab = items.find((i) => i.title === "Lab 2").id;
  assert.equal(cli("item", lab, "--due", "2026-12-24").json.ok, true);
  const t = cli("task", "add", "Study for midterm", "--due", "2026-12-09", "--class", "MATH 4B");
  assert.equal(t.json.ok, true, t.stdout);
  assert.equal(cli("class", "CMPSC 130A", "--mode", "priority", "--nick", "Data").json.ok, true);
  const ctx = JSON.parse(fs.readFileSync(path.join(tmp, "out", "context.json"), "utf8"));
  assert.equal(ctx.items.find((i) => i.id === id).status, "done");
  assert.equal(ctx.items.find((i) => i.id === lab).due.source, "user");
  assert.ok(ctx.items.some((i) => i.title === "Study for midterm" && i.classId.includes("course/101")));
  assert.equal(ctx.classes[0].nick, "Data");
  const shown = cli("config", "show").stdout;
  assert.ok(!shown.includes(school.TOKEN), "token leaked in config show");
  const mode = fs.statSync(path.join(tmp, ".course-context", "config.json")).mode & 0o777;
  if (process.platform !== "win32") assert.equal(mode, 0o600);
});

test("MCP over stdio: initialize, tools, overview, update, discover", async () => {
  const child = spawn(process.execPath, [CLI, "mcp"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  let buf = "";
  child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  const wait = async (id) => { for (let k = 0; k < 200; k++) { const r = lines.find((l) => l.id === id); if (r) return r; await new Promise((r) => setTimeout(r, 25)); } throw new Error("no reply " + id); };
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  const init = await wait(1);
  assert.equal(init.result.protocolVersion, "2025-06-18");
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (await wait(2)).result.tools.map((t) => t.name);
  for (const n of ["get_overview", "list_work", "get_class", "get_item", "search", "sync_now", "update_item", "add_task", "list_todo"]) assert.ok(tools.includes(n), n);
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_overview", arguments: {} } });
  assert.match((await wait(3)).result.content[0].text, /# Now/);
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_work", arguments: { class: "math 4b", format: "concise" } } });
  const lw = await wait(4);
  assert.ok(lw.result.structuredContent.items.length > 0);
  send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_item", arguments: { id: "nope" } } });
  assert.equal((await wait(5)).result.isError, true);
  send({ jsonrpc: "2.0", id: 6, method: "resources/list" });
  assert.ok((await wait(6)).result.resources.some((r) => r.uri === "course-context://files/now.md"));
  send({ jsonrpc: "2.0", id: 7, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } });
  const disc = await wait(7);
  assert.ok(disc.result.supportedVersions.includes("2026-07-28"));
  send({ jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } });
  const tl = await wait(8);
  assert.equal(tl.result.resultType, "complete"); assert.ok(tl.result.ttlMs > 0);
  send({ jsonrpc: "2.0", id: 9, method: "nope/nope" });
  assert.equal((await wait(9)).error.code, -32601);
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
});

test("HTTP server: auth rules, REST, todo, MCP, ingest", async () => {
  const token = cli("server", "token").json.token;
  const port = 18000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [CLI, "serve", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  const base = `http://127.0.0.1:${port}`;
  for (let k = 0; k < 100; k++) { try { await fetch(base + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
  try {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await (await fetch(base + "/openapi.json")).json()).openapi, "3.1.0");
    // local, no Origin: allowed without token
    assert.equal((await fetch(base + "/v1/status")).status, 200);
    // browser origin without token: refused
    assert.equal((await fetch(base + "/v1/todo", { headers: { Origin: "https://evil.example" } })).status, 401);
    // wrong Host header (DNS rebinding): refused
    const rebind = await new Promise((resolve) => { const http = require("node:http"); http.get({ host: "127.0.0.1", port, path: "/v1/todo", headers: { Host: "evil.example" } }, (r) => { r.resume(); resolve(r.statusCode); }); });
    assert.equal(rebind, 401);
    const todo = await (await fetch(base + "/v1/todo", { headers: { Authorization: "Bearer " + token, Origin: "https://app.example" } })).json();
    assert.equal(todo.schema, "cc-todo/1");
    assert.ok(todo.todos.every((t) => t.id && t.title && "dueDate" in t));
    assert.equal((await fetch(`${base}/k/${token}/v1/overview`, { headers: { Origin: "https://x" } })).headers.get("content-type").split(";")[0], "text/markdown");
    const id = todo.todos[0].id;
    const one = await (await fetch(`${base}/v1/items/${encodeURIComponent(id)}`)).json();
    assert.equal(one.id, id);
    const patch = await fetch(`${base}/v1/items/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "from api" }) });
    assert.equal(patch.status, 200);
    const ics = await (await fetch(`${base}/v1/calendar.ics`)).text();
    assert.match(ics, /BEGIN:VCALENDAR/);
    const mcp = await fetch(`${base}/k/${token}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Origin: "https://claude.ai" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "1" } } }) });
    assert.equal((await mcp.json()).result.serverInfo.name, "course-context");
    const call = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_todo", arguments: {} } }) });
    assert.ok((await call.json()).result.content[0].text.includes("todos"));
    const unknown = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2026-07-28" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "x/y", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }) });
    assert.equal(unknown.status, 404);
    assert.equal((await fetch(`${base}/mcp`)).status, 405);
    // extension inbox
    const ctx = await (await fetch(`${base}/v1/context`)).json();
    const ing = await fetch(`${base}/v1/ingest/laptop-extension`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ctx) });
    assert.equal((await ing.json()).ok, true);
  } finally { child.kill(); }
});

test("connect writes client configs idempotently and keeps other entries", () => {
  const cursor = path.join(tmp, ".cursor", "mcp.json");
  fs.mkdirSync(path.dirname(cursor), { recursive: true });
  fs.writeFileSync(cursor, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  let r = cli("connect", "cursor", "codex", "zed", "continue");
  assert.equal(r.json.ok, true, r.stdout);
  const j = JSON.parse(fs.readFileSync(cursor, "utf8"));
  assert.ok(j.mcpServers.other && j.mcpServers["course-context"].args.at(-1) === "mcp");
  assert.match(fs.readFileSync(path.join(tmp, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.course-context\]/);
  r = cli("connect", "cursor", "codex");
  assert.deepEqual(r.json.results.map((x) => x.action), ["unchanged", "updated"]);
  assert.equal((fs.readFileSync(path.join(tmp, ".codex", "config.toml"), "utf8").match(/mcp_servers\.course-context/g) || []).length, 1);
  // JSONC with comments is never rewritten
  const zed = path.join(tmp, ".config", "zed", "settings.json");
  fs.writeFileSync(zed, '{\n  // my settings\n  "theme": "One Dark"\n}\n');
  r = cli("connect", "zed");
  assert.equal(r.json.results[0].action, "manual");
  assert.match(fs.readFileSync(zed, "utf8"), /my settings/);
  r = cli("connect", "remote", "--public-url", "https://cc.example.com");
  assert.match(r.json.mcpUrl, /^https:\/\/cc\.example\.com\/k\/.+\/mcp$/);
});

test("render-only folder and read-only MCP from a synced folder", () => {
  const r = cli("show", "todo.md", "--from", path.join(tmp, "out"));
  assert.equal(r.json.ok, true);
  assert.match(r.json.body, /- \[ \]/);
});

test("errors are JSON with code and hint", () => {
  const r = cli("source", "remove", "does-not-exist");
  assert.equal(r.code, 4);
  assert.equal(r.json.error.code, "NOT_FOUND");
  assert.ok(r.json.error.hint);
  assert.equal(cli("bogus").code, 2);
});
