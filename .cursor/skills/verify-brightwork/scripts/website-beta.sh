#!/usr/bin/env bash
verify() {
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "Usage: $0" >&2
  exit 2
fi

cd "$(dirname "$0")/../../../.."
[[ "$(node -p 'process.versions.node.split(".")[0]')" == "$(cat .node-version)" ]] ||
  { echo "Use the Node major version in .node-version" >&2; exit 1; }
[[ "pnpm@$(pnpm --version)" == "$(node -p 'require("./package.json").packageManager')" ]] ||
  { echo "Use package.json's pinned pnpm version" >&2; exit 1; }
for service in initdb pg_ctl psql createdb redis-server redis-cli mailpit curl lsof; do
  command -v "$service" >/dev/null || { echo "Missing command: $service" >&2; exit 1; }
done
for file in .env .env.local .env.development .env.development.local .env.production .env.production.local; do
  [[ ! -e "$file" && ! -L "$file" ]] || { echo "Use a fresh worktree without $file" >&2; exit 1; }
done
ports=(3001 5173 5181 45432 46379 41025 48025)
for port in "${ports[@]}"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Verification refused: port $port is already in use" >&2
    exit 1
  fi
done

mkdir -p output/verify-brightwork
evidence="$(mktemp -d "$PWD/output/verify-brightwork/website-beta.XXXXXX")"
scratch="$(mktemp -d "$evidence/scratch.XXXXXX")"
printf 'Evidence: %s\n' "$evidence"
redis_pid=
mail_pid=
cleanup() {
  local status=$?
  local cleanup_status=complete
  local pid port
  trap - EXIT
  for pid in "$mail_pid" "$redis_pid"; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if pg_ctl -D "$scratch/pg" status >/dev/null 2>&1; then
    pg_ctl -D "$scratch/pg" -w stop -m fast >>"$evidence/postgres.log" 2>&1 ||
      cleanup_status=incomplete
  fi
  for port in "${ports[@]}"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >>"$evidence/cleanup.log" 2>&1; then
      cleanup_status=incomplete
    fi
  done
  if [[ "$cleanup_status" == complete ]]; then
    rm -rf -- "$scratch" || cleanup_status=incomplete
  fi
  if [[ "$cleanup_status" != complete ]]; then
    status=1
    echo "Teardown not confirmed. See $evidence/cleanup.log" >&2
  fi
  printf 'exit=%s\ncleanup=%s\n' "$status" "$cleanup_status" >>"$evidence/note.txt"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

{
  printf 'feature=website-beta\n'
  git rev-parse HEAD
  git status --porcelain --untracked-files=all
  node --version
  pnpm --version
} >"$evidence/note.txt"

check() {
  local name="$1"
  shift
  printf '%s\n' "$name"
  if ! "$@" >"$evidence/$name.log" 2>&1; then
    tail -45 "$evidence/$name.log" >&2
    return 1
  fi
}

check install pnpm install --frozen-lockfile
check format pnpm format:check
check lint pnpm lint
check contracts pnpm contracts:check
check parity pnpm parity:check
check typecheck pnpm typecheck
check build pnpm build
check root-unit pnpm test:unit
check api-unit pnpm --filter @brightwork/api test:unit
check api-research pnpm --filter @brightwork/api test:research
check api-growth pnpm --filter @brightwork/api test:growth

check initdb initdb -D "$scratch/pg" -A trust --no-locale -E UTF8 -U brightwork
check postgres-start pg_ctl -D "$scratch/pg" -l "$evidence/postgres.log" -w start \
  -o "-h 127.0.0.1 -p 45432 -c unix_socket_directories="
redis-server --bind 127.0.0.1 --port 46379 --save '' --appendonly no >"$evidence/redis.log" 2>&1 &
redis_pid=$!
mailpit --listen 127.0.0.1:48025 --smtp 127.0.0.1:41025 \
  --database "$scratch/mailpit.db" >"$evidence/mailpit.log" 2>&1 &
mail_pid=$!

export CI=1
export DATABASE_URL=postgresql://brightwork@127.0.0.1:45432/website_beta
export TEST_DATABASE_URL="$DATABASE_URL"
export WEBSITE_WORKER_TEST_DATABASE_URL=postgresql://brightwork@127.0.0.1:45432/website_worker
export REDIS_URL=redis://127.0.0.1:46379/14
export TEST_REDIS_URL="$REDIS_URL"
export TEST_MAILPIT_URL=http://127.0.0.1:48025
export SMTP_HOST=127.0.0.1 SMTP_PORT=41025 MAIL_FROM='Brightwork <hello@brightwork.test>'
export AUTH_SECRET=temporary-fixture-key-for-ephemeral-ci-only API_HOST=127.0.0.1
createdb -h 127.0.0.1 -p 45432 -U brightwork website_beta
createdb -h 127.0.0.1 -p 45432 -U brightwork website_worker
check migrate pnpm --filter @brightwork/api db:migrate
DATABASE_URL="$WEBSITE_WORKER_TEST_DATABASE_URL" check migrate-worker pnpm --filter @brightwork/api db:migrate

doctor() {
  local port pid url db
  for port in 45432 46379 41025 48025; do
    case "$port" in
      45432) pid="$(head -1 "$scratch/pg/postmaster.pid")" ;;
      46379) pid="$redis_pid" ;;
      *) pid="$mail_pid" ;;
    esac
    [[ "$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | sort -u)" == "$pid" ]] || return 1
  done
  [[ "$(redis-cli -u "$REDIS_URL" ping)" == PONG ]] || return 1
  curl -fsS --max-time 2 --retry 3 --retry-connrefused "$TEST_MAILPIT_URL/readyz" || return 1
  node --input-type=module -e '
    import { createHash } from "node:crypto";
    import { readFileSync } from "node:fs";
    const folder = "apps/api/drizzle/";
    const { entries } = JSON.parse(readFileSync(folder + "meta/_journal.json", "utf8"));
    for (const [position, { idx, when, tag }] of entries.entries()) {
      if (idx !== position || (position && entries[position - 1].when >= when))
        throw new Error(`Migration journal is out of order at ${tag}`);
      const hash = createHash("sha256").update(readFileSync(folder + tag + ".sql")).digest("hex");
      console.log(`${when}|${hash}`);
    }
  ' >"$evidence/expected-ledger.txt" || return 1
  for url in "$DATABASE_URL" "$WEBSITE_WORKER_TEST_DATABASE_URL"; do
    db="${url##*/}"
    psql "$url" -At -v ON_ERROR_STOP=1 -c \
      "select created_at, hash from drizzle.__drizzle_migrations order by id" \
      >"$evidence/$db-ledger.txt" || return 1
    diff -u "$evidence/expected-ledger.txt" "$evidence/$db-ledger.txt" || return 1
  done
  echo 'Owned services are ready and both ledgers match the journal.'
}

check doctor doctor
check worker pnpm --filter @brightwork/worker test
check api-integration pnpm --filter @brightwork/api test:integration
for suite in worker api-integration; do
  if ! grep -q '^# skipped 0$' "$evidence/$suite.log"; then
    echo "Cannot verify that every $suite case ran. See $evidence/$suite.log" >&2
    exit 1
  fi
done
check browser pnpm test --workers=2 --trace=retain-on-failure --output="$evidence/browser"
check production-browser pnpm test:ssr --trace=retain-on-failure --output="$evidence/ssr"
}

exec env -i PATH="$PATH" HOME="$HOME" LC_ALL=C \
  BROWSER_EXECUTABLE_PATH="${BROWSER_EXECUTABLE_PATH:-}" \
  bash -c "$(declare -f verify)"$'\n''verify "$@"' "$0" "$@"
