#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

: "${VERIFY_ROOT:?Set VERIFY_ROOT}"

stop_pid_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(tr -d '[:space:]' <"$file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
    echo "stopped pid $pid"
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

echo "cleanup done; evidence retained at $VERIFY_ROOT"
