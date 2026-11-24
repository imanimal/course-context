// Course Context browser extension (Chrome, Edge, Brave, Firefox). Reads Canvas, WeBWorK and Gradescope with
// the student's own browser sign-in, builds the same cc/1 context as the CLI (lib/ is a copy of src/core and
// src/sources made by tools/build-extension.mjs), and sends it to:
//   - the course-context app on this computer or a self-hosted server (POST /v1/ingest/<id>, Bearer token)
//   - the Downloads folder (Downloads/Course Context/...), which can live inside a synced cloud folder
// Settings live in storage.local "settings"; the last result in "status".
import { collect } from "./lib/core/collect.js";
import { renderFiles } from "./lib/core/render.js";
import { localZone } from "./lib/core/dates.js";

const api = globalThis.browser || globalThis.chrome;
const ALARM = "course-context-sync";
export const DEFAULTS = { canvasHosts: [], icsUrls: [], webwork: false, gradescope: false, sendLocal: true, localUrl: "http://127.0.0.1:8787", localToken: "", serverUrl: "", serverToken: "", download: false, everyMinutes: 30, snapshotId: "browser" };

const get = async (k, d) => ((await api.storage.local.get(k))[k] ?? d);
const set = (o) => api.storage.local.set(o);

function browserHttp() {
  return {
    async request(url, o = {}) {
      const headers = { ...(o.headers || {}) };
      let body = o.body;
      if (o.form) { body = new URLSearchParams(o.form).toString(); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
      if (o.json !== undefined) { body = JSON.stringify(o.json); headers["Content-Type"] = "application/json"; }
      const r = await fetch(url, { method: o.method || "GET", headers, body, credentials: "include", redirect: "follow" });
      let t = null;
      return { status: r.status, ok: r.ok, url: r.url, headers: r.headers, text: async () => (t ??= await r.text()), json: async () => JSON.parse(t ??= await r.text()) };
    },
  };
}

export async function syncNow() {
  const s = { ...DEFAULTS, ...(await get("settings", {})) };
  const started = Date.now();
  const sources = [
    ...s.canvasHosts.map((h, i) => ({ id: `canvas-${i + 1}`, type: "canvas", host: h })),
    ...s.icsUrls.map((u, i) => ({ id: `ics-${i + 1}`, type: "ics", url: u })),
    ...(s.webwork ? [{ id: "webwork", type: "webwork", discover: true }] : []),
    ...(s.gradescope ? [{ id: "gradescope", type: "gradescope" }] : []),
  ];
  const status = { at: new Date().toISOString(), ok: true, sources: [], sent: [] };
  if (!sources.length) { status.ok = false; status.message = "Add your Canvas address first."; await set({ status }); return status; }
  const previous = await get("previous", {});
  const { context, results } = await collect({ sources, tz: localZone(), env: { http: browserHttp, secret: async (v) => v, browser: true }, previous, generator: { name: "course-context-extension", version: api.runtime.getManifest().version } });
  const keep = {};
  for (const r of results) {
    status.sources.push({ id: r.source.id, ok: r.ok, items: r.data && r.data.items ? r.data.items.length : 0, error: r.error ? r.error.message : null });
    if (r.ok && r.data) keep[r.source.id] = { data: r.data, fetchedAt: r.fetchedAt };
    else if (previous[r.source.id]) keep[r.source.id] = previous[r.source.id];
  }
  // WeBWorK with no linked course is not a problem worth showing
  status.sources = status.sources.filter((x) => !(x.id === "webwork" && !x.ok && /No WeBWorK course/.test(x.error || "")));
  await set({ previous: keep, lastContext: context });
  const post = async (base, token, label) => {
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/v1/ingest/${encodeURIComponent(s.snapshotId)}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(context) });
      status.sent.push({ to: label, ok: r.ok, status: r.status });
    } catch (e) { status.sent.push({ to: label, ok: false, error: "not reachable" }); }
  };
  if (s.sendLocal && s.localUrl) await post(s.localUrl, s.localToken, "this computer");
  if (s.serverUrl) await post(s.serverUrl, s.serverToken, "server");
  if (s.download) {
    const files = renderFiles(context);
    for (const [p, body] of Object.entries(files)) {
      const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([body], { type: "text/plain" })) : "data:text/plain;charset=utf-8;base64," + b64(body);
      await api.downloads.download({ url, filename: `Course Context/${p}`, conflictAction: "overwrite", saveAs: false });
    }
    status.sent.push({ to: "Downloads/Course Context", ok: true });
  }
  status.ok = status.sources.every((x) => x.ok) && status.sent.every((x) => x.ok);
  status.ms = Date.now() - started;
  status.counts = { classes: context.classes.length, items: context.items.length };
  await set({ status });
  return status;
}

function b64(s) { const bytes = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); }

async function schedule() {
  const s = { ...DEFAULTS, ...(await get("settings", {})) };
  await api.alarms.clear(ALARM);
  api.alarms.create(ALARM, { periodInMinutes: Math.max(5, Number(s.everyMinutes) || 30), delayInMinutes: 1 });
}

api.runtime.onInstalled.addListener(() => { schedule(); api.runtime.openOptionsPage(); });
api.runtime.onStartup.addListener(schedule);
api.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) syncNow().catch(() => {}); });
api.action.onClicked.addListener(() => api.runtime.openOptionsPage());
api.runtime.onMessage.addListener((m, sender, reply) => {
  if (m && m.type === "sync") { syncNow().then(reply, (e) => reply({ ok: false, message: String(e.message || e) })); return true; }
  if (m && m.type === "reschedule") { schedule().then(() => reply({ ok: true })); return true; }
  return false;
});
