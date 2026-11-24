// Canvas LMS via the REST API (https://canvas.instructure.com/doc/api/).
// Auth: personal access token (Authorization: Bearer), a session cookie string, or the browser's own
// session (extension: ctx.browser = true, no header). Read-only: every request is a GET.
import { getPaged, getJSON, pool, origin, qs } from "../core/fetchutil.js";
import { htmlToMarkdown, linksIn, clip } from "../core/markdown.js";
import { kindOf } from "../core/match.js";
import { parseInstant } from "../core/dates.js";
import { CCError } from "../core/errors.js";
import { appRefs } from "./webwork.js";

const DAY = 864e5;

export default {
  type: "canvas",
  title: "Canvas LMS (REST API)",
  fields: {
    host: { required: true, example: "ucsb.instructure.com", about: "The Canvas address the student signs in at." },
    token: { secret: true, about: "Personal access token. Canvas → Account → Settings → Approved Integrations → + New Access Token. Some schools disable this; then use the extension or the calendar feed (type ics)." },
    cookie: { secret: true, about: "Alternative to token: the Cookie header from a signed-in browser (canvas_session=...). Expires with the session." },
    courses: { about: '"active" (default), "all", or a list of course ids.' },
    announcementDays: { about: "Days of announcements to read (default 14)." },
  },
  async test(cfg, ctx) {
    const base = origin(cfg.host);
    const me = await getJSON(ctx.http, `${base}/api/v1/users/self`, { headers: await auth(cfg, ctx), what: "Canvas" });
    return { ok: true, detail: `signed in as user ${me.id}` };
  },
  async fetch(cfg, ctx) {
    const base = origin(cfg.host);
    if (!base) throw new CCError("CONFIG_INVALID", "Canvas source needs host.", { hint: "Set host, e.g. ucsb.instructure.com." });
    const host = new URL(base).host;
    const headers = await auth(cfg, ctx);
    const get = (path, what) => getPaged(ctx.http, base + path, { headers, what: what || "Canvas" });
    const now = ctx.now;

    const all = await get(`/api/v1/courses?${qs({ "include[]": ["term", "total_scores", "teachers", "syllabus_body", "concluded", "course_image"], per_page: 100, ...(cfg.courses === "all" ? {} : { enrollment_state: "active" }) })}`, "Canvas courses");
    let courses = all.filter((c) => c && c.id && !c.access_restricted_by_date);
    if (Array.isArray(cfg.courses)) courses = all.filter((c) => cfg.courses.map(String).includes(String(c.id)));
    else if (cfg.courses !== "all") courses = courses.filter((c) => !c.concluded);

    const classes = [], items = [], announcements = [], hints = [];
    const classId = (id) => `canvas:${host}/course/${id}`;

    const per = await pool(courses, 4, async (c) => {
      const [assignments, groups, modules] = await Promise.all([
        get(`/api/v1/courses/${c.id}/assignments?${qs({ "include[]": ["submission"], per_page: 100, order_by: "due_at" })}`, `Canvas assignments for ${c.course_code}`),
        get(`/api/v1/courses/${c.id}/assignment_groups?per_page=50`).catch(() => []),
        cfg.modules === false ? [] : get(`/api/v1/courses/${c.id}/modules?${qs({ "include[]": ["items"], per_page: 50 })}`).catch(() => []),
      ]);
      return { assignments, groups, modules };
    });

    courses.forEach((c, k) => {
      const id = classId(c.id);
      const enr = (c.enrollments || []).find((e) => e.type === "student" || e.type === "StudentEnrollment") || (c.enrollments || [])[0] || {};
      const r = per[k].ok ? per[k].value : { assignments: [], groups: [], modules: [] };
      if (!per[k].ok) ctx.warn(`${c.course_code}: ${per[k].error.message}`);
      classes.push({
        id, code: c.course_code || c.name, name: c.name, originalName: c.original_name || null, term: c.term && c.term.name !== "Default Term" ? c.term.name : null,
        instructors: (c.teachers || []).map((t) => t.display_name).filter(Boolean), url: `${base}/courses/${c.id}`, concluded: !!c.concluded,
        grade: enr.computed_current_score != null || enr.computed_current_grade ? { score: enr.computed_current_score ?? null, letter: enr.computed_current_grade || null } : null,
        gradeWeights: c.apply_assignment_group_weights ? r.groups.filter((g) => g.group_weight).map((g) => ({ group: g.name, weight: g.group_weight })) : null,
        syllabus: c.syllabus_body ? clip(htmlToMarkdown(c.syllabus_body, { base }), 8000) : null,
        links: [],
      });
      for (const a of r.assignments) {
        if (a.workflow_state && a.workflow_state !== "published") continue;
        const s = a.submission || {};
        const ext = a.external_tool_tag_attributes && a.external_tool_tag_attributes.url;
        const found = [...(ext ? [ext] : []), ...linksIn(a.description, base)];
        hints.push(...found.map((u) => ({ url: u, classId: id, title: a.name, launch: a.html_url })));
        const types = a.submission_types || [];
        items.push({
          id: `canvas:${host}/assignment/${a.id}`, refs: appRefs(found), classId: id,
          kind: a.is_quiz_assignment || types.includes("online_quiz") ? "quiz" : types.includes("discussion_topic") ? "discussion" : kindOf(a.name),
          title: a.name, url: a.html_url, due: parseInstant(a.due_at), unlockAt: parseInstant(a.unlock_at), lockAt: parseInstant(a.lock_at),
          points: a.points_possible ?? null, score: s.score ?? null, submittedAt: parseInstant(s.submitted_at), status: status(s, a),
          summary: a.description ? clip(htmlToMarkdown(a.description, { base }), 1500) : "",
          links: found.filter((u) => /webwork2|gradescope\.com|prairielearn|mathxl|pearson|mcgraw|cengage|wileyplus|zybooks|expertta|achieve\.macmillan|perusall|hypothes|edfinity|myopenmath|ximera/i.test(u)).map((u) => ({ label: toolName(u), url: u })),
          extra: types.length && types.every((t) => ["none", "on_paper", "not_graded", "external_tool"].includes(t)) ? { submission: types.join(",") } : undefined,
        });
      }
      for (const m of r.modules) for (const it of m.items || []) {
        if (it.external_url) hints.push({ url: it.external_url, classId: id, title: it.title, launch: it.html_url });
      }
    });

    // planner: Canvas to-do items that are not assignments (pages with to-do dates, ungraded discussions,
    // calendar events, the student's own Canvas planner notes)
    try {
      const plan = await get(`/api/v1/planner/items?${qs({ start_date: new Date(now - 30 * DAY).toISOString(), end_date: new Date(now + 180 * DAY).toISOString(), per_page: 100 })}`, "Canvas planner");
      for (const p of plan) {
        const t = p.plannable_type;
        if (t === "assignment" || t === "quiz" && p.plannable && p.plannable.assignment_id || t === "announcement") continue;
        if (t === "discussion_topic" && p.plannable && p.plannable.assignment_id) continue;
        const cid = p.course_id ? classId(p.course_id) : null;
        const pl = p.plannable || {};
        items.push({
          id: `canvas:${host}/${t}/${p.plannable_id}`, classId: cid, kind: t === "calendar_event" ? "event" : t === "quiz" ? "quiz" : t === "discussion_topic" ? "discussion" : t === "planner_note" ? "task" : kindOf(pl.title, "reading"),
          title: pl.title || pl.name || t, url: p.html_url ? new URL(p.html_url, base).href : null, due: parseInstant(p.plannable_date || pl.todo_date || pl.due_at || pl.start_at),
          status: p.submissions && p.submissions.submitted ? "submitted" : p.planner_override && p.planner_override.marked_complete ? "done" : "todo", summary: pl.details ? clip(htmlToMarkdown(pl.details, { base }), 800) : "",
        });
      }
    } catch (e) { ctx.warn("planner: " + e.message); }

    // announcements, 10 courses per request
    const days = cfg.announcementDays ?? 14;
    for (let i = 0; i < courses.length; i += 10) {
      const chunk = courses.slice(i, i + 10);
      try {
        const list = await get(`/api/v1/announcements?${qs({ "context_codes[]": chunk.map((c) => "course_" + c.id), start_date: new Date(now - days * DAY).toISOString(), end_date: new Date(now + DAY).toISOString(), per_page: 50 })}`, "Canvas announcements");
        for (const a of list) {
          const cid = /course_(\d+)/.exec(a.context_code || "");
          announcements.push({ id: `canvas:${host}/announcement/${a.id}`, classId: cid ? classId(cid[1]) : null, title: a.title, postedAt: parseInstant(a.posted_at || a.created_at), author: a.author && a.author.display_name || a.user_name || null, body: htmlToMarkdown(a.message, { base, maxChars: 4000 }), url: a.html_url || a.url });
        }
      } catch (e) { ctx.warn("announcements: " + e.message); }
    }
    ctx.hint(hints);
    return { classes, items, announcements };
  },
};

