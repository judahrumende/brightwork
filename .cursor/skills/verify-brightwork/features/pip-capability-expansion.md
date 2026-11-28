# Pip capability expansion

Prove the expanded Pip tool surface, Run power tiers, Run view endpoints, and memory search against an owned disposable stack.

## Sub-features

- `cap-run-power` — create a Run with `power: ultra` and `mode: ask_first`; list returns the same power.
- `cap-run-views` — `GET .../run/directions`, `.../report`, `.../earlier`, `.../tasks`, `.../questions` return shaped payloads with filled directions.
- `cap-memory-search` — insert a `memory` artifact and prove ILIKE title/body retrieval (same predicate as `agentStore.searchMemories`; the driver uses `psql` against the disposable DB).
- `cap-tool-catalog` — worker catalog includes `tool_search`, `memory_search`, `memory_read`, `draft_sms`, `send_sms`.

## Driving

```sh
set -a && source "$VERIFY_ROOT/launch.env" && set +a
.cursor/skills/verify-brightwork/scripts/doctor.sh
NODE_PATH="$(pwd)/node_modules" node \
  .cursor/skills/verify-brightwork/scripts/drive-pip-capability.mjs
```

## Proof

Under `$VERIFY_ROOT`: `session.json`, `begin.json`, `run-create.json`, `runs-list.json`, `directions.json`, `report.json`, `earlier.json`, `tasks.json`, `questions.json`, `memory-search.json`, `catalog.json`, `drive-pip-capability.json` with `"ok": true`, `note.md`.

## Gotchas

- Requires migration `0104_run_power` on the disposable DB (launch migrate applies it).
- Does not require a long model journey; catalog/memory/Run views are deterministic.
- PERSONAL_MODE only.
- Keep Redis DB 14 exclusive; foreign workers or prove restart loops can kill the stack mid-drive.
