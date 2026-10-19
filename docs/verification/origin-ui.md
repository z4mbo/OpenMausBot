# Origin shared UI verification

This recipe mounts production renderer components in an isolated fake-engine workspace. It covers shared dialogs, issue property controls, the team-chat composer and populated image/file attachments. It does not establish acceptance of every Origin page, Electron packaging, a live Origin account, real calls, or GitHub operations.

## Run

```powershell
node --experimental-strip-types scripts/verify-origin-ui.ts
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-ui.mjs http://127.0.0.1:PRINTED_PORT/__origin-ui.html
node scripts/testing/check-origin-chat-attachments.mjs http://127.0.0.1:PRINTED_PORT/__origin-ui.html after
npx.cmd vitest run src/components/CenteredDialog.test.ts src/components/origin-pages/ui-dialog.test.ts src/components/origin-pages/TeamChatPage.test.ts src/components/origin-pages/pages.test.ts
npx.cmd tsc -b
```

Stop the exact foreground launcher with Ctrl+C. The launcher owns the fake engine and temporary home. Its Vite preview routes return synthetic member-chat results; sending a message cannot reach the user's workspace. No running main-checkout server or Convex process is involved.

## Reproductions and changes

| Component / file | Scenario before the fix | Result after the fix |
| --- | --- | --- |
| `src/components/CenteredDialog.tsx` | The panel receives initial focus. Shift+Tab is not intercepted, so focus leaves the dialog. Hidden controls and controls with negative tabindex also enter the calculated tab order. When two dialogs exist, the older listener handles Escape first. | Only the last dialog handles navigation. Tab starts inside and wraps around visible, enabled tab stops. Removing the dialog returns focus to its opener. Three regression tests failed before and pass after. |
| `src/components/origin-pages/ui.tsx`, `AssetsPage.tsx` | During an asset upload the caller refuses `onClose`. Modal still starts its exit animation, becoming invisible with pointer events disabled while remaining mounted. Its dialog has no accessible name. | Modal uses CenteredDialog, names itself from its heading, and checks `canClose` before animation. An upload refusal leaves opacity at 1 and the controls interactive. Nested confirmations only dismiss themselves. |
| `src/components/origin-pages/TeamChatPage.tsx` | Send “First message”, then type “Second draft” before the two-second synthetic response. Success clears the new draft. Two submit events before a render also dispatch two POST requests. | The acknowledged draft clears only if its edit revision is unchanged. A synchronous in-flight guard serializes sends/uploads. Failure preserves the draft. Two regression tests failed before; all four send tests pass after. |
| `src/components/origin-pages/TeamChatPage.tsx:369` | A 1600 × 400 image renders at 320 px inside a 303 px message column on a 375 px screen. A 204-character unbroken filename creates a 1270 px download button and a 1326 px chat scroller at both 375 and 1280 px. The root document remains bounded, hiding the defect from document-only measurements. | Bound images by both the parent width and 320 px. Bound download buttons by the message column, truncate their visible filename while retaining the full name in the title and download, and prevent the icon/size from shrinking. All eight attachment/theme/viewport cases have bounded horizontal scrollers; four file downloads preserve the exact bytes and full filename. |
| `src/components/origin-pages/issue-fields.tsx` | At 375 px the Assignee list extends beyond the viewport (right edge 382.5 px). The native date field explicitly requests a dark control even under Atelier. | Property lists clamp to an 8 px viewport inset. Date controls follow the active skin's scheme. Tested Status, Priority and Assignee in both themes at 375 and 1280 px. |

The shared Modal surface now uses the same page background, border, radii, overlay and mobile sheet geometry as issue/search/release dialogs. The team-chat mention menu uses a flat hairline surface.

## Captured evidence

Evidence lives in `docs/verification/evidence/origin-ui/`. `after-browser-checks.json` records the exact preview URL, theme/viewport cases, zero page errors, reduced-motion behavior and draft-preservation result.

| Screen | Before | After |
| --- | --- | --- |
| Mobile issue properties, light | `issue-before-mobile-light.png` | `issue-assignee-after-mobile-light.png` |
| Mobile asset-style Modal | `modal-before-mobile.png` | `modal-after-mobile-dark.png` |
| Busy Modal after attempted close | `modal-busy-before.png` | `modal-busy-after-mobile-dark.png` |
| Chat draft during request | `chat-before-pending.png` | `chat-after-pending.png` |
| Chat draft after acknowledgement | `chat-before-finished.png` | `chat-after-finished.png` |
| What's new before current release notes | `whatsnew-before-desktop.png`, `whatsnew-before-mobile.png` | `whatsnew-after-{desktop,mobile}-{dark,light}.png`, refreshed with the final version 0.2.3 notes. |

