# API readiness

API readiness lets an operator check that the Brightwork API is alive and that its required Postgres and Redis services answer.

## Sub-features

- `health-ok` returns HTTP 200 and `{"status":"ok"}` while the API listens.
- `ready-deps` returns HTTP 200 and `"status":"ready"` when Postgres and Redis answer.
- `owned-port` refuses to drive an API listener not started by this run.

## How to get to it (user POV)

- Open `GET /health` on the API host to check liveness.
- Open `GET /ready` on the API host to check Postgres and Redis.

## Driving it with verify-brightwork

Preconditions:

- Launch with `VERIFY_SKIP_VITE=1 VERIFY_SKIP_WORKER=1`.
- Run `.cursor/skills/verify-brightwork/scripts/doctor.sh` and require `doctor complete`.
- Keep `S3_ENDPOINT` unset so this recipe checks only Postgres and Redis.

- **Check health.** Run `curl -fsS -o "$VERIFY_ROOT/health.json" -w '%{http_code}\n' "$VERIFY_API_BASE/health"`. Require HTTP 200 and `{"status":"ok"}`.
- **Check readiness.** Run `NODE_PATH="$(pwd)/node_modules" node .cursor/skills/verify-brightwork/scripts/drive-ready.mjs`. Require exit code `0`, `passed: true` in `drive-ready.json`, and successful Postgres and Redis checks in `ready.json`.
- **Proof.** Keep `health.json`, `ready.json`, `drive-ready.json`, and `doctor.txt` under `$VERIFY_ROOT`.

## Gotchas

- `/health` can pass while `/ready` fails. Liveness is not dependency readiness.
- The API-only launch does not create a user account. These two routes do not require authentication.
- Do not drive a port that the doctor cannot match to this run's PID.
- If Redis logical database 14 is in use by another verification run, stop and choose another approved isolated setup rather than sharing it.
