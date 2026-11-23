# Build canvas

Build is the workbench application where Pip plans websites/stores and the owner reviews drafts.

## Sub-features

- `build-open` opens the Build application for a workspace at `/f/:businessId/build`.
- `build-composer` shows the Pip chat composer (`Message Pip` / `#pip-prompt`).
- `build-preview` shows website canvas thumbnail cards when sites exist (full draft preview is behind Open editor).

## How to get to it (user POV)

- From the header **Main** nav, choose **Build** (one click).
- From the Home dock, open the **Build** panel, then choose **Open Build**.
- Open `/f/:businessId/build` directly.

## Driving it with Playwright

Preconditions:

- Doctor passes.
- Workspace id and session available.
- Do not require a live LLM for shell proof; skip generation if no model.

- **Open Build.** Prefer `navigation` named `Main` → link **Build**, or goto `/f/<id>/build`. Assert URL ends with `/build`.
- **Shell.** Assert heading **Build** and composer (`getByLabel('Message Pip')` or `#pip-prompt`). Do not send a turn unless a disposable model is configured.
- **Optional preview.** If sites exist, assert region `Website canvas`; empty “No websites yet” is acceptable for shell proof.
- **Proof.** `$VERIFY_ROOT/build-shell.png` showing Build chrome.

## Gotchas

- Dock **Build** alone opens a popover; navigation is **Open Build** inside it (or use header **Build**).
- `?merchantOnboarding=return|refresh` on the build view redirects to settings—not Build UI.
- Sending a real Pip turn spends credits and needs the worker + model; treat generation as a separate journey.
- Do not invent a site via test-only APIs.
