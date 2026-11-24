// Any iCalendar feed. Covers LMSes without an API the student can use: Canvas (calendar feed, no token),
// Moodle, Brightspace/D2L, Blackboard, Schoology, Sakai, Google Classroom (each class's Google Calendar),
// Outlook/Teams, and any course website that publishes .ics. One feed per source entry.
import { parseICS } from "../core/ics.js";
import { getText } from "../core/fetchutil.js";
import { kindOf, slug } from "../core/match.js";
import { clip } from "../core/markdown.js";
import { CCError } from "../core/errors.js";

/** Which LMS produced a feed, from its URL. */
export function lmsOf(url) {
  const u = String(url);
  if (/instructure\.com|\/feeds\/calendars\/user_/.test(u)) return "canvas";
  if (/\/calendar\/export_execute\.php/.test(u)) return "moodle";
  if (/\/d2l\/le\/calendar\/feed/.test(u)) return "brightspace";
  if (/calendarFeed|blackboard|\/learn\/api/.test(u)) return "blackboard";
  if (/schoology\.com/.test(u)) return "schoology";
  if (/\/direct\/calendar\//.test(u)) return "sakai";
  if (/calendar\.google\.com/.test(u)) return "google";
  if (/outlook\.(office|live)/.test(u)) return "outlook";
  return "other";
}

/** Class code and clean title from one event, per LMS conventions. */
export function classify(ev, lms) {
  let title = (ev.summary || "").trim(), code = null;
  const br = /\s*\[([^\]]+)\]\s*$/.exec(title);
  if (br) { code = br[1].trim(); title = title.slice(0, br.index).trim(); }
  if (lms === "moodle") { title = title.replace(/\s+(is due|is due to be graded|closes|should be completed)$/i, ""); if (!code && ev.categories && ev.categories[0]) code = ev.categories[0]; }
  if (lms === "brightspace") { title = title.replace(/\s+-\s+(Due|Due Date|End Date)$/i, ""); if (!code && ev.location) code = ev.location; }
  if (lms === "blackboard" && !code && ev.location) code = ev.location;
  if (!code && ev.categories && ev.categories.length && lms !== "google") code = ev.categories[0];
  const opens = /\b(opens|is available|start date)\b/i.test(ev.summary || "");
  return { title, code, opens };
}

export default {
  type: "ics",
  title: "Calendar feed (iCal / .ics)",
  fields: {
    url: { required: true, secret: true, about: "Feed URL (https:// or webcal://). Canvas: Calendar → Calendar Feed. Moodle: Calendar → Import or export calendars → Export. Brightspace: Calendar → Subscribe. Google Classroom: the class's Google Calendar → Settings → Secret address in iCal format. The URL is a secret: anyone with it can read the calendar." },
    class: { about: "Put every event in this class (code like \"MATH 4B\"). Use for one-class feeds." },
    lms: { about: "Override LMS detection: canvas, moodle, brightspace, blackboard, schoology, sakai, google, outlook, other." },
    events: { about: "true: keep non-deadline events (lectures, exams, office hours) as kind event. Default true for single-class feeds, false otherwise." },
    timezone: { about: "Zone for floating times. Default: config timezone." },
  },
  async fetch(cfg, ctx) {
    if (!cfg.url) throw new CCError("CONFIG_INVALID", "Calendar source needs url.", { hint: "Ask the user for the feed URL." });
    const url = String(await ctx.secret(cfg.url, "url")).replace(/^webcals?:\/\//i, "https://");
    const tz = cfg.timezone || ctx.tz;
    const { text } = await getText(ctx.http, url, { what: "calendar feed" });
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new CCError("PARSE", "The calendar URL did not return an iCalendar file.", { hint: "Copy the feed URL again (it must end in .ics or be a webcal:// link)." });
    const { events, calName } = parseICS(text, tz);
    const lms = cfg.lms || lmsOf(url);
    const host = (() => { try { return new URL(url).host; } catch { return "feed"; } })();
    const keepEvents = cfg.events ?? !!cfg.class;
    const classes = new Map(), items = [];
    for (const ev of events) {
      if (ev.status === "CANCELLED") continue;
      const { title, code: c0, opens } = classify(ev, lms);
      if (opens) continue;
      const code = cfg.class || c0;
      const at = ev.due ?? ev.start;
      if (at == null) continue;
      const long = ev.end != null && ev.start != null && !ev.allDay && ev.end - ev.start > 20 * 60e3;
      const canvasAssign = lms === "canvas" && (/event-assignment-(\d+)/.exec(ev.uid || "") || /\/assignments\/(\d+)/.exec(ev.url || ""));
      const deadline = !!canvasAssign || ev.kind === "todo" || /\b(due|deadline|submit|closes)\b/i.test(ev.summary || "") || lms === "moodle" || (!long && lms !== "google" && lms !== "outlook");
      if (!deadline && !keepEvents) continue;
      if (ev.rrule && !deadline && !keepEvents) continue;
      let classId = null;
      if (code) {
        classId = `ics:${cfg.id}/${slug(code)}`;
        if (!classes.has(classId)) classes.set(classId, { id: classId, code, name: code, matchCode: code });
      }
      const refs = [];
      if (canvasAssign) refs.push(`canvas:${host}/assignment/${canvasAssign[1]}`);
      const cev = /event-calendar-event-(\d+)/.exec(ev.uid || "");
      if (lms === "canvas" && cev) refs.push(`canvas:${host}/calendar_event/${cev[1]}`);
      items.push({
        id: `ics:${cfg.id}/${ev.uid || slug(title + "-" + at, 80)}`, refs, classId, classCode: code, className: code ? null : calName || null,
        kind: deadline ? kindOf(title) : "event", title, url: ev.url || null, due: at,
        summary: ev.description ? clip(ev.description.trim(), 1200) : "", status: "todo",
      });
    }
    return { classes: [...classes.values()], items };
  },
};
