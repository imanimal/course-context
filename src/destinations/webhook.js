// Webhook: POST JSON to any URL when the work list changes. Feeds Zapier, Make, n8n, IFTTT, Pipedream,
// Home Assistant, Slack/Discord bridges, or a self-written to-do app.
// Body (docs/api.md#webhook):
// { event: "course-context.updated", generatedAt, timezone, changes: {added: [todo], changed: [todo], completed: [todo], removed: [id]}, todos: [todo], context?: cc/1 }
import { toTodos } from "../core/todo.js";
import { httpError } from "../core/errors.js";

export const webhook = {
  type: "webhook", kind: "event", title: "Webhook (POST JSON on change)",
  fields: {
    url: { required: true, secret: true, about: "HTTPS URL to POST to." },
    headers: { about: "Extra headers, values may be secret refs (e.g. {\"Authorization\": \"env:HOOK_TOKEN\"})." },
    includeContext: { about: "true: also send the full cc/1 context (larger)." },
    always: { about: "true: POST on every sync, even with no changes." },
  },
  async push({ cfg, context, state, secret, http, dryRun }) {
    const todos = toTodos(context, { includeDone: true });
    const prev = state.todos || {};
    const now = {};
    const changes = { added: [], changed: [], completed: [], removed: [] };
    for (const t of todos) {
      now[t.id] = { hash: t.hash, done: t.done };
      const p = prev[t.id];
      if (!p) { if (!t.done) changes.added.push(t); }
      else if (t.done && !p.done) changes.completed.push(t);
      else if (p.hash !== t.hash) changes.changed.push(t);
    }
    for (const id of Object.keys(prev)) if (!now[id]) changes.removed.push(id);
    const any = changes.added.length + changes.changed.length + changes.completed.length + changes.removed.length;
    if (!any && !cfg.always) return { written: 0, removed: 0, unchanged: todos.length, detail: "no changes" };
    if (dryRun) return { written: any, removed: 0, unchanged: todos.length - any };
    const headers = { "Content-Type": "application/json" };
    for (const [k, v] of Object.entries(cfg.headers || {})) headers[k] = await secret(v, k);
    const body = { event: "course-context.updated", generatedAt: context.generatedAt, timezone: context.timezone, changes, todos: todos.filter((t) => !t.done), ...(cfg.includeContext ? { context } : {}) };
    const u = await secret(cfg.url, "url");
    const r = await http.request(u, { method: "POST", headers, body: JSON.stringify(body) });
    await r.text();
    if (!r.ok) throw httpError(r.status, u, "webhook");
    state.todos = now;
    return { written: any, removed: changes.removed.length, unchanged: todos.length - any, detail: `${changes.added.length} added, ${changes.changed.length} changed, ${changes.completed.length} completed` };
  },
};

// Push the whole context to another course-context server (self-hosted, always on). The server stores it as a
// snapshot source and serves it to remote chatbots and apps (docs/self-host.md, option 3).
export const server = {
  type: "server", kind: "event", title: "Another course-context server",
  fields: {
    url: { required: true, about: "Server base URL, e.g. https://cc.example.com" },
    token: { required: true, secret: true, about: "That server's token (course-context server token, on the server)." },
    snapshotId: { about: "Snapshot name on the server (default: this destination's id)." },
  },
  async push({ cfg, context, state, secret, http, dryRun }) {
    const body = JSON.stringify(context);
    const sig = body.replace(/"(generatedAt|fetchedAt)":"[^"]*"/g, "");
    if (state.last === sig.length + ":" + simpleHash(sig)) return { written: 0, removed: 0, unchanged: 1, detail: "no changes" };
    if (dryRun) return { written: 1, removed: 0, unchanged: 0 };
    const u = `${String(cfg.url).replace(/\/$/, "")}/v1/ingest/${encodeURIComponent(cfg.snapshotId || cfg.id)}`;
    const r = await http.request(u, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await secret(cfg.token, "token")) }, body });
    await r.text();
    if (!r.ok) throw httpError(r.status, u, "course-context server");
    state.last = sig.length + ":" + simpleHash(sig);
    return { written: 1, removed: 0, unchanged: 0, detail: u.replace(/\/v1\/ingest\/.*/, "") };
  },
};
function simpleHash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
