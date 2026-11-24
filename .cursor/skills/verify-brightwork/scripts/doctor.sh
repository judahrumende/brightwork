#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
# shellcheck source=redis14-lock.sh
source "$(dirname "$0")/redis14-lock.sh"

: "${VERIFY_ROOT:?Set VERIFY_ROOT to this run evidence directory}"
: "${APP_ORIGIN:?}"
: "${API_PORT:?}"
: "${DATABASE_URL:?}"
: "${REDIS_URL:?}"
VERIFY_API_BASE="${VERIFY_API_BASE:-http://${API_HOST:-127.0.0.1}:${API_PORT}}"

fail() { echo "doctor FAIL: $*" >&2; exit 1; }
pass() { echo "doctor OK: $*"; }
process_group() {
  ps -o pgid= -p "$1" 2>/dev/null | tr -d '[:space:]'
}

SHA="$(git rev-parse HEAD)"
echo "sha=$SHA" | tee "$VERIFY_ROOT/doctor.txt"

echo "$DATABASE_URL" | grep -q 'bw_verify_' || fail "DATABASE_URL must name a bw_verify_* database"
case "$DATABASE_URL" in
  *15432*|*://*/brightwork|*/brightwork\?*|*/brightwork) fail "refusing shared .env-style database" ;;
esac
case "$REDIS_URL" in
  */14) ;;
  *) fail "REDIS_URL must use disposable logical DB 14" ;;
esac

if redis14_lock_owner_alive; then
  lock_root="$(redis14_lock_read_root)"
  [[ "$lock_root" == "$VERIFY_ROOT" ]] \
    || fail "Redis DB 14 lock owned by $lock_root, not this VERIFY_ROOT"
  pass "Redis DB 14 lock owned by this run"
else
  pass "Redis DB 14 lock absent or stale (legacy stack)"
fi

if [[ -f "$VERIFY_ROOT/api.pid" ]]; then
  API_PID="$(tr -d '[:space:]' <"$VERIFY_ROOT/api.pid")"
  kill -0 "$API_PID" 2>/dev/null || fail "api.pid $API_PID is not running"
  pass "api pid $API_PID alive"
fi
if [[ -f "$VERIFY_ROOT/web.pid" ]]; then
  WEB_PID="$(tr -d '[:space:]' <"$VERIFY_ROOT/web.pid")"
  kill -0 "$WEB_PID" 2>/dev/null || fail "web.pid $WEB_PID is not running"
  pass "web pid $WEB_PID alive"
fi
if [[ -f "$VERIFY_ROOT/worker.pid" ]]; then
  WORKER_PID="$(tr -d '[:space:]' <"$VERIFY_ROOT/worker.pid")"
  kill -0 "$WORKER_PID" 2>/dev/null || fail "worker.pid $WORKER_PID is not running"
  pass "worker pid $WORKER_PID alive"
fi

ORIGIN_PORT=$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).port or 0)' "$APP_ORIGIN")
[[ "$ORIGIN_PORT" != "0" ]] || fail "APP_ORIGIN must include an explicit port"
[[ "$ORIGIN_PORT" == "$API_PORT" ]] && fail "APP_ORIGIN port must be Vite, not API_PORT"
pass "APP_ORIGIN port $ORIGIN_PORT distinct from API_PORT $API_PORT"

API_LISTEN="$(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
[[ -n "$API_LISTEN" ]] || fail "nothing listening on API_PORT $API_PORT"
if [[ -f "$VERIFY_ROOT/api.pid" ]]; then
  API_GROUP="$(process_group "$API_LISTEN")"
  API_PID="$(tr -d '[:space:]' <"$VERIFY_ROOT/api.pid")"
  [[ "$API_GROUP" == "$API_PID" ]] \
    || fail "API_PORT $API_PORT process group $API_GROUP differs from launch group $API_PID"
  pass "API_PORT $API_PORT belongs to launch process group $API_PID"
fi

