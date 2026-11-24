# Pip computer

Pip controls a browser computer through `use_computer`: navigate, move, click, type, press a key, scroll, and screenshot. Frame output includes viewport size, URL, cursor, text, last key, and image bytes in `pngBase64` (JPEG when Chromium is live).

## Sub-features

- `computer-navigate` loads an `http` or `https` URL.
- `computer-pointer` moves and clicks at coordinates inside 1280×800.
- `computer-type-key` types text and presses keys.
- `computer-scroll` scrolls at a point.
- `computer-screenshot` returns a frame; live captures are JPEG bytes in `pngBase64` (field name is historical).

## How to get to it (user POV)

- In a workspace chat, ask Pip to use the computer (requires worker with `COMPUTER_ENABLED=true` and a model that proposes `use_computer`).
- For direct control-surface proof without a model: run the motion helper (agent path).

## Driving it with Playwright / helper

Preconditions:

- `playwright-core` installed on `@brightwork/worker`.
- Chromium-compatible binary available (`COMPUTER_CHROMIUM_PATH` or Chrome.app on macOS).
- Evidence directory `$VERIFY_ROOT` exists.
- Motion helper defaults assume macOS Chrome + `sips` for JPEG→PNG stamping; pass `--chrome` elsewhere.

- **Motion helper (preferred for frame proof).** Run:

```sh
NODE_PATH="$(pwd)/node_modules" pnpm --filter @brightwork/worker exec tsx \
  ../../.cursor/skills/verify-brightwork/scripts/verify-computer-motion.mjs \
  --out "$VERIFY_ROOT" \
  --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Expect ordered `computer-01-navigate.png` … frames (yellow/red cursor stamp), `computer-motion.mp4` or `.webm`, and `computer-motion.html`. Cursor metadata is in `computer-frames.json`.

- **Chat path (optional).** Start worker with `COMPUTER_ENABLED=true` and `COMPUTER_CHROMIUM_PATH`, open Build/chat, ask Pip to open a site and click. Proof requires a completed `use_computer` tool part in the turn UI or API readback—not only the model text.

- **Proof.** Retain PNGs, JSON, and MP4 under `$VERIFY_ROOT`. Confirm at least navigate + move + click frames differ and JSON cursor coordinates change after move/click.

## Gotchas

- Default install keeps `COMPUTER_ENABLED=false`; chat will not expose the tool until enabled.
- Fake in-memory session returns empty `pngBase64`; motion screenshots require the Playwright adapter + Chrome/Chromium.
- Browser actions are not idempotent; retries after uncertain running tools fail closed.
- There is no RFB/noVNC take-over UI in this slice—frames are tool/helper evidence, not a desktop viewer.
- When computer is enabled, the worker runs BullMQ concurrency 1 and shares one browser session.
