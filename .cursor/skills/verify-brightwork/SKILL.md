---
name: verify-brightwork
description: Drive Brightwork readiness, web workbench, and Pip with HTTP/Playwright helpers; use when proving health/readiness, mapped features, the pip-core-journey, screenshots, or Pip use_computer motion.
---

# Verify Brightwork

Primary surface: React web app (`apps/web`) at `APP_ORIGIN`, backed by Fastify (`apps/api`) and the Pip worker (`apps/worker`). API-only checks use Fastify `/health` and `/ready` without starting Vite or the worker. Mailpit is available when SMTP points to it. This skill proves live behavior, not fixture-only unit tests.

Default local model for Pip proofs: Ollama **`qwen2.5:7b-instruct`** at `http://127.0.0.1:11434` with 8GB-safe token/ctx caps (`LLM_MAX_TOKENS=1536`, `LLM_PAGE_MAX_TOKENS=3072`, `LLM_NUM_CTX=4096`).

## Launch

Docker Compose is preferred when available (`docker compose up -d --wait`). On hosts without Docker, use local Postgres on `127.0.0.1:5432` and Redis on `127.0.0.1:6379` with a disposable database and Redis logical DB **14**. Never migrate or drive the shared `.env` database for verification. Refuse ports that are already listening. Launch takes `output/verify-brightwork/.redis14.lock` so only one live stack owns Redis DB 14; `preflight-kill.sh` skips when that lock is held unless `VERIFY_FORCE_PREFLIGHT=1`.

```sh
# Keep S3/SMTP unset or pointed at disposable services; do not use production keys.
# Requires ollama serve + `ollama pull qwen2.5:7b-instruct` for Pip journey proofs.
.cursor/skills/verify-brightwork/scripts/preflight-kill.sh   # clear foreign api/worker
VERIFY_SKIP_VITE=1 .cursor/skills/verify-brightwork/scripts/launch.sh  # Pip journey, API+worker
# Or omit VERIFY_SKIP_VITE for full API+worker+Vite (UI features).
# API readiness only: VERIFY_SKIP_VITE=1 VERIFY_SKIP_WORKER=1 launch.sh
# Exports VERIFY_ROOT, VERIFY_DB, APP_ORIGIN, API_PORT, DATABASE_URL, REDIS_URL,
# PERSONAL_MODE, AUTH_SECRET, SITE_BASE_DOMAIN, LLM_* , VERIFY_API_BASE
```

For API readiness, `GET $VERIFY_API_BASE/health` must return `{"status":"ok"}` and `GET $VERIFY_API_BASE/ready` must return `{"status":"ready"}`. For UI proofs, `$APP_ORIGIN/health` must be healthy, the worker PID must be alive, and `$APP_ORIGIN/en` must show the landing page or `$APP_ORIGIN/home` must resolve a session without an error shell in personal mode. Vite uses `strictPort: true` and takes its port from `APP_ORIGIN`; a mismatch with `API_PORT` causes `403 This request must come from Brightwork`. PID files store detached process-group leaders, and doctor checks that listening processes belong to those groups.

Default ports: Vite `5188`, API `3018`, publish host `$artifactId.127.0.0.1.nip.io:3018`, Redis DB `14`. Launch reads only `VERIFY_*` overrides (not ambient `API_PORT` / `LLM_*` from a parent shell), so a dirty journey environment cannot hijack the disposable stack. Refuse concurrent workers or API restart loops on Redis DB 14; they poison the queue and can kill the owned stack mid-drive.

For Pip computer motion without the full stack, run `.cursor/skills/verify-brightwork/scripts/verify-computer-motion.mjs` (see Helpers). That path does not start API/Vite.

## Doctor

Run `.cursor/skills/verify-brightwork/scripts/doctor.sh` before driving. It must confirm:

- `git rev-parse HEAD` is recorded
- API, Vite, and (when present) worker ports/PIDs are owned by this run (refuse shared/pre-existing listeners)
- `GET $APP_ORIGIN/health` is ok
- `GET $VERIFY_API_BASE/ready` is ready unless `VERIFY_EXPECT_READY=0`
- `DATABASE_URL` names `bw_verify_*` and is not the `.env` database
- `REDIS_URL` uses disposable logical DB `14`
- Ollama exposes `LLM_MODEL` (default `qwen2.5:7b-instruct`) unless `VERIFY_REQUIRE_OLLAMA=0`

Refuse to drive if doctor fails.

## Drive

Prefer Playwright against the owned `APP_ORIGIN` for shell UI features:

```sh
pnpm exec playwright test --config=playwright.config.ts --project=chromium
# or ad-hoc:
pnpm exec playwright open "$APP_ORIGIN/en"
```

CLI wrapper: `~/.codex/skills/playwright/scripts/playwright_cli.sh` when available. Snapshot before clicking. Prefer ARIA names and routes (`/en` for marketing landing, `/new`, `/f/:businessId`, `/f/:businessId/build`; SPA `/home` is invitations/redirect only) over coordinates.

**Pip core journey** (plan → build → publish → live → ask/answer → change approve): after launch+doctor, run `scripts/drive-pip-journey.mjs` (see Helpers). It uses the same Vite-proxied `/api/*` routes as the workbench.

Pip computer: use `scripts/verify-computer-motion.mjs` for navigate/move/click/type/key/scroll/screenshot with frame PNGs and a short MP4. Workbench chat will only expose `use_computer` when the worker runs with `COMPUTER_ENABLED=true` and a model that proposes the tool; motion proof for the control surface itself uses the helper.

