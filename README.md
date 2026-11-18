# Brightwork

Brightwork is a business workspace with an AI operator named Pip. See [PROGRESS.md](./PROGRESS.md) for the current milestone.

## Local development

Requires Node.js 22, pnpm, and Docker with the Compose plugin.

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm --filter @brightwork/api db:migrate
pnpm dev
```

Open [the component gallery](http://127.0.0.1:5173/dev/ui). Vite starts on port 5173 and proxies `/api` and `/health` to Fastify. The gallery and health route can run with the containers stopped.

| Environment variable                                         | Purpose                                    |
| ------------------------------------------------------------ | ------------------------------------------ |
| `APP_ORIGIN`                                                 | Public app URL used when creating links    |
| `API_PORT`, `API_HOST`                                       | Fastify listen address and port            |
| `DATABASE_URL`                                               | Postgres connection                        |
| `REDIS_URL`                                                  | Queue, presence and rate-limit storage     |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | S3-compatible site file storage            |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`                        | Development email delivery through Mailpit |

Mailpit's inbox is on port 8025 and MinIO's console is on 9001. The defaults in `.env.example` are for the loopback development containers.

## Workspace

```mermaid
flowchart TD
  Web["React and Vite"] --> API["Fastify API"]
  Web --> Shared["Shared config and contracts"]
  API --> Shared
  API -.-> PG["Postgres"]
  API -.-> Queue["Redis"]
  Queue -.-> Worker["Pip worker"]
  Worker -.-> PG
  Worker -.-> Store["MinIO"]
  API -.-> Mail["Mailpit"]
```

Dotted connections show the services introduced by upcoming milestones.

- `apps/web` holds the file routes, UI primitives, and original worker-rendered sky.
- `apps/api` holds the API server.
- `apps/worker` runs Pip turns and saves work in the active business.
- `packages/shared` owns branding and the Zod schemas derived from the API kit. Run `pnpm contracts:generate` after updating the catalogue.
- `kit/` and `reference-v1/` hold local build references. The tracked feature checklist and API shape catalogue support repeatable checks from a fresh checkout.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm contracts:check
pnpm build
pnpm exec playwright install chromium
pnpm test
pnpm visual:report
```

`pnpm test` starts the dev servers and waits for the Fastify health response through Vite. GitHub Actions runs the checks with Node 22 and disposable Postgres, Redis, MinIO, and Mailpit services. It applies the migrations and runs the integration suite with synthetic workspace data and provider fixtures. Use that workflow for container checks when Docker Compose is unavailable locally.

Set `BROWSER_EXECUTABLE_PATH` to use an existing Chromium-compatible browser. Visual captures are written to `test-results/visual`. Open `docs/visual-diff.html` after running the report step.

Use a decompressed HAR and a local fixture instance to check captured API contracts.

```sh
pnpm contracts:replay path/to/fixture.har http://127.0.0.1:5173
```

Set `HAR_FIXTURE_SOURCE_ORIGIN` to select the captured API origin when the HAR includes several origins. Use `HAR_FIXTURE_ID_MAP` for a JSON map of captured UUIDs to local fixture UUIDs, and `HAR_FIXTURE_COOKIE` for a local test session cookie. Read-only replay is the default. Use `--write-fixtures` with synthetic request bodies, an isolated test database and fixture integrations to replay JSON mutations. The report checks status, media type and inferred schemas, and skips event streams.

## Rebranding

Change the product and agent names in `packages/shared/src/brand.ts`. The app mark lives in `apps/web/public/mark.svg`, and the original mascot SVG lives in `apps/web/src/ui/icons.tsx`. Generated colours and typography live in `apps/web/src/styles/tokens.css`. Regenerate them with `node scripts/generate-tokens.mjs`.

## Sign-in and the Pip worker

Start Docker services, copy `.env.example` to `.env`, and set `AUTH_SECRET` to a random value of at least 32 characters. Keep `APP_ORIGIN` identical to the URL you open in your browser. Apply the database migrations before signing in.

```sh
pnpm --filter @brightwork/api db:migrate
pnpm dev
```

- Email sign-in needs `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and SMTP. In local development, read messages in Mailpit at http://127.0.0.1:8025.
- Google and Apple OAuth use your WorkOS project and its enabled provider connections. Register `APP_ORIGIN/auth/callback` as a redirect URL. The application routes that callback to Fastify. Direct Google One Tap uses `GOOGLE_CLIENT_ID`. Existing email accounts use email sign-in if a separate social identity has not been linked.
- Set `LLM_API_KEY`, `LLM_MODEL` and, when needed, `LLM_BASE_URL`. Start `pnpm --filter @brightwork/worker dev` in a second terminal. Build uses the worker for Pip chat and saved drafts.
- `STARTER_CREDITS`, `MODEL_CREDITS_PER_CALL` and `TOOL_CREDITS_PER_CALL` configure internal quotas with ten decimal places. The worker debits each model and tool attempt before it starts. Review balances and recent transactions in Settings under Credits.
- Leave `SITE_BASE_DOMAIN` empty for private draft previews. For hosting, use a separate base domain, route its wildcard subdomains to Fastify, and provision DNS and TLS. Publishing requires approval of the current draft revision. Restoring a saved version creates a draft for review. The Visitors report counts requests for live pages by UTC date.
- **Build → Import website** extracts public page text into a draft for review. **Visual editing** edits simple text elements and embeds small raster images so they travel with that page's saved revision. **Site tools → Deployment history** lets owners and admins restore an earlier live snapshot. The editable draft and its versions stay available for future review.
- To enable **Sync live deployment**, configure `GITHUB_SITE_WORKSPACE_ID`, `GITHUB_SITE_REPO`, `GITHUB_SITE_BRANCH`, and `GITHUB_SITE_TOKEN`. Use a dedicated repository and a repository-scoped credential with Contents write access. The target branch must already exist. A sync replaces `sites/<website-id>/` in one Git commit using the selected live snapshot and a fast-forward branch update.
- Set `API_TRUST_PROXY` to the address or range of a deployment's trusted proxy if Fastify should use its forwarded client IP for auth rate limits.
- Run `pnpm test:unit` for auth, LLM, recurrence, exact credit arithmetic, publication, SSE, and traffic range tests.
- In **Workspace settings**, owners and admins can create email-bound team invitations. The recipient signs in using that address and accepts from Home. The vault requires a stable `VAULT_KEY` generated with `openssl rand -hex 32`. The Domains section verifies ownership against a DNS TXT record. Configure DNS and TLS separately before hosting sites.
- Account **Billing** uses Stripe test mode. Configure `STRIPE_TEST_KEY`, `STRIPE_TEST_PRICE`, and `STRIPE_WEBHOOK_SECRET`, enable the test customer portal, and send subscription creation, change and deletion, invoice paid and failed, and charge-refunded events to `/api/webhooks/stripe`. Set `STRIPE_RENEWAL_CREDITS` to the credits granted per settled invoice. A full refund of the latest paid invoice reverses its credit grant and suspends paid entitlement until the provider reports a new paid entitlement.
- **Billing → Referrals** shows each account’s shareable link and referral totals. Set `STRIPE_REFERRAL_CREDITS` to enable a credit reward in Stripe test mode. The first eligible paid subscription invoice earns one reward. A full refund of that invoice reverses the reward, including after subsequent renewals. Referral attribution uses a 30-day cookie on first sign-up.
- **Workspace settings → Commerce** accepts credentials for an installed Shopify app with Admin API `read_orders`. Enable `SHOPIFY_ENABLED=true` and set `VAULT_KEY` in a verified deployment. Use the URL shown for that store as the destination for `orders/create`, `orders/updated`, `orders/cancelled`, and `orders/paid` subscriptions. Brightwork reports paid order value from deliveries received after connection. Disconnecting deletes the saved credentials and stops accepting deliveries. Remove the subscriptions and revoke the token in Shopify when ending the connection.

