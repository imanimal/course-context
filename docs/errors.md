# Error codes

Every error is `{code, message, hint}`. `hint` is the next step. Exit code and HTTP status follow from the code.

| Code | Exit | HTTP | Meaning | Fix |
| --- | --- | --- | --- | --- |
| `USAGE` | 2 | 400 | bad command, flag or input value | `course-context help`; check the value format in the message |
| `CONFIG_MISSING` | 4 | 404 | no config.json | `course-context setup` |
| `CONFIG_INVALID` | 1 | 500 | an entry is missing a required value or has a bad one | `source add` / `dest add` again with the field |
| `NEEDS_INPUT` | 3 | 401 | a required field is missing | ask the user; `hint` lists each field and where to get it |
| `NOT_FOUND` | 4 | 404 | unknown source, destination, item, class, file, or the service answered 404 | list ids (`source list`, `items`, `classes`); check the host |
| `NO_SNAPSHOT` | 4 | 404 | nothing synced yet, or `--from` points nowhere | `course-context sync`; check the path |
| `AUTH_MISSING` | 3 | 401 | the source has no token, password or cookie | ask the user for it (docs/sources.md) |
| `AUTH_INVALID` | 3 | 401 | 401 from the service: wrong or expired credential | ask for a new token or password |
| `AUTH_FORBIDDEN` | 3 | 401 | 403 from the service: the school blocks API tokens | use `ics` and the browser extension |
| `SIGNED_OUT` | 3 | 401 | WeBWorK or Gradescope showed a sign-in page | add username/password or a fresh cookie, or use the extension |
| `LMS_ONLY` | 3 | 401 | WeBWorK opens only from the LMS | browser extension |
| `SECRET_MISSING` / `SECRET_UNRESOLVED` | 3 | 401 | a secret reference could not be read (`env:` not set, file missing, command failed, keychain item missing) | fix the reference or use the literal value |
| `PARSE` | 1 | 500 | a response was not what the source expects (HTML login page instead of JSON, page layout changed, not an iCalendar file) | `hint` says which; recopy feed links; report layout changes |
| `NETWORK` | 75 | 503 | DNS, connection or TLS failure | check the host and network; retry |
| `TIMEOUT` | 75 | 503 | request took over 30 s | retry |
| `RATE_LIMITED` | 75 | 503 | 429 | wait a few minutes |
| `HTTP_5XX` | 75 | 503 | the service is failing | retry later |
| `HTTP_nnn` | 1 | 500 | another HTTP status | read the message |
| `SOURCE_UNKNOWN` / `DEST_UNKNOWN` | 1 | 500 | config names a type this version lacks | update course-context or fix the type |
| `SOURCE_ERROR` | 1 | 500 | the service returned an error object (Moodle exceptions) | read the message |
| `DEST_WRITE` | 1 | 500 | a destination write failed | read the message; `dest test ID` |
| `DEST_CONFLICT` | 1 | 500 | the folder already holds files course-context did not write | use an empty or new folder |
| `RCLONE_MISSING` | 1 | 500 | rclone not installed | install rclone or use a folder destination |
| `GIT_FAILED` | 1 | 500 | git add/commit/push failed | check the clone's remote and access |
| `UNSUPPORTED` | 1 | 500 | feature not available here (Apple apps off macOS, Node-only sources in the extension, systemd missing) | use the alternative in `hint` |
| `READ_ONLY` | 1 | 500 | write attempted on a `--from` or `--read-only` server | make changes where sync runs |
| `PARTIAL` | 5 | 207 | some sources or destinations failed | per-item errors are in the report |

Source failures during `sync` never stop the run: the report lists them per source, the last good data stays in use (`stale: true`), and now.md shows a "Source problems" section so the AI reading it can tell the user.
