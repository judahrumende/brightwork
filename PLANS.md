# Cited web search for Brightwork

**Proposed for approval.** A signed-in user opens Research, asks a question, and gets a short answer with numbered inline citations and a source list. Fastify searches through SearXNG, reads public pages, and returns only claims that pass the evidence checks below.

## 1. Repository findings and file changes

| Area | What is in the repository |
| --- | --- |
| UI | React 19, Vite, TanStack Router and React Query, Radix primitives, and CSS Modules. The authenticated workspace already accepts a view key at `/f/$business/{-$view}`. The Research dock item currently opens an empty popover. The header search and `Cmd/Ctrl+K` find saved work through `/api/me/search-work`. |
| API and auth | Fastify 5 registers account and workspace routes through `registerAuth`. Workspace routes use a cookie-backed session, business membership, and an `Origin` plus `X-Session-Id` check for POST actions. Existing errors expose `message`. The browser `api()` helper adds the tab ID and sends same-origin credentials. |
| Data | PostgreSQL and Drizzle hold accounts, sessions, memberships, Pip turns, and workspace artifacts. Redis already supports auth rate limits, presence, and BullMQ. The proposed Research request uses existing membership records and short-lived Redis state. |
| AI and search | `apps/worker/src/llm.ts` calls OpenAI-compatible Chat Completions. `apps/worker/src/web-search.ts` independently calls OpenAI Responses with its web-search tool. Pip renders URL annotations through `research-results.tsx`. The worker's credit ledger debits a running Pip turn. |
| Configuration | The visible root env file is `.env.example`. Existing keys include `APP_ORIGIN`, `AUTH_SECRET`, `DATABASE_URL`, `REDIS_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, `WEB_SEARCH_API_KEY`, and `WEB_SEARCH_MODEL`. Deployment details and the active model are pending confirmation. |

| Action | Exact path | Planned change |
| --- | --- | --- |
| Create | `infra/searxng/settings.yml` | Private SearXNG instance settings and JSON output. |
| Create | `apps/api/src/research/searxng.ts` | Search adapter, result validation, ranking and deduplication. |
| Create | `apps/api/src/research/page.ts` | Public-page transport, redirect and DNS policy, and HTML text extraction. |
| Create | `apps/api/src/research/answer.ts` | Bounded search-to-answer pipeline, model prompts, evidence checks, and response assembly. |
| Create | `apps/api/src/research/routes.ts` | Authenticated endpoint, input and error mapping, cache, limits, and cancellation. |
| Move | `apps/worker/src/llm.ts` → `apps/api/src/llm.ts` | One server-only model client. Preserve existing defaults and add per-call deadline, cancellation, and token-limit options for Research. |
| Modify | `apps/api/package.json` | Add the HTML parser, export `./llm` for the worker, and add a `test:research` script using existing `tsx --test`. |
| Modify | `apps/worker/src/index.ts`, `apps/worker/src/agent.ts`, `tests/unit/llm.test.ts` | Update imports and verify that the worker's client behavior and defaults remain compatible. |
| Modify | `apps/api/src/auth/config.ts`, `apps/api/src/auth/routes.ts` | Parse optional search configuration and register Research with the existing auth, membership, Redis, and rate-window logic. |
| Create | `packages/shared/src/web-search.ts` | Runtime Zod request, answer, source, citation, and error schemas plus inferred TypeScript types. |
| Modify | `packages/shared/src/index.ts` | Export the hand-authored search schemas. The generated capture contracts describe the original API. |
| Create | `apps/web/src/workbench/web-search.tsx`, `apps/web/src/workbench/web-search.module.css` | Workspace Research form and cited results, styled with current tokens and primitives. |
| Modify | `apps/web/src/workbench/workbench.tsx` | Link the Research dock item to the new workspace view and render the screen in the existing route. |
| Modify | `compose.yaml`, `.env.example`, `README.md` | Opt-in local SearXNG, server configuration placeholders, and a setup and smoke-test guide. |
| Create | `apps/api/test/research.test.ts`, `tests/research.spec.ts` | Fastify and pipeline integration tests with fixtures, plus Playwright coverage of the Research view. |
| Generate | `pnpm-lock.yaml` | Record the dependency resolution with pnpm. There is no tracked lockfile in the inspected repository. |

Each Research request runs directly in Fastify and uses existing Postgres membership records and Redis. This design requires zero database migrations or BullMQ jobs.

## 2. SearXNG setup

- Add an opt-in `research` Compose profile with a `searxng` service using the official image. Pin a tested image version or digest at implementation. Bind `127.0.0.1:8080` to container port `8080` and mount the settings under `/etc/searxng`. Set `use_default_settings: true`, enable `search.formats: [json]`, set `search.safe_search: 1`, and set `server.limiter: false` and `server.public_instance: false` for this private service. Supply `SEARXNG_SECRET` from the server environment. Apply Brightwork's Redis limits at the API and keep SearXNG reachable only by trusted callers. [Container installation](https://docs.searxng.org/admin/installation-docker) · [Search settings](https://docs.searxng.org/admin/settings/settings_search.html)
- Add optional server-only `SEARXNG_BASE_URL`. Leave it blank in the default env example and document `http://127.0.0.1:8080` for the current host-run Fastify development setup. Production requires an approved private service address reachable from Fastify. Reject malformed URLs, embedded credentials, query strings, and fragments. Use HTTPS over any untrusted network. A blank setting disables the provider and yields a clear unavailable response. There is no automatic provider fallback.
- Fastify sends a form-encoded `POST /search` with `q`, `format=json`, `categories=general`, and `safesearch=1`. Parse and cap the payload before use. Take up to eight valid, distinct result URLs in provider order, removing fragments and known tracking parameters while preserving meaningful query parameters. Start with domain diversity, then use remaining slots for strong candidates. A hit's title and snippet can help rank reads. It qualifies for citations after reading the page. [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
- Verify local setup with `docker compose --profile research up -d searxng` and a form-encoded smoke request to `http://127.0.0.1:8080/search`. Check for HTTP 200 and nonempty JSON `results`. A 403 on `format=json` is a configuration failure. [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)

