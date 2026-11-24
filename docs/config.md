# config.json

Path: `~/.course-context/config.json` (`COURSE_CONTEXT_HOME` or `COURSE_CONTEXT_CONFIG` override). Mode 600. JSON Schema: schema/config.schema.json. Change it with commands (`setup`, `source add`, `dest add`, `item`, `class`, `task`, `config set`); hand edits are allowed but not needed.

```json
{
  "version": 1,
  "timezone": "America/Los_Angeles",
  "sources": [
    { "id": "canvas-ucsb", "type": "canvas", "host": "ucsb.instructure.com", "token": "env:CANVAS_TOKEN" },
    { "id": "ics-moodle", "type": "ics", "url": "https://moodle.school.edu/calendar/export_execute.php?..." }
  ],
  "destinations": [
    { "id": "folder", "type": "folder", "path": "~/Library/CloudStorage/GoogleDrive-me@gmail.com/My Drive/Course Context" },
    { "id": "todoist", "type": "todoist", "token": "keychain:course-context/todoist" }
  ],
  "server": { "host": "127.0.0.1", "port": 8787, "token": "generated-on-init" },
  "user": {
    "classes": { "canvas:ucsb.instructure.com/course/101": { "nick": "Linear", "mode": "priority", "notes": "Office hours Tue 3pm" } },
    "items": { "canvas:ucsb.instructure.com/assignment/5": { "done": true, "due": "2026-12-04T23:59:00-08:00", "note": "ask TA", "priority": true, "hidden": false } },
    "tasks": [ { "id": "m3x1", "title": "Study for midterm", "due": "2026-12-09", "classId": "canvas:ucsb.instructure.com/course/101", "note": null, "done": false } ]
  },
  "options": { "horizonDays": 14, "pastDays": 45, "announcementDays": 14, "maxSummary": 1200, "folderName": "Course Context" }
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `timezone` | IANA zone used for display, for "date only" inputs and for dates a source prints without a zone |
| `sources[]` | `{id, type, enabled?, ...type fields}`; types: docs/sources.md |
| `destinations[]` | `{id, type, enabled?, ...type fields}`; types: docs/destinations.md |
| `server` | `serve` defaults; `token` guards the HTTP API |
| `user.classes[classId]` | the student's layer for a class: `nick`, `mode` (`priority`, `active`, `ghost`, `hidden`), `notes`, `links[]`, `mergeInto` (force a class from another source to merge into this class id) |
| `user.items[itemId]` | the student's layer for an item: `done`, `due` (wins over every source), `note`, `priority`, `hidden`; `doneVia: "todo-app"` when a to-do app marked it |
| `user.tasks[]` | the student's own tasks |
| `options.horizonDays` | window of now.md and to-do sync (default 14 for now.md; to-do apps use their own `horizonDays`, default 60) |
| `options.pastDays` | past work older than this is dropped unless still open (default 45) |
| `options.announcementDays` | announcements window (default 14) |

## Secret references

Any secret field accepts:

| Form | Example |
| --- | --- |
| literal | `"7~AbC..."` |
| environment variable | `"env:CANVAS_TOKEN"` |
| file | `"file:~/secrets/canvas.txt"` |
| command output | `"cmd:op read op://School/Canvas/token"` (1Password), `"cmd:security find-generic-password -s canvas -w"`, `"cmd:pass show canvas"` |
| OS keychain | `"keychain:SERVICE/ACCOUNT"` (macOS Keychain via `security`, Linux Secret Service via `secret-tool`) |
| OAuth refresh | object below |

## OAuth

For APIs with short-lived access tokens (Google, Microsoft, Dropbox, TickTick):

```json
{ "type": "oauth", "provider": "google", "clientId": "...", "clientSecret": "env:GOOGLE_CLIENT_SECRET", "refreshToken": "1//0g..." }
```

`provider`: `google`, `microsoft`, `dropbox`, `ticktick`, or give `tokenUrl`. Access tokens are cached in state.json until expiry. Getting a refresh token needs an OAuth client (Google Cloud console, Azure app registration, Dropbox app console, developer.ticktick.com) and one consent flow; the OAuth 2.0 Playground (https://developers.google.com/oauthplayground) works for Google with your own client. When the user does not want that, prefer the zero-auth routes: a folder destination inside the provider's desktop sync folder, `rclone`, or calendar feeds.

## Other files in ~/.course-context

| File | Content |
| --- | --- |
| `snapshot.json` | the last context document (cc/1) |
| `state.json` | last sync report, last good data per source, destination manifests and to-do id maps, OAuth token cache |
| `inbox/ID.json` | snapshots received from the browser extension or other computers |
| `logs/` | scheduler logs |
| `stage/` | rclone staging |
