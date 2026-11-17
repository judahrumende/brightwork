# Foundable parity inventory

The [screen index](../kit/screen-index.json) tracks all 86 numbered tour captures. Capture 001 is the logged-out landing page. The capture directory also contains 20 public screenshots outside the numbered tour. Eight numbered screens and two additional auth screens have local Playwright comparisons in `docs/visual-diff.html`. The remaining screens still need matching Brightwork captures and review.

The [API shape catalogue](../kit/api-shapes.json) records 147 unique observed method and path pairs and 70 routes referenced by the original JavaScript. The referenced paths have no exact path match in the observed request catalogue. A reference identifies a path. Its method, request, response, and permissions still require evidence.

`pnpm parity:check` verifies the checked-in inventories. `pnpm contracts:check` verifies generated schemas. Run `pnpm visual:report` locally with the raw captures in `kit/screens/` and the latest Playwright screenshots in `test-results/visual/`. The report displays pixel differences for review. Raw screenshots and HAR files stay in the local capture kit.

Staging screenshot comparison, responsive and accessibility review, and HAR replay are pending. Provider-dependent contracts require a permitted fixture or a verified provider connection before being marked complete.
