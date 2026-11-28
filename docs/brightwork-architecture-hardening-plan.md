# Brightwork architecture hardening plan

## What changes

Brightwork stays a modular monolith with separate API and worker hosts. This plan shrinks the largest files, puts the 36 raw-SQL tables into Drizzle, moves binary blobs onto the MinIO already in `compose.yaml`, adds a worker image and a production-shaped compose stack, and gates optional Sentry plus readiness checks. Credit metering, approval gates, and vault encryption stay behavior-compatible. `packages/backend` extraction from [software-architecture-design.md](./software-architecture-design.md) stays a later wave after these PRs land.

Measured baseline (2026-11-23 checkout):

| Artifact                                | Size / state                                  |
| --------------------------------------- | --------------------------------------------- |
| `apps/api/src/workspace/routes.ts`      | 4450 lines                                    |
| `apps/web/src/workbench/agent.tsx`      | 2706 lines                                    |
| `apps/api/src/workspace/agent-store.ts` | 2340 lines                                    |
| Drizzle `schema.ts` tables              | 47 of 83 migration tables                     |
| S3 / MinIO usage in app code            | none (`S3_*` in `.env.example` only)          |
| Docker                                  | single root `Dockerfile` starts API only      |
| Health                                  | `GET /health` returns `{ status: "ok" }` only |

## Settled design choices

These were settled from current code and env evidence. No throwaway prototype was required.

1. **Keep the modular monolith.** Split files and add an `ObjectStore` port inside `apps/api`. Do not open `packages/backend` in this stack.
2. **Schema catch-up is declarative only.** Add the 36 missing tables to Drizzle to match existing migrations. Do not rewrite history or change column types in the schema PRs.
3. **Object storage targets binary blobs first.** Tables with `bytea` or large binary payloads: `media_jobs.asset`, `workspace_files.bytes`, `generated_app_files.bytes`, `generated_store_product_photos.content`. Site HTML in `website_versions` stays in Postgres until BW-ARCH-09 proves size pain.
4. **Dual-read, new-write cutover.** Add nullable `storage_key` (or equivalent) columns. New writes go to MinIO/S3. Reads prefer object storage, then fall back to bytea. Optional one-shot migrator later. Local and CI databases are disposable, so a hard cutover in test env is acceptable once dual-read passes.
5. **Route split is mechanical registration.** `registerWorkspace` becomes a thin composer that mounts domain route modules. Preserve HTTP paths and response shapes.

## PR landing order and dependency graph

```text
BW-ARCH-01  observability + readiness          (trunk)
BW-ARCH-10  credit / approval / vault gates    (trunk, parallel with 01)
BW-ARCH-02  ObjectStore + MinIO client         (after 01 preferred)
BW-ARCH-03  Drizzle schema catch-up            (trunk, parallel with 01–02)
BW-ARCH-05  split workspace routes             (after 10; parallel with 02–03)
BW-ARCH-06  split agent-store                  (after 10; prefer after 05)
BW-ARCH-07  split agent UI                     (trunk UI-only; review-gated)
BW-ARCH-04  blob storage migration             (needs 02 + 03; after 10)
BW-ARCH-08  worker Docker + prod compose       (needs 01 + 02)
BW-ARCH-09  optional site payload objects      (needs 04; only if measured)
```

Independent from trunk: `01`, `10`, `03`, `07`.
Blocked: `04` ← `02`+`03`; `08` ← `01`+`02`; `09` ← `04`.
Review-gated before merge: `07` (UI), any PR that changes interaction copy or layout.

## Cross-cutting verification baseline

Capture before BW-ARCH-04 and BW-ARCH-05 and rerun after each:

- `pnpm --filter @brightwork/api test:unit`
- Focused Postgres integrations already green in run-memory: Run proposal/approval, model credit cap, generated-app persistence
- `pnpm --filter @brightwork/worker test`
- Workspace `pnpm typecheck` and `pnpm lint`
- `GET /health` and (after 01) `GET /ready`

Do not call paid providers. Use MinIO from compose or CI.

---

## BW-ARCH-01 — Observability and readiness

- [ ] Depends on: none
- [ ] Files: `apps/api/src/server.ts`, `apps/api/src/auth/config.ts` (or shared config), `apps/worker/src/index.ts`, `.env.example`, optional `apps/api/src/observability/*`
- [ ] One change: env-gated structured logging and optional Sentry; add readiness that checks Postgres and Redis (MinIO when `S3_*` is set)
- [ ] Result you see: `GET /health` stays liveness; `GET /ready` returns 200 only when dependencies answer; with `SENTRY_DSN` unset, no Sentry network calls
- [ ] Verification
  - [ ] Unit: config parse rejects bad DSN shapes; ready handler unit with fake probes
  - [ ] Live: start API against local compose; `/health` 200; stop Redis and confirm `/ready` non-200; restore Redis and confirm `/ready` 200
  - [ ] Perf: `/health` p99 under 50 ms on local idle (probe with `curl` timing; fail if > 100 ms)

