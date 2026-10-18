# Origin 0.2.12 candidate, cycle 033

This document preserves the pre-freeze checkpoint. The subsequent exact-source
dispatch and the user's decision to batch additional fixes before publication
are recorded in the [034 integration record](origin-candidate-034.md). Its four
notes are retained here historically; the current shared notes roll them into
the unpublished 0.2.13 release.

This replacement cycle is unpublished. The current public release remains the verified [0.2.11 delivery](origin-delivery.md#0211-delivery). Integration checkpoint `f2ad2a15cb4d61cb49b678a74b53c7b9b063e253` includes the corrections and evidence below; it is not a final frozen release source. Final tag/source identity, exact-source CI/native runs, GitHub draft, manifest/checksum hashes, site image/identity and public delivery are all pending. No new publication receipt exists or is linked here.

## Changes and proof

| Change | Integrated source | Verification and boundary |
| --- | --- | --- |
| Signup policy loading and bounded Retry | `5bb26c188`, `23e0842ca` | [Actual component/CSS captures and regressions](origin-signup-policy.md); 25 site tests at the earlier checkpoint. Sign-in/verified invitations remain available. This is a UI recovery correction, not a proven authentication bypass. |
| Case-variant Windows workspace credentials | `780bab3e6` | [Harmless actual installer child](origin-installer-security-next.md); three red regressions. Only synthetic keys and an isolated home were used, with no vendor installer or real credential exposure. |
| Stripe native-log masking, adapted from upstream #3037 | `5b1ffceb4` | [Real isolated native writer path](origin-stripe-redaction.md); identical selection changes from five failures/22 passes to 27 passes. Conditional on credential-bearing provider output; no historical real-key exposure or log cleanup is claimed. |
| Accurate workspace project lists, adapted from upstream #3036 | `0d7cc7f9a` | [Actual Sidebar/Store and SSE proof](origin-team-access-cache.md); six failures plus three current-grant controls become nine passes. Four browser captures form two light/dark comparisons at 1440 × 1000. Supplied post-sync membership and owner API handover are explicit; no full App/OriginSync or authorization bypass acceptance. |
| Current complete-App landing image | `cdeefd5a2` | [Source-bound capture and derivatives](origin-landing-capture.md); one desktop case and three whole-frame WebP sizes. This original actual-App capture retains renderer source `3dcdc677972264d49e1f94306a777236cc3c3784` and its three-note checkpoint. It does not accept the later cache correction or a new 033 website build. |

The [register](origin-audit.md#bug-register) retains its original 72 rows and adds one P2 renderer-cache finding, for 73. Existing server records and peer permissions correctly revoke the additional-team grant. The renderer fix explicitly replaces the optional `managedSections` field in three complete-frame update paths; it does not expand authorization or alter sender-runs authority. Hidden Additional teams settings were not established as a shipped route. The corrected proof retains the earlier hidden-panel and unsuccessful full-App fixture attempts.

The [team-access manifest](evidence/origin-team-access-cache-033/manifest.json) binds sixteen payloads with SHA-256 `6acae646bcb3941fb29c3970fb92932434aef593284170749703d290fb3cb984`. The [upstream review](origin-upstream-review.md) preserves the twenty-PR record, immutable twenty-six-PR zero-adoption initial checkpoint and separate later #3037/#3036 decisions.

## Separate verification finding

The [held 032 freeze](origin-candidate-032.md) failed CI `39152274046` attempt one at d09 despite successful native/private checks. [Comms transport evidence](origin-comms-transport-032.md) preserves the individual HTTP connection failure and unknown original cause. Integration `0e6806ba0` uses one-shot HTTP connections only in fixture startup/API/diagnostics. An actual loopback reset-on-reuse regression changes from one failure/two controls to all three passing; the full comms file plus transport tests pass 35 at the worker checkpoint. A reset after a mutation still rejects without replaying that mutation. Production behavior, task assertions, deadlines, error propagation and retry lists are unchanged. This test-harness finding is not another product-security register row and does not turn the failed old CI green.

## Local checkpoint and pending final verification

The actual root stable client/shared run passes **5,983 tests across 564 files** at integration source f2ad2a15cb4d61cb49b678a74b53c7b9b063e253, with exit 0. It ran from 2026-10-18T18:58:40.453Z to 2026-10-18T19:04:42.778Z; the Vitest footer records 361.58 seconds. Start/end source and 1,344 input bindings match. These are boundary checks, with continuousMonitoring false, not continuous filesystem monitoring. The [sanitized root checkpoint](evidence/origin-candidate-033.json) binds the privately retained raw log (6,563 bytes, SHA-256 62ce8e1aad95a80b1855d9e3b176e4f4d2f214a561bb3d60d4986209e874268d) and source envelope (128,282 bytes, SHA-256 dffd87e1d2ba32a8c7f0971783c3a5e074f27d432d176200cf25af32e09c283d). The successful-run raw log also retains refused-connection diagnostics for loopback port 3000; no silent-log or diagnostic-cause claim is made.

Root separately reported its actual 317 focused passes and application/server TypeScript success. The checkpoint JSON labels those reported results separately from the independently hashed full-run inputs. The cache worker's 5,983-pass run remains a distinct isolated checkpoint. This root integration result does not establish final frozen-source CI/native or public acceptance. Existing 032 local checkpoint JSON remains historical.

The integration includes proof commits `b41d7e720` and `f2ad2a15c`; the route-documentation inventory correction admits the actual workspace factory module without weakening route assertions. The final source must rerun the required type, client/shared, touched-server, lint/locale, release/documentation guard and website checks. Fresh complete CI and native success are required for that source; no old passing native job, private image, fifteen-asset draft or operator synthetic check substitutes for them.

## Canonical current release notes

- **Reliable signup loading** — Signup checks whether registration is available before showing its fields. A connection that does not respond offers Try again after ten seconds. Sign-in and verified invitations stay available.
- **Safer Windows child processes** — Workspace credentials stay out of installer and agent child processes even when environment names use different capitalization on Windows.
- **Private provider logs** — Stripe secret and restricted keys are hidden when agent protocol output is saved to logs, using a protection adapted from OpenMausBot.
- **Accurate project lists** — Workspace project lists refresh when a Chief's project links change, clearing stale entries from the sidebar.

The shared [release history](../../shared/origin-releases.ts) now has four current notes, 44 note titles across six articles. The fourth note is integrated in `3a5436279`. Fresh packaged bundles, update feeds, in-app rendering and the compiled/public website need their own source-bound comparisons before acceptance. Historical 032 screenshots and receipts keep their original three-note scope.

## Delivery boundary

No 033 release source, new tag object, CI/native run, draft ID, manifest/checksum hash, site image/identity or public receipt is asserted here. Keep the failed 032 source, original annotated tag object and unpublished draft/artifacts/staging/private proofs as a distinct preserved checkpoint. Any exclusive archival and refreeze operations require root's fresh numeric-ID, unpublished, source, ref-lease, inventory and owned-path checks. New cycle authority and fifteen assets must come from actual new-source builds. Keep PR1 open against origin-integration; no merge is authorized by these records.

The backend schema/functions are unchanged. Reusing deployed 0.2.11 requires fresh proof that the complete final backend deployment closure matches source 697 byte-for-byte. Preserve 030/031 publication receipts and original mail/provider/key-removal times; no redeployment, repeated migrations, renewed provider readiness, temporary key recreation or recipient email is implied. The ongoing inspection and 06:00 Europe/Rome upstream review continue.

Physical Mac installation, signing/notarization, hardware, real provider, cross-machine/TURN, recipient delivery and broader UI inventory limits remain open in the [delivery record](origin-delivery.md). The cache browser fixture did not qualify full App/OriginSync, authenticated cloud adoption, mobile layout, packaged Electron or live agent tools. Existing Windows packages are unsigned and Mac packages are ad hoc/unnotarized with manual updates; new packaging status still requires verification.
