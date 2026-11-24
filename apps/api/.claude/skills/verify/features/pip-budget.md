# Pip budget guard

Pip sends text requests through one pinned OpenRouter model and reserves a conservative cost before each inference attempt. The verification path uses fake provider responses and never sends inference.

## Sub-features

- `pinned-route` keeps the model and provider endpoint fixed.
- `durable-reservation` counts pending and completed calls against one local weekly cap.
- `fail-closed` blocks requests when provider metadata, pricing, or accounting is uncertain.
- `weekly-rollover` scopes reservations to the provider's reset window.

## How to get to it (user POV)

- Send a text request through Pip chat or a Run on the authorized desktop host.
- The worker calls the shared LLM client for each model attempt.
- Use the fake-provider verification below. Do not start a worker with a real key.

## Driving it with the Pip budget test command

Preconditions:

- Run from the repository root with Node 22.5 through 24.x and installed workspace dependencies.
- Do not set or read a live OpenRouter key. The tests inject fake provider responses and use disposable SQLite files.

- **Run the guard suite.** Execute `set -o pipefail; pnpm test:pip-budget 2>&1 | tee "$VERIFY_ROOT/pip-budget.log"`. Require exit code `0`, all tests to pass, and no skipped tests.
- **Check the route and reservation.** The test `valid request sends exactly one pinned POST and a consumable completion` must pass. It asserts the fake request route, pinned model, consumed completion, and the durable reservation.
- **Check denial and rollover.** The tests for invalid metadata, pricing, accounting, concurrent callers, and weekly rollover must pass. Each denial must leave the fake POST count unchanged.
- **Proof.** Append the budget result to the readiness note:

  ```sh
  {
    printf '\n## Pip budget guard\n\n- Feature ID: pip-budget-guard\n- Entry point: pnpm test:pip-budget\n- Runtime: %s\n- Revision: %s\n' "$(node --version)" "$(git rev-parse HEAD)"
    grep -E '^# (tests|pass|fail|skipped) ' "$VERIFY_ROOT/pip-budget.log"
    printf '%s\n' '- Provider: fake transport. No live key or inference request.'
  } >> "$VERIFY_ROOT/note.md"
  ```

  Keep `pip-budget.log` and `note.md` under `$VERIFY_ROOT`.

## Gotchas

- This test drives the production `llmClient` and `pipBudget` code, but it does not exercise the worker queue or the browser chat UI.
- Do not treat a fake provider pass as proof that the owner's OpenRouter key is enrolled or has a $3 weekly limit.
- The tests create their SQLite ledgers in temporary directories and remove them at test teardown. Do not look for a persistent ledger after the suite.
- Do not start a worker during verification. Queued jobs can make paid requests.
