// Copies the environment-neutral core and sources into extension/lib so the extension runs the same code as the
// CLI, checks that nothing Node-only slipped in, and zips extension/ to dist/course-context-extension.zip.
// Run: npm run build:extension. Load unpacked from extension/ (chrome://extensions, about:debugging).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = path.join(root, "extension", "lib");
fs.rmSync(lib, { recursive: true, force: true });
for (const dir of ["core", "sources"]) {
  fs.mkdirSync(path.join(lib, dir), { recursive: true });
  for (const f of fs.readdirSync(path.join(root, "src", dir))) {
    if (!f.endsWith(".js")) continue;
    const body = fs.readFileSync(path.join(root, "src", dir, f), "utf8");
    if (/from\s+["']node:|require\(/.test(body)) throw new Error(`${dir}/${f} imports a Node module; it can't go in the extension.`);
    fs.writeFileSync(path.join(lib, dir, f), body);
  }
}
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const zip = path.join(root, "dist", "course-context-extension.zip");
fs.rmSync(zip, { force: true });
try { execFileSync("zip", ["-qr", zip, "."], { cwd: path.join(root, "extension") }); console.log(JSON.stringify({ ok: true, lib, zip })); }
catch { console.log(JSON.stringify({ ok: true, lib, zip: null, note: "zip is not installed; load extension/ unpacked or zip it by hand." })); }
