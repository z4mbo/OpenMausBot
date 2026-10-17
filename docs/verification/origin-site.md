# Origin website inspection

The website now consumes `shared/origin-theme.css`, the same semantic palette, control radii and motion duration used by the core app. Inter replaces the separate display typography. Light and dark colors, form focus, flat panel borders, menu dismissal and wrapping footer navigation were inspected. The auth password input has an explicit accessible name independent of its visibility toggle.

The website's `/whats-new` page reads `shared/origin-releases.ts`. Footer/download links expose it, and download guidance describes the unsigned Mac update limitation accurately. The Docker build context includes both shared files; `scripts/deploy-origin.mjs` stages those dependencies from the committed tree.

## Browser evidence

The isolated Next server ran on `http://127.0.0.1:3017`, with `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:20689` pointing to an unused synthetic endpoint. The browser intercepted that WebSocket; no account was created and no production/local Convex deployment was contacted. External requests were blocked in the reproducible after check.

Before screenshots cover landing, sign-in and sign-up at 375/1440 px in light/dark. Final after checks use the 2026-10-18 version 0.2.2 changelog and cover those routes plus release history: 16 cases, zero page errors, no horizontal overflow, mobile menu Escape, password visibility, named fields and Windows download target. Full-page after screenshots include the lower landing sections and footer. Evidence is in `evidence/origin-site/`: `*-before.png`, `*-after-full.png`, `before-results.json` and `after-full-results.json`. The new release-history page has no pre-existing screen to compare.

```powershell
$env:NEXT_PUBLIC_CONVEX_URL = 'http://127.0.0.1:20689'
pnpm --filter @origin/site exec next dev --port 3017
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-site.mjs http://127.0.0.1:3017/ after
pnpm --filter @origin/site test
pnpm --filter @origin/site build
```

These are browser/source checks. Production deployment, live authentication and published download/update feed acceptance require separate delivery evidence. The existing landing integration script targets the user's local Convex process, so it was deliberately not used in this isolated audit.
