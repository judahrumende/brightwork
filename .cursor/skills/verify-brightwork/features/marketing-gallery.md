# Marketing gallery

The marketing gallery is the local UI surface at `/dev/ui` used to confirm Vite is serving Brightwork chrome without signing in.

## Sub-features

- `gallery-open` loads the component gallery over the owned Vite origin.
- `health-proxy` reaches API `/health` through Vite’s `/health` proxy.

## How to get to it (user POV)

- Open `APP_ORIGIN/dev/ui` in a browser after a full launch that started Vite.
- Hit `APP_ORIGIN/health` to exercise the proxy.

## Driving it with Playwright

Preconditions:

- Launch with `VERIFY_SKIP_WORKER=1` and without `VERIFY_SKIP_VITE` (Vite must start).
- `scripts/doctor.sh` passed and reported vite ownership.
- Playwright Chromium is installed (`pnpm exec playwright install chromium` once).

- **Open gallery.** Navigate to `$APP_ORIGIN/dev/ui`. Run `pnpm exec playwright open "$APP_ORIGIN/dev/ui"` or an equivalent CDP session. The page title or heading shows Brightwork UI gallery content.
- **Proxy health.** Request `$APP_ORIGIN/health`. Body is `{"status":"ok"}`.
- **Proof.** Screenshot `$VERIFY_ROOT/marketing-gallery.png` with Brightwork identity visible, plus the health JSON.

## Gotchas

- Vite uses `strictPort: true`. If `APP_ORIGIN`’s port is taken, launch refuses rather than binding another port.
- `/dev/ui` is enough for gallery identity; do not treat SPA `/home` as the marketing landing on this main-line checkout.
- Skip this feature when only the API-only readiness stack was launched; report the unmet Vite precondition.
