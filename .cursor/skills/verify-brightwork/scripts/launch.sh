#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
# shellcheck source=redis14-lock.sh
source "$(dirname "$0")/redis14-lock.sh"

RUN_ID="${RUN_ID:-$(date +%Y%m%dT%H%M%S)}"
# Always derive disposable paths from RUN_ID. Ambient VERIFY_ROOT/VERIFY_DB from a
# prior sourced launch.env must not reuse an old evidence directory.
VERIFY_SKIP_VITE="${VERIFY_SKIP_VITE:-0}"
VERIFY_SKIP_WORKER="${VERIFY_SKIP_WORKER:-0}"
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
# Isolation: ignore ambient shell/.env (journey ports, OpenRouter keys, Redis DB 15).
# Override only via VERIFY_* so a polluted parent shell cannot hijack the stack.
export REDIS_URL="${VERIFY_REDIS_URL:-redis://127.0.0.1:6379/14}"
export API_PORT="${VERIFY_API_PORT:-3018}"
export API_HOST="${VERIFY_API_HOST:-127.0.0.1}"
export APP_ORIGIN="${VERIFY_APP_ORIGIN:-http://127.0.0.1:5188}"
export PERSONAL_MODE="${VERIFY_PERSONAL_MODE:-true}"
export AUTH_SECRET="${VERIFY_AUTH_SECRET:-$(openssl rand -hex 32)}"
export SITE_BASE_DOMAIN="${VERIFY_SITE_BASE_DOMAIN:-127.0.0.1.nip.io:${API_PORT}}"
export LLM_API_STYLE="${VERIFY_LLM_API_STYLE:-ollama}"
export LLM_BASE_URL="${VERIFY_LLM_BASE_URL:-http://127.0.0.1:11434}"
export LLM_MODEL="${VERIFY_LLM_MODEL:-qwen2.5:7b-instruct}"
export LLM_API_KEY="${VERIFY_LLM_API_KEY:-}"
export LLM_MAX_TOKENS="${VERIFY_LLM_MAX_TOKENS:-1536}"
export LLM_PAGE_MAX_TOKENS="${VERIFY_LLM_PAGE_MAX_TOKENS:-3072}"
export LLM_NUM_CTX="${VERIFY_LLM_NUM_CTX:-4096}"
export LLM_TIMEOUT_MS="${VERIFY_LLM_TIMEOUT_MS:-300000}"
export AGENT_MAX_MODEL_CALLS="${VERIFY_AGENT_MAX_MODEL_CALLS:-12}"
export TURNSTILE_SITE_KEY="${VERIFY_TURNSTILE_SITE_KEY:-1x00000000000000000000AA}"
export TURNSTILE_SECRET_KEY="${VERIFY_TURNSTILE_SECRET_KEY:-1x0000000000000000000000000000000AA}"
export SMTP_HOST="${VERIFY_SMTP_HOST:-127.0.0.1}"
export SMTP_PORT="${VERIFY_SMTP_PORT:-1025}"
export SMTP_SECURE="${VERIFY_SMTP_SECURE:-false}"
export LOG_LEVEL="${VERIFY_LOG_LEVEL:-info}"
export SENTRY_DSN="${VERIFY_SENTRY_DSN:-}"
unset S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET || true

# One live stack owns Redis DB 14. Stale locks are replaced; live owners refuse.
redis14_lock_acquire "$VERIFY_ROOT"

# Refuse to share ports with a pre-existing stack.
for port in "$API_PORT" "$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).port or "")' "$APP_ORIGIN")"; do
  if [[ -n "$port" ]] && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "launch refused: port $port already listening" >&2
    redis14_lock_release "$VERIFY_ROOT"
    exit 1
  fi
done

createdb "$VERIFY_DB" 2>/dev/null || true
pnpm --filter @brightwork/api exec env DATABASE_URL="$DATABASE_URL" tsx src/db/migrate.ts \
  >"$VERIFY_ROOT/migrate.log" 2>&1

TSX_REL="$(cd apps/worker && pnpm exec which tsx)"
TSX="$(cd apps/worker && cd "$(dirname "$TSX_REL")" && pwd)/$(basename "$TSX_REL")"
if [[ ! -x "$TSX" ]]; then
  echo "tsx not found at $TSX" >&2
  exit 1
