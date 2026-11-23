# Workspace creation

A visitor finishes starting a business on `/new` (inside a session boundary) by naming the business and submitting an idea for Pip.

## Sub-features

- `new-open` opens the new-business flow at `/new` (alias `/start` redirects here).
- `new-idea` accepts an idea in the **Your idea** field (landing may have prefilled it from **Your business idea**).
- `new-continue` creates a workspace via `POST /api/me/companies/begin` and navigates to `/f/:businessId`, or `/f/:businessId/build` when “Have Pip draft…” is checked.

## How to get to it (user POV)

- From landing, submit **Start with this idea** (saves starter intent, then `/new`).
- Open `/new` directly (requires a session: personal mode on loopback, or sign-in).

## Driving it with Playwright

Preconditions:

- Doctor passes.
- Disposable DB is migrated.
- `PERSONAL_MODE=true` for unsigned local continue; otherwise expect the SessionBoundary gate on `/new` (not an automatic redirect to `/sign-in`).

- **Open.** Navigate to `$APP_ORIGIN/new`. Wait for heading/copy about what you are building and fields **Business name** / **Your idea**.
- **Enter.** Fill **Business name** and **Your idea** with a unique phrase including the run id. Leave **Have Pip draft…** unchecked to land on Home (`/f/:id`); checked expects `/f/:id/build` after submit.
- **Continue.** Submit via **Create workspace**. Record the final URL.
- **Proof.** Screenshot before submit and after navigation.

## Gotchas

- Landing labels (**Your business idea** / **Start with this idea**) differ from `/new` (**Your idea** / **Create workspace**).
- Origin mismatch blocks session bootstrap with 403.
- Shared `.env` DB must never receive this write.
- Without personal mode and without a cookie, `/new` shows an inline “Local workspace unavailable” / personal-mode hint—not a workbench.
- If creation returns 403/5xx, stop and fix doctor/env; do not weaken the journey.
