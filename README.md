# Course Context

Your classes, assignments, due dates, grades and announcements, kept up to date where any AI and any to-do app can read them.

It reads Canvas, Moodle, Google Classroom, Schoology, Brightspace, Blackboard and any calendar feed, plus WeBWorK and Gradescope. It writes a folder of plain files (your computer, Google Drive, OneDrive, Dropbox, iCloud or anywhere rclone reaches). It also connects to Claude, ChatGPT, Gemini, Cursor, Codex, Antigravity and other AI apps, and puts your work into Todoist, Google Tasks, Microsoft To Do, TickTick, Notion, Apple Reminders or Things. Ask any of them "what's due this week?" and the answer covers every class.

## Set it up

Paste this into Claude Code, Codex, Cursor, Antigravity, Gemini CLI or any AI that can run commands on your computer:

```
Set up course-context for me: https://github.com/imanimal/course-context/blob/main/llms-install.md
```

It installs everything, asks you for your school's address and one access link, and connects the AI apps on your computer.

Doing it yourself takes two commands:

```
npm install -g course-context
course-context setup --canvas school.instructure.com --canvas-token YOUR_TOKEN
```

To get a Canvas token, open Account, then Settings, then New Access Token. If your school hides that button, use the calendar feed link from Canvas Calendar instead (`--ics LINK`), or the browser extension in `extension/`.

## What you get

- A Course Context folder with `now.md` (what's due, what's late, what has no date), a page per class, a to-do list and calendar files. Put it in your cloud drive and every computer and phone has it.
- Every AI app on your computer gets connected through MCP. Web chatbots like ChatGPT and claude.ai connect through a link once you run the server (see `docs/self-host.md`).
- Your to-do app gets your work as tasks. Tick a task there and it's marked done everywhere.
- Your own notes and dates. Set a due date for work that has none, add tasks, mark classes as priority. Course Context never changes anything at your school.
- An API for any app, automation or script: `course-context serve`, then read `/openapi.json`.

## How it handles your data

Everything stays on your computer unless you pick a cloud folder, a to-do app or a server. Tokens are stored in a file only your user account can read. The browser extension only reads.

## For AI agents and developers

Start at [llms.txt](llms.txt). Install steps: [llms-install.md](llms-install.md). Working on this repository: [AGENTS.md](AGENTS.md).

MIT license.
