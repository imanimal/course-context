// The flat to-do view: one record per piece of work, in the shape every to-do app understands.
// Used by the HTTP API (/v1/todo), MCP (list_todo), todo.ics, webhooks and the to-do app destinations.
// Record (stable, documented in docs/api.md#todo):
//   { id, title, class, classId, kind, status, done, due, dueDate, dueTime, timezone, priority, points, url, notes, source, hash }
import { parts } from "./dates.js";
import { clip } from "./markdown.js";

const DONE = new Set(["done", "submitted", "graded", "excused", "late", "closed"]);
const DAY = 864e5;

/**
 * @param {any} ctx cc/1 context
 * @param {{includeDone?: boolean, horizonDays?: number|null, includeUndated?: boolean, includeEvents?: boolean, includeGhost?: boolean, classes?: string[], now?: number}} [o]
 */
export function toTodos(ctx, o = {}) {
  const tz = ctx.timezone, now = o.now ?? Date.now();
  const cls = new Map(ctx.classes.map((c) => [c.id, c]));
  const out = [];
  for (const it of ctx.items) {
    const c = cls.get(it.classId);
    if (c && c.mode === "ghost" && !o.includeGhost) continue;
    if (it.kind === "event" && !o.includeEvents) continue;
    if (o.classes && o.classes.length && !(c && o.classes.some((q) => [c.id, c.code, c.nick, c.slug].includes(q)))) continue;
    const done = DONE.has(it.status);
    if (done && !o.includeDone) continue;
    const t = it.due ? Date.parse(it.due.at) : null;
    if (t == null && o.includeUndated === false) continue;
    if (t != null && o.horizonDays != null && t > now + o.horizonDays * DAY) continue;
    const p = t != null ? parts(t, tz) : null;
    const pad = (n) => String(n).padStart(2, "0");
    const overdue = !done && t != null && t < now;
    const high = (c && c.mode === "priority") || (it.user && it.user.priority) || it.status === "missing" || overdue || it.kind === "exam";
    const notes = [
      [c ? c.nick || c.code : null, it.kind, it.points != null ? `${it.points} pts` : null].filter(Boolean).join(" · "),
      it.due ? `Due date from ${it.due.source}.` : it.mentionedDates && it.mentionedDates.length ? `No due date set. The description mentions: ${it.mentionedDates.map((m) => m.text).join("; ")}.` : "No due date set.",
      it.url || "",
      it.user && it.user.note ? `Note: ${it.user.note}` : "",
      it.summary ? clip(it.summary.replace(/\s*\n+\s*/g, " "), 400) : "",
    ].filter(Boolean).join("\n");
    const rec = {
      id: it.id, title: it.title, class: c ? c.nick || c.code : it.className || null, classId: it.classId || null, kind: it.kind, status: it.status, done,
      due: it.due ? it.due.at : null, dueDate: p ? `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}` : null, dueTime: p ? `${pad(p.h)}:${pad(p.mi)}` : null, timezone: tz,
      priority: high ? "high" : "normal", overdue, points: it.points ?? null, url: it.url || null, notes, source: it.due ? it.due.source : it.source,
    };
    rec.hash = hash([rec.title, rec.class, rec.due, rec.done, rec.priority, rec.url, rec.notes].join("\u0001"));
    out.push(rec);
  }
  return out;
}

/** Short stable FNV-1a hash (hex). Change detection only. */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** "[MATH 4B] Homework 5" */
export const todoTitle = (t, prefix = true) => (prefix && t.class ? `[${t.class}] ${t.title}` : t.title);
