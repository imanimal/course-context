# Browser extension

Folder: `extension/` (Manifest V3; Chrome, Edge, Brave, Arc, Opera, Firefox 121+). It runs the same source and render code as the CLI (`extension/lib` is copied from `src/core` and `src/sources` by `npm run build:extension`; CI checks they match).

## When to use it

- The school disables Canvas access tokens (`AUTH_FORBIDDEN`, or no "New Access Token" button).
- WeBWorK only opens from Canvas (`LMS_ONLY`).
- Gradescope uses school sign-in (no password).
- The student does not want to hand a token to anything.

It reads with the student's existing browser sign-in, so nothing extra to authorize beyond allowing the sites.

## Install (unpacked, until store listings exist)

Chrome / Edge / Brave: `chrome://extensions` → Developer mode → Load unpacked → the `extension` folder (`$(npm root -g)/course-context/extension` after `npm install -g course-context`).
Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `extension/manifest.json` (temporary until signed builds are published).

## Options

| Setting | Meaning |
| --- | --- |
| Canvas address | adds a Canvas host; the browser asks to allow that site |
| Calendar feed links | any `ics` feed |
| Read WeBWorK sets that Canvas links to | asks for access to all https sites (WeBWorK hosts vary by school) |
| Read Gradescope | gradescope.com |
| The Course Context app on this computer | POST to `http://127.0.0.1:8787/v1/ingest/browser` with the token from `course-context server token`; needs `course-context service install` (or `serve`) running |
| Your own server | same POST to a self-hosted server (docs/self-host.md) |
| Also save the files to Downloads/Course Context | writes the rendered folder through the browser's downloads (point the browser's download folder into a synced drive to sync it) |
| Sync every | minutes between syncs (alarm) |

The context the extension sends becomes source `snapshot` id `browser` in the CLI, merged with any CLI sources and the student's layer, then pushed to every destination.
