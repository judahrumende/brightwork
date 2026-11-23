# Agent trust garden (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Brightwork agent-safe by default via ESLint import boundaries, pragmatic footgun bans, a machine-readable verify feature map, and thin prose pointers.

**Architecture:** ESLint-first organic architecture on the existing monorepo graph (worker→api allowed). Verification reuses `verify-brightwork`; add `map.json` + lookup/doctor npm scripts. No `packages/backend` extraction.

**Tech Stack:** ESLint 9 flat config, typescript-eslint, Node scripts, existing Playwright verify skill.

## Global Constraints

- Do not extract `packages/backend` or split god-files.
- Do not ban product `useEffect` or mass-delete comments.
- Worker may import `@brightwork/api` and `@brightwork/shared`.
- Weed-pull only what new lint breaks; allowlist intentional timer modules.
- Preserve unrelated dirty worktree changes; commit only agent-trust files.
- Spec: `docs/superpowers/specs/2026-11-23-agent-trust-garden-design.md`.

---

### Task 1: ESLint import graph + footgun rules

**Files:**

- Modify: `eslint.config.mjs`
- Modify: `package.json` (only if a comments plugin is required; prefer built-in rules first)

**Interfaces:**

- Consumes: existing flat config ignores (`routeTree.gen.ts`, `api-contracts.gen.ts`, kit, reference-v1)
- Produces: enforced import graph + bans; `pnpm lint` green

- [ ] **Step 1: Extend `eslint.config.mjs`**

Add per-package `no-restricted-imports` blocks matching the design table. Add `@typescript-eslint/ban-ts-comment` (ban `@ts-ignore`; allow `@ts-expect-error` with description). Add `@typescript-eslint/no-explicit-any` for `apps/**` and `packages/**` (generated already ignored). Add `no-restricted-globals` / `no-restricted-syntax` for `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback` under `apps/web/**/*.{ts,tsx}` with an override allowlisting:

```
apps/web/src/workbench/workbench.tsx
apps/web/src/workbench/app-dashboard.tsx
apps/web/src/workbench/session.tsx
apps/web/src/workbench/agent.tsx
apps/web/src/workbench/workspace-files.tsx
apps/web/src/workbench/performance-quality.ts
apps/web/src/ui/landing.tsx
apps/web/src/workbench/tutorial-hub.tsx
apps/web/src/workbench/timed-calendar.tsx
apps/web/src/routes/share.$token.tsx
apps/web/src/workbench/website-editor.tsx
apps/web/src/sky/clouds.worker.ts
```

Messages must tell agents the root fix (shared contracts / HTTP / allowlisted helper), not “add a comment.”

For `eslint-disable` descriptions: if adding `@eslint-community/eslint-plugin-eslint-comments` is cheap and installs cleanly, enable `require-description`; otherwise document the standing rule in `docs/agent-trust.md` and skip the plugin.

- [ ] **Step 2: Run lint and fix only new violations**

Run: `pnpm lint`
Expected: PASS (or only fixable violations outside allowlists)

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "chore: enforce agent-trust ESLint boundaries and footgun bans"
```

(Only stage lockfile if a dependency was added.)

---

### Task 2: Feature map.json + verify scripts

**Files:**

- Create: `.cursor/skills/verify-brightwork/features/map.json`
- Modify: `.cursor/skills/verify-brightwork/features/README.md`
- Create: `.cursor/skills/verify-brightwork/scripts/verify-feature.mjs`
- Modify: `package.json` (scripts `verify:doctor`, `verify:feature`)
- Modify: `.cursor/skills/verify-brightwork/SKILL.md` (point at map + scripts)

**Interfaces:**

- Consumes: existing feature markdown ids (`landing-home`, `workspace-creation`, `workbench-home`, `pip-computer`, `build`)
- Produces: `map.json` schema with `features[]` and `unmapped[]`; CLI prints recipe path + proof files

- [ ] **Step 1: Write `map.json`**

Shape:

```json
{
  "version": 1,
  "features": [
    {
      "id": "landing-home",
      "recipe": "features/landing-home.md",
      "entryRoutes": ["/en"],
      "preconditions": ["doctor-or-vite-shell"],
      "proof": ["landing-home.png", "aria-snapshot"]
    }
  ],
  "unmapped": [
    { "id": "inbox", "note": "No verify recipe yet" },
    { "id": "schedule", "note": "No verify recipe yet" },
    { "id": "settings", "note": "No verify recipe yet" },
    { "id": "library", "note": "No verify recipe yet" },
    { "id": "commerce", "note": "No verify recipe yet" }
  ]
}
```

Fill remaining mapped features from existing markdown.

- [ ] **Step 2: Write `verify-feature.mjs`**

CLI: `node .cursor/skills/verify-brightwork/scripts/verify-feature.mjs <feature-id>`  
Prints id, recipe path, entry routes, proof list. Exit 1 on unknown id. Optional `--smoke` only if `APP_ORIGIN` set (GET entry route); otherwise skip smoke with a clear line.

- [ ] **Step 3: Wire package scripts**

```json
"verify:doctor": "bash .cursor/skills/verify-brightwork/scripts/doctor.sh",
"verify:feature": "node .cursor/skills/verify-brightwork/scripts/verify-feature.mjs"
```

Note in SKILL/docs that `verify:doctor` requires launch env (`VERIFY_ROOT`, etc.).

- [ ] **Step 4: Smoke the lookup**

Run: `pnpm verify:feature landing-home`  
Expected: prints recipe + routes; exit 0

- [ ] **Step 5: Commit**

```bash
git add .cursor/skills/verify-brightwork package.json
git commit -m "chore: add machine-readable verify feature map and lookup CLI"
```

---

### Task 3: Prose pointers

**Files:**

- Create: `docs/agent-trust.md`
- Modify: `AGENTS.md`
- Modify: `.cursor/skills/verify-brightwork/features/README.md` (link map.json)

**Interfaces:**

- Consumes: design + map + lint rules
- Produces: thin pointers only

- [ ] **Step 1: Write `docs/agent-trust.md`** — pyramid, import table, lint commands, verify paths, “encode corrections as lint/map.”
- [ ] **Step 2: Add Agent trust section to `AGENTS.md`** pointing at that doc, `pnpm lint`, feature map, verify skill.
- [ ] **Step 3: Commit**

```bash
git add docs/agent-trust.md AGENTS.md .cursor/skills/verify-brightwork/features/README.md
git commit -m "docs: point agents at trust garden lint and verify map"
```

---

### Task 4: Final verification + run memory

- [ ] **Step 1:** `pnpm lint && pnpm format:check` (format only agent-trust touched files if needed)
- [ ] **Step 2:** `pnpm verify:feature landing-home` and `pnpm verify:feature missing-id` (expect exit 1)
- [ ] **Step 3:** Append `.codex/run-memory.md` entry; update `STATUS.md` briefly if appropriate
- [ ] **Step 4:** Commit run-memory/STATUS if changed

```bash
git add .codex/run-memory.md STATUS.md
git commit -m "docs: record agent-trust garden phase 1 completion"
```
