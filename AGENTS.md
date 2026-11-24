# AGENTS.md

Instructions for AI coding agents working on this repository. Users installing the tool: see llms-install.md instead.

## Commands

```
npm test                       # node --test: unit, end-to-end (fake school), destinations (fake APIs)
npm run check                  # wording check on human-facing text + tests
npm run build:extension        # copy src/core + src/sources into extension/lib, zip to dist/
node src/cli.js <command>      # run the CLI from the checkout
COURSE_CONTEXT_HOME=/tmp/cc node src/cli.js setup ...   # never touch the real ~/.course-context in tests
```

No dependencies. Node 18.17+. ES modules. No build step for the CLI.

## Layout

| Path | What | Constraint |
| --- | --- | --- |
| src/core/ | schema, dates, HTML parser, Markdown, iCalendar, matching, merge, render, to-do view, collect | no Node built-ins: it is copied into the extension |
| src/sources/ | one file per source type + index.js registry | no Node built-ins (manual/command/module use ctx functions) |
| src/destinations/ | files.js (folder, rclone, webdav, gdrive, onedrive, dropbox, git), todoapps.js, todoengine.js, webhook.js | Node only |
| src/node/ | config, secrets, paths, http client, sync pipeline, api (shared ops), server, openapi, schedule, detect | Node only |
| src/mcp/ | MCP server (stdio + HTTP dispatch), tool definitions, client installers | |
| src/cli.js | CLI | |
| extension/ | MV3 extension; extension/lib is generated, commit it after `npm run build:extension` | |
| docs/, llms.txt, llms-install.md | written for agents | |
| README.md, extension/options.* | written for students | plain words; `npm run check` |
| schema/ | JSON Schemas | keep in sync with src/core/schema.js and src/core/todo.js |
| tests/ | node:test; mock.js is a fake Canvas/WeBWorK/feed server | |

## Rules

- Read-only toward schools. Sources only GET (logins POST a form). Never add a write to an LMS.
- Keep output shapes stable: cc/1 and cc-todo/1 are contracts. Additive changes only; a rename or removal needs cc/2 and a docs update.
- Every CLI command: no prompts, one JSON object with --json, errors as CCError(code, message, {hint}). New codes go in docs/errors.md and core/errors.js exitFor.
- Idempotent adds and installs. Destinations only overwrite or delete what their manifest lists. To-do sync never deletes tasks.
- Times: epoch ms inside sources and merge; ISO with offset in output. Never write relative dates into files.
- New source: src/sources/NAME.js with `fields`, `fetch`; register in index.js (and ORDER); docs/sources.md; a parser test with a fixture.
- New destination: `fields` + `push(ctx)` returning `{written, removed, unchanged, detail}`; register in destinations/index.js; docs/destinations.md; a test against a fake API (tests/todo.test.js pattern, `apiBase`).
- New MCP client: src/mcp/clients.js CLIENTS entry; docs/clients.md row; extend the connect test if the format is new.
- After changing src/core or src/sources: `npm run build:extension` and commit extension/lib.
- Human-facing text: short plain sentences, no em dashes, no "its", no marketing words (tools/check-wording.mjs lists them).
