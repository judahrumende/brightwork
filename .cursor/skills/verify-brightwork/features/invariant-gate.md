# Invariant gate

The invariant gate reruns Brightwork’s credit arithmetic and vault/credit suite so architecture changes cannot silently break metering or encrypted workspace credentials.

## Sub-features

- `credit-units` proves exact ten-decimal credit math.
- `observability-unit` proves log-level parsing and ready-report shaping.
- `vault-credit-db` runs Postgres-backed auth/vault fixtures when the auth suite env gate is met.

## How to get to it (user POV)

- Run `pnpm verify:invariants` from the repo root after changing credits, approvals, vault, or observability.
- Agents run the same script before merging architecture PRs. Wire it into CI when that workflow is ready; it is not invoked by `.github/workflows/ci.yml` yet.

## Driving it with verify:invariants

Preconditions:

- `pnpm install --frozen-lockfile` has completed in this checkout.
- For the unit portion, no database is required.
- For `vault-credit-db`, set `TEST_DATABASE_URL` to the owned `bw_verify_*` database. Set `REDIS_URL` to the isolated Redis instance, and set `TEST_MAILPIT_URL`, `SMTP_HOST`, and `SMTP_PORT` to the same Mailpit instance. The test uses SMTP to send and HTTP to read the message.

- **Unit portion.** Run `pnpm verify:invariants`. stdout includes `BW-ARCH-10 invariant gate` and passes for `credit-amount` plus `observability`. Missing optional unit files print `skip missing` and are not failures.
- **DB portion.** On the website release branch, the script falls back to `apps/api/test/auth.test.ts`. Require an unskipped pass for `email and OAuth sign-in establish sessions and isolate workspace records`. If focused files replace the fallback on another branch, confirm their assertions cover the specific invariant before marking it verified.
- **Proof.** In Bash, run `set -o pipefail` before `pnpm verify:invariants 2>&1 | tee "$VERIFY_ROOT/invariants.log"`. Check the test results, not just the final banner.

## Gotchas

- A database URL alone selects the database phase. The wrapper can exit 0 even if absent provider settings caused `auth.test.ts` to skip. A skip does not prove the vault.
- Do not point the gate at the shared product database named `brightwork`.
- Focused files such as `run-credit-limits.integration.test.ts` and `github-site-sync.integration.test.ts` exist only on some branches; the script skips missing files.
- Unit-only success prints `BW-ARCH-10 unit portion passed.` That is not a vault proof.
