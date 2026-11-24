// Machine facts for `course-context doctor` and setup: synced cloud folders (the zero-auth way to reach
// Drive/OneDrive/Dropbox/iCloud/Box), helper tools, and MCP clients.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { which, detect as detectClients } from "../mcp/clients.js";

const H = os.homedir();
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** Candidate synced folders, most likely first. `path` is the drive root; write into `<path>/Course Context`. */
export function cloudFolders() {
  const out = [];
  const add = (provider, p) => { if (p && isDir(p) && !out.some((x) => x.path === p)) out.push({ provider, path: p, suggested: path.join(p, "Course Context") }); };
  if (process.platform === "darwin") {
    const cs = path.join(H, "Library", "CloudStorage");
    for (const d of ls(cs)) {
      if (d.startsWith("GoogleDrive-")) { add("Google Drive", path.join(cs, d, "My Drive")); add("Google Drive", path.join(cs, d, "Mon Drive")); }
      else if (d.startsWith("OneDrive")) add("OneDrive", path.join(cs, d));
      else if (d.startsWith("Dropbox")) add("Dropbox", path.join(cs, d));
      else if (d.startsWith("Box")) add("Box", path.join(cs, d));
      else if (d.startsWith("pCloud")) add("pCloud", path.join(cs, d));
    }
    add("iCloud Drive", path.join(H, "Library", "Mobile Documents", "com~apple~CloudDocs"));
    add("Google Drive", path.join(H, "Google Drive", "My Drive"));
  }
  if (process.platform === "win32") {
    for (const L of "GHIJKLMNOPQRSTUVWXYZ") add("Google Drive", `${L}:\\My Drive`);
    add("OneDrive", process.env.OneDriveConsumer); add("OneDrive", process.env.OneDriveCommercial); add("OneDrive", process.env.OneDrive);
    add("iCloud Drive", path.join(H, "iCloudDrive"));
    add("Box", path.join(H, "Box"));
  }
  add("Dropbox", path.join(H, "Dropbox"));
  add("OneDrive", path.join(H, "OneDrive"));
  add("Nextcloud", path.join(H, "Nextcloud"));
  add("Syncthing", path.join(H, "Sync"));
  add("Google Drive", path.join(H, "GoogleDrive"));
  for (const d of ls(H)) if (/^OneDrive - /.test(d)) add("OneDrive", path.join(H, d));
  return out;
}

export function environment() {
  return {
    platform: process.platform, arch: process.arch, node: process.version, nodeOk: +process.versions.node.split(".")[0] >= 18,
    timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(),
    tools: { rclone: which("rclone"), git: which("git"), docker: which("docker"), cloudflared: which("cloudflared"), tailscale: which("tailscale"), ngrok: which("ngrok"), claude: which("claude"), codex: which("codex"), gemini: which("gemini") },
    cloudFolders: cloudFolders(),
    mcpClients: detectClients().filter((c) => c.present),
  };
}