fi

common_env=(
  DATABASE_URL="$DATABASE_URL"
  REDIS_URL="$REDIS_URL"
  API_PORT="$API_PORT"
  API_HOST="$API_HOST"
  APP_ORIGIN="$APP_ORIGIN"
  PERSONAL_MODE="$PERSONAL_MODE"
  AUTH_SECRET="$AUTH_SECRET"
  SITE_BASE_DOMAIN="$SITE_BASE_DOMAIN"
  LLM_API_STYLE="$LLM_API_STYLE"
  LLM_BASE_URL="$LLM_BASE_URL"
  LLM_MODEL="$LLM_MODEL"
  LLM_API_KEY="$LLM_API_KEY"
  LLM_MAX_TOKENS="$LLM_MAX_TOKENS"
  LLM_PAGE_MAX_TOKENS="$LLM_PAGE_MAX_TOKENS"
  LLM_NUM_CTX="$LLM_NUM_CTX"
  LLM_TIMEOUT_MS="$LLM_TIMEOUT_MS"
  AGENT_MAX_MODEL_CALLS="$AGENT_MAX_MODEL_CALLS"
  TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY"
  TURNSTILE_SECRET_KEY="$TURNSTILE_SECRET_KEY"
  SMTP_HOST="$SMTP_HOST"
  SMTP_PORT="$SMTP_PORT"
  SMTP_SECURE="$SMTP_SECURE"
  LOG_LEVEL="$LOG_LEVEL"
  SENTRY_DSN="$SENTRY_DSN"
)

# Detach into a new session so Cursor/tool shells cannot reap the stack.
# Usage: start_detached <pidfile> <logfile> -- KEY=val... <command...>
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

# Under Ollama, idle Node processes can be reaped by memory pressure. For Pip
# journey launches, wrap the API in a restart loop so publish/answer stay reachable.
if [[ "${VERIFY_SKIP_VITE:-0}" == "1" ]]; then
  # Quote paths inside -c: ROOT may contain spaces (e.g. "Foundable v2").
  start_detached "$VERIFY_ROOT/api.pid" "$VERIFY_ROOT/api.log" -- \
    "${common_env[@]}" \
    bash -c 'while true; do echo "[api-supervisor] starting $(date -u +%H:%M:%S)" >&2; "'"$TSX"'" --env-file-if-exists=/dev/null "'"$ROOT"'/apps/api/src/server.ts"; echo "[api-supervisor] exit $? at $(date -u +%H:%M:%S)" >&2; sleep 2; done'
else
  start_detached "$VERIFY_ROOT/api.pid" "$VERIFY_ROOT/api.log" -- \
    "${common_env[@]}" \
    "$TSX" --env-file-if-exists=/dev/null "$ROOT/apps/api/src/server.ts"
fi

for _ in $(seq 1 60); do
  if curl -fsS --max-time 1 "http://${API_HOST}:${API_PORT}/health" | grep -q '"status":"ok"'; then
    break
  fi
  sleep 0.25
done
curl -fsS --max-time 2 "http://${API_HOST}:${API_PORT}/health" | grep -q '"status":"ok"'

if [[ "$VERIFY_SKIP_WORKER" != "1" ]]; then
  # Check before spawn — our tsx/hermes children would otherwise look foreign.
  FOREIGN="$(pgrep -lf "${ROOT}/apps/worker/src/index.ts" || true)"
  if [[ -n "$FOREIGN" ]]; then
    echo "launch refused: foreign worker processes still running (run preflight-kill.sh):" >&2
    echo "$FOREIGN" >&2
    redis14_lock_release "$VERIFY_ROOT"
    exit 1
  fi

  if [[ "$VERIFY_SKIP_VITE" == "1" ]]; then
    start_detached "$VERIFY_ROOT/worker.pid" "$VERIFY_ROOT/worker.log" -- \
      "${common_env[@]}" \
      bash -c 'while true; do echo "[worker-supervisor] starting $(date -u +%H:%M:%S)" >&2; "'"$TSX"'" --env-file-if-exists=/dev/null "'"$ROOT"'/apps/worker/src/index.ts"; echo "[worker-supervisor] exit $? at $(date -u +%H:%M:%S)" >&2; sleep 2; done'
  else
    start_detached "$VERIFY_ROOT/worker.pid" "$VERIFY_ROOT/worker.log" -- \
      "${common_env[@]}" \
      "$TSX" --env-file-if-exists=/dev/null "$ROOT/apps/worker/src/index.ts"
  fi

  sleep 2
  if ! kill -0 "$(tr -d '[:space:]' <"$VERIFY_ROOT/worker.pid")" 2>/dev/null; then
    echo "worker exited immediately; see $VERIFY_ROOT/worker.log" >&2
    redis14_lock_release "$VERIFY_ROOT"
    exit 1
  fi
