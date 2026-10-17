# Origin dialogs and project navigation

This pass mounts production components inside the isolated Origin UI fixture. It uses synthetic bots, a synthetic delegated transcript and synthetic search responses. No authenticated Origin workspace, live Convex deployment, provider, call, GitHub repository or packaged desktop app is involved.

## Run

```powershell
node --experimental-strip-types scripts/verify-origin-ui.ts
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-dialogs.mjs http://127.0.0.1:PRINTED_PORT/__origin-ui.html after
node scripts/testing/check-origin-project-ui.mjs http://127.0.0.1:PRINTED_PORT/__origin-ui.html after
npx.cmd vitest run src/components/OriginDialogs.test.ts src/components/CenteredDialog.test.ts src/components/origin-pages/ui-dialog.test.ts src/components/origin-pages/pages.test.ts src/lib/delegation.test.ts src/lib/origin-workspaces.test.ts
npx.cmd tsc -b
```

Stop the exact foreground launcher with Ctrl+C. Browser requests to non-loopback hosts are blocked by both checks. These checks prove renderer behavior and layout within the stated synthetic scenarios; they do not prove the mocked HTTP results or a production account's data flow.

## Reproduced failures

| Severity | Source | Concrete scenario | Fix and evidence |
| --- | --- | --- | --- |
| P2 | `src/components/origin-pages/AssignIssueDialog.tsx`, `OriginConnect.tsx`, `SidebarProjects.tsx` | Open the assignment/account/members dialog. Focus remains on its page opener. Shift+Tab reaches the page behind it; Escape there leaves the dialog open. | All three use CenteredDialog and the shared controls. The workspace menu returns focus to its trigger before its item disappears. Three regression tests failed before and pass after. Twelve browser cases at 375/1280 px in Midnight/Atelier changed from uncontained focus and ineffective Escape to contained focus, dismissal and opener restoration. |
| P2 | `src/components/CenteredDialog.tsx` | Open OriginSearch. Its input autofocuses before the passive effect records the current focus. Close search: its removed input was recorded as the opener, leaving focus on the document body. A nested autofocus dialog has the same problem. | Capture the opener during initial render. Restore only after the dialog element leaves the document, preserving child autofocus through StrictMode's effect replay. Two added regression tests failed before; all six shared-dialog tests pass. Search restores the opener in all four browser viewport/theme cases. |
| P2 | `src/components/ChiefSections.tsx` | A project with a long title at 375 px reserves fixed widths for its chief and tools. The document becomes 440 px wide; the tab strip collapses and some tools fall outside the screen. | Put the tab strip on a second row at mobile widths, allow the chief label to shrink, keep the tools visible. Document width is now 375 px; tools occupy x=219…363. All nine project sections remain selectable by the browser. Desktop remains one row. |
| P2 | `src/components/DelegationBlock.tsx` | At 375 px a long agent name consumes the disclosure header, clipping its subject and crowding the status/chevron. | Bound and truncate the name, preserving the status, subject and disclosure affordance. Before/after screenshots show the actual component with a completed synthetic delegation; expansion still reveals its transcript. |

## Screenshots and browser records

All files are under `docs/verification/evidence/origin-ui/`.

| Surface | Before | After |
| --- | --- | --- |
| Assignment dialog | `assign-before-{desktop,mobile}-{dark,light}.png` | `assign-after-{desktop,mobile}-{dark,light}.png` |
| Origin account dialog | `connect-before-{desktop,mobile}-{dark,light}.png` | `connect-after-{desktop,mobile}-{dark,light}.png` |
| Members dialog | `members-before-{desktop,mobile}-{dark,light}.png` | `members-after-{desktop,mobile}-{dark,light}.png` |
| Project agents and header | `project-agents-before-{desktop,mobile}-{dark,light}.png` | `project-agents-after-{desktop,mobile}-{dark,light}.png` |
| Delegation | `delegation-before-{desktop,mobile}-{dark,light}.png`, `delegation-expanded-before-…` | `delegation-after-{desktop,mobile}-{dark,light}.png`, `delegation-expanded-after-…` |
| Origin search | `search-before-{desktop,mobile}-{dark,light}.png` | `search-after-{desktop,mobile}-{dark,light}.png` |

`dialogs-before-browser-checks.json` and `dialogs-after-browser-checks.json` record focus containment, Escape, focus return and viewport bounds. The after run additionally chooses an agent, verifies filled account fields enable submission without sending credentials, and opens/closes the nested account dialog from Members without dismissing Members.

`project-ui-before-browser-checks.json` and `project-ui-after-browser-checks.json` record responsive geometry, mobile agent-chat return, delegation expansion and keyboard search selection. The after run selects Issues, Chat, Call, Draw, Assets, Vault, Repo, Feedback and Settings in each viewport/theme combination. Their screenshots are `project-SECTION-gate-after-SIZE-THEME.png`. These are the **No workspace server** gate, not populated application pages. Children of a horizontally scrolling tab strip may report bounds beyond the viewport; document width and the fixed tool group are the asserted geometry.

## Coverage inventory and remaining work

| Production surface | Inspected and exercised | Still unverified |
| --- | --- | --- |
| AssignIssueDialog | Initial focus, reverse Tab, Escape, focus return, agent choice; desktop/mobile and light/dark | Real task hand-off, model execution and chief review |
| OriginConnectDialog | Named dialog, shared controls, field enablement, nesting, Escape and focus return | Actual login/logout failures, account switching and session hand-off |
| SidebarProjects MembersDialog / WorkspaceSwitcher | Shared dialog, runtime help, nested sign-in, trigger return; desktop/mobile and light/dark | Populated members/invites, role changes, leave/remove actions and project reordering |
| ChiefSections | Long-title header geometry; every project tab/tool selection; desktop/mobile and light/dark | Populated project pages and cross-project authorization |
| ProjectAgentsPage | Synthetic chief/agent list, embedded production ChatView, mobile agent selection/back; desktop/mobile and light/dark | Creating agents, persisted choice, team map and concurrent running agents |
| DelegationBlock | Completed synthetic transcript, long agent name, disclosure open/close; desktop/mobile and light/dark | Working/live thought, queued/failure/approval states, interrupt dispatch and approval attribution |
| OriginSearch | Actual project/agent results, highlighted query, ArrowDown selection, Escape/focus return; desktop/mobile and light/dark | Issue/message result navigation, archived projects, stale responses and live backend search |
| Issues, team chat, calls, draw, assets, vault, repository, feedback, project settings | Source inventory and actual project section switching/gate screenshots | Populated production pages, mutations, full permissions, media, uploads, encryption and multi-user state |
| Onboarding, main Sidebar, core Settings/browser/call/draw | Located production components and existing verification recipes | Root and later specialists own their full-app and feature-specific browser passes; this report makes no acceptance claim for them |

For populated cloud pages, a future fixture can give Vite a fixture-only alias for `@/lib/origin-cloud` that serves synthetic hook results, while mounting the unchanged production screens. Keep its mocks confined to the preview. Such screenshots would establish renderer behavior only; backend integration still needs an isolated backend fixture.

## Recorded run

The 2026-10-17 launcher reported server `http://127.0.0.1:21933`, preview `http://127.0.0.1:5173/__origin-ui.html`, PID 18400 and temporary directory `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-D2JOPO`. Persistent log: `C:\Users\aless\AppData\Local\Temp\openmausbot-verification-evidence\server-1792272300718-11232.log`.

The six targeted test files passed 40 tests. The touched files passed Oxlint. `npx.cmd tsc -b` exited 0. Server/backend checks are owned separately.
