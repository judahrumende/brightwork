# Run memory

## 2026-11-24 — PR #41 ship pass

- Resolved the merge with `origin/main` in `pr41-ship` only; the original dirty checkout remains untouched.
- Combined the verify-brightwork launch, doctor, cleanup, readiness, invariant, gallery, and mapped-feature changes. Fixed live/test payment labels and added checkout coverage.
- Disposable Postgres integration passed for `apps/api/test/stripe-connect.test.ts`; lint, typecheck, all 40 root unit tests, API unit tests, and worker tests passed.
- An earlier cleanup regression run exposed a surviving child, then passed after process-group cleanup. An earlier API integration attempt failed because an ordinary order omitted required delivery data; switched the fixture to the delivery-quote flow.
- PR #41 is open. `ship-pr inspect` confirmed current base `main` at `848f9441` and no pending auto-merge or queue entry. Do not merge without an independent user-flow verdict and current PR checks.
- First CI run failed Prettier on five verification files. Applied formatting only to those files. The follow-up CI run passed format, lint, contracts, parity, typecheck, build, unit, API, integration, Playwright, and SSR steps.
- Do not merge without an independent user-flow verdict and current PR checks. The documented Pip core journey and independent review remain outstanding.

## 2026-11-28 — PR #41 VERIFY_PGUSER selector unit

- On `dependent/pr41-verify-pguser-t_35cb2ba2` at exact #41 base `de2c6ad307a7a7a0bf75cf128f8799bdf77bdb91`, extracted the launcher's explicit `VERIFY_PGUSER`/`whoami` fallback into a sourceable selector and added focused DB-free assertions.
- Focused tests, Bash syntax, TypeScript Prettier, and ESLint passed after task-local provisioning of existing frozen dependencies; use supported Node 22 (`/opt/homebrew/opt/node@22/bin`) for final checks.
- Next: rerun focused checks under Node 22, audit scope, then commit only these four files and open a dependent PR if all checks and remote provenance pass. Do not alter PR #41.
