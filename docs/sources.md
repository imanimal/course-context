# Sources

A source turns one service into classes, items and announcements. All sources are read-only. `course-context types sources` prints the live field list. Run order: LMS sources first (their links tell WeBWorK and Gradescope which courses to read), then calendar feeds, then apps.

## Which source to use

| School system | Best | Without an API token |
| --- | --- | --- |
| Canvas | `canvas` with a token | `ics` (Calendar → Calendar Feed) for dates; the browser extension for everything |
| Moodle | `moodle` with the mobile web service key | `ics` (Calendar → Export) |
| Google Classroom | `classroom` with an OAuth token | `ics` per class (the class's Google Calendar secret iCal address) |
| Schoology | `schoology` with a consumer key | `ics` (Calendar → iCal feed) |
| Brightspace / D2L | `ics` (Calendar → Subscribe) | same |
| Blackboard Learn / Ultra | `ics` (Calendar → Share calendar) | same |
| Sakai | `ics` (Calendar → Subscribe) | same |
| WeBWorK | `webwork` (username + password, or discovered from Canvas links) | extension (LTI-only WeBWorK) |
| Gradescope | `gradescope` (email + password, or cookie) | extension (school SSO) |
| Anything else | `ics`, `url`, `command`, `module`, `manual` | |

## canvas

Fields: `host` (required, e.g. `school.instructure.com` or a custom domain), `token` or `cookie`, `courses` (`"active"` default, `"all"`, or `[ids]`), `announcementDays` (14), `modules` (true: read module links for app discovery).

Getting a token (tell the user): Canvas → Account → Settings → Approved Integrations → New Access Token → purpose "Course Context", no expiry → copy the token (shown once). Some schools hide this button; then use `ics` and the extension. A 403 on every call (`AUTH_FORBIDDEN`) also means tokens are blocked.

Reads: courses (term, teachers, current score and grade, syllabus), assignments with the student's submission (status, score, missing, late, excused), assignment groups (weights when the course uses weights), modules (external links), planner items (pages with to-do dates, ungraded discussions, calendar events, Canvas planner notes), announcements. Ids: `canvas:HOST/assignment/ID`, `canvas:HOST/course/ID`.

## ics

Fields: `url` (required; `https://` or `webcal://`; treated as a secret), `class` (put every event in this class), `lms` (override detection), `events` (keep non-deadline events), `timezone`.

LMS detection from the URL: instructure.com or `/feeds/calendars/user_` → canvas; `/calendar/export_execute.php` → moodle; `/d2l/le/calendar/feed` → brightspace; `calendarFeed`/blackboard → blackboard; schoology.com → schoology; `/direct/calendar/` → sakai; calendar.google.com → google; outlook → outlook.

Class detection per event: trailing `[CODE]` in the summary (Canvas), `CATEGORIES` (Moodle), `LOCATION` (Brightspace, Blackboard), else the `class` field. Codes match LMS classes by whole-word course code. Canvas feed events carry assignment ids, so a Canvas feed next to the Canvas API never duplicates items.

## webwork

Fields: `url` (`https://HOST/webwork2/COURSE/`), `courses` (list), `username`, `password`, `cookie`, `discover` (true: also read every WeBWorK course Canvas links to), `timezone` (for dates printed without a zone).

Reads the course home set table: open date, due date, reduced-credit date, closed. Courses that only open from the LMS (LTI) print "You must access assignments from your Course Management System"; the source then reads set pages it knows from Canvas links, or raises `LMS_ONLY` (use the extension). Sets merge into the Canvas assignment that links to them, or by title ("Homework_5" = "HW 5").

## gradescope

Fields: `email` + `password` (accounts with a Gradescope password), or `cookie` (`signed_token=...; remember_me=...` from a signed-in browser), `terms` (`latest` default, `all`). Reads `/account` and each course's assignment table: release, due, late due, submitted, score. School-SSO accounts: cookie or extension.

## moodle

Fields: `url` (site), `token` (Preferences → Security keys → "Moodle mobile web service"), or `username` + `password` (traded for a token at `/login/token.php`, service `moodle_mobile_app`; some sites disable this). Reads enrolled courses, assignments with submission status (for those due within the window), the timeline (quizzes, forums, workshops) and course grades.

## classroom

Field: `token` (OAuth with scopes `classroom.courses.readonly`, `classroom.coursework.me.readonly`, `classroom.announcements.readonly`; use an oauth refresh object, docs/config.md#oauth). Reads active courses, course work with the student's submission state, announcements.

## schoology

Fields: `key`, `secret` (consumer key and secret from `https://SCHOOL.schoology.com/api`), `domain` (for links). Two-legged OAuth 1.0a. Reads sections, assignments, updates.

## Escape hatches

| Type | Fields | Use |
| --- | --- | --- |
| `manual` | `path` (JSON file) or `data` (inline) | work the student tracks by hand; another AI can maintain the file |
| `command` | `command`, `timeoutSeconds` | any program that prints source JSON (scrapers for PrairieLearn, zyBooks, Pearson, McGraw Hill, Ed, Piazza, ...) |
| `url` | `url`, `headers` | an HTTP endpoint returning source JSON or a cc/1 context |
| `snapshot` | `path` or `url`, or nothing (reads `inbox/ID.json`) | merge another context.json: the browser extension, another computer |
| `module` | `path` | a JS module exporting `{ fetch(cfg, ctx) }` |

## Source JSON

```json
{
  "classes": [ { "code": "CHEM 1A", "name": "General Chemistry", "url": "https://...", "instructors": ["Dr. Curie"] } ],
  "items": [ { "title": "Lab report 3", "class": "CHEM 1A", "due": "2026-12-02T17:00", "kind": "lab", "url": "https://...", "points": 20, "status": "todo", "summary": "..." } ],
  "announcements": [ { "title": "Room change", "class": "CHEM 1A", "postedAt": "2026-11-20T09:00", "body": "..." } ]
}
```

Dates: ISO with offset, or local time in the config zone, or `YYYY-MM-DD` (11:59 PM). `class` matches existing classes by code; unmatched codes become classes. Optional item fields: `id` (stable id; default derived from class and title), `kind`, `status` (`todo`, `submitted`, `graded`, `missing`, `late`, `excused`, `closed`), `score`, `unlockAt`, `lockAt`, `links[] {label, url}`, `refs[]` (ids of the same work in other sources, for merging).

## Writing a module source

```js
// my-source.js
export default {
  async fetch(cfg, ctx) {
    const r = await ctx.http.request("https://example.edu/api/work", { headers: { Authorization: "Bearer " + await ctx.secret(cfg.token) } });
    const list = await r.json();
    return { items: list.map((w) => ({ title: w.name, class: w.course, due: w.deadline, url: w.link })) };
  },
};
```

`ctx`: `http.request(url, {method, headers, body, form, json})`, `secret(ref)`, `tz`, `now`, `warn(msg)`, `hints()` (links found by LMS sources), `readFile`, `exec`.
