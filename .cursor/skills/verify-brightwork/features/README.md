# Brightwork verification map

Maintained source for verifying user-facing Brightwork behavior. Machine-readable index: [`map.json`](./map.json) (`pnpm verify:feature --list`). Read this index, then the matching feature file.

## Baseline preconditions

- Launch per `../SKILL.md` with disposable `bw_verify_*` database and Redis DB 14.
- `APP_ORIGIN` (Vite) and `API_PORT` are distinct; Vite `strictPort` matches `APP_ORIGIN`.
- `PERSONAL_MODE=true` on loopback only for local unsigned sessions.
- Pip journey proofs need Ollama `qwen2.5:7b-instruct`, a worker from `launch.sh`, and `SITE_BASE_DOMAIN=127.0.0.1.nip.io:$API_PORT`.
- API readiness proofs can skip Vite and the worker with `VERIFY_SKIP_VITE=1 VERIFY_SKIP_WORKER=1`; they verify `/health` and `/ready`.
- Run `scripts/doctor.sh` and require pass before driving.
- Never drive an instance this run did not start.

## Driving conventions

- Start each recipe from baseline unless its preconditions say otherwise.
- Prefer ARIA roles/names and route paths.
- Treat commands as literal.
- Restore or drop disposable state in cleanup; keep proof artifacts.

## Proof and skip reporting

- Capture the action and the resulting state.
- UI proof: ARIA snapshot + screenshot with Brightwork identity visible.
- Computer proof: ordered frame PNGs and optional MP4 from the helper.
- Mutation proof: a second user-facing read of the stored value.
- HTTP proof: save status codes and response bodies.
- Record feature ID and entry point on every artifact.
- Unreachable paths report the unmet precondition; do not claim a different path verified them.

## Features

- [Landing home](./landing-home.md) — marketing locale landing (e.g. `/en`) and account nav; not SPA `/home`.
- [Workspace creation](./workspace-creation.md) — `/new` starter idea path into a workspace.
- [Workbench home](./workbench-home.md) — signed-in personal workbench dock and overview.
- [Pip computer](./pip-computer.md) — Pip `use_computer` navigate/move/click/type/key/scroll/screenshot motion.
- [Build canvas](./build.md) — Build application and draft website surface.
- [Pip core journey](./pip-core-journey.md) — idea → plan → site → publish → live/traffic → ask/answer → change approve (local qwen).
- [Pip capability expansion](./pip-capability-expansion.md) — Run power, Run views, memory search, expanded tool catalog.
- [Workbench polish](./workbench-polish.md) — legal pages, Home metrics hierarchy, Workspace Settings modal.
- [API readiness](./api-readiness.md) — `/health` liveness and `/ready` dependency probes.
- [Invariant gate](./invariant-gate.md) — credit and vault regression pack via `pnpm verify:invariants`.
- [Marketing gallery](./marketing-gallery.md) — Vite component gallery when the web surface is launched.
