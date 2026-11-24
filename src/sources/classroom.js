// Google Classroom API v1. Auth: an OAuth access token with scopes
//   classroom.courses.readonly classroom.coursework.me.readonly classroom.announcements.readonly
// given as a secret ref, usually an {"type":"oauth", ...} refresh-token object (docs/config.md).
// No Google Cloud project? Use type ics with the class's Google Calendar secret iCal address instead.
import { getJSON, qs } from "../core/fetchutil.js";
import { kindOf } from "../core/match.js";
import { fromLocal } from "../core/dates.js";
import { clip } from "../core/markdown.js";

const API = "https://classroom.googleapis.com/v1";

async function list(ctx, url, key, headers) {
  const out = []; let token = null, n = 0;
  do {
    const r = await getJSON(ctx.http, url + (url.includes("?") ? "&" : "?") + qs({ pageSize: 100, pageToken: token }), { headers, what: "Google Classroom" });
    out.push(...(r[key] || [])); token = r.nextPageToken;
  } while (token && ++n < 20);
  return out;
}

export default {
  type: "classroom",
  title: "Google Classroom (API)",
  fields: { token: { required: true, secret: true, about: "OAuth access token or an oauth refresh object. See docs/sources.md#classroom." } },
  async fetch(cfg, ctx) {
    const headers = { Authorization: "Bearer " + (await ctx.secret(cfg.token, "token")) };
    const courses = await list(ctx, `${API}/courses?${qs({ studentId: "me", courseStates: "ACTIVE" })}`, "courses", headers);
    const classes = [], items = [], announcements = [];
    for (const c of courses) {
      const id = `classroom:${c.id}`;
      classes.push({ id, code: c.section ? `${c.name} ${c.section}` : c.name, name: c.descriptionHeading || c.name, url: c.alternateLink, meeting: c.room ? `Room ${c.room}` : null });
      const [work, subs, anns] = await Promise.all([
        list(ctx, `${API}/courses/${c.id}/courseWork`, "courseWork", headers).catch((e) => (ctx.warn(e.message), [])),
        list(ctx, `${API}/courses/${c.id}/courseWork/-/studentSubmissions?userId=me`, "studentSubmissions", headers).catch(() => []),
        list(ctx, `${API}/courses/${c.id}/announcements`, "announcements", headers).catch(() => []),
      ]);
      const byWork = new Map(subs.map((s) => [s.courseWorkId, s]));
      for (const w of work) {
        const s = byWork.get(w.id) || {};
        const due = w.dueDate ? fromLocal(w.dueDate.year, w.dueDate.month - 1, w.dueDate.day, w.dueTime ? w.dueTime.hours || 0 : 23, w.dueTime ? w.dueTime.minutes || 0 : 59, 0, "UTC") : null;
        const st = s.state === "RETURNED" && s.assignedGrade != null ? "graded" : s.state === "TURNED_IN" || s.state === "RETURNED" ? (s.late ? "late" : "submitted") : "todo";
        items.push({ id: `classroom:${c.id}/${w.id}`, classId: id, kind: w.workType === "SHORT_ANSWER_QUESTION" || w.workType === "MULTIPLE_CHOICE_QUESTION" ? "quiz" : kindOf(w.title), title: w.title, url: w.alternateLink, due, points: w.maxPoints ?? null, score: s.assignedGrade ?? null, status: st, summary: w.description ? clip(w.description, 1500) : "" });
      }
      for (const a of anns) announcements.push({ id: `classroom:${c.id}/announcement/${a.id}`, classId: id, title: clip((a.text || "").split("\n")[0], 80), postedAt: Date.parse(a.creationTime), body: a.text || "", url: a.alternateLink });
    }
    return { classes, items, announcements };
  },
};
