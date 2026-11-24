// Checks human-facing text (README, extension UI, the CLI's ASK strings) for wording the project avoids:
// em dashes, "its", stock AI phrases and marketing words. Exits 1 with every hit. Run: node tools/check-wording.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["README.md", "extension/options.html", "extension/options.js"];
const BANNED = [
  /—/, /\bits\b/i, /\bdelve/i, /\bseamless/i, /\brobust\b/i, /\bleverage/i, /\butiliz/i, /\bempower/i, /\bunlock/i, /\bcomprehensive\b/i,
  /\bholistic\b/i, /\bgame-?changing\b/i, /\bcutting-edge\b/i, /\becosystem\b/i, /\btestament\b/i, /\bjourney\b/i, /\bnavigate\b/i, /\bharness\b/i,
  /\bgenuinely\b/i, /\btruly\b/i, /\bhonestly\b/i, /\bincredibly\b/i, /\bsimply\b/i, /\bactually\b/i, /\breally\b/i, /\bnot just\b/i, /\bnot only\b/i,
  /\bit's worth noting\b/i, /\bit's important to note\b/i, /\bin conclusion\b/i, /\bwhether you're\b/i, /\bhappy to help\b/i, /\bhope this helps\b/i, /\bfeatures? a\b/i, /\bboasts?\b/i,
];
const hits = [];
const check = (file, text, offsetLine = 0) => {
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|\/\/|import |const api|const \$|let |function |for \(|\$\(|await |if \(|S\.|return )/.test(line) && !/textContent|lines\.push|message/.test(line)) return;
    for (const re of BANNED) if (re.test(line.replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/g, ""))) hits.push(`${file}:${offsetLine + i + 1}: ${re} in: ${line.trim().slice(0, 120)}`);
  });
};
for (const f of FILES) check(f, fs.readFileSync(path.join(root, f), "utf8"));
// the setup questions shown to students
const cli = fs.readFileSync(path.join(root, "src", "cli.js"), "utf8");
const ask = cli.slice(cli.indexOf("const ASK = {"), cli.indexOf("};", cli.indexOf("const ASK = {")));
check("src/cli.js (ASK)", ask.split("\n").map((l) => (l.match(/"([^"]+)"/) || [])[1] || "").join("\n"));
if (hits.length) { console.error(hits.join("\n")); process.exit(1); }
console.log(JSON.stringify({ ok: true, checked: FILES.length + 1 }));
