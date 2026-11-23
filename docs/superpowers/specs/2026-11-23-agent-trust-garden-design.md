# Agent trust garden (Lauren Tan) — design

Date: 2026-11-23  
Status: approved for implementation planning  
Source: Lauren Tan / SpaceX SI talk “All Code Is Slop (Except Mine)” (transcript)

## Problem

Agents treat the Brightwork codebase as a primary input. Workarounds, weak boundaries, and unenforceable prose get copied. Velocity without trust produces more slop and burns tokens on correction. We need a high-trust agent environment so future builds default to good patterns.

## Goals

- Raise trust using Lauren’s inverse pyramid: code/architecture → deterministic checks → verification → prose last.
- Make phase 1 **agent-safe by default** without modular monolith extraction.
- Encode corrections as lint or feature-map entries, not longer `AGENTS.md` essays.

## Non-goals (deferred)

- `packages/backend` extraction / god-file splits (`docs/software-architecture-design.md` remains the later map).
- Near-bans of product `useEffect` or most comments.
- Formal verification (TLA+/Lean) or property-based UI fuzz.
- Full feature recipes for every workbench surface.
- Automating an outer “software factory” loop before foundations hold.

## Scope decisions

| Decision           | Choice                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Overall program    | Full garden (C): foundations → verification → weed removal, phased                                                    |
| Phase 1 done means | Agent-safe by default (A): boundaries + lint green in CI; feature map + verify path; only weeds that new lint forbids |
| Ban aggressiveness | Pragmatic (A): import graph + footguns; keep `useEffect`; no comment mass-ban                                         |
| Approach           | ESLint-first organic architecture (not dependency-cruiser-first, not prose-first)                                     |

## Architecture — trust layers

```text
Prose (thin)          AGENTS.md + docs/agent-trust.md pointers
        ↑
Verification          Feature map + verify-brightwork drivers + evidence
        ↑
Deterministic checks  ESLint import graph + pragmatic bans (CI)
        ↑
Code / patterns       Allowed dependency graph; allowlisted intentional escapes
```

### Allowed import graph (phase 1)

| From              | May import                              | Must not import                                                          |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `apps/web`        | `@brightwork/shared`                    | `@brightwork/api`, `@brightwork/worker`, `apps/api/**`, `apps/worker/**` |
| `apps/api`        | `@brightwork/shared`                    | `@brightwork/web`, `@brightwork/worker`, `apps/web/**`, `apps/worker/**` |
| `apps/worker`     | `@brightwork/api`, `@brightwork/shared` | `@brightwork/web`, `apps/web/**`                                         |
| `packages/shared` | (its own deps only)                     | any `apps/**`, `@brightwork/{web,api,worker}`                            |

Worker → API remains allowed until a later `packages/backend` extraction. Relative path escapes across package roots are forbidden the same way as package imports.

## Deterministic checks

Extend root `eslint.config.mjs`. CI already runs `pnpm lint` in `.github/workflows/ci.yml`.

### Import / layer rules

- `no-restricted-imports` (and equivalent path patterns) per the table above.
- Error messages must tell agents the root fix (e.g. “use `@brightwork/shared` contracts or HTTP; do not import server modules into the browser”).

### Footgun rules

| Rule                                                                                          | Scope                   | Behavior                                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Ban `@ts-ignore`                                                                              | product TS              | Prefer fix or `@ts-expect-error` with description                                                      |
| Require description on `eslint-disable*`                                                      | all linted files        | No silent escapes                                                                                      |
| Restrict `any`                                                                                | apps (ignore generated) | Prefer `unknown` + narrow                                                                              |
| Restrict timers (`setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`) | `apps/web` product UI   | Allowlist existing intentional modules; new uses go through allowlisted helpers or a justified disable |
| `useEffect`                                                                                   | web                     | Remains allowed; keep `eslint-plugin-react-hooks`                                                      |
| Comments                                                                                      | —                       | No hard ban; optional later warnings for “workaround justification” markers only if cheap              |

### Weed pulls

- Fix or allowlist only sites that new rules break (known: ~12 web files with timers; few `any` / ignore escapes).
- No unrelated refactors.

## Verification

Reuse `.cursor/skills/verify-brightwork/` (launch, doctor, cleanup, computer motion, feature recipes).

### Phase 1 additions

1. Machine-readable `.cursor/skills/verify-brightwork/features/map.json`: feature id → entry route(s), preconditions, proof artifact names, recipe path.
2. Keep markdown recipes as human/agent narrative; map.json is the index agents/scripts trust.
3. List major unmapped surfaces (Inbox, Schedule, Settings, etc.) explicitly as **unmapped**—do not invent verification.
4. Thin script (skill or repo `scripts/`) that accepts a feature id and prints entry URL, recipe path, required proof files; optionally smoke-navigates when the stack is up.
5. `pnpm verify:doctor` → runs doctor (cheap local/CI-adjacent gate). Full browser drive stays agent/manual when stack and disk allow.

### Evidence contract

- Store under `output/verify-brightwork/<run-id>/`.
- `note.md`: feature id, git SHA, doctor result.
- UI: screenshot + ARIA; mutations: second user-facing readback; computer: ordered frames (+ MP4 when available).

## Prose (last)

- Add a short **Agent trust** section to root `AGENTS.md` pointing at: import graph, `pnpm lint`, feature map, verify skill, and `docs/agent-trust.md`.
- Write `docs/agent-trust.md` as the durable summary of this design.
- Standing rule: agent corrections become a lint rule or feature-map entry first; prose only for judgment.

## Success criteria (phase 1)

1. `pnpm lint` enforces the import graph and pragmatic bans; CI stays green.
2. Timer/`any`/ignore weeds required by those rules are fixed or allowlisted with messages.
3. `features/map.json` exists and matches the current feature README set; unmapped surfaces listed.
4. Feature lookup script + `pnpm verify:doctor` exist and are documented.
5. `AGENTS.md` and `docs/agent-trust.md` are thin pointers, not a second policy engine.

## Risks

- Over-restricting timers may need a slightly larger allowlist than expected—prefer allowlist + message over disabling the rule.
- Worker→API coupling is intentional for now; do not “fix” it with a ban that forces a premature package split.
- Verify doctor/launch can fail on disk/Docker hosts; document skip conditions without claiming features verified.

## Later phases (program C, not this plan)

1. Expand feature recipes for high-traffic workbench surfaces.
2. Modular extraction per `docs/software-architecture-design.md`.
3. Stricter bans only after measuring real agent slop in this repo.
4. Optional formal / property-based verification where invariants are high-value.
