// Register the course-context MCP server with local AI apps and coding agents.
// Each client: where its config lives, the format, and the entry to write. Edits are idempotent, keep every
// other entry, back up the file once (<file>.bak-course-context), and refuse to rewrite JSON that has comments
// (they would be lost); then the result is { action: "manual", snippet } for the agent to paste.
// Remote-only chatbots (ChatGPT, claude.ai, Le Chat, ...) are in REMOTE: they need the HTTP server's public URL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJSON, stripJsonComments, writeAtomic, ensureDir } from "../node/paths.js";
import { CCError } from "../core/errors.js";

const H = os.homedir();
const P = process.platform;
const appData = process.env.APPDATA || path.join(H, "AppData", "Roaming");
const macApp = path.join(H, "Library", "Application Support");
const xdg = process.env.XDG_CONFIG_HOME || path.join(H, ".config");
const userData = (app) => (P === "darwin" ? path.join(macApp, app) : P === "win32" ? path.join(appData, app) : path.join(xdg, app));
const NAME = "course-context";

/** How clients should launch the server. Absolute node + script when installed; npx otherwise. */
export function launchSpec() {
  const cli = fs.realpathSync(fileURLToPath(new URL("../cli.js", import.meta.url)));
  const ephemeral = /[\\/]_npx[\\/]|[\\/]\.npm[\\/]_npx|[\\/]npm-cache[\\/]/.test(cli);
  if (!ephemeral) return { command: process.execPath, args: [cli, "mcp"] };
  return P === "win32" ? { command: "cmd", args: ["/c", "npx", "-y", "course-context@latest", "mcp"] } : { command: "npx", args: ["-y", "course-context@latest", "mcp"] };
}

const json = (file, key, entry) => ({ format: "json", file, key, entry });
const firstExisting = (list) => list.find((f) => fs.existsSync(f)) || list.find((f) => fs.existsSync(path.dirname(f))) || list[0];
const std = (s) => ({ command: s.command, args: s.args });

