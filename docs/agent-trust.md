# Agent trust garden

Brightwork follows Lauren Tan’s trust pyramid: **code and architecture first**, then **deterministic checks**, then **verification**, and only then thin **prose**. Agents copy whatever looks established—so constraints belong in lint and maps, not long rule essays.

## Import graph (enforced by ESLint)

| From              | May import                              | Must not import                                                          |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `apps/web`        | `@brightwork/shared`                    | `@brightwork/api`, `@brightwork/worker`, `apps/api/**`, `apps/worker/**` |
| `apps/api`        | `@brightwork/shared`                    | `@brightwork/web`, `@brightwork/worker`, `apps/web/**`, `apps/worker/**` |
| `apps/worker`     | `@brightwork/api`, `@brightwork/shared` | `@brightwork/web`, `apps/web/**`                                         |
| `packages/shared` | its own deps                            | any `apps/**` or `@brightwork/{web,api,worker}`                          |

Worker → API is allowed until a later `packages/backend` extraction.

## Deterministic checks

```sh
pnpm lint
```

Rules live in `eslint.config.mjs`:

- Cross-app import bans with agent-readable fix messages
- `@ts-ignore` banned; `@ts-expect-error` needs a description
- `any` banned in product TypeScript (generated files ignored)
- Imperative timers banned in `apps/web` except an explicit allowlist of intentional modules

When correcting an agent, prefer a new lint rule or allowlist entry over another paragraph in `AGENTS.md`. Silent `eslint-disable` without a clear reason is discouraged; fix the root cause or justify in the disable comment.

## Verification

Canonical feature vocabulary:

- Index: `.cursor/skills/verify-brightwork/features/map.json`
- Recipes: `.cursor/skills/verify-brightwork/features/*.md`
- Skill: `.cursor/skills/verify-brightwork/SKILL.md`

```sh
pnpm verify:feature --list
pnpm verify:feature landing-home
# Requires launch env (VERIFY_ROOT, APP_ORIGIN, …):
pnpm verify:doctor
```

Unmapped surfaces in `map.json` are not verified—do not invent proof for them. Evidence goes under `output/verify-brightwork/<run-id>/` with `note.md` (feature id, SHA, doctor result).

## Prose

`AGENTS.md` only points here. Design detail: `docs/superpowers/specs/2026-11-23-agent-trust-garden-design.md`.
