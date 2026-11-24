// Helpers over the `http` object every source receives. The object is environment-specific:
//   Node:      src/node/http.js (cookie jar, retries, timeouts)
//   Extension: extension/http.js (browser cookies via credentials: "include")
// Interface: http.request(url, {method, headers, body, form, json, redirect}) → {status, ok, url, headers, text(), json()}
import { httpError, CCError } from "./errors.js";

export async function getJSON(http, url, opts = {}) {
  const r = await http.request(url, { ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) } });
  if (!r.ok) throw httpError(r.status, url, opts.what);
  const t = await r.text();
  try { return JSON.parse(t.replace(/^while\(1\);/, "")); } catch { throw new CCError("PARSE", `${opts.what || url} did not return JSON.`, { hint: looksLikeLogin(t) ? "The response is a sign-in page: the session or token is not valid." : "Check the URL." }); }
}

export async function getText(http, url, opts = {}) {
  const r = await http.request(url, { ...opts, headers: { Accept: "text/html,application/xhtml+xml,text/calendar,*/*", ...(opts.headers || {}) } });
  if (!r.ok) throw httpError(r.status, url, opts.what);
  return { text: await r.text(), url: r.url || url };
}

/** Parse an RFC 5988 Link header and return the rel="next" URL. */
export function nextLink(h) {
  if (!h) return null;
  for (const part of h.split(",")) { const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part); if (m) return m[1]; }
  return null;
}

/** GET every page of a Link-paginated JSON list (Canvas style). */
export async function getPaged(http, url, opts = {}, maxPages = 40) {
  const out = []; let u = url, n = 0;
  while (u && n++ < maxPages) {
    const r = await http.request(u, { ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) } });
    if (!r.ok) throw httpError(r.status, u, opts.what);
    const t = await r.text();
    let page; try { page = JSON.parse(t.replace(/^while\(1\);/, "")); } catch { throw new CCError("PARSE", `${opts.what || u} did not return JSON.`, { hint: looksLikeLogin(t) ? "The response is a sign-in page: the session or token is not valid." : "Check the host." }); }
    if (Array.isArray(page)) out.push(...page); else return page;
    u = nextLink(r.headers.get("link"));
  }
  return out;
}

/** Run `fn` over `list` with at most `n` in flight. Results keep input order; errors are returned, not thrown. */
export async function pool(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; try { out[k] = { ok: true, value: await fn(list[k], k) }; } catch (e) { out[k] = { ok: false, error: e }; } }
  }));
  return out;
}

export const looksLikeLogin = (t) => /<form[^>]+(login|signin|sign_in|session)|name=["']?(passwd|password)["']?/i.test(String(t || "").slice(0, 60000));

/** Normalize a host or URL to an origin: "ucsb.instructure.com" → "https://ucsb.instructure.com" */
export function origin(hostOrUrl) {
  const s = String(hostOrUrl || "").trim();
  if (!s) return "";
  try { return new URL(/^https?:\/\//i.test(s) ? s : "https://" + s).origin; } catch { return ""; }
}

export const qs = (o) => Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v == null ? [] : [[k, v]])).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
