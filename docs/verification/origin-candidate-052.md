# Origin candidate 052 — proposed 0.7.4

2026-10-21. **Not published; final source and release gates pending.** Published Origin was last observed at 0.7.1. The 0.7.2 and 0.7.3 tags, artifacts and delivery operators remain held. PR3 stays open and requires the person's approval to merge. This report supplements [050](origin-candidate-050.md) and [051](origin-candidate-051.md) without rewriting their historical evidence.

## Why this candidate is necessary

Both the 0.7.2 and 0.7.3 Linux renderer jobs failed the first direct-thread thinking-timer case at its initial busy/start-time gate. In 0.7.3 CI [39547106200/a1](https://github.com/z4mbo/Origin/actions/runs/39547106200), job119048414713 did not observe the original task with `busy=true` and a numeric `turnStartedAt` within60seconds. The group timer case and14 other renderer cases passed. The final probe returned only `null`; it cannot identify an unsent message, rejected request, wrong task or later dispatch failure. This is repeated failing evidence, not an established runner flake or a confirmed product regression.

The UI launcher explicitly started a browser daemon on every platform, bypassing the Windows-only guard used by the runtime wrapper. Two local harness commits address this concrete scope error and missing failure evidence:

| Change | Commit | Proven boundary |
| --- | --- | --- |
| Limit explicit owned-daemon startup to Windows; preserve the normal Linux/macOS CLI startup path | `00dccbc15` | Focused platform tests fail before the guard and pass afterward. Its causal relationship to the Linux timer failure remains unproven. |
| Retain unique, bounded synthetic timer diagnostics in CI | `e12c6c132` | Failure-only fixture state, readonly renderer state and a capped server-log tail are retained under the upload glob. Timer assertions, timeouts and pre-send sequence are unchanged. |

The [scope-fix receipt](evidence/origin-candidate-052/harness/ui-session-daemon-fix-receipt.json) records2 failing platform assertions before the correction,32 passing cases across3 focused files afterward, and a clean focused lint result. Its original `committedByThisLane=false` describes the recording agent, not the later root commits; [commit records](evidence/origin-candidate-052/harness/commits.txt) preserve that distinction. An unsuccessful negative-control setup executed no tests and is explicitly excluded from red proof.

No app/server product behavior, provider billing logic or production data was changed by these two commits. Fresh Linux execution is required before any claim that the renderer failure is resolved.

## Actual diagnosis and local acceptance

One instrumented synthetic Windows hang-mode fixture observed the retained original renderer thread while a second thread was selected on the server. Enter sent an actual POST carrying the original thread identity, returned202, and that original task acquired `busy=true` plus a numeric start time. The second task stayed idle. The probes add delay, so this establishes the observed settled route, not a timing-equivalent reproduction of Linux CI.

The unchanged first test then passed once on Windows with its original sequence:1 passed,1 skipped,36.21seconds. Timer, away/back, stamp, no-console-error and owned-cleanup assertions passed. The [actual screenshot](evidence/origin-candidate-052/windows/thinking-timer-anchored.png), [test output](evidence/origin-candidate-052/windows/thinking-timer-exact.log), [diagnosis](evidence/origin-candidate-052/windows/result.json) and [cleanup observation](evidence/origin-candidate-052/windows/thinking-timer-closure.json) are retained. Windows used agent-browser0.36.0-omb.1 and Chrome153.0.8010.47; this pass predates the harness patch and neither explains nor clears the Linux failure.

## Historical 0.7.3 workflow outcomes

All runs below describe source `bd111a97d1f161a51e32ad050b4363874d1cd517`, not the future 0.7.4 freeze. The [evidence manifest](evidence/origin-candidate-052/manifest.json) binds the raw saved observations and their observation times.

| Workflow | Saved result | Acceptance boundary |
| --- | --- | --- |
| CI39547106200/a1 | Completed FAILURE:20 jobs,18 successful,1 renderer failure and1 expected PR deploy skip. All8 Linux/Windows shards passed. | The named aggregate `CI` job passed but deliberately excludes the advisory renderer job. Overall workflow remains failed; the timer's Linux cause remains unresolved. [Raw run](evidence/origin-candidate-052/workflows/ci-final-run.json), [all jobs](evidence/origin-candidate-052/workflows/ci-final-jobs.json). |
| Cloud39547106185/a1 | PASS: backend42files/333tests, site2files/31tests, backend/site typechecks and Next build. | Build/test workflow only; it did not deploy the backend or website. |
| Docs39547204136/a1 | PASS. | Documentation build, typecheck and lint; not production delivery. |
| Native39547204164/a1 | PASS: version/changelog, Windows x64 and macOS arm64/x64 build jobs; two artifact descriptors saved. | Successful build output is not the three-target package audit, physical installation, updater or publication acceptance. Those 0.7.3 artifacts remain held. |

The 050 report retains selected Agents, Usage, Publish and Canvas before/after browser evidence and the concrete audit fixes. Those observations are not relabelled as fresh packaged0.7.4 checks. Its6,457-test local result predates the final050 UI corrections; later focused results and GitHub workflows keep their original source boundaries.

Root then prepared the0.7.4 metadata and generated its [release notes](origin-0.7.4-release-notes.md). The bounded metadata run passed16 release checks and1 size check; the docs file initially failed only its missing new-notes index link, with its other6 cases passing. After adding that link, the docs file alone passed all7 cases. Both the [initial output](evidence/origin-candidate-052/metadata/final-074-metadata-tests.log) and [focused corrected output](evidence/origin-candidate-052/metadata/final-074-docs-green.log) remain archived. This does not represent a final-source whole-suite or Linux renderer pass.

## Final 0.7.4 delivery gates

No final0.7.4 source is bound by this report yet. Exact-source CI (including Linux renderer), cloud, Docs and native workflow evidence remains pending. Actual three-target package inspection, copied Windows server/browser smoke, private compiled-site browser acceptance, full storage-inclusive backend backup and guarded deployment, exact temporary-key cleanup, website/download/feed/GitHub publication and public byte/hash verification remain pending. Only newly bound052 delivery operators may be admitted; no held051/050/049 or earlier operator may execute.

The new052 public-delivery guard requires the actual promoted candidate image and hash-bound, same-source confirmed promotion output; it rejects the preserved0.7.1 image, missing or substituted receipts and mismatched/incomplete identity. The [sanitized method receipt](evidence/origin-candidate-052/delivery-method/promotion-guard-controls.json) and [red](evidence/origin-candidate-052/delivery-method/promotion-proof.red.log)/[green](evidence/origin-candidate-052/delivery-method/promotion-proof.green.log) controls record3 failures before the correction and5/5 focused passes afterward, with independent read-only review. These are local method checks: no production phase, network action or source binding was executed by those controls.

Static Mac inspection, copied Windows smoke and synthetic browser checks remain distinct from physical installation/updater journeys, signing/notarization, real provider quotas/invoices, channel publishing and invitation recipient deliverability. This report does not claim every component, theme or feature was exercised. Protected development processes, existing Brevo activation, production data, retained local backups and rollback/public artifacts remain outside these synthetic tests.

## Upstream disposition and next opportunities

The [45-PR review](evidence/origin-candidate-050/upstream/upstream-review.md) covers after2026-10-20T04:03:12Z through2026-10-21T04:01:05.255Z. #3177 was adopted in `0021fb7c1`;44 records remain deferred/not applicable and the five earlier adaptations remain retained. The archived ledger's original “awaiting root commit” is historical. No unchanged upstream review was repeated for this harness correction.

Prioritized follow-ups are #3010 persistence rollback, #3169 typed GitHub MCP annotations, #3150 idle MCP shutdown, #3035 bounded repeat-action recovery, #3141 isolated browser-profile lifecycle and #3151 remote Windows caption controls. Product opportunities include #3160 scoped webhook posts without model turns and #3019 a workspace Chief daily brief. These are recorded proposals, not adopted or newly runtime-verified features. Introduce one logical adaptation with its own regression and feature fixture, retaining project/Chief scope, host identity, budgets, approvals and uncertain-work no-replay behavior.
