// File destinations: the rendered folder goes to a local path, any rclone remote, WebDAV, Google Drive,
// OneDrive, Dropbox, a git repository, or an S3-compatible bucket (through rclone).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { plan, join, asciiJSON, mime } from "./common.js";
import { expand, ensureDir, writeAtomic } from "../node/paths.js";
import { CCError, httpError } from "../core/errors.js";

const run = promisify(execFile);
const MANIFEST = ".course-context-manifest.json";

// ── local folder (also every desktop-synced cloud folder: Google Drive for desktop, OneDrive, Dropbox, iCloud Drive, Box, Nextcloud, Syncthing) ──
export const folder = {
  type: "folder", kind: "files", title: "Local folder (or a cloud drive's synced folder)",
  fields: { path: { required: true, about: "Folder to write. Created if missing. Point it inside a synced cloud folder (see `course-context doctor` → cloudFolders) to reach every computer and phone." } },
  async push({ cfg, files, dryRun, stableOnly }) {
    const dir = path.resolve(expand(cfg.path));
    const root = path.parse(dir).root;
    if (dir === root || dir === os.homedir()) throw new CCError("CONFIG_INVALID", `Refusing to write into ${dir}.`, { hint: "Use a dedicated folder such as ~/Course Context." });
    const mf = path.join(dir, MANIFEST);
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(mf, "utf8")).files || {}; } catch { manifest = {}; }
    const p = plan(files, manifest, { stable: !!stableOnly });
    // never clobber a file we did not write
    const conflicts = p.write.filter((rel) => !(rel in manifest) && fs.existsSync(path.join(dir, rel)) && fs.readFileSync(path.join(dir, rel), "utf8") !== files[rel]);
    if (conflicts.length) throw new CCError("DEST_CONFLICT", `${dir} already has files course-context did not write: ${conflicts.slice(0, 5).join(", ")}.`, { hint: "Point this destination at an empty or new folder, or move those files." });
    if (dryRun) return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged, detail: dir };
    ensureDir(dir, 0o755);
    for (const rel of p.write) writeAtomic(path.join(dir, rel), files[rel]);
    for (const rel of p.remove) { try { fs.unlinkSync(path.join(dir, rel)); } catch { /* gone */ } }
    // drop now-empty class folders we made
    for (const rel of p.remove) { let d = path.dirname(path.join(dir, rel)); while (d.startsWith(dir) && d !== dir) { try { fs.rmdirSync(d); } catch { break; } d = path.dirname(d); } }
    writeAtomic(mf, JSON.stringify({ tool: "course-context", note: "Files listed here are managed by course-context and are overwritten on every sync.", files: p.manifest }, null, 2));
    return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged, detail: dir };
  },
};

// ── rclone: 70+ providers (Google Drive, OneDrive, Dropbox, Box, iCloud Drive, S3, B2, R2, pCloud, MEGA, Proton Drive, SFTP, ...) ──
export const rclone = {
  type: "rclone", kind: "files", title: "Any rclone remote",
  fields: {
    remote: { required: true, example: "gdrive:Course Context", about: "rclone remote and folder, e.g. \"gdrive:Course Context\". Must include a folder, not just the remote root. The remote must exist (rclone config)." },
    binary: { about: "Path to rclone (default: rclone on PATH)." },
  },
  async push({ cfg, files, state, home, dryRun }) {
    const remote = String(cfg.remote || "");
    const ci = remote.indexOf(":");
    if (ci < 1 || !remote.slice(ci + 1).replace(/[/\\]/g, "")) throw new CCError("CONFIG_INVALID", `rclone remote "${remote}" has no folder.`, { hint: 'Use "<remote>:Course Context", never the bare remote root.' });
    const bin = cfg.binary || "rclone";
    try { await run(bin, ["version"], { timeout: 15000 }); } catch { throw new CCError("RCLONE_MISSING", "rclone is not installed or not on PATH.", { hint: "Install rclone (https://rclone.org/install/) and create the remote with `rclone config`, or use a folder destination inside a synced cloud folder." }); }
    const p = plan(files, state.manifest || {});
    if (dryRun) return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged, detail: remote };
    const stage = path.join(home, "stage", cfg.id);
    fs.rmSync(stage, { recursive: true, force: true });
    for (const rel of p.write) writeAtomic(path.join(stage, rel), files[rel]);
    if (p.write.length) {
      try { await run(bin, ["copy", stage, remote, "--no-update-modtime"], { timeout: 600000, maxBuffer: 1 << 24 }); }
      catch (e) { throw new CCError("DEST_WRITE", `rclone copy failed: ${String(e.stderr || e.message).trim().split("\n").slice(-2).join(" ")}`, { hint: "Run `rclone lsd " + remote.slice(0, ci + 1) + "` to check the remote." }); }
    }
    for (const rel of p.remove) await run(bin, ["deletefile", `${remote.replace(/\/$/, "")}/${rel}`], { timeout: 60000 }).catch(() => {});
    state.manifest = p.manifest;
    return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged, detail: remote };
  },
};

