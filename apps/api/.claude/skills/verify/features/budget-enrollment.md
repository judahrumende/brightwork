# Budget key enrollment

The owner initializes the single-host ledger with a dedicated OpenRouter key whose provider limit is no more than $3 per week.

## Sub-features

- `hidden-key-entry` reads the key from a terminal prompt, not a file or chat.
- `provider-check` validates the key limit and model route before creating the ledger.
- `single-host-ledger` binds the local budget ledger to the authorized host.

## How to get to it (user POV)

- From the repository root, follow `docs/pip-budget.md` and run `pnpm pip:budget:init`.
- To lower the local cap, set `BRIGHTWORK_PIP_NEW_CAP_USD` in the same terminal and rerun the command.

## Driving it with the enrollment command

Preconditions:

- The owner has created a dedicated Brightwork key and set its weekly provider limit to $3 or less.
- The owner is on the authorized primary Mac and enters the key at the hidden prompt.
- The user explicitly authorizes a live metadata request before anyone runs the command.

- **Verify the command implementation.** Run the enrollment cases in `pnpm test:pip-budget`. The tests use a fake `/key` response and must pass without a live key or network request.
- **Live enrollment boundary.** This skill does not run the live command. The owner may run the documented command separately after the preconditions above are met. Keep the key out of logs, screenshots, and evidence. Do not capture it.
- **Proof.** Record only whether the command completed, the ledger path, and whether the provider limit check passed. Never store the key or the complete provider response.

## Gotchas

- No authenticated key status is confirmed by this repository. A masked label or successful fixture test does not prove enrollment.
- If the owner has not confirmed the key and its weekly limit, report live enrollment as blocked. Do not run the CLI or a paid inference request.
- Do not share the key across hosts. Do not raise the cap above $3.
