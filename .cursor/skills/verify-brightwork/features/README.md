# Brightwork verification map

Maintained source for verifying user-facing Brightwork behavior. Machine-readable index: [`map.json`](./map.json) (`pnpm verify:feature --list`). Read this index, then the matching feature file.

## Baseline preconditions

- Launch per `../SKILL.md` with disposable `bw_verify_*` database and Redis DB 14.
- `APP_ORIGIN` and `API_PORT` match (Vite `strictPort`).
- `PERSONAL_MODE=true` on loopback only for local unsigned sessions.
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
- Record feature ID and entry point on every artifact.
- Unreachable paths report the unmet precondition; do not claim a different path verified them.

## Features

- [Landing home](./landing-home.md) — marketing locale landing (e.g. `/en`) and account nav; not SPA `/home`.
- [Workspace creation](./workspace-creation.md) — `/new` starter idea path into a workspace.
- [Workbench home](./workbench-home.md) — signed-in personal workbench dock and overview.
- [Pip computer](./pip-computer.md) — Pip `use_computer` navigate/move/click/type/key/scroll/screenshot motion.
- [Build canvas](./build.md) — Build application and draft website surface.
