# Brightwork API verification map

Use this map to prove the API behavior changed by this package. Start from a fresh run in the root `verify-brightwork` disposable stack. Never drive a server or database that this run did not create.

## Baseline

- Use Node 22.5 through 24.x and install workspace dependencies.
- Launch with `VERIFY_SKIP_VITE=1` and `VERIFY_SKIP_WORKER=1`.
- Use the unique `bw_verify_<run-id>` database and a dedicated Redis process on port 16379, logical database 14.
- Run the root `doctor.sh` and require `doctor complete`.
- Keep proof under `output/verify-brightwork/<run-id>/`.
- Never provide a live LLM key to the verification process.

## Features

- [Pip budget guard](./pip-budget.md) proves the pinned model request and shared weekly reservations with a fake provider.
- [API readiness](./api-readiness.md) proves the owned API's health and dependency readiness.
- [Budget key enrollment](./budget-enrollment.md) documents the owner-only setup path and the boundary that this run must not call.
