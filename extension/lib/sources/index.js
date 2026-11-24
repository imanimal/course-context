// Source registry. Each source: { type, title, fields: {name: {required?, secret?, about, example?}}, fetch(cfg, ctx), test?(cfg, ctx) }.
// fetch returns { classes, items, announcements } with instants as epoch ms (see docs/sources.md#source-json).
import canvas from "./canvas.js";
import ics from "./ics.js";
import webwork from "./webwork.js";
import gradescope from "./gradescope.js";
import moodle from "./moodle.js";
import classroom from "./classroom.js";
import schoology from "./schoology.js";
import { manual, command, url, snapshot, module } from "./generic.js";

export const SOURCES = { canvas, ics, webwork, gradescope, moodle, classroom, schoology, manual, command, url, snapshot, module };

/** Types that only work in Node (filesystem or process access). */
export const NODE_ONLY = new Set(["manual", "command", "module"]);

/** Run order: LMS first so app sources can use their links (hints). */
export const ORDER = ["manual", "canvas", "moodle", "classroom", "schoology", "snapshot", "url", "module", "command", "ics", "webwork", "gradescope"];

export function sourceOf(type) { return SOURCES[type] || null; }
