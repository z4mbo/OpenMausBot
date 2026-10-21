# Origin candidate 050 — 0.7.2 integration

2026-10-21. **Candidate verification; not a published release.** Published Origin remains 0.7.1, source `fa83fb6b9e7e6e7e8195e93405a975007917872a`. The main checkout remains separate. Final frozen-source CI, Windows/macOS artifacts, package audit and production delivery for cycle050 are pending. Old049 operators remain held.

The integration preserves the newer0.7.1 product work and explicit Sales/Pipeline/public-Canvas removals, while retaining shared models, conversation continuity and audit safeguards. Legacy backend tables were retained for existing data. This report does not claim every feature or installation is now verified.

## Source and fixes

| Change | Commit |
| --- | --- |
| Integrate0.7.1 product work with audit/model-host safeguards | `dc652c11a0ce37331aff8a35810a9c86c6162e35` |
| Adopt upstream#3177 narrowly: keep Claude API credentials available across workspace scopes and report metered billing accurately | `0021fb7c1510273f6f5e362baa67a6ce526835d0` |
| Hide Usage portals belonging to retained inactive conversations | `b13f328a96a16c17f85c1676a7da2c90d3919630` |
| Run CI for direct integration-branch pushes | `a7636129e50107f235c889a28b13113b2b72ce93` |
| Show a removed Publish account as an explicit choice | `a78e0438afe1a0165c352163122ce144a8f0ce88` |

File/line references below describe the integrated source at archive time; the [selected raw-source hashes](evidence/origin-candidate-050/receipts/current-source-bindings.json) bind their actual bytes.

| Severity | Path:line and concrete state → wrong result | Correction / commit |
| --- | --- | --- |
| P2 | `backend/convex/budgets.ts:162`: a workspace member with a private project agent ID could read its budget without project membership. | Require active project membership and matching team before budget checks; carry `1697edd4a79a65c7aed0e88199f63e659ebb31e4` through `dc652c11a`. |
| P2 | `backend/convex/modelHosts.ts:26,181,236,250,328`: hosted execution could bypass monthly admission or omit the corresponding spend accounting. | Check cap at admission/claim/start and record settled spend; carry `a4af30264f6bf30e7fb48495589506db48c53ad1` through `dc652c11a`. |
| P2 | `server/routes/studio.ts:97`, `server/origin-studio-workflow.ts:188`, `server/origin-studio.ts:348,485,552`: new workflow/HTTP paths could spend without the existing daily-cap guard or trust a caller-supplied charged agent. | Preserve mandatory pre-spend checks, trusted agent attribution and account/project refusal across extracted routes/tools/workflows; `dc652c11a`. |
| P2 | `server/config.ts:1294`, `server/drivers/claude.ts:839,1795`: dedicated Claude API selection with a configured workspace key reached the driver without that key; API-key authentication could be labelled subscription. | Route the selected key and classify effective API-key billing; `0021fb7c1`. No real provider invoice or paid call was used. |
| P2 | `src/components/ChatUsagePopover.tsx:51`: hidden retained Chief and visible Echo conversations shared an open preference, displaying two Usage portals and stale Chief context. | Require a connected, visible trigger with nonzero geometry and observe hide/show; `b13f328a9`. |
| P2 | `src/components/origin-broadcast/BroadcastComposer.tsx:91,97,297`: a selected channel with no confirmed local account could enable Publish/Schedule; project changes could retain old account state. | Require known selected accounts, preserve explicit account identity, remount per-project state, and keep Draft Save/approval available; `dc652c11a`. |
| P2 | `src/components/origin-broadcast/ComposerParts.tsx:40`: a removed saved account still displayed the available default account as selected. | Show an empty shared Select with “Choose an account” until a person chooses; `a78e0438a`. |

Model-host privacy, approval, budget and no-replay guarantees were retained rather than replaced by the newer main backend. Their prior bounded scenarios and UI work remain documented in [candidate048](origin-candidate-048.md) and [candidate049](origin-candidate-049.md); historical results are not new0.7.2 native or production acceptance.

## Actual UI observations

Root drove the real isolated core fixture on5174 and Draw fixture on5173 with synthetic state. The archive agent did not independently operate CUA. See the [browser supplement](evidence/origin-candidate-050/receipts/root-browser-supplement.json) and screenshots:

