# Install and set up course-context (instructions for AI agents)

You are an AI agent. The user wants their classes, assignments, due dates, grades and announcements available to AI assistants and to-do apps. Follow these steps in order. Do the work yourself. Ask the user only for values marked **ASK**, in one message, using the wording the tool gives you. Do not ask the user to edit files.

Every `course-context` command prints one JSON object when stdout is not a terminal (or with `--json`). Read `ok`, `needs[]`, `tellUser[]`, `error.code` and `error.hint`. Exit codes: 0 ok, 2 usage, 3 needs user input, 4 not found, 5 partial (some source or destination failed), 75 temporary network trouble (retry once).

## 0. Choose the path

| Your situation | Path |
| --- | --- |
| You can run shell commands on the user's computer (Claude Code, Codex, Cursor agent, Antigravity, Gemini CLI, Copilot CLI or agent mode, Cline, Roo, Windsurf, Kiro, Goose, opencode, Amp, Warp, Junie, Qwen Code, Augment) | A |
| You are a chatbot without a shell (ChatGPT, claude.ai, Gemini app, Le Chat, Perplexity, Copilot) | B |
| The user wants it on a server, always on, reachable from every device | A, then C |

## Path A: install on the user's computer

### A1. Node.js

Run `node --version`. Need 18.17 or newer. If missing or older, tell the user Node.js is needed and, with their OK, install it:

