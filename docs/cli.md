# CLI reference

Binary: `course-context` (alias `ccx`). Node 18.17+. No dependencies.

## Output contract

- With `--json`, or when stdout is not a terminal, every command prints exactly one JSON object on stdout. `--text` forces text.
- Success objects have `"ok": true`. Failures: `{"ok": false, "error": {"code", "message", "hint"}}`. `hint` is the next step.
- `mcp` and `serve` are long-running; `mcp` writes only JSON-RPC to stdout.
- No command prompts. Missing input is reported, never asked for.
- Every add/connect/setup command is idempotent. Re-running updates in place.

## Exit codes

| Code | Meaning | Agent action |
| --- | --- | --- |
| 0 | ok | continue |
| 1 | error | read `error`, fix, retry |
| 2 | usage (unknown command, bad flag value) | fix the command line (`course-context help`) |
| 3 | needs user input (missing or rejected credential, signed out, school blocks tokens) | ask the user using `needs[].ask` or `error.hint` |
| 4 | not found (no config, no snapshot, unknown id) | run setup or sync, or list ids |
| 5 | partial: some sources or destinations failed, the rest worked | report per-item errors |
| 75 | temporary (network, rate limit, 5xx) | retry once after a short wait |

## Flags

`--name value`, `--name=value`, `--flag` (true), `--no-flag` (false). kebab-case and camelCase are the same (`--canvas-token` = `--canvasToken`). Repeating a flag makes a list (`--ics A --ics B`). Values `true`, `false`, `null` and JSON (`[...]`, `{...}`) are parsed.

## Commands

### setup
One command that does everything an agent needs. See llms-install.md.

| Flag | Meaning |
| --- | --- |
| `--canvas HOST` + `--canvas-token T` (or `--canvas-cookie C`) | Canvas source |
| `--ics URL` (repeatable) | calendar feed source |
| `--moodle URL` + `--moodle-token T` or `--moodle-user U --moodle-password P` | Moodle source |
| `--webwork URL` + `--webwork-user U --webwork-password P` | WeBWorK source |
| `--gradescope-email E --gradescope-password P` or `--gradescope-cookie C` | Gradescope source |
| `--classroom-token T` | Google Classroom source (token or oauth JSON) |
| `--schoology-key K --schoology-secret S [--schoology-domain URL]` | Schoology source |
| `--folder PATH\|auto\|none` | folder destination (default auto: inside the first synced cloud folder, else `~/Course Context`) |
| `--clients auto\|all\|none\|id,id` | MCP registration (default auto: every AI app found) |
| `--schedule MINUTES\|none` | background sync (default 30) |
| `--timezone IANA` | time zone (default: the machine's) |
| `--no-sync` | skip the first sync |

Result: `{ok, configPath, timezone, sources, destinations, sync, clients, schedule, needs[], tellUser[]}`. `needs[]` items: `{field, ask, problem?, then?}`. Exit 3 when `needs` is not empty.

### doctor
Machine facts: `node`, `platform`, `timezone`, `cloudFolders[] {provider, path, suggested}`, `mcpClients[] {id, name, installed}`, `tools` (rclone, git, docker, cloudflared, tailscale, ngrok, claude, codex, gemini), `config` (redacted), `schedule`.

### types [sources|destinations]
Every type with `fields: {name: {required, secret, about}}`. Use it to build `source add` / `dest add` lines.

### source add TYPE --FIELD VALUE ...
Adds or updates a source (same id, or same type + host/url/path, updates). Tests it right away (`--no-test` to skip): result has `test: {ok, items}` or `test: {ok: false, error}`. Also: `source list`, `source remove ID`, `source test ID`.

### dest add TYPE --FIELD VALUE ...
Adds or updates a destination. Also: `dest list`, `dest remove ID`, `dest test ID` (dry run: what would be written).

### sync [--source a,b] [--dest x,y] [--dry-run] [--quiet]
Fetch sources, rebuild the snapshot, push every destination. A failing source keeps its last good data (`stale: true`). Result: `{ok, counts, sources[], destinations[], completedInTodoApps?}`. `--quiet` prints nothing on success (for schedulers).

### status
`{snapshot: {generatedAt, ageHours, stale, classes, items, open}, sources[], lastSync, configured}`.

### due [--days N] [--class X]
Without `--days`: now.md. With `--days`: the open items due within N days.

### show [FILE]
A rendered file: `now.md` (default), `README-for-AI.md`, `todo.md`, `todo.json`, `llms.txt`, `classes/SLUG/class.md`, `classes/SLUG/work.md`. `--from PATH|URL` reads another snapshot.

### items
`--class X --status open|done|all|STATUS --days N --kind K --query WORDS --limit N --detailed --from PATH`.

### item ID
No flags: the item in full. Changes (student's layer only): `--done`, `--not-done`, `--due ISO`, `--clear-due`, `--note TEXT`, `--priority`, `--no-priority`, `--hide`, `--unhide`. `--due 2026-12-04` means 11:59 PM that day in the configured zone.

### task add TITLE [--due ISO] [--class X] [--note T] | task done ID | task remove ID
The student's own tasks (ids `task:...`).

### class [CLASS] [--nick N] [--mode priority|active|ghost|hidden] [--notes T]
No CLASS: list classes. CLASS without flags: the class page. CLASS matches code, nickname, slug, id or part of the name.

### render --out DIR
Write the files to DIR without touching destinations.

### mcp [--from PATH|URL] [--read-only]
MCP server over stdio. This is what AI apps launch. `--from` serves a snapshot from a synced folder or URL (read-only).

### serve
`--host` (default 127.0.0.1; use 0.0.0.0 in containers), `--port` (8787), `--token` (default config `server.token`, or env `COURSE_CONTEXT_TOKEN`), `--sync-every MINUTES`, `--public-url URL`, `--from PATH|URL`, `--read-only`, `--verbose`. Routes: docs/api.md.

### server token [--rotate]
Print (or replace) the HTTP token.

### connect [auto|all|ID...] [--remove] [--dry-run] | connect --list | connect remote [--public-url URL]
Register the MCP server with AI apps (docs/clients.md). `remote` prints the steps for web chatbots with the right URL filled in.

### skill install|remove [--target auto|claude|codex|codex-agents|gemini|copilot|cursor|DIR]
Copies skills/course-context/SKILL.md into agent skill folders.

### schedule install [--every MINUTES] | schedule remove | schedule status
Background sync: launchd (macOS), systemd user timer or cron (Linux), Task Scheduler (Windows).

### service install [--port 8787] [--host H] [--sync-every MINUTES] | service remove
Keep `serve` running from login (needed by the browser extension and remote chatbots on this computer).

### config path | config show | config set DOTTED.KEY VALUE
`config show` masks secrets. Example: `config set options.horizonDays 21`.

### docs [TOPIC]
Prints bundled docs: `install`, `cli`, `config`, `sources`, `destinations`, `api`, `mcp`, `clients`, `output`, `errors`, `self-host`, `extension`, `writing-for-agents`.

### uninstall [--purge]
Removes the schedule, the service, every AI app entry and the skill. `--purge` also deletes `~/.course-context`. Output folders and to-do app tasks stay.

## Environment variables

| Variable | Effect |
| --- | --- |
| `COURSE_CONTEXT_HOME` | data directory (default `~/.course-context`) |
| `COURSE_CONTEXT_CONFIG` | config file path |
| `COURSE_CONTEXT_TOKEN` | HTTP token for `serve` |
| `COURSE_CONTEXT_SYNC_EVERY` | minutes, for `serve` in containers |
| `PORT` | port for `serve` when `--port` is absent |
