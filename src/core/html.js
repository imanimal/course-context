// Minimal HTML parser and CSS selector engine. Pure JS: runs in Node, browser pages and MV3 service workers
// (which have no DOMParser). Built for LMS descriptions and the WeBWorK / Gradescope pages the sources read.
// Supported selectors: tag, #id, .class, [attr], [attr=v], [attr^=v], [attr$=v], [attr*=v], [attr~=v],
// descendant (space), child (>), groups (,). No pseudo-classes.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "noscript"]);
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", bull: "•", middot: "·", times: "×", deg: "°", le: "≤", ge: "≥", ne: "≠", plusmn: "±", frac12: "½", rarr: "→", larr: "←", check: "✓", eacute: "é", ensp: " ", emsp: " ", thinsp: " " };

/** Decode HTML character references. Unknown names stay as written. */
export function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const v = ENT[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export class HNode {
  constructor(type, name = "", attrs = {}, parent = null) {
    this.type = type; // "element" | "text" | "document"
    this.name = name; // lowercase tag name
    this.attrs = attrs;
    this.children = [];
    this.parent = parent;
    this.value = ""; // text nodes
  }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); }
  get classes() { return (this.attrs.class || "").split(/\s+/).filter(Boolean); }
  get classList() { const c = this.classes; return { contains: (x) => c.includes(x) }; }
  get className() { return this.attrs.class || ""; }
  get id() { return this.attrs.id || ""; }
  /** All descendant elements in document order. */
  *descendants() {
    const stack = [...this.children].reverse();
    while (stack.length) {
      const n = stack.pop();
      if (n.type !== "element") continue;
      yield n;
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
  }
  querySelectorAll(sel) {
    const groups = compile(sel), out = [];
    for (const el of this.descendants()) if (groups.some((g) => matchComplex(el, g, this))) out.push(el);
    return out;
  }
  querySelector(sel) {
    const groups = compile(sel);
    for (const el of this.descendants()) if (groups.some((g) => matchComplex(el, g, this))) return el;
    return null;
  }
  /** Text with a space at every tag boundary, whitespace collapsed. Skips script/style. */
  get text() { return textOf(this); }
  get body() { return this.querySelector("body") || this; }
}

export function textOf(node) {
  if (!node) return "";
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.type === "text") out.push(c.value);
      else if (c.type === "element" && !RAW.has(c.name)) { out.push(" "); walk(c); out.push(" "); }
    }
  };
  if (node.type === "text") return node.value.replace(/\s+/g, " ").trim();
  walk(node);
  return out.join("").replace(/\s+/g, " ").trim();
}