export const CLIENTS = {
  "claude-desktop": { name: "Claude Desktop", file: () => path.join(userData("Claude"), "claude_desktop_config.json"), make: (s) => json(null, "mcpServers", std(s)) },
  "claude-code": { name: "Claude Code", cli: "claude", file: () => path.join(H, ".claude.json"), make: (s) => json(null, "mcpServers", { type: "stdio", ...std(s) }) },
  cursor: { name: "Cursor", file: () => path.join(H, ".cursor", "mcp.json"), make: (s) => json(null, "mcpServers", std(s)) },
  windsurf: { name: "Windsurf", file: () => path.join(H, ".codeium", "windsurf", "mcp_config.json"), make: (s) => json(null, "mcpServers", std(s)) },
  // Antigravity has used two locations; write the one that exists (default: the current documented one)
  antigravity: { name: "Google Antigravity", file: () => firstExisting([path.join(H, ".gemini", "config", "mcp_config.json"), path.join(H, ".gemini", "antigravity", "mcp_config.json")]), make: (s) => json(null, "mcpServers", std(s)) },
  vscode: { name: "VS Code (GitHub Copilot)", file: () => path.join(userData("Code"), "User", "mcp.json"), make: (s) => json(null, "servers", { type: "stdio", ...std(s) }) },
  "vscode-insiders": { name: "VS Code Insiders", file: () => path.join(userData("Code - Insiders"), "User", "mcp.json"), make: (s) => json(null, "servers", { type: "stdio", ...std(s) }) },
  cline: { name: "Cline (VS Code)", file: () => path.join(userData("Code"), "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"), make: (s) => json(null, "mcpServers", { type: "stdio", ...std(s), disabled: false, autoApprove: [] }) },
  "cline-cli": { name: "Cline CLI", file: () => path.join(H, ".cline", "data", "settings", "cline_mcp_settings.json"), make: (s) => json(null, "mcpServers", { type: "stdio", ...std(s), disabled: false, autoApprove: [] }) },
  roo: { name: "Roo Code", file: () => path.join(userData("Code"), "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"), make: (s) => json(null, "mcpServers", { ...std(s), disabled: false, alwaysAllow: [] }) },
  "gemini-cli": { name: "Gemini CLI", file: () => path.join(H, ".gemini", "settings.json"), make: (s) => json(null, "mcpServers", std(s)) },
  "qwen-code": { name: "Qwen Code", file: () => path.join(H, ".qwen", "settings.json"), make: (s) => json(null, "mcpServers", std(s)) },
  kiro: { name: "Kiro", file: () => path.join(H, ".kiro", "settings", "mcp.json"), make: (s) => json(null, "mcpServers", { ...std(s), disabled: false }) },
  "lm-studio": { name: "LM Studio", file: () => path.join(H, ".lmstudio", "mcp.json"), make: (s) => json(null, "mcpServers", std(s)) },
  "copilot-cli": { name: "GitHub Copilot CLI", file: () => path.join(H, ".copilot", "mcp-config.json"), make: (s) => json(null, "mcpServers", { type: "local", ...std(s), tools: ["*"] }) },
  opencode: { name: "opencode", file: () => firstExisting([path.join(xdg, "opencode", "opencode.json"), path.join(xdg, "opencode", "opencode.jsonc")]), make: (s) => json(null, "mcp", { type: "local", command: [s.command, ...s.args], enabled: true }), v2: (s) => ({ type: "local", command: [s.command, ...s.args] }) },
  amp: { name: "Amp", file: () => path.join(xdg, "amp", "settings.json"), make: (s) => json(null, "amp.mcpServers", std(s)) },
  zed: { name: "Zed", file: () => (P === "darwin" || P === "linux" ? path.join(xdg, "zed", "settings.json") : path.join(appData, "Zed", "settings.json")), make: (s) => json(null, "context_servers", { ...std(s), env: {} }) },
  warp: { name: "Warp", file: () => path.join(H, ".warp", ".mcp.json"), make: (s) => json(null, "mcpServers", { ...std(s), start_on_launch: true }) },
  junie: { name: "JetBrains Junie", file: () => path.join(H, ".junie", "mcp", "mcp.json"), make: (s) => json(null, "mcpServers", std(s)) },
  augment: { name: "Augment (Auggie)", file: () => path.join(H, ".augment", "settings.json"), make: (s) => json(null, "mcpServers", std(s)) },
  codex: { name: "OpenAI Codex (CLI, IDE, app)", file: () => path.join(process.env.CODEX_HOME || path.join(H, ".codex"), "config.toml"), make: (s) => ({ format: "toml", entry: std(s) }) },
  continue: { name: "Continue", file: () => path.join(H, ".continue", "mcpServers", "course-context.yaml"), make: (s) => ({ format: "yaml-file", entry: std(s) }) },
  goose: { name: "Goose", file: () => path.join(xdg, "goose", "config.yaml"), make: (s) => ({ format: "manual", entry: std(s), snippet: `extensions:\n  course-context:\n    name: course-context\n    type: stdio\n    cmd: ${JSON.stringify(s.command)}\n    args: ${JSON.stringify(s.args)}\n    enabled: true\n    timeout: 300\n` }) },
  jetbrains: { name: "JetBrains AI Assistant", file: () => null, make: (s) => ({ format: "manual", entry: std(s), snippet: JSON.stringify({ mcpServers: { [NAME]: std(s) } }, null, 2), where: "Settings → Tools → AI Assistant → Model Context Protocol (MCP) → Add → paste the JSON." }) },
  trae: { name: "Trae", file: () => null, make: (s) => ({ format: "manual", entry: std(s), snippet: JSON.stringify({ mcpServers: { [NAME]: std(s) } }, null, 2), where: "Trae → AI panel → Settings → MCP → Add → Configure manually (or put it in the project's .trae/mcp.json)." }) },
};

