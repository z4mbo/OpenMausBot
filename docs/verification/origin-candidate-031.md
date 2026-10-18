# Origin 0.2.11 candidate

This candidate is locally verified and unpublished. The public website, downloads and feeds remain 0.2.10. Version 0.2.11 and its eight shared release notes are prepared; they do not establish publication. The [delivery goal](origin-delivery-goal.md) includes the latest Draft, workspace, sidebar and email requirements.

## Changes and evidence

| Change | Root commits | Evidence |
| --- | --- | --- |
| Draft first; unspecified issues from the app, feedback, Chiefs and connector default to Draft; explicit choices and historical imports retain their destinations | `2987dd617`, `125da0369`, `f7a426853`, `01080e8b7` | [Creation-path inventory, 32 matched screenshots and 20 form flows](origin-draft-defaults.md); [backend regression and bounded repair](origin-draft-domain.md). |
| Pending legacy Idea remains private until Draft repair | `f7d1de48c`, `f7a426853` | [Client mirror comparison](origin-draft-mirror.md); registered backend publishing-context tests. No external issue was created for testing. |
| Delete an empty local workspace without a residual dropdown or reserved-name suffix; startup retires old empty sections | `3ebb09b1b` | [Exact 33-case red/green and four actual App captures](origin-workspace-deletion.md). Occupied/unknown sections and shared cloud workspaces remain protected. |
| Account before Search; full-width computer row below; footer actions stay inside narrow sidebars | `748926f9d`, `abfa90e8f` | [Header](sidebar-header-fit.md), [footer](sidebar-footer-fit.md). Synthetic desktop bridges and all requested/rendered mode qualifications are retained. |
| Flat shared dialogs, menus, Settings, Apps, Triggers and Voice; readable trigger identity on phones | `b94899358`, `0757f7188`, `a8961c3c4` | [Dialogs](origin-flat-dialogs.md), [popups](origin-flat-popups.md), [trigger rows](origin-trigger-row.md). |
| Reduced-motion account focus, busy-confirmation containment and hidden Advanced tab stops | `dfe5202aa`, `a6788ab7d`, `baf8c0260` | Identical regressions fail before and pass after in the linked UI reports; two integrated actual Chromium keyboard cases pass. |
| Retire duplicate-prone legacy server-token issue creation while retaining existing links/manual creation | `4da184d55` | [Registered-handler evidence and conditional credential scenario](origin-backend-access.md#unpublished-legacy-issue-creation-follow-up). Modern host integration remains separate. |
| Verified Origin mail provider/domain/sender prepared | `9d16cb641` | [Sanitized provider setup](evidence/origin-mail-provider-031.json). An [account-only readiness check](evidence/origin-mail-readiness-031.json) confirms API authorization and an enabled transactional relay; backend configuration, email acceptance and inbox delivery remain unproven. |

## Integrated local checks

The [sanitized checkpoint](evidence/origin-candidate-031.json) identifies complete logs by SHA-256 and the actual source checkpoints. It excludes interrupted runs. No production data or main-checkout servers were used.

| Check | Result |
| --- | --- |
| Full `src` / `shared` Vitest | 564 files, 5,974 passes; 387.50 seconds |
| Touched server Vitest | 15 files, 778 passes, six existing skips; 139.03 seconds |
| Full backend Vitest | 23 files, 215 passes; 12.08 seconds |
| Guard/release/deployment checks | Nine files, 121 passes |
| Website unit tests and production build | Two files, fourteen passes; all six generated page routes, including join and release history |
| App/server/backend TypeScript | Pass |
| Integrated sidebar Chromium keyboard tests | Two passes: normal and reduced motion |
| Full Oxlint, locale catalog, contrast and whitespace | Pass; partial language translations remain partial |

Client/shared source and tests did not change after `3bea105d6`; the successful full run began at `01080e8b7`. The workspace/server fix was integrated during that run, but no tested client/shared file imports a server module. Backend source did not change after `01080e8b7`; server and site verification ran after `3ebb09b1b`, and the last docs-only checkpoint is `dd5b63ef9`. New hosted CI/native builds must cover the final frozen release source rather than inheriting this local checkpoint or the older 0.2.10 jobs.

The earlier `candidate-031-client-shared-3bea105d6.log` and `candidate-031-site-build-01080e8b7.log` were interrupted and provide no complete result. The unchanged team-computer symlink case encounters Windows `EPERM` before its product assertion in a separate broader worker run; it was neither skipped nor weakened. The integrated touched-server selection above passes independently and does not claim that broader suite is fully green locally.

## Remaining delivery gates

The first unpublished freeze, `d84eaf3c42308bbde7f2a5d08af7c96ffd7167f0`, was rejected. CI `39143614344`, attempt 1, stopped at four documentation-reference checks (79 checks passed): an incorrect team-module path, a relative test citation, external Convex protocol paths misread as Origin routes, and the missing candidate index link. These are corrected without weakening the checks. The private compiled website also revealed that its staged build omitted the shared Draft-column module. The real packaging helper and its regression are being corrected before selecting another source. Native run `39143609255` was cancelled; its outputs cannot authorize the replacement source. The original Git commit, archive tag `origin-candidate-v0.2.11-d84eaf3c4`, local evidence and private remote build context are preserved. No clients, website, backend, migrations or mail configuration were published from that freeze.

Actual old-0.2.10 request-contract compatibility passes seven cases through 34 real loopback requests to registered candidate handlers. [The report](origin-backend-compatibility.md) retains 209 source bindings, six unchanged tasks, three embedded issue links and three unchanged pull-request link rows. This is distinct from full old-App or packaged compatibility. The final frozen source must match those candidate module identities. Source freeze, fresh exact-source CI/native success, new Windows/macOS artifacts, private draft assets, compiled website/browser acceptance and fresh artifact/image identities remain required.

The reviewed sequence is backend first: fresh full backup, exact-source backend, all pages of five storage migrations and three Draft phases, then confirmed temporary-key revocation and credential-file absence. Only afterward may the approved mail configuration run, followed by new clients/feeds and finally the website. Original backend/mail timestamps remain immutable; later site acceptance requires fresh current public-client evidence. Unknown side-effect outcomes hold the release until independently reconciled.

No recipient test email is authorized by the setup proof. Successful backend configuration and account relay readiness would still not prove provider email acceptance or inbox delivery. Existing physical Mac, signing/notarization, hardware/TURN, external model-provider and broad remaining UI inventory limits stay open in the [audit](origin-audit.md#findings-outside-completed-acceptance).