// ── WebDAV: Nextcloud, ownCloud, Box (dav.box.com), Koofr, pCloud, Synology, any WebDAV server ──
export const webdav = {
  type: "webdav", kind: "files", title: "WebDAV (Nextcloud, ownCloud, Synology, ...)",
  fields: {
    url: { required: true, example: "https://cloud.example.com/remote.php/dav/files/me/Course Context", about: "WebDAV folder URL (created if missing)." },
    username: { about: "WebDAV username." }, password: { secret: true, about: "WebDAV password or app password." },
  },
  async push({ cfg, files, state, secret, http, dryRun }) {
    const base = String(cfg.url).replace(/\/+$/, "");
    const auth = cfg.username ? { Authorization: "Basic " + Buffer.from(`${await secret(cfg.username, "username")}:${await secret(cfg.password, "password")}`).toString("base64") } : {};
    const p = plan(files, state.manifest || {});
    if (dryRun) return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged, detail: base };
    const made = new Set();
    const mkcol = async (u) => { if (made.has(u)) return; const r = await http.request(u + "/", { method: "MKCOL", headers: auth }); await r.text(); if (![201, 405, 301, 200].includes(r.status)) throw httpError(r.status, u, "WebDAV MKCOL"); made.add(u); };
    await mkcol(base);
    for (const rel of p.write) {
      const segs = rel.split("/"); for (let i = 1; i < segs.length; i++) await mkcol(base + "/" + segs.slice(0, i).map(encodeURIComponent).join("/"));
      const r = await http.request(base + "/" + segs.map(encodeURIComponent).join("/"), { method: "PUT", headers: { ...auth, "Content-Type": mime(rel) }, body: files[rel] });
      await r.text(); if (!r.ok) throw httpError(r.status, base, "WebDAV PUT");
    }
    for (const rel of p.remove) { const r = await http.request(base + "/" + rel.split("/").map(encodeURIComponent).join("/"), { method: "DELETE", headers: auth }); await r.text(); }
    state.manifest = p.manifest;
    return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged, detail: base };
  },
};

// ── Google Drive API v3 ──
export const gdrive = {
  type: "gdrive", kind: "files", title: "Google Drive (API)",
  fields: {
    token: { required: true, secret: true, about: "OAuth access token or oauth refresh object with scope https://www.googleapis.com/auth/drive.file. Easier: a folder destination inside Google Drive for desktop, or rclone." },
    folder: { about: 'Folder name to create in My Drive (default "Course Context").' },
    parentId: { about: "Create the folder inside this Drive folder id instead of My Drive." },
  },
  async push({ cfg, files, state, secret, http, dryRun }) {
    const H = { Authorization: "Bearer " + (await secret(cfg.token, "token")) };
    const G = cfg.apiBase || "https://www.googleapis.com", API = G + "/drive/v3", UP = G + "/upload/drive/v3";
    const p = plan(files, state.manifest || {});
    if (dryRun) return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged };
    state.ids = state.ids || {}; // relative path (file or folder) → Drive id
    const call = async (url, opts = {}) => { const r = await http.request(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } }); const t = await r.text(); if (!r.ok) { if (r.status === 404) return null; throw httpError(r.status, url, "Google Drive"); } return t ? JSON.parse(t) : {}; };
    const folderId = async (rel, name, parent) => {
      if (state.ids[rel]) { const f = await call(`${API}/files/${state.ids[rel]}?fields=id,trashed`); if (f && !f.trashed) return state.ids[rel]; }
      const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${parent}' in parents and trashed = false`;
      const found = await call(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);
      const id = found && found.files && found.files[0] ? found.files[0].id : (await call(`${API}/files?fields=id`, { method: "POST", json: { name, mimeType: "application/vnd.google-apps.folder", parents: [parent] } })).id;
      state.ids[rel] = id; return id;
    };
    const rootId = await folderId("", cfg.folder || "Course Context", cfg.parentId || "root");
    for (const rel of p.write) {
      const segs = rel.split("/"); let parent = rootId;
      for (let i = 0; i < segs.length - 1; i++) parent = await folderId(segs.slice(0, i + 1).join("/") + "/", segs[i], parent);
      const name = segs[segs.length - 1];
      const existing = state.ids[rel] && (await call(`${API}/files/${state.ids[rel]}?fields=id,trashed`));
      if (existing && !existing.trashed) await call(`${UP}/files/${state.ids[rel]}?uploadType=media&fields=id`, { method: "PATCH", headers: { "Content-Type": mime(rel) }, body: files[rel] });
      else {
        const boundary = "cc" + Date.now().toString(36);
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${mime(rel)}\r\n\r\n${files[rel]}\r\n--${boundary}--`;
        state.ids[rel] = (await call(`${UP}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body })).id;
      }
    }
    for (const rel of p.remove) if (state.ids[rel]) { await call(`${API}/files/${state.ids[rel]}`, { method: "PATCH", json: { trashed: true } }); delete state.ids[rel]; }
    state.manifest = p.manifest;
    return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged, detail: `https://drive.google.com/drive/folders/${rootId}` };
  },
};

