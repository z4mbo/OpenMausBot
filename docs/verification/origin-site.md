# Origin website inspection

The website now consumes `shared/origin-theme.css`, the same semantic palette, control radii and motion duration used by the core app. Inter replaces the separate display typography. Light and dark colors, form focus, flat panel borders, menu dismissal and wrapping footer navigation were inspected. The auth password input has an explicit accessible name independent of its visibility toggle.

The website's `/whats-new` page reads `shared/origin-releases.ts`. Footer/download links expose it, and download guidance describes the unsigned Mac update limitation accurately. Its Mac opening link follows [Apple's current instructions](https://support.apple.com/en-us/102445); macOS 15 and later removed the old Control-click override. The Docker build context includes both shared files; `scripts/deploy-origin.mjs` stages those dependencies from the committed tree.

## Browser evidence

The isolated Next development server ran on `http://127.0.0.1:3017`, with `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:20689` pointing to an unused synthetic endpoint. Its browser intercepted that WebSocket; no account was created and no production/local Convex deployment was contacted. External HTTP requests were blocked.

Before screenshots cover landing, sign-in and sign-up at 375/1440 px in light/dark. Final after checks use the 2026-10-18 version 0.2.5 changelog and cover those routes plus release history: 16 cases, zero page errors, no horizontal overflow, mobile menu Escape, password visibility, named fields and Windows download target. Full-page after screenshots include the lower landing sections and footer. Evidence is in `evidence/origin-site/`: `*-before.png`, `*-after-full.png`, `before-results.json` and `after-full-results.json`. The new release-history page has no pre-existing screen to compare.

The final production Docker image was built with the intended public Convex endpoints and tested before rollout through a private loopback container and SSH tunnel at `http://127.0.0.1:3036/`. The image is `origin-audit-site:0.2.5-final`, ID `sha256:8869546d28207777160cfd6b79b2822d89250bce280cfe24755caf3d6d20522d`, from website commit `9e1b40440`. All WebSockets are intercepted without forwarding, and non-loopback HTTP requests are blocked. Both final 16-case runs (`after` and `production-image`) pass with zero page errors. The tests never submit an account form. `production-image-full-results.json` and matching screenshots record this compiled-artifact check; they do not prove live account authentication. The private container and SSH tunnel are stopped after inspection; the separate synthetic app previews stay open for the user.

```powershell
$env:NEXT_PUBLIC_CONVEX_URL = 'http://127.0.0.1:20689'
pnpm --filter @origin/site exec next dev --port 3017
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-site.mjs http://127.0.0.1:3017/ after
pnpm --filter @origin/site test
pnpm --filter @origin/site build
```

These are browser/source checks. Production deployment, live authentication and published download/update feed acceptance require separate delivery evidence. The existing landing integration script targets the user's local Convex process, so it was deliberately not used in this isolated audit.
