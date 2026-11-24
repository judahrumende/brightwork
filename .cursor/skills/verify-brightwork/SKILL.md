---
name: verify-brightwork
description: Drive Brightwork’s Fastify readiness surface and web app with HTTP/Playwright helpers; use when proving /health, /ready, invariant gates, or user-visible workbench behavior on a disposable local stack.
---

# Verify Brightwork

Primary surface for this skill’s baseline proof: Fastify HTTP at `VERIFY_API_BASE` (`GET /health`, `GET /ready`). Secondary surface: Vite web app at `APP_ORIGIN` when launched. Worker proofs need a real `LLM_API_KEY` and are opt-in. This skill is for agents proving live behavior, not fixture-only unit tests.

Interview notes for this checkout: Docker Compose is often unavailable on the operator Mac (`docker compose` missing / daemon down). Prefer local Postgres peer auth (`createdb`) and Redis on `127.0.0.1:6379` with disposable DB name `bw_verify_*` and Redis logical DB **14**. Never migrate or drive the shared product `.env` database.

## Launch

```sh
# API-only readiness stack (default for api-readiness). Leaves S3_ENDPOINT unset so /ready can pass without MinIO.
VERIFY_SKIP_VITE=1 VERIFY_SKIP_WORKER=1 \
  .cursor/skills/verify-brightwork/scripts/launch.sh
# Writes $VERIFY_ROOT/launch.env and prints VERIFY_ROOT=...
```

Ready when `GET http://127.0.0.1:$API_PORT/health` returns `{"status":"ok"}` and `GET .../ready` returns `"status":"ready"` with postgres and redis checks ok.

Full web launch (Vite + API; still skip worker unless you set keys):

```sh
VERIFY_SKIP_WORKER=1 .cursor/skills/verify-brightwork/scripts/launch.sh
```

Default ports: API `3028`, Vite `5199`, Redis DB `14`. Override with `VERIFY_API_PORT` / `VERIFY_APP_ORIGIN`. Launch refuses ports already listening. It ignores ambient `DATABASE_URL` / `S3_*` from a dirty shell except `VERIFY_*` overrides.

## Doctor

```sh
set -a && source "$VERIFY_ROOT/launch.env" && set +a
.cursor/skills/verify-brightwork/scripts/doctor.sh
```

Doctor must confirm:

- `git rev-parse HEAD` recorded under `$VERIFY_ROOT/doctor.txt`
- `DATABASE_URL` names `bw_verify_*` and is not a shared `brightwork` DB
- `REDIS_URL` ends with `/14`
- Owned `api.pid` (and `web.pid` when present) are alive and own their listen ports
- `/health` is ok
- `/ready` is `ready` when `VERIFY_EXPECT_READY=1` (default for API-only launches without `S3_ENDPOINT`)

Refuse to drive if doctor fails.

## Drive

HTTP readiness uses `scripts/drive-ready.mjs`. Marketing gallery uses `scripts/drive-gallery.mjs` against the owned `APP_ORIGIN` when Vite was launched.

Feature recipes live under `features/`. Drive from the map. Do not invent alternate entry points and call them verified.

```sh
set -a && source "$VERIFY_ROOT/launch.env" && set +a
pnpm verify:ready
pnpm verify:gallery
```

Invariant gate (no live server required for the unit portion):

```sh
pnpm verify:invariants 2>&1 | tee "$VERIFY_ROOT/invariants.log"
```

## Evidence

Store proof under `output/verify-brightwork/<run-id>/`. Keep:

- `ready.json` and `health.json` response bodies
- `drive-ready.json` with status codes and check names
- `doctor.txt`
- `note.md` with feature ID, entry point, SHA, doctor result
- For UI journeys: screenshots + ARIA snapshots with Brightwork identity visible

Proof standards: exercise the real HTTP or user path; capture action and resulting state; verify side effects; mocks only at existing production boundaries. Do not claim `/ready` ready if MinIO was required and down.

## Cleanup

Stop only PIDs in `$VERIFY_ROOT/api.pid`, `$VERIFY_ROOT/web.pid`, and `$VERIFY_ROOT/worker.pid`. Drop only `bw_verify_<run-id>` after confirming the exact name. Never delete evidence under `output/verify-brightwork/`.

```sh
set -a && source "$VERIFY_ROOT/launch.env" && set +a
.cursor/skills/verify-brightwork/scripts/cleanup.sh
```

## Helpers

| Script                      | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `scripts/launch.sh`         | Disposable DB, migrate, API (optional Vite/worker), PID + `launch.env` |
| `scripts/doctor.sh`         | Read-only ownership and health/ready check                             |
| `scripts/cleanup.sh`        | Tear down owned PIDs + disposable DB; keep evidence                    |
| `scripts/drive-ready.mjs`   | Prove `/health` and `/ready` with JSON artifacts                       |
| `scripts/drive-gallery.mjs` | Prove `/dev/ui` identity and Vite `/health` proxy                      |

```sh
VERIFY_SKIP_WORKER=1 .cursor/skills/verify-brightwork/scripts/launch.sh
set -a && source "$VERIFY_ROOT/launch.env" && set +a
.cursor/skills/verify-brightwork/scripts/doctor.sh
pnpm verify:ready
pnpm verify:gallery
pnpm verify:invariants 2>&1 | tee "$VERIFY_ROOT/invariants.log"
.cursor/skills/verify-brightwork/scripts/cleanup.sh
# Evidence remains at $VERIFY_ROOT
```
