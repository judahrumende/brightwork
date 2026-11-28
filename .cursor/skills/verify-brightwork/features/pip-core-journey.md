# Pip core journey

End-to-end owner path on a disposable stack with local Ollama `qwen2.5:7b-instruct`: create a workspace from an idea, have Pip save a plan and multi-page website draft, approve and publish to a nip.io host, observe live HTTP 200 and traffic, answer an `ask_owner` question, then approve and republish a change revision.

## Sub-features

- `journey-session` — personal-mode session via `POST /api/me/session` through the Vite proxy with matching `Origin`.
- `journey-begin` — `POST /api/me/companies/begin` with business name + idea.
- `journey-plan-build` — Pip turn that `write_document`s a plan and `build`s a website draft (no publish).
- `journey-approve-publish` — owner `decision` then `publish` on the website work item.
- `journey-live` — fetch the published site on `$SITE_ID.$SITE_BASE_DOMAIN`.
- `journey-activity` — read `GET .../traffic` after live visits.
- `journey-answer` — Pip `ask_owner` question answered via `POST .../work/:id/answer`.
- `journey-change` — second build revision, approve, republish, live 200 again.

## How to get to it (user POV)

1. Open Brightwork locally (`APP_ORIGIN`), continue in personal mode (loopback).
2. Create a workspace from `/new` with a cafe-notebook idea (or the same begin API the UI uses).
3. Ask Pip (Build/composer) to draft a plan + multi-page site without publishing.
4. Open Work, approve the website, publish it.
5. Visit the live URL; check traffic on the workbench.
6. When Pip asks a question, answer it; request a small homepage change; approve and publish again.

## Driving it with drive-pip-journey

Preconditions:

- `scripts/launch.sh` finished (`ready`); Redis logical DB `14`; disposable `bw_verify_*` DB.
- `scripts/doctor.sh` passes, including Ollama model `qwen2.5:7b-instruct` and a live worker PID.
- `SITE_BASE_DOMAIN` is `127.0.0.1.nip.io:$API_PORT` (set by launch).
- Do not drive the shared `.env` database or a foreign port listener.

```sh
# Prefer VERIFY_SKIP_VITE=1 on 8–16GB hosts (API+worker only; driver talks to API).
VERIFY_SKIP_VITE=1 .cursor/skills/verify-brightwork/scripts/launch.sh
set -a && source "$VERIFY_ROOT/launch.env" && set +a
.cursor/skills/verify-brightwork/scripts/doctor.sh
NODE_PATH="$(pwd)/node_modules" node \
  .cursor/skills/verify-brightwork/scripts/drive-pip-journey.mjs
```

Proof artifacts under `$VERIFY_ROOT`:

- `session.json`, `begin.json`, `turn-plan.json`, `plan-final.json`
- `work-summary.json`, `approve.json`, `publish.json`
- `live-home.html`, `live-meta.json` (HTTP 200)
- `traffic.json`, `turn-ask.json`, `answer.json`
- `turn-change.json`, `approve2.json`, `publish2.json`, `live2-meta.json`
- `drive-pip-journey.json` with `"ok": true`, `note.md`

Observable end state: website revision ≥ 2 published; live host returns 200; question answered; `drive-pip-journey.json` ok.

## Gotchas

- Origin mismatch (`APP_ORIGIN` ≠ Vite port) → 403 on session/begin.
- Without a worker, turns stay `queued` forever — doctor must see `worker.pid`.
- 8GB hosts need the launch defaults (`LLM_MAX_TOKENS=1536`, `LLM_NUM_CTX=4096`); larger ctx OOMs.
- `qwen2.5:7b-instruct` may under-shoot “3 pages”; still require a website + document. Do not weaken the journey to skip publish/answer/change.
- Change/rebuild prompts must ban CSS `url()` / `@import` (website builder verification). The driver retries once with that constraint explicit.
- PERSONAL_MODE proves local unsigned continue, not Resend/OAuth signup.
- Full journey routinely takes 15–30+ minutes of model time; do not cut timeouts below the helper defaults.
- The helper requests `GET .../traffic` (no `range` query). Treat traffic as best-effort evidence unless status is 200 with visit rows after live fetches.
- On 8–16GB hosts: `preflight-kill.sh` then `VERIFY_SKIP_VITE=1` (API+worker supervisors; driver uses `VERIFY_API_BASE` + Postgres status fallback). Foreign workers starve Ollama — refuse until preflight is clear. Host OOM (exit 137) mid-turn is a machine issue, not a weakened journey.
- Cleanup drops only `bw_verify_*` and owned PIDs; evidence under `output/verify-brightwork/` stays.
