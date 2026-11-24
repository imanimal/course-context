// WeBWorK (https://openwebwork.org) problem sets and their dates, read from the course home page.
// Ported from PocketCanvas src/lib/apps.js. Auth: username + password (WeBWorK's own login form),
// a Cookie header, or the browser session (extension). Many schools only open WeBWorK from Canvas (LTI);
// then the home page says "You must access assignments from your Course Management System" and only the
// browser extension (signed in through Canvas) can read it. That case raises LMS_ONLY.
import { parseHTML, textOf } from "../core/html.js";
import { parsePrinted } from "../core/dates.js";
import { codeFromId } from "../core/match.js";
import { CCError } from "../core/errors.js";
import { getText } from "../core/fetchutil.js";

const PAGES = new Set(["hardcopy", "options", "grades", "instructor", "achievements", "feedback", "logout", "equation_display", "show_me_another", "problem_list", "render_rpc"]);
const NOT_COURSE = new Set(["admin", "ltiadvantage", "ltiadvanced", "lti", "html2xml", "render_rpc", "instructorXMLHandler", "images", "htdocs", "login", "logout", "course_admin"]);

/** "https://host/webwork2/math4B-01-f26-x/Homework_3/?user=y" → { base, id, set, code, key, home } */
export function wwFromUrl(u) {
  let url; try { url = new URL(u); } catch { return null; }
  const segs = url.pathname.split("/").filter(Boolean);
  const at = segs.indexOf("webwork2");
  if (at < 0 || !segs[at + 1] || NOT_COURSE.has(segs[at + 1]) || !/^[\w.-]+$/.test(segs[at + 1])) return null;
  const id = segs[at + 1], set = segs[at + 2] && !PAGES.has(segs[at + 2]) && /^[\w.-]+$/.test(segs[at + 2]) ? decodeURIComponent(segs[at + 2]) : null;
  const base = `${url.origin}/${segs.slice(0, at + 1).join("/")}`;
  return { base, id, set, code: codeFromId(id), key: `${url.host}/${id}`, home: `${base}/${id}/` };
}

/** Cross-source refs for app links found on LMS items (WeBWorK sets, Gradescope assignments). */
export function appRefs(urls) {
  const out = [];
  for (const u of urls || []) {
    const r = wwFromUrl(u);
    if (r && r.set) out.push(`webwork:${r.key}/${r.set}`);
    const m = String(u).match(/gradescope\.com\/courses\/(\d+)\/assignments\/(\d+)/);
    if (m) out.push(`gradescope:${m[1]}/${m[2]}`);
  }
  return out;
}

/** Status sentence → dates: "Open, closes D." · "Open, due D. Afterward reduced credit ... until D2." · "Will open on D." · "Closed, ..." */
export function wwStatus(set, status, tz) {
  for (const raw of String(status).split(/\.\s+|\.$/)) {
    const s = raw.trim(), l = s.toLowerCase();
    if (l.startsWith("will open on")) set.opens = parsePrinted(s, tz);
    else if (/^open, (closes|due)\b/.test(l) || l.startsWith("due date") || /^(closes|due) /.test(l)) set.due = parsePrinted(s, tz);
    else if (l.includes("reduced credit") && l.includes(" until ")) set.lateDue = parsePrinted(s.slice(l.lastIndexOf(" until ")), tz);
    else if (l.startsWith("closed")) set.closed = true;
  }
  return set;
}

export const wwIsLogin = (d) => !d.querySelector(".problem_set_table") && (!!d.querySelector("#login_form, form[name=login], input[name=passwd]") || /external authentication system/i.test(textOf(d.body)));
export const wwLmsOnly = (d) => !d.querySelector(".problem_set_table") && /must access assignments from your Course Management System/i.test(textOf(d.body));

/** Set rows of a course home page. */
export function wwSets(d, ref, tz) {
  const out = [];
  for (const tr of d.querySelectorAll(".problem_set_table tr")) {
    const td = tr.querySelectorAll("td"); if (td.length < 2) continue;
    const name = textOf(td[0]); if (!name) continue;
    const a = td[0].querySelector("a[href]"), r = a && wwFromUrl(new URL(a.getAttribute("href"), ref.home).href);
    const id = (r && r.set) || name.replace(/ /g, "_");
    out.push(wwStatus({ id, name: name.replace(/_/g, " "), url: `${ref.home}${encodeURIComponent(id)}/`, opens: null, due: null, lateDue: null, closed: false }, textOf(td[td.length - 1]) || textOf(td[1]), tz));
  }
  return out;
}

/** One set's own page (courses that only open from the LMS). */
export function wwSetPage(d, ref, tz) {
  const body = textOf(d.querySelector("#content, main, #page-body, body") || d);
  if (!body || wwIsLogin(d)) return null;
  const after = (re) => { const m = body.match(re); return m ? parsePrinted(body.slice(m.index + m[0].length, m.index + m[0].length + 60), tz) : null; };
  const set = { id: ref.set, name: (textOf(d.querySelector("#page-title h1, h1, h2")) || ref.set.replace(/_/g, " ")).replace(/^Homework Sets?$/i, ref.set.replace(/_/g, " ")), url: `${ref.home}${encodeURIComponent(ref.set)}/`, opens: null, due: null, lateDue: null, closed: false };
  set.due = after(/\b(?:closes|is due|due)(?: on| date)?\s*:?\s*/i);
  set.opens = after(/\bwill open on\s*/i);
  set.lateDue = /reduced credit/i.test(body) ? after(/reduced credit[^.]*?until\s*/i) : null;
  set.closed = /\b(this (set|assignment) is closed|closed, answers)/i.test(body);
  return set.due || set.opens || set.closed ? set : null;
}