/** Chatbots that only take a remote MCP URL (or an OpenAPI action). They need `course-context serve` reachable over HTTPS. */
export const REMOTE = {
  "claude-ai": { name: "Claude (claude.ai, desktop and mobile apps)", how: "Settings → Connectors → Add custom connector. Name: Course Context. URL: <public>/k/<token>/mcp. Leave the OAuth fields empty. The connector then works on every device signed in to the account." },
  chatgpt: { name: "ChatGPT", how: "Turn on developer mode (Settings → Apps → Advanced settings), then create an app: MCP server URL <public>/k/<token>/mcp, Authentication: No authentication. Plans without developer mode: make a Custom GPT → Configure → Actions → Import from URL <public>/openapi.json, Authentication: API Key, Auth type Bearer, key <token>." },
  perplexity: { name: "Perplexity (Pro and Max)", how: "Settings → Connectors → Add custom connector (remote MCP). URL: <public>/k/<token>/mcp." },
  "le-chat": { name: "Mistral Le Chat", how: "Connectors → Add connector → Custom MCP connector (an organization admin may need to allow it). URL: <public>/k/<token>/mcp, no authentication." },
  gemini: { name: "Gemini app and NotebookLM", how: "Where the Gemini app offers custom apps (Settings → Connected apps), add <public>/k/<token>/mcp. Everywhere else: keep the Course Context folder in Google Drive (folder destination inside Drive for desktop, or the gdrive destination) and type @Google Drive in Gemini, or add the folder's now.md, README-for-AI.md and todo.md to a Gem or a NotebookLM notebook." },
  "copilot-studio": { name: "Microsoft 365 Copilot (through Copilot Studio)", how: "Copilot Studio → your agent → Tools → Add a tool → Model Context Protocol. URL: <public>/k/<token>/mcp." },
  "files-only": { name: "Grok, DeepSeek, Meta AI, Poe and other chatbots without connectors", how: "Upload now.md, README-for-AI.md and todo.md from the Course Context folder to a project or chat (re-upload after a sync), or paste <public>/k/<token>/v1/overview into a chatbot that can open links." },
  "custom-app": { name: "Your own app or automation (Zapier, n8n, Make, Shortcuts, scripts)", how: "Call the REST API: GET <public>/k/<token>/v1/todo for tasks, <public>/openapi.json for every route. For push updates add a webhook destination." },
};

/** Which clients look installed on this machine. */
export function detect() {
  const out = [];
  for (const [id, c] of Object.entries(CLIENTS)) {
    const f = c.file();
    const dir = f ? path.dirname(f) : null;
    let present = !!(f && (fs.existsSync(f) || fs.existsSync(dir)));
    if (id === "continue" && fs.existsSync(path.join(H, ".continue"))) present = true;
    if (c.cli && which(c.cli)) present = true;
    if (id === "codex" && which("codex")) present = true;
    if (id === "gemini-cli" && which("gemini")) present = true;
    if (id === "opencode" && which("opencode")) present = true;
    if (id === "copilot-cli" && which("copilot")) present = true;
    out.push({ id, name: c.name, present, file: f, installed: f ? isInstalled(id, f) : null });
  }
  return out;
}

export function which(bin) {
  const exts = P === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const d of (process.env.PATH || "").split(path.delimiter)) for (const e of exts) { const p = path.join(d, bin + e); try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ } }
  return null;
}

