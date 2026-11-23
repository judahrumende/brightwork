#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

: "${VERIFY_ROOT:?Set VERIFY_ROOT to this run evidence directory}"
: "${API_PORT:?}"
: "${DATABASE_URL:?}"
: "${REDIS_URL:?}"
API_HOST="${API_HOST:-127.0.0.1}"
VERIFY_API_BASE="${VERIFY_API_BASE:-http://${API_HOST}:${API_PORT}}"

fail() { echo "doctor FAIL: $*" >&2; exit 1; }
pass() { echo "doctor OK: $*"; }

SHA="$(git rev-parse HEAD)"
{
  echo "sha=$SHA"
  echo "VERIFY_API_BASE=$VERIFY_API_BASE"
  echo "DATABASE_URL=$DATABASE_URL"
  echo "REDIS_URL=$REDIS_URL"
} | tee "$VERIFY_ROOT/doctor.txt"

echo "$DATABASE_URL" | grep -q 'bw_verify_' || fail "DATABASE_URL must name a bw_verify_* database"
case "$DATABASE_URL" in
  *://*/brightwork|*/brightwork\?*|*/brightwork) fail "refusing shared brightwork database" ;;
esac
case "$REDIS_URL" in
  */14) ;;
  *) fail "REDIS_URL must use disposable logical DB 14" ;;
esac

if [[ -f "$VERIFY_ROOT/api.pid" ]]; then
  API_PID="$(tr -d '[:space:]' <"$VERIFY_ROOT/api.pid")"
  kill -0 "$API_PID" 2>/dev/null || fail "api.pid $API_PID is not running"
  pass "api pid $API_PID alive"
fi

API_LISTEN="$(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
[[ -n "$API_LISTEN" ]] || fail "nothing listening on API_PORT $API_PORT"
if [[ -f "$VERIFY_ROOT/api.pid" ]]; then
  [[ "$API_LISTEN" == "$(tr -d '[:space:]' <"$VERIFY_ROOT/api.pid")" ]] \
    || fail "API_PORT $API_PORT owned by $API_LISTEN, not api.pid"
fi
pass "API_PORT $API_PORT owned by this run"

HEALTH="$(curl -fsS --max-time 5 "$VERIFY_API_BASE/health" || true)"
echo "$HEALTH" | grep -q '"status":"ok"' || fail "health was: $HEALTH"
pass "health ok"

if [[ "${VERIFY_EXPECT_READY:-1}" == "1" ]]; then
  READY_CODE="$(curl -sS --max-time 5 -o "$VERIFY_ROOT/doctor-ready.json" -w '%{http_code}' "$VERIFY_API_BASE/ready" || true)"
  [[ "$READY_CODE" == "200" ]] || fail "ready HTTP $READY_CODE body $(cat "$VERIFY_ROOT/doctor-ready.json" 2>/dev/null || true)"
  grep -q '"status":"ready"' "$VERIFY_ROOT/doctor-ready.json" || fail "ready body not ready"
  pass "ready ok"
fi

if [[ -f "$VERIFY_ROOT/web.pid" ]]; then
  : "${APP_ORIGIN:?APP_ORIGIN required when web.pid exists}"
  WEB_PID="$(tr -d '[:space:]' <"$VERIFY_ROOT/web.pid")"
  kill -0 "$WEB_PID" 2>/dev/null || fail "web.pid $WEB_PID is not running"
  ORIGIN_PORT="$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).port or 0)' "$APP_ORIGIN")"
  [[ "$ORIGIN_PORT" != "0" ]] || fail "APP_ORIGIN must include an explicit port"
  [[ "$ORIGIN_PORT" == "$API_PORT" ]] && fail "APP_ORIGIN port must be Vite, not API_PORT"
  WEB_LISTEN="$(lsof -nP -iTCP:"$ORIGIN_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  [[ "$WEB_LISTEN" == "$WEB_PID" ]] || fail "Vite port owned by $WEB_LISTEN, not web.pid"
  pass "vite owned"
fi

pass "doctor complete"
