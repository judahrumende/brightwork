#!/usr/bin/env bash
# Verification scaffolding: stop leftover Brightwork api/worker/vite so a prove
# run owns Redis DB 14 / ports 3018+5188 without foreign Pip workers.
# Respects .redis14.lock unless VERIFY_FORCE_PREFLIGHT=1 (maintain/coordinator
# reclaim). Concurrent agents must not SIGKILL a locked live stack.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
# shellcheck source=redis14-lock.sh
source "$(dirname "$0")/redis14-lock.sh"

if [[ "${VERIFY_FORCE_PREFLIGHT:-0}" != "1" ]] && redis14_lock_owner_alive; then
  owner="$(redis14_lock_read_root)"
  echo "preflight-kill: skipped — Redis DB 14 lock held by $owner" >&2
  echo "preflight-kill: set VERIFY_FORCE_PREFLIGHT=1 only when reclaiming as coordinator" >&2
  exit 0
fi

kill_matching() {
  local pattern="$1"
  local pids
  pids="$(pgrep -f "$pattern" || true)"
  [[ -z "$pids" ]] && return 0
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
}

kill_matching "${ROOT}/apps/worker/src/index.ts"
kill_matching "${ROOT}/apps/api/src/server.ts"
kill_matching '\[worker-supervisor\]'
kill_matching '\[api-supervisor\]'
kill_matching 'while true; do .*apps/api/src/server'
kill_matching 'while true; do .*apps/worker/src/index'

for p in 3018 3020 3021 3022 3023 5188 5190 5191 5192 5193; do
  for pid in $(lsof -nP -iTCP:"$p" -sTCP:LISTEN -t 2>/dev/null || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
done

sleep 1
LEFT="$(pgrep -lf "${ROOT}/apps/(api|worker)/src" || true)"
if [[ -n "$LEFT" ]]; then
  echo "preflight-kill: still running:" >&2
  echo "$LEFT" >&2
  exit 1
fi

# Drop stale lock after a forced reclaim.
if [[ "${VERIFY_FORCE_PREFLIGHT:-0}" == "1" ]]; then
  rm -f "$VERIFY_REDIS14_LOCK"
fi

echo "preflight-kill: clear"
exit 0
