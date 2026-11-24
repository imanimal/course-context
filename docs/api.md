# HTTP API

`course-context serve` starts it (default `http://127.0.0.1:8787`). The machine-readable description is `GET /openapi.json` (OpenAPI 3.1); a plain index for LLMs is `GET /llms.txt`. Use the OpenAPI file for Custom GPT Actions, Copilot Studio, Zapier/n8n/Make HTTP steps, Postman, or a client generator.

## Auth

| Request | Token needed |
| --- | --- |
| `/health`, `/openapi.json`, `/llms.txt`, `/` | no |
| From this machine (loopback address), Host header `localhost`/`127.0.0.1`/`::1`, no `Origin` header | no (CLI tools, local agents, scripts) |
| Everything else (other machines, any browser page, the extension) | yes |

Send the token (`course-context server token`) as `Authorization: Bearer TOKEN`, or `?key=TOKEN`, or a path prefix `/k/TOKEN/...` (for apps that only take a URL, such as chatbot connectors and calendar subscriptions). CORS allows any origin once the token is valid. Wrong or missing token: 401 with `WWW-Authenticate: Bearer`.

## Read

| Route | Returns |
| --- | --- |
| `GET /v1/overview` | now.md (text/markdown) |
| `GET /v1/todo` | flat to-do list; `?include_done=true`, `?horizon_days=N`, `?include_undated=false`, `?class=X` |
| `GET /v1/items` | `{snapshot, timezone, total, returned, truncated, items[]}`; `?class ?status=open|done|all|STATUS ?due_within_days ?include_undated ?kind ?q ?limit ?format=detailed` |
| `GET /v1/items/{id}` | one item in full (URL-encode the id: `canvas%3Ahost%2Fassignment%2F5`) |
| `GET /v1/classes` | class summaries |
| `GET /v1/classes/{class}` | class JSON; with `Accept: text/markdown`, class.md + work.md |
| `GET /v1/announcements` | `?class ?days ?limit` |
| `GET /v1/search?q=` | classes, items, announcements matching every word |
| `GET /v1/context` | the full cc/1 document |
| `GET /v1/files` / `GET /v1/files/{path}` | list / one rendered file |
| `GET /v1/calendar.ics` | dated work as VEVENTs (subscribe: `https://HOST/k/TOKEN/v1/calendar.ics`) |
| `GET /v1/todo.ics` | open work as VTODOs |
| `GET /v1/status` | snapshot age, sources, last sync |

## Write (the student's layer; never the LMS)

| Route | Body |
| --- | --- |
| `PATCH /v1/items/{id}` | `{"done": true}`, `{"due": "2026-12-04T23:59"}`, `{"due": null}`, `{"note": "..."}`, `{"priority": true}`, `{"hidden": true}` |
| `POST /v1/tasks` | `{"title", "due"?, "class"?, "note"?}` → 201 `{ok, id}` |
| `PATCH /v1/tasks/{id}` | `{"done"?, "title"?, "due"?, "note"?}` |
| `DELETE /v1/tasks/{id}` | |
| `PATCH /v1/classes/{class}` | `{"nick"?, "mode"?: "priority|active|ghost|hidden", "notes"?}` |
| `POST /v1/sync` | `{"sources"?: [ids]}` → sync report |
| `POST /v1/ingest/{id}` | a cc/1 document (browser extension, another computer); stored as source `snapshot` with that id |

Writes return `{ok, ..., resynced}` after re-rendering every destination. A server started with `--from` or `--read-only` refuses writes (`READ_ONLY`).

## MCP

`POST /mcp` (or `/k/TOKEN/mcp`): MCP Streamable HTTP, stateless, JSON responses. docs/mcp.md.

## Todo

```json
{
  "schema": "cc-todo/1",
  "generatedAt": "2026-11-24T12:00:00-08:00",
  "timezone": "America/Los_Angeles",
  "todos": [
    {
      "id": "canvas:school.instructure.com/assignment/5",
      "title": "HW 5",
      "class": "MATH 4B",
      "classId": "canvas:school.instructure.com/course/101",
      "kind": "assignment",
      "status": "todo",
      "done": false,
      "due": "2026-11-26T23:59:00-08:00",
      "dueDate": "2026-11-26",
      "dueTime": "23:59",
      "timezone": "America/Los_Angeles",
      "priority": "normal",
      "overdue": false,
      "points": 10,
      "url": "https://school.instructure.com/courses/101/assignments/5",
      "notes": "MATH 4B · assignment · 10 pts\nDue date from canvas.\nhttps://...",
      "source": "canvas",
      "hash": "9a1c03fe"
    }
  ]
}
```

`id` is stable across syncs: use it as the external id in your app. `hash` changes when any shown field changes: compare it to skip unchanged records. `done` is true for `done`, `submitted`, `graded`, `excused`, `late` and `closed`. `priority` is `high` for priority classes, items the student pinned, missing or overdue work, and exams.

## Errors

`{"ok": false, "error": {"code", "message", "hint"}}`. HTTP status from the code: 400 usage, 401 auth, 404 not found, 207 partial, 503 temporary, 500 other. Codes: docs/errors.md.

## Examples

```
curl -s http://127.0.0.1:8787/v1/todo | jq '.todos[] | {title, class, dueDate}'
curl -s -H "Authorization: Bearer $TOKEN" https://cc.example.com/v1/items?due_within_days=7
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"done":true}' "https://cc.example.com/v1/items/canvas%3Aschool.instructure.com%2Fassignment%2F5"
```
