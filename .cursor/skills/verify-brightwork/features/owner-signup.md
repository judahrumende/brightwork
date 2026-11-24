# Owner signup

## Sub-features

- Request and redeem an email challenge.
- Open the requested page after authentication.
- Create a workspace and keep its records private to members.

## How to get to it (user POV)

Open `/sign-up`. Fill **Email** and select **Continue**. At **Check your email**, use the delivered code or link. Open `/new`, enter a workspace name, and select **Create workspace**.

## Driving it with Playwright and the API suite

Run the [website beta verifier](../../../../.claude/skills/verify/SKILL.md). Check `browser.log` for `sign-in submits an email challenge and code, then opens the requested page`. Check `api-integration.log` for `email and OAuth sign-in establish sessions and isolate workspace records`. The API test checks actual Mailpit delivery and persisted workspace isolation.

For an authorized hosted run, use a new test identity and a real provider. Refresh the workspace after signup and confirm the session persists.

## Gotchas

The browser sign-in case stubs the API. The integration test replaces the Turnstile and OAuth replies. Neither proves real hosted signup. Do not log delivered codes or session cookies.
