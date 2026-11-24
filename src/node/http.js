// Node HTTP client for sources: fetch + a per-source cookie jar (login flows), manual redirects (so cookies set
// on 302s are kept), timeouts, and retries with backoff for GETs on network errors, 429 and 5xx.
import { asCC } from "../core/errors.js";

export const USER_AGENT = "course-context/0.1 (+https://github.com/imanimal/course-context)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createHttp({ timeoutMs = 30000, retries = 2, userAgent = USER_AGENT, fetchImpl = globalThis.fetch } = {}) {
  const jar = []; // {domain, name, value, hostOnly}
  const store = (url, res) => {
    const host = new URL(url).hostname;
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    for (const sc of list) {
      const [pair, ...attrs] = sc.split(";");
      const eq = pair.indexOf("="); if (eq < 1) continue;
      const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1).trim();
      const dAttr = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a));
      const domain = dAttr ? dAttr.slice(7).replace(/^\./, "").toLowerCase() : host;
      const expired = attrs.some((a) => /^max-age=0$/i.test(a.trim()) || (/^expires=/i.test(a.trim()) && Date.parse(a.trim().slice(8)) < Date.now()));
      const i = jar.findIndex((c) => c.domain === domain && c.name === name);
      if (i >= 0) jar.splice(i, 1);
      if (!expired) jar.push({ domain, name, value, hostOnly: !dAttr });
    }
  };
  const cookieFor = (url) => {
    const host = new URL(url).hostname;
    return jar.filter((c) => (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith("." + c.domain))).map((c) => `${c.name}=${c.value}`).join("; ");
  };

  async function request(url, opts = {}) {
    let u = url, method = (opts.method || "GET").toUpperCase(), body = opts.body;
    const headers = { "User-Agent": userAgent, ...(opts.headers || {}) };
    if (opts.form) { body = new URLSearchParams(opts.form).toString(); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
    if (opts.json !== undefined) { body = JSON.stringify(opts.json); headers["Content-Type"] = "application/json"; }
    const follow = opts.redirect !== "manual";
    for (let hop = 0; hop < 10; hop++) {
      const h = { ...headers };
      const jarCookie = cookieFor(u);
      if (jarCookie) h.Cookie = h.Cookie ? `${h.Cookie}; ${jarCookie}` : jarCookie;
      let res, attempt = 0;
      for (;;) {
        try {
          res = await fetchImpl(u, { method, headers: h, body, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs || timeoutMs) });
        } catch (e) {
          if (method === "GET" && attempt < retries) { await sleep(500 * 2 ** attempt++); continue; }
          throw asCC(e);
        }
        if (method === "GET" && (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
          const ra = +res.headers.get("retry-after");
          await sleep(Math.min(30000, ra > 0 ? ra * 1000 : 1000 * 2 ** attempt++));
          attempt++;
          continue;
        }
        break;
      }
      store(u, res);
      const loc = res.headers.get("location");
      if (follow && loc && [301, 302, 303, 307, 308].includes(res.status)) {
        u = new URL(loc, u).href;
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; delete headers["Content-Type"]; }
        continue;
      }
      return wrap(res, u);
    }
    throw asCC(new Error(`Too many redirects from ${url}`));
  }
  return { request, jar };
}

function wrap(res, url) {
  let textP = null;
  const text = () => (textP ||= res.text());
  return { status: res.status, ok: res.ok, url, headers: res.headers, text, json: async () => JSON.parse(await text()) };
}
