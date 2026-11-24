// Gradescope (no public API). Reads /account (course list) and /courses/<id> (assignment table).
// Ported from PocketCanvas src/lib/apps.js. Auth: email + password (Gradescope accounts with a password),
// a Cookie header (signed_token=...; remember_me=...), or the browser session (extension).
// School-SSO-only accounts have no password: use the cookie or the extension.
import { parseHTML, textOf } from "../core/html.js";
import { codeFromId } from "../core/match.js";
import { CCError } from "../core/errors.js";
import { getText } from "../core/fetchutil.js";

export const GS = "https://www.gradescope.com";
export const gsIsLogin = (d) => !!d.querySelector('form[action$="/login"], form[action$="/login/"]') && !d.querySelector(".courseBox, .submissionTimeChart");

export function gsCourses(d) {
  let student = !d.querySelector(".js-createNewCourse"), term = "";
  const out = [];
  for (const el of d.querySelectorAll(".pageHeading, .courseList--term, a.courseBox")) {
    if (el.classList.contains("pageHeading")) { const h = textOf(el).toLowerCase(); if (h.includes("student")) student = true; else if (h.includes("instructor")) student = false; }
    else if (el.classList.contains("courseList--term")) term = textOf(el);
    else if (student) {
      const m = (el.getAttribute("href") || "").match(/\/courses\/(\d+)/), short = textOf(el.querySelector(".courseBox--shortname"));
      if (m && short && !out.some((c) => c.id === m[1])) out.push({ id: m[1], short, name: textOf(el.querySelector(".courseBox--name")), term, code: codeFromId(short) });
    }
  }
  return out;
}

export const gsTime = (s) => { const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})$/); const t = m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : Date.parse(s); return Number.isNaN(t) ? null : t; };

export function gsAssignments(d, courseId) {
  const out = [];
  for (const tr of d.querySelectorAll("tr")) {
    if ((tr.className || "").includes("dropzonePreview")) continue;
    const cells = tr.querySelectorAll("th, td"); if (!cells.length) continue;
    const dues = tr.querySelectorAll("[datetime].submissionTimeChart--dueDate").map((t) => gsTime(t.getAttribute("datetime"))).filter(Boolean);
    const idEl = cells[0].querySelector("[data-assignment-id]"), link = cells[0].querySelector('a[href*="/assignments/"]');
    const id = (idEl && /^\d+$/.test(idEl.getAttribute("data-assignment-id")) && idEl.getAttribute("data-assignment-id")) || (link && ((link.getAttribute("href").match(/\/assignments\/(\d+)/) || [])[1])) || null;
    const name = textOf(cells[0]);
    if (!name || (!id && !dues.length)) continue;
    const status = cells[1] ? textOf(cells[1]) : "", sm = status.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    const rel = tr.querySelector("[datetime].submissionTimeChart--releaseDate");
    out.push({ id, name, status, score: sm ? +sm[1] : null, points: sm ? +sm[2] : null, release: rel ? gsTime(rel.getAttribute("datetime")) : null, due: dues[0] || null, lateDue: dues[1] || null,
      submitted: !!sm || (/submitted/i.test(status) && !/no submission/i.test(status)), url: id ? `${GS}/courses/${courseId}/assignments/${id}` : `${GS}/courses/${courseId}` });
  }
  return out;
}

export default {
  type: "gradescope",
  title: "Gradescope",
  fields: {
    email: { about: "Gradescope account email (accounts that have a Gradescope password)." },
    password: { secret: true, about: "Gradescope password." },
    cookie: { secret: true, about: "Cookie header from a signed-in browser (signed_token=...; remember_me=...). The way in for school-SSO accounts." },
    terms: { about: '"latest" (default) or "all".' },
  },
  async fetch(cfg, ctx) {
    const headers = !ctx.browser && cfg.cookie ? { Cookie: await ctx.secret(cfg.cookie, "cookie") } : {};
    let d = parseHTML((await getText(ctx.http, GS + "/account", { headers, what: "Gradescope" })).text);
    if (gsIsLogin(d) && cfg.email && cfg.password) d = await login(cfg, ctx);
    if (gsIsLogin(d)) throw new CCError("SIGNED_OUT", "Gradescope: not signed in.", { hint: cfg.password ? "The Gradescope email or password is wrong." : "Add email and password (accounts with a Gradescope password) or a cookie, or use the browser extension (school sign-in)." });
    const all = gsCourses(d);
    const term = all.length ? all[0].term : "";
    const courses = cfg.terms === "all" ? all : all.filter((c) => c.term === term);
    const classes = [], items = [];
    for (const c of courses) {
      try {
        const page = parseHTML((await getText(ctx.http, `${GS}/courses/${c.id}`, { headers, what: "Gradescope" })).text);
        const cid = `gradescope:${c.id}`;
        classes.push({ id: cid, code: c.code, name: c.name || c.short, matchCode: c.code, term: c.term || null, url: `${GS}/courses/${c.id}` });
        for (const a of gsAssignments(page, c.id)) items.push({
          id: `gradescope:${c.id}/${a.id || a.name.toLowerCase().replace(/\W+/g, "-")}`, classId: cid, classCode: c.code, title: a.name, url: a.url, due: a.due, lateDue: a.lateDue, unlockAt: a.release,
          points: a.points, score: a.score, status: a.submitted ? (a.score != null ? "graded" : "submitted") : "todo",
        });
      } catch (e) { ctx.warn(`Gradescope ${c.short}: ${e.message}`); }
    }
    return { classes, items };
  },
};

async function login(cfg, ctx) {
  const page = parseHTML((await getText(ctx.http, GS + "/login", { what: "Gradescope" })).text);
  const tokenEl = page.querySelector('form input[name="authenticity_token"]') || page.querySelector('meta[name="csrf-token"]');
  const token = tokenEl ? tokenEl.getAttribute("value") || tokenEl.getAttribute("content") : "";
  const r = await ctx.http.request(GS + "/login", { method: "POST", form: { utf8: "✓", authenticity_token: token, "session[email]": await ctx.secret(cfg.email, "email"), "session[password]": await ctx.secret(cfg.password, "password"), "session[remember_me]": "1", commit: "Log In", "session[remember_me_sso]": "0" }, headers: { Accept: "text/html", Referer: GS + "/login" } });
  await r.text();
  return parseHTML((await getText(ctx.http, GS + "/account", { what: "Gradescope" })).text);
}