Additional after screenshots cover desktop/mobile and Midnight/Atelier for each shared dialog and issue menu. These are production components mounted in a synthetic preview, rather than screenshots of an authenticated full project page. Full-page acceptance remains a separate requirement.

## Inventory and remaining work

`component-inventory.json` indexes every TSX component path, named exports and basic shared-control markers for dispatching the remaining audit. An index is not a completed review or runtime result. Source triage included the Origin issue composer/detail, asset/token editors, feedback/settings, vault editor, project/repository/member selectors, workspace members, project/workspace chat and the shared controls.

Subsequent coverage and remaining boundaries:

- The assignment/account/members wrappers, project header, agent views, completed delegations and search received a subsequent production-component browser pass. Its changes, before/after evidence and remaining acceptance gaps are recorded in [Origin dialogs and project navigation](origin-project-ui.md).
- Populated team-chat image/file attachments now have an eight-case production-component browser pass at 375 and 1280 px in Midnight/Atelier, with actual binary fetches and downloads from intercepted loopback routes. `chat-attachments/{before,after}-browser-checks.json` and matching screenshots record the source defect and corrected geometry. This proves renderer layout and download handling with synthetic files, not storage authorization or cross-machine file persistence.
- Calls, drawing, onboarding and all available Settings sections received subsequent production-component browser passes: [calls](origin-calls.md), [drawing](origin-draw.md), [core/onboarding](origin-core.md). The [project-page matrix](origin-pages.md) covers the production asset/token, Vault, feedback and issue editors, including mutation errors and live role changes. Their reports preserve provider, multi-machine and persistence limits.
- Completed-delegation disclosure, local project/agent search and responsive project-agent navigation are covered by the navigation pass linked above. Running/approval delegation and authenticated issue/message search acceptance remain distinct from the local-search fixture.

The main checkout was inspected read-only. Its pending UI changes removed barrel exports, unused cloud types and unused Zap canvas components. A source search found no remaining imports of the removed Zap exports. Those changes were not copied into this worktree and do not constitute runtime verification.

## Recorded run

On 2026-10-17 the launcher reported server `http://127.0.0.1:21671`, preview `http://127.0.0.1:5173/__origin-ui.html`, PID 12920 and temporary directory `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-7amOSE`. Persistent log: `C:\Users\aless\AppData\Local\Temp\openmausbot-verification-evidence\server-1792271857718-26216.log`.

That initial browser check passed ten cases with no page errors. The final shared-control/release-history check passed 14 cases with zero page errors at preview `http://127.0.0.1:5173/__origin-ui.html`, disposable server `http://127.0.0.1:20873`, PID `25392`, data directory `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-eo5GaX`, persistent log `C:\Users\aless\AppData\Local\Temp\openmausbot-verification-evidence\server-1792274884570-23852.log`. Its exact foreground launcher was stopped. Final integrated test results are recorded in [the audit](origin-audit.md).

The attachment before/after matrix used an HMR-disabled fixture at preview `http://127.0.0.1:5173/__origin-ui.html`, disposable server `http://127.0.0.1:20116`, PID `26424`, data directory `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-uuVT01`, persistent log `C:\Users\aless\AppData\Local\Temp\openmausbot-verification-evidence\server-1792275454437-30020.log`. Its checker verifies the fixture HTML entry/title before navigation, rejects non-loopback requests and measures every element with horizontal scrolling enabled. Before screenshots show six overflowing cases; all eight after cases pass with zero page errors. Its exact launcher was stopped and PID absence verified; its temporary directory remains. No cleanup bypass was attempted. The four existing send tests and touched-file Oxlint passed after the attachment change.

The final 14-case shared-control run passed with zero page errors after that change. Its four release-history cases explicitly verify version `0.2.3`; finite screenshot animations finish before capture. Preview `http://127.0.0.1:5173/__origin-ui.html` belonged to disposable server `http://127.0.0.1:19940`, PID `25296`, data directory `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-EysYw7`, persistent log `C:\Users\aless\AppData\Local\Temp\openmausbot-verification-evidence\server-1792275568377-4988.log`. Its exact launcher was stopped and PID absence verified; its temporary directory remains.
