// One-way-plus sync of the to-do view into a to-do app, shared by every app adapter.
// Rules (docs/destinations.md#todo-apps):
//  - Creates a task for each open item (status todo or missing) within `horizonDays` (default 60) or undated.
//  - Updates the task when title, due date, notes or priority change.
//  - Completes the task when the item becomes done/submitted/graded/excused.
//  - Completed in the app by the student → reported as completedRemotely; the sync marks the item done in
//    config.user.items (the student's layer), so every AI and folder agrees.
//  - Never deletes a task, never touches tasks it did not create (mapping lives in state.map).
import { toTodos, todoTitle } from "../core/todo.js";

/**
 * @param {object} adapter { create(t) → remoteId, update(remoteId, t), complete(remoteId, t), isCompleted?(remoteId) → bool|null (null = gone) }
 */
export async function syncTodos(adapter, { cfg, context, state, dryRun }) {
  state.map = state.map || {};
  const todos = toTodos(context, { includeDone: true, horizonDays: cfg.horizonDays ?? 60, includeUndated: cfg.includeUndated !== false, classes: cfg.classes });
  const prefix = cfg.prefixClass !== false;
  const res = { written: 0, removed: 0, unchanged: 0, completedRemotely: [], detail: "" };
  let created = 0, updated = 0, completed = 0;
  // pull completions first
  if (adapter.isCompleted && !dryRun) {
    for (const [id, m] of Object.entries(state.map)) {
      if (m.done || m.gone) continue;
      try {
        const st = await adapter.isCompleted(m.remoteId, m);
        if (st === true) { m.done = true; res.completedRemotely.push(id); }
        else if (st === null) m.gone = true;
      } catch { /* leave as is */ }
    }
  }
  for (const t of todos) {
    const m = state.map[t.id];
    const t2 = { ...t, displayTitle: todoTitle(t, prefix) };
    if (!m) {
      if (t.done) continue;
      if (dryRun) { created++; continue; }
      const remoteId = await adapter.create(t2);
      state.map[t.id] = { remoteId, hash: t.hash, done: false };
      created++;
      continue;
    }
    if (m.gone) continue; // the student deleted it in the app; respect that
    if (t.done && !m.done) { if (!dryRun) { await adapter.complete(m.remoteId, t2, m); m.done = true; m.hash = t.hash; } completed++; continue; }
    if (m.hash !== t.hash && !m.done) { if (!dryRun) { await adapter.update(m.remoteId, t2, m); m.hash = t.hash; } updated++; continue; }
    res.unchanged++;
  }
  res.written = created + updated + completed;
  res.detail = `${created} created, ${updated} updated, ${completed} completed${res.completedRemotely.length ? `, ${res.completedRemotely.length} completed in the app` : ""}`;
  return res;
}
