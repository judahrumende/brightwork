---
name: verify
description: Verify Brightwork's API and Pip OpenRouter budget guard with a disposable local stack and fake provider responses. Use before changing or reviewing API readiness, Pip inference routing, or budget enrollment.
---

# Verify Brightwork API

Use this skill to prove local API readiness and the Pip budget guard. It uses a disposable Postgres database, a dedicated in-memory Redis process, and fake OpenRouter responses. It never starts a worker or sends inference.

## Launch

Run from the repository root in one shell so the run variables remain available for cleanup. Use Node 22.5 through 24.x, within the package engine range. Check that `node --version` and `pnpm exec node --version` report the same supported version. The launch creates a unique database, applies migrations, starts the API on loopback, and writes evidence under `output/verify-brightwork/<run-id>/`.

```sh
set -euo pipefail
RUN_ID="pip_verify_$(date -u +%Y%m%dT%H%M%S)_$(openssl rand -hex 4)"
VERIFY_ROOT="$PWD/output/verify-brightwork/$RUN_ID"
VERIFY_DB="bw_verify_$RUN_ID"
VERIFY_REDIS_PORT=16379
mkdir -p "$VERIFY_ROOT"
printf 'VERIFY_ROOT=%s\nVERIFY_DB=%s\nVERIFY_REDIS_PORT=%s\n' \
  "$VERIFY_ROOT" "$VERIFY_DB" "$VERIFY_REDIS_PORT" | tee "$VERIFY_ROOT/launch.log"
if lsof -nP -iTCP:"$VERIFY_REDIS_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "verification refused: Redis port $VERIFY_REDIS_PORT is already in use" >&2
  exit 1
fi
redis-server --bind 127.0.0.1 --port "$VERIFY_REDIS_PORT" \
  --save "" --appendonly no --dir "$VERIFY_ROOT" --daemonize yes \
  --pidfile "$VERIFY_ROOT/redis.pid" --logfile "$VERIFY_ROOT/redis.log"
redis-cli -h 127.0.0.1 -p "$VERIFY_REDIS_PORT" ping
set -o pipefail
(
  unset BRIGHTWORK_OPENROUTER_KEY OPENROUTER_API_KEY LLM_API_KEY LLM_MODEL \
    LLM_BASE_URL BRIGHTWORK_DESKTOP_PIP WEB_SEARCH_API_KEY MEDIA_OPENAI_KEY \
    MEDIA_FAL_KEY
  VERIFY_ROOT="$VERIFY_ROOT" VERIFY_ROOT_FORCE="$VERIFY_ROOT" \
    VERIFY_DB="$VERIFY_DB" VERIFY_DB_FORCE="$VERIFY_DB" \
    VERIFY_REDIS_URL="redis://127.0.0.1:$VERIFY_REDIS_PORT/14" \
    VERIFY_SKIP_VITE=1 VERIFY_SKIP_WORKER=1 RUN_ID="$RUN_ID" \
    .cursor/skills/verify-brightwork/scripts/launch.sh
) 2>&1 | tee -a "$VERIFY_ROOT/launch.log"
```

The API is usable when `/health` returns HTTP 200 with `{"status":"ok"}` and `/ready` returns HTTP 200 with `"status":"ready"`. This API-only run needs no account or seed rows. `launch.sh` applies migrations to the empty disposable database.

If launch or a drive fails, stop before retrying. Use the printed `VERIFY_ROOT`, `VERIFY_DB`, and `VERIFY_REDIS_PORT` values to run the Cleanup steps. Confirm that the API and Redis ports are free and that the disposable database is gone.

## Doctor

Source the launch settings and run the existing read-only doctor before driving the API:

```sh
set -a
source "$VERIFY_ROOT/launch.env"
set +a
.cursor/skills/verify-brightwork/scripts/doctor.sh
```

Require `doctor complete`. The doctor checks the current Git revision, database and Redis URLs, API process and port ownership, `/health`, and `/ready`. These readiness routes do not require a user session or API key. Do not continue if the doctor fails.

## Drive

Read `features/README.md`, then use the recipe for each behavior you need to verify. The API readiness recipe uses the owned server. The Pip budget recipe runs the production LLM client and budget guard with a fake transport at the existing provider-request boundary.

Do not start `apps/worker`. A queued job can send a paid inference request when a real key is present. Do not run the live enrollment command as part of this skill.

## Evidence

Keep proof under `$VERIFY_ROOT`. Capture the command and its output, not only a final status. Keep `launch.log`, `doctor.txt`, `doctor-ready.json`, `health.json`, `ready.json`, `drive-ready.json`, `pip-budget.log`, and `note.md` for the paths you run.

The API readiness proof records HTTP status and response bodies. The budget tests call the real `llmClient` and SQLite ledger, but replace OpenRouter with a fake transport. They assert the outbound request, reservation, denial, and rollover behavior without network access or inference. Tests use disposable SQLite files and remove them when each test ends.

## Cleanup

Run cleanup after a successful drive and after every failed launch or drive. Use the exact paths created above:

```sh
VERIFY_ROOT="$VERIFY_ROOT" VERIFY_DB="$VERIFY_DB" \
  .cursor/skills/verify-brightwork/scripts/cleanup.sh
if [ -f "$VERIFY_ROOT/redis.pid" ]; then
  REDIS_PID="$(cat "$VERIFY_ROOT/redis.pid")"
  REDIS_LISTENER="$(lsof -nP -iTCP:"$VERIFY_REDIS_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ "$REDIS_LISTENER" = "$REDIS_PID" ]; then
    redis-cli -h 127.0.0.1 -p "$VERIFY_REDIS_PORT" shutdown nosave
  elif [ -z "$REDIS_LISTENER" ]; then
    echo "owned Redis already stopped"
  else
    echo "refusing to stop Redis: port owner does not match this run" >&2
    exit 1
  fi
else
  if lsof -nP -iTCP:"$VERIFY_REDIS_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "refusing to continue: Redis is listening without this run's pidfile" >&2
    exit 1
  fi
fi
rm -f "$VERIFY_ROOT/launch.env"
test -f "$VERIFY_ROOT/launch.log"
```

Cleanup stops only the API PID recorded for this run and drops only the `bw_verify_*` database named in `VERIFY_DB`. The Redis shutdown runs only after its listener PID matches this run's pidfile. Redis has persistence disabled. Cleanup removes `launch.env`, which contains the generated session secret, and leaves the proof files in place. Never kill a process by name or remove the evidence directory.

## Helpers

This skill reuses the root `.cursor/skills/verify-brightwork/scripts/` helpers. It adds no scripts. Run all commands from the repository root.

```sh
.cursor/skills/verify-brightwork/scripts/launch.sh
.cursor/skills/verify-brightwork/scripts/doctor.sh
node .cursor/skills/verify-brightwork/scripts/drive-ready.mjs
pnpm test:pip-budget
.cursor/skills/verify-brightwork/scripts/cleanup.sh
```