## BW-ARCH-10 — Credit, approval, and vault regression pack

- [ ] Depends on: none (land early so later PRs reuse it)
- [ ] Files: mostly `apps/api/test/*` plus a short checklist in `docs/` or verify-map entry; no product behavior change
- [ ] One change: one scripted gate that reruns the existing credit-limit, Run approval, and vault/settings isolation integrations (and records commands in the verify feature map if present)
- [ ] Result you see: one command fails the PR if metering, approval, or vault isolation regresses
- [ ] Verification
  - [ ] Unit: N/A beyond existing suites listed by the gate
  - [ ] Live: gate exits 0 on current main with local Postgres
  - [ ] Perf: gate wall time recorded; fail the plan estimate only if it doubles vs baseline without cause

## BW-ARCH-02 — ObjectStore port and MinIO client

- [ ] Depends on: prefer after BW-ARCH-01 (logging)
- [ ] Files: new `apps/api/src/storage/*`, config for `S3_*`, unit test with mock or local MinIO, `.env.example` comments
- [ ] One change: typed `ObjectStore` with `put` / `get` / `delete` / `exists`; AWS SDK (or compatible) client pointed at MinIO; no production call sites switched yet except a smoke path in tests
- [ ] Result you see: CI or local test uploads and reads a byte from MinIO using compose credentials
- [ ] Verification
  - [ ] Unit: key layout helpers; error mapping for missing objects
  - [ ] Live: compose MinIO up; put/get/delete round-trip against `S3_BUCKET`
  - [ ] Perf: 1 MiB put/get under 500 ms local; fail if > 2 s (rules out sync misconfig)

## BW-ARCH-03 — Bring raw-SQL tables into Drizzle schema

- [ ] Depends on: none
- [ ] Files: `apps/api/src/db/schema.ts` (or `schema/*.ts` re-exported), callers that define inline `pgTable` (for example `media-store.ts`), generated-store / stripe / shopify / sms / meta / referral modules
- [ ] One change: declare these 36 tables in schema to match migrations; switch inline table defs to imports; no SQL migrations that alter live shape
  - generated_app_*: activity, collections, function_mutations, invites, records, sessions, signins, users
  - generated_store_*: activity, buyer_sessions, buyers, delivery_quotes, discounts, email_outbox, order_lines, orders, product_photos, products, signins, stores
  - media_jobs; meta_page__; referral__; shopify__; sms__; stripe_sellers / sales / connect_events / store_refund_requests; website_visitor_events
- [ ] Result you see: `schema.ts` (module tree) exports 83 tables; stores typecheck against shared defs; migrations unchanged
- [ ] Verification
  - [ ] Unit: typecheck; existing store unit tests still pass
  - [ ] Live: `pnpm --filter @brightwork/api db:migrate` on empty DB still applies; one store integration that previously used raw SQL still passes
  - [ ] Perf: N/A (no runtime path change); mark N/A in PR

## BW-ARCH-05 — Split `workspace/routes.ts` by domain

- [ ] Depends on: BW-ARCH-10 green (regression pack available)
- [ ] Files: replace `apps/api/src/workspace/routes.ts` with a composer; add `apps/api/src/workspace/routes/*.ts` (suggested domains: pip-turns, runs, build, ted-chats, media, inbox-work, schedule, generated-apps, stores/commerce hooks already elsewhere, public-shares)
- [ ] One change: move handlers without changing paths, auth checks, or payloads
- [ ] Result you see: no file over ~800 lines in the routes tree; `registerWorkspace` still the only public register entry
- [ ] Verification
  - [ ] Unit: route module imports resolve; typecheck
  - [ ] Live: hit a representative path per module (pip turn create, media list, inbound list, website import, app users) against local API; compare status codes to pre-split notes
  - [ ] Perf: cold registerWorkspace import time vs trunk baseline; fail if > 2× (catch circular import tax)

## BW-ARCH-06 — Split `agent-store.ts`

- [ ] Depends on: BW-ARCH-10; prefer after BW-ARCH-05 so HTTP and store seams align
- [ ] Files: `apps/api/src/workspace/agent-store.ts` → façade plus modules such as `agent-turns.ts`, `agent-artifacts.ts`, `agent-websites.ts`, `agent-work-queries.ts`
- [ ] One change: preserve `agentStore(db)` public methods and queue helpers; move implementations by data ownership
- [ ] Result you see: façade under ~300 lines; worker and API still import the same entry
- [ ] Verification
  - [ ] Unit: existing agent/store-adjacent unit tests
  - [ ] Live: Run proposal/approval Postgres integration; generated-app persistence; duplicate artifact write race
  - [ ] Perf: N/A unless a hot query moves; if so, explain the number against the same integration timing

