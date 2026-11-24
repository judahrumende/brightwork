# Publish, revise, and roll back

## Sub-features

- Block publication until the owner approves the current revision.
- Publish, edit the same site, and publish a new approved revision.
- Restore an earlier live deployment without changing the editable draft.

## How to get to it (user POV)

Open the pending website in **Build**. Approve the displayed revision and choose **Publish website**. Edit that same site, approve the new revision, then choose **Publish update**. Open **Deployment history** to restore the first live deployment.

## Driving it with Playwright and the API suite

Run the [website beta verifier](../../../../.claude/skills/verify/SKILL.md). Check `browser.log` for the deployment restore and saved-version cases. The API integration test verifies the real publication route, the exact approval gate, public HTML, and the rollback response against PostgreSQL.

For authorized hosted acceptance, read both public HTTPS pages in a signed-out browser. Use the same public URL before and after each publish and rollback. Confirm it first serves revision one, then revision two, then revision one again. Confirm revision two can't publish before approval.

## Gotchas

Local cases use fixture hostnames and do not verify DNS or TLS. Restoring a saved version as a draft and rolling back a live deployment are different actions. Label the evidence accordingly.
