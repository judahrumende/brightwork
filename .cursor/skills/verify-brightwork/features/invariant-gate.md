# Invariant gate

The invariant gate reruns Brightwork’s credit arithmetic and vault/credit suite so architecture changes cannot silently break metering or encrypted workspace credentials.

## Sub-features

- `credit-units` proves exact ten-decimal credit math.
- `observability-unit` proves log-level parsing and ready-report shaping.
- `vault-credit-db` runs Postgres-backed auth/vault fixtures when `DATABASE_URL` or `TEST_DATABASE_URL` is set.

## How to get to it (user POV)

- Run `pnpm verify:invariants` from the repo root after changing credits, approvals, vault, or observability.
- CI or an agent runs the same script before merging architecture PRs.

## Driving it with verify:invariants

Preconditions:

- `pnpm install --frozen-lockfile` has completed in this checkout.
- For the Postgres portion, export a disposable `DATABASE_URL` (prefer a `bw_verify_*` database). Without it, only the unit portion runs and the script still exits 0 after printing that it skipped DB suites.

- **Unit portion.** Run `pnpm verify:invariants`. stdout includes `BW-ARCH-10 invariant gate` and `credit-amount` plus `observability` passes.
- **DB portion (when URL set).** With `DATABASE_URL` set to a migrated disposable DB, the script runs focused integration files when present, otherwise `apps/api/test/auth.test.ts`. Exit code `0` and stdout ends with `BW-ARCH-10 passed.`
- **Proof.** Capture the command transcript under `$VERIFY_ROOT/invariants.log` when this gate is part of a verify run.

## Gotchas

- `auth.test.ts` may skip when the suite’s own env gate is unmet even if `DATABASE_URL` is set. Treat a skip as inconclusive for vault, not as a pass.
- Do not point the gate at the shared product database named `brightwork`.
- Focused files such as `run-credit-limits.integration.test.ts` exist only on some branches; the script skips missing files.
