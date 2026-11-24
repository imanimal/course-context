# Destinations

Every sync pushes to every enabled destination. A failing destination never blocks the others. `course-context types destinations` prints the live field list; `course-context dest test ID` is a dry run.

## File destinations (the rendered folder, docs/output.md)

| Type | Fields | Notes |
| --- | --- | --- |
| `folder` | `path` | Any local folder. Inside a desktop sync folder it reaches every device with zero extra auth: Google Drive for desktop (`~/Library/CloudStorage/GoogleDrive-*/My Drive`, Windows `G:\My Drive`), OneDrive, Dropbox, iCloud Drive, Box, Nextcloud, Syncthing. `doctor` lists the ones found. Also an Obsidian vault or a Logseq graph folder. |
| `rclone` | `remote` (`NAME:Folder`), `binary` | Any rclone backend: Google Drive, OneDrive, Dropbox, Box, iCloud Drive, S3, R2, B2, Wasabi, pCloud, MEGA, Proton Drive, SFTP, WebDAV and 60 more. The remote must exist (`rclone config`). Uses `rclone copy` and per-file deletes, never `rclone sync`. The bare remote root is refused. |
| `webdav` | `url`, `username`, `password` | Nextcloud (`https://HOST/remote.php/dav/files/USER/Course Context`), ownCloud, Synology, Koofr, Box WebDAV |
| `gdrive` | `token`, `folder`, `parentId` | Drive API v3, scope `drive.file`. Creates the folder, updates files in place, trashes removed files. |
| `onedrive` | `token`, `folder`, `appFolder` | Microsoft Graph; `appFolder: true` writes to Apps/YOUR-APP with `Files.ReadWrite.AppFolder` |
| `dropbox` | `token`, `folder` | Dropbox API v2, `files.content.write` |
| `git` | `path` (existing clone), `subdir`, `push` | Commits only real changes (timestamps alone don't commit), then pushes. Lets AI tools with a GitHub connector read it. |

Safety rules for file destinations:
- Only files listed in the destination manifest (`.course-context-manifest.json` in folders, `state.json` elsewhere) are overwritten or deleted.
- A folder destination refuses to overwrite a file it did not write (`DEST_CONFLICT`), and refuses the home directory and filesystem roots.
- Unchanged files are not rewritten.

## To-do apps

| Type | Fields | Get the credential |
| --- | --- | --- |
| `todoist` | `token`, `project` ("Course Context"), `labels` | Todoist → Settings → Integrations → Developer → API token |
| `google-tasks` | `token`, `list` | OAuth, scope `https://www.googleapis.com/auth/tasks` (docs/config.md#oauth) |
| `microsoft-todo` | `token`, `list` | Graph OAuth, `Tasks.ReadWrite` |
| `ticktick` | `token`, `region` (`ticktick` or `dida365`), `project` | https://developer.ticktick.com app, scopes `tasks:read tasks:write` |
| `notion` | `token`, `database`, `dataSource`, `properties` | Notion integration secret; share the database with the integration. Properties used when present: title, `Due` (date), `Done` (checkbox), `Class` (select or text), `URL` (url), `Priority` (select). Rename with `properties`. |
| `caldav` | `url` (task collection), `username`, `password` | iCloud (Apple Reminders) app-specific password; Nextcloud Tasks; Fastmail; Synology; Radicale; Thunderbird |
| `apple-reminders` | `list` | macOS only, no token; macOS asks once for permission to control Reminders |
| `things` | `tags` | macOS only, Things 3, no token |

Common fields: `prefixClass` (title starts with `[CODE]`, default true; Notion default false), `horizonDays` (default 60), `includeUndated` (default true), `classes` (only these classes).

Rules (src/destinations/todoengine.js):
1. Each open item (`todo` or `missing`) due within the horizon, or undated, becomes one task in a "Course Context" list or project.
2. Title, due date, notes and priority changes update the task.
3. When the item is submitted, graded, excused or marked done, the task is completed.
4. When the student completes the task in the app, the next sync marks the item done in `user.items` (`doneVia: "todo-app"`), so every AI, file and other app agrees.
5. Tasks the student deletes in the app are left alone. Tasks course-context did not create are never touched. Nothing is ever deleted.

Date handling: Google Tasks and Microsoft To Do store only the date; the due time goes into the task notes. Todoist, TickTick, CalDAV, Notion and Apple Reminders keep the time.

## Push to anything

| Type | Fields | Body |
| --- | --- | --- |
| `webhook` | `url`, `headers`, `includeContext`, `always` | POST on change: `{event: "course-context.updated", generatedAt, timezone, changes: {added[], changed[], completed[], removed[]}, todos[]}`; todo records: docs/api.md#todo. Works with Zapier, Make, n8n, IFTTT, Pipedream, Home Assistant, Slack or Discord bridges, your own app. |

| `server` | `url`, `token`, `snapshotId` | POST the whole context to another course-context server's `/v1/ingest/ID` when it changes (docs/self-host.md option 3) |

Pull-based integrations use the HTTP API instead (docs/api.md): `GET /v1/todo`, `GET /v1/calendar.ics` (subscribe from Google Calendar, Apple Calendar, Outlook, TickTick, Fantastical), `GET /v1/todo.ics`.

## Adding a destination

`course-context dest add TYPE --FIELD VALUE ...` then `course-context sync`. Examples:

```
course-context dest add folder --path "~/Library/CloudStorage/GoogleDrive-me@gmail.com/My Drive/Course Context"
course-context dest add rclone --remote "gdrive:Course Context"
course-context dest add todoist --token env:TODOIST_TOKEN
course-context dest add notion --token secret_xxx --database 0123456789abcdef0123456789abcdef
course-context dest add caldav --url https://cloud.example.com/remote.php/dav/calendars/me/tasks/ --username me --password app-password
course-context dest add webhook --url https://hooks.zapier.com/hooks/catch/123/abc/
```