| Screen | Observed result | Evidence |
| --- | --- | --- |
| Agents / threads | Project Chief excluded. A new independent Echo thread persists after reload; two threads remain. | [Final Agents](evidence/origin-candidate-050/screenshots/agents-usage-after-final.png) |
| Usage | Before: two portals, stale Chief12/200k beside Echo “Not reported”. After settling: one correct Echo portal. | [Before](evidence/origin-candidate-050/screenshots/agents-usage-before.png), [after](evidence/origin-candidate-050/screenshots/agents-usage-after.png) |
| Publish,375px | Empty connections: document width375, Publish disabled, Save enabled. Actual isolated Save persisted an Unscheduled Draft. | [Composer](evidence/origin-candidate-050/screenshots/publish-375-after.png), [saved Draft](evidence/origin-candidate-050/screenshots/publish-draft-saved-375.png) |
| Publish account replacement | Matched actual-component renderer: removed account silently selected the default and allowed publishing before; final UI shows “Choose an account” and blocks publishing. An explicit choice restores availability. Both narrow pages are375px without page overflow; no post was sent. | [Before375](evidence/origin-candidate-050/screenshots/publish-compare-before-375.png), [after375](evidence/origin-candidate-050/screenshots/publish-compare-after-final-375.png), [before desktop](evidence/origin-candidate-050/screenshots/publish-compare-before-wide.png), [after desktop](evidence/origin-candidate-050/screenshots/publish-compare-after-final-wide.png) |
| Canvas,375px | Layers x13..41 and Design x334..362; panel bottom748 precedes toolbar start767; document width375. | [After](evidence/origin-candidate-050/screenshots/canvas-375-design-after.png) |

These are selected interactions and measurements, not all-screen/all-theme acceptance. Publish comparison uses the actual0.7.1 Composer with its shared pre-correction helpers, then the corrected Composer/helper, against synthetic account props. The [browser record](evidence/origin-candidate-050/receipts/publish-browser.json) preserves that source boundary. No real channel publish, paid provider turn, physical Mac/Windows install or production mutation was used for these UI checks.

## Verification and limits

| Check | Result and boundary |
| --- | --- |
| Client/shared | 634files,6,457tests PASS **before** the later Usage visibility and account-label changes. Four focused suites/28tests PASS after the Usage change; AccountRow/readiness suites20tests PASS after the label change, with five new assertions failing before it. |
| Backend | 42files,333tests PASS; backend typecheck PASS. Local synthetic tests, no production rows. |
| Focused merge checks | Server101 and backend24 PASS. Original tool results are recorded in the host report; individual raw logs were not saved. |
| Claude#3177 | 465distinct tests PASS,5existing skips; three actual isolated HTTP checks through repository fake CLI, with owned server/temp-data cleanup. Four selected assertions failed before the fix. |
| Publish readiness | Four before-fix failures; final four suites/39tests PASS, including12 Composer cases. Mutation boundaries mocked. |
| CI policy / workflow | 93tests and21tests PASS. Final exact-source GitHub CI has not yet run. |
| Docs / ratchet / release guards | 7 /1 /43tests PASS. |
| Global client/server typechecks and lint | Passed before the last Usage visibility change; final pre-push verification remains root-owned and pending. |
| Schema compatibility | Locally compiled working merge94→96tables; no removed tables, narrowed validators or removed indexes. Two model-host tables and optional fields/index added. Not a final frozen/deployed schema proof. |

Raw bounded logs and historical red/green receipts are indexed by the [byte-hash manifest](evidence/origin-candidate-050/manifest.json). Historical receipts retain original “uncommitted”/“pending” fields; the source/observation supplements record later progress without rewriting history.

## Upstream review and possible follow-up

The [45-row ledger](evidence/origin-candidate-050/upstream/upstream-review.md) covers merged upstream PRs after2026-10-20T04:03:12Z through2026-10-21T04:01:05.255Z, checked against audit`bdea56e9…` and main`fa83fb6b9…`. Search coverage was cross-checked with the closed-PR API. Only [#3177](https://github.com/milind-soni/OpenMausBot/pull/3177) was adopted;44 remain deferred/not applicable. This is source triage, not runtime certification of those upstream changes.

Useful next candidates are#3010 failed-persistence rollback,#3169 GitHub MCP schema annotations,#3150 idle MCP shutdown handling,#3035 bounded recovery around repeated actions,#3141 browser profile lifecycle, and#3151 Windows caption bridge. Each needs an isolated regression and an explicit compatibility check against Origin's project/Chief hierarchy, sender/host identity, budget/approval and uncertain-work no-replay rules. Merge or cherry-pick one logical feature at a time; retain the ledger and run the affected feature fixtures before release. Upstream cloud subscriptions and pricing policies are not adopted wholesale.

## Delivery prerequisite completed; release still pending

Root completed one authorized private-cache cleanup:33 exact obsolete private distribution payloads unlinked after full retained-local SHA proof. Retained copies, public0.7.1 feeds, images, rollback resources and protected metadata remained stable. Final observed free space was6,537,908,224bytes. [Completion receipt](evidence/origin-candidate-050/cleanup/execution.json), intent, streamed outcomes and manifest/proofs are archived. Automatic replay is prohibited; no additional cleanup is requested.

The [0.7.2 release notes](origin-0.7.2-release-notes.md) describe the proposed release. Freeze source, pass final CI/native/package gates, use fresh050 delivery admissions, verify the website/backend/download/feed identities, and record final evidence before claiming it published. The earlier049 candidate stays held.
