# Current App landing image capture

## Current 034 capture: Origin 0.2.13

The current Issues landing assets come from frozen capture source
`e6227c5f32a5b688af44594f6f436fc73ced2b3c`, based on integration
`7bcb3d1c5283d747c0cba8e3d6b91f4ecc2dac63`. The seven product module Git
blobs are identical to that integration. The sole intervening tooling change
aligns the checker's expected page title with the isolated launcher title;
the initial title-assertion failure wrote no screenshot and is superseded.

The [existing before asset](evidence/origin-landing-capture-034/issues-before.webp)
is preserved byte for byte: it shows v0.2.12 and the previous two-row footer.
The [new raw PNG](evidence/origin-landing-capture-034/issues-after.png) shows
the actual App's v0.2.13, six footer navigation/action icons on one row,
account before Search, separate full-width This computer row, Draft first
and six active cards. One 1600 × 1000 CSS-pixel case at scale two has no
overflow, page errors or external requests. The complete raw frame is
resized into the three WebP landing assets without cropping or manual pixel
changes. Historical run images and avatars remain outside this refresh.

The [capture report](evidence/origin-landing-capture-034/report.json) records
all seven module hashes, recipe hashes and output assertions. The
[qualification](evidence/origin-landing-capture-034/qualification.json) binds
the source, unchanged before image, installed capture dependencies and both
owned fixture cleanups. The [eight-payload manifest](evidence/origin-landing-capture-034/manifest.json)
has SHA-256 `d33019c643c6482b666269fdc2438d1a213c47429c93e045063c03fb2f440c83`.
The fake-engine servers, Vite listener and temporary homes are removed.
This is synthetic cloud data and a simulated Windows bridge in the real
renderer; no Convex, real account, packaged GUI or production acceptance is
claimed. The legacy site capture script was not used.

## Historical 032 capture

The landing Issues image now comes from the real `src/App.tsx` renderer at committed source `3dcdc677972264d49e1f94306a777236cc3c3784`, whose package version is 0.2.12. Its real Sidebar, account menu, computer row, project header and Issues board appear together. No product component, CSS, version label or screenshot pixel was edited for this capture.

The [raw after PNG](evidence/origin-landing-capture-032/issues-after.png) retains the complete 3200 × 2000 browser frame. The [previous image](evidence/origin-landing-capture-032/issues-before.webp) is the exact existing asset, including its old v0.2.1 footer; it was not recaptured or rewritten. The [capture report](evidence/origin-landing-capture-032/report.json) and [file manifest](evidence/origin-landing-capture-032/manifest.json) bind the observed source, seven product module Git blobs and normalized-LF hashes, recipe hashes, assertions and output hashes.

The capture uses synthetic Northwind/Maya data through an explicit cloud-query adapter and a simulated Windows desktop bridge. A disposable fake-engine HTTP server creates the local workspace, project Chiefs and default teams through the real routes. Cloud mutations throw. It uses neither Convex nor a real account, and it does not establish packaged Electron, backend authorization, provider or task-execution acceptance.

One 1600 × 1000 CSS-pixel desktop case, at device scale two and reduced motion, confirms account before Search, a separate full-width This computer row, a genuine visible v0.2.12 footer, Draft before Todo/In Progress, six active task cards, no document overflow and no page errors. External requests are blocked and none occur. All WebSockets are blocked; only two local Vite development-connection attempts are recorded without query tokens.

The raw PNG is resized and encoded into 1600, 960 and 760-pixel WebP assets. Every derivative retains the complete frame and footer. The existing `issues-crop.webp` filename is retained for compatibility; that derivative is now also a complete-frame resize. The historical run screenshots and agent avatars are outside this Issues-image refresh.

## Reproduce with isolated data

Use Node 24.21.0 and an immutable checkout or disposable source snapshot. The launcher follows the isolated fake-engine lifecycle and prints both owned URLs. It requires the exact capture source and does not discover an existing app:

```powershell
$env:ORIGIN_LANDING_SOURCE = git rev-parse HEAD
node --experimental-strip-types scripts/verify-origin-landing.ts
```

In a second terminal, pass the printed preview URL and an evidence output directory to `scripts/testing/capture-origin-landing.mjs`, followed by that full source SHA. `OMB_VERIFY_PLAYWRIGHT` and `OMB_VERIFY_SHARP` may select installed dependency module URLs. When the capture checker runs outside the source snapshot, set `ORIGIN_LANDING_SNAPSHOT` to that snapshot so its observed file bytes can be checked against the source Git blobs. `ORIGIN_LANDING_CACHE` optionally reuses an owned preview cache. No non-fixture backend or port is required. The legacy website capture script is not used.

The first complete-App dependency transform took about three minutes on this Windows host and temporarily stopped the owned Vite process answering requests. The capture succeeded once it settled. An initial inspection frame and a narrower exploratory frame remain only in ignored scratch; neither is a published asset or final acceptance frame. The retained report describes only the final desktop case.
