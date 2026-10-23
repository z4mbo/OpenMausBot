# Origin correction candidate 047 evidence

This archive supports the finite 0.3.2 correction batch. It preserves selected UI observations and targeted regression/CI-repair evidence. It is not a frozen-release, installed-app, real-provider or production delivery acceptance record.

## Source and browser qualifications

- Root performed the CUA interactions; the archive preparer verified identities and hashes, not the browser interactions.
- Before feature captures use fixture revision 5 on the unfrozen working tree headed by `8fa1c8ce2f4eb5a76faade6f2541819a7f8cfd3f`. After captures use revision 6, headed by `8a25756147af124f1781cc0d056cd9ec62819293`. The full manifests bind raw working-file bytes; neither is the final 0.3.2 freeze. All seven UI source/test hashes in the supplement matched revision 6 when recorded.
- Mobile layouts were fixed in `73bd07518cadbb1108360cf4122590f7c0d3b45e`; channel readiness in `8a25756147af124f1781cc0d056cd9ec62819293`. Existing Git history supplies the tracked source; ignored fixture source snapshots are archived here.
- Twelve feature screenshots cover selected Studio, Broadcast, Pipeline, Canvas and Org states. Broadcast has matched empty-composer and filled-X before/after comparisons. Root measured banner text 309 px wide and 39 px high; publishing was disabled and draft save available after the fix.
- Pipeline's original email observation was **unknown connection status**, because the first fixture had no lower-level session. It was not a confirmed-false provider case. The corrected narrow adapter returns synthetic false through the actual status endpoint without setting a real session; the after state shows Connect Brevo and disables the filled email. Unknown-status behavior is separately covered by DOM regressions. Search grew to 295 px and actions moved below it.
- Canvas's after capture and root interaction record prove both toggle centers hit their own buttons and both panels actually close. Desktop styling was preserved; this is not collaborative Canvas mutation acceptance.
- Queries, records, model labels, plans and status responses are synthetic. Cloud writes, non-local requests, publishing and outreach were blocked. No provider, recipient, production data, native GUI, backend persistence or updater acceptance is asserted.

## Regression and authority evidence

The UI receipt retains Broadcast 4 failing/3 passing tests before and 7 passing after; Pipeline 5 failing/3 passing before and 8 passing after. The focused seven-file suite passed 44 tests, frontend TypeScript, touched-file lint and whitespace checks. The original fix receipt predates browser inspection and correctly says pending; the later browser supplement records root's after results.

The two Canvas authority logs retain four focused existing checks: viewer tool refusal, hosted private-tool denial, Convex viewer Canvas-write refusal and shared-run viewer rejection. Source authority is at `server/origin-canvas-tools.ts:89`, `backend/convex/draw.ts:62`, `backend/convex/lib/agentAccess.ts:74`, `backend/convex/lib/modelHostAccess.ts:63` and `server/hosted-turn-policy.ts:15`. The Ask UI does not grant write access; this was a bounded source/synthetic review, not an actual provider send.

## Failed CI and correction lanes

[CI 39375851729 attempt 1](https://github.com/z4mbo/Origin/actions/runs/39375851729/attempts/1) failed all eight Vitest shards and its aggregate. The sanitized [job summary](ci/failed-046-summary.json) retains per-job official links and raw-log hashes: Linux 43 failed test executions across 10 files; Windows 45 across 11. These are assertion/fixture failures, not timeout substitutions. Large raw CI logs remain private and are not copied.

[Non-notification repairs](ci/nonnotification/nonnotification-repair.json) distinguish real validation diagnostics from stale verification seams. Retained local proof: full VM 44 passed; Cloud 39 passed with one unchanged Windows symlink-privilege EPERM blocker; checker/cleanup 36 and real HTTP contract 3 passed. Stronger guest denial assertions were preserved. [Notification report](ci/notifications/REPORT.md), [receipt](ci/notifications/receipt.json) and [manifest](ci/notifications/evidence-manifest.json) retain three logical fixes: explicit fresh-job identity, exact-thread early-SSE read fencing and quiet consultation notifications. Its 56 server passes/one platform skip are a union of targeted runs, not one final batch. Interim failures are preserved with their final green results. These lanes do not claim replacement Linux CI, production or native acceptance.

## Upstream reconciliation

[The supplement](upstream-reconciliation.md) compares combined source `3e6f5c3b563efad735d2b4773347174f7492655e` with the earlier October 20 review. Five adaptations were already brought by the concurrent branch; they were not newly implemented or proven byte-equivalent here. HTML previews, Chief-aware templates and MCP HTTP remain separate evaluated candidates. The earlier immutable 36-PR ledger remains historical; the supplement prevents stale absence claims.

## Integrity

Every archived file other than the self-referential manifest is listed with exact byte count and SHA-256 in [manifest.json](manifest.json). Copied files preserve their original bytes and paths relative to the archive; receipts that name private scratch locations are historical provenance, not instructions to use those paths. No caches or raw large CI logs are included.

| Key receipt or binding | SHA-256 |
| --- | --- |
| [ui/fix-checks/browser-after-supplement.json](ui/fix-checks/browser-after-supplement.json) | `4d7295441ffb29bb90f59de9f7670486d484fbed9a1fd39f9291a1fffbae54f8` |
| [ui/fix-checks/fix-receipt.json](ui/fix-checks/fix-receipt.json) | `46e8cfe6cce3c1627c0c2d661a41dffe4ca45f4858f9f91d7268336cada1f8c4` |
| [ui/source-before-5.json](ui/source-before-5.json) | `e3a46180c6289502e47cff949442a762f8b210866f44bdc7ae08f6c01a698060` |
| [ui/source-before-6.json](ui/source-before-6.json) | `f66fed255ff0f64aba3824883793541a56d0525333c8e34ec11cadd8a16fc209` |
| [ui/fixture-6.json](ui/fixture-6.json) | `80877dac42b3dd3355cddde8ae35c6378478bc412ba5963782baf559fe9864e3` |
| [upstream-reconciliation.md](upstream-reconciliation.md) | `0d25333a5ec58cf20747a246f7cf8466355b34ad0ba17b76d9c0ca6b141e3a95` |
| [ci/nonnotification/nonnotification-repair.json](ci/nonnotification/nonnotification-repair.json) | `8d18f5d52d935472753fe1addf601ca222ea8f2e3cb642b879bc6fda378cbb5c` |
| [ci/notifications/receipt.json](ci/notifications/receipt.json) | `0138443ee94935a4eadd3c5a3cf813bf06d7a6c2fa5141c4904e3640c40961de` |
| [ci/notifications/evidence-manifest.json](ci/notifications/evidence-manifest.json) | `3350062820d1464e7aec67fec4ad5947368dee090ede837becda8beb4b8ce52f` |
