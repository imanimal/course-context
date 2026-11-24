// Run sources and build the context. Environment-neutral: Node (src/node/sync.js) and the browser
// extension (extension/background.js) both call collect() with their own `env`.
import { sourceOf, ORDER } from "../sources/index.js";
import { buildContext } from "./merge.js";
import { asCC, CCError } from "./errors.js";

/**
 * @param {object} p
 * @param {any[]} p.sources        config.sources
 * @param {any} [p.user]           config.user (the student's layer)
 * @param {any} [p.options]        config.options
 * @param {string} p.tz
 * @param {number} [p.now]
 * @param {Record<string, {data: any, fetchedAt: number}>} [p.previous]  last good result per source id (stale fallback)
 * @param {string[]} [p.only]      run only these source ids (others reuse `previous`)
 * @param {object} p.env           { http(src) → http, secret(ref, info) → string, browser?, readFile?, exec?, importModule?, readSnapshot? }
 * @param {any} [p.generator]
 */
export async function collect(p) {
  const now = p.now ?? Date.now();
  const hints = [];
  const results = [];
  const list = (p.sources || []).filter((s) => s && s.enabled !== false)
    .sort((a, b) => idx(a.type) - idx(b.type));
  for (const src of list) {
    const prev = p.previous && p.previous[src.id];
    if (p.only && p.only.length && !p.only.includes(src.id)) {
      if (prev) results.push({ source: { id: src.id, type: src.type }, ok: true, stale: false, fetchedAt: prev.fetchedAt, data: prev.data, warnings: [], skipped: true });
      continue;
    }
    const mod = sourceOf(src.type);
    const warnings = [], aliases = {};
    if (!mod) { results.push({ source: { id: src.id, type: src.type }, ok: false, error: new CCError("SOURCE_UNKNOWN", `Unknown source type ${src.type}.`).toJSON(), warnings }); continue; }
    const ctx = {
      http: p.env.http(src), tz: p.tz, now, browser: !!p.env.browser,
      secret: async (ref, field) => p.env.secret(ref, { source: src.id, field }),
      warn: (m) => warnings.push(String(m)), hint: (h) => hints.push(...h), hints: () => hints, alias: (a, b) => { aliases[a] = b; },
      readFile: p.env.readFile, exec: p.env.exec, importModule: p.env.importModule, readSnapshot: p.env.readSnapshot,
    };
    try {
      const data = await mod.fetch(src, ctx);
      data.aliases = aliases;
      results.push({ source: { id: src.id, type: src.type }, ok: true, fetchedAt: now, data, warnings });
    } catch (e) {
      const err = asCC(e);
      if (!err.source) err.source = src.id;
      results.push({ source: { id: src.id, type: src.type }, ok: false, error: err.toJSON(), warnings, stale: !!prev, data: prev ? prev.data : null, fetchedAt: prev ? prev.fetchedAt : null });
    }
  }
  const context = buildContext(results, { tz: p.tz, now, user: p.user, options: p.options, generator: p.generator });
  return { context, results };
}

const idx = (t) => { const i = ORDER.indexOf(t); return i < 0 ? ORDER.length : i; };
