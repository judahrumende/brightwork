# Owner signup

## Sub-features

- Request and redeem an email challenge.
- Return to the requested page after entering a code. Finish a magic link on **Finish signing in** to reach **Home**.
- Create a workspace and keep its records private to members.

## How to get to it (user POV)

Open `/new` signed out to reach `/sign-up?returnTo=%2Fnew`. Fill **Email** and select **Continue**. Enter the delivered code to return to `/new`. If you use the email link instead, select **Continue** on **Finish signing in**, then open `/new` from **Home**. Enter a workspace name and select **Create workspace**.

## Driving it with Playwright and the API suite

Run the [website beta verifier](../../../../.claude/skills/verify/SKILL.md). Check `browser.log` for `sign-in submits an email challenge and code, then opens the requested page`. Check `api-integration.log` for `email and OAuth sign-in establish sessions and isolate workspace records`. The API test checks actual Mailpit delivery and persisted workspace isolation.

For an authorized hosted email run, verify SMTP delivery and Turnstile first. Use a new test identity. Refresh the workspace after signup and confirm the session persists. Open the same workspace as a second signed-in user without membership and confirm access is denied.

## Gotchas

The browser sign-in case stubs the API. The integration test replaces the Turnstile and OAuth replies. Neither proves real hosted signup. Do not log delivered codes or session cookies.
