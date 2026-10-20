# Published pages from Canvas

A top-level Canvas frame can be published as a public page at `/p/<workspace>/<address>`. Auto-layout frames become
flexbox that reflows on phones, frames without auto layout scale as one board, and a frame marked as a lead form posts
signups to the project's Pipeline with the page's address as the lead source. Start the fixture:

```powershell
node --experimental-strip-types scripts/verify-origin-published-pages.ts
```

It runs the real `backend/convex` functions in memory (convex-test behind `scripts/testing/origin-campaigns-backend.ts`),
serves the production `ProjectDrawPage` against them, and relays `/p/...` and `/uploads` on the preview to the
backend's HTTP actions. Use the printed `previewUrl` in a second terminal:

```powershell
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-published-pages.mjs http://127.0.0.1:PRINTED_PORT/__origin-published-pages.html
pnpm exec vitest run shared/canvas-page.test.ts shared/canvas-ops.test.ts server/origin-page-tools.test.ts src/components/origin-pages/DrawingCanvas.test.ts
pnpm --filter @origin/backend exec vitest run pages pipeline
node --test site/lib/pages-proxy.test.ts
```

At 375 and 1280 pixels the checker opens the empty Pages menu, selects the Waitlist frame, publishes it from the Design
panel (the second width republishes it), opens the page as a visitor, checks its title, h1, social image, its policy and
that it runs no script, submits the lead form and sees the thank-you state, then reads one more view and one more lead per
width in the Pages menu. At 1280 it unpublishes the page and gets a 404. Screenshots and `report.json` are written to
`docs/verification/evidence/origin-published-pages/`.

## Evidence boundaries

The fixture proves the renderer, the Convex functions and HTTP actions, and the app UI against them. It does not cover a
deployed Convex backend, the origin.imbored.fun relay in `site/app/p` (covered by its unit test), or Google Fonts loading.