function isInstalled(id, f) {
  try {
    const s = fs.readFileSync(f, "utf8");
    if (id === "codex") return /\[mcp_servers\.["']?course-context["']?\]/.test(s);
    if (id === "continue") return true;
    const j = JSON.parse(stripJsonComments(s));
    const spec = CLIENTS[id].make(launchSpec());
    return !!(getKey(j, spec.key) || {})[NAME];
  } catch { return false; }
}

const getKey = (o, k) => (k.includes(".") && !(k in o) ? k.split(".").reduce((a, x) => (a ? a[x] : undefined), o) : o[k]);

/**
 * Install into one client. Returns { client, name, action: "added"|"updated"|"unchanged"|"manual"|"removed", file, snippet?, where?, restart }.
 */
export function install(id, { dryRun = false, remove = false } = {}) {
  const c = CLIENTS[id];
  if (!c) throw new CCError("USAGE", `Unknown client ${id}.`, { hint: `Clients: ${Object.keys(CLIENTS).join(", ")}. Remote chatbots: ${Object.keys(REMOTE).join(", ")} (run course-context connect).` });
  const s = launchSpec();
  const spec = c.make(s);
  const file = c.file();
  const base = { client: id, name: c.name, file, restart: `Restart ${c.name} (or reload its MCP servers) to load course-context.` };
  if (spec.format === "manual") return { ...base, action: "manual", snippet: spec.snippet, where: spec.where || `Add to ${file}` };

  // Claude Code: use its own CLI when present
  if (id === "claude-code" && which("claude") && !dryRun) {
    try { execFileSync("claude", ["mcp", "remove", "--scope", "user", NAME], { stdio: "ignore" }); } catch { /* not there */ }
    if (remove) return { ...base, action: "removed" };
    execFileSync("claude", ["mcp", "add", "--scope", "user", NAME, "--", s.command, ...s.args], { stdio: "ignore" });
    return { ...base, action: "added", via: "claude mcp add --scope user" };
  }

  if (spec.format === "toml") {
    let t = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const block = `[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(s.command)}\nargs = ${JSON.stringify(s.args)}\n`;
    const re = new RegExp(`\\n?\\[mcp_servers\\.["']?${NAME}["']?\\][^\\[]*`, "m");
    const had = re.test(t);
    t = t.replace(re, "");
    if (!remove) t = t.replace(/\s*$/, "\n") + (t.trim() ? "\n" : "") + block;
    if (!dryRun) { backup(file); ensureDir(path.dirname(file), 0o755); writeAtomic(file, t.replace(/^\n+/, "")); }
    return { ...base, action: remove ? "removed" : had ? "updated" : "added" };
  }

  if (spec.format === "yaml-file") {
    const y = `name: Course Context\nversion: 0.1.0\nschema: v1\nmcpServers:\n  - name: ${NAME}\n    type: stdio\n    command: ${JSON.stringify(s.command)}\n    args: ${JSON.stringify(s.args)}\n`;
    if (!dryRun) { if (remove) { try { fs.unlinkSync(file); } catch { /* none */ } } else { ensureDir(path.dirname(file), 0o755); writeAtomic(file, y); } }
    return { ...base, action: remove ? "removed" : "added" };
  }

  // JSON / JSONC
  let raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const stripped = raw ? stripJsonComments(raw) : "{}";
  let j;
  try { j = JSON.parse(stripped || "{}"); } catch { return { ...base, action: "manual", snippet: JSON.stringify({ [spec.key]: { [NAME]: spec.entry } }, null, 2), where: `${file} is not valid JSON; add the entry by hand.` }; }
  const hasComments = raw && raw.replace(/\s+/g, "") !== stripped.replace(/\s+/g, "") && /\/\/|\/\*/.test(raw);
  if (id === "opencode" && j.mcp && j.mcp.servers && typeof j.mcp.servers === "object") { spec.key = "mcp.servers"; spec.entry = c.v2(s); }
  const nested = spec.key.includes(".") && !(spec.key in j) && id !== "amp";
  const holder = nested ? spec.key.split(".").reduce((a, k) => (a[k] = a[k] || {}), j) : (j[spec.key] = j[spec.key] || {});
  const before = JSON.stringify(holder[NAME] || null);
  if (remove) delete holder[NAME]; else holder[NAME] = spec.entry;
  const changed = before !== JSON.stringify(holder[NAME] || null);
  if (!changed) return { ...base, action: "unchanged" };
  if (hasComments) return { ...base, action: "manual", snippet: JSON.stringify({ [spec.key]: { [NAME]: spec.entry } }, null, 2), where: `${file} has comments, which an automatic edit would delete. Add the "${NAME}" entry under "${spec.key}" by hand.` };
  if (!dryRun) { backup(file); ensureDir(path.dirname(file), 0o755); writeAtomic(file, JSON.stringify(j, null, 2) + "\n"); }
  return { ...base, action: remove ? "removed" : before === "null" ? "added" : "updated" };
}

function backup(file) {
  const b = file + ".bak-course-context";
  if (fs.existsSync(file) && !fs.existsSync(b)) fs.copyFileSync(file, b);
}

/** One-click install links where clients support them (shown in README and connect output). */
export function deeplinks() {
  const npx = { command: "npx", args: ["-y", "course-context@latest", "mcp"] };
  const b64 = Buffer.from(JSON.stringify(npx)).toString("base64");
  return {
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${encodeURIComponent(b64)}`,
    vscode: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: NAME, ...npx }))}`,
  };
}
