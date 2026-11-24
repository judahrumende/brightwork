# Brightwork verification map

Maintained source for verifying Brightwork behavior on a disposable local stack. Read this index, then the matching feature file.

## Baseline preconditions

- Launch with `.cursor/skills/verify-brightwork/scripts/launch.sh` using a disposable `bw_verify_*` database and Redis logical DB `14`.
- Prefer `VERIFY_SKIP_VITE=1 VERIFY_SKIP_WORKER=1` for HTTP readiness proofs.
- Leave `S3_ENDPOINT` unset for baseline `/ready` proofs unless the recipe names MinIO.
- Run `scripts/doctor.sh` and require pass before driving.
- Never drive an instance this run did not start.

## Driving conventions

- Start each recipe from baseline unless its preconditions say otherwise.
- Prefer exact HTTP paths and ARIA names for UI.
- Treat commands as literal.
- Keep proof artifacts under `output/verify-brightwork/<run-id>/` through cleanup.

## Proof and skip reporting

- Capture the action and the resulting state.
- HTTP proof includes status code and JSON body files.
- Mutation proof includes a second user-facing read of the stored value.
- Record feature ID and entry point on every artifact.
- Unreachable paths report the unmet precondition; do not claim a different path verified them.

## Features

- [API readiness](./api-readiness.md) — `/health` liveness and `/ready` dependency probes.
- [Invariant gate](./invariant-gate.md) — credit and vault regression pack via `pnpm verify:invariants`.
- [Marketing gallery](./marketing-gallery.md) — Vite component gallery when the web surface is launched.

## Website beta

Use the [website beta verifier](../../../../.claude/skills/verify/SKILL.md). It owns its local services and runs its own doctor instead of the baseline launch above.

- [Owner signup](./owner-signup.md)
- [Pip plan, draft, and owner answer](./pip-website-draft.md)
- [Publish, revise, and roll back](./website-publication.md)
