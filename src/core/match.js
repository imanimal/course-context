// Title and course-code matching used to merge the same work seen by several sources
// (Canvas assignment "HW 5" == WeBWorK set "Homework_5" == calendar event "Homework 5 [MATH 4B]").

/** "HW 5", "Homework_5", "Homework #5 (Sections 3.1 & 3.2)" → "homework 5 sections 3.1 3.2" */
export const norm = (t) => String(t || "").toLowerCase().replace(/[_#]+/g, " ")
  .replace(/\b(hw|hmwk|hwk)\s*(?=\d)/g, "homework ").replace(/\b(hw|hmwk|hwk)\b/g, "homework").replace(/\bwk\b/g, "week")
  .replace(/\bps\s*(?=\d)/g, "problem set ").replace(/\bpset\s*(?=\d)/g, "problem set ")
  .replace(/(\d)\.(?=\d)/g, "$1\u0001").replace(/[^a-z0-9\u0001]+/g, " ").replace(/\u0001/g, ".").trim().replace(/\s+/g, " ");
const nums = (n) => n.match(/\d+(?:\.\d+)?/g) || [];
const KIND = /^(homework|quiz|exam|midterm|final|lab|project|section|chapter|week|reading|worksheet|problem set|discussion|essay|paper|assignment)/;

/** Whether two titles name the same piece of work. */
export function sameWork(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const nx = nums(x), ny = nums(y), kx = (x.match(KIND) || [])[1], ky = (y.match(KIND) || [])[1];
  if (nx.length && nx[0] === ny[0] && kx && kx === ky) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 8 && (l.startsWith(s + " ") || l.endsWith(" " + s));
}

/** "Math4B" / "math 4b-01" → "MATH 4 B 01"-style key for whole-word code comparison. */
export const codeKey = (s) => String(s || "").toUpperCase().replace(/([A-Z])\s*(\d)/g, "$1 $2").replace(/[^A-Z0-9]+/g, " ").trim();

/** "math34A-01-f26-blee" → "MATH 34A"; "CMPSC16 Fall" → "CMPSC 16" */
export function codeFromId(id) {
  const words = [];
  for (const w0 of String(id || "").split(/[\s_-]+/)) {
    const w = w0.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""); if (!w) continue;
    const d = w.search(/\d/);
    if (d >= 0) { if (d > 0 && /^\p{L}+$/u.test(w.slice(0, d))) words.push(w.slice(0, d), w.slice(d)); else words.push(w); break; }
    words.push(w);
  }
  return (words.join(" ") || String(id || "").trim()).toUpperCase();
}

/** The class whose code, name or original name contains `code` as whole words. */
export function classForCode(code, classes) {
  const k = codeKey(code); if (!k) return null;
  const hits = classes.filter((c) => [c.code, c.name, c.originalName, c.nick].some((s) => s && (" " + codeKey(s) + " ").includes(" " + k + " ")));
  if (hits.length < 2) return hits[0] || null;
  return hits.find((c) => c.mode !== "ghost" && !c.concluded) || hits[0];
}

/** Guess an item kind from its title. */
export function kindOf(title, hint) {
  const t = String(title || "").toLowerCase();
  if (hint === "quiz" || /\bquiz/.test(t)) return "quiz";
  if (/\b(midterm|final exam|exam\b|test \d|\btest\b)/.test(t)) return "exam";
  if (hint === "discussion" || /\b(discussion|forum|post\b|reply)/.test(t)) return "discussion";
  if (/\blab\b|\blaboratory/.test(t)) return "lab";
  if (/\b(read|reading|chapter|textbook)\b/.test(t)) return "reading";
  if (/\b(project|proposal)\b/.test(t)) return "project";
  if (/\b(essay|paper|draft|report)\b/.test(t)) return "paper";
  if (hint === "event") return "event";
  return hint === "assignment" || /\b(homework|hw|assignment|problem set|pset|worksheet|exercise)/.test(t) ? "assignment" : (hint || "assignment");
}

/** URL- and file-safe slug: "CMPSC 130A: Data Structures" → "cmpsc-130a" */
export function slug(s, max = 40) {
  const out = String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (out.slice(0, max).replace(/-+$/, "") || "class");
}

/** Find a class by id, code, nick, slug or a name fragment. */
export function findClass(q, classes) {
  if (!q) return null;
  const s = String(q).trim(), l = s.toLowerCase(), k = codeKey(s);
  return classes.find((c) => c.id === s) || classes.find((c) => c.slug === l)
    || classes.find((c) => codeKey(c.code) === k) || classes.find((c) => c.nick && c.nick.toLowerCase() === l)
    || classes.find((c) => k && (" " + codeKey(c.code) + " ").includes(" " + k + " "))
    || classes.find((c) => (c.name || "").toLowerCase().includes(l)) || null;
}
