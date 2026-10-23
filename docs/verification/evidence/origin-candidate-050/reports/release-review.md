# Origin release reconciliation — 2026-10-21

Read-only observation at **04:07:16 UTC**, before the audit branch's current integration work. No workflow dispatch, rerun, build, package download, release edit, deployment or production mutation was performed.

## Current published baseline

- Main checkout `C:\Users\aless\Documents\Origin` was clean on branch **origin-integration**, source **fa83fb6b9e7e6e7e8195e93405a975007917872a**, package **0.7.1**. This is the checkout's name, not GitHub's `main` branch.
- GitHub `origin-integration` points to that SHA. GitHub `main` remains **253181b72ce9f18f0679ac71d08814893137099f**.
- Latest release: [Origin 0.7.1](https://github.com/z4mbo/Origin/releases/tag/origin-v0.7.1), ID **418992672**, published **2026-10-20 23:51:15 UTC**, not draft/prerelease, target text `main`; its tag/build source is the exact `fa83fb6b9…` commit.
- Fourteen release assets now exist: Windows installer/portable ZIP and installer blockmap; both Mac architectures' DMG/ZIP/blockmaps; two feeds; `SHA256SUMS-0.7.1.txt`. Asset metadata was inspected, not executable payload contents or installations.
- Both public update feeds returned HTTP 200 and version **0.7.1**. Their raw SHA-256 values exactly match the corresponding GitHub asset digests:

| Feed | Bytes | SHA-256 |
| --- | ---: | --- |
| `latest.yml` | 1,406 | `a32ff212a1994d88b1cba7faca9e23ee6d9423559cceb4c5860ed0370435f84c` |
| `latest-mac.yml` | 1,859 | `a5a192aae16846d06c09e49e28ff41a0d3de50948528a7359697088b0cdff7c7` |

No current website container/source or authenticated backend deployment state is inferred from feeds or workflow success. The root/host reconciliation owns that evidence.

## Workflow proof and missing proof

| Workflow | Run / attempt | Exact source | Result |
| --- | --- | --- | --- |
| [Origin desktop](https://github.com/z4mbo/Origin/actions/runs/39517270486) | **39517270486 / 1** | `fa83fb6b9…`, tag `origin-v0.7.1` | SUCCESS, all three jobs completed |
| [Origin backend and site](https://github.com/z4mbo/Origin/actions/runs/39517270472) | **39517270472 / 1** | `fa83fb6b9…`, tag `origin-v0.7.1` | SUCCESS |
| CI | exact-source API query found **zero** | `fa83fb6b9…` | **No full-CI acceptance for this source was found** |

Native jobs: version/changelog **118952337385**, Mac arm64+x64 **118952604352**, Windows x64 **118952604452**. Backend/site job **118952338847** passed its configured backend typecheck/tests, site tests and build. Native steps report successful package/update-feed/release-note gates; Windows empty-home bundled-browser and packaged-server browser-discovery gates passed, and both Mac packaged-server startup gates passed on the macOS runner. These are workflow-reported checks, not this review's independent package execution.

Mac's conditional certificate step completed successfully, but **notarize/staple was SKIPPED**. The workflow documents the ad-hoc fallback and limitations; neither Developer ID signing nor notarization is established by the conditional step's success. No physical Mac GUI or updater journey was checked here.

Native run completed at **23:58:24 UTC**, after release publication at **23:51:15 UTC**. Mac assets were added around **00:01–00:02 UTC**. The release is complete now, but publication began before the final native workflow finished. Future promotion should wait for all target checks and assets before making a release public.

The most recent CI run is [39499802382](https://github.com/z4mbo/Origin/actions/runs/39499802382), SUCCESS on the earlier `origin-remove-sales` PR head **c70dd49647071d040e0866e72269682f7f3647f6**. Other recent feature PR CI runs were cancelled. The 0.7.1 commit changes **108 files** beyond its parent, including runtime/UI logic, so the earlier PR result cannot be relabeled exact-source or version-only proof.

This gap follows the current workflow triggers: `.github/workflows/ci.yml:3–10` has `push.branches: [main]`, `pull_request`, `merge_group` and `workflow_dispatch`; integration-branch direct pushes and release tags do not start CI automatically. The backend/site workflow is separate and cannot substitute for the full suite. The 0.7.0 backend/site run **39505599900** and integration push **39505033638** failed historically; the exact 0.7.1 cloud run supersedes those for its own source only.

Available native artifact metadata (not downloaded):

| Artifact | ID | Bytes | GitHub digest |
| --- | ---: | ---: | --- |
| `origin-mac` | 12309820688 | 1,246,688,122 | `c144533471fa9052e5b85f1cdb64bf6f9cca213d84fda90f8896478b168c17a0` |
| `origin-windows` | 12309480659 | 610,201,989 | `cce2fe9c5d9e05eef9cadf177ab0edfb9664c0d75d26f4bca6f51d962b4f52de` |

## Changelog, docs and operator path

`shared/origin-releases.ts:5–16` and `package.json` identify 0.7.1, with four entries: Publish naming; unified Studio tabs/posters; consistent chat cards; core fixes. The current GitHub release body describes the same entries. `scripts/origin-release-notes.mjs` validates package/current-note identity and generates canonical notes for client/API/feeds; electron-builder's `beforePack` hook and native workflow gates retain that contract.

`README.md:88–90` still describes 0.2.15 as pending and 0.2.14 as the published baseline, despite the live 0.7.1 release. Historical release reports are useful evidence, but the current summary needs one reconciled update after delivery. No dedicated tracked 0.7.1 immutable delivery receipt was found by bounded version/SHA/run searches in verification docs. Main checkout scratch contained UI verification directories and generated release notes, not a current release receipt under the inspected release naming patterns. This absence is not proof that another operator has no external receipt.

`scripts/deploy-origin.mjs` defaults to printing a plan and exposes explicit backend/site/download steps. Its site build is from Git HEAD, whereas backend credentials and deployed target identity need separate exact authority/backup checks. Do not run held 049 operators against this newer baseline. `scripts/release-ci.mjs` offers broader tree/version-parent reuse and may dispatch a dedicated release lane; this integration should use the stronger exact source strategy below rather than inheriting those exceptions silently.

## Integrate the audit once, then freeze one new source

The audit branch was **bdea56e9ed6bc0882fa8173465bcb735d4fe3f66**. Merge base with 0.7.1 is **f76cbe9b8019b648bb08f9125daefe35e6625185**; the histories have **43 audit-only / 27 release-only commits**. Retain the new Studio/Publish/project-navigation behavior and audit fixes together; do not roll production back to the held 0.4.2 binary or replay old release admissions.

1. Resolve the existing integration in the isolated worktree, review conflicts by behavior, and update the next version/canonical notes/docs once after source fixes are complete. A next version must exceed the newly rechecked live release; 0.7.2 is a candidate, not an already admitted version.
2. Commit all runtime, metadata and evidence; pin one clean source SHA. Build, CI, native packages, website and necessary backend changes must refer to that source. Do not change tracked evidence after native tagging and use a tree-equivalence exception to hide source drift.
3. **CI supports manual dispatch with no workflow inputs.** Once the frozen branch is pushed, root can run `gh workflow run ci.yml --repo z4mbo/Origin --ref <frozen-branch>` exactly once. Verify the resulting run's `head_sha`, workflow path, event, attempt and jobs. `scripts/ci-scope.mjs:84–86` defaults manual dispatch to runtime=true/all platforms, so the matrix includes Mac, Linux and Windows (four shards each), plus required gates/smokes. This review did not dispatch it.
4. After all source checks pass, build fresh native packages for the new tag/SHA; validate actual artifact IDs/digests and compiled resources, feeds and canonical notes. Previous 0.4.2 or 0.7.1 package proof does not cover merged code.
5. Root, now the user-authorized sole deployer, should recheck current public version/image/feed identity, capacity and backup; stage privately; then promote all target payloads/feeds/website and necessary backend changes using the documented process. Verify actual public bytes/URLs and retain signing/provider/physical-device limitations honestly. No new permission question is needed for already authorized production work.

## Retained read-only evidence

All below are in this report's ignored directory, `.omb-scratch/reconciliation-050/`:

- `release-observation.json`: read-only request outcomes, observed timestamp and public feed hashes.
- `release-latest.json`: complete latest release/asset metadata.
- `source-runs.json`: all exact-0.7.1 workflow runs (two).
- `native-jobs.json`, `native-artifacts.json`, `cloud-jobs.json`: actual job/step/artifact metadata.
- `recent-ci.json`: bounded recent CI history.
- `public-latest.yml`, `public-latest-mac.yml`: the two bounded public response bodies.

No secret values, user data, native executable downloads or installed-app acceptance are included.
