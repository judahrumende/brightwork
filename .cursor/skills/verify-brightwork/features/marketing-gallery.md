# Marketing gallery

The marketing gallery is the local UI surface at `/dev/ui` used to confirm Vite is serving Brightwork chrome without signing in.

## Sub-features

- `gallery-open` loads the component gallery over the owned Vite origin.
- `health-proxy` reaches API `/health` through Vite’s `/health` proxy.

## How to get to it (user POV)

- Open `APP_ORIGIN/dev/ui` in a browser after a full launch that started Vite.
- Hit `APP_ORIGIN/health` to exercise the proxy.

## Driving it with drive-gallery

Preconditions:

- Launch with `VERIFY_SKIP_WORKER=1 VERIFY_SKIP_VITE=0` (pass `VERIFY_SKIP_VITE=0` explicitly if a prior `launch.env` was sourced).
- `scripts/doctor.sh` passed and reported vite ownership.
- Launch binds Vite with `--port` taken from `APP_ORIGIN` (default `http://127.0.0.1:5199`).
- Playwright Chromium is installed (`pnpm exec playwright install chromium` once).

- **Open gallery.** Run `NODE_PATH="$(pwd)/node_modules" node .cursor/skills/verify-brightwork/scripts/drive-gallery.mjs`. Exit code `0`. `drive-gallery.json` has `passed: true`, title containing `UI preview · Brightwork`, heading `UI preview`, and `brandVisible: true`.
- **Proxy health.** The same driver requests `$APP_ORIGIN/health` and requires `{"status":"ok"}`.
- **Proof.** Keep `$VERIFY_ROOT/marketing-gallery.png`, `$VERIFY_ROOT/gallery-health.json`, `$VERIFY_ROOT/drive-gallery.json`, and `$VERIFY_ROOT/note-marketing-gallery.md`.

## Gotchas

- Vite uses `strictPort`. Launch passes `--port` from `APP_ORIGIN`; a busy port refuses launch rather than binding elsewhere.
- Document title is `UI preview · Brightwork` and the heading is `UI preview`, not “UI gallery”.
- Skip this feature when only the API-only readiness stack was launched; report the unmet Vite precondition.
