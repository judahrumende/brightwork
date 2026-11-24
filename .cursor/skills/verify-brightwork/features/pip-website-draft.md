# Pip plan, draft, and owner answer

## Sub-features

- Save an ordered website plan.
- Generate a pending home page and linked About page.
- Save an owner answer and use it on the next Pip turn.

## How to get to it (user POV)

Open Pip in the workbench. For the standalone beta path, ask Pip to save an ordered plan for a two-page studio website as a document. Then ask Pip to draft the home and About pages. Open the draft in **Build**. Ask Pip to request one missing detail. Open **Inbox**, select **Answer Pip**, save the answer, and start a follow-up turn.

Run planning is a separate entry point. Use **Start a Run**, fill **Goal**, and keep **Let Pip plan the steps** checked. The worker fixture covers that structured planner, not the standalone chat plan.

## Driving it with Playwright and the API suite

Run the [website beta verifier](../../../../.claude/skills/verify/SKILL.md). Check `worker.log` for `Pip persists an ordered plan and a pending two-page website draft`. Check `api-integration.log` for the auth and automation cases. They exercise saved answers and the Run follow-up.

For authorized hosted acceptance, reload **Build** and use **Preview page** to inspect the two draft pages. Save a unique phrase in the owner answer and reload to confirm it persisted. Ask Pip for the saved detail without repeating the phrase. Confirm the follow-up uses it and record the turn and artifact IDs.

## Gotchas

The worker test uses controlled model replies and separate plan and draft turns. It does not prove a model's planning, queue dispatch, or plan-to-draft handoff. The API fixtures save answers through the store, not the browser form. Standalone chat does not auto-resume after the owner answers. A Run can schedule a follow-up. Use the public site to verify links; the draft preview disables navigation by link.
