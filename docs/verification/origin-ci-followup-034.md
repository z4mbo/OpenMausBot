# Origin 0.2.13 CI follow-up

The frozen candidate `f44ebe30a9568ed634b9eb8a45476f42e4c059b1` failed its release gate and remains unpublished. This report records the terminal failure, three bounded fixes integrated at `ec3c964cf97ebeb6a1bb1fa89f3704f16222d3bc`, and evidence that can retain its original scope. It does not authorize publication.

[Evidence manifest](evidence/origin-ci-followup-034/manifest.json) · [Terminal CI record](evidence/origin-ci-followup-034/origin-ci-034.json) · [Held-candidate archive](evidence/origin-ci-followup-034/held-archive.json) · [Feature acceptance boundaries](origin-feature-acceptance-034.md)

## Rejected checkpoint and preserved artifacts

[CI 39172155629, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39172155629/attempts/1) finished with **19 successful jobs, four failures and one skipped broker deployment**. Main sharded Vitest reported **56,650 passed, 22 failed and 610 skipped platform occurrences**. The 22 failures represent eight distinct assertions across platforms; these totals exclude separately reported broker and Node test stages. [Native 39172155475](https://github.com/z4mbo/Origin/actions/runs/39172155475) and [backend/site 39172155470](https://github.com/z4mbo/Origin/actions/runs/39172155470) succeeded on the same source. Those successes do not override failed CI or establish installed-app or production acceptance.

The archive record preserves draft release **416755795**, all 15 assets and its unchanged body under `origin-candidate-v0.2.13-f44ebe30`. Its remote annotated tag retains original object `5630555c914231eb026b304ef820441245b7369b`. The recorded local move preserved hashes for **198 files / 3,897,673,495 bytes** inside owned scratch; the private remote stage and website image were retained as held artifacts. Publication was not attempted and public version **0.2.11** remained unchanged. These are the archive operator's recorded results, not operations repeated while writing this report.

## Fixes and actual verification

| Integrated commit | Defect and bounded correction | Evidence |
| --- | --- | --- |
| `a9134c95b3513545e52cf3078b97a0916093a914` | Case-sensitive filesystems skipped an uppercase legacy `OpenMausBot` unavailable descriptor and selected an older ready `OpenGrokBot` descriptor. The shared candidate lookup in `server/local-computer.ts` restores Origin, uppercase/lowercase Maus, then uppercase/lowercase Grok order for connection and reason reads. Explicit userData and first-present descriptor authority remain enforced. | [Linux comparison](evidence/origin-ci-followup-034/descriptor/report.json) |
| `c2026a75ee18961a318619c206cc6b68a5f45e00` (worker `e298c4ec32576963724f17451c9f51278457d417`) | Four stale expectations in `server/control-omb.test.ts` and `scripts/testing/web-app-assets.test.ts` now assert intended Origin copy. Mutation refusal and PWA behavior assertions remain intact. | [Branding proof](evidence/origin-ci-followup-034/branding/branding-ci-034-proof.json) |
| `ec3c964cf97ebeb6a1bb1fa89f3704f16222d3bc` (worker `7d6c858eeedd38c4e7992745a2783f6ea1f61514`) | Refresh only the two per-profile catalog byte/hash manifests after deliberate description branding. Tool lists, exact digest assertions and size budgets remain enforced. | [Catalog proof](evidence/origin-ci-followup-034/wire/REPORT.md) |

The descriptor probe executed the actual before/after modules under **Node 24.21.0 on WSL Linux**, using mode-0700 fixtures and real case-sensitive files. With Darwin descriptor-path mode explicitly selected, frozen f44 incorrectly returned the stale driver; the fix returned null and the original unavailable reason. All **six comparisons** matched, including five Origin-priority, lowercase-fallback and explicit-userData controls. This proves filesystem lookup behavior, not native macOS driver or hardware acceptance. The official Linux archive SHA-256 is retained in the packet; the archive/runtime binary is excluded. A later cleanup invocation found its temporary root already absent; the cause is unestablished and no successful deletion is claimed.

The branding files reproduced **four failures / 18 passes**, then passed **22/22** on Node 24.21.0. The exact wire files reproduced **three failures / 63 passes**, then passed **66/66** normally. The retained intermediate golden-update run had one write-order failure and is not called green. Related consumers passed **217 cases with two existing platform skips**.

The [integrated root record](evidence/origin-ci-followup-034/root/report.json) reports **104 passes / five existing platform skips across six files in 23.04 seconds**; these overlap the focused totals and must not be added together. Server TypeScript and full lint returned exit 0 with empty stdout; Tee therefore created no log files. The recorded standard fake-engine fixture doctor succeeded at loopback port 20012, then its process, listener and temporary data were confirmed absent. No real provider, owner data or production test was used. Private-file validation, explicit-instance refusal, tool scope, exact schemas, ordered tools, digest checks and budgets were not weakened.

## Reuse and remaining delivery gates

The [final input comparison](evidence/origin-ci-followup-034/input-reuse-comparison-034-final.json), SHA-256 `8027b252210f006f9119f408d9a4132710db0bd80a82927c41ab1bb214403a3c`, binds ec3 to the original evidence without rerunning tests or browsers:

- **5,992 client/shared cases across 567 files** retain their original run sources and times. All **1,350 named inputs** have equivalent Git blobs; working bytes differ only by the stated UTF-8 CRLF normalization.
- The original **16 website visual cases** retain f44/image provenance and their **151 identical staged inputs**. Coverage remains nine full-page scopes and seven auth viewport scopes; signup loading was captured with backend/form connections deliberately blocked. Eight failed initial captures remain rejected and preserved.
- The only product delta from f44 is `server/local-computer.ts`; five other changed files are tests or test manifests. The exact-case legacy directory is external compatibility data and must survive product branding.

The packet preserves **52 copied files / 723,069 bytes**, verified against the sealed source before and after copying. The manifest lists SHA-256, lengths and raw Git blobs; scoped attributes preserve evidence bytes. Historical source labels and receipt times are unchanged.

Eleven archived source/helper snapshots have a `.txt` suffix so repository
lint treats them as evidence data. Their payload bytes and hashes are unchanged.
The manifest maps each current path to `archivedOriginalPath`; nested historical
reports retain their original filenames. Reproduction restores those names in
a disposable directory. The pre-push hook rejected the initial unlabelled
snapshots before any remote ref changed; no lint rule was disabled.

A new freeze must include the fixes and this evidence, followed by **fresh exact-source CI and native packages, a website image with its own source/image receipts, and actual public release/download/feed/site verification**. Reused input evidence does not relabel the old image, qualify a replacement build or complete account, mail, hardware, multi-machine or all-feature acceptance. No new tests, builds, push or production operation was performed for this documentation commit.
