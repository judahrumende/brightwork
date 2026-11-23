# Foundable workspace

Read the latest entry in `.codex/run-memory.md` before starting work. Skip completed work and avoid repeating failed methods unless the relevant conditions have changed. If a step fails, try different methods within the user's retry limit.

At the end of each run, append a short entry recording what you did, what worked, what failed and why, and where the next run should start.

## Foundable engineering

Use [Foundable engineering](.agents/skills/foundable-engineering/SKILL.md) for requests to dispatch work in cmux and for project maintenance sweeps. Apply Ponytail and route the applicable pstack skills in the coding session. A dispatched Codex job works inside its assigned checkout and does not dispatch itself again.

## Agent trust

Encode agent corrections as lint or verify-map entries, not long prose. Read [agent trust](docs/agent-trust.md). Enforce with `pnpm lint`. Feature vocabulary: `.cursor/skills/verify-brightwork/features/map.json` (`pnpm verify:feature --list`). Drive proof with [verify-brightwork](.cursor/skills/verify-brightwork/SKILL.md) (`pnpm verify:doctor` after launch).

## Token and context conservation

- Keep chat responses short and dense. Use files for substantial plans, state and handoffs; avoid large rewrites and pasted file contents.
- Work in bounded steps and update a concise `STATUS.md` after major changes.
- When context is getting large or a meaningful chunk is complete, write a handoff under 400 words with the goal, done/remaining work, decisions, paths and gotchas. Tell the user: “Context is getting large. I’ve written a handoff to HANDOFF.md. Start a new Codex session and paste/point me at that file to continue with minimal token cost.”
- On resume, read the handoff and only the files needed for the next step; do not reload the whole history.
- Use targeted file reads and minimal tool calls. Never paste large files or diffs when a path or focused excerpt will do.
