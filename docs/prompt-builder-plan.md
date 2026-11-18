# Prompt-driven builder

## Evidence

Lovable Desktop 1.10.12 packages Electron main and preload code. REA analyzed those two entry points from the installed ASAR (evidence `ev_c14f8f82b991cb7de588b08abb51002675e4d325d5fe256c39ec0b412a0628c9`, source coverage limited to those files). A focused static read found the production `https://lovable.dev` origin, Electron webContents navigation, and a separate `https://api.lovable.dev` service origin. The desktop bundle shows the client boundary. The hosted agent's model selection, prompts, tools, execution environment, and retry strategy are unknown. No live Lovable build was run.

Lovable documents three relevant product behaviors.

- Project-aware planning can inspect existing project context and propose work before implementation. [Plan mode](https://docs.lovable.dev/features/plan-mode)
- The agent can verify interactions and responsive layouts in a virtual browser against a specific preview. [Browser testing](https://docs.lovable.dev/features/browser-testing)
- Generated apps can use database, auth, storage, functions, and other hosted services. [Built-in backend](https://docs.lovable.dev/features/cloud)

## 1. Website generation and revisions

Status — implemented in the existing Pip worker. The builder produces static website drafts. Browser checks below describe repository verification. Automated browser runs as part of each generation belong to milestone 2.

- Keep the existing Pip, Run, Build, preview, history, and approval entry points. A build plan specifies a design direction, each changed route, and its purpose. The agent can ask a focused question when the target or requirements are ambiguous.
- Send each page generator the user's requirements, common design brief, route map, and relevant existing source. Generate one complete document per changed route to bound context and output. Preserve the original HTML of untouched pages.
- Check the generated document and same-site navigation against the planned routes. Give each page one repair attempt with the diagnostics. Use the existing per-turn ledger and usage accounting for each call. Restrict the website target to the capabilities of the existing sandboxed preview and publication surface.
- Recheck the final route set before committing. Create or compare-and-swap an existing draft in a transaction with its version snapshot. A partial or stale build leaves the previous version available. Approvals and publication still apply to exact revisions. Keep the build activity tied to the version produced by that turn.
- Verify creation, follow-up edits, unchanged pages, failed generation, stale revisions, tenant scope, history, and preservation of the prior live snapshot with local model fixtures and a disposable database. Verify that the normal Build preview renders a generated document.
- Treat contact links as references. Compare external destinations and contact links with the supplied brief, research, and edited page. Keep owner approval for factual copy, brand fit, and publication.

## 2. Generated source projects and isolated builds

Status — planned.

- Add workspace-scoped projects and immutable source revisions with an explicit stack and dependency lock. Use project/version identifiers in run events so the existing chat and Build views can link to artifacts.
- Record the base revision, normalized spec, manifest hash, verification result, and preview artifact on each revision. Persist build jobs with an operation key, deadline, phase, lease, attempts, and budget. A worker restart should recover the job through its last completed stage, and the final write should compare the project head with the original base revision.
- Give the builder scoped file operations, bounded diffs and read access to the selected base revision. A reviewed project spec records user flows, routes, permissions, required services and acceptance checks. Keep plans and test logs with source revisions.
- Resolve generated paths against a fresh workspace and admit file writes only inside the project's source root. Version dependency changes separately from source edits and derive build and test commands from the approved template. Control build inputs through a manifest of stack, lockfile, source digest, and safe runner parameters.
- Build and test generated code in an execution service isolated from Brightwork's API, worker, database credentials and user sessions. Use short-lived workspaces, resource limits, a restricted dependency cache, and controlled network access. Never execute model-generated commands or packages inside the Pip worker.
- Run type checks and build checks first. Run browser scenarios against the exact preview revision on a separate origin with fixture users. Feed bounded diagnostics into a repair loop. Commit source and preview metadata together only after the checks pass. A failed build retains diagnostic artifacts and the last verified revision.
- Preserve the current workspace layout. Use existing work links and Build activity for source-project results. Prove how authenticated preview links can open on a separate origin through the current UI contract before exposing interactive previews. Keep static website previews in the existing sandboxed iframe.
- Verify dependency installation, isolation, timeout, cancellation, secret isolation, responsive layouts, and prompt-to-preview for a source project with multiple routes.

## 3. Full-stack SaaS generation and hosting

Status — planned.

- Start with a single supported full-stack template. Generate a schema and authorization model from the spec, with signed-in user and tenant checks in the template. Provision a dedicated app environment, a preview data store, and synthetic test identities.
- Add managed storage, background jobs and server functions only through scoped service adapters. Inject secrets into the generated app's runtime. Keep provisioning, billing, outbound messages, payment actions and publication behind the relevant owner approvals.
- Represent migration requests and service provisioning as explicit operations with idempotency keys. Assign preview and production independent app identities, databases, and runtime keys. Restrict project jobs to their own service bindings and keep remote calls traceable to the workspace, job, and revision.
- Test sign-up, CRUD, tenant access, migration safety and rollback with disposable data. Test a second revision against a populated database. Keep schema/application compatibility explicit so switching the live deploy pointer preserves data and a failed deployment can recover.
- Promote a tested immutable revision from preview to live. Provide logs, quotas, per-project usage, and code export or Git sync from the same revision. Reuse Brightwork's approval and deployment history patterns for publishing and rollback.
- Gate release on a generated SaaS app that can sign in, persist data across sessions, prevent cross-tenant access, survive a follow-up edit, and roll back an application revision independently of data.

## Generated stores

REA analyzed 188 JavaScript files from the installed Base44 desktop ASAR with zero parse failures. Its entry files point the desktop window at the hosted editor on `app.base44.com`. The bundled client and the supplied dashboard image establish the desktop and management surfaces. Base44 documents server-side data permissions and a backend per app. The hosted agent and its backend implementation are outside the desktop bundle. REA evidence `ev_17fa8e628d066238c190f3529e3a20c20350bb41fa5b196cf8ff5502a5399b15`. [Base44 data permissions](https://docs.base44.com/Setting-up-your-app/Managing-security-settings.md)

Foundable uses its existing Postgres connection and publication workflow. A store build saves the draft and creates its store record in the same transaction. The dashboard below the preview uses Foundable components. Owners and admins can manage products, set currency before adding products, and confirm, fulfill or cancel orders. The public catalog becomes available when a store revision is published. Customers can submit a cart with multiple products. Confirming reserves stock for every line in one transaction. Merchants with a ready Stripe test account can share a link for the saved order total. The signed webhook reconciles payment and refunds. Cancellation can release reserved stock after an unpaid checkout closes or a full refund is recorded. Store edits and stock changes are serialized per store. Dashboard counts and customer order totals use the full store history. Orders and Customers support search, filters and pages of 25 across the full history.

The worker applies shared design guidance during planning and page generation. The repository skills cover storefront polish and merchant workflows. Storefront polish adapts [Unslop by Damir Sokolovsky](https://heydamir.design/unslop), CC BY 4.0. Shared tokens and patterns draw on [Lovable design systems](https://docs.lovable.dev/features/design-systems.md).

Products can have a managed photo and variants with their own SKU, price, stock, and optional photo. The catalog groups variants under their product, and the cart records the selected variant and its price. The latest public catalog and its photos honor the store publication and product visibility.

Published stores support email-code buyer accounts when SMTP is configured. Buyers can page through private order history for their verified email and find any payment link associated with a confirmed order. The merchant dashboard distinguishes verified accounts from guest buyers, including verified accounts with zero orders.

Store owners can configure shipping and additive tax by country. The public catalog collects addresses and presents a review with line items, shipping and tax. A review expires after 15 minutes and must be refreshed after product or rate changes. A submitted order retains its reviewed line prices and charges, including when the merchant creates a Stripe test payment link. The dashboard and buyer accounts show the saved breakdown.

The Report tab shows daily order requests, cancellations, paid orders, gross payments and refunds for an inclusive UTC date range of up to 366 days. Cancellations count against the request date and refunds count against the original payment date. Payments in the Stripe test environment use the same reporting path.

Next delivery milestones include live buyer checkout, payment verification and deployment verification. Reuse the existing Stripe Connect webhook and seller identity boundaries when adding payments. Verify that checkout charges the exact server-computed order, handles retries, and updates order and stock state correctly for duplicate and late events.