fi

SKIP_VITE="$VERIFY_SKIP_VITE"
if [[ "$SKIP_VITE" != "1" ]]; then
  start_detached "$VERIFY_ROOT/web.pid" "$VERIFY_ROOT/web.log" -- \
    APP_ORIGIN="$APP_ORIGIN" API_PORT="$API_PORT" \
    pnpm --filter @brightwork/web exec vite --host 127.0.0.1
fi

for _ in $(seq 1 60); do
  HEALTH_URL="$APP_ORIGIN/health"
  [[ "$SKIP_VITE" == "1" ]] && HEALTH_URL="http://${API_HOST}:${API_PORT}/health"
  if curl -fsS --max-time 2 "$HEALTH_URL" | grep -q '"status":"ok"'; then
    API_LISTEN="$(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    if [[ "$SKIP_VITE" != "1" ]]; then
      : "${API_LISTEN:?API failed to claim its port}"
    fi
    {
      printf "export VERIFY_ROOT=%q\n" "$VERIFY_ROOT"
      printf "export VERIFY_DB=%q\n" "$VERIFY_DB"
      printf "export APP_ORIGIN=%q\n" "$APP_ORIGIN"
      printf "export API_PORT=%q\n" "$API_PORT"
      printf "export DATABASE_URL=%q\n" "$DATABASE_URL"
      printf "export REDIS_URL=%q\n" "$REDIS_URL"
      printf "export PERSONAL_MODE=%q\n" "$PERSONAL_MODE"
      printf "export AUTH_SECRET=%q\n" "$AUTH_SECRET"
      printf "export SITE_BASE_DOMAIN=%q\n" "$SITE_BASE_DOMAIN"
      printf "export LLM_API_STYLE=%q\n" "$LLM_API_STYLE"
      printf "export LLM_BASE_URL=%q\n" "$LLM_BASE_URL"
      printf "export LLM_MODEL=%q\n" "$LLM_MODEL"
      printf "export LLM_MAX_TOKENS=%q\n" "$LLM_MAX_TOKENS"
      printf "export LLM_PAGE_MAX_TOKENS=%q\n" "$LLM_PAGE_MAX_TOKENS"
      printf "export LLM_NUM_CTX=%q\n" "$LLM_NUM_CTX"
      printf "export LLM_TIMEOUT_MS=%q\n" "$LLM_TIMEOUT_MS"
      printf "export AGENT_MAX_MODEL_CALLS=%q\n" "$AGENT_MAX_MODEL_CALLS"
      printf "export VERIFY_API_BASE=%q\n" "http://${API_HOST}:${API_PORT}"
      printf "export VERIFY_SKIP_VITE=%q\n" "$SKIP_VITE"
      printf "export VERIFY_SKIP_WORKER=%q\n" "$VERIFY_SKIP_WORKER"
    } >"$VERIFY_ROOT/launch.env"
    if [[ "$VERIFY_SKIP_WORKER" != "1" ]]; then
      redis14_lock_update_pids "$VERIFY_ROOT"
    fi
    echo "VERIFY_ROOT=$VERIFY_ROOT"
    echo "VERIFY_DB=$VERIFY_DB"
    echo "APP_ORIGIN=$APP_ORIGIN"
    echo "API_PORT=$API_PORT"
    echo "LLM_MODEL=$LLM_MODEL"
    echo "ready"
    exit 0
  fi
  sleep 0.5
done
echo "launch failed; see $VERIFY_ROOT/api.log, worker.log, web.log" >&2
redis14_lock_release "$VERIFY_ROOT"
exit 1
