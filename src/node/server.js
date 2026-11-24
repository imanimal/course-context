// HTTP server: a REST API for any to-do app, script or AI (described by /openapi.json), MCP over Streamable
// HTTP at /mcp for remote chatbots, an inbox for the browser extension, and calendar/task feeds.
// Auth: the server token (config.server.token or --token) as "Authorization: Bearer <token>", "?key=<token>",
// or a "/k/<token>/" path prefix (for apps that cannot set headers). Requests from this machine that carry
// no Origin header and use a loopback Host need no token (CLI tools, local agents); browsers always need it.
import http from "node:http";
import crypto from "node:crypto";
import { makeStore } from "./api.js";
import { createMcp, PROTOCOL_VERSIONS } from "../mcp/server.js";
import { openapi, apiLlmsTxt } from "./openapi.js";
import { asCC, exitFor, CCError } from "../core/errors.js";
import { writeTodoICS, writeICS } from "../core/ics.js";
import { toTodos } from "../core/todo.js";
import { runSync, ingest } from "./sync.js";
import { VERSION } from "./version.js";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const STATUS_FOR_EXIT = { 2: 400, 3: 401, 4: 404, 5: 207, 75: 503, 1: 500 };

/**
 * @param {{host?: string, port?: number, token: string, from?: string, readOnly?: boolean, syncEveryMinutes?: number, publicUrl?: string, log?: (s: string) => void}} o
 */