async function auth(cfg, ctx) {
  if (ctx.browser) return {};
  if (cfg.token) return { Authorization: "Bearer " + (await ctx.secret(cfg.token, "token")) };
  if (cfg.cookie) return { Cookie: await ctx.secret(cfg.cookie, "cookie") };
  throw new CCError("AUTH_MISSING", "The Canvas source has no token or cookie.", { hint: "Ask the user for a Canvas access token (Account → Settings → + New Access Token) and run: course-context source add canvas --host <host> --token <token>. If the school blocks tokens, add the calendar feed instead (type ics) or use the browser extension." });
}

function status(s, a) {
  if (s.excused) return "excused";
  if (s.workflow_state === "graded" && s.score != null) return "graded";
  if (s.missing) return "missing";
  if (s.submitted_at && s.late) return "late";
  if (s.submitted_at || s.workflow_state === "submitted" || s.workflow_state === "pending_review") return "submitted";
  if (a.has_submitted_submissions && s.workflow_state === "graded") return "graded";
  return "todo";
}

function toolName(u) {
  const h = (() => { try { return new URL(u).host; } catch { return ""; } })();
  if (/webwork2/.test(u)) return "WeBWorK"; if (/gradescope/.test(h)) return "Gradescope"; if (/prairielearn/.test(h)) return "PrairieLearn";
  return h.replace(/^www\./, "");
}
