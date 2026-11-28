#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
# shellcheck source=redis14-lock.sh
source "$(dirname "$0")/redis14-lock.sh"

: "${VERIFY_ROOT:?Set VERIFY_ROOT}"

stop_pid_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(tr -d '[:space:]' <"$file")"
  if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]] || ((pid <= 1)); then
    echo "refusing to stop invalid pid in $file" >&2
    return 1
  fi
  if kill -0 -- "-$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 -- "-$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
    echo "stopped process group $pid"
  fi
  rm -f "$file"
}

stop_pid_file "$VERIFY_ROOT/api.pid"
stop_pid_file "$VERIFY_ROOT/web.pid"
stop_pid_file "$VERIFY_ROOT/worker.pid"

if [[ -n "${VERIFY_DB:-}" ]]; then
  case "$VERIFY_DB" in
    bw_verify_*)
      dropdb --if-exists "$VERIFY_DB" && echo "dropped $VERIFY_DB"
      ;;
    *)
      echo "refusing to drop unexpected VERIFY_DB=$VERIFY_DB" >&2
      exit 1
      ;;
  esac
fi

redis14_lock_release "$VERIFY_ROOT"
echo "cleanup done; evidence retained at $VERIFY_ROOT"