const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Parse an HTML string into a document node. Never throws. */
export function parseHTML(html) {
  const s = String(html || "");
  const doc = new HNode("document");
  let cur = doc, i = 0;
  const open = (name) => { for (let n = cur; n && n !== doc; n = n.parent) if (n.name === name) return n; return null; };
  const closeTo = (node) => { cur = node.parent || doc; };
  const closeInScope = (names, stopAt) => {
    for (let n = cur; n && n !== doc; n = n.parent) {
      if (stopAt.includes(n.name)) return;
      if (names.includes(n.name)) { closeTo(n); return; }
    }
  };
  const addText = (t) => {
    if (!t) return;
    const last = cur.children[cur.children.length - 1];
    if (last && last.type === "text") last.value += decode(t);
    else { const n = new HNode("text", "", {}, cur); n.value = decode(t); cur.children.push(n); }
  };
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) { addText(s.slice(i)); break; }
    if (lt > i) addText(s.slice(i, lt));
    if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[lt + 1] === "!" || s[lt + 1] === "?") { const e = s.indexOf(">", lt); i = e < 0 ? s.length : e + 1; continue; }
    if (s[lt + 1] === "/") {
      const m = /^<\/\s*([a-zA-Z][\w:-]*)[^>]*>/.exec(s.slice(lt, lt + 200));
      if (!m) { addText("<"); i = lt + 1; continue; }
      const name = m[1].toLowerCase(), n = open(name);
      if (n) closeTo(n);
      i = lt + m[0].length;
      continue;
    }
    const m = /^<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/.exec(s.slice(lt));
    if (!m) { addText("<"); i = lt + 1; continue; }
    const name = m[1].toLowerCase(), attrs = {};
    let am; ATTR_RE.lastIndex = 0;
    while ((am = ATTR_RE.exec(m[2]))) { const k = am[1].toLowerCase(); if (!(k in attrs)) attrs[k] = decode(am[2] ?? am[3] ?? am[4] ?? ""); }
    i = lt + m[0].length;
    // implied end tags
    if (CLOSES_P.has(name) && cur.name === "p") closeTo(cur);
    if (name === "li") closeInScope(["li"], ["ul", "ol"]);
    if (name === "dt" || name === "dd") closeInScope(["dt", "dd"], ["dl"]);
    if (name === "tr") closeInScope(["tr"], ["table", "tbody", "thead", "tfoot"]);
    if (name === "td" || name === "th") closeInScope(["td", "th"], ["tr", "table"]);
    if (name === "option") closeInScope(["option"], ["select"]);
    const el = new HNode("element", name, attrs, cur);
    cur.children.push(el);
    if (VOID.has(name) || m[3]) continue;
    if (RAW.has(name)) {
      const re = new RegExp(`</${name}\\s*>`, "i"), rest = s.slice(i), e = rest.search(re);
      const body = e < 0 ? rest : rest.slice(0, e);
      if (body) { const t = new HNode("text", "", {}, el); t.value = name === "textarea" || name === "title" ? decode(body) : body; el.children.push(t); }
      i = e < 0 ? s.length : i + e + rest.slice(e).match(re)[0].length;
      continue;
    }
    cur = el;
  }
  return doc;
}

// ── selectors ──
const cache = new Map();
function compile(sel) {
  if (cache.has(sel)) return cache.get(sel);
  const groups = splitTop(sel, ",").map((g) => parseComplex(g.trim())).filter((g) => g.length);
  if (cache.size > 500) cache.clear();
  cache.set(sel, groups);
  return groups;
}
function splitTop(s, ch) {
  const out = []; let depth = 0, q = null, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ch && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}
// complex selector → [{compound, comb}] right-to-left friendly array (left to right stored)
function parseComplex(s) {
  const parts = []; let i = 0, comb = " ";
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === ">") { comb = ">"; i++; continue; }
    if (i >= s.length) break;
    let j = i, depth = 0, q = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (depth === 0 && (/\s/.test(c) || c === ">")) break;
    }
    parts.push({ comb: parts.length ? comb : null, test: parseCompound(s.slice(i, j)) });
    comb = " "; i = j;
  }
  return parts;
}
function parseCompound(s) {
  const tests = [];
  const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[0] === "") break;
    if (m[1] && m[1] !== "*") { const t = m[1].toLowerCase(); tests.push((el) => el.name === t); }
    else if (m[2]) { const v = m[2]; tests.push((el) => el.attrs.id === v); }
    else if (m[3]) { const v = m[3]; tests.push((el) => el.classes.includes(v)); }
    else if (m[4]) {
      const k = m[4].toLowerCase(), op = m[5], v = m[6] ?? m[7] ?? m[8] ?? "";
      tests.push((el) => {
        if (!el.hasAttribute(k)) return false;
        const a = el.attrs[k];
        switch (op) {
          case undefined: return true;
          case "=": return a === v;
          case "^=": return v !== "" && a.startsWith(v);
          case "$=": return v !== "" && a.endsWith(v);
          case "*=": return v !== "" && a.includes(v);
          case "~=": return a.split(/\s+/).includes(v);
          case "|=": return a === v || a.startsWith(v + "-");
          default: return false;
        }
      });
    }
  }
  return (el) => tests.every((t) => t(el));
}
function matchComplex(el, parts, root) {
  const go = (node, k) => {
    if (!parts[k].test(node)) return false;
    if (k === 0) return true;
    const comb = parts[k].comb;
    if (comb === ">") { const p = node.parent; return !!p && p !== root && p.type === "element" && go(p, k - 1); }
    for (let p = node.parent; p && p !== root && p.type === "element"; p = p.parent) if (go(p, k - 1)) return true;
    return false;
  };
  return go(el, parts.length - 1);
}
