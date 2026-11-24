// Schoology REST API v1 with two-legged OAuth 1.0a (PLAINTEXT signature).
// The student gets a consumer key and secret at https://<school>.schoology.com/api (when the school allows it).
import { getJSON } from "../core/fetchutil.js";
import { kindOf } from "../core/match.js";
import { fromLocal } from "../core/dates.js";
import { htmlToMarkdown, clip } from "../core/markdown.js";
import { CCError } from "../core/errors.js";

const API = "https://api.schoology.com/v1";

function oauth(key, secret) {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const p = { oauth_consumer_key: key, oauth_token: "", oauth_nonce: nonce, oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_signature_method: "PLAINTEXT", oauth_version: "1.0", oauth_signature: encodeURIComponent(secret) + "%26" };
  return 'OAuth realm="Schoology API",' + Object.entries(p).map(([k, v]) => `${k}="${k === "oauth_signature" ? v : encodeURIComponent(v)}"`).join(",");
}

export default {
  type: "schoology",
  title: "Schoology (API)",
  fields: {
    key: { required: true, secret: true, about: "Consumer key from https://<school>.schoology.com/api" },
    secret: { required: true, secret: true, about: "Consumer secret from the same page." },
    domain: { about: "School Schoology address for links, e.g. https://school.schoology.com" },
  },
  async fetch(cfg, ctx) {
    const key = await ctx.secret(cfg.key, "key"), secret = await ctx.secret(cfg.secret, "secret");
    const get = (path) => getJSON(ctx.http, API + path, { headers: { Authorization: oauth(key, secret) }, what: "Schoology" });
    const me = await get("/app-user-info");
    if (!me.api_uid) throw new CCError("AUTH_INVALID", "Schoology did not return a user for this key.", { hint: "Check the consumer key and secret." });
    const web = cfg.domain ? String(cfg.domain).replace(/\/$/, "") : "https://app.schoology.com";
    const sections = (await get(`/users/${me.api_uid}/sections`)).section || [];
    const classes = [], items = [], announcements = [];
    for (const s of sections) {
      const id = `schoology:${s.id}`;
      classes.push({ id, code: s.course_code || s.course_title, name: `${s.course_title}${s.section_title ? " · " + s.section_title : ""}`, url: `${web}/course/${s.id}` });
      try {
        for (const a of (await get(`/sections/${s.id}/assignments?start=0&limit=200`)).assignment || []) {
          const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(a.due || "");
          items.push({ id: `schoology:${s.id}/assignment/${a.id}`, classId: id, kind: a.type === "assessment" ? "quiz" : a.type === "discussion" ? "discussion" : kindOf(a.title), title: a.title, url: a.web_url || `${web}/assignment/${a.id}`, due: m ? fromLocal(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, ctx.tz) : null, points: a.max_points ? +a.max_points : null, status: "todo", summary: a.description ? clip(htmlToMarkdown(a.description), 1500) : "" });
        }
        for (const u of ((await get(`/sections/${s.id}/updates?limit=20`)).update || [])) announcements.push({ id: `schoology:${s.id}/update/${u.id}`, classId: id, title: clip(htmlToMarkdown(u.body).split("\n")[0], 80), postedAt: u.created * 1000, body: htmlToMarkdown(u.body), url: `${web}/course/${s.id}/updates` });
      } catch (e) { ctx.warn(`Schoology ${s.course_title}: ${e.message}`); }
    }
    return { classes, items, announcements };
  },
};
