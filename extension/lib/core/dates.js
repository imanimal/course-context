// Time zone math with Intl only (no tz database shipped). All instants are epoch milliseconds internally;
// everything written out is ISO 8601 with an explicit offset, or an absolute human date with a zone abbreviation.

const dtfCache = new Map();
function dtf(tz, opts) {
  const k = tz + JSON.stringify(opts);
  let f = dtfCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }); dtfCache.set(k, f); }
  return f;
}

/** True when the IANA zone name is usable. */
export function validZone(tz) {
  try { dtf(tz, {}).format(0); return true; } catch { return false; }
}

/** The machine's zone, or UTC. */
export function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** Wall-clock parts of an instant in a zone. */
export function parts(ms, tz) {
  const p = {};
  for (const x of dtf(tz, { hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(ms)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month - 1, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

/** Offset of the zone from UTC at an instant, in minutes (PST = -480). */
export function offsetMinutes(tz, ms) {
  const p = parts(ms, tz);
  return Math.round((Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Instant for a wall-clock time in a zone (month is 0-based). Handles DST gaps by moving forward. */
export function fromLocal(y, mo, d, h = 0, mi = 0, s = 0, tz = "UTC") {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  let t = guess - offsetMinutes(tz, guess) * 60000;
  const o2 = offsetMinutes(tz, t);
  t = guess - o2 * 60000;
  return t;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** "2026-12-04T23:59:00-08:00" */
export function isoLocal(ms, tz) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const p = parts(ms, tz), off = offsetMinutes(tz, ms), sign = off < 0 ? "-" : "+", a = Math.abs(off);
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** "2026-12-04" in the zone. */
export function dayKey(ms, tz) { const p = parts(ms, tz); return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}`; }

/** "Fri Dec 4 2026, 11:59 PM PST" */
export function human(ms, tz) {
  if (ms == null) return "no due date";
  const p = {};
  for (const x of dtf(tz, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).formatToParts(ms)) p[x.type] = x.value;
  return `${p.weekday} ${p.month} ${p.day} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

/** "Fri Dec 4 2026" */
export function humanDay(ms, tz) {
  const p = {};
  for (const x of dtf(tz, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).formatToParts(ms)) p[x.type] = x.value;
  return `${p.weekday} ${p.month} ${p.day} ${p.year}`;
}

/** "11:59 PM" */
export function humanTime(ms, tz) {
  const p = {};
  for (const x of dtf(tz, { hour: "numeric", minute: "2-digit" }).formatToParts(ms)) p[x.type] = x.value;
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** Parse ISO / RFC strings; null when not a date. */
export function parseInstant(s) {
  if (s == null || s === "") return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Parse a user-supplied due date. Accepts ISO with offset, ISO without offset (read in tz),
 * "YYYY-MM-DD" (read as 23:59 in tz), or epoch ms.
 */
export function parseUserDate(s, tz) {
  if (s == null || s === "") return null;
  if (typeof s === "number") return s;
  const str = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (m) return fromLocal(+m[1], +m[2] - 1, +m[3], 23, 59, 0, tz);
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(str);
  if (m) return fromLocal(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), tz);
  return parseInstant(str);
}

const ZONES = { UTC: 0, GMT: 0, Z: 0, PST: -8, PDT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, EST: -5, EDT: -4, AKST: -9, AKDT: -8, HST: -10, AST: -4, NST: -3.5, NDT: -2.5, BST: 1, CET: 1, CEST: 2, EET: 2, EEST: 3, IST: 5.5, JST: 9, KST: 9, AEST: 10, AEDT: 11 };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([aApP][mM])?(?:\s+([A-Z]{1,5}|[+-]\d{2}:?\d{2})\b)?|([A-Z][a-z]{2,8})\.? (\d{1,2}),? (\d{4})(?:,| at)?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])(?:\s+([A-Z]{1,5}|[+-]\d{2}:?\d{2})\b)?/;

/**
 * A date the way WeBWorK and similar apps print it: "11/05/2026 at 11:59pm PST",
 * "November 5, 2026 at 11:59:00 PM PST". A missing zone is read in `tz`.
 */
export function parsePrinted(s, tz = "America/Los_Angeles") {
  const m = String(s || "").match(DATE_RE);
  if (!m) return null;
  let y, mo, d, h, mi, ap, z;
  if (m[1]) [y, mo, d, h, mi, ap, z] = [+m[3], +m[1] - 1, +m[2], +m[4], +m[5], m[6], m[7]];
  else { mo = MONTHS.indexOf(m[8].slice(0, 3).toLowerCase()); if (mo < 0) return null; [y, d, h, mi, ap, z] = [+m[10], +m[9], +m[11], +m[12], m[13], m[14]]; }
  if (ap) { ap = ap.toLowerCase(); if (h === 12) h = 0; if (ap === "pm") h += 12; }
  if (z && ZONES[z.toUpperCase()] != null) return Date.UTC(y, mo, d, h, mi) - ZONES[z.toUpperCase()] * 3600e3;
  if (z && /^[+-]/.test(z)) { const dd = z.replace(":", ""); const off = (dd[0] === "-" ? -1 : 1) * (+dd.slice(1, 3) * 60 + +dd.slice(3, 5)); return Date.UTC(y, mo, d, h, mi) - off * 60e3; }
  return fromLocal(y, mo, d, h, mi, 0, tz);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/**
 * Dates mentioned in free text near the word "due" (or "deadline", "submit by"). Returned as candidates only;
 * never treated as confirmed. Recognizes "Dec 4", "December 4th", "12/4", "12/4/2026", optional "at 11:59pm",
 * and weekday names (resolved to the next such day after `refMs`).
 */
export function mentionedDates(text, tz, refMs) {
  const s = String(text || "");
  const out = [];
  const re = /\b(?:due|deadline|submit(?:ted)? by|turn(?:ed)? in by|closes)\b[^.\n]{0,40}?\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?|(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?|(sunday|monday|tuesday|wednesday|thursday|friday|saturday))(?:[^.\n]{0,12}?\b(?:at|by|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?)?/gi;
  let m;
  const ref = parts(refMs, tz);
  while ((m = re.exec(s)) && out.length < 5) {
    let y = ref.y, mo, d;
    if (m[1]) { mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); d = +m[2]; if (m[3]) y = +m[3]; }
    else if (m[4]) { mo = +m[4] - 1; d = +m[5]; if (m[6]) y = m[6].length === 2 ? 2000 + +m[6] : +m[6]; }
    else {
      const want = WEEKDAYS.indexOf(m[7].toLowerCase());
      const now = new Date(Date.UTC(ref.y, ref.mo, ref.d));
      let add = (want - now.getUTCDay() + 7) % 7; if (add === 0) add = 7;
      const t = new Date(now.getTime() + add * 864e5);
      y = t.getUTCFullYear(); mo = t.getUTCMonth(); d = t.getUTCDate();
    }
    if (mo < 0 || d < 1 || d > 31 || mo > 11) continue;
    let h = 23, mi = 59;
    if (m[8]) {
      h = +m[8]; mi = m[9] ? +m[9] : 0;
      const ap = (m[10] || "").replace(/\./g, "").toLowerCase();
      if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
      if (!ap && h < 8) h += 12;
    }
    // a month/day with no year that already passed more than 60 days ago means next year
    let t = fromLocal(y, mo, d, h, mi, 0, tz);
    if (!m[3] && !m[6] && m[1 + 0] !== undefined && t < refMs - 60 * 864e5) t = fromLocal(y + 1, mo, d, h, mi, 0, tz);
    out.push({ at: t, text: m[0].trim() });
  }
  return out;
}
