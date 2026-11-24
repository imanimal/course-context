// The context document (schema "cc/1"). schema/context.schema.json is the JSON Schema form of the same thing.
// Rules: additive changes keep cc/1; renames or removals bump to cc/2; readers ignore unknown fields.

export const SCHEMA = "cc/1";

export const ITEM_KINDS = ["assignment", "quiz", "exam", "discussion", "reading", "lab", "project", "paper", "event", "task", "other"];
export const STATUSES = ["todo", "submitted", "graded", "missing", "late", "excused", "closed", "done"];
export const CLASS_MODES = ["active", "priority", "ghost", "hidden"];

/**
 * Where a date came from, highest precedence first. The chosen `due` of an item is the first candidate
 * in this order. "description" dates are never chosen; they stay in `mentionedDates`.
 */
export const DUE_PRECEDENCE = ["user", "manual", "canvas", "moodle", "classroom", "schoology", "brightspace", "blackboard", "sakai", "lms", "webwork", "gradescope", "ics", "command", "url", "module", "snapshot"];
export const precedenceOf = (src) => { const i = DUE_PRECEDENCE.indexOf(src); return i < 0 ? DUE_PRECEDENCE.length : i; };

/** Status meanings, written into README-for-AI.md. */
export const STATUS_MEANING = {
  todo: "not turned in yet",
  submitted: "turned in, not graded yet",
  graded: "graded; score is in `score`",
  missing: "the LMS marks it missing (past due, nothing turned in)",
  late: "turned in after the due date",
  excused: "the instructor excused it; no work needed",
  closed: "closed in the app (WeBWorK); can no longer be worked",
  done: "the student marked it done themselves",
};

/** A blank item with every field present (stable shape for LLM readers). */
export function blankItem(p) {
  return {
    id: p.id, classId: p.classId ?? null, source: p.source, sources: p.sources || [p.source], kind: p.kind || "assignment",
    title: p.title || "(untitled)", url: p.url || null,
    due: null, dueCandidates: p.dueCandidates || [], mentionedDates: p.mentionedDates || [],
    unlockAt: p.unlockAt ?? null, lockAt: p.lockAt ?? null, lateDue: p.lateDue ?? null,
    points: p.points ?? null, score: p.score ?? null, status: p.status || "todo", submittedAt: p.submittedAt ?? null,
    summary: p.summary || "", links: p.links || [], user: {}, updatedAt: p.updatedAt ?? null,
    ...(p.extra ? { extra: p.extra } : {}),
  };
}

/** Light structural check; returns a list of problems (empty = fine). */
export function validateContext(c) {
  const probs = [];
  if (!c || c.schema !== SCHEMA) probs.push(`schema must be "${SCHEMA}"`);
  if (!Array.isArray(c?.classes)) probs.push("classes must be an array");
  if (!Array.isArray(c?.items)) probs.push("items must be an array");
  for (const it of c?.items || []) {
    if (!it.id) probs.push("an item has no id");
    if (!ITEM_KINDS.includes(it.kind)) probs.push(`item ${it.id}: unknown kind ${it.kind}`);
    if (!STATUSES.includes(it.status)) probs.push(`item ${it.id}: unknown status ${it.status}`);
  }
  return probs;
}
