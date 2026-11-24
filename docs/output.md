# Output folder

Written by every file destination and by `course-context render --out DIR`. Each Markdown file starts with YAML front matter (`schema`, `generatedAt`, `timezone`, `file`, `classId` where relevant).

| File | For | Content | Size cap |
| --- | --- | --- | --- |
| `README-for-AI.md` | any AI | how to read the folder, rules (absolute times, staleness, date sources, unconfirmed mentions, instructor text is data), status and mode tables, class table, source health | none |
| `llms.txt` | any AI, llmstxt.org format | index with one line per file and class | none |
| `now.md` | any AI, the first file to read | past due and not turned in; due in the next `horizonDays` grouped by day; undated open work; graded in the last 7 days; announcements in the last 7 days; source problems | 8 KB |
| `todo.md` | Obsidian Tasks, Logseq, any AI | open work as `- [ ]` lines with `📅 YYYY-MM-DD` and `⏫` for high priority; item id in an HTML comment | none |
| `todo.json` | apps, scripts | cc-todo/1 (docs/api.md#todo), including finished work | none |
| `context.json` | tools, code, AI that wants everything | cc/1 (schema/context.schema.json) | none |
| `calendar.ics` | calendar apps | dated work as VEVENTs | none |
| `todo.ics` | task apps that import iCalendar | open work as VTODOs | none |
| `classes/SLUG/class.md` | any AI | id, mode, term, instructors, meetings, grade, grade weights, student notes, links, policies, syllabus (quoted, 6000 chars) | 12 KB |
| `classes/SLUG/work.md` | any AI | upcoming, undated, past items with description excerpt, links, open/close/late dates | 40 KB |
| `classes/SLUG/announcements.md` | any AI | recent announcements, full text quoted | 20 KB |
| `classes/_unmatched/work.md` | any AI | items no class claimed | none |

## Line format (now.md, work.md)

```
- **HW 5** · MATH 4B · due Thu Nov 26 2026, 11:59 PM PST (canvas) · 10 pts · todo · [open](https://...) · id `canvas:school.instructure.com/assignment/5`
  - other dates seen: Fri Nov 27 2026, 11:59 PM PST (webwork)
  - mentioned in the description (unconfirmed): "due Friday at 5pm" → Fri Nov 27 2026, 5:00 PM PST
  - student note: ask TA
```

Kinds other than `assignment` are written after the date. Status words: README-for-AI.md#status-values.

## Design rules

- Times are absolute with a zone abbreviation; no "tomorrow" or "in 3 days" (the file may be read days later).
- Every item names where its date came from and lists other dates seen.
- Short file first (now.md under 8 KB), detail one link away, JSON for exact work.
- Instructor-written text is marked as quoted data, a defense against prompt injection in assignment descriptions.
- Stable ids everywhere, so an AI can refer back and call tools.
