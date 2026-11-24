# Brightwork / Pip status — 2026-11-23

## Local foundation

- Declarative schemas, costs, dependencies and registry assembly live in `apps/worker/src/pip-tools.ts`; `agent.ts` owns orchestration and run-scoped handlers. Registry assembly fails when an operational handler is missing, and availability comes from dependency metadata. Publish/email effects retain owner-approval gates.
- Invalid tool JSON or schema-invalid batches are rejected before handler execution, repaired at most once, and then fail deterministically. Transient model failures receive one separately metered retry.
- `AGENT_MAX_MODEL_CALLS` defaults to 12 and accepts 6–30. One budget covers Run planning, retries, nested website/app generation, the outer Pip loop and optional suggestions. Persisted model debits enforce the cap across BullMQ retries; worker retries use distinct model debit keys and stable tool keys.
- Keyless Ollama requires an explicit base URL in both API and worker config. The installed local model's prior structured tool-call response was malformed; the installed model is unchanged. Prefer fake-model verification and do not repeat the probe without a material model/config change.
- Retry guard: each `running` tool part now stores its validated input. Stalled and ordinary BullMQ retries fail closed when an earlier proposal has an uncertain outcome, preserving it for owner review rather than blindly repeating an effect. Safe automatic replay still requires per-handler transactional idempotency.
- Artifact write idempotency: under the per-turn database lock, exact same-turn non-website artifacts with matching kind, state, title, body and schedule fields return the existing record. Task automation insertion ignores an existing task key. This covers document, memory, email/post draft and reminder writes; external effects still need their own provider idempotency.
- Website build persistence is atomic with turn completion: `saveGeneratedWebsite` saves the artifact, version and related build data, marks the build tool part completed, and completes the turn in one transaction. A duplicate call cannot pass the running-turn check. The generated-app integration now verifies a second call leaves the original site as the only result.
- Existing operational boundaries: email queue uses a unique artifact/revision and Resend sends a stable provider idempotency key; publication requests are unique by artifact/revision and publishing an already-live exact revision is an unchanged success. Browser `use_computer` actions can mutate external pages and are still not replay-safe; automatic worker retries fail closed when their outcome is uncertain.
- Pip computer slice 1: `use_computer` (navigate/move/click/type/key/scroll/screenshot) via `apps/worker/src/computer-session.ts`. Fake session for tests; optional Playwright CDP when `COMPUTER_ENABLED=true` (lazy Chromium on first action, worker concurrency 1). The worker declares `playwright-core`; browser control remains disabled unless configured.

## Verification

- Current focused verification: worker tests 80/80; API unit tests 26/26; local Postgres integrations 6/6 (model credit cap, concurrent draft/reminder idempotency, Run question answer/resume, publication approval, email delivery, generated-app persistence); full workspace typecheck, Prettier and `git diff --check` pass. Node 26.7.0 still warns against the declared >=22 <25 engine range.
- Agent trust garden phase 1: ESLint enforces the web/api/worker/shared import graph, bans `@ts-ignore`/`any`, and allowlists intentional web timers. Feature map at `.cursor/skills/verify-brightwork/features/map.json`; `pnpm verify:feature` / `pnpm verify:doctor`; pointers in `docs/agent-trust.md` and `AGENTS.md`. Spec/plan under `docs/superpowers/`.
- PR #41 ship worktree: merged current `main` into the PR branch; lint, typecheck, build, 40 root unit tests, API unit tests, worker tests, cleanup regression, and Stripe/storefront Postgres integration pass. Pip journey and independent user-flow review are still required before landing.

## Remaining acceptance gates

The full landing → signup → Pip plan → generated multi-page site → live publish → owner answer → approved change journey is unverified. Current presence-only prerequisite check: `SITE_BASE_DOMAIN` empty; `AUTH_RESEND_API_KEY` and `GOOGLE_CLIENT_ID` empty; SMTP host is loopback on port 1025, so it is not proof of real signup delivery. The configured hosted model previously returned HTTP 402. The only installed Ollama model remains `eriktonon/qwen3.8-uncensored:latest`, unchanged; its earlier structured tool call was malformed. No model/provider/live journey call was made during this check.

Mac Mini enable path (when wanted): set `COMPUTER_ENABLED=true`, optionally `COMPUTER_CHROMIUM_PATH` to system Chrome.

## Resume point

The remaining acceptance work requires a reliable free model path, publish domain and real signup delivery. Resume with the full journey when one becomes available; do not repeat paid inference or the Ollama probe. Keep the fail-closed retry guard for browser actions and preserve email/publication approvals. Preserve the dirty worktree; see `HANDOFF.md`, `.codex/pip-computer/design.md` and `.codex/pip-agent-architecture/` for detail.
