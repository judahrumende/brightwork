#!/usr/bin/env bash
# Exclusive ownership of Redis logical DB 14 for verify-brightwork stacks.
# Sourced by launch/cleanup/preflight/doctor — not meant to be run alone.
: "${ROOT:?redis14-lock.sh requires ROOT}"

VERIFY_REDIS14_LOCK="${VERIFY_REDIS14_LOCK:-$ROOT/output/verify-brightwork/.redis14.lock}"

redis14_lock_owner_alive() {
  local lock="$VERIFY_REDIS14_LOCK"
  [[ -f "$lock" ]] || return 1
  # shellcheck disable=SC1090
  source "$lock"
  local pid
  for pid in "${LOCK_API_PID:-}" "${LOCK_WORKER_PID:-}" "${LOCK_WEB_PID:-}"; do
    [[ -n "$pid" ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

redis14_lock_read_root() {
  [[ -f "$VERIFY_REDIS14_LOCK" ]] || { echo ""; return 0; }
  # shellcheck disable=SC1090
  source "$VERIFY_REDIS14_LOCK"
  echo "${LOCK_VERIFY_ROOT:-}"
}

redis14_lock_acquire() {
  local root="$1"
  mkdir -p "$(dirname "$VERIFY_REDIS14_LOCK")"
  if redis14_lock_owner_alive; then
    local owner
    owner="$(redis14_lock_read_root)"
    if [[ "$owner" == "$root" ]]; then
      return 0
    fi
    echo "launch refused: Redis DB 14 lock held by $owner (see $VERIFY_REDIS14_LOCK)" >&2
    return 1
  fi
  rm -f "$VERIFY_REDIS14_LOCK"
  {
    printf "LOCK_VERIFY_ROOT=%q\n" "$root"
    printf "LOCK_STARTED_AT=%q\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf "LOCK_API_PID=\n"
    printf "LOCK_WORKER_PID=\n"
    printf "LOCK_WEB_PID=\n"
  } >"$VERIFY_REDIS14_LOCK"
}

redis14_lock_update_pids() {
  local root="$1"
  [[ -f "$VERIFY_REDIS14_LOCK" ]] || return 0
  # shellcheck disable=SC1090
  source "$VERIFY_REDIS14_LOCK"
  [[ "${LOCK_VERIFY_ROOT:-}" == "$root" ]] || return 0
  local api="" worker="" web=""
  [[ -f "$root/api.pid" ]] && api="$(tr -d '[:space:]' <"$root/api.pid")"
  [[ -f "$root/worker.pid" ]] && worker="$(tr -d '[:space:]' <"$root/worker.pid")"
  [[ -f "$root/web.pid" ]] && web="$(tr -d '[:space:]' <"$root/web.pid")"
  {
    printf "LOCK_VERIFY_ROOT=%q\n" "$root"
    printf "LOCK_STARTED_AT=%q\n" "${LOCK_STARTED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    printf "LOCK_API_PID=%q\n" "$api"
    printf "LOCK_WORKER_PID=%q\n" "$worker"
    printf "LOCK_WEB_PID=%q\n" "$web"
  } >"$VERIFY_REDIS14_LOCK"
}

redis14_lock_release() {
  local root="$1"
  [[ -f "$VERIFY_REDIS14_LOCK" ]] || return 0
  # shellcheck disable=SC1090
  source "$VERIFY_REDIS14_LOCK"
  if [[ "${LOCK_VERIFY_ROOT:-}" == "$root" ]]; then
    rm -f "$VERIFY_REDIS14_LOCK"
  fi
}