## BW-ARCH-07 — Split `agent.tsx` UI

- [ ] Depends on: none (UI-only); **operator UI review before merge**
- [ ] Files: `apps/web/src/workbench/agent.tsx` → hooks (`usePipTurns`, events), `PipChat`, `WorkList`, `SiteTools`, shared types
- [ ] One change: extract components and hooks; preserve behavior and CSS module bindings
- [ ] Result you see: entry file is a thin re-export or shell; Pip chat and work list still render
- [ ] Verification
  - [ ] Unit: web typecheck; existing browser tests that touch Pip/workbench
  - [ ] Live: manual or Playwright open workbench chat, send fixture turn, open work list item
  - [ ] Perf: N/A or bundle size delta; fail if workbench entry grows > 10% gzipped without cause

## BW-ARCH-04 — Move binary blobs to S3/MinIO

- [ ] Depends on: BW-ARCH-02, BW-ARCH-03, BW-ARCH-10
- [ ] Files: `media-store.ts`, workspace file / inbound save paths, `generated-app-storage.ts`, `generated-store` photo paths, new migrations adding `storage_key` (and nullable bytea where needed), worker media completion path
- [ ] One change: write blobs through `ObjectStore`; dual-read; keep metadata and auth in Postgres
- [ ] Result you see: new media/file/photo/app-file bytes land in MinIO; download endpoints still return the same bytes and headers; credit debit for media unchanged
- [ ] Verification
  - [ ] Unit: media-store and attachment tests with fake ObjectStore
  - [ ] Live: enqueue media job with fixture provider, confirm MinIO object exists and `/media/:id/asset` matches; inbound save-files integration; store product photo fetch; generated app file download
  - [ ] Perf: 1 MiB media asset serve p95 vs trunk bytea baseline; fail if > 2× slower on local MinIO without explanation
  - [ ] Invariants: BW-ARCH-10 gate still green

## BW-ARCH-08 — Worker Docker and production-oriented compose

- [ ] Depends on: BW-ARCH-01, BW-ARCH-02
- [ ] Files: root `Dockerfile` (multi-stage or targets for `api` and `worker`), `compose.prod.yaml` (or `infra/compose.prod.yaml`), entrypoint scripts, Caddy/nginx snippet for `SITE_BASE_DOMAIN` wildcard → API public site handler, README deploy section
- [ ] One change: build and run API + worker + Postgres + Redis + MinIO (+ edge) with documented env; worker CMD runs `@brightwork/worker` start
- [ ] Result you see: `docker compose -f compose.prod.yaml up` (or documented equivalent) serves `/health` and `/ready`, worker process consumes a test job, MinIO healthy, wildcard host header reaches publication handler when `SITE_BASE_DOMAIN` is set
- [ ] Verification
  - [ ] Unit: N/A
  - [ ] Live: build images; compose up; `/ready` 200; enqueue no-op or fixture turn and observe worker log claim; MinIO health ready
  - [ ] Perf: image build time recorded once; not a merge gate unless it exceeds 20 minutes on CI runners

## BW-ARCH-09 — Optional site / build payload objects

- [ ] Depends on: BW-ARCH-04; **only start after measuring** `website_versions.document` / `pages` / generated-app source size on a real workspace dump or load test
- [ ] Files: publication + agent website save paths, schema for object keys on versions/source revisions
- [ ] One change: large revision payloads by object key; API still assembles HTML for public hosts
- [ ] Result you see: publish and rollback still exact-revision; public host returns same HTML
- [ ] Verification
  - [ ] Unit: publication policy tests
  - [ ] Live: publish revision, fetch public page, rollback, fetch again
  - [ ] Perf: publish path timing vs BW-ARCH-04 baseline; fail if p95 > 2×
  - [ ] Skip criterion: if p95 document size under 256 KiB in measured sample, defer indefinitely and close as not started

---

## Out of scope for this stack

- Extracting `packages/backend` or changing worker imports away from `@brightwork/api` (next architecture wave)
- Microservices, generic workflow engine, or rewriting credit/approval/vault algorithms
- Live Stripe / Meta / Railway provisioning
- Force-push, production deploys, or data deletion without an explicit operator go

## What stays unproven until execution

- Local Docker Compose plugin availability on the operator Mac (prior run-memory noted missing Compose plugin; CI has MinIO)
- Disk headroom for full compose (earlier verify runs hit disk-full)
- Whether BW-ARCH-09 is needed at all
- Cross-host import graph for a future `packages/backend` move

## Execution note

Multi-phase plan deliverable ends here. Implementation starts only on an explicit operator go. Prefer `foundable-engineering` dispatch into a detached worktree so the primary checkout and parity work stay intact. Run one PR box at a time. Keep BW-ARCH-10 green across storage and split PRs.
