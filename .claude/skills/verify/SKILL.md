---
name: verify
description: Drive Brightwork's website beta through its browser, API, and Pip worker checks. Use before release review or after signup, planning, publication, or rollback changes.
---

# Verify Brightwork

Run from a clean worktree with no `.env` overrides. The [Brightwork feature map](../../../.cursor/skills/verify-brightwork/features/README.md) is the only verification map.

## Launch

Use Node `22` from `.node-version` and the pnpm version in `package.json`. Install PostgreSQL 16 client and server tools, Redis, Mailpit, and `lsof`. If you don't have Chromium, run `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`. On Linux install Chromium's system dependencies with `pnpm exec playwright install-deps chromium`.

```sh
.cursor/skills/verify-brightwork/scripts/website-beta.sh
```

Set `BROWSER_EXECUTABLE_PATH` to use an installed Chrome instead. Run only one verifier at a time. It refuses occupied ports and repository `.env` overrides. It starts disposable loopback services and migrates empty databases. Playwright starts the web servers and waits for HTTP before driving them. The verifier clears inherited provider settings and keeps your `PATH` and `HOME` for installed tools and caches.

## Doctor

Require `doctor` to pass before reading browser or integration results. Check `doctor.log` for process ownership and the ledger comparison. Both database ledgers must match the candidate's ordered migration timestamps and checksums. Check `note.txt` for the Git commit and any local changes. Do not cite a dirty run as proof for a clean commit.

## Drive

Use the [feature recipes](../../../.cursor/skills/verify-brightwork/features/README.md#website-beta). The verifier drives the full Playwright and SSR suites plus root, API, and worker checks. It uses native services instead of Compose and does not start MinIO. The [release briefing](../../../.codex/release/README.md) records hosted and migration gates.

## Evidence

Use `output/verify-brightwork/website-beta.*/note.txt` and the named command logs. The verifier retains failed browser traces. Record the actual assertion and the resulting state, not just the command exit. Treat browser route stubs, injected provider replies, and an owner answering in a fixture as local evidence only. For authorized hosted acceptance, capture the action, the revision, and the subsequent public read. Do not capture auth codes, cookies, credentials, or real customer data.

## Cleanup

The verifier stops its own PostgreSQL, Redis, and Mailpit on normal exit or failure. Playwright shuts down its own servers. Confirm `cleanup=complete` appears in `note.txt` and that evidence still exists. Do not stop unrelated processes or delete their data.

## Helpers

Use [`website-beta.sh`](../../../.cursor/skills/verify-brightwork/scripts/website-beta.sh) for the beta. Use [the existing Brightwork verifier](../../../.cursor/skills/verify-brightwork/SKILL.md) for standalone readiness and gallery checks.