Feature recipes live under `features/`. Machine-readable index: `features/map.json`. Lookup: `pnpm verify:feature <id>` or `pnpm verify:feature --list`. Drive from the map; do not invent alternate entry points and call them verified. `pnpm verify:doctor` runs `scripts/doctor.sh` and requires launch env (`VERIFY_ROOT`, `APP_ORIGIN`, …).

API readiness uses `scripts/drive-ready.mjs`. The optional marketing gallery uses `scripts/drive-gallery.mjs` against the owned `APP_ORIGIN`. `pnpm verify:invariants` runs the focused credit and vault regression gate. Keep API-only checks opt-in with `VERIFY_SKIP_WORKER=1`; mapped Pip journeys require the worker and Ollama.

## Evidence

Store proof under `output/verify-brightwork/<run-id>/`. Keep:

- Action + resulting state screenshots (not only the final frame)
- ARIA or DOM snapshot for UI journeys
- API request method/path/status when a write is claimed
- Journey JSON: `drive-pip-journey.json`, `live-home.html`, approve/publish/answer artifacts
- Capability JSON: `drive-pip-capability.json`, Run view payloads, `catalog.json`, `memory-search.json`
- Computer frames: `computer-01-*.png` … plus `computer-motion.mp4` when ffmpeg is available
- `note.md` with feature ID, entry point, SHA, doctor result

Proof standards: real user path; capture before/after; verify side effects; mocks only at existing production boundaries. PERSONAL_MODE is not a substitute for real email/OAuth signup proof.

## Cleanup

Stop only the process groups recorded in `$VERIFY_ROOT/api.pid`, `$VERIFY_ROOT/web.pid`, and `$VERIFY_ROOT/worker.pid`. Drop only `bw_verify_<run-id>` after confirming the exact name. Do not flush Redis DB 14 unless this run exclusively owns it. Never delete evidence under `output/verify-brightwork/`.

```sh
set -a && source "$VERIFY_ROOT/launch.env" && set +a
.cursor/skills/verify-brightwork/scripts/cleanup.sh
```

## Helpers

| Script                               | Purpose                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `scripts/preflight-kill.sh`          | SIGKILL leftover api/worker on verify ports before launch (skips if Redis DB 14 lock held) |
| `scripts/redis14-lock.sh`            | Shared lock helpers for exclusive Redis DB 14 ownership                                    |
| `scripts/launch.sh`                  | Disposable DB, migrate, API+worker(+Vite), Ollama LLM env, PID + launch.env                |
| `scripts/doctor.sh`                  | Read-only health/ownership/Ollama check                                                    |
| `scripts/cleanup.sh`                 | Tear down owned PIDs + disposable DB                                                       |
| `scripts/drive-pip-journey.mjs`      | Full Pip journey proof (qwen2.5:7b-instruct)                                               |
| `scripts/drive-pip-capability.mjs`   | Run power, Run views, memory search, tool catalog (deterministic API)                      |
| `scripts/drive-ui.mjs`               | Serial Playwright drive of landing → `/new` → workbench → Build                            |
| `scripts/drive-polish.mjs`           | Legal pages, Home metrics, Settings modal (`workbench-polish`)                             |
| `scripts/verify-computer-motion.mjs` | Drive Pip computer actions; write motion PNGs/MP4                                          |
| `scripts/verify-feature.mjs`         | `pnpm verify:feature` map lookup / smoke                                                   |
| `scripts/drive-ready.mjs`            | Capture `/health` and `/ready` response evidence                                           |
| `scripts/drive-gallery.mjs`          | Prove `/dev/ui` identity and Vite `/health` proxy                                          |

```sh
VERIFY_SKIP_VITE=1 .cursor/skills/verify-brightwork/scripts/launch.sh
set -a && source "$VERIFY_ROOT/launch.env" && set +a
.cursor/skills/verify-brightwork/scripts/doctor.sh
NODE_PATH="$(pwd)/node_modules" node \
  .cursor/skills/verify-brightwork/scripts/drive-pip-journey.mjs
```

`VERIFY_SKIP_VITE=1` keeps API+worker only (API restart loop) and the driver uses `VERIFY_API_BASE` with the workbench `Origin` header. Use a full Vite launch for UI features (`drive-ui.mjs`).

```sh
# Pass an absolute --out (pnpm --filter runs with apps/worker as cwd).
NODE_PATH="$(pwd)/node_modules" pnpm --filter @brightwork/worker exec tsx \
  ../../.cursor/skills/verify-brightwork/scripts/verify-computer-motion.mjs \
  --out "$(pwd)/output/verify-brightwork/$RUN_ID" \
  --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

```sh
NODE_PATH="$(pwd)/node_modules" pnpm --filter @brightwork/worker exec tsx \
  ../../.cursor/skills/verify-brightwork/scripts/drive-ui.mjs
```

`drive-ui.mjs` writes `landing-home.png`, `workspace-*.png`, `workbench-home.png`, `build-shell.png`, and `drive-ui.json`.

```sh
NODE_PATH="$(pwd)/node_modules" node \
  .cursor/skills/verify-brightwork/scripts/drive-polish.mjs
```

`drive-polish.mjs` writes `legal-*.png`, `polish-home-metrics.png`, `polish-settings-modal.png`, and `drive-polish.json`. Optional `VERIFY_BUSINESS_ID` reuses a workspace.

```sh
pnpm verify:invariants
```
