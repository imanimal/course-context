// Merge source results + the student's own layer into one context document (schema cc/1).
// Invariants:
//  - Source data is never overwritten by the student's layer; the layer sits in item.user / class fields
//    and wins only through precedence (user due first) and status "done".
//  - The same work seen by several sources becomes one item: exact cross-source refs first, then
//    same class + matching title (match.sameWork).
//  - Hidden classes and hidden items never reach the output.
import { SCHEMA, blankItem, precedenceOf } from "./schema.js";
import { sameWork, classForCode, slug, kindOf, codeKey } from "./match.js";
import { isoLocal, mentionedDates, parseUserDate } from "./dates.js";

const DAY = 864e5;
const STATUS_RANK = { todo: 0, missing: 1, closed: 1, submitted: 2, late: 3, graded: 4, excused: 5, done: 6 };
const LMS = new Set(["canvas", "moodle", "classroom", "schoology", "brightspace", "blackboard", "sakai", "lms", "manual", "snapshot"]);

/**
 * @param {Array<{source: {id: string, type: string}, ok: boolean, stale?: boolean, error?: object, fetchedAt?: number, data?: {classes?: any[], items?: any[], announcements?: any[]}}>} results
 * @param {{tz: string, now?: number, user?: any, options?: any, generator?: any}} opts
 */
