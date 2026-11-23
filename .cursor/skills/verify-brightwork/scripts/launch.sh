#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

RUN_ID="${RUN_ID:-$(date +%Y%m%dT%H%M%S)}"
# Sourcing a prior launch.env leaves VERIFY_SKIP_VITE=1 in the shell.
# Pass VERIFY_SKIP_VITE=0 explicitly when this run needs Vite.
VERIFY_SKIP_VITE="${VERIFY_SKIP_VITE:-0}"
VERIFY_SKIP_WORKER="${VERIFY_SKIP_WORKER:-1}"
if [[ -z "${VERIFY_DB_FORCE:-}" ]]; then
  VERIFY_DB="bw_verify_${RUN_ID//[^a-zA-Z0-9_]/_}"
fi
if [[ -z "${VERIFY_ROOT_FORCE:-}" ]]; then
  VERIFY_ROOT="$ROOT/output/verify-brightwork/${RUN_ID}"
fi
export VERIFY_ROOT
mkdir -p "$VERIFY_ROOT"
export VERIFY_DB

PGUSER="${VERIFY_PGUSER:-$(whoami)}"
export DATABASE_URL="postgresql://${PGUSER}@127.0.0.1:5432/${VERIFY_DB}"
export REDIS_URL="${VERIFY_REDIS_URL:-redis://127.0.0.1:6379/14}"
export API_PORT="${VERIFY_API_PORT:-3028}"
export API_HOST="${VERIFY_API_HOST:-127.0.0.1}"
export APP_ORIGIN="${VERIFY_APP_ORIGIN:-http://127.0.0.1:5199}"
export AUTH_SECRET="${VERIFY_AUTH_SECRET:-$(openssl rand -hex 32)}"
# Leave S3 unset so /ready does not require MinIO for baseline readiness proofs.
unset S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET || true
export SENTRY_DSN="${VERIFY_SENTRY_DSN:-}"
export LOG_LEVEL="${VERIFY_LOG_LEVEL:-info}"

ORIGIN_PORT="$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).port or "")' "$APP_ORIGIN")"
for port in "$API_PORT" "$ORIGIN_PORT"; do
  if [[ -n "$port" ]] && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "launch refused: port $port already listening" >&2
    exit 1
  fi
done

createdb "$VERIFY_DB" 2>/dev/null || true
pnpm --filter @brightwork/api exec env DATABASE_URL="$DATABASE_URL" tsx src/db/migrate.ts \
  >"$VERIFY_ROOT/migrate.log" 2>&1

TSX_REL="$(cd apps/api && pnpm exec which tsx)"
TSX="$(cd apps/api && cd "$(dirname "$TSX_REL")" && pwd)/$(basename "$TSX_REL")"
if [[ ! -x "$TSX" ]]; then
  echo "tsx not found at $TSX" >&2
  exit 1
fi

start_detached() {
  local pidfile="$1"
  local logfile="$2"
  shift 2
  [[ "$1" == "--" ]] && shift
  VERIFY_PIDFILE="$pidfile" VERIFY_LOGFILE="$logfile" python3 - "$@" <<'PY'
import os, subprocess, sys
pidfile = os.environ["VERIFY_PIDFILE"]
logfile = os.environ["VERIFY_LOGFILE"]
args = sys.argv[1:]
env = os.environ.copy()
cmd = []
for arg in args:
    if cmd:
        cmd.append(arg)
    elif "=" in arg and arg.split("=", 1)[0].isidentifier():
        key, value = arg.split("=", 1)
        env[key] = value
    else:
        cmd.append(arg)
if not cmd:
    raise SystemExit("start_detached: missing command")
log = open(logfile, "ab", buffering=0)
proc = subprocess.Popen(
    cmd,
    env=env,
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=subprocess.STDOUT,
    start_new_session=True,
    cwd=os.environ.get("PWD") or None,
)
open(pidfile, "w", encoding="utf-8").write(str(proc.pid))
PY
}

common_env=(
  DATABASE_URL="$DATABASE_URL"
  REDIS_URL="$REDIS_URL"
  API_PORT="$API_PORT"
  API_HOST="$API_HOST"
  APP_ORIGIN="$APP_ORIGIN"
  AUTH_SECRET="$AUTH_SECRET"
  LOG_LEVEL="$LOG_LEVEL"
)

start_detached "$VERIFY_ROOT/api.pid" "$VERIFY_ROOT/api.log" -- \
  "${common_env[@]}" \
  env -u S3_ENDPOINT -u S3_ACCESS_KEY -u S3_SECRET_KEY -u S3_BUCKET \
  "$TSX" --env-file-if-exists=/dev/null "$ROOT/apps/api/src/server.ts"

