// The Node sync pipeline: sources → context (snapshot.json) → rendered files → every destination.
// Safe to run repeatedly (cron, launchd, Task Scheduler, MCP sync_now, HTTP POST /v1/sync).
// A failing source keeps its last good data (marked stale); a failing destination never blocks the others.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { collect } from "../core/collect.js";
import { renderFiles } from "../core/render.js";
import { asCC, CCError } from "../core/errors.js";
import { createHttp } from "./http.js";
import { resolveSecret } from "./secrets.js";
import { home, snapshotPath, statePath, readJSON, writeAtomic, expand, inboxDir, ensureDir } from "./paths.js";
import * as config from "./config.js";
import { DESTINATIONS } from "../destinations/index.js";
import { VERSION } from "./version.js";

export function readState() { return readJSON(statePath(), {}) || {}; }
export function writeState(s) { writeAtomic(statePath(), JSON.stringify(s, null, 2), 0o600); }
export function readSnapshot() { return readJSON(snapshotPath(), null); }

/** Node environment for core/collect.js. */
export function nodeEnv() {
  return {
    http: () => createHttp(),
    secret: (ref, info) => resolveSecret(ref, info),
    readFile: async (p) => fs.readFileSync(path.resolve(expand(p)), "utf8"),
    exec: async (cmd, timeout) => execSync(cmd, { encoding: "utf8", timeout, maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] }),
    importModule: async (p) => import(/^[a-z]+:\/\//i.test(p) ? p : pathToFileURL(path.resolve(expand(p))).href),
    readSnapshot: async (id) => readJSON(path.join(inboxDir(), `${id}.json`), null),
  };
}

/**
 * @param {{only?: string[], dests?: string[], dryRun?: boolean, noFetch?: boolean, now?: number, log?: (s: string) => void}} [o]
 *   noFetch: re-render and push from the last data without contacting sources (after a user-layer edit).
 */
export async function runSync(o = {}) {
  const started = Date.now();
  const cfg = config.load();
  const st = readState();
  st.sources = st.sources || {};
  st.dests = st.dests || {};
  const previous = {};
  for (const [id, s] of Object.entries(st.sources)) if (s && s.data) previous[id] = { data: s.data, fetchedAt: s.fetchedAt };
  const ids = cfg.sources.map((s) => s.id);
  // noFetch: no network; local inputs (inbox snapshots, manual files) are still read so a fresh ingest shows up
  const local = cfg.sources.filter((x) => (x.type === "snapshot" && !x.url) || (x.type === "manual" && !x.url)).map((x) => x.id);
  const only = o.noFetch ? (local.length ? local : ["\u0000none"]) : o.only;
  if (o.only) for (const id of o.only) if (!ids.includes(id)) throw new CCError("NOT_FOUND", `No source ${id}.`, { hint: "Run: course-context source list" });
  const { context, results } = await collect({
    sources: cfg.sources, user: cfg.user, options: cfg.options, tz: cfg.timezone, now: o.now, previous, only,
    env: nodeEnv(), generator: { name: "course-context", version: VERSION },
  });
  // remember last good data per source
  for (const r of results) {
    const prev = st.sources[r.source.id] || {};
    st.sources[r.source.id] = r.ok && !r.skipped
      ? { ok: true, fetchedAt: r.fetchedAt, data: r.data, warnings: r.warnings, error: null, lastOk: r.fetchedAt }
      : r.skipped ? prev : { ...prev, ok: false, error: r.error, warnings: r.warnings, lastError: Date.now() };
  }
  for (const id of Object.keys(st.sources)) if (!ids.includes(id)) delete st.sources[id];
  if (!o.dryRun) writeAtomic(snapshotPath(), JSON.stringify(context, null, 2), 0o600);
  const files = renderFiles(context, { horizonDays: cfg.options.horizonDays, folderName: cfg.options.folderName });

  // destinations
  const destReports = [];
  const completedRemotely = [];
  for (const d of cfg.destinations) {
    if (d.enabled === false) continue;
    if (o.dests && !o.dests.includes(d.id)) continue;
    const mod = DESTINATIONS[d.type];
    const dstate = (st.dests[d.id] = st.dests[d.id] || {});
    const t0 = Date.now();
    try {
      if (!mod) throw new CCError("DEST_UNKNOWN", `Unknown destination type ${d.type}.`);
      const http = createHttp();
      const r = await mod.push({ cfg: d, files, context, state: dstate, http, home: home(), dryRun: !!o.dryRun, secret: (ref, field) => resolveSecret(ref, { dest: d.id, field }), log: o.log || (() => {}) });
      if (r.completedRemotely) completedRemotely.push(...r.completedRemotely);
      dstate.last = { ok: true, at: Date.now(), written: r.written, removed: r.removed, detail: r.detail || null };
      destReports.push({ id: d.id, type: d.type, ok: true, ms: Date.now() - t0, written: r.written, removed: r.removed, unchanged: r.unchanged, detail: r.detail || null });
    } catch (e) {
      const err = asCC(e, "DEST_WRITE"); err.dest = d.id;
      dstate.last = { ok: false, at: Date.now(), error: err.toJSON() };
      destReports.push({ id: d.id, type: d.type, ok: false, ms: Date.now() - t0, error: err.toJSON() });
    }
  }
  // tasks completed inside a to-do app become "done" in the student's layer
  if (completedRemotely.length && !o.dryRun) {
    const c2 = config.load();
    for (const id of completedRemotely) c2.user.items[id] = { ...(c2.user.items[id] || {}), done: true, doneVia: "todo-app" };
    config.save(c2);
  }
  const report = {
    ok: results.every((r) => r.ok) && destReports.every((d) => d.ok),
    at: new Date(context.generatedAt).toISOString(), ms: Date.now() - started, dryRun: !!o.dryRun,
    counts: { classes: context.classes.length, items: context.items.length, open: context.items.filter((i) => i.status === "todo" || i.status === "missing").length, announcements: context.announcements.length },
    sources: results.map((r) => ({ id: r.source.id, type: r.source.type, ok: r.ok, skipped: !!r.skipped, stale: !!r.stale, items: r.data && r.data.items ? r.data.items.length : 0, warnings: r.warnings && r.warnings.length ? r.warnings : undefined, error: r.error || undefined })),
    destinations: destReports,
    completedInTodoApps: completedRemotely.length ? completedRemotely : undefined,
    files: Object.keys(files).length,
  };
  if (!cfg.sources.length) report.note = "No sources configured. Add one: course-context source add <type> ...";
  if (!cfg.destinations.length) report.note = (report.note ? report.note + " " : "") + `No destinations configured; the snapshot is at ${snapshotPath()} and the MCP server and HTTP API read it.`;
  if (!o.dryRun) { st.lastSync = report; writeState(st); }
  return report;
}

/** Save a snapshot pushed by the browser extension or another computer (POST /v1/ingest). */
export function ingest(id, ctx) {
  if (!ctx || !/^cc\//.test(ctx.schema || "")) throw new CCError("USAGE", "Body must be a cc/1 context document.");
  if (!/^[\w.-]{1,64}$/.test(id)) throw new CCError("USAGE", "Bad snapshot id.");
  ensureDir(inboxDir());
  writeAtomic(path.join(inboxDir(), `${id}.json`), JSON.stringify(ctx), 0o600);
  const cfg = config.load({ create: true });
  if (!cfg.sources.some((s) => s.type === "snapshot" && s.id === id)) { config.upsert(cfg, "source", { id, type: "snapshot" }); config.save(cfg); }
  return { ok: true, id, items: (ctx.items || []).length };
}