- **Workspace settings → SMS** connects a Twilio SMS-capable number. Set `SMS_ENABLED=true` and `VAULT_KEY` in a verified deployment, then configure the HTTPS incoming callback displayed in settings as a POST in Twilio. Owners and admins can reply to existing SMS conversations. Reconnecting rotates the credentials for the same number. Disconnecting stops callbacks and new replies in Brightwork. An ambiguous submission stays visible for provider review.

- **Social → Page comments** connects a Facebook Page using a Page token. Configure `VAULT_KEY`, `GROWTH_META_APP_SECRET`, and `GROWTH_META_VERIFY_TOKEN`. In the Meta app dashboard select the Page object and subscribe to `feed` at `/api/webhooks/meta/pages`. The Page token needs the permissions for Page subscriptions, comment replies, and any publishing the workspace uses. Owners and admins connect or reconnect the same Page and publish replies. Disconnecting revokes Brightwork access to the Page and discards future callbacks. Remove the Page subscription in Meta if you also want to stop webhook delivery to Brightwork.

- **Workspace settings → Commerce → Stripe Connect** lets owners and admins onboard a seller in test mode and create a shareable sale link. Set `STRIPE_TEST_KEY` and a separate `STRIPE_CONNECT_WEBHOOK_SECRET`. Register `/api/webhooks/stripe-connect` for connected account events `account.updated`, `checkout.session.completed`, and `charge.refunded`. A seller must complete onboarding and support payments and payouts before creating a sale. Brightwork verifies the connected account, currency, and total against Stripe before recording a payment.

## Standalone web search API

For browser reading, lead research, Google Business Profile, social drafts and publishing, Meta campaign controls, and the ad wallet, see [the Growth setup plan](docs/growth-plan.md). Run the new migration before opening these tools.