| OS | Command |
| --- | --- |
| macOS | `brew install node` (or the installer from https://nodejs.org) |
| Windows | `winget install OpenJS.NodeJS.LTS` |
| Linux | the distribution package (`sudo apt install nodejs npm`, `sudo dnf install nodejs`) or https://nodejs.org |

### A2. Install the CLI

```
npm install -g course-context
```

If that fails with EACCES or permission errors, do not use sudo. Run every command below as `npx -y course-context@latest <command>` instead. Check: `course-context version`.

### A3. Look at the machine

```
course-context doctor
```

Note `timezone`, `cloudFolders` (synced Google Drive / OneDrive / Dropbox / iCloud folders) and `mcpClients` (AI apps found).

### A4. Ask the user (one message)

Run `course-context setup` with no flags. It exits 3 and returns `needs[]`. Send the user the `ask` text of each need. The first one asks which school system they use and its address.

Map the answer to flags:

| User says | Flags |
| --- | --- |
| Canvas, address X, and a token | `--canvas X --canvas-token TOKEN` |
| Canvas, but no token button (school disabled tokens) | ask for the Canvas calendar feed link (Canvas → Calendar → Calendar Feed), then `--ics LINK`. For full details later, install the browser extension (step A8). |
| Moodle at URL | `--moodle URL --moodle-token T` (Moodle → Preferences → Security keys → Moodle mobile web service), or `--moodle URL --moodle-user U --moodle-password P`, or the calendar export link with `--ics` |
| Brightspace / D2L, Blackboard, Sakai | calendar feed link: `--ics LINK` (Brightspace: Calendar → Subscribe; Blackboard: Calendar → Share calendar) |
| Google Classroom | each class has a Google Calendar: Google Calendar → that class's calendar → Settings → "Secret address in iCal format" → `--ics LINK` (repeat `--ics` per class) |
| Schoology | `--schoology-key K --schoology-secret S` from https://SCHOOL.schoology.com/api, or the calendar feed with `--ics` |
| WeBWorK with its own login | add `--webwork https://HOST/webwork2/COURSE/ --webwork-user U --webwork-password P` |
| Gradescope with a password | add `--gradescope-email E --gradescope-password P` |
| Several systems | combine flags; `--ics` can repeat |

### A5. Run setup

```
course-context setup --canvas school.instructure.com --canvas-token TOKEN
```

What setup does, in order: creates `~/.course-context/config.json` (mode 600), adds the sources, adds a folder destination (inside the first synced cloud folder if there is one, else `~/Course Context`), syncs, registers the MCP server with every AI app found, installs the agent skill, and schedules a sync every 30 minutes.

Useful overrides: `--folder PATH` or `--folder none`, `--clients auto|all|none|cursor,claude-code,...`, `--schedule 60` or `--schedule none`, `--timezone America/Chicago`.

Read the result:
- `ok: true`: tell the user the lines in `tellUser`.
- `needs` not empty (exit 3): each need has `problem` (what failed) and `ask` (what to tell the user). Ask, then run setup again with the new flags. Setup is idempotent: re-running it updates entries instead of duplicating them.
- `sync.sources[].error.code` `AUTH_FORBIDDEN`: the school blocks tokens. Use the calendar feed (`--ics`) and the extension.

### A6. Check it

```
course-context due
```

Show the user the first few items. If something is missing, run `course-context status` and read `sources[].error.hint`.

### A7. Optional extras (offer them, don't push)

| User wants | Do |
| --- | --- |
| Tasks in a to-do app | `course-context dest add todoist --token T` (Todoist → Settings → Integrations → Developer). Others: `google-tasks`, `microsoft-todo`, `ticktick`, `notion --token T --database ID`, `caldav --url ... --username ... --password ...` (Apple Reminders through iCloud, Nextcloud, Fastmail), `apple-reminders` and `things` (macOS, no token). Then `course-context sync`. Ticking a task in the app marks the item done everywhere. |
| ChatGPT, claude.ai, Le Chat, Perplexity or another web chatbot | Path C, then `course-context connect remote --public-url URL` and give the user the steps it prints. |
| Gemini app or NotebookLM | Make sure the folder destination is inside Google Drive (`doctor` → `cloudFolders`). Tell the user to type @Google Drive in Gemini and name the Course Context folder, or add `now.md` and `README-for-AI.md` to a Gem or notebook. |
| An AI app that was not found automatically | `course-context connect --list`, then `course-context connect <id>`. Restart that app afterwards. |
| Automations (Zapier, n8n, Make, Shortcuts, Home Assistant) | `course-context dest add webhook --url URL` for pushes, or the HTTP API (`course-context serve`, docs/api.md) for pulls. |

### A8. Schools that block tokens (SSO-only)

Install the browser extension: it reads Canvas, WeBWorK and Gradescope with the user's normal sign-in. Steps for the user: open `chrome://extensions` (or `about:debugging` in Firefox), turn on Developer mode, Load unpacked, choose the `extension` folder of this repository (the npm package path is `$(npm root -g)/course-context/extension`; it is also at https://github.com/imanimal/course-context/tree/main/extension). In the extension options: add the Canvas address, keep "The Course Context app on this computer" checked, paste the token from `course-context server token`. The server must be running for the extension to deliver: run `course-context service install` once.

## Path B: you are a chatbot without a shell

You cannot install software from here. Tell the user, in one short message:
1. To have a coding agent do it: paste this into Claude Code, Codex, Cursor, Antigravity or any agent with a terminal: `Set up course-context for me: https://github.com/imanimal/course-context/blob/main/llms-install.md`
2. If they already run course-context with a public URL: add a custom connector with the URL `https://HOST/k/TOKEN/mcp` (claude.ai: Settings → Connectors → Add custom connector; ChatGPT: developer mode → create app, No authentication).
3. If their Course Context folder is in Google Drive, OneDrive or Dropbox and you have a connector to that drive: read `now.md` and `README-for-AI.md` from the Course Context folder.

## Path C: always-on server (optional)

Needed for web chatbots and phones. Either keep `course-context serve` running on the user's computer behind a tunnel, or deploy the Docker image. Full steps: docs/self-host.md. Short version on the user's computer:

```
course-context serve --host 127.0.0.1 --port 8787
cloudflared tunnel --url http://localhost:8787
```

The tunnel prints an https URL. Then: `course-context connect remote --public-url https://THAT-URL`.

## Rules

- Course-context only reads from schools. Never describe it as able to submit or change anything there.
- Pass secrets as flags or `env:NAME` references. Do not echo tokens back to the user after storing them. `config.json` is mode 600.
- Do not edit `config.json` or AI app config files by hand; the commands keep other entries, back files up once (`.bak-course-context`) and refuse to rewrite JSON with comments (then they print a snippet for you to paste).
- After registering MCP with an app, the app must be restarted.
- To undo everything: `course-context uninstall` (add `--purge` to delete `~/.course-context`).

## Where to look next

- Every command and flag: `course-context help`, docs/cli.md
- Sources and how to get each credential: `course-context types sources`, docs/sources.md
- Destinations and to-do apps: docs/destinations.md
- MCP tools and every client: docs/mcp.md, docs/clients.md
- HTTP API: docs/api.md, `GET /openapi.json`
- Error codes and fixes: docs/errors.md
