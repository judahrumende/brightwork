#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

: "${VERIFY_ROOT:?Set VERIFY_ROOT to this run evidence directory}"
: "${APP_ORIGIN:?}"
: "${API_PORT:?}"
: "${DATABASE_URL:?}"
: "${REDIS_URL:?}"

fail() { echo "doctor FAIL: $*" >&2; exit 1; }
pass() { echo "doctor OK: $*"; }

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

HEALTH="$(curl -fsS --max-time 5 "$APP_ORIGIN/health" || true)"
echo "$HEALTH" | grep -q '"status":"ok"' || fail "health at $APP_ORIGIN/health was: $HEALTH"
pass "health ok at $APP_ORIGIN"

ORIGIN_PORT=$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).port or 0)' "$APP_ORIGIN")
[[ "$ORIGIN_PORT" != "0" ]] || fail "APP_ORIGIN must include an explicit port"
[[ "$ORIGIN_PORT" == "$API_PORT" ]] && fail "APP_ORIGIN port must be Vite, not API_PORT"
pass "APP_ORIGIN port $ORIGIN_PORT distinct from API_PORT $API_PORT"
pass "ready to drive"
