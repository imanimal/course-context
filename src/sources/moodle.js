// Moodle via its web service API (the one the Moodle mobile app uses).
// Auth: a web service token, or username + password traded for a token at /login/token.php
// (service moodle_mobile_app). Sites with SSO-only accounts: the student can still open
// Preferences → Security keys on many Moodles and copy the "Moodle mobile web service" key.
import { getJSON, pool, origin, qs } from "../core/fetchutil.js";
import { htmlToMarkdown, clip } from "../core/markdown.js";
import { kindOf } from "../core/match.js";
import { CCError } from "../core/errors.js";

const DAY = 864e5;

export default {
  type: "moodle",
  title: "Moodle (web service API)",
  fields: {
    url: { required: true, example: "https://moodle.school.edu", about: "Moodle site address." },
    token: { secret: true, about: "Web service token: Preferences → Security keys → Moodle mobile web service." },
    username: { about: "Moodle username (if no token)." },
    password: { secret: true, about: "Moodle password (if no token). Traded for a token each sync." },
  },
  async test(cfg, ctx) { const s = await call(cfg, ctx, "core_webservice_get_site_info"); return { ok: true, detail: `site ${s.sitename}` }; },
  async fetch(cfg, ctx) {
    const base = origin(cfg.url), host = new URL(base).host, now = ctx.now;
    const site = await call(cfg, ctx, "core_webservice_get_site_info");
    const courses = (await call(cfg, ctx, "core_enrol_get_users_courses", { userid: site.userid })).filter((c) => !c.hidden && (!c.enddate || c.enddate * 1000 > now - 30 * DAY));
    const cid = (id) => `moodle:${host}/course/${id}`;
    const classes = courses.map((c) => ({ id: cid(c.id), code: c.shortname, name: c.fullname, url: `${base}/course/view.php?id=${c.id}`, concluded: !!(c.enddate && c.enddate * 1000 < now), syllabus: c.summary ? clip(htmlToMarkdown(c.summary, { base }), 4000) : null }));
    const items = [], seen = new Set();
    if (courses.length) {
      const a = await call(cfg, ctx, "mod_assign_get_assignments", { "courseids[]": courses.map((c) => c.id) }).catch(() => ({ courses: [] }));
      const all = [];
      for (const c of a.courses || []) for (const x of c.assignments || []) all.push({ c, x });
      const statuses = await pool(all.filter(({ x }) => x.duedate && x.duedate * 1000 > now - 14 * DAY && x.duedate * 1000 < now + 90 * DAY).slice(0, 60), 4, ({ x }) => call(cfg, ctx, "mod_assign_get_submission_status", { assignid: x.id }));
      const st = new Map(); let k = 0;
      for (const { x } of all.filter(({ x }) => x.duedate && x.duedate * 1000 > now - 14 * DAY && x.duedate * 1000 < now + 90 * DAY).slice(0, 60)) { const r = statuses[k++]; if (r && r.ok) st.set(x.id, r.value); }
      for (const { c, x } of all) {
        const s = st.get(x.id), sub = s && s.lastattempt && s.lastattempt.submission, graded = s && s.feedback && s.feedback.gradefordisplay;
        seen.add(`assign/${x.id}`);
        items.push({ id: `moodle:${host}/assign/${x.id}`, classId: cid(c.id), kind: "assignment", title: x.name, url: `${base}/mod/assign/view.php?id=${x.cmid}`,
          due: x.duedate ? x.duedate * 1000 : null, unlockAt: x.allowsubmissionsfromdate ? x.allowsubmissionsfromdate * 1000 : null, lockAt: x.cutoffdate ? x.cutoffdate * 1000 : null,
          points: x.grade > 0 ? x.grade : null, status: graded ? "graded" : sub && sub.status === "submitted" ? "submitted" : "todo", summary: x.intro ? clip(htmlToMarkdown(x.intro, { base }), 1500) : "" });
      }
    }
    // everything else Moodle lists as "needs action" on the timeline: quizzes, forums, workshops, lessons
    try {
      const ev = await call(cfg, ctx, "core_calendar_get_action_events_by_timesort", { timesortfrom: Math.floor((now - 30 * DAY) / 1000), limitnum: 50 });
      for (const e of ev.events || []) {
        const key = `${e.modulename}/${e.instance}`;
        if (e.modulename === "assign" && seen.has(`assign/${e.instance}`)) continue;
        items.push({ id: `moodle:${host}/${key}`, classId: e.course ? cid(e.course.id) : null, kind: kindOf(e.name, e.modulename === "quiz" ? "quiz" : e.modulename === "forum" ? "discussion" : undefined), title: (e.activityname || e.name || "").replace(/\s+(is due|closes)$/i, ""), url: e.url, due: e.timesort * 1000, status: "todo", summary: e.description ? clip(htmlToMarkdown(e.description, { base }), 800) : "" });
      }
    } catch (e) { ctx.warn("timeline: " + e.message); }
    try {
      const g = await call(cfg, ctx, "gradereport_overview_get_course_grades", { userid: site.userid });
      for (const x of g.grades || []) { const c = classes.find((k) => k.id === cid(x.courseid)); if (c && x.grade && x.grade !== "-") c.grade = { score: parseFloat(x.grade) || null, letter: /[A-F]/.test(x.grade) ? x.grade : null }; }
    } catch { /* grades are optional */ }
    return { classes, items };
  },
};

async function token(cfg, ctx) {
  if (cfg.token) return ctx.secret(cfg.token, "token");
  if (cfg.username && cfg.password) {
    const r = await getJSON(ctx.http, `${origin(cfg.url)}/login/token.php?${qs({ username: await ctx.secret(cfg.username, "username"), password: await ctx.secret(cfg.password, "password"), service: "moodle_mobile_app" })}`, { what: "Moodle login" });
    if (r.token) return r.token;
    throw new CCError("AUTH_INVALID", `Moodle refused the login: ${r.error || "no token"}.`, { hint: "Check the username and password, or ask for a token (Preferences → Security keys)." });
  }
  throw new CCError("AUTH_MISSING", "The Moodle source has no token or password.", { hint: "Ask the user for the Moodle mobile web service key (Preferences → Security keys), or use the Moodle calendar export (type ics)." });
}

async function call(cfg, ctx, fn, params = {}) {
  const r = await getJSON(ctx.http, `${origin(cfg.url)}/webservice/rest/server.php?${qs({ wstoken: await token(cfg, ctx), wsfunction: fn, moodlewsrestformat: "json", ...params })}`, { what: "Moodle" });
  if (r && r.exception) {
    if (/invalidtoken|accessexception/i.test(r.errorcode || "")) throw new CCError("AUTH_INVALID", `Moodle: ${r.message}`, { hint: "The token is invalid or expired. Ask the user for a new one." });
    throw new CCError("SOURCE_ERROR", `Moodle ${fn}: ${r.message}`);
  }
  return r;
}
