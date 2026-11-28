# Workbench polish

Prove the kit-aligned shell chrome shipped in the visual polish pass: Home overview metrics, Workspace Settings as a modal, and public legal pages linked from auth.

## Sub-features

- `polish-metrics` Home **Business overview** shows Build, Revenue, Visitors, and Insights with metric hierarchy (value + caption or empty/loading/error).
- `polish-settings-modal` Opening `/f/:businessId/settings` keeps Home under a scrim and shows a Settings dialog with sidebar navigation (Team and other Business tabs).
- `polish-legal` Public routes `/terms`, `/privacy`, and `/refund-policy` render Brightwork legal pages (auth footer links).

## How to get to it (user POV)

- Create or open a workspace, land on `/f/:businessId`.
- Open Settings from the dock (or navigate to `/f/:businessId/settings`).
- From a logged-out session, open `/terms` (and privacy / refund-policy).

## Driving it with Playwright

Preconditions:

- Doctor passes on a disposable stack with Vite (`VERIFY_SKIP_VITE` unset).
- Personal mode or signed-in session.
- A workspace id from workspace-creation (or prior step in `drive-polish.mjs`).

Drive steps (serial):

1. **Landing legal.** Open `$APP_ORIGIN/terms`, assert H1 **Terms of Service** and kicker Brightwork and Pip. Screenshot `legal-terms.png`. Repeat `/privacy` → H1 **Privacy Policy** → `legal-privacy.png`, `/refund-policy` → H1 matching Refund → `legal-refund.png`.
2. **Workspace.** Create workspace via `/new` (same as workspace-creation) or reuse `VERIFY_BUSINESS_ID` (owner/admin session).
3. **Home metrics.** Open `/f/:id`. Assert `Business overview`, headings Build, Revenue, Visitors, Insights. Screenshot `polish-home-metrics.png`.
4. **Settings modal.** Navigate to `/f/:id/settings`. Assert dialog named **Workspace settings**, nav **Business settings** → **Team**, header **Team**. Prove Home chrome remains with CSS locators for `nav[aria-label="Workspace applications"]` and `nav[aria-label="Main"]` (Radix inert hides role queries). Screenshot `polish-settings-modal.png`. Close via Close settings and confirm URL returns to `/f/:id`.
5. **Proof.** Write `drive-polish.json` listing each step ok + paths. `note.md` with feature id, SHA, doctor result.

## Gotchas

- Settings must be a modal over Home, not a full-page `Workspace settings` view without dialog.
- Team sidebar requires owner/admin; viewers see a restricted dialog without Business tabs.
- Legal pages use marketing layout, not the workbench chrome.
- Do not mutate Pip chat, publish, or billing during this check.
- Fixture Playwright visual captures are not a substitute for this live drive.
