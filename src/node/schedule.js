// Background sync on a timer with the OS scheduler: launchd (macOS), systemd user timer or cron (Linux),
// Task Scheduler (Windows). Runs `course-context sync --quiet` every N minutes, also after login.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CCError } from "../core/errors.js";
import { logDir, ensureDir, writeAtomic, home } from "./paths.js";

const LABEL = "io.github.course-context.sync";
const cli = () => fs.realpathSync(fileURLToPath(new URL("../cli.js", import.meta.url)));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

export function scheduleStatus() {
  try {
    if (process.platform === "darwin") { const p = plist(); return { installed: fs.existsSync(p), mechanism: "launchd", file: p }; }
    if (process.platform === "win32") { try { sh("schtasks", ["/Query", "/TN", "CourseContextSync"]); return { installed: true, mechanism: "schtasks" }; } catch { return { installed: false, mechanism: "schtasks" }; } }
    const unit = path.join(os.homedir(), ".config", "systemd", "user", "course-context-sync.timer");
    if (fs.existsSync(unit)) return { installed: true, mechanism: "systemd", file: unit };
    let cron = ""; try { cron = sh("crontab", ["-l"]); } catch { /* none */ }
    return { installed: cron.includes("course-context-sync"), mechanism: "cron" };
  } catch (e) { return { installed: false, error: e.message }; }
}

const plist = () => path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

