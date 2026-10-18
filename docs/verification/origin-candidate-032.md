# Origin 0.2.12 candidate

This cycle is unpublished. The current public release remains the verified [0.2.11 delivery](origin-delivery.md#0211-delivery). Version 0.2.12 has three shared release notes; CI, native builds, artifact publication and website promotion require fresh evidence from its final frozen source.

## Changes and proof

| Change | Integrated source | Verification |
| --- | --- | --- |
| Public signup waits for policy and offers bounded Retry | `5bb26c188`, `23e0842ca` | [Actual component and CSS captures](origin-signup-policy.md), synthetic policy/session, 25 site tests. The unresolved intermediate candidate and its recovery remain explicitly qualified. |
| Windows workspace credential aliases are removed from child environments | `780bab3e6` | [Safe actual installer child](origin-installer-security-next.md), three red regressions, 302 worker passes/nine existing skips. Root's five-file selection independently passes 301/nine skips. No vendor installer or real credential was used. |
| Stripe secret/restricted keys are masked in native logs | `5b1ffceb4` | [Upstream adaptation and real native-log path](origin-stripe-redaction.md), five red regressions, 27 focused passes and 194 worker consumer/guard passes/nine existing skips. Root's redaction/transport selection independently passes 70. |

The earlier 69 audit rows remain unchanged; these three findings bring the [register](origin-audit.md#bug-register) to 72. The initial new upstream checkpoint evaluates 26 merged PRs and records zero adoptions at that time. A separate later decision adopts #3037, preserving the initial evidence and overlapping-rollup deduplication. The original twenty-PR review remains historical.

The integrated policy, timeout and upstream manifests were rehashed from Git objects: 24, 32 and five payloads respectively. Their stored working bytes match committed bytes. Original 0.2.11 and 0.2.10 publication receipts remain immutable.

## Delivery boundary

No backend schema or function change is planned for this cycle. The final source must prove its complete backend deployment closure byte-identical to the deployed 0.2.11 source before carrying that backend forward. That equivalence does not renew old provider-readiness timestamps. Existing Brevo configuration remains in the backend; no temporary key copy is recreated and no real recipient email is sent.

Before publication, require final-source application/server types, client/shared tests, touched server regressions, guards, lint/locales, website build and isolated actual website rendering, exact-source CI/native success, all native payload/feed hashes and a verified GitHub draft. Promote only the matching website and desktop distribution through the documented guarded helpers. Record actual public versions, hashes, browser results and unchanged-backend evidence afterward. Keep the review PR open and unmerged.

Physical Mac installation, signing/notarization, hardware, external model providers, cross-machine/TURN, recipient inbox delivery and the broader UI inventory remain open as documented in the [delivery record](origin-delivery.md).
