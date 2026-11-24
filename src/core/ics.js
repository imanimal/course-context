// iCalendar (RFC 5545) reading and writing. Reads the feeds every LMS exports (Canvas, Moodle, Brightspace,
// Blackboard, Schoology, Sakai, Google Calendar for Classroom, Outlook). Writes calendar.ics for the output folder.
import { fromLocal } from "./dates.js";

/** Unfold, split into properties. */
function lines(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}
const unescape = (v) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

function prop(line) {
  // NAME;PARAM=VAL;PARAM="V:AL":value
  let i = 0, q = false;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ":" && !q) break; }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(";");
  const params = {};
  for (const p of ps) { const e = p.indexOf("="); if (e > 0) params[p.slice(0, e).toUpperCase()] = p.slice(e + 1).replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value };
}

/** An ICS date value → { at: ms, allDay } using TZID, Z, or the fallback zone. */
export function icsTime(value, params = {}, tz = "UTC") {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  if (!m[4]) return { at: fromLocal(y, mo, d, 23, 59, 0, tz), allDay: true };
  const [h, mi, s] = [+m[4], +m[5], +(m[6] || 0)];
  if (m[7]) return { at: Date.UTC(y, mo, d, h, mi, s), allDay: false };
  let zone = params.TZID || tz;
  zone = WINDOWS_ZONES[zone] || zone.replace(/^\/[^/]+\/[^/]+\//, ""); // "/mozilla.org/20050126_1/America/New_York"
  try { return { at: fromLocal(y, mo, d, h, mi, s, zone), allDay: false }; } catch { return { at: fromLocal(y, mo, d, h, mi, s, tz), allDay: false }; }
}

const WINDOWS_ZONES = { "Pacific Standard Time": "America/Los_Angeles", "Mountain Standard Time": "America/Denver", "Central Standard Time": "America/Chicago", "Eastern Standard Time": "America/New_York", "GMT Standard Time": "Europe/London", "W. Europe Standard Time": "Europe/Berlin", "AUS Eastern Standard Time": "Australia/Sydney", "India Standard Time": "Asia/Kolkata", "China Standard Time": "Asia/Shanghai", "Tokyo Standard Time": "Asia/Tokyo", "UTC": "UTC" };

/**
 * Parse VEVENTs (and VTODOs) from a feed.
 * @returns {{calName?: string, events: Array<{uid, summary, description, url, location, categories: string[], start, end, due, allDay, kind: "event"|"todo", status}>}}
 */
export function parseICS(text, tz = "UTC") {
  const events = [];
  let cur = null, calName;
  for (const raw of lines(text)) {
    if (!raw.trim()) continue;
    const p = prop(raw);
    if (p.name === "BEGIN" && (p.value === "VEVENT" || p.value === "VTODO")) { cur = { kind: p.value === "VTODO" ? "todo" : "event", categories: [] }; continue; }
    if (p.name === "END" && (p.value === "VEVENT" || p.value === "VTODO")) { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) { if (p.name === "X-WR-CALNAME") calName = unescape(p.value); continue; }
    switch (p.name) {
      case "UID": cur.uid = p.value; break;
      case "SUMMARY": cur.summary = unescape(p.value); break;
      case "DESCRIPTION": cur.description = unescape(p.value); break;
      case "X-ALT-DESC": if (/html/i.test(p.params.FMTTYPE || "")) cur.html = unescape(p.value); break;
      case "URL": cur.url = p.value; break;
      case "LOCATION": cur.location = unescape(p.value); break;
      case "STATUS": cur.status = p.value; break;
      case "CATEGORIES": cur.categories.push(...unescape(p.value).split(",").map((s) => s.trim()).filter(Boolean)); break;
      case "DTSTART": { const t = icsTime(p.value, p.params, tz); if (t) { cur.start = t.at; cur.allDay = t.allDay; } break; }
      case "DTEND": { const t = icsTime(p.value, p.params, tz); if (t) cur.end = t.at; break; }
      case "DUE": { const t = icsTime(p.value, p.params, tz); if (t) cur.due = t.at; break; }
      case "RRULE": cur.rrule = p.value; break;
      default: break;
    }
  }
  return { calName, events };
}

const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function fold(line) {
  const out = []; let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
  out.push(s);
  return out.join("\r\n");
}

/** Write a VCALENDAR with one VEVENT per dated item. */
export function writeICS(events, { name = "Course Context", now = Date.now() } = {}) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//course-context//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + esc(name)];
  for (const e of events) {
    L.push("BEGIN:VEVENT", "UID:" + esc(e.uid), "DTSTAMP:" + stamp(now), "DTSTART:" + stamp(e.start), "DTEND:" + stamp(e.end || e.start), "SUMMARY:" + esc(e.summary));
    if (e.description) L.push("DESCRIPTION:" + esc(e.description));
    if (e.url) L.push("URL:" + e.url);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

/** Write a VCALENDAR of VTODOs from toTodos() records (for apps that import tasks from .ics). */
export function writeTodoICS(todos, { name = "Course Context tasks", now = Date.now() } = {}) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//course-context//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:" + esc(name)];
  for (const t of todos) {
    L.push("BEGIN:VTODO", "UID:" + esc(t.id.replace(/[^\w.:@/-]/g, "_")) + "@course-context", "DTSTAMP:" + stamp(now), "SUMMARY:" + esc(t.class ? `[${t.class}] ${t.title}` : t.title));
    if (t.due) L.push("DUE:" + stamp(Date.parse(t.due)));
    if (t.notes) L.push("DESCRIPTION:" + esc(t.notes));
    if (t.url) L.push("URL:" + t.url);
    L.push("PRIORITY:" + (t.priority === "high" ? 1 : 5));
    if (t.done) L.push("STATUS:COMPLETED", "COMPLETED:" + stamp(now), "PERCENT-COMPLETE:100"); else L.push("STATUS:NEEDS-ACTION");
    L.push("END:VTODO");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