Use the sign-in setup above. In `.env`, set `SEARXNG_BASE_URL=http://127.0.0.1:8080`, generate a `SEARXNG_SECRET` with `openssl rand -hex 32`, and fill `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL` for your Chat Completions provider. In production, point Fastify to a private SearXNG service. Use HTTPS for any network beyond the documented loopback or private Compose service.

```sh
pnpm install
docker compose --profile research up -d
pnpm --filter @brightwork/api db:migrate
pnpm dev
```

Check that local SearXNG returns JSON with a `results` array.

```sh
curl -fsS http://127.0.0.1:8080/search \
  --data-urlencode 'q=SearXNG JSON output documentation' \
  -d 'format=json&categories=general&safesearch=1'
```

Sign in at `APP_ORIGIN`, open a workspace you can edit, and run this in that tab's developer console. The browser sends the session cookie and same-origin request headers.

```js
const business = location.pathname.split('/')[2];
const response = await fetch(`/api/companies/${business}/web-search`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Session-Id':
      sessionStorage.getItem('brightwork-tab') ?? crypto.randomUUID(),
  },
  body: JSON.stringify({ question: 'How do I enable JSON output in SearXNG?' }),
});
console.log(response.status, await response.json());
```

`200` returns `answer[]` claim blocks with `citations[]` and a `sources[]` list. Each citation carries a `sourceId` such as `s1` and a verified `evidence` quote. Display `[1]` directly after the claim and match it to source `s1`, which contains `title`, `url`, and a `snippet` from the first verified quotation. The endpoint returns `422 no_evidence` when evidence is insufficient and supplies `Retry-After` when it returns `429`. Searches use separate per-account limits and a 10-minute cache.

```sh
pnpm --filter @brightwork/api test:research
pnpm test:unit
pnpm lint
```

## Runs, scheduled work, and outreach

- Open **Home → Runs → Open Run**. Add a goal and a credit limit, then enter up to 12 steps or have Pip plan them. Pip processes one step at a time. Answer questions in Inbox and review drafts in Run. With site hosting configured, enable **Queue website publication when I approve the draft** to publish the reviewed revision through the worker.
- Open **Run history** in a Run summary to see persisted status changes, queued steps, and decisions that unblocked work. The summary shows credits used and the latest status of each step and queued publication.
- Build chat can load earlier messages and attach up to three text files of up to 24 KiB each. The message sends the attached text to the configured model. Workspace members can download attachments. Use **Dictate** in a browser that provides speech recognition to draft the prompt before sending it.
- Use the checkbox in **Schedule → New task** to run a task with Pip using your credits. Open the task to pause execution. When the worker returns after several missed times, it processes each outstanding occurrence in order. Calendar events can be opened, edited, and deleted in Schedule. With inbound email configured, owners and admins can select **Inbox trigger** when creating a task. Each newly received message can queue the task once using the enabling member’s credits. Pip receives the saved instructions and arrival time. Pausing skips arrivals until the task is enabled again.
- Optional OpenAI web research uses `WEB_SEARCH_API_KEY` and `WEB_SEARCH_MODEL`. Pip displays cited findings under the search step in chat.
- Pip reads public pages with the same URL, DNS, redirect, response-size, and timeout checks as standalone research. Set the worker's `APP_ORIGIN` and `SITE_BASE_DOMAIN` to the same values as the API for those host exclusions.
- Optional outbound email uses `OUTREACH_RESEND_API_KEY` and `OUTREACH_FROM_EMAIL` with a verified Resend sender. Approve the draft in Inbox, enter the recipient, then select **Queue this email**. The Inbox records whether the provider accepted the request. To show delivery history, configure `OUTREACH_RESEND_WEBHOOK_SECRET` and subscribe to the sent, delivered, delivery delayed, bounced, failed, suppressed, and complained events at `/api/webhooks/email-delivery`.
- Optional inbound email uses a dedicated Resend receiving domain with Resend's MX record. Set `INBOUND_EMAIL_DOMAIN`, `INBOUND_RESEND_API_KEY` with permission to retrieve received mail, and `INBOUND_RESEND_WEBHOOK_SECRET` for the `email.received` webhook at `/api/webhooks/inbound-email`. Run the database migrations before enabling the webhook. Inbox displays each workspace's receiving address and the most recent 50 messages. Messages route using the recipient addresses in the verified webhook. The HTML reader blocks remote resources. Inbox lists attachments on new deliveries. The workspace API serves downloads up to 10 MB while the provider retains the file.
- Open an incoming message with a Message-ID to draft a threaded reply. The approved reply keeps the sender's address and original message reference, and the worker routes future replies back to the workspace mailbox. Library searches the names and text of files attached in Build.

Use a PostgreSQL fixture database with permission to create schemas. The integration test creates and removes its own schema and uses a fixture email receipt.

```sh
TEST_DATABASE_URL='postgres://user:password@127.0.0.1:5432/brightwork_test' \
  pnpm --filter @brightwork/api test:integration
```