export function buildContext(results, opts) {
  const tz = opts.tz, now = opts.now ?? Date.now(), user = opts.user || {}, o = { pastDays: 45, announcementDays: 14, maxSummary: 1200, ...(opts.options || {}) };
  const ordered = [...results].sort((a, b) => rank(a.source.type) - rank(b.source.type));

  // ── classes ──
  const classes = new Map(); // id → class
  const alias = new Map(); // any class id or "code:<KEY>" → final class id
  const userClasses = user.classes || {};
  for (const r of ordered) {
    for (const c0 of (r.data && r.data.classes) || []) {
      const forced = (userClasses[c0.id] && userClasses[c0.id].mergeInto) || (r.data && r.data.aliases && r.data.aliases[c0.id]);
      let target = forced && (classes.get(forced) ? forced : alias.get(forced));
      if (!target && c0.matchCode) { const hit = classForCode(c0.matchCode, [...classes.values()]); if (hit) target = hit.id; }
      if (target && classes.has(target)) {
        const t = classes.get(target);
        alias.set(c0.id, target);
        t.sources.push({ type: r.source.type, sourceId: r.source.id, id: c0.id, url: c0.url || null });
        for (const k of ["instructors", "meeting", "policies", "syllabus", "gradeWeights", "term"]) if ((t[k] == null || (Array.isArray(t[k]) && !t[k].length)) && c0[k] != null) t[k] = c0[k];
        for (const l of c0.links || []) if (!t.links.some((x) => x.url === l.url)) t.links.push(l);
        continue;
      }
      if (classes.has(c0.id)) continue;
      const c = {
        id: c0.id, slug: "", code: c0.code || c0.matchCode || c0.name || c0.id, name: c0.name || c0.code || c0.id, nick: null,
        mode: c0.concluded ? "ghost" : "active", term: c0.term || null, instructors: c0.instructors || [], meeting: c0.meeting || null,
        gradeWeights: c0.gradeWeights || null, grade: c0.grade || null, policies: c0.policies || null, syllabus: c0.syllabus || null,
        links: [...(c0.links || [])], notes: null, url: c0.url || null, concluded: !!c0.concluded, originalName: c0.originalName || null,
        sources: [{ type: r.source.type, sourceId: r.source.id, id: c0.id, url: c0.url || null }],
      };
      classes.set(c.id, c);
      alias.set(c.id, c.id);
    }
  }
  // the student's class layer
  for (const [id, u] of Object.entries(userClasses)) {
    const c = classes.get(alias.get(id) || id);
    if (!c || !u) continue;
    if (u.nick) c.nick = u.nick;
    if (u.mode) c.mode = u.mode;
    if (u.notes) c.notes = u.notes;
    for (const l of u.links || []) if (!c.links.some((x) => x.url === l.url)) c.links.push({ ...l, by: "user" });
  }
  // unique slugs
  const used = new Set();
  for (const c of classes.values()) { let s = slug(c.nick || c.code), k = 2; while (used.has(s)) s = slug(c.nick || c.code) + "-" + k++; used.add(s); c.slug = s; }
  const classList = [...classes.values()];
  const resolveClass = (it) => {
    if (it.classId && alias.has(it.classId)) return alias.get(it.classId);
    if (it.classCode) { const hit = classForCode(it.classCode, classList); if (hit) return hit.id; }
    return it.classId && classes.has(it.classId) ? it.classId : null;
  };

  // ── items ──
  const items = [], byRef = new Map(), byClass = new Map();
  const add = (it) => { items.push(it); for (const ref of it._refs) byRef.set(ref, it); if (!byClass.has(it.classId)) byClass.set(it.classId, []); byClass.get(it.classId).push(it); };
  for (const r of ordered) {
    const type = r.source.type;
    for (const raw of (r.data && r.data.items) || []) {
      const classId = resolveClass(raw);
      const refs = [raw.id, ...(raw.refs || [])];
      let hit = refs.map((x) => byRef.get(x)).find(Boolean);
      if (!hit && !LMS.has(type) || (!hit && raw.matchByTitle)) {
        hit = (byClass.get(classId) || []).find((x) => !x.sources.includes(type) && x.kind !== "event" && sameWork(x.title, raw.title));
      }
      if (hit) { absorb(hit, raw, type, now); for (const ref of refs) byRef.set(ref, hit); hit._refs.push(...refs); continue; }
      const it = blankItem({ ...raw, classId, source: type, kind: raw.kind || kindOf(raw.title) });
      it._refs = refs;
      it.sources = [type];
      if (raw.due != null) it.dueCandidates.push({ at: raw.due, source: type, seenAt: now });
      if (raw.className && !classId) it.className = raw.className;
      add(it);
    }
  }

  // the student's tasks become items
  for (const t of user.tasks || []) {
    const due = parseUserDate(t.due, tz);
    const it = blankItem({ id: "task:" + t.id, classId: t.classId ? (alias.get(t.classId) || resolveClass({ classCode: t.classId })) : null, source: "user", kind: "task", title: t.title, summary: t.note || "", status: t.done ? "done" : "todo" });
    it.sources = ["user"];
    if (due != null) it.dueCandidates.push({ at: due, source: "user", seenAt: now });
    it._refs = [it.id];
    add(it);
  }

  // the student's item layer
  const userItems = user.items || {};
  for (const it of items) {
    const u = it._refs.map((r) => userItems[r]).find(Boolean);
    if (!u) continue;
    it.user = { ...u };
    if (u.due) { const t = parseUserDate(u.due, tz); if (t != null) it.dueCandidates.push({ at: t, source: "user", seenAt: now }); }
    if (u.done) it.status = "done";
  }

  // ── choose dates, mentions, filters ──
  const out = [];
  for (const it of items) {
    const cls = classes.get(it.classId);
    if (cls && cls.mode === "hidden") continue;
    if (it.user && it.user.hidden) continue;
    it.dueCandidates.sort((a, b) => precedenceOf(a.source) - precedenceOf(b.source));
    // dedupe identical candidates
    it.dueCandidates = it.dueCandidates.filter((c, i, a) => a.findIndex((d) => d.source === c.source && d.at === c.at) === i);
    const best = it.dueCandidates[0];
    if (!it.dueCandidates.length && it.summary) it.mentionedDates = mentionedDates(it.summary, tz, now).map((m) => ({ at: isoLocal(m.at, tz), text: m.text }));
    if (best && best.at < now - o.pastDays * DAY && !["missing", "todo"].includes(it.status)) continue;
    if (best && best.at < now - o.pastDays * DAY * 2) continue;
    if (it.kind === "event" && best && best.at < now - DAY) continue;
    it.due = best ? { at: isoLocal(best.at, tz), source: best.source } : null;
    it.dueCandidates = it.dueCandidates.map((c) => ({ at: isoLocal(c.at, tz), source: c.source }));
    for (const k of ["unlockAt", "lockAt", "lateDue", "submittedAt", "updatedAt"]) if (typeof it[k] === "number") it[k] = isoLocal(it[k], tz);
    if (it.summary && it.summary.length > o.maxSummary) it.summary = it.summary.slice(0, o.maxSummary).replace(/\s+\S*$/, "") + " [...]";
    delete it._refs;
    out.push(it);
  }
  out.sort((a, b) => (a.due ? Date.parse(a.due.at) : Infinity) - (b.due ? Date.parse(b.due.at) : Infinity) || a.title.localeCompare(b.title));

  // ── announcements ──
  const anns = [];
  for (const r of ordered) for (const a of (r.data && r.data.announcements) || []) {
    if (a.postedAt != null && a.postedAt < now - o.announcementDays * DAY) continue;
    const classId = resolveClass(a);
    const cls = classes.get(classId);
    if (cls && cls.mode === "hidden") continue;
    anns.push({ id: a.id, classId, title: a.title || "(no title)", postedAt: a.postedAt != null ? isoLocal(a.postedAt, tz) : null, author: a.author || null, body: a.body || "", url: a.url || null, source: r.source.type });
  }
  anns.sort((a, b) => Date.parse(b.postedAt || 0) - Date.parse(a.postedAt || 0));

  const finalClasses = classList.filter((c) => c.mode !== "hidden").sort((a, b) => modeRank(a.mode) - modeRank(b.mode) || a.code.localeCompare(b.code));
  return {
    schema: SCHEMA,
    generatedAt: isoLocal(now, tz),
    generator: opts.generator || { name: "course-context" },
    timezone: tz,
    sources: results.map((r) => ({ id: r.source.id, type: r.source.type, ok: !!r.ok, stale: !!r.stale, fetchedAt: r.fetchedAt ? isoLocal(r.fetchedAt, tz) : null, error: r.error || null, counts: r.data ? { classes: (r.data.classes || []).length, items: (r.data.items || []).length } : null })),
    classes: finalClasses.map(({ concluded, ...c }) => c),
    items: out,
    announcements: anns,
  };
}

