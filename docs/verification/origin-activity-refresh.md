# Activity receipt refresh

An isolated real-App inspection reproduced a P2 refresh defect at frozen `07666fa2e52b5acef1bfd86d30367c239812e0a6`, `src/components/ActivityPanel.tsx:59`. With Activity open, a completed tool or turn queues a reload. A normal update replaces the same bot's `tasks` array before the 400 ms callback. That rebuilds the live subscription, whose cleanup cancels the reload. The conversation and saved activity ledger update, while the panel keeps its previous receipts until the person presses Reload.

Fix `f1fa6fdc8ec5c49d15119fccadad7af678c507b7` retains the pending timer across subscription rebuilds for the same bot. Changing bots or unmounting still clears the timer and aborts the owned read. The existing shared stream, thread filter, latest-read protection and 400 ms debounce remain in place. No additional stream or polling loop is introduced.

## Regression and browser proof

The identical final seven-case test file runs against the exact baseline component and the corrected component. Before correction, six cases pass and the task-array replacement case fails; afterward, all seven pass. The tests also cover bot switching, old-thread isolation, unmount cleanup and missed-frame recovery. Six related suites pass all 69 cases; application/server TypeScript and touched lint pass. The [retained regression](evidence/origin-activity-refresh-030/regression.json) records both executions and exact file identities. Raw logs remain private; their hashes are in the [verification record](evidence/origin-activity-refresh-030/proof.json).

The browser uses the real App, a fresh disposable home and fake Claude, with no provider or production calls. The first tool turn uses the mapped fixture send command while onboarding still covers the page. After completing the synthetic welcome flow, the second tool turn is sent through the visible composer. The API ledger contains two receipts but Activity shows one. Pressing Reload shows both. After the exact component correction loads through controlled HMR, the third tool turn is sent through the visible composer and adds its third receipt automatically, without Reload.

| State | Visible receipts | Saved receipts | Capture |
| --- | ---: | ---: | --- |
| Before the second turn | 1 | 1 | [Baseline](evidence/origin-activity-refresh-030/screenshots/baseline-one-receipt.jpg) |
| Second turn complete, before correction | 1 | 2 | [Stale panel](evidence/origin-activity-refresh-030/screenshots/second-tool-stale.jpg) |
| Manual Reload before correction | 2 | 2 | [Reload recovery](evidence/origin-activity-refresh-030/screenshots/second-tool-manual-reload.jpg) |
| Third turn complete, after correction | 3 | 3 | [Automatic refresh](evidence/origin-activity-refresh-030/screenshots/after-fix-automatic-refresh.jpg) |

The [manifest](evidence/origin-activity-refresh-030/manifest.json) covers four complete 1280 × 720 JPEGs and three JSON records. Three initial captures obscured by onboarding are excluded. The observed footer is 0.2.9 plus the corrected Activity component; its immutable worker source is recorded separately from the integration fix. This proves the component behavior and does not claim a packaged 0.2.10 installation. Working-file CRLF hashes and normalized Git-blob hashes are distinguished explicitly.

## Release boundary

The defect was found after 0.2.9 CI completed successfully. That candidate remains held: its tag, native artifacts, private GitHub draft and site image retain their own identities, and no 0.2.9 publication, backend deployment, migration, site promotion or deployment-key issuance occurred. The correction proceeds in the fresh [0.2.10 candidate](origin-candidate-030.md), requiring its own verification and delivery receipts.

The earlier capability-enabled Windows trust-controls test failed at the same missing-receipt assertion. Independent server-only fixtures had already proved tool forwarding and ledger persistence. The visible-App reproduction and final regression establish refresh cancellation; they do not explain the separate native browser bootstrap failures or the unrelated first-attempt 0.2.9 CI failures.
