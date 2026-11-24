# API readiness

API readiness lets operators and deploy checks learn whether Brightwork’s API process is alive (`/health`) and whether its required dependencies answer (`/ready`).

## Sub-features

- `health-ok` returns HTTP 200 with `{"status":"ok"}` while the process listens.
- `ready-deps` probes Postgres and Redis and returns HTTP 200 with `"status":"ready"` when both answer.
- `ready-minio` includes a MinIO check only when `S3_ENDPOINT` is set.
- `ready-fail` returns HTTP 503 with per-check details when a required dependency is down.

## How to get to it (user POV)

- Call `GET /health` on the API host (or through Vite’s `/health` proxy when the web app is up).
- Call `GET /ready` on the API host (or through Vite’s `/ready` proxy).
- Inspect deploy readiness probes that hit those paths.

## Driving it with drive-ready

Preconditions:

- `VERIFY_SKIP_VITE=1 VERIFY_SKIP_WORKER=1 .cursor/skills/verify-brightwork/scripts/launch.sh` completed.
- `scripts/doctor.sh` passed with `VERIFY_EXPECT_READY=1`.
- `S3_ENDPOINT` is unset for the baseline ready path.

- **Liveness.** Request health. Run `curl -fsS "$VERIFY_API_BASE/health"`. Body is `{"status":"ok"}` and HTTP status is `200`.
- **Readiness.** Run `pnpm verify:ready`. Exit code `0`, `drive-ready.json` has `passed: true`, and `ready.json` lists postgres and redis checks with `ok: true` and no minio check.
- **Proof.** Keep `$VERIFY_ROOT/health.json`, `$VERIFY_ROOT/ready.json`, `$VERIFY_ROOT/drive-ready.json`, and `$VERIFY_ROOT/note.md`.

## Gotchas

- A shared `.env` that sets `S3_ENDPOINT` makes `/ready` fail when MinIO is down. Launch unsets S3 for baseline proofs.
- `/health` staying ok while `/ready` is 503 is expected when Postgres or Redis is unreachable; do not treat health alone as deploy-ready.
- The baseline driver does not exercise a dependency failure or a configured MinIO probe.
- Port `3018` is often busy on long-lived Macs. Default verify API port is `3028`.
- Do not drive a foreign API listener. Doctor must confirm `api.pid` owns `API_PORT`.
