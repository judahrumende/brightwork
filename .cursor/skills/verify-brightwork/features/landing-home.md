# Landing home

The public Brightwork marketing landing shows the brand, starter prompt, and capability paths before a workspace exists. It is the `Landing` composition (`apps/web/src/ui/landing.tsx`), served as marketing HTML—not the SPA `/home` invitations route.

## Sub-features

- `landing-open` loads a marketing locale root (e.g. `/en`) with Brightwork branding visible in the first viewport.
- `landing-account-nav` exposes Account navigation with **Log in** and **Start free**.
- `landing-starter-group` shows “Choose a starting point” / idea textbox “Your business idea” / submit “Start with this idea”.

## How to get to it (user POV)

- Open a marketing locale landing such as `/en` (or `/en-us`, `/en-au`, `/en-gb`).
- From marketing solution pages, follow the brand link back to the locale home (`/` under that prefix).
- Do **not** use SPA `/home` for this feature: `/` redirects to `/home`, which is workspace invitations / redirect into `/f/…` or `/new`.

## Driving it with Playwright

Preconditions:

- Doctor passes against this run’s `APP_ORIGIN` (Vite + API with matching origin), **or** for shell-only marketing proof Vite alone can serve `/en`.
- No requirement for a prior workspace.

- **Open landing.** Navigate to `$APP_ORIGIN/en`. Expect Brightwork brand link and a usable first viewport (not the invitations shell).
- **Inspect account nav.** `navigation` named `Account` contains links **Log in** and **Start free**.
- **Inspect starter controls.** Region/group `Choose a starting point`, textbox `Your business idea`, button `Start with this idea`.
- **Proof.** Save `$VERIFY_ROOT/landing-home.png` and an ARIA snapshot. Brand mark or product name must be visible.

## Gotchas

- Vite port must equal `APP_ORIGIN` or API calls return origin 403.
- Bare `/` is redirected to SPA `/home` by the API and client; that is not this feature.
- Other marketing pages may say “Sign in”; the landing Account nav says **Log in**.
- Do not treat `/dev/ui` as this feature.
