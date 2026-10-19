# Issue drag permission and project changes

The interaction pass starts at `1d54aab6f493bf834b9ffc2153fdf9045a47f41d`. Fix `7f2c4e3e70d53f3671be798ad0d789a1ad575b02` addresses one P2 renderer defect; it does not change backend authorization or establish an access bypass.

## Proven defect and passing control

Start dragging an issue as an editor, then receive a viewer downgrade while the pointer remains held. Production IssuesPage shows its view-only notice but the previous drag still has a ghost/drop gap. Releasing emits `tasks:moveTask` with the former editing state. A pressed card could also begin dragging after the downgrade because its delayed movement listener captured the earlier enabled state.

The drag hook now reads current permission at lift and commit, and cancels the active drag/target when permission becomes disabled. The identical final five-case regression gives two failures/three preservation passes before, then five passes after. Controls cover a fresh allowed drag after upgrade, Escape and project unmount.

Two actual-browser journeys use the production IssuesPage and native Chromium input with synthetic cloud data. Viewer downgrade changes from one post-revocation mutation to zero, cancels the gap, restores all twelve cards and releases the body selection lock before pointer release. A keyboard project switch while the pointer stays held cancels the old drag and sends no mutation on both sources. No page errors or external requests occurred. Backend persistence, real accounts, touch hardware and packaged Electron remain outside this acceptance.

| Journey | Before | After |
| --- | --- | --- |
| Viewer state before pointer release | [Old drag remains](evidence/origin-issue-drag-permission-034/before-viewer-changed.png) | [Drag cancelled](evidence/origin-issue-drag-permission-034/after-viewer-changed.png) |
| Viewer after release | [Prior mutation recorded](evidence/origin-issue-drag-permission-034/before-viewer-released.png) | [No mutation](evidence/origin-issue-drag-permission-034/after-viewer-released.png) |
| Project switch while held | [Passing control](evidence/origin-issue-drag-permission-034/before-project-switch.png) | [Passing control](evidence/origin-issue-drag-permission-034/after-project-switch.png) |

The [raw browser results](evidence/origin-issue-drag-permission-034/before-browser.json), [fixed results](evidence/origin-issue-drag-permission-034/after-browser.json), [checks/source report](evidence/origin-issue-drag-permission-034/report.json) and [manifest](evidence/origin-issue-drag-permission-034/manifest.json) retain exact scenarios and boundaries. Five related files pass 26 tests; comment/size/documentation guards pass nine cases. App TypeScript, touched lint and diff checks pass. The wider server/backend/full-suite gates belong to integration.

## Component interaction coverage

| Component | Read in this pass | Newly exercised / remaining |
| --- | --- | --- |
| IssuesPage/useCardDrag | Pointer admission, target/drop, optimistic move, keyboard move, canEdit and CloudGate identity | Two browser journeys above; pressed/lifted revocation and three preservation unit controls. Account/backend switches and pending mutation settlement remain separate. |
| NewIssueComposer | Viewer project filtering, project-keyed form, required fields, Ctrl/Meta+Enter, busy state, async create/onCreated | Existing default tests are included in the related selection. No new pending-create, double-submit or cross-account completion browser journey is claimed. |
| ChiefSections | Team filtering, section state, task assignment and Chief handoff callbacks | Source review only here; no new complete handoff or approval workflow. |
| ProjectAgentsPage | Per-lead selection map, selected ChatView key, mobile back, new-agent portal | Source review only here; cross-lead persisted choice, pending creation and real concurrent agents remain open. |
| DelegationBlock | Request-scoped transcript/status, pending approval IDs, exact thread/agent dispatch for decision/interrupt | Source review only here; queued/working/failure/approval/interruption browser and model workflow remain open. |

The fixture's exact server/launcher and listeners on 19757/5174 are closed. Ctrl-C stopped the exact owned processes, and the standard fixture cleanup removed `openmausbot-verify-data-dvYLq9`; its absence was checked. No manual deletion was needed. Main services, local Convex, production data and release version/source were untouched.
