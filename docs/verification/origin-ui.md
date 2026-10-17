# Origin shared UI verification

This recipe mounts production renderer components in an isolated fake-engine workspace. It covers shared dialogs, issue property controls and the team-chat composer. It does not establish acceptance of every Origin page, Electron packaging, a live Origin account, real calls, or GitHub operations.

## Run

```powershell
node --experimental-strip-types scripts/verify-origin-ui.ts
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-ui.mjs http://127.0.0.1:PRINTED_PORT/__origin-ui.html
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
| What's new before current release notes | `whatsnew-before-desktop.png`, `whatsnew-before-mobile.png` | Captured after release-note integration by the release owner. |

Additional after screenshots cover desktop/mobile and Midnight/Atelier for each shared dialog and issue menu. These are production components mounted in a synthetic preview, rather than screenshots of an authenticated full project page. Full-page acceptance remains a separate requirement.

## Inventory and remaining work

`component-inventory.json` indexes every TSX component path, named exports and basic shared-control markers for dispatching the remaining audit. An index is not a completed review or runtime result. Source triage included the Origin issue composer/detail, asset/token editors, feedback/settings, vault editor, project/repository/member selectors, workspace members, project/workspace chat and the shared controls.

Follow-up targets from this pass:

- The assignment/account/members wrappers, project header, agent views, completed delegations and search received a subsequent production-component browser pass. Its changes, before/after evidence and remaining acceptance gaps are recorded in [Origin dialogs and project navigation](origin-project-ui.md).
- Team-chat image attachments cap width at 320 px without a parent-width limit; long attachment names and 375 px layouts need a populated browser case.
- Call/draw, running/approval delegations, issue/message search results, onboarding and settings need their complete production-screen inventory exercised in real browsers, with synthetic APIs for gated content. Completed-delegation disclosure, local project/agent search and responsive project-agent navigation are covered by the subsequent pass linked above.
- All shared-Modal callers need full production-page screenshots, beyond this component fixture's interaction evidence.

The main checkout was inspected read-only. Its pending UI changes removed barrel exports, unused cloud types and unused Zap canvas components. A source search found no remaining imports of the removed Zap exports. Those changes were not copied into this worktree and do not constitute runtime verification.

## Recorded run

On 2026-10-17 the launcher reported server `http://127.0.0.1:21671`, preview `http://127.0.0.1:5173/__origin-ui.html`, PID 12920 and temporary directory `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-7amOSE`. Persistent log: `C:\Users\aless\AppData\Local\Temp\openmausbot-verification-evidence\server-1792271857718-26216.log`.

The browser check passed ten cases with no page errors. The four targeted Vitest files passed 28 tests. `npx.cmd tsc -b` exited 0. Server/backend checks are tracked separately by their owners.
