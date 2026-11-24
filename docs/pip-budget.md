# Pip OpenRouter budget

Pip's OpenRouter requests use the pinned `z-ai/glm-5.3-flash` model and
`pareto-inference/nvfp4` endpoint. OpenRouter lists that endpoint in the
[model catalog](https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints).
Its [routing guide](https://openrouter.ai/docs/guides/routing/provider-selection#targeting-specific-provider-endpoints)
describes provider endpoint tags.

Every request checks the provider's weekly key limit and reserves a conservative
cost in a local SQLite ledger before inference. Holds remain counted until
OpenRouter reports the next weekly reset. The provider limit is a backstop, not
a substitute for the local ledger.

The local cap defaults to $3. The owner can lower it with the explicit
`--set-weekly-cap` flow. The guard fails closed when key metadata, route pricing,
the ledger, or the completion response is missing or ambiguous. Desktop mode
disables separate paid search and media adapters. Do not run a paid worker on
more than one host with this key.

## Enroll a dedicated key

Create a new OpenRouter key for Brightwork with a weekly limit of $3 or less.
Disable BYOK for that key and do not use it for other applications. Keep the key
out of `.env`, source control, and chat.

From the repository root, enter the key at a hidden prompt and initialize the
ledger:

```zsh
(
  read -s "BRIGHTWORK_OPENROUTER_KEY?Paste the dedicated key: "
  print
  export BRIGHTWORK_OPENROUTER_KEY
  pnpm pip:budget:init
)
```

Initialization checks OpenRouter metadata and creates the local ledger. It does
not send inference. The default ledger is
`~/.brightwork/pip-budget.sqlite`; it must remain on the one authorized host.

To lower the local cap, keep the key exported in the same terminal and run:

```sh
BRIGHTWORK_PIP_NEW_CAP_USD=1 pnpm pip:budget:init
```

The local cap cannot be raised above $3.

Use Node 22.5 or newer for enrollment and desktop inference. The regular
Brightwork API and worker do not load SQLite unless an OpenRouter request is
made.

## Run Pip in desktop mode

Enable the desktop route only for the API and one worker on the primary host:

```sh
export BRIGHTWORK_DESKTOP_PIP=1
export LLM_API_KEY="$BRIGHTWORK_OPENROUTER_KEY"
export LLM_MODEL=z-ai/glm-5.3-flash
export LLM_BASE_URL=https://openrouter.ai/api/v1
pnpm dev
```

In a second terminal on that same host, enter the key again at a hidden prompt,
then set the desktop model configuration before starting the single worker:

```zsh
read -s "BRIGHTWORK_OPENROUTER_KEY?Paste the dedicated key: "
print
export BRIGHTWORK_OPENROUTER_KEY
export BRIGHTWORK_DESKTOP_PIP=1
export LLM_API_KEY="$BRIGHTWORK_OPENROUTER_KEY"
export LLM_MODEL=z-ai/glm-5.3-flash
export LLM_BASE_URL=https://openrouter.ai/api/v1
pnpm --filter @brightwork/worker dev
```

Do not start another worker on a second Mac. Check the queue before starting the
worker because queued jobs can make paid requests. Do not enable inference
until the key's provider limit and this guard's tests have been reviewed.

OpenRouter [documents the weekly reset](https://openrouter.ai/docs/api/reference/limits)
as Monday 00:00 UTC. The guard uses the provider's `resets_at` value rather
than the Mac's time zone. This repository has not verified the dedicated key's
authenticated reset time.
