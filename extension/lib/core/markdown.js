// HTML → Markdown for instructor-written content (assignment descriptions, announcements, syllabi).
// Goal: compact text an LLM reads well. Links are kept (made absolute), images become "[image: alt]",
// embeds become "[embedded: url]", tables become pipe tables, everything else collapses to text.
import { parseHTML } from "./html.js";

const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "blockquote", "pre", "ul", "ol", "li", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "dl", "dt", "dd", "figure", "figcaption", "form", "nav", "address", "center"]);
const SKIP = new Set(["script", "style", "noscript", "head", "template", "svg", "button", "input", "select", "option", "textarea", "link", "meta"]);

function abs(u, base) { if (!u) return ""; try { return new URL(u, base || undefined).href; } catch { return u; } }
const inlineWS = (s) => s.replace(/[ \t\r\n ]+/g, " ");

/**
 * @param {string} html
 * @param {{base?: string, maxChars?: number}} [opts]
 * @returns {string}
 */
export function htmlToMarkdown(html, opts = {}) {
  if (!html) return "";
  const doc = parseHTML(html);
  const out = walk(doc, { base: opts.base, list: [], pre: false }).replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
  return opts.maxChars ? clip(out, opts.maxChars) : out;
}

/** Cut at a word boundary and mark the cut. */
export function clip(s, n) {
  s = String(s || "");
  if (s.length <= n) return s;
  const cut = s.slice(0, n), sp = cut.lastIndexOf(" ");
  return (sp > n * 0.7 ? cut.slice(0, sp) : cut).trimEnd() + " [...]";
}

function walk(node, st) {
  let out = "";
  for (const c of node.children) out += one(c, st);
  return out;
}

function one(n, st) {
  if (n.type === "text") return st.pre ? n.value : inlineWS(n.value);
  if (n.type !== "element" || SKIP.has(n.name)) return "";
  const inner = () => walk(n, st);
  switch (n.name) {
    case "br": return st.pre ? "\n" : "  \n";
    case "hr": return "\n\n---\n\n";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      const t = inner().trim(); return t ? `\n\n${"#".repeat(Math.min(6, +n.name[1] + 1))} ${t}\n\n` : "";
    }
    case "p": case "div": case "section": case "article": case "main": case "header": case "footer": case "aside": case "figure": case "figcaption": case "center": case "address": case "nav": case "form": {
      const t = inner().trim(); return t ? `\n\n${t}\n\n` : "";
    }
    case "blockquote": { const t = inner().trim(); return t ? "\n\n" + t.split("\n").map((l) => "> " + l).join("\n") + "\n\n" : ""; }
    case "pre": { const t = walk(n, { ...st, pre: true }).replace(/^\n+|\n+$/g, ""); return t ? "\n\n```\n" + t + "\n```\n\n" : ""; }
    case "code": { if (st.pre) return inner(); const t = inner().trim(); return t ? "`" + t.replace(/`/g, "'") + "`" : ""; }
    case "strong": case "b": { const t = inner().trim(); return t ? `**${t}** ` : ""; }
    case "em": case "i": { const t = inner().trim(); return t ? `*${t}* ` : ""; }
    case "s": case "del": case "strike": { const t = inner().trim(); return t ? `~~${t}~~` : ""; }
    case "sup": return "^" + inner().trim();
    case "sub": return "_" + inner().trim();
    case "a": {
      const t = inner().trim(), href = abs(n.getAttribute("href"), st.base);
      if (!href || href.startsWith("javascript:")) return t;
      if (!t || t === href) return `<${href}>`;
      return `[${t.replace(/[[\]]/g, "")}](${href})`;
    }
    case "img": { const alt = (n.getAttribute("alt") || n.getAttribute("title") || "").trim(); return alt ? `[image: ${alt}]` : "[image]"; }
    case "iframe": case "video": case "audio": case "embed": case "object": {
      const src = abs(n.getAttribute("src") || n.getAttribute("data"), st.base); return src ? `\n\n[embedded: ${src}]\n\n` : "";
    }
    case "math": return n.getAttribute("alttext") ? "`" + n.getAttribute("alttext") + "`" : inner();
    case "ul": case "ol": {
      const items = n.children.filter((c) => c.type === "element" && c.name === "li");
      const depth = st.list.length;
      const lines = items.map((li, k) => {
        const mark = n.name === "ol" ? `${k + 1}.` : "-";
        const body = walk(li, { ...st, list: [...st.list, n.name] }).replace(/\n{2,}/g, "\n").trim();
        return "  ".repeat(depth) + mark + " " + body.split("\n").join("\n" + "  ".repeat(depth + 1));
      });
      return lines.length ? "\n\n" + lines.join("\n") + "\n\n" : "";
    }
    case "li": return "\n- " + inner().trim() + "\n";
    case "table": return table(n, st);
    case "dl": return "\n\n" + inner().trim() + "\n\n";
    case "dt": return "\n**" + inner().trim() + "**\n";
    case "dd": return ": " + inner().trim() + "\n";
    default: return inner();
  }
}

function table(t, st) {
  const rows = t.querySelectorAll("tr").map((tr) => tr.children.filter((c) => c.type === "element" && (c.name === "td" || c.name === "th")).map((c) => walk(c, st).replace(/\s+/g, " ").replace(/\|/g, "/").trim()));
  const good = rows.filter((r) => r.some((x) => x));
  if (!good.length) return "";
  const w = Math.max(...good.map((r) => r.length));
  const pad = (r) => [...r, ...Array(w - r.length).fill("")];
  const [head, ...body] = good.map(pad);
  return "\n\n| " + head.join(" | ") + " |\n|" + " --- |".repeat(w) + "\n" + body.map((r) => "| " + r.join(" | ") + " |").join("\n") + "\n\n";
}

/** Absolute http(s) links in an HTML string (for app discovery: WeBWorK, Gradescope, ...). */
export function linksIn(html, base) {
  if (!html) return [];
  const doc = parseHTML(html), out = new Set();
  for (const a of doc.querySelectorAll("a[href], iframe[src]")) { const u = abs(a.getAttribute("href") || a.getAttribute("src"), base); if (/^https?:/.test(u)) out.add(u); }
  return [...out];
}
