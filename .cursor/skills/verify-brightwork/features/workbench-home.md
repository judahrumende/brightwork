# Workbench home

Inside a business, Home shows the desktop dock, overview metrics, and workspace shortcuts.

## Sub-features

- `wb-dock` shows Workspace applications navigation (Home view only).
- `wb-overview` shows the Business overview section (always rendered; may show loading or empty copy) including an Insights article.
- `wb-shortcuts` exposes Search, Inbox, and Schedule under navigation **Workspace shortcuts**.

## How to get to it (user POV)

- After creating or selecting a business, open `/f/:businessId` (no trailing `/home` segment).
- Choose **Home** in the header **Main** nav from another workspace view.
- From personal mode, open `/home` then continue into an existing workspace.

## Driving it with Playwright

Preconditions:

- Doctor passes.
- A workspace id exists from workspace-creation or a seeded disposable business.
- Session cookie valid (personal mode or signed-in).

- **Open.** Navigate to `$APP_ORIGIN/f/<businessId>`. Wait for `navigation` named `Workspace applications` (dock) and `Main`.
- **Shortcuts.** Assert button `Search` and links `Inbox` / `Schedule` (parent `Workspace shortcuts`).
- **Overview.** Assert region/section `Business overview` and article `Insights` without opening mutating panels.
- **Proof.** `$VERIFY_ROOT/workbench-home.png` plus ARIA snapshot showing dock or overview.

## Gotchas

- The dock exists only on Home. On `/f/:id/build` you will see **Main** but not **Workspace applications**.
- Read-only: do not send Pip chat or publish during this check.
- Missing MinIO may break media/file panels; Home dock can still prove shell load if those panels are unopened.
- Fixture Playwright specs are not live proof.
