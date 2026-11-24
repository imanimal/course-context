// Secret references. Any secret field in config.json may be:
//   "abc123"                      the literal value (config.json is chmod 600)
//   "env:CANVAS_TOKEN"            an environment variable
//   "file:~/secrets/canvas.txt"   a file's contents (trimmed)
//   "cmd:op read op://School/Canvas/token"   a command's stdout (trimmed); 1Password, pass, gcloud, az, bw...
//   "keychain:course-context/canvas"         macOS Keychain (security) or Linux Secret Service (secret-tool)
//   {"type":"oauth","tokenUrl":"...","clientId":"...","clientSecret":"...","refreshToken":"...","scope":"..."}
//                                 an OAuth 2 refresh token; access tokens are cached in state.json until expiry.
import fs from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { expand, statePath, readJSON, writeAtomic } from "./paths.js";
import { CCError } from "../core/errors.js";

export const OAUTH_PRESETS = {
  google: "https://oauth2.googleapis.com/token",
  microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  dropbox: "https://api.dropboxapi.com/oauth2/token",
  todoist: null,
  ticktick: "https://ticktick.com/oauth/token",
};

export async function resolveSecret(ref, info = {}) {
  const where = [info.source || info.dest, info.field].filter(Boolean).join(".");
  if (ref == null || ref === "") throw new CCError("SECRET_MISSING", `Missing secret ${where}.`, { hint: "Ask the user for the value and set it with the source/dest add command." });
  if (typeof ref === "object") return oauth(ref, where);
  const s = String(ref);
  const m = /^(env|file|cmd|keychain):(.*)$/s.exec(s);
  if (!m) return s;
  const [, kind, rest] = m;
  try {
    if (kind === "env") { const v = process.env[rest]; if (v == null || v === "") throw new Error(`environment variable ${rest} is not set`); return v; }
    if (kind === "file") return fs.readFileSync(expand(rest), "utf8").trim();
    if (kind === "cmd") return execSync(rest, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
    if (kind === "keychain") {
      const [service, account = "default"] = rest.split("/");
      if (process.platform === "darwin") return execFileSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], { encoding: "utf8" }).trim();
      if (process.platform === "linux") return execFileSync("secret-tool", ["lookup", "service", service, "account", account], { encoding: "utf8" }).trim();
      throw new Error("keychain: refs work on macOS and Linux only; on Windows use env: or file:");
    }
  } catch (e) {
    throw new CCError("SECRET_UNRESOLVED", `Could not read secret ${where} (${kind}:): ${String(e.message).split("\n")[0]}`, { hint: "Fix the reference or replace it with the literal value." });
  }
  return s;
}

async function oauth(o, where) {
  if (o.type !== "oauth") throw new CCError("SECRET_UNRESOLVED", `Secret object at ${where} needs "type": "oauth".`);
  const tokenUrl = o.tokenUrl || OAUTH_PRESETS[o.provider];
  if (!tokenUrl || !o.refreshToken) throw new CCError("SECRET_UNRESOLVED", `OAuth secret at ${where} needs tokenUrl (or provider) and refreshToken.`, { hint: "See docs/config.md#oauth." });
  const st = readJSON(statePath(), {}) || {};
  const key = "oauth:" + tokenUrl + ":" + (o.clientId || "") + ":" + o.refreshToken.slice(-12);
  const c = st.tokens && st.tokens[key];
  if (c && c.expiresAt > Date.now() + 60e3) return c.accessToken;
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: await resolveSecret(o.refreshToken, { field: "refreshToken" }), ...(o.clientId ? { client_id: o.clientId } : {}), ...(o.clientSecret ? { client_secret: await resolveSecret(o.clientSecret, { field: "clientSecret" }) } : {}), ...(o.scope ? { scope: o.scope } : {}) });
  const r = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new CCError("AUTH_INVALID", `OAuth refresh failed at ${where}: ${j.error_description || j.error || r.status}.`, { hint: "The refresh token was revoked or expired. Ask the user to authorize again." });
  const st2 = readJSON(statePath(), {}) || {};
  st2.tokens = st2.tokens || {};
  st2.tokens[key] = { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
  writeAtomic(statePath(), JSON.stringify(st2, null, 2), 0o600);
  return j.access_token;
}