// ── OneDrive / SharePoint through Microsoft Graph ──
export const onedrive = {
  type: "onedrive", kind: "files", title: "OneDrive (Microsoft Graph)",
  fields: {
    token: { required: true, secret: true, about: "Graph access token or oauth refresh object (provider microsoft) with Files.ReadWrite or Files.ReadWrite.AppFolder." },
    folder: { about: 'Folder path in OneDrive (default "Course Context").' },
    appFolder: { about: "true: write under Apps/<app> (needs only Files.ReadWrite.AppFolder)." },
  },
  async push({ cfg, files, state, secret, http, dryRun }) {
    const H = { Authorization: "Bearer " + (await secret(cfg.token, "token")) };
    const GR = cfg.apiBase || "https://graph.microsoft.com/v1.0";
    const root = cfg.appFolder ? `${GR}/me/drive/special/approot:` : `${GR}/me/drive/root:`;
    const folder = cfg.appFolder ? "" : (cfg.folder || "Course Context");
    const enc = (rel) => "/" + join(folder, rel).split("/").map(encodeURIComponent).join("/");
    const p = plan(files, state.manifest || {});
    if (dryRun) return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged };
    for (const rel of p.write) { const r = await http.request(`${root}${enc(rel)}:/content`, { method: "PUT", headers: { ...H, "Content-Type": mime(rel) }, body: files[rel] }); await r.text(); if (!r.ok) throw httpError(r.status, root, "OneDrive"); }
    for (const rel of p.remove) { const r = await http.request(`${root}${enc(rel)}`, { method: "DELETE", headers: H }); await r.text(); }
    state.manifest = p.manifest;
    return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged };
  },
};

// ── Dropbox API v2 ──
export const dropbox = {
  type: "dropbox", kind: "files", title: "Dropbox (API)",
  fields: { token: { required: true, secret: true, about: "Dropbox access token or oauth refresh object (provider dropbox) with files.content.write." }, folder: { about: 'Folder (default "/Course Context").' } },
  async push({ cfg, files, state, secret, http, dryRun }) {
    const H = { Authorization: "Bearer " + (await secret(cfg.token, "token")) };
    const folder = "/" + String(cfg.folder || "Course Context").replace(/^\/+|\/+$/g, "");
    const p = plan(files, state.manifest || {});
    if (dryRun) return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged };
    for (const rel of p.write) {
      const r = await http.request(`${cfg.apiBase || "https://content.dropboxapi.com"}/2/files/upload`, { method: "POST", headers: { ...H, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": asciiJSON({ path: `${folder}/${rel}`, mode: "overwrite", mute: true, autorename: false }) }, body: files[rel] });
      await r.text(); if (!r.ok) throw httpError(r.status, "https://content.dropboxapi.com", "Dropbox");
    }
    for (const rel of p.remove) { const r = await http.request(`${cfg.apiBase || "https://api.dropboxapi.com"}/2/files/delete_v2`, { method: "POST", headers: H, json: { path: `${folder}/${rel}` } }); await r.text(); }
    state.manifest = p.manifest;
    return { written: p.write.length, removed: p.remove.length, unchanged: p.unchanged };
  },
};

// ── git: commit the folder into a repository and push (GitHub, GitLab, Gitea, ...) ──
export const git = {
  type: "git", kind: "files", title: "Git repository",
  fields: {
    path: { required: true, about: "Local clone to write into (must already exist and be a git repository)." },
    subdir: { about: 'Folder inside the repo (default "course-context").' },
    push: { about: "true (default): git push after committing." },
  },
  async push({ cfg, files, dryRun }) {
    const repo = path.resolve(expand(cfg.path));
    if (!fs.existsSync(path.join(repo, ".git"))) throw new CCError("CONFIG_INVALID", `${repo} is not a git repository.`, { hint: "Clone the repository first, then point path at it." });
    const sub = cfg.subdir || "course-context";
    // commit only real changes: a snapshot whose only difference is the time is not written
    const r = await folder.push({ cfg: { path: path.join(repo, sub) }, files, dryRun, stableOnly: true });
    if (dryRun || (!r.written && !r.removed)) return r;
    const g = (args) => run("git", ["-C", repo, ...args], { timeout: 120000 });
    try {
      await g(["add", "-A", "--", sub]);
      await g(["-c", "user.name=course-context", "-c", "user.email=course-context@localhost", "commit", "-m", `course-context sync ${new Date().toISOString()}`, "--", sub]).catch((e) => { if (!/nothing to commit/.test(String(e.stdout))) throw e; });
      if (cfg.push !== false) await g(["push"]);
    } catch (e) { throw new CCError("GIT_FAILED", `git failed: ${String(e.stderr || e.message).trim().split("\n").pop()}`, { hint: "Check that the clone has a remote and push access." }); }
    return { ...r, detail: `${repo}/${sub}` };
  },
};