function absorb(hit, raw, type, now) {
  if (!hit.sources.includes(type)) hit.sources.push(type);
  if (raw.due != null) hit.dueCandidates.push({ at: raw.due, source: type, seenAt: now });
  if ((STATUS_RANK[raw.status] ?? 0) > (STATUS_RANK[hit.status] ?? 0)) hit.status = raw.status;
  if (hit.score == null && raw.score != null) hit.score = raw.score;
  if (hit.points == null && raw.points != null) hit.points = raw.points;
  for (const k of ["unlockAt", "lockAt", "lateDue", "submittedAt"]) if (hit[k] == null && raw[k] != null) hit[k] = raw[k];
  if (!hit.summary && raw.summary) hit.summary = raw.summary;
  if (raw.url && raw.url !== hit.url && !hit.links.some((l) => l.url === raw.url)) hit.links.push({ label: label(type), url: raw.url });
  for (const l of raw.links || []) if (!hit.links.some((x) => x.url === l.url)) hit.links.push(l);
  if (!hit.url) hit.url = raw.url || null;
}

const label = (t) => ({ webwork: "WeBWorK", gradescope: "Gradescope", ics: "Calendar", canvas: "Canvas", moodle: "Moodle", classroom: "Google Classroom", schoology: "Schoology" }[t] || t);
const SOURCE_ORDER = ["manual", "canvas", "moodle", "classroom", "schoology", "lms", "snapshot", "url", "module", "command", "ics", "webwork", "gradescope"];
function rank(t) { const i = SOURCE_ORDER.indexOf(t); return i < 0 ? SOURCE_ORDER.length : i; }
function modeRank(m) { return { priority: 0, active: 1, ghost: 2 }[m] ?? 3; }

export { codeKey };
