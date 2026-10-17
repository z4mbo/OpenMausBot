# Origin drawing verification

Start a disposable fake-engine server and the actual Excalidraw renderer:

```powershell
node --experimental-strip-types scripts/verify-origin-draw.ts
```

Use the exact printed `previewUrl` in a second terminal:

```powershell
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-draw.mjs http://127.0.0.1:PRINTED_PORT/__origin-draw.html
pnpm exec vitest run src/components/origin-pages/DrawingCanvas.test.ts src/lib/origin-drawing-outbox.test.ts
```

The checker accepts only the loopback fixture path and verifies its title and fixture API before interacting. The renderer uses production DrawingCanvas, ProjectDrawPage, Excalidraw, styles, and shared controls. Its cloud adapter contains synthetic scene/presence data and controlled save failures. It never connects to Convex or a provider. Snapshot attachment tests do not send a real bot turn.

The browser matrix covers Midnight and Daylight at 375 and 1280 pixels, with reduced motion. In each case it draws actual shapes, verifies save acknowledgement, leaves during a blocked save, rejects the old save, returns and verifies recovery, reloads during another blocked save and verifies all three latest shapes survive, and checks viewer controls. It also creates a project canvas and checks its selected tab, opens Ask, dismisses it with Escape and verifies focus returns. Geometry checks cover horizontal overflow and overlapping Create/Ask controls. Before and after screenshots and machine-readable results are in [evidence/origin-draw](evidence/origin-draw/browser-checks.json).

## Findings and fixes

| Severity | Scenario | Result before | Fix |
| --- | --- | --- | --- |
| P1 | An element batch starts saving; navigation unmounts its canvas; the save rejects. | The batch was removed before awaiting and cleanup saw no remaining rows; the rejection requeued into an abandoned ref. | A persistent outbox retains elements until acknowledgement, restores them after navigation/reload and preserves newer versions during older acknowledgements. Image bytes remain queued until upload acknowledgement. |
| P2 | A remote image finishes downloading after its canvas unmounts. | The old API and state could still be updated. | Abort downloads and check cancellation before applying image data or errors. |
| P2 | Two Ask submit events occur before React renders the busy state. | Both export a snapshot and can send duplicate agent turns. | A synchronous in-flight guard admits one export. |
| P2 | The Ask popover closes while its snapshot is exporting or uploading. | The completed asynchronous work could still send a turn and navigate away. | Closing/unmounting invalidates its request generation before any later attachment/send stage. |
| UI | At 375 pixels, create a project canvas while presence and Ask are visible. | Name/Create controls overlapped presence and Ask even though document scroll width stayed 375. | The picker gets a full mobile row; tabs and the name form wrap without covering other controls. |

The outbox is scoped by server URL, account, workspace and canvas. It stores no session token. Writes use the captured session explicitly and stop when that session/server changes. Storage quota failure preserves the in-memory draft, shows a keep-open warning and protects browser unload until sync; closing the process forcibly can still lose a draft when device storage is unavailable. Unsent drawings remain on that device until acknowledged rather than being silently discarded on sign-out.

The canvas UI maps Excalidraw's own control tokens to Origin's font, palette, accent, hairline borders and radii, removes toolbar shadows, and respects reduced motion. Its drawing tools retain their native symbols and drawing colours.

## Evidence boundaries

The regression suites contain 13 passing tests. Initial component regressions failed before the fixes for lost in-flight edits, uncancelled downloads and duplicate snapshot exports. Browser evidence proves the renderer and synthetic adapter workflow; it does not qualify real Convex availability, multi-device media/storage delivery or native Electron packaging. No user data or running app ports are used.

Stop the foreground launcher with Ctrl-C. It closes its own preview and exact fake-engine child and removes its temporary workspace; the printed server log remains.

During this Windows command-session run, Ctrl-C stopped all four owned server processes but interrupted automatic directory cleanup. The guarded manual PowerShell cleanup was rejected by automatic approval review with "blocked by policy". No alternate deletion method was attempted; exact remaining disposable directories and stopped PIDs are recorded in [fixture-cleanup.json](evidence/origin-draw/fixture-cleanup.json).
