#!/usr/bin/env bash
# BW-ARCH-10: credit metering, approval gates, and vault encryption regression pack.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

run_root_unit() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "skip missing $file"
    return 0
  fi
  echo ">> $file"
  node --experimental-strip-types --test "$file"
}

run_api_test() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "skip missing $file"
    return 0
  fi
  local rel="${file#apps/api/}"
  echo ">> $file"
  (cd apps/api && node --import tsx --test "$rel")
}

echo "BW-ARCH-10 invariant gate"

run_root_unit tests/unit/credit-amount.test.ts
run_api_test apps/api/test/observability.test.ts
run_api_test apps/api/test/credits.test.ts
run_api_test apps/api/test/run-policy.test.ts

db_url="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "$db_url" ]]; then
  echo "No DATABASE_URL or TEST_DATABASE_URL; skipping Postgres invariant suites."
  echo "BW-ARCH-10 unit portion passed."
  exit 0
fi

export DATABASE_URL="$db_url"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-$db_url}"

focused=0
for file in \
  apps/api/test/run-credit-limits.integration.test.ts \
  apps/api/test/run-proposal-approval.integration.test.ts \
  apps/api/test/github-site-sync.integration.test.ts
do
  if [[ -f "$file" ]]; then
    focused=1
    run_api_test "$file"
  fi
done

if [[ "$focused" -eq 0 ]]; then
  run_api_test apps/api/test/auth.test.ts
fi

echo "BW-ARCH-10 passed."
