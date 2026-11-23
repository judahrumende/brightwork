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
- For `vault-credit-db`, set all of `TEST_DATABASE_URL` (or mirror into it from a disposable `DATABASE_URL`), `REDIS_URL`, and `TEST_MAILPIT_URL` with Mailpit reachable. Prefer a `bw_verify_*` database. Without those, only the unit portion runs.

- **Unit portion.** Run `pnpm verify:invariants`. stdout includes `BW-ARCH-10 invariant gate` and passes for `credit-amount` plus `observability`. Missing optional unit files print `skip missing` and are not failures.
- **DB portion.** When the auth env gate is met, the script runs focused integration files if present, otherwise `apps/api/test/auth.test.ts`. Exit code `0` and stdout ends with `BW-ARCH-10 passed.` The auth test must **run**, not skip.
- **Proof.** Capture the transcript with `pnpm verify:invariants 2>&1 | tee "$VERIFY_ROOT/invariants.log"`.

## Gotchas

- `auth.test.ts` skips unless `TEST_DATABASE_URL`, `TEST_MAILPIT_URL`, and `REDIS_URL` are all set. Treat a skip as inconclusive for vault, not as a pass, even when the script exits 0.
- Do not point the gate at the shared product database named `brightwork`.
- Focused files such as `run-credit-limits.integration.test.ts` and `github-site-sync.integration.test.ts` exist only on some branches; the script skips missing files.
- Unit-only success prints `BW-ARCH-10 unit portion passed.` That is not a vault proof.
