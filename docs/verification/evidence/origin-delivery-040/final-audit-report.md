# Origin 0.2.15 delivery

Origin 0.2.15 is published on [GitHub](https://github.com/z4mbo/Origin/releases/tag/origin-v0.2.15), the [website](https://origin.imbored.fun/) and the Windows/Mac download feeds. The release contains the provider Usage correction only. The newer fallback, budgets, sharing and navigation work is not part of this version.

Source: `cf9e6fdec944700aa1ee395d05512afbaf95da97`. [PR 1](https://github.com/z4mbo/Origin/pull/1) was merged into `origin-integration` at `2026-10-19T21:25:10Z`, producing `8dc1c710a1a98636a1dc159e59b6ce838fff45aa`; its branch was preserved. The [delivery receipt](delivery-receipt.json) and [evidence hashes](manifest.json) record exact source, workflows, artifacts and observations. Earlier audit findings remain in the [source audit](../../origin-audit.md) and [0.2.14 delivery report](../origin-delivery-038/final-audit-report.md).

## Proven fixes

All three corrections are in commit `2f98369ea8746d661ee1e5a56870000121989dd7`. File lines below refer to the frozen release source, rather than subsequent feature edits.

| Severity | File | Scenario → wrong result | Correction |
| --- | --- | --- | --- |
| P2 | `server/plan-usage.ts:135` | Working Claude API, managed or separately authenticated connection → Usage reads an unrelated personal subscription credential and asks for sign-in. | Filter connections by authentication scope before enumerating personal subscription quotas. API activity remains in History. |
| P2 | `server/plan-usage.ts:376`, `src/components/PlanUsage.tsx:241` | Saved quota token is missing, expired, unreadable, or a quota-only endpoint returns 401/403 → Usage claims model sign-in is broken even though the model can run. | Distinct usage-only errors and neutral UI explain that quota availability does not establish model authentication. Model authentication is unchanged. |
| P2 | `server/plan-usage.ts:887` | Grok credits returns 403 while billing reports a valid 40%-used allowance → both responses are discarded. | Preserve the valid billing allowance; display 60% remaining and leave unreported windows unknown. |

The [regression report](../../origin-plan-usage.md) records eight failing server cases before the fix and 26 passing cases afterward, plus two failing presentation cases before the fix and all three passing afterward. Recorded source acceptance includes 6,047 client/shared tests across 570 files, both TypeScript builds, touched-file lint, 293 focused checks with two platform skips, and 54 release guards after the version bump. Archival did not repeat those runs.

## UI evidence

| Screen | Before | After |
| --- | --- | --- |
| Missing quota access, desktop dark | [Before](../origin-plan-usage-040/before-dark.png) | [After](../origin-plan-usage-040/after-dark.png) |
| Missing quota access, light 375 px | [Before](../origin-plan-usage-040/before-missing-light-375.png) | [After](../origin-plan-usage-040/after-missing-light-375.png) |
| Grok billing fallback, desktop dark | [Before](../origin-plan-usage-040/before-grok-fallback-dark-1280.png) | [After](../origin-plan-usage-040/after-grok-fallback-dark-1280.png) |

These paired captures use actual quota/component paths with synthetic responses, not live provider credentials. The [fixture manifest](../origin-plan-usage-040/manifest.json) records the baseline module boundary and all six scenarios. Public browser captures separately show the current [What's new page](site/public-whats-new.png) with both 0.2.15 notes and the [landing page](site/public-landing.png) with current download aliases. Both observed desktop pages have a 1280 px viewport and 1270 px document scroll width. Off-screen landing image entries are retained as observed; full-page image completion is not asserted.

## Verified delivery

| Gate | Result |
| --- | --- |
| [CI 39318748860](https://github.com/z4mbo/Origin/actions/runs/39318748860), attempt 1 | Successful exact-source run; expected broker deployment job skipped. |
| [Native 39318738462](https://github.com/z4mbo/Origin/actions/runs/39318738462), attempt 2 | Windows x64 retry successful; successful Mac arm64/x64 output retained. |
| [Site PR 39318748839](https://github.com/z4mbo/Origin/actions/runs/39318748839), attempt 1 | Success. |
| [Site tag 39318738427](https://github.com/z4mbo/Origin/actions/runs/39318738427), attempt 1 | Success. |
| GitHub release `417743732` | Public, 15 assets, exact tag/source and canonical release notes. |
| Public downloads | All 13 canonical payloads, three stable download aliases and two metadata files verified; 1,947,902,547 canonical payload bytes. |
| Website | `/`, `/login`, `/signup`, `/whats-new` return 200; all 57 canonical note titles/bodies across eight release articles match. Login/signup checks establish the anonymous shell only. |
| Backend | Reused the verified 0.2.14 backend closure; compared backend inputs and confirmed the root package difference is version only. No new backend deployment was needed. |

The canonical manifest SHA-256 is `98bbf032d314c344c892cf69af3ce0ad61bd2bbd10c4aff75803c3ee863c57a7`; checksums file SHA-256 is `9a06a1566dd65e98ba9e255882b9348d1b2406a43fe6b6b1fa217be039a4947b`. The promoted website image is `sha256:91b6d2d7ade9b89ac21a95e76b4870c5ee246ad204f8f1acf21112278d0e51ef`.

The bounded native audit independently checks the downloaded archives, package identity, emitted Usage code, actual renderer entrypoint/assets and updater feeds. Its receipt SHA-256 is `caae1fb33f270461c78fcd3124451efdc8380d9d483706429a63fa21e0ba414e`. An isolated Windows extracted-resource smoke exits 0; six observed owned child processes and six listeners have ended. Mac acceptance here is static package inspection, not physical execution.

## Failures retained and resolved

- The first Windows native attempt failed during PowerShell CUA archive extraction. The [original log](native/attempt1-windows-failure.log) and terminal attempt metadata remain beside the successful retry evidence; the failed attempt is not relabeled successful.
- The initial native auditor incorrectly expected the renderer inside ASAR. Its [failure](native/initial-auditor-layout-failure.json), helper and input are preserved. The corrected helper inspects the documented `Resources/ui` layout with the same renderer structural checks.
- The first private staging command stalled and was stopped for reconciliation. A subsequent attempt hit the free-space guard. The [cleanup record](staging/backed-up-stage-cleanup.log) verifies local size/hash backups before removing exactly 22 old private staging duplicates from 0.2.3/0.2.5; public files were retained. A fresh private stage then transferred all 15 files and passed metadata checks before promotion. Initial preparation is not reported as successful.

## Remaining work and limits

Ranked provider/model fallback, computer-wide and per-agent API caps, new cross-machine bot sync repairs, shared model hosting, shared project order, Agents thread/delegation navigation, the minimal Claude desktop-style Usage panel and proposed top-bar/Tools navigation remain separate work. None is claimed shipped in 0.2.15.

No physical Mac installation, owner-profile Windows installer/updater journey, real provider quota/credential exercise, vendor invoice verification, production-data test mutation or authenticated production flow is claimed. Windows downloads are unsigned. Mac downloads are ad hoc signed and not notarized; Mac updates require a manual download. Whole-bundle byte-for-byte rebuild equality and Windows PE version-resource inspection remain unverified.

The existing [upstream evaluation](../../origin-upstream-review.md) remains the adoption record. This delivery archive did not perform a fresh upstream review or bulk merge. New functionality should retain focused commits, Origin's access/approval invariants, isolated regression tests and explicit acceptance boundaries before publication.
