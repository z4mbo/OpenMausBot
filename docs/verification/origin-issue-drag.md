# Issue cards during rapid dragging

This P2 renderer defect is reproduced against `87ff77be5ea79272175219d479b9a8017b4e8fcc` in an isolated production IssuesPage fixture. It does not establish a backend deletion or missing persisted task: all 36 cards remained in the DOM and returned after release.

## Scenario and correction

Populate Draft, Todo and In Progress with twelve issues each. Drag the first Draft issue rapidly up/down and across those lanes before their previous reorder animations finish. The FLIP hook measured animated card rectangles as new layout positions and started additional animations without cancelling earlier ones. Pointer targeting followed those moving rectangles, repeatedly changing the drop gap. Cards in all three lanes moved outside the visible board: the actual browser recorded up to seventeen animations on one card and a vertical coordinate of 33,554,432 pixels.

The hook now owns each card animation, captures its displayed position, cancels the prior animation before measuring layout, and keeps that layout position separate from the visible offset. An interrupted movement continues from the displayed position. Unmount and subsequent reduced-motion movements cancel outstanding animation. Ordering, task mutations and server permissions are unchanged.

Inspected paths are IssuesBoard lane/pending rendering, TaskCard/DragGhost/DropGap, useCardDrag press/hold and RAF/scroll/drop/cancel handlers, dropTargetAt, orderForMove/withPendingMoves and useFlip. There is no board virtualization in this path. The change stays in the shared board movement hook.

## Actual browser evidence

| State | Before | After |
| --- | --- | --- |
| During rapid pointer movement, dark, 1440 × 1000 | [Empty-looking lanes](evidence/origin-issue-drag-034/before-during.png) | [All lanes retain visible cards](evidence/origin-issue-drag-034/after-during.png) |
| After release | [All tasks return](evidence/origin-issue-drag-034/before-release.png) | [All tasks remain](evidence/origin-issue-drag-034/after-release.png) |

Three accepted fixed-source cases each use 64 native browser pointer moves: dark/drop, light/Escape and dark/reduced-motion/drop. Every sample retains 35 non-lifted cards and at least one visible card in each lane. Normal motion has at most one programmatic movement animation per card; reduced motion has none. The broader animation count also includes ordinary CSS hover transitions. Drop sends one `tasks:moveTask`; Escape sends none; no mutation is sent during the drag. All 36 cards return after either outcome, with no remaining transform. The additional [light cancellation](evidence/origin-issue-drag-034/after-light-cancel.png) and [reduced-motion](evidence/origin-issue-drag-034/after-reduced.png) frames are after-only controls.

The production renderer/styles and actual Chromium mouse events use a synthetic cloud board and mutation adapter. This proves visible drag stability and mutation admission, not Convex persistence, real account behavior, touch hardware or packaged Electron. Browser errors and external requests are zero. [The report](evidence/origin-issue-drag-034/report.json) binds working-source hashes, original Git blobs, raw private report hashes, actual metrics and limits; [the manifest](evidence/origin-issue-drag-034/manifest.json) binds the retained payloads.

## Regression and checks

The identical final five-case regression produces four failures and one ghost-seed preservation pass before the fix, then five passes after. It checks rapid interruption, stable layout versus displayed position, unmount, reduced-motion cancellation and the dropped ghost origin. The related selection passes 39 tests across five files; comment/size/verification-document guards pass nine cases across three files. App/server TypeScript, touched-file lint and whitespace checks pass. Full integrated client/shared and final release CI remain the integration owner's gates.

The style follow-up caps both seeded and ordinary card movement at **180 ms**, within the requested 120–200 ms range. The existing rapid-interruption regression now asserts that range: against the earlier 220/240 ms hook it produces one failure/four passes, then all five cases pass at 180 ms. One additional current-source dark/drop browser case performs 64 native moves, records actual 180 ms animation timings, at most one movement animation per card, every lane visible and one final move request. [Follow-up source, metrics and cleanup](evidence/origin-issue-drag-034/duration-followup.json) and [current-source capture](evidence/origin-issue-drag-034/duration-after-during.png) retain the boundary. The earlier three-case browser matrix and app/server type checks belong to the preceding hook checkpoint and were not repeated or relabelled; this follow-up reran only the five touched regressions, that one browser control, touched lint and whitespace validation.

The fixture launched through `scripts/verify-origin-pages.ts` and the standard isolated control surface, with fake-engine server 22398 and preview 5174. Its exact server/launcher processes and both listeners are absent. Ctrl-C interrupted automatic temporary-directory cleanup. Automatic approval review rejected guarded removal of `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-VzdoDm` with “blocked by policy”; that stopped disposable directory remains, and no alternate deletion was attempted. No main-checkout ports, local Convex, real model/provider, account or production data were used. The current release version and frozen 033 source were not changed.