# Vite is optional for pip-core-journey (API-direct drive saves RAM under Ollama).
if [[ -f "$VERIFY_ROOT/web.pid" ]]; then
  WEB_LISTEN="$(lsof -nP -iTCP:"$ORIGIN_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  [[ -n "$WEB_LISTEN" ]] || fail "nothing listening on APP_ORIGIN port $ORIGIN_PORT"
  WEB_GROUP="$(process_group "$WEB_LISTEN")"
  WEB_PID="$(tr -d '[:space:]' <"$VERIFY_ROOT/web.pid")"
  [[ "$WEB_GROUP" == "$WEB_PID" ]] \
    || fail "Vite port $ORIGIN_PORT process group $WEB_GROUP differs from launch group $WEB_PID"
  HEALTH="$(curl -fsS --max-time 5 "$APP_ORIGIN/health" || true)"
  echo "$HEALTH" | grep -q '"status":"ok"' || fail "health at $APP_ORIGIN/health was: $HEALTH"
  pass "health ok at $APP_ORIGIN"
else
  HEALTH="$(curl -fsS --max-time 5 "$VERIFY_API_BASE/health" || true)"
  echo "$HEALTH" | grep -q '"status":"ok"' || fail "API health was: $HEALTH"
  pass "API health ok (Vite skipped; pip journey uses VERIFY_API_BASE)"
fi
pass "ports owned by this run"

if [[ "${VERIFY_EXPECT_READY:-1}" == "1" ]]; then
  READY_CODE="$(curl -sS --max-time 5 -o "$VERIFY_ROOT/doctor-ready.json" -w '%{http_code}' "$VERIFY_API_BASE/ready" || true)"
  [[ "$READY_CODE" == "200" ]] \
    || fail "ready HTTP $READY_CODE body $(cat "$VERIFY_ROOT/doctor-ready.json" 2>/dev/null || true)"
  grep -q '"status":"ready"' "$VERIFY_ROOT/doctor-ready.json" \
    || fail "ready body not ready: $(cat "$VERIFY_ROOT/doctor-ready.json")"
  pass "ready ok"
fi

LLM_MODEL="${LLM_MODEL:-qwen2.5:7b-instruct}"
LLM_BASE_URL="${LLM_BASE_URL:-http://127.0.0.1:11434}"
REQUIRE_OLLAMA="${VERIFY_REQUIRE_OLLAMA:-1}"
if [[ "${VERIFY_SKIP_WORKER:-0}" == "1" && -z "${VERIFY_REQUIRE_OLLAMA:-}" ]]; then
  REQUIRE_OLLAMA=0
fi
if [[ "$REQUIRE_OLLAMA" == "1" ]]; then
  TAGS="$(curl -fsS --max-time 5 "${LLM_BASE_URL%/}/api/tags" || true)"
  echo "$TAGS" | grep -q "$LLM_MODEL" \
    || fail "Ollama at $LLM_BASE_URL missing model $LLM_MODEL (got: ${TAGS:0:200})"
  pass "ollama has $LLM_MODEL"
fi

if [[ -f "$VERIFY_ROOT/worker.pid" || "${VERIFY_REQUIRE_WORKER:-0}" == "1" ]]; then
  [[ -f "$VERIFY_ROOT/worker.pid" ]] || fail "worker.pid missing (Pip journey needs a worker)"
  pass "worker present for Pip"
fi

# Concurrent Pip workers on Redis DB 14 steal jobs and fail journeys mid-drive.
OWN_WORKER=""
[[ -f "$VERIFY_ROOT/worker.pid" ]] && OWN_WORKER="$(tr -d '[:space:]' <"$VERIFY_ROOT/worker.pid")"
FOREIGN_WORKERS="$(pgrep -f "${ROOT}/apps/worker/src/index.ts" || true)"
if [[ -n "$FOREIGN_WORKERS" ]]; then
  while read -r wpid; do
    [[ -n "$wpid" ]] || continue
    [[ "$wpid" == "$OWN_WORKER" ]] && continue
    # Allow the hermes/tsx child of our supervisor pid.
    wppid="$(ps -o ppid= -p "$wpid" 2>/dev/null | tr -d ' ' || true)"
    [[ "$wppid" == "$OWN_WORKER" ]] && continue
    fail "foreign worker pid $wpid still running (Redis DB 14 contention); run VERIFY_FORCE_PREFLIGHT=1 preflight-kill.sh"
  done <<<"$FOREIGN_WORKERS"
fi
pass "no foreign Pip workers"

pass "ready to drive"
