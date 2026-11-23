#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

RUN_ID="${RUN_ID:-$(date +%Y%m%dT%H%M%S)}"
# Always derive disposable DB from RUN_ID unless caller forces VERIFY_DB explicitly
# after unsetting any stale shell value.
if [[ -z "${VERIFY_DB_FORCE:-}" ]]; then
  VERIFY_DB="bw_verify_${RUN_ID//[^a-zA-Z0-9_]/_}"
fi
export VERIFY_ROOT="${VERIFY_ROOT:-$ROOT/output/verify-brightwork/${RUN_ID}}"
mkdir -p "$VERIFY_ROOT"
export VERIFY_DB
export DATABASE_URL="postgresql://judahrumende@127.0.0.1:5432/${VERIFY_DB}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/14}"
export API_PORT="${API_PORT:-3018}"
export API_HOST="${API_HOST:-127.0.0.1}"
export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:5188}"
export PERSONAL_MODE="${PERSONAL_MODE:-true}"
export AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -hex 32)}"

createdb "$VERIFY_DB" 2>/dev/null || true
pnpm --filter @brightwork/api exec env DATABASE_URL="$DATABASE_URL" tsx src/db/migrate.ts

TSX_REL="$(cd apps/worker && pnpm exec which tsx)"
TSX="$(cd apps/worker && cd "$(dirname "$TSX_REL")" && pwd)/$(basename "$TSX_REL")"
[[ -x "$TSX" ]] || fail_missing_tsx() { echo "tsx not found at $TSX" >&2; exit 1; }; [[ -x "$TSX" ]] || fail_missing_tsx

nohup env DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" API_PORT="$API_PORT" \
  API_HOST="$API_HOST" APP_ORIGIN="$APP_ORIGIN" PERSONAL_MODE="$PERSONAL_MODE" \
  AUTH_SECRET="$AUTH_SECRET" \
  "$TSX" --env-file-if-exists=/dev/null "$ROOT/apps/api/src/server.ts" \
  >"$VERIFY_ROOT/api.log" 2>&1 &
echo $! >"$VERIFY_ROOT/api.pid"

for _ in $(seq 1 40); do
  if curl -fsS --max-time 1 "http://${API_HOST}:${API_PORT}/health" | grep -q '"status":"ok"'; then
    break
  fi
  sleep 0.25
done
curl -fsS --max-time 2 "http://${API_HOST}:${API_PORT}/health" | grep -q '"status":"ok"'

nohup env APP_ORIGIN="$APP_ORIGIN" API_PORT="$API_PORT" \
  pnpm --filter @brightwork/web exec vite --host 127.0.0.1 \
  >"$VERIFY_ROOT/web.log" 2>&1 &
echo $! >"$VERIFY_ROOT/web.pid"

for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "$APP_ORIGIN/health" | grep -q '"status":"ok"'; then
    # Prefer listening PIDs when wrappers differ
    API_LISTEN="$(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    WEB_LISTEN="$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).port or "")' "$APP_ORIGIN")"
    WEB_LISTEN_PID="$(lsof -nP -iTCP:"$WEB_LISTEN" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    [[ -n "$API_LISTEN" ]] && echo "$API_LISTEN" >"$VERIFY_ROOT/api.pid"
    [[ -n "$WEB_LISTEN_PID" ]] && echo "$WEB_LISTEN_PID" >"$VERIFY_ROOT/web.pid"
    {
      printf "export VERIFY_ROOT=%q\n" "$VERIFY_ROOT"
      printf "export VERIFY_DB=%q\n" "$VERIFY_DB"
      printf "export APP_ORIGIN=%q\n" "$APP_ORIGIN"
      printf "export API_PORT=%q\n" "$API_PORT"
      printf "export DATABASE_URL=%q\n" "$DATABASE_URL"
      printf "export REDIS_URL=%q\n" "$REDIS_URL"
      printf "export PERSONAL_MODE=%q\n" "$PERSONAL_MODE"
      printf "export AUTH_SECRET=%q\n" "$AUTH_SECRET"
    } >"$VERIFY_ROOT/launch.env"
    echo "VERIFY_ROOT=$VERIFY_ROOT"
    echo "VERIFY_DB=$VERIFY_DB"
    echo "APP_ORIGIN=$APP_ORIGIN"
    echo "API_PORT=$API_PORT"
    echo "ready"
    exit 0
  fi
  sleep 0.5
done
echo "launch failed; see $VERIFY_ROOT/api.log and web.log" >&2
exit 1
