# Origin candidate 051 — 0.7.3

2026-10-21. **Not yet published.** This is the same integrated app behavior as the [0.7.2 candidate](origin-candidate-050.md), with two verification corrections and a forward version. The immutable `origin-v0.7.2` tag remains at `375da4cf23cf803da0b045ffec42f7f651082ab5`; its prepared artifacts and delivery operators remain held. Published Origin was last observed at 0.7.1. PR3 remains open and is not merged by publication.

## Why another source was necessary

The 0.7.2 cloud PR run [39546164763/a1](https://github.com/z4mbo/Origin/actions/runs/39546164763) failed one of 333 backend tests: a revoked upload returned400 and kept the original blob, but the final storage count was2 rather than1. The same-source push and tag cloud runs passed. Local focused execution reproduced the failure.

Tracing the real handler proved it awaited deletion of the rejected new blob. The race was in convex-test0.0.60: scheduled GitHub access review overlaps its global emulated transaction manager and can roll back the HTTP action's storage cleanup. The corrected fixture controls timers and finishes that scheduled review while the upload body is deliberately blocked, then releases the body. Its HTTP400, original-preserved and rejected-blob-removed assertions are unchanged. A diagnostic no-op deletion still fails with2 versus1. No upload runtime or schema change was made. Commit `0e925be3a776402264b3f7fc9939593766b97249`; storage admission15 tests and reference1 test, plus backend typecheck, passed.

No Docs run existed for the 4,231-file PR. Its first300 changed files matched none of the Docs path filters. [GitHub documents that limit and excludes tag pushes from path filtering](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons). Docs now builds the exact checkout on every `origin-v*` tag and supports manual dispatch. It retains read-only repository permissions. The new guard failed before the correction; CI workflow/scope suites then passed77 tests. Commit `cd2cc65e66d3ca7d73587ab2ee1523996b4a73ba`.

## App, browser and upstream boundaries

The [byte-hash manifest](evidence/origin-candidate-051/manifest.json) retains the original failure, syscall trace, positive and negative controls, focused corrected tests and workflow-trigger guard results. Historical logs retain their actual version and source boundaries.

The [050 report](origin-candidate-050.md) retains each concrete bug, fix commit, selected browser scenarios, before/after images and all45 upstream decisions. The only later non-documentation edits are the test fixture, Docs workflow/guard and package/canonical version. Those browser observations still describe identical UI implementation; they are not relabelled as a new packaged or physical installation check. Upstream#3177 remains adopted,44 changes deferred/not applicable, and the five earlier adaptations retained. Do not repeat unchanged upstream reviews.

The same10 canonical changelog entries now describe0.7.3 in the app and website. Unpublished0.7.2 is not added to public release history. Its generated notes and evidence remain available as historical candidate records.

## Delivery gates

Final frozen-source CI, Docs, backend/site and native runs, actual Windows/Mac package audit, private compiled-site browser acceptance, backed-up backend deployment, website/download/feed/GitHub publication and public hash checks remain pending. Only fresh051 operators may be admitted with actual evidence; no050 or earlier held operator may execute. Production data is not used for tests. Preserve existing mail activation, retained local backups, rollback and public artifacts, and protected development processes.

Static Mac checks, copied Windows server/browser smoke and synthetic browser tests are distinct from physical installation/updater journeys, signing/notarization, real provider quotas/invoices and recipient email deliverability. These remaining acceptance boundaries must be stated in the final delivery report.
