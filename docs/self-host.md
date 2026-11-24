# Self-hosting

Three ways to make the API and MCP endpoint reachable from phones and web chatbots. All serve the same routes (docs/api.md). The token (`course-context server token`) protects every data route.

## 1. Your computer plus a tunnel (data never leaves your computer except through the tunnel)

```
course-context service install
cloudflared tunnel --url http://localhost:8787
```

`service install` keeps `serve` running from login (launchd, systemd user service, Task Scheduler). The tunnel prints an `https://....trycloudflare.com` URL; for a fixed URL use a named Cloudflare tunnel, `tailscale funnel 8787`, or `ngrok http 8787 --domain=...`. Then:

```
course-context connect remote --public-url https://YOUR-URL
```

Works only while the computer is on.

## 2. Docker on any server (always on)

```
docker run -d --name course-context -p 8787:8787 \
  -v course-context:/data \
  -e COURSE_CONTEXT_TOKEN=change-me-to-a-long-random-string \
  -e COURSE_CONTEXT_SYNC_EVERY=30 \
  ghcr.io/imanimal/course-context:latest
```

The image is published by the release workflow. Before the first release, build it: `docker build -t course-context .` in the repository and use `course-context` as the image name. Then add sources inside the container:

```
docker exec course-context course-context source add canvas --host school.instructure.com --token TOKEN
docker exec course-context course-context sync
```

`docker-compose.yml` in the repository does the same. Data lives in the `/data` volume (`COURSE_CONTEXT_HOME=/data`). Put HTTPS in front (Caddy, Traefik, the host's proxy) or use a platform that provides it.

Platforms that run the image as is (set the two environment variables and a volume or disk at `/data`): Fly.io (`fly launch` with the Dockerfile; mount a volume), Render (Docker web service plus a disk), Railway, Google Cloud Run (no persistent disk: use `--from URL` read-only mode or push snapshots), a Raspberry Pi, a NAS (Synology, Unraid) or any VPS.

## 3. Push from your computer, serve elsewhere

Run sources on your computer (where your sign-ins and the extension are) and only serve on the server:

On the server: `course-context serve --host 0.0.0.0` (Docker as above, no sources).
On your computer: `course-context dest add server --url https://SERVER --token SERVER_TOKEN`

The server stores each pushed context as a `snapshot` source and serves it. The browser extension can push to the same server (its options: "Your own server").

## Read-only mirrors

`course-context serve --from "/path/to/Course Context"` or `--from https://SERVER/k/TOKEN/v1/context` serves any snapshot without sources or credentials: a second computer that only sees the synced folder, or a public demo.

## Hardening checklist

- Long random token (the default is 32 random bytes, base64url). Rotate with `server token --rotate`.
- HTTPS in front of anything not on localhost.
- `--read-only` when nobody needs write tools.
- The server never stores school passwords unless you add password-based sources to it; prefer running sources on your own computer (option 3).