export default {
  type: "webwork",
  title: "WeBWorK",
  fields: {
    url: { about: "A course URL, https://<host>/webwork2/<course>/ . Optional when discover is on and Canvas links to WeBWorK." },
    courses: { about: "List of course URLs (instead of url)." },
    username: { about: "WeBWorK username (often the school ID). Only for WeBWorK sites with their own login form." },
    password: { secret: true, about: "WeBWorK password." },
    cookie: { secret: true, about: "Cookie header from a signed-in browser (WeBWorK sessions last about 30 minutes, so this is a poor long-term choice)." },
    discover: { about: "true (default): also read every WeBWorK course that Canvas assignments or modules link to." },
    timezone: { about: "Zone for dates WeBWorK prints without one. Default: the config timezone." },
  },
  async fetch(cfg, ctx) {
    const tz = cfg.timezone || ctx.tz;
    const want = new Map();
    for (const u of [cfg.url, ...(cfg.courses || [])].filter(Boolean)) { const r = wwFromUrl(u.endsWith("/") ? u : u + "/"); if (r) want.set(r.key, { ...r, sets: new Set(), classId: null }); }
    if (cfg.discover !== false) for (const h of ctx.hints()) {
      const r = wwFromUrl(h.url); if (!r) continue;
      const e = want.get(r.key) || { ...r, sets: new Set(), classId: h.classId };
      if (r.set) e.sets.add(r.set);
      if (!e.classId) e.classId = h.classId;
      want.set(r.key, e);
    }
    if (!want.size) throw new CCError("NOT_FOUND", "No WeBWorK course to read.", { hint: "Set url to the course address (https://<host>/webwork2/<course>/), or add a Canvas source whose assignments link to WeBWorK." });
    const classes = [], items = [], problems = [];
    for (const ref of want.values()) {
      try {
        let d = parseHTML((await getText(ctx.http, ref.home, { headers: await auth(cfg, ctx), what: "WeBWorK" })).text);
        if (wwIsLogin(d) && cfg.username && cfg.password) d = await login(cfg, ctx, ref, d);
        let sets;
        if (d.querySelector(".problem_set_table")) sets = wwSets(d, ref, tz);
        else if (wwIsLogin(d)) throw new CCError("SIGNED_OUT", `WeBWorK ${ref.code}: not signed in.`, { hint: cfg.password ? "The WeBWorK username or password is wrong." : "Add username and password, or use the browser extension (WeBWorK opened from Canvas)." });
        else {
          sets = [];
          for (const s of ref.sets) { try { const sd = parseHTML((await getText(ctx.http, `${ref.home}${encodeURIComponent(s)}/`, { headers: await auth(cfg, ctx) })).text); const x = wwSetPage(sd, { ...ref, set: s }, tz); if (x) sets.push(x); } catch { /* next set */ } }
          if (!sets.length && wwLmsOnly(d)) throw new CCError("LMS_ONLY", `WeBWorK ${ref.code} only opens from the LMS.`, { hint: "Use the browser extension: it reads WeBWorK with the session Canvas opens. Dates still come through Canvas when Canvas has them." });
        }
        const cid = `webwork:${ref.key}`;
        classes.push({ id: cid, code: ref.code, name: `${ref.code} WeBWorK (${ref.id})`, matchCode: ref.code, url: ref.home });
        if (ref.classId) ctx.alias(cid, ref.classId);
        for (const s of sets) items.push({ id: `webwork:${ref.key}/${s.id}`, classId: cid, classCode: ref.code, kind: "assignment", title: s.name, url: s.url, due: s.due, lateDue: s.lateDue, unlockAt: s.opens, status: s.closed ? "closed" : "todo" });
      } catch (e) { problems.push(e); ctx.warn(`${ref.code}: ${e.message}`); }
    }
    if (!items.length && problems.length) throw problems[0];
    return { classes, items };
  },
};

async function auth(cfg, ctx) { return !ctx.browser && cfg.cookie ? { Cookie: await ctx.secret(cfg.cookie, "cookie") } : {}; }

async function login(cfg, ctx, ref, d) {
  const form = d.querySelector("#login_form, form[name=login]") || d.querySelector("form");
  const fields = {};
  if (form) for (const i of form.querySelectorAll("input[name]")) if (i.getAttribute("type") !== "submit") fields[i.getAttribute("name")] = i.getAttribute("value") || "";
  fields.user = await ctx.secret(cfg.username, "username");
  fields.passwd = await ctx.secret(cfg.password, "password");
  const action = form && form.getAttribute("action") ? new URL(form.getAttribute("action"), ref.home).href : ref.home;
  const r = await ctx.http.request(action, { method: "POST", form: fields, headers: { Accept: "text/html" } });
  const t = await r.text();
  const d2 = parseHTML(t);
  if (d2.querySelector(".problem_set_table")) return d2;
  return parseHTML((await getText(ctx.http, ref.home, { what: "WeBWorK" })).text);
}
