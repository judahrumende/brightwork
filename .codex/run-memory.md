# Run memory

## 2026-11-24 — PR #41 ship pass

- Resolved the merge with `origin/main` in `pr41-ship` only; the original dirty checkout remains untouched.
- Combined the verify-brightwork launch, doctor, cleanup, readiness, invariant, gallery, and mapped-feature changes. Fixed live/test payment labels and added checkout coverage.
- Disposable Postgres integration passed for `apps/api/test/stripe-connect.test.ts`; lint, typecheck, all 40 root unit tests, API unit tests, and worker tests passed.
- An earlier cleanup regression run exposed a surviving child, then passed after process-group cleanup. An earlier API integration attempt failed because an ordinary order omitted required delivery data; switched the fixture to the delivery-quote flow.
- PR #41 is open. `ship-pr inspect` confirmed current base `main` at `848f9441` and no pending auto-merge or queue entry. Do not merge without an independent user-flow verdict and current PR checks.
- First CI run failed Prettier on five verification files. Applied formatting only to those files; local format, lint, contract, and parity checks pass. Follow-up CI is still required.
- Do not merge without an independent user-flow verdict and current PR checks. The documented Pip core journey and independent review remain outstanding.
