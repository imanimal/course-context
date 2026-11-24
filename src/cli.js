#!/usr/bin/env node
// course-context CLI. Built for AI agents first: every command is non-interactive, takes everything as flags,
// prints one JSON object when --json is given or stdout is not a terminal, and exits with a documented code
// (docs/cli.md#exit-codes). Errors carry {code, message, hint}; "hint" is the next step.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as config from "./node/config.js";
import { runSync } from "./node/sync.js";
import { makeStore } from "./node/api.js";
import { environment } from "./node/detect.js";
import { installSchedule, removeSchedule, scheduleStatus, installService, removeService } from "./node/schedule.js";
import { startServer } from "./node/server.js";
import { serveStdio } from "./mcp/server.js";
import { CLIENTS, REMOTE, install as installClient, detect as detectClients, deeplinks, launchSpec } from "./mcp/clients.js";
import { SOURCES } from "./sources/index.js";
import { DESTINATIONS } from "./destinations/index.js";
import { CCError, asCC, exitFor, EXIT } from "./core/errors.js";
import { renderFiles } from "./core/render.js";
import { validZone } from "./core/dates.js";
import { home, configPath, expand, ensureDir, writeAtomic } from "./node/paths.js";
import { VERSION } from "./node/version.js";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── args ──
function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      let [k, v] = a.slice(2).split(/=(.*)/s);
      if (v === undefined) {
        if (k.startsWith("no-")) { flags[camel(k.slice(3))] = false; continue; }
        const n = argv[i + 1];
        if (n !== undefined && !n.startsWith("--")) { v = n; i++; } else v = true;
      }
      k = camel(k);
      if (flags[k] !== undefined && flags[k] !== true && v !== true) flags[k] = [].concat(flags[k], v); else flags[k] = v;
    } else if (a === "-h") flags.help = true;
    else if (a === "-v") flags.version = true;
    else pos.push(a);
  }
  return { pos, flags };
}
const camel = (s) => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
const list = (v) => (v === undefined || v === true ? [] : [].concat(v).flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean));
const value = (k, v) => {
  if (v === "true") return true; if (v === "false") return false; if (v === "null") return null;
  if (typeof v === "string" && /^[[{]/.test(v)) { try { return JSON.parse(v); } catch { /* keep string */ } }
  if (typeof v === "string" && /^\d+$/.test(v) && /days|seconds|minutes|port|limit/i.test(k)) return Number(v);
  return v;
};

// ── output ──
let JSON_OUT = false, QUIET = false;
function out(obj, human) {
  if (QUIET && obj && obj.ok !== false) return;
  if (JSON_OUT) process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  else process.stdout.write((typeof human === "function" ? human(obj) : human ?? JSON.stringify(obj, null, 2)) + "\n");
}

const HELP = `course-context ${VERSION}: an AI-readable snapshot of a student's classes, work and due dates.

Agents: read https://github.com/imanimal/course-context/blob/main/llms-install.md (or run: course-context docs install).
Every command accepts --json. Without a terminal, output is JSON by default.

Setup
  setup [--canvas <host> --canvas-token <t>] [--ics <url>]... [--folder <path>|auto|none]
        [--clients auto|all|none|<id,...>] [--schedule <minutes>|none] [--timezone <IANA>]
                                    one command: config, sources, folder, AI apps, schedule, first sync
  doctor                            machine facts: cloud folders, AI apps found, tools, config state
  types [sources|destinations]      every source/destination type and its fields
  source add <type> --<field> <value>...   | source list | source remove <id> | source test <id>
  dest add <type> --<field> <value>...     | dest list   | dest remove <id>   | dest test <id>
  connect [auto|all|<client>...] [--remove] [--list]   register the MCP server with AI apps
  connect remote [--public-url <https url>]            steps for ChatGPT, claude.ai, Le Chat, Gemini, ...
  skill install [--target auto|claude|codex|gemini|copilot|cursor|<dir>]
  schedule install [--every 30] | schedule remove | schedule status
  service install [--port 8787] [--sync-every <minutes>] | service remove
                                    keep the HTTP server running from login (extension inbox, API, remote MCP)

Use
  sync [--source a,b] [--dest x] [--dry-run] [--quiet]
  status                            snapshot age, last sync, errors
  due [--days 7]                    what's due (now.md)
  show [<file>]                     a rendered file: now.md, todo.md, classes/<slug>/work.md, ...
  items [--class X] [--status open|done|all] [--days N] [--query words] [--detailed]
  item <id> [--done|--not-done] [--due <ISO>|--clear-due] [--note <text>] [--priority|--no-priority] [--hide|--unhide]
  task add <title> [--due <ISO>] [--class X] [--note <text>] | task done <id> | task remove <id>
  class <class> [--nick <n>] [--mode priority|active|ghost|hidden] [--notes <text>]
  render --out <dir>                write the files without any destination

Serve
  mcp [--from <context.json|folder|url>] [--read-only]          MCP over stdio (what AI apps launch)
  serve [--host 127.0.0.1] [--port 8787] [--token <t>] [--sync-every <minutes>] [--public-url <url>] [--from ...] [--read-only]
                                    HTTP API (/openapi.json), MCP at /mcp, feeds, extension inbox
  server token [--rotate]

Other
  config path | config show | config set <dotted.key> <value>
  docs [install|cli|config|sources|destinations|api|mcp|output|errors|clients]
  uninstall [--purge]   version   help`;

// ── commands ──
const C = {};

C.help = () => out({ ok: true, help: HELP }, () => HELP);
C.version = () => out({ ok: true, version: VERSION }, () => VERSION);

C.init = (f) => {
  const had = config.exists();
  const c = config.load({ create: true });
  if (f.timezone) { if (!validZone(f.timezone)) throw new CCError("USAGE", `Unknown time zone ${f.timezone}.`, { hint: "Use an IANA name like America/Los_Angeles." }); c.timezone = f.timezone; config.save(c); }
  out({ ok: true, created: !had, configPath: configPath(), timezone: c.timezone }, (r) => `${r.created ? "Created" : "Using"} ${r.configPath} (time zone ${r.timezone}).`);
};

C.doctor = () => {
  const env = environment();
  let cfg = null;
  try { cfg = config.exists() ? config.redacted(config.load()) : null; } catch (e) { cfg = { error: asCC(e).toJSON() }; }
  const r = { ok: true, version: VERSION, home: home(), configPath: configPath(), configured: !!cfg, config: cfg, schedule: scheduleStatus(), ...env };
  out(r, (x) => [`course-context ${x.version}`, `config: ${x.configured ? x.configPath : "not set up (run: course-context setup)"}`, `node ${x.node}${x.nodeOk ? "" : " (needs 18.17 or newer)"}, ${x.platform}, time zone ${x.timezone}`,
    `cloud folders: ${x.cloudFolders.map((c) => `${c.provider} ${c.path}`).join("; ") || "none found"}`, `AI apps found: ${x.mcpClients.map((c) => c.name + (c.installed ? " (connected)" : "")).join(", ") || "none"}`,
    `tools: ${Object.entries(x.tools).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}`, `schedule: ${x.schedule.installed ? x.schedule.mechanism : "off"}`].join("\n"));
};

C.types = (f, [which]) => {
  const fmt = (reg) => Object.entries(reg).map(([type, m]) => ({ type, title: m.title, kind: m.kind, fields: m.fields }));
  const r = { ok: true, ...(which !== "destinations" && which !== "dests" ? { sources: fmt(SOURCES) } : {}), ...(which !== "sources" ? { destinations: fmt(DESTINATIONS) } : {}) };
  out(r, (x) => [...(x.sources || []).map((s) => `source ${s.type}: ${s.title}\n` + Object.entries(s.fields).map(([k, v]) => `    --${k}${v.required ? " (required)" : ""}: ${v.about}`).join("\n")), ...(x.destinations || []).map((s) => `dest ${s.type}: ${s.title}\n` + Object.entries(s.fields).map(([k, v]) => `    --${k}${v.required ? " (required)" : ""}: ${v.about}`).join("\n"))].join("\n"));
};

function entryFrom(type, f) {
  const e = { type };
  for (const [k, v] of Object.entries(f)) { if (["json", "text", "quiet", "dryRun", "test"].includes(k)) continue; e[k] = value(k, v); }
  return e;
}

async function addEntry(kind, type, f) {
  if (!type) throw new CCError("USAGE", `Missing ${kind} type.`, { hint: `Types: ${Object.keys(kind === "source" ? SOURCES : DESTINATIONS).join(", ")}` });
  const c = config.load({ create: true });
  const { entry, created } = config.upsert(c, kind, entryFrom(type, f));
  config.save(c);
  let test;
  if (f.test !== false && kind === "source") test = await testSource(entry.id).catch((e) => ({ ok: false, error: asCC(e).toJSON() }));
  out({ ok: true, created, [kind]: config.redacted(entry), test }, (r) => `${r.created ? "Added" : "Updated"} ${kind} ${entry.id} (${type}).${test ? (test.ok ? ` Test: ok, ${test.items} items.` : ` Test failed: ${test.error.code}: ${test.error.message}${test.error.hint ? "\n  " + test.error.hint : ""}`) : ""}`);
}

async function testSource(id) {
  const r = await runSync({ only: [id], dryRun: true, dests: ["\u0000none"] });
  const s = r.sources.find((x) => x.id === id);
  return s.ok ? { ok: true, items: s.items, warnings: s.warnings } : { ok: false, error: s.error, warnings: s.warnings };
}

C.source = async (f, [sub, a]) => {
  if (sub === "add") return addEntry("source", a, f);
  if (sub === "list" || !sub) { const c = config.load(); return out({ ok: true, sources: config.redacted(c).sources }, (r) => r.sources.map((s) => `${s.id}  ${s.type}  ${s.host || s.url || s.path || ""}`).join("\n") || "No sources."); }
  if (sub === "remove") { const c = config.load(); config.remove(c, "source", a); config.save(c); return out({ ok: true, removed: a }, `Removed source ${a}.`); }
  if (sub === "test") { const r = await testSource(a); out({ ...r, ok: r.ok }, (x) => (x.ok ? `ok: ${x.items} items` : `${x.error.code}: ${x.error.message}\n${x.error.hint || ""}`)); if (!r.ok) process.exitCode = exitFor(r.error.code); return; }
  throw new CCError("USAGE", `Unknown: source ${sub}.`, { hint: "source add|list|remove|test" });
};

C.dest = async (f, [sub, a]) => {
  if (sub === "add") return addEntry("destination", a, f);
  if (sub === "list" || !sub) { const c = config.load(); return out({ ok: true, destinations: config.redacted(c).destinations }, (r) => r.destinations.map((d) => `${d.id}  ${d.type}  ${d.path || d.remote || d.url || d.project || d.list || ""}`).join("\n") || "No destinations."); }
  if (sub === "remove") { const c = config.load(); config.remove(c, "destination", a); config.save(c); return out({ ok: true, removed: a }, `Removed destination ${a}.`); }
  if (sub === "test") { const r = await runSync({ dests: [a], dryRun: true, only: ["\u0000none"] }); const d = r.destinations.find((x) => x.id === a); if (!d) throw new CCError("NOT_FOUND", `No destination ${a}.`); out({ ok: d.ok, destination: d }, (x) => (x.destination.ok ? `ok (dry run): would write ${x.destination.written}, remove ${x.destination.removed}` : `${x.destination.error.code}: ${x.destination.error.message}\n${x.destination.error.hint || ""}`)); if (!d.ok) process.exitCode = exitFor(d.error.code); return; }
  throw new CCError("USAGE", `Unknown: dest ${sub}.`, { hint: "dest add|list|remove|test" });
};
C.destination = C.dest; C.destinations = C.dest; C.sources = (f) => C.source(f, ["list"]);

C.sync = async (f) => {
  const r = await runSync({ only: f.source ? list(f.source) : undefined, dests: f.dest ? list(f.dest) : undefined, dryRun: !!f.dryRun });
  if (!r.ok) process.exitCode = EXIT.PARTIAL;
  if (QUIET && !r.ok) { process.stderr.write(JSON.stringify(r) + "\n"); return; }
  out(r, (x) => [`Synced ${x.counts.classes} classes, ${x.counts.items} items (${x.counts.open} open) in ${(x.ms / 1000).toFixed(1)}s.${x.dryRun ? " Dry run." : ""}`,
    ...x.sources.map((s) => `  source ${s.id}: ${s.ok ? `ok, ${s.items} items` : `${s.error.code}: ${s.error.message}${s.stale ? " (kept earlier data)" : ""}${s.error.hint ? "\n    " + s.error.hint : ""}`}`),
    ...x.destinations.map((d) => `  dest ${d.id}: ${d.ok ? `ok, ${d.written} written, ${d.removed} removed${d.detail ? " (" + d.detail + ")" : ""}` : `${d.error.code}: ${d.error.message}${d.error.hint ? "\n    " + d.error.hint : ""}`}`), x.note || ""].filter(Boolean).join("\n"));
};

C.status = async () => { const r = await makeStore().status(); out({ ok: true, ...r }, (x) => (x.snapshot ? `Snapshot ${x.snapshot.generatedAt} (${x.snapshot.ageHours} h old${x.snapshot.stale ? ", stale" : ""}): ${x.snapshot.classes} classes, ${x.snapshot.open} open items.` : "No snapshot yet.") + (x.lastSync ? `\nLast sync ${x.lastSync.ok ? "ok" : "had problems"} at ${x.lastSync.at}.` : "")); };
C.due = async (f) => { const api = makeStore({ from: f.from }); if (f.days) { const r = await api.listWork({ dueWithinDays: Number(f.days), class: f.class }); return out({ ok: true, ...r }, (x) => x.items.map((i) => `${i.due || "no date"}  ${i.class || ""}  ${i.title}  (${i.status})`).join("\n") || "Nothing due."); } const t = await api.overview(); out({ ok: true, markdown: t }, t); };
C.show = async (f, [file]) => { const t = await makeStore({ from: f.from }).file(file || "now.md"); out({ ok: true, file: file || "now.md", body: t }, t); };
C.items = async (f) => { const r = await makeStore({ from: f.from }).listWork({ class: f.class, status: f.status, dueWithinDays: f.days != null ? Number(f.days) : undefined, kind: f.kind, query: f.query, limit: f.limit ? Number(f.limit) : undefined, format: f.detailed ? "detailed" : "concise" }); out({ ok: true, ...r }, (x) => x.items.map((i) => `${i.id}\n  ${i.title} · ${i.class || "no class"} · ${i.due || "no date"} · ${i.status}`).join("\n") || "None."); };

C.item = async (f, [id]) => {
  if (!id) throw new CCError("USAGE", "item needs an id.", { hint: "Find ids with: course-context items" });
  const api = makeStore();
  const patch = {};
  if (f.done === true) patch.done = true; if (f.notDone || f.done === false) patch.done = false;
  if (f.due && f.due !== true) patch.due = f.due; if (f.clearDue) patch.due = null;
  if (f.note !== undefined) patch.note = f.note === true ? "" : f.note;
  if (f.priority !== undefined) patch.priority = !!f.priority;
  if (f.hide) patch.hidden = true; if (f.unhide) patch.hidden = false;
  if (!Object.keys(patch).length) { const r = await api.getItem(id); return out({ ok: true, item: r }, JSON.stringify(r, null, 2)); }
  const r = await api.updateItem(id, patch);
  out(r, (x) => `Updated ${id}.`);
};

C.task = async (f, [sub, a]) => {
  const api = makeStore();
  if (sub === "add") { const r = await api.addTask({ title: a, due: f.due, class: f.class, note: f.note }); return out(r, (x) => `Added ${x.id}.`); }
  if (sub === "done") { const r = await api.updateTask(a, { done: true }); return out(r, `Marked ${a} done.`); }
  if (sub === "remove") { const r = await api.updateTask(a, { delete: true }); return out(r, `Removed ${a}.`); }
  throw new CCError("USAGE", "task add <title> | task done <id> | task remove <id>");
};

C.class = async (f, [q]) => {
  const api = makeStore();
  if (!q) return out({ ok: true, classes: await api.classes() }, (r) => r.classes.map((k) => `${k.nick || k.code}  ${k.name}  ${k.mode}  ${k.open} open`).join("\n"));
  const patch = {}; for (const k of ["nick", "mode", "notes"]) if (f[k] !== undefined) patch[k] = f[k] === true ? "" : f[k];
  if (!Object.keys(patch).length) { const r = await api.getClass(q); return out({ ok: true, ...r }, r.markdown + "\n" + r.work); }
  out(await api.updateClass(q, patch), `Updated ${q}.`);
};
C.classes = (f) => C.class(f, []);

C.render = async (f) => {
  if (!f.out || f.out === true) throw new CCError("USAGE", "render needs --out <dir>.");
  const api = makeStore({ from: f.from });
  const files = await api.files();
  const dir = path.resolve(expand(f.out));
  for (const [p, b] of Object.entries(files)) writeAtomic(path.join(dir, p), b);
  out({ ok: true, dir, files: Object.keys(files) }, `Wrote ${Object.keys(files).length} files to ${dir}.`);
};

C.mcp = async (f) => { serveStdio(makeStore({ from: f.from }), { readOnly: !!f.readOnly }); return "keep"; };

C.serve = async (f) => {
  let token = f.token && f.token !== true ? f.token : process.env.COURSE_CONTEXT_TOKEN;
  let cfg = null;
  if (!f.from) { cfg = config.load({ create: true }); token = token || cfg.server.token; }
  if (!token) token = config.newToken();
  const host = f.host || (cfg && cfg.server.host) || "127.0.0.1", port = Number(f.port || process.env.PORT || (cfg && cfg.server.port) || 8787);
  const every = f.syncEvery !== undefined ? Number(f.syncEvery) : Number(process.env.COURSE_CONTEXT_SYNC_EVERY || 0);
  await startServer({ host, port, token, from: f.from, readOnly: !!f.readOnly, syncEveryMinutes: every || 0, publicUrl: f.publicUrl, log: f.verbose ? (s) => process.stderr.write(s + "\n") : () => {} });
  const base = f.publicUrl || `http://${host === "0.0.0.0" || host === "::" ? "localhost" : host}:${port}`;
  const info = { ok: true, listening: `${host}:${port}`, url: base, openapi: `${base}/openapi.json`, mcp: `${base}/mcp`, mcpWithToken: `${base}/k/${token}/mcp`, todo: `${base}/v1/todo`, calendar: `${base}/k/${token}/v1/calendar.ics`, tokenSource: f.token ? "flag" : process.env.COURSE_CONTEXT_TOKEN ? "env" : cfg ? "config server.token" : "generated" };
  out(info, (x) => `Serving on ${x.url}\n  API: ${x.openapi}\n  MCP: ${x.mcp} (remote chatbots: ${x.mcpWithToken})\n  Calendar feed: ${x.calendar}\nStop with Ctrl+C.`);
  return "keep";
};

C.server = (f, [sub]) => {
  const c = config.load({ create: true });
  if (sub === "token") { if (f.rotate) { c.server.token = config.newToken(); config.save(c); } return out({ ok: true, token: c.server.token, rotated: !!f.rotate }, c.server.token); }
  throw new CCError("USAGE", "server token [--rotate]");
};

C.connect = async (f, targets) => {
  if (f.list) { const d = detectClients(); return out({ ok: true, clients: d, remote: Object.entries(REMOTE).map(([id, r]) => ({ id, name: r.name })), deeplinks: deeplinks() }, (x) => x.clients.map((c) => `${c.present ? "found" : "     "}  ${c.installed ? "connected" : "         "}  ${c.id}  ${c.name}`).join("\n")); }
  if (targets[0] === "remote") {
    const c = config.exists() ? config.load() : null;
    const tok = c ? c.server.token : "<token>";
    const pub = (f.publicUrl && f.publicUrl !== true ? f.publicUrl : "https://<your-public-host>").replace(/\/$/, "");
    const steps = Object.entries(REMOTE).map(([id, r]) => ({ id, name: r.name, how: r.how.replace(/<public>/g, pub).replace(/<token>/g, tok) }));
    return out({ ok: true, publicUrl: pub, mcpUrl: `${pub}/k/${tok}/mcp`, openapi: `${pub}/openapi.json`, steps, expose: "The server must be reachable over HTTPS. Options: `course-context serve --host 0.0.0.0` behind Cloudflare Tunnel (cloudflared tunnel --url http://localhost:8787), Tailscale Funnel (tailscale funnel 8787), ngrok (ngrok http 8787), or deploy the Docker image (docs/self-host.md)." }, (x) => [`MCP URL: ${x.mcpUrl}`, `OpenAPI: ${x.openapi}`, ...x.steps.map((s) => `\n${s.name}\n  ${s.how}`), "\n" + x.expose].join("\n"));
  }
  const det = detectClients();
  let ids = targets.length ? targets : ["auto"];
  if (ids.includes("auto")) ids = det.filter((c) => c.present).map((c) => c.id);
  else if (ids.includes("all")) ids = Object.keys(CLIENTS);
  const results = ids.map((id) => { try { return installClient(id, { dryRun: !!f.dryRun, remove: !!f.remove }); } catch (e) { return { client: id, action: "error", error: asCC(e).toJSON() }; } });
  out({ ok: results.every((r) => r.action !== "error"), launch: launchSpec(), results, deeplinks: deeplinks() }, (x) => (x.results.length ? x.results.map((r) => `${r.name || r.client}: ${r.action}${r.where ? `\n  ${r.where}\n${r.snippet}` : ""}${r.error ? " " + r.error.message : ""}`).join("\n") : "No AI apps found on this computer. Use: course-context connect <client>, or course-context connect remote.") + (x.results.some((r) => ["added", "updated"].includes(r.action)) ? "\nRestart those apps to load course-context." : ""));
};

C.skill = async (f, [sub]) => {
  if (sub !== "install" && sub !== "remove") throw new CCError("USAGE", "skill install [--target auto|claude|codex|gemini|copilot|cursor|<dir>] | skill remove");
  const os = await import("node:os");
  const H = os.homedir();
  const T = { claude: path.join(H, ".claude", "skills"), codex: path.join(process.env.CODEX_HOME || path.join(H, ".codex"), "skills"), "codex-agents": path.join(H, ".agents", "skills"), gemini: path.join(H, ".gemini", "skills"), copilot: path.join(H, ".copilot", "skills"), cursor: path.join(H, ".cursor", "skills") };
  let targets = list(f.target);
  if (!targets.length || targets.includes("auto")) targets = Object.keys(T).filter((k) => fs.existsSync(path.dirname(T[k])) || (k === "codex-agents" && fs.existsSync(path.dirname(T.codex))));
  const src = path.join(PKG, "skills", "course-context", "SKILL.md");
  const res = targets.map((t) => {
    const dir = path.join(T[t] || path.resolve(expand(t)), "course-context");
    if (sub === "remove") { fs.rmSync(dir, { recursive: true, force: true }); return { target: t, dir, action: "removed" }; }
    ensureDir(dir, 0o755); fs.copyFileSync(src, path.join(dir, "SKILL.md")); return { target: t, dir, action: "installed" };
  });
  out({ ok: true, results: res }, (x) => x.results.map((r) => `${r.target}: ${r.action} ${r.dir}`).join("\n") || "No agent skill folders found. Pass --target <dir>.");
};

C.schedule = async (f, [sub]) => {
  if (sub === "install") return out(installSchedule(Number(f.every || 30)), (r) => `Sync runs every ${r.everyMinutes} minutes (${r.mechanism}).`);
  if (sub === "remove") return out(removeSchedule(), "Schedule removed.");
  return out({ ok: true, ...scheduleStatus() }, (r) => (r.installed ? `Scheduled (${r.mechanism}).` : "Not scheduled."));
};

C.service = async (f, [sub]) => {
  if (sub === "install") { const c = config.load({ create: true }); return out(installService({ port: Number(f.port || c.server.port), host: f.host || c.server.host, syncEvery: f.syncEvery ? Number(f.syncEvery) : 0 }), (r) => `The server starts at login and runs now at ${r.url} (${r.mechanism}).`); }
  if (sub === "remove") return out(removeService(), "Server service removed.");
  throw new CCError("USAGE", "service install [--port 8787] [--host 127.0.0.1] [--sync-every <minutes>] | service remove");
};

C.config = async (f, [sub, key, val]) => {
  if (sub === "path" || !sub) return out({ ok: true, path: configPath(), home: home() }, configPath());
  const c = config.load({ create: true });
  if (sub === "show") return out({ ok: true, config: config.redacted(c) }, JSON.stringify(config.redacted(c), null, 2));
  if (sub === "set") {
    if (!key) throw new CCError("USAGE", "config set <dotted.key> <value>");
    const ks = key.split("."); let o = c;
    for (const k of ks.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === "object" ? o[k] : {};
    o[ks[ks.length - 1]] = value(ks[ks.length - 1], val);
    if (c.timezone && !validZone(c.timezone)) throw new CCError("USAGE", `Unknown time zone ${c.timezone}.`);
    config.save(config.normalize(c));
    return out({ ok: true, set: key }, `Set ${key}.`);
  }
  throw new CCError("USAGE", "config path | show | set <key> <value>");
};

C.docs = (f, [topic]) => {
  const map = { install: "llms-install.md", llms: "llms.txt", agents: "AGENTS.md", readme: "README.md" };
  const file = map[topic] ? path.join(PKG, map[topic]) : topic ? path.join(PKG, "docs", topic.replace(/\.md$/, "") + ".md") : path.join(PKG, "llms.txt");
  if (!fs.existsSync(file)) throw new CCError("NOT_FOUND", `No docs topic ${topic}.`, { hint: "Topics: install, " + fs.readdirSync(path.join(PKG, "docs")).map((x) => x.replace(/\.md$/, "")).join(", ") });
  const t = fs.readFileSync(file, "utf8");
  out({ ok: true, topic: topic || "llms", body: t }, t);
};

C.uninstall = async (f) => {
  const r = { schedule: removeSchedule(), service: removeService(), clients: Object.keys(CLIENTS).map((id) => { try { return installClient(id, { remove: true }); } catch (e) { return { client: id, action: "error" }; } }).filter((x) => x.action === "removed") };
  await C.skill({ target: "auto" }, ["remove"]).catch(() => {});
  if (f.purge) fs.rmSync(home(), { recursive: true, force: true });
  out({ ok: true, ...r, purged: !!f.purge, note: f.purge ? "Deleted " + home() : `Kept ${home()} (config and snapshot). Pass --purge to delete it. Output folders and to-do app tasks are left as they are.` }, (x) => `Removed the schedule and ${x.clients.length} AI app entries. ${x.note}`);
};

// setup: the one command an agent runs
const ASK = {
  source: "Which school system do you use for classes? For Canvas, tell me the address you sign in at (like school.instructure.com). Moodle, Brightspace, Blackboard, Schoology and Google Classroom work too.",
  canvasToken: "Canvas needs an access token. In Canvas, open Account, then Settings, scroll to Approved Integrations and click New Access Token. Name it Course Context, leave the date empty, and paste the token here. If your school hides that button, open Calendar in Canvas, click Calendar Feed, and paste that link instead.",
};

C.setup = async (f) => {
  const steps = [], needs = [];
  const c = config.load({ create: true });
  if (f.timezone && f.timezone !== true) { if (!validZone(f.timezone)) throw new CCError("USAGE", `Unknown time zone ${f.timezone}.`); c.timezone = f.timezone; }
  const add = (kind, e) => { try { const r = config.upsert(c, kind, e); steps.push({ step: `${kind} ${r.created ? "added" : "updated"}`, id: r.entry.id, type: e.type }); } catch (err) { const x = asCC(err); if (x.code === "NEEDS_INPUT") needs.push({ field: `${e.type}.${(x.missing || []).join(",")}`, ask: x.hint }); else throw x; } };
  if (f.canvas && f.canvas !== true) {
    if (f.canvasToken && f.canvasToken !== true) add("source", { type: "canvas", host: f.canvas, token: f.canvasToken });
    else if (f.canvasCookie && f.canvasCookie !== true) add("source", { type: "canvas", host: f.canvas, cookie: f.canvasCookie });
    else if (!c.sources.some((s) => s.type === "canvas")) needs.push({ field: "canvas-token", ask: ASK.canvasToken, then: `course-context setup --canvas ${f.canvas} --canvas-token <token>   (or: --ics <calendar feed link>)` });
  }
  for (const u of list(f.ics)) add("source", { type: "ics", url: u });
  if (f.moodle && f.moodle !== true) add("source", { type: "moodle", url: f.moodle, ...(f.moodleToken ? { token: f.moodleToken } : {}), ...(f.moodleUser ? { username: f.moodleUser, password: f.moodlePassword } : {}) });
  if (f.webwork && f.webwork !== true) add("source", { type: "webwork", url: f.webwork, ...(f.webworkUser ? { username: f.webworkUser, password: f.webworkPassword } : {}) });
  if ((f.gradescopeEmail && f.gradescopeEmail !== true) || (f.gradescopeCookie && f.gradescopeCookie !== true)) add("source", { type: "gradescope", ...(f.gradescopeEmail ? { email: f.gradescopeEmail, password: f.gradescopePassword } : { cookie: f.gradescopeCookie }) });
  if (f.classroomToken && f.classroomToken !== true) add("source", { type: "classroom", token: value("token", f.classroomToken) });
  if (f.schoologyKey && f.schoologyKey !== true) add("source", { type: "schoology", key: f.schoologyKey, secret: f.schoologySecret, domain: f.schoologyDomain });
  if (!c.sources.length && !needs.length) needs.push({ field: "source", ask: ASK.source, then: "course-context setup --canvas <host> --canvas-token <token>   |   --ics <feed url>   |   --moodle <url> --moodle-token <t>   (all types: course-context types sources)" });

  // folder destination
  const env = environment();
  const folderFlag = f.folder === undefined ? "auto" : f.folder;
  if (folderFlag !== false && folderFlag !== "none" && !c.destinations.some((d) => d.type === "folder")) {
    const p = folderFlag === "auto" || folderFlag === true ? (env.cloudFolders[0] ? env.cloudFolders[0].suggested : path.join((await import("node:os")).homedir(), "Course Context")) : folderFlag;
    add("destination", { type: "folder", path: p });
  } else if (typeof folderFlag === "string" && !["auto", "none"].includes(folderFlag)) add("destination", { id: c.destinations.find((d) => d.type === "folder").id, type: "folder", path: folderFlag });
  config.save(c);

  // first sync
  let sync = null;
  if (c.sources.length && f.sync !== false) {
    sync = await runSync();
    for (const s of sync.sources) if (!s.ok && s.error && /^(AUTH_|SIGNED_OUT|LMS_ONLY|SECRET_)/.test(s.error.code)) needs.push({ field: `source ${s.id}`, problem: `${s.error.code}: ${s.error.message}`, ask: s.error.hint });
  }
  // AI apps
  let clients = [];
  const cf = f.clients === undefined ? "auto" : f.clients;
  if (cf !== false && cf !== "none") {
    let ids = cf === "auto" || cf === true ? env.mcpClients.map((x) => x.id) : cf === "all" ? Object.keys(CLIENTS) : list(cf);
    clients = ids.map((id) => { try { return installClient(id); } catch (e) { return { client: id, action: "error", error: asCC(e).toJSON() }; } });
    await C.skill({ target: "auto", json: true }, ["install"]).catch(() => {});
  }
  // schedule
  let schedule = scheduleStatus();
  if (f.schedule !== false && f.schedule !== "none" && c.sources.length) { try { schedule = installSchedule(Number(f.schedule && f.schedule !== true ? f.schedule : 30)); } catch (e) { schedule = { ok: false, error: asCC(e).toJSON() }; } }

  const folders = c.destinations.filter((d) => d.type === "folder").map((d) => expand(d.path));
  const r = {
    ok: !needs.length && (!sync || sync.ok), configPath: configPath(), timezone: c.timezone,
    sources: c.sources.map((s) => ({ id: s.id, type: s.type })), destinations: c.destinations.map((d) => ({ id: d.id, type: d.type, path: d.path })),
    sync: sync ? { ok: sync.ok, counts: sync.counts, sources: sync.sources, destinations: sync.destinations } : null,
    clients, schedule, needs,
    tellUser: needs.length ? needs.map((n) => n.ask).filter(Boolean) : [
      `Your classes are saved to ${folders[0] || "the snapshot"}${env.cloudFolders[0] && folders[0] && folders[0].startsWith(env.cloudFolders[0].path) ? ` in ${env.cloudFolders[0].provider}, so other computers and phones see them too` : ""}.`,
      clients.some((x) => ["added", "updated"].includes(x.action)) ? `Restart ${clients.filter((x) => ["added", "updated"].includes(x.action)).map((x) => x.name).join(", ")} and ask "what's due this week?"` : "Ask any AI that can read files about the Course Context folder.",
      "For ChatGPT or claude.ai on the web, run: course-context connect remote",
    ],
  };
  if (needs.length) process.exitCode = EXIT.NEEDS_INPUT;
  else if (sync && !sync.ok) process.exitCode = EXIT.PARTIAL;
  out(r, (x) => [x.needs.length ? "Setup needs more information:" : "Setup done.", ...x.tellUser.map((t) => "- " + t), ...x.needs.filter((n) => n.then).map((n) => `  then run: ${n.then}`)].join("\n"));
};

// ── main ──
async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  JSON_OUT = flags.json === true || (!process.stdout.isTTY && flags.text !== true);
  QUIET = !!flags.quiet;
  if (flags.version) return C.version();
  let [cmd, ...rest] = pos;
  if (!cmd || flags.help) cmd = cmd && flags.help ? "help" : cmd || "help";
  const fn = C[cmd];
  if (!fn) throw new CCError("USAGE", `Unknown command "${cmd}".`, { hint: "Run: course-context help" });
  return fn(flags, rest);
}

main().then((keep) => { if (keep !== "keep" && process.exitCode === undefined) process.exitCode = 0; }).catch((e) => {
  const err = asCC(e);
  process.exitCode = exitFor(err.code);
  if (JSON_OUT) process.stdout.write(JSON.stringify({ ok: false, error: err.toJSON() }, null, 2) + "\n");
  else process.stderr.write(`Error ${err.code}: ${err.message}${err.hint ? "\nNext: " + err.hint : ""}\n`);
});
