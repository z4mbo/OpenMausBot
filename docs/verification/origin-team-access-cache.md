# Additional-team cache recovery

Prepared fix: `01ddbb18b123954c5381bb77a372de32e63d2961`, based on frozen source `d09a9202130ef58976aea8ee6c221dc433f97e25`. This isolated follow-up adapts [OpenMausBot #3036](https://github.com/milind-soni/OpenMausBot/pull/3036), merge `53d759e8841abe6a1bd869637c221b99d1f7b7ea`. It changes no server permissions, version, release notes, or historical audit rows. It has not been pushed or published by this verification.

## Finding and correction

A complete bot announcement omits a cleared optional `managedSections` field. The client spread its existing bot into three update paths, keeping the old grant array. A workspace head that loses its Chief role and is elected again could therefore retain the removed project list in the renderer, even though the server correctly revoked it.

The initial [handoff](evidence/origin-team-access-cache-033/original-handoff.md) overstated the visible settings consequence. Origin sets `SHOWS_CHIEF_LABEL = false` in `src/lib/origin-teams.ts:9`, hiding Additional teams in `PermissionsSection.tsx:51`. The initial direct component render proved checkbox behavior only when that component is mounted. It did **not** establish that this settings panel is reachable in shipped Origin. That original report is preserved without edits and superseded by this correction.

The actual Origin consumer is `Sidebar.tsx:1676-1686`: it finds the account's active workspace head and filters project Chiefs through `inWorkspace`. That helper reads the head's `managedSections` (`src/lib/origin-workspaces.ts:75-84`). Stale grants therefore keep a detached project in that workspace's sidebar after re-election.

The fix copies `managedSections` explicitly from complete frames in normal `botPatched`, its thread-switch path, and `taskSwitched` (`src/state/store.tsx:1303,1315,1932`). Incoming non-empty grants are preserved. The nine parameterized regressions include demotion/re-election, omission while still Chief, and current-grant replacement controls.

## Actual isolated browser proof

The final [browser report](evidence/origin-team-access-cache-033/browser-report.json) drives the real Sidebar and StoreProvider in a separate headless Chromium profile. It creates a workspace through `POST /api/workspaces`, creates its project through `POST /api/bots/:id/default-team`, supplies the known account/workspace membership through the same `setAccountWorkspaces` API used after Origin sync, and hands the workspace Chief role to a replacement and back using the registered owner PATCH route.

Both baseline and fixed server records end with a Chief whose additional-team field is absent. Actual SSE announcements update the renderer. The baseline lists **Research project** under **Cache proof**; the fixed renderer removes that detached project. Both light and dark cases passed at 1440 × 1000 with reduced motion, no page errors, no horizontal overflow, and no external requests. The [original SSE proof](evidence/origin-team-access-cache-033/actual-sse-proof.json) independently retains the actual grant, demotion, and re-election frames from frozen source.

| Theme | Before | After |
| --- | --- | --- |
| Light | [Revoked project remains](evidence/origin-team-access-cache-033/before-1440-light.png) | [Revoked project removed](evidence/origin-team-access-cache-033/after-1440-light.png) |
| Dark | [Revoked project remains](evidence/origin-team-access-cache-033/before-1440-dark.png) | [Revoked project removed](evidence/origin-team-access-cache-033/after-1440-dark.png) |

This is a real browser/component integration, with a supplied post-sync membership state. Full App/OriginSync, authenticated cloud adoption, packaged Electron, mobile layout, and live agent tool execution were not qualified. Role changes used the owner API, not a visible Origin role-toggle control. The native bridge was simulated.

The unsuccessful [full-App attempt](evidence/origin-team-access-cache-033/full-app-attempt-no-membership.json) is retained: without an Origin session, OriginSync reset the account-membership list, so that fixture could not isolate the workspace filter. Two earlier setup attempts incorrectly expected HTTP 200 from creation routes that correctly returned 201. The [hidden-panel attempt](evidence/origin-team-access-cache-033/settings-attempt-hidden-panel.json) prompted the visibility correction above. These are fixture/reporting errors, not waived product failures.

## Authority and checks

No authorization bypass was established. `server/store.ts:1837-1844` deletes grants during handover; reviewed team setup also clears them at line 1560. `server/peer-roster.ts:28-36,94-100` checks the current server record. The isolated server's Research/General reach changed from allowed before revocation to denied afterward. No model or peer tool was called. The server source and sender-runs permissions are unchanged.

The [test record](evidence/origin-team-access-cache-033/tests.json) retains commands, source identities, raw-report hashes, and skip boundaries:

| Check | Result |
| --- | --- |
| New regressions on baseline | 6 fail; 3 grant-preservation controls pass; 212 unrelated tests skipped by filter |
| Complete client store suite after fix | 221 pass |
| Complete `src shared` suite | 564 files, 5,983 pass; no failures/skips |
| Server authority/store and comment/size guards | 260 pass; 1 existing platform skip |
| Workspace helper consumers | 9 pass |
| Final proof documentation/comment/size guards | 9 pass |
| App/server TypeScript, lint, diff check | Pass |

The documentation route check initially rejected the new workspace-route citation because its factory-module inventory omitted `server/origin-teams.ts`, which registers that route and is imported by `server/index.ts:590`. The proof commit adds that module to the inventory; no route exception or assertion was removed. The failed check and its passing recheck are retained in [proof validation](evidence/origin-team-access-cache-033/proof-validation.json).

All fake-engine fixtures used isolated homes and free ports outside 5199/8799/3210; no model turn started. Every owned fixture and preview stopped, its temporary data was removed, and Chromium closed. No production data, main checkout, root release worktree, root scratch, or shared browser tab was changed.

The [finite manifest](evidence/origin-team-access-cache-033/manifest.json) binds sixteen payloads. [Source bindings](evidence/origin-team-access-cache-033/source-bindings.json) identify both Git blobs for changed files and unchanged server/sidebar consumers. Boundary source/status checks are recorded; they are not continuous filesystem monitoring. The existing 0.2.12 version in screenshots identifies the frozen baseline package, not a new published release.
