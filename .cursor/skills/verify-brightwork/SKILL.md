---
name: verify-brightwork
description: Drive Brightwork’s web workbench and Pip computer control with Playwright; use when proving user-visible behavior, capturing screenshots, or verifying Pip use_computer motion.
---

# Verify Brightwork

Primary surface: React web app (`apps/web`) at `APP_ORIGIN`, backed by Fastify (`apps/api`) and the Pip worker (`apps/worker`). Secondary surfaces: Fastify `/health` and `/api/*`, Mailpit when SMTP is pointed there. This skill is for agents proving live behavior, not fixture unit tests.

## Launch

Docker Compose is preferred when available (`docker compose up -d --wait`). On hosts without Docker, use local Postgres on `127.0.0.1:5432` and Redis on `127.0.0.1:6379` with a disposable database and Redis logical DB. Never migrate or drive the shared `.env` database for verification.

```sh
# Keep S3/SMTP unset or pointed at disposable services; do not use production keys.
.cursor/skills/verify-brightwork/scripts/launch.sh
# Exports VERIFY_ROOT, VERIFY_DB, APP_ORIGIN, API_PORT, DATABASE_URL, REDIS_URL, PERSONAL_MODE, AUTH_SECRET
```

Ready when `GET $APP_ORIGIN/health` returns `{"status":"ok"}` and `$APP_ORIGIN/en` shows the marketing landing (or `$APP_ORIGIN/home` resolves a session without an error shell in personal mode). Vite uses `strictPort: true` and takes its port from `APP_ORIGIN`; a mismatch with `API_PORT` causes `403 This request must come from Brightwork`. Prefer `scripts/launch.sh` so PID files record the listening processes (not a short-lived `pnpm` wrapper).

For Pip computer motion without the full stack, run `.cursor/skills/verify-brightwork/scripts/verify-computer-motion.mjs` (see Helpers). That path does not start API/Vite.

## Doctor

Run `.cursor/skills/verify-brightwork/scripts/doctor.sh` before driving. It must confirm:

- `git rev-parse HEAD` is recorded
- API and Vite ports are owned by this run’s PIDs (refuse shared/pre-existing listeners)
- `GET $APP_ORIGIN/health` is ok
- `DATABASE_URL` names `bw_verify_*` and is not the `.env` database
- `REDIS_URL` uses disposable logical DB `14` (or another unused DB recorded in the run note)

Refuse to drive if doctor fails.

## Drive

Prefer Playwright against the owned `APP_ORIGIN`:

```sh
pnpm exec playwright test --config=playwright.config.ts --project=chromium
# or ad-hoc:
pnpm exec playwright open "$APP_ORIGIN/en"
```

CLI wrapper: `~/.codex/skills/playwright/scripts/playwright_cli.sh` when available. Snapshot before clicking. Prefer ARIA names and routes (`/en` for marketing landing, `/new`, `/f/:businessId`, `/f/:businessId/build`; SPA `/home` is invitations/redirect only) over coordinates.

Pip computer: use `scripts/verify-computer-motion.mjs` for navigate/move/click/type/key/scroll/screenshot with frame PNGs and a short MP4. Workbench chat will only expose `use_computer` when the worker runs with `COMPUTER_ENABLED=true` and a model that proposes the tool; motion proof for the control surface itself uses the helper.

Feature recipes live under `features/`. Drive from the map; do not invent alternate entry points and call them verified.

## Evidence

Store proof under `output/verify-brightwork/<run-id>/`. Keep:

- Action + resulting state screenshots (not only the final frame)
- ARIA or DOM snapshot for UI journeys
- API request method/path/status when a write is claimed
- Computer frames: `computer-01-*.png` … plus `computer-motion.mp4` when ffmpeg is available
- `note.md` with feature ID, entry point, SHA, doctor result

Proof standards: real user path; capture before/after; verify side effects; mocks only at existing production boundaries.

## Cleanup

Stop only PIDs in `$VERIFY_ROOT/api.pid` and `$VERIFY_ROOT/web.pid` (and any worker PID this run started). Drop only `bw_verify_<run-id>` after confirming the exact name. Do not flush Redis DB 14 unless this run exclusively owns it. Never delete evidence under `output/verify-brightwork/`.

```sh
.cursor/skills/verify-brightwork/scripts/cleanup.sh
```

## Helpers

| Script | Purpose |
| --- | --- |
| `scripts/launch.sh` | Create disposable DB env, migrate, start API+Vite, write PID files |
| `scripts/doctor.sh` | Read-only health/ownership check |
| `scripts/cleanup.sh` | Tear down owned PIDs + disposable DB |
| `scripts/verify-computer-motion.mjs` | Drive Pip computer actions; write motion PNGs/MP4 |
| `scripts/drive-ui.mjs` | Serial Playwright drive of landing → `/new` → workbench → Build |

```sh
NODE_PATH="$(pwd)/node_modules" pnpm --filter @brightwork/worker exec tsx \
  ../../.cursor/skills/verify-brightwork/scripts/verify-computer-motion.mjs \
  --out "output/verify-brightwork/$RUN_ID" \
  --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Writes stamped PNG frames, `computer-frames.json`, `computer-motion.html`, and `computer-motion.mp4` when a full ffmpeg is on PATH (falls back to Playwright’s VP9 WebM otherwise).

```sh
# After launch + doctor, in the same shell (background servers may not outlive the tool session):
NODE_PATH="$(pwd)/node_modules" pnpm --filter @brightwork/worker exec tsx \
  ../../.cursor/skills/verify-brightwork/scripts/drive-ui.mjs
```

`drive-ui.mjs` writes `landing-home.png`, `workspace-*.png`, `workbench-home.png`, `build-shell.png`, and `drive-ui.json`.