for _ in $(seq 1 80); do
  if curl -fsS --max-time 1 "http://${API_HOST}:${API_PORT}/health" 2>/dev/null | grep -q '"status":"ok"'; then
    break
  fi
  sleep 0.25
done
if ! curl -fsS --max-time 2 "http://${API_HOST}:${API_PORT}/health" | grep -q '"status":"ok"'; then
  echo "API health failed; see $VERIFY_ROOT/api.log" >&2
  exit 1
fi

API_LISTEN="$(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
[[ -n "$API_LISTEN" ]] && echo "$API_LISTEN" >"$VERIFY_ROOT/api.pid"

if [[ "${VERIFY_SKIP_WORKER:-1}" != "1" ]]; then
  : "${LLM_API_KEY:?VERIFY_SKIP_WORKER=0 requires LLM_API_KEY}"
  : "${LLM_MODEL:?VERIFY_SKIP_WORKER=0 requires LLM_MODEL}"
  start_detached "$VERIFY_ROOT/worker.pid" "$VERIFY_ROOT/worker.log" -- \
    "${common_env[@]}" \
    LLM_API_KEY="$LLM_API_KEY" \
    LLM_MODEL="$LLM_MODEL" \
    LLM_BASE_URL="${LLM_BASE_URL:-https://api.openai.com/v1}" \
    "$TSX" --env-file-if-exists=/dev/null "$ROOT/apps/worker/src/index.ts"
  sleep 2
  if ! kill -0 "$(tr -d '[:space:]' <"$VERIFY_ROOT/worker.pid")" 2>/dev/null; then
    echo "worker exited immediately; see $VERIFY_ROOT/worker.log" >&2
    exit 1
  fi
fi

if [[ "${VERIFY_SKIP_VITE:-0}" != "1" ]]; then
  [[ -n "$ORIGIN_PORT" ]] || {
    echo "APP_ORIGIN must include an explicit port for Vite" >&2
    exit 1
  }
  start_detached "$VERIFY_ROOT/web.pid" "$VERIFY_ROOT/web.log" -- \
    APP_ORIGIN="$APP_ORIGIN" API_PORT="$API_PORT" \
    pnpm --filter @brightwork/web exec vite --host 127.0.0.1 --port "$ORIGIN_PORT" --strictPort
  vite_ok=0
  for _ in $(seq 1 80); do
    if curl -fsS --max-time 2 "$APP_ORIGIN/health" 2>/dev/null | grep -q '"status":"ok"'; then
      WEB_LISTEN_PID="$(lsof -nP -iTCP:"$ORIGIN_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
      [[ -n "$WEB_LISTEN_PID" ]] && echo "$WEB_LISTEN_PID" >"$VERIFY_ROOT/web.pid"
      vite_ok=1
      break
    fi
    sleep 0.25
  done
  if [[ "$vite_ok" != "1" ]]; then
    echo "Vite health failed on $APP_ORIGIN; see $VERIFY_ROOT/web.log" >&2
    exit 1
  fi
fi

{
  printf "export VERIFY_ROOT=%q\n" "$VERIFY_ROOT"
  printf "export VERIFY_DB=%q\n" "$VERIFY_DB"
  printf "export APP_ORIGIN=%q\n" "$APP_ORIGIN"
  printf "export API_PORT=%q\n" "$API_PORT"
  printf "export API_HOST=%q\n" "$API_HOST"
  printf "export DATABASE_URL=%q\n" "$DATABASE_URL"
  printf "export REDIS_URL=%q\n" "$REDIS_URL"
  printf "export AUTH_SECRET=%q\n" "$AUTH_SECRET"
  printf "export VERIFY_API_BASE=%q\n" "http://${API_HOST}:${API_PORT}"
  printf "export VERIFY_SKIP_VITE=%q\n" "$VERIFY_SKIP_VITE"
  printf "export VERIFY_SKIP_WORKER=%q\n" "$VERIFY_SKIP_WORKER"
  printf "export VERIFY_EXPECT_READY=%q\n" "${VERIFY_EXPECT_READY:-1}"
} >"$VERIFY_ROOT/launch.env"

echo "VERIFY_ROOT=$VERIFY_ROOT"
echo "VERIFY_DB=$VERIFY_DB"
echo "VERIFY_API_BASE=http://${API_HOST}:${API_PORT}"
echo "ready"