export function installSchedule(minutes = 30) {
  if (!(minutes >= 5 && minutes <= 1440)) throw new CCError("USAGE", "Interval must be 5 to 1440 minutes.");
  ensureDir(logDir());
  const node = process.execPath, script = cli(), log = path.join(logDir(), "sync.log");
  const envHome = process.env.COURSE_CONTEXT_HOME ? { COURSE_CONTEXT_HOME: home() } : {};
  if (process.platform === "darwin") {
    const p = plist();
    const env = Object.entries({ PATH: process.env.PATH || "/usr/bin:/bin", ...envHome }).map(([k, v]) => `<key>${k}</key><string>${x(v)}</string>`).join("");
    writeAtomic(p, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${x(node)}</string><string>${x(script)}</string><string>sync</string><string>--quiet</string></array>
<key>StartInterval</key><integer>${minutes * 60}</integer>
<key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict>${env}</dict>
<key>StandardOutPath</key><string>${x(log)}</string><key>StandardErrorPath</key><string>${x(log)}</string>
</dict></plist>
`);
    const uid = process.getuid();
    try { sh("launchctl", ["bootout", `gui/${uid}`, p]); } catch { /* not loaded */ }
    try { sh("launchctl", ["bootstrap", `gui/${uid}`, p]); } catch { sh("launchctl", ["load", "-w", p]); }
    return { ok: true, mechanism: "launchd", file: p, everyMinutes: minutes, log };
  }
  if (process.platform === "win32") {
    const tr = `"${node}" "${script}" sync --quiet`;
    sh("schtasks", ["/Create", "/F", "/SC", "MINUTE", "/MO", String(minutes), "/TN", "CourseContextSync", "/TR", tr]);
    return { ok: true, mechanism: "schtasks", task: "CourseContextSync", everyMinutes: minutes };
  }
  // Linux: systemd user timer when available, else cron
  let systemd = false;
  try { sh("systemctl", ["--user", "show-environment"]); systemd = true; } catch { systemd = false; }
  if (systemd) {
    const dir = path.join(os.homedir(), ".config", "systemd", "user");
    ensureDir(dir, 0o755);
    const envLine = Object.entries(envHome).map(([k, v]) => `Environment=${k}=${v}\n`).join("");
    writeAtomic(path.join(dir, "course-context-sync.service"), `[Unit]\nDescription=course-context sync\n\n[Service]\nType=oneshot\n${envLine}ExecStart="${node}" "${script}" sync --quiet\n`);
    writeAtomic(path.join(dir, "course-context-sync.timer"), `[Unit]\nDescription=course-context sync every ${minutes} minutes\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=${minutes}min\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`);
    sh("systemctl", ["--user", "daemon-reload"]);
    sh("systemctl", ["--user", "enable", "--now", "course-context-sync.timer"]);
    return { ok: true, mechanism: "systemd", everyMinutes: minutes, note: "Runs while you are logged in. For always-on, run: loginctl enable-linger $USER" };
  }
  let cron = ""; try { cron = sh("crontab", ["-l"]); } catch { cron = ""; }
  cron = cron.split("\n").filter((l) => !l.includes("course-context-sync")).join("\n").trim();
  const step = minutes < 60 ? `*/${minutes} * * * *` : `0 */${Math.max(1, Math.round(minutes / 60))} * * *`;
  const envs = Object.entries(envHome).map(([k, v]) => `${k}=${JSON.stringify(v)} `).join("");
  cron += `\n${step} ${envs}"${node}" "${script}" sync --quiet >> "${log}" 2>&1 # course-context-sync\n`;
  execFileSync("crontab", ["-"], { input: cron.replace(/^\n/, "") });
  return { ok: true, mechanism: "cron", everyMinutes: minutes, log };
}

export function removeSchedule() {
  if (process.platform === "darwin") { const p = plist(); try { sh("launchctl", ["bootout", `gui/${process.getuid()}`, p]); } catch { /* not loaded */ } try { fs.unlinkSync(p); } catch { /* none */ } return { ok: true }; }
  if (process.platform === "win32") { try { sh("schtasks", ["/Delete", "/F", "/TN", "CourseContextSync"]); } catch { /* none */ } return { ok: true }; }
  const dir = path.join(os.homedir(), ".config", "systemd", "user");
  if (fs.existsSync(path.join(dir, "course-context-sync.timer"))) { try { sh("systemctl", ["--user", "disable", "--now", "course-context-sync.timer"]); } catch { /* ignore */ } for (const f of ["course-context-sync.timer", "course-context-sync.service"]) try { fs.unlinkSync(path.join(dir, f)); } catch { /* none */ } }
  try { const cron = sh("crontab", ["-l"]); execFileSync("crontab", ["-"], { input: cron.split("\n").filter((l) => !l.includes("course-context-sync")).join("\n") + "\n" }); } catch { /* none */ }
  return { ok: true };
}

const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── always-on server (for the browser extension inbox, the HTTP API and remote chatbots) ──
const SLABEL = "io.github.course-context.serve";
export function installService({ port = 8787, host = "127.0.0.1", syncEvery = 0 } = {}) {
  ensureDir(logDir());
  const node = process.execPath, script = cli(), log = path.join(logDir(), "serve.log");
  const args = ["serve", "--host", host, "--port", String(port), ...(syncEvery ? ["--sync-every", String(syncEvery)] : [])];
  if (process.platform === "darwin") {
    const p = path.join(os.homedir(), "Library", "LaunchAgents", `${SLABEL}.plist`);
    writeAtomic(p, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${SLABEL}</string>
<key>ProgramArguments</key><array><string>${x(node)}</string><string>${x(script)}</string>${args.map((a) => `<string>${x(a)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${x(process.env.PATH || "/usr/bin:/bin")}</string>${process.env.COURSE_CONTEXT_HOME ? `<key>COURSE_CONTEXT_HOME</key><string>${x(home())}</string>` : ""}</dict>
<key>StandardOutPath</key><string>${x(log)}</string><key>StandardErrorPath</key><string>${x(log)}</string>
</dict></plist>
`);
    const uid = process.getuid();
    try { sh("launchctl", ["bootout", `gui/${uid}`, p]); } catch { /* not loaded */ }
    try { sh("launchctl", ["bootstrap", `gui/${uid}`, p]); } catch { sh("launchctl", ["load", "-w", p]); }
    return { ok: true, mechanism: "launchd", file: p, url: `http://${host}:${port}`, log };
  }
  if (process.platform === "win32") {
    const tr = `"${node}" "${script}" ${args.join(" ")}`;
    sh("schtasks", ["/Create", "/F", "/SC", "ONLOGON", "/TN", "CourseContextServe", "/TR", tr]);
    try { sh("schtasks", ["/Run", "/TN", "CourseContextServe"]); } catch { /* starts at next login */ }
    return { ok: true, mechanism: "schtasks", task: "CourseContextServe", url: `http://${host}:${port}` };
  }
  const dir = path.join(os.homedir(), ".config", "systemd", "user");
  ensureDir(dir, 0o755);
  const envLine = process.env.COURSE_CONTEXT_HOME ? `Environment=COURSE_CONTEXT_HOME=${home()}\n` : "";
  writeAtomic(path.join(dir, "course-context-serve.service"), `[Unit]\nDescription=course-context server\nAfter=network-online.target\n\n[Service]\n${envLine}ExecStart="${node}" "${script}" ${args.join(" ")}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`);
  try { sh("systemctl", ["--user", "daemon-reload"]); sh("systemctl", ["--user", "enable", "--now", "course-context-serve.service"]); }
  catch (e) { throw new CCError("UNSUPPORTED", "systemd user services are not available here.", { hint: "Run `course-context serve` from your session startup, or use the Docker image." }); }
  return { ok: true, mechanism: "systemd", url: `http://${host}:${port}` };
}

export function removeService() {
  if (process.platform === "darwin") { const p = path.join(os.homedir(), "Library", "LaunchAgents", `${SLABEL}.plist`); try { sh("launchctl", ["bootout", `gui/${process.getuid()}`, p]); } catch { /* not loaded */ } try { fs.unlinkSync(p); } catch { /* none */ } return { ok: true }; }
  if (process.platform === "win32") { try { sh("schtasks", ["/End", "/TN", "CourseContextServe"]); } catch { /* not running */ } try { sh("schtasks", ["/Delete", "/F", "/TN", "CourseContextServe"]); } catch { /* none */ } return { ok: true }; }
  try { sh("systemctl", ["--user", "disable", "--now", "course-context-serve.service"]); } catch { /* none */ }
  try { fs.unlinkSync(path.join(os.homedir(), ".config", "systemd", "user", "course-context-serve.service")); } catch { /* none */ }
  return { ok: true };
}
