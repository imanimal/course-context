// Options page. Plain words for the student; every change saves at once.
const api = globalThis.browser || globalThis.chrome;
const DEFAULTS = { canvasHosts: [], icsUrls: [], webwork: false, gradescope: false, sendLocal: true, localUrl: "http://127.0.0.1:8787", localToken: "", serverUrl: "", serverToken: "", download: false, everyMinutes: 30, snapshotId: "browser" };
const $ = (id) => document.getElementById(id);
let S = { ...DEFAULTS };

const host = (s) => { try { return new URL(/^https?:\/\//.test(s) ? s : "https://" + s).host; } catch { return ""; } };
const originOf = (s) => { try { return new URL(s).origin; } catch { return ""; } };

async function load() {
  S = { ...DEFAULTS, ...((await api.storage.local.get("settings")).settings || {}) };
  for (const k of ["webwork", "gradescope", "sendLocal", "download"]) $(k).checked = !!S[k];
  $("localUrl").value = S.localUrl; $("localToken").value = S.localToken; $("serverUrl").value = S.serverUrl; $("serverToken").value = S.serverToken; $("every").value = S.everyMinutes;
  chips("canvasList", S.canvasHosts, (i) => { S.canvasHosts.splice(i, 1); save(); });
  chips("icsList", S.icsUrls.map((u) => host(u) || u), (i) => { S.icsUrls.splice(i, 1); save(); });
  showStatus((await api.storage.local.get("status")).status);
}

function chips(id, list, remove) {
  const ul = $(id); ul.textContent = "";
  list.forEach((t, i) => { const li = document.createElement("li"); li.textContent = t; const b = document.createElement("button"); b.textContent = "Remove"; b.onclick = () => remove(i); li.append(" ", b); ul.append(li); });
}

async function save() {
  await api.storage.local.set({ settings: S });
  $("saved").textContent = "Saved";
  setTimeout(() => ($("saved").textContent = ""), 1500);
  await api.runtime.sendMessage({ type: "reschedule" });
  load();
}

// Host access is asked for at the moment the student adds a site (browsers require a click for this).
async function allow(origins) {
  try { return await api.permissions.request({ origins }); } catch { return false; }
}

$("addCanvas").onclick = async () => {
  const h = host($("canvas").value.trim());
  if (!h) return;
  if (!(await allow([`https://${h}/*`]))) { $("saved").textContent = "The browser did not allow access, so Canvas can't be read."; return; }
  if (!S.canvasHosts.includes(h)) S.canvasHosts.push(h);
  $("canvas").value = ""; save();
};
$("addIcs").onclick = async () => {
  const u = $("ics").value.trim().replace(/^webcals?:\/\//i, "https://");
  const o = originOf(u); if (!o) return;
  if (!(await allow([`${o}/*`]))) return;
  if (!S.icsUrls.includes(u)) S.icsUrls.push(u);
  $("ics").value = ""; save();
};
for (const k of ["webwork", "gradescope", "sendLocal", "download"]) $(k).onchange = async () => {
  S[k] = $(k).checked;
  if (k === "webwork" && S.webwork) await allow(["https://*/*"]);
  save();
};
for (const [id, k] of [["localUrl", "localUrl"], ["localToken", "localToken"], ["serverUrl", "serverUrl"], ["serverToken", "serverToken"]]) $(id).onchange = async () => {
  S[k] = $(id).value.trim();
  if (k === "serverUrl" && S.serverUrl) await allow([`${originOf(S.serverUrl)}/*`]);
  save();
};
$("every").onchange = () => { S.everyMinutes = Math.max(5, Number($("every").value) || 30); save(); };
$("sync").onclick = async () => { $("status").textContent = "Syncing..."; showStatus(await api.runtime.sendMessage({ type: "sync" })); };

function showStatus(s) {
  if (!s) { $("status").textContent = "Not synced yet."; return; }
  const lines = [`Last sync: ${new Date(s.at).toLocaleString()}${s.counts ? `, ${s.counts.classes} classes, ${s.counts.items} items` : ""}`];
  if (s.message) lines.push(s.message);
  for (const x of s.sources || []) lines.push(`${x.ok ? "OK" : "Problem"}: ${x.id}${x.ok ? ` (${x.items} items)` : `: ${x.error}`}`);
  for (const x of s.sent || []) lines.push(`${x.ok ? "Sent" : "Not sent"}: ${x.to}${x.ok ? "" : x.status === 401 ? " (the token is wrong)" : x.error ? ` (${x.error})` : ` (${x.status})`}`);
  $("status").textContent = lines.join("\n");
}

load();
