# Origin 0.2.11 source and delivery acceptance

Origin 0.2.11 is published from frozen source `697e9f0adacd7d90af9b3f190ab5c4df978b48f1`. Its website, Windows/Mac downloads, feeds and eight current release notes are verified in the [delivery record](origin-delivery.md#0211-delivery) and [permanent receipt](evidence/origin-delivery-031/delivery-receipt.json). The local checkpoint and rejected earlier freeze below retain their original identities; final-source delivery has its own CI, native builds, compiled website and public acceptance evidence.

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
| Verified Origin mail provider/domain/sender and central backend configuration | `9d16cb641` | [Sanitized provider setup](evidence/origin-mail-provider-031.json), [account-only readiness](evidence/origin-mail-readiness-031.json) and [actual configuration/delivery receipt](evidence/origin-delivery-031/delivery-receipt.json). No recipient email was sent; provider acceptance and inbox delivery remain unverified. |

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

Client/shared source and tests did not change after `3bea105d6`; the successful full run began at `01080e8b7`. The workspace/server fix was integrated during that run, but no tested client/shared file imports a server module. Backend source did not change after `01080e8b7`; server and site verification ran after `3ebb09b1b`, and the last docs-only checkpoint is `dd5b63ef9`. The final-source checks below independently cover the frozen release; they do not inherit this local checkpoint or the older 0.2.10 jobs.

The earlier `candidate-031-client-shared-3bea105d6.log` and `candidate-031-site-build-01080e8b7.log` were interrupted and provide no complete result. The unchanged team-computer symlink case encounters Windows `EPERM` before its product assertion in a separate broader worker run; it was neither skipped nor weakened. The integrated touched-server selection above passes independently and does not claim that broader suite is fully green locally.

## Final-source delivery and retained history

The first unpublished freeze, `d84eaf3c42308bbde7f2a5d08af7c96ffd7167f0`, was rejected. CI `39143614344`, attempt 1, stopped at four documentation-reference checks (79 checks passed): an incorrect team-module path, a relative test citation, external Convex protocol paths misread as Origin routes, and the missing candidate index link. These are corrected in `934c1518b` without weakening the checks. The private compiled website also revealed that its staged build omitted the shared Draft-column module. Commit `e19a46fbf` includes that dependency in the real packaging helper; the identical staging regression changes from one failure/eighteen passes to nineteen passes. The corrected deployment and documentation selection passes 102 tests. [Build-context evidence](evidence/origin-build-context-031/report.json) retains the results. Native run `39143609255` was cancelled; its outputs cannot authorize the replacement source. The original Git commit, archive tag `origin-candidate-v0.2.11-d84eaf3c4`, local evidence and private remote build context are preserved. No clients, website, backend, migrations or mail configuration were published from that freeze.

Actual old-0.2.10 request-contract compatibility passes seven cases through 34 real loopback requests to registered candidate handlers. [The report](origin-backend-compatibility.md) retains 209 source bindings, six unchanged tasks, three embedded issue links and three unchanged pull-request link rows. This is distinct from full old-App or packaged compatibility. The final frozen-source compatibility gate matched those candidate module identities before the backend-first rollout. Exact-source CI/native, new Windows/macOS artifacts, GitHub assets, compiled website/browser acceptance and public delivery have their own completed receipts.

Origin **0.2.11** is published from frozen source `697e9f0adacd7d90af9b3f190ab5c4df978b48f1` (`origin-v0.2.11`). [CI 39144432592, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39144432592/attempts/1) and [native 39144426479](https://github.com/z4mbo/Origin/actions/runs/39144426479) succeeded on that source. CI completed all twenty expected jobs: nineteen succeeded and the broker deployment was intentionally skipped. The public GitHub release, all thirteen payloads, two metadata files, three aliases and matching website are verified in the [delivery receipt](evidence/origin-delivery-031/delivery-receipt.json) and [evidence report](evidence/origin-delivery-031/report.json).

The four primary user downloads are Windows setup, Windows portable ZIP and the Mac Apple silicon/Intel DMGs. Native packaging produced two uploaded Actions artifact containers, `origin-windows` and `origin-mac`; the notarization step was skipped.

The backend-first rollout completed a fresh storage-inclusive backup, the exact-source backend, all pages of five storage migrations and all three separate Draft repair phases. The temporary deployment key was revoked at `2026-10-18T17:00:12.172Z`; its local file was confirmed absent at `2026-10-18T17:00:21.448Z`, before mail configuration or client publication. Only aggregate migration results are retained publicly. Original backend/mail receipt times remain unchanged, and later website acceptance is bound to fresh public-client checks.

Backend email configuration was confirmed at `2026-10-18T17:05:26.745Z` for the approved Brevo provider and `Origin <invites@origin.imbored.fun>` sender. The same configured key passed account API authorization and transactional relay readiness at `2026-10-18T17:05:24.487Z`. No recipient email was sent; provider acceptance, mailbox confirmation and inbox delivery remain unverified. Manual invitation sharing remains available if an email attempt fails.

The actual downloaded Windows ZIP from native run `39144426479` has SHA-256 `184f07fc8b3c1f6df8ca738578bb0fd46e56977a530bbdbe4f3a3a958dc14228` (370,049,288 bytes). Its packaged server/browser resources passed the frozen documented smoke with Node 24.21.0, an empty synthetic home and no repository `node_modules` in reach: server startup, thirteen MCP proxies, stdio framing, doctor/bots, the encrypted backup worker, two desktop-server starts with compile-cache reuse, enterprise resources and bundled-browser discovery. The owned server stopped and its port closed. A metadata-only ASAR inspection matched all 160 plain Electron source files against the frozen Git blobs. [Resource-smoke evidence](evidence/origin-packaged-windows-031.json) and [CI verification](evidence/origin-ci-031.json) remain separate from the delivery-gallery inventory. This does not establish launching Origin.exe, installer behavior, Electron renderer/tray, update/restart, native input, a real provider/account or physical Mac acceptance.

The exact-source private compiled website passed sixteen browser cases. Separate public browser verification after promotion passed all four routes, with three platform download links, all forty canonical note titles across five release articles, eight current notes and zero account submissions. The public `/signup` route settles to its configured invite-only notice; no signup-policy change or authenticated-account acceptance is claimed. The sixteen private screenshots and one public landing image retain separate provenance in the delivery gallery.

No recipient test email was sent. Backend configuration and account relay readiness do not prove provider email acceptance or inbox delivery. Windows packages are unsigned. Mac packages are ad hoc signed and unnotarized; Mac updates remain manual. Physical microphone/camera/phone, cross-machine WebRTC/TURN, real external model-provider, signed updater, interactive macOS installation and broader UI inventory acceptance remain open. The daily upstream review and inspection goal continue at 06:00 Europe/Rome. See the [audit's remaining acceptance limits](origin-audit.md#findings-outside-completed-acceptance).