export function startServer(o) {
  const api = makeStore({ from: o.from });
  const readOnly = !!(o.readOnly || o.from);
  const log = o.log || (() => {});
  const tokenBuf = Buffer.from(String(o.token || ""));
  const tokenOk = (t) => { if (!o.token || !t) return false; const b = Buffer.from(String(t)); return b.length === tokenBuf.length && crypto.timingSafeEqual(b, tokenBuf); };

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    let url = new URL(req.url, "http://x");
    let pathname = url.pathname;
    let token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("key");
    const km = /^\/k\/([^/]+)(\/.*)?$/.exec(pathname);
    if (km) { token = decodeURIComponent(km[1]); pathname = km[2] || "/"; }
    const origin = req.headers.origin;
    const cors = { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Expose-Headers": "Mcp-Session-Id", Vary: "Origin" };
    const send = (status, body, type = "application/json; charset=utf-8", extra = {}) => {
      const data = typeof body === "string" ? body : JSON.stringify(body, null, 2);
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...cors, ...extra });
      res.end(req.method === "HEAD" ? undefined : data);
      log(`${req.method} ${pathname} ${status} ${Date.now() - started}ms`);
    };
    const fail = (e) => { const err = asCC(e); send(STATUS_FOR_EXIT[exitFor(err.code)] || 500, { ok: false, error: err.toJSON() }); };
    if (req.method === "OPTIONS") { res.writeHead(204, { ...cors, "Access-Control-Max-Age": "600" }); return res.end(); }
    try {
      // public, data-free routes
      if (pathname === "/health") return send(200, { ok: true, name: "course-context", version: VERSION });
      if (pathname === "/openapi.json") return send(200, openapi({ serverUrl: o.publicUrl || `http://${req.headers.host}`, readOnly }));
      if (pathname === "/llms.txt" || pathname === "/") {
        if (pathname === "/" && /json/.test(req.headers.accept || "")) return send(200, { name: "course-context", version: VERSION, openapi: "/openapi.json", llms: "/llms.txt", mcp: "/mcp", auth: "Authorization: Bearer <token>, ?key=<token>, or /k/<token>/ prefix" });
        return send(200, apiLlmsTxt({ serverUrl: o.publicUrl || `http://${req.headers.host}`, readOnly }), "text/plain; charset=utf-8");
      }
      // auth
      const hostHeader = String(req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
      const localTrusted = LOOPBACK.has(req.socket.remoteAddress) && !origin && ["localhost", "127.0.0.1", "::1"].includes(hostHeader);
      if (!localTrusted && !tokenOk(token)) return send(401, { ok: false, error: { code: "AUTH_INVALID", message: "Missing or wrong token.", hint: "Send Authorization: Bearer <token>, ?key=<token>, or use /k/<token>/ in the path. The token is in config.json under server.token (course-context server token)." } }, "application/json; charset=utf-8", { "WWW-Authenticate": 'Bearer realm="course-context"' });

      // MCP
      if (pathname === "/mcp") {
        if (req.method === "GET" || req.method === "DELETE") return send(405, { ok: false, error: { code: "METHOD", message: "This MCP server is stateless: POST JSON-RPC only." } }, "application/json", { Allow: "POST, OPTIONS" });
        if (req.method !== "POST") return send(405, { ok: false }, "application/json", { Allow: "POST, OPTIONS" });
        const body = await readBody(req, 1 << 20);
        let msg; try { msg = JSON.parse(body); } catch { return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
        const pv = req.headers["mcp-protocol-version"];
        if (pv && !PROTOCOL_VERSIONS.includes(pv)) return send(400, { jsonrpc: "2.0", id: null, error: { code: -32022, message: `Unsupported MCP-Protocol-Version ${pv}. Supported: ${PROTOCOL_VERSIONS.join(", ")}` } });
        const mm = req.headers["mcp-method"];
        if (mm && !Array.isArray(msg) && msg && msg.method !== mm) return send(400, { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32020, message: `Mcp-Method header (${mm}) does not match the body (${msg.method}).` } });
        const mv = !Array.isArray(msg) && msg && msg.params && msg.params._meta && msg.params._meta["io.modelcontextprotocol/protocolVersion"];
        if (pv && mv && pv !== mv) return send(400, { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32020, message: "MCP-Protocol-Version header does not match params._meta." } });
        const mcp = createMcp(api, { readOnly, protocolVersion: pv || mv || (Array.isArray(msg) || (msg && msg.method === "initialize") ? undefined : "2025-03-26") });
        const out = await mcp.dispatch(msg);
        if (!out) { res.writeHead(202, cors); return res.end(); }
        const status = !Array.isArray(out) && out._status ? out._status : 200;
        return send(status, JSON.stringify(out, (k, v) => (k === "_status" ? undefined : v)));
      }

      // REST v1
      const m = /^\/v1\/(.*)$/.exec(pathname);
      if (!m) return send(404, { ok: false, error: { code: "NOT_FOUND", message: `No route ${pathname}.`, hint: "GET /openapi.json lists every route." } });
      const parts = m[1].split("/").map(decodeURIComponent);
      const q = Object.fromEntries(url.searchParams);
      const num = (k) => (q[k] != null && q[k] !== "" ? Number(q[k]) : undefined);
      const flag = (k) => (q[k] == null ? undefined : !/^(0|false|no)$/i.test(q[k]));
      const body = async () => { if (!["POST", "PATCH", "PUT"].includes(req.method)) return {}; const t = await readBody(req, 20 << 20); try { return t ? JSON.parse(t) : {}; } catch { throw new CCError("USAGE", "Body is not valid JSON."); } };
      const write = () => { if (readOnly) throw new CCError("READ_ONLY", "This server is read-only."); };
      const [a, b, ...rest] = parts;
      const isGet = req.method === "GET" || req.method === "HEAD";

      if (a === "status" && isGet) return send(200, await api.status());
      if (a === "overview" && isGet) return send(200, await api.overview(), "text/markdown; charset=utf-8");
      if (a === "context" && isGet) return send(200, await api.context());
      if (a === "todo" && isGet) return send(200, await api.todo({ includeDone: !!flag("include_done"), horizonDays: num("horizon_days") ?? null, includeUndated: flag("include_undated"), classes: q.class ? [q.class] : undefined }));
      if (a === "todo.ics" && isGet) { const c = await api.context(); return send(200, writeTodoICS(toTodos(c, {})), "text/calendar; charset=utf-8"); }
      if (a === "calendar.ics" && isGet) { const f = await api.files(); return send(200, f["calendar.ics"], "text/calendar; charset=utf-8"); }
      if (a === "items" && !b && isGet) return send(200, await api.listWork({ class: q.class, status: q.status, dueWithinDays: num("due_within_days"), includeUndated: flag("include_undated"), kind: q.kind, query: q.q || q.query, limit: num("limit"), format: q.format }));
      if (a === "items" && b && isGet) return send(200, await api.getItem([b, ...rest].join("/")));
      if (a === "items" && b && (req.method === "PATCH" || req.method === "POST")) { write(); return send(200, await api.updateItem([b, ...rest].join("/"), await body())); }
      if (a === "tasks" && !b && req.method === "POST") { write(); return send(201, await api.addTask(await body())); }
      if (a === "tasks" && b && (req.method === "PATCH" || req.method === "POST")) { write(); return send(200, await api.updateTask(b, await body())); }
      if (a === "tasks" && b && req.method === "DELETE") { write(); return send(200, await api.updateTask(b, { delete: true })); }
      if (a === "classes" && !b && isGet) return send(200, await api.classes());
      if (a === "classes" && b && isGet) { const r = await api.getClass(b); return /markdown/.test(req.headers.accept || "") ? send(200, r.markdown + "\n\n" + r.work, "text/markdown; charset=utf-8") : send(200, r.class); }
      if (a === "classes" && b && (req.method === "PATCH" || req.method === "POST")) { write(); return send(200, await api.updateClass(b, await body())); }
      if (a === "announcements" && isGet) return send(200, await api.announcements({ class: q.class, days: num("days"), limit: num("limit") }));
      if (a === "search" && isGet) return send(200, await api.search(q.q || q.query, num("limit")));
      if (a === "files" && isGet) {
        const p = [b, ...rest].filter(Boolean).join("/");
        if (!p) return send(200, Object.keys(await api.files()));
        const t = await api.file(p);
        return send(200, t, p.endsWith(".json") ? "application/json; charset=utf-8" : p.endsWith(".ics") ? "text/calendar; charset=utf-8" : p.endsWith(".txt") ? "text/plain; charset=utf-8" : "text/markdown; charset=utf-8");
      }
      if (a === "sync" && req.method === "POST") { write(); const bb = await body(); return send(200, await runSync({ only: bb.sources })); }
      if (a === "ingest" && req.method === "POST") { write(); const r = ingest(b || "extension", await body()); const s = await runSync({ noFetch: true }).catch((e) => ({ ok: false, error: asCC(e).toJSON() })); return send(200, { ...r, resynced: s.ok }); }
      return send(404, { ok: false, error: { code: "NOT_FOUND", message: `No route ${req.method} ${pathname}.`, hint: "GET /openapi.json lists every route." } });
    } catch (e) { fail(e); }
  });

  let timer = null;
  if (o.syncEveryMinutes && !readOnly) {
    const tick = async () => { try { const r = await runSync(); log(`sync ${r.ok ? "ok" : "with problems"}: ${r.counts.items} items`); } catch (e) { log("sync failed: " + asCC(e).message); } };
    setTimeout(tick, 2000);
    timer = setInterval(tick, o.syncEveryMinutes * 60e3);
  }
  server.on("close", () => timer && clearInterval(timer));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port ?? 8787, o.host || "127.0.0.1", () => resolve(server));
  });
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => { n += c.length; if (n > max) { reject(new CCError("USAGE", "Body too large.")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