## 3. Fetching and extracting pages

- Fetch candidates with concurrency of three, at most eight attempts, and up to five usable pages. Follow at most three redirects and recheck every target. Allow public HTTP or HTTPS on the default ports, with a maximum URL length of 2,048. Reject credentials, IP literals, single-label and local hostnames, the Brightwork origin and configured site-hosting domain and its subdomains. For the first release, resolve and connect over IPv4 only. IPv6-only results are skipped.
- For each hop, resolve IPv4 records, reject results with any non-public or special-use address, and pin an approved address at the socket using Node's `http`/`https` request `lookup` with the original hostname for the HTTP host and HTTPS certificate. Use a fresh connection, disable family fallback, forward no user cookies, keys, or headers, and use `net.BlockList` with reviewed IANA ranges plus multicast and reserved ranges. Cover encoded IP forms, metadata endpoints, mixed DNS answers, rebinding, and unsafe redirects in tests. Apply equivalent private-range restrictions at the network layer where deployment supports them. [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) · [Node HTTP API](https://nodejs.org/download/release/v22.11.0/docs/api/http.html) · [IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry/)
- Accept successful `text/html` and `text/plain` only. Request identity encoding, bound the body to 1 MiB, and abort the stream on overflow. Skip unsupported encodings, PDFs, blocked or paywalled pages, JavaScript-only pages, and empty or low-content extracts. Use one new direct dependency, Cheerio, at a version compatible with the supported Node 22 runtime. Parse the bounded body with `loadBuffer`, using the HTTP charset when present. Prefer `main`, `article`, or `[role=main]`, then the cleaned body. Remove navigation, sidebars, scripts, style, and repeated boilerplate. Preserve paragraph boundaries and take the most question-relevant paragraphs up to 6,000 characters per page and 24,000 across the request. [Cheerio loading API](https://cheerio.js.org/docs/basics/loading/)
- Use the final fetched URL for citation links, deduplicate redirects to the same page, and prefer a page's extracted title with the hostname as fallback. The answer sees numbered source records with bounded excerpts. It treats page text as untrusted input. Raw HTML is discarded after extraction.

## 4. Answer generation and evidence checks

- Reuse `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL`, including the existing OpenAI-compatible `https://api.openai.com/v1` default. The Fastify process also needs these values when Research is enabled. Keep the credentials in server-only env or the deployment secret store. Use the selected compatible model's existing Chat Completions call with no tools. Provider-specific structured-output features are optional because the contract is enforced server-side. [Chat API reference](https://developers.openai.com/api/reference/resources/chat)
- Ask for one to six short, single-claim blocks. Require a source ID and one short, verbatim supporting passage per citation. The model receives the question and the fetched excerpts only. Give instructions to ignore directives in sources, use only the supplied evidence, preserve attribution and dates, and leave out unsupported parts of the question. The no-evidence output is an empty claims array.
- Parse strict JSON with Zod. Reject unknown source IDs, mismatched quotes, URLs in claim text, and any block with zero valid citations. Exact quote matching uses the same whitespace normalization used for extracted text. Verify the surviving claim-and-quote pairs in one separate model call. Give it the question, proposed claims, confirmed quotes, and the surrounding paragraphs so it can check attribution, dates, and qualifiers. Retain claims only when the verifier marks them directly supported, and retain only the citations that individually pass. An exact match establishes where a quote came from. The separate check judges whether it actually supports the claim. Drop uncertain, overstated, or contradicted paraphrases. Attribute disagreements with a separate cited block for each position. Return `422 no_evidence` if zero claims survive. A malformed verifier response or verifier outage fails the request.
- Budget up to 2,048 completion tokens for generation and 512 for verification, both within the fixed request deadline. Send the model key only in the authorization header to the configured model endpoint. Keep session data, workspace records, and Pip history out of all provider payloads. Map failures to safe public `code` and `message` values. Verify model compatibility and latency with fixtures and a live smoke test.

## 5. API contract

`POST /api/companies/:id/web-search` takes the existing business UUID. Reuse workspace session identification and membership. Under the proposed rate-limited policy, the existing workspace POST guard restricts search to members with write access. Authentication and authorization happen before cache reads or provider calls. The browser uses the existing `api()` client with an `AbortSignal` to send `Content-Type: application/json` and `X-Session-Id`. Responses use `Cache-Control: no-store`.

```json
{"question":"How do I enable JSON output on a SearXNG instance?"}
```

Accept a strict object with exactly `question`, a string of 3–500 characters after trimming. Cap the HTTP body at 8 KiB. Use `200` with the schema in section 7. For all expected failures, return the strict object `{"code":"<value from the table>","message":"<short user-facing text>"}`. Use `Retry-After` in seconds for `429`.

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `invalid_request` | Invalid question, business ID, tab header, or JSON. |
| `401` | `sign_in_required` | Missing or expired session. |
| `403` | `forbidden` | Invalid origin or view-only workspace role. |
| `404` | `business_not_found` | Unknown or inaccessible workspace. |
| `413` | `request_too_large` | Body exceeds 8 KiB. |
| `415` | `unsupported_media_type` | The endpoint requires a JSON request. |
| `422` | `no_evidence` | No accessible page evidence supports an answer. |
| `429` | `rate_limited` | An account or service budget is exhausted. |
| `502` | `upstream_error` | Search or model provider failed or returned malformed data. |
| `503` | `unavailable` | Research or an essential dependency is unavailable. |
| `504` | `deadline_exceeded` | The request or an essential phase exceeded its time budget. |

## 6. Streaming

Use one JSON response in v1 and show a cancellable loading state. A complete answer can be validated atomically before the UI displays any claims. Fastify should cancel outgoing work when the client disconnects before the response finishes. If measured latency warrants visible progress later, reuse the repo's SSE framing with `searching`, `reading`, and `checking` status events, then one complete validated `result` or one `error`. The existing Pip SSE endpoint reads persisted turns.

## 7. Exact JSON schema for answers, sources, and citations

Use this draft 2020-12 JSON Schema as the wire shape for `200`. Implement it in Zod and enforce the cross-field rules below on both model output and cached responses as applicable.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["answer", "sources"],
  "properties": {
    "answer": {
      "type": "array",
      "minItems": 1,
      "maxItems": 6,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "citations"],
        "properties": {
          "text": { "type": "string", "minLength": 1, "maxLength": 360 },
          "citations": {
            "type": "array",
            "minItems": 1,
            "maxItems": 3,
            "items": { "$ref": "#/$defs/citation" }
          }
        }
      }
    },
    "sources": {
      "type": "array",
      "minItems": 1,
      "maxItems": 5,
      "items": { "$ref": "#/$defs/source" }
    }
  },
  "$defs": {
    "sourceId": { "type": "string", "pattern": "^s[1-5]$" },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "title", "url"],
      "properties": {
        "id": { "$ref": "#/$defs/sourceId" },
        "title": { "type": "string", "minLength": 1, "maxLength": 200 },
        "url": {
          "type": "string",
          "format": "uri",
          "pattern": "^https?://",
          "maxLength": 2048
        }
      }
    },
    "citation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["sourceId", "evidence"],
      "properties": {
        "sourceId": { "$ref": "#/$defs/sourceId" },
        "evidence": { "type": "string", "minLength": 1, "maxLength": 280 }
      }
    }
  }
}
```

- `answer[].text` is one verified claim in plain text. `citations[]` belongs to that claim, so rendering inline links needs no character offsets. Put all links immediately after the claim.
- `sourceId` must resolve to exactly one entry in `sources`, with each ID used at most once per claim. Include only sources cited in the answer, with distinct normalized URLs. Assign the final `s1` through `s5` IDs in first-citation order after filtering and remap citations accordingly. The numeric suffix is the displayed citation number.
- The API uses `URL` parsing in addition to the schema. A source URL must be the final accepted page URL, without credentials or a fragment. `evidence` is a short verbatim match from that source's extracted input. Claims, titles, and evidence are rendered as React text. Outgoing page URLs come from the validated source list.

## 8. Research screen

- Link the existing Research dock shortcut to `/f/:business/research`. Give the workspace view a heading, a visibly labelled question field, and a Search button. Submit with Enter. Reuse Brightwork buttons, spacing, and theme tokens. Let the controls wrap on narrow screens and preserve the saved-work search shortcut.
- Show one answer area with numbered citation links such as `[1]` after each claim. An accessible link name includes the source title. Activating a marker takes the user to the corresponding source row. Each row shows the number, page title, hostname, and a link that opens the source in a new tab with `rel="noopener noreferrer"`. Offer the verified evidence excerpt in a disclosure when useful. Render a single column on phones.
- Start in a clean empty state. While pending, announce “Searching and checking sources…” with `role="status"`, disable duplicate submits, and provide Cancel. Abort on cancel, route exit, or workspace switch, and ignore stale responses. Keep the question on errors. Show an alert with a specific action for sign-in, rate limit, no evidence, provider failure, or timeout. Show the source list only alongside a validated answer. Tell the user near the form that submitted questions are sent to web search and the configured model provider.

## 9. Cache, limits, and operational behavior

These values are proposed launch settings for the separate per-account limit option.

| Control | Proposed behavior |
| --- | --- |
| Answer cache | Redis `SET EX 600` for successful validated results only. Scope the key to account, company, provider/model, pipeline version, and the trimmed question using the existing HMAC pattern. Preserve case and internal whitespace. Validate hits again. Store no raw question in the key and no raw HTML in Redis. |
| Quotas | Reuse the Redis atomic fixed-window counter used by auth. Start at five valid requests per account per minute, 30 per account in a 24-hour window starting with the first request, and 60 cache misses globally per hour. Count cache hits toward the per-account windows. Apply the global cap before provider work and return the limiting window's TTL in `Retry-After`. |
| Deadlines | Use a 35-second overall deadline, including retries and body reads. Budget up to 4 seconds for search, 8 seconds for the page batch with up to 3 seconds per page including redirects, and 10 seconds per model call, each clamped to the time remaining. Abort remaining page reads once enough usable evidence is ready. |
| Retries | Retry SearXNG once on a connection error or upstream `502`/`503`, within its original deadline, with short jitter. Attempt each page once, skip failed or slow pages, and use the other candidates. Make one generation attempt and one verification attempt. The user's explicit resubmit starts another request. |
| Failure handling | Map malformed provider payloads and provider failures to `502`. Serve `422` when the bounded pipeline completes without support. If Redis cannot enforce quotas, return `503` before provider calls. If a cache write fails after quota enforcement and a valid answer, return the answer. Drop invalid cache entries. |
| Privacy and diagnostics | Record request ID, stage durations, cache outcome, result counts, error codes, and optional provider token counts. Exclude raw questions, prompt/evidence text, full result URLs, secrets, and provider bodies from application logs. Keep the browser request same-origin. |

## 10. Build order and verification

1. **Contract and local search.** Add the shared schema, SearXNG settings, and adapter. Check local JSON search from Fastify's runtime and fixture-test result validation, deduplication, provider failure, and the search deadline.
2. **Fetch and verify.** Add the bounded transport, extraction, and model integration with fixture injection. Test private and mapped IP forms, rebinding, redirect loops and redirects into private networks, aborts, response sizes, malformed HTML, skipped content, prompt injection, quote mismatch, unknown references, misleading or contradicted claims, and the empty-evidence path. Run `pnpm test:unit` to check Pip's model client compatibility.
3. **Wire the endpoint.** Test the route with `pnpm --filter @brightwork/api test:research` using Fastify injection. Verify auth and origin, inaccessible businesses, view-only roles, disabled configuration, request limits, cache isolation and TTL, `Retry-After`, cancellation, and the exact success and error shapes. Confirm unauthorized, rate-limited, and cache-hit requests make zero outbound provider calls.
4. **Wire the workspace view.** Run `pnpm exec playwright test tests/research.spec.ts` with fixture API responses. Verify keyboard use, loading and cancellation, mobile layout, multiple citations, source links, a delayed stale response, empty evidence, and rate limits. Check that `Cmd/Ctrl+K` still opens saved-work search.
5. **Run repository checks and a live smoke test.** Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm contracts:check`, and `pnpm build`. On the approved environment, use several benign questions including a recent fact, a multi-source comparison, and a question with inadequate evidence. Follow every link and confirm each passage supports the associated claim. Check end-to-end latency, cancellation, and that provider keys are absent from client code and network responses.

## Decisions for approval

- **Usage policy.** Choose separate per-account limits (the proposed plan above) or Pip credits. The credit path requires a search-aware ledger and history plan because existing debits require a running Pip turn. Confirm the launch limits before enabling paid model calls.
- **Deployment and model.** Local Compose is specified. Confirm where Fastify will reach the private SearXNG service in production and which existing `LLM_MODEL` configuration to verify there. There is no production host or model choice inferred from the repository.
