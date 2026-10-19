# Origin 0.2.10 candidate

Origin **0.2.10** is published from frozen source `0eb372a94715527931043a1b6d8c02a50194dbb0` (`origin-v0.2.10`). [CI 39131925881, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39131925881/attempts/1) and [native 39131922063](https://github.com/z4mbo/Origin/actions/runs/39131922063) succeeded on that source. The public GitHub release, all 13 payloads, two metadata files and three aliases, backend, five bounded migrations and matching website are verified. The deployment key was revoked at `2026-10-18T14:16:39.3562237Z` and its file is absent. [Delivery receipt](evidence/origin-delivery-030/delivery-receipt.json) (SHA-256 `247e4a0dfc19c473b7eea3093bf759ee9777f327850dd5fe44ca6753d110c297`) and [evidence report](evidence/origin-delivery-030/report.json) (SHA-256 `f2f13eafb07b0f1a1b92458daa16c76d31c64d1277edc562f43788b315af7af6`) retain the actual results.

The following local/source checkpoints retain their original scope; public delivery does not convert synthetic UI or fake-provider results into native or production-provider acceptance.

## Activity correction and source-qualified inspection

Fix `f1fa6fdc8` addresses `src/components/ActivityPanel.tsx:59–87`: a completed turn schedules a 400 ms reload, then a normal same-bot update replaces `bot.tasks` and effect cleanup cancels that pending reload. The ledger advances while the visible panel stays stale until manual Reload. A ref preserves pending scheduling across ordinary updates, with cleanup retained for bot changes and unmount.

The unchanged final seven-case regression passes six and fails one on frozen 0.2.9, then passes all seven after correction. Six related suites pass 69 cases; application/server types and touched lint pass. The [Activity report](origin-activity-refresh.md), [exact regression proof](evidence/origin-activity-refresh-030/regression.json) and [four-image manifest](evidence/origin-activity-refresh-030/manifest.json) retain source hashes and verification boundaries. In the real App with an isolated fake-Claude backend, the baseline panel showed one receipt while two were persisted; manual Reload revealed both. After controlled HMR of the exact corrected component, the third tool turn, sent through the visible composer, produced three panel and three backend receipts without manual Reload. The first turn used the mapped fixture command; the second and third used the visible composer after welcome. Captures retain the 0.2.9 fixture footer; they prove the source correction, not a packaged 0.2.10 installation. No real account, provider or production mutation was exercised.

The frozen canonical changelog has five current notes. It retains eighteen 0.2.7 notes, four desktop-1.0 notes and five 1.0 notes: 32 titles across four release articles. Held 0.2.9 is not presented as published history. Fresh in-app and compiled-site evidence match the final 0.2.10 source and notes; older captures retain their original source identities.

## Local working-tree checks before freeze

| Gate | Current result |
| --- | --- |
| Full client/shared tests | 5,960 passed across 561 files in 428.66 seconds; exit 0. |
| Application/server TypeScript, backend/site TypeScript, lint and locales | Passed before source freeze. |
| Touched server/shared tests | Seven files, 515 passed and five existing skips in 134.90 seconds. |
| Backend tests | Nineteen files, 175 passed. |
| Site tests | Fourteen passed. |
| Guard/release/deployment suites | 121 passed. |
| Documentation/reference checks | Seven passed after these pre-freeze changes; whitespace check passed. |
| Exact-source hosted CI and native Mac/Windows builds | [CI 39131925881, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39131925881/attempts/1) and [native 39131922063](https://github.com/z4mbo/Origin/actions/runs/39131922063) succeeded at `0eb372a94715527931043a1b6d8c02a50194dbb0`. |
| Fresh draft/assets, website image and private/public acceptance | Completed; the permanent delivery receipt records verified artifacts, image and public acceptance. |

The [sanitized local checkpoint](evidence/origin-candidate-030.json) retains command results and log identities. These local results remain distinct from final frozen-source CI, packaged smoke, browser/source-component checks and public delivery. The 0.2.9 checkpoint and additional failed local shards remain historical evidence, not new 0.2.10 coverage. No test skip, timeout, assertion weakening or OS-permission change waives those failures.

## Held candidates and delivery gates

Held 0.2.8 remains frozen at `63c38a2cf5e22166efafb7e727b562988e5b084c`, tag `origin-v0.2.8`, with successful native run `39122300158` and private draft `416411426`. Its exact-source CI was not established as successful, and no publication/backend/site rollout or deployment key occurred. Its assets remain immutable.

Held 0.2.9 remains frozen at `07666fa2e52b5acef1bfd86d30367c239812e0a6`, tag `origin-v0.2.9`, with successful [CI 39125401665, attempt 2](https://github.com/z4mbo/Origin/actions/runs/39125401665/attempts/2), native run `39125456555` and private draft `416432444`. Actual Activity inspection blocked publication after CI succeeded. No 0.2.9 deployment key was issued and no publication, feed, backend, migration or site promotion occurred. Its [held-candidate record](origin-candidate-029.md) preserves exact outputs and both CI attempts; the two first-attempt failure causes remain unclassified.

The new immutable 0.2.10 source/tag received its own completed CI/native results, distinct release and verified artifacts/feeds/site identity. The [delivery record](origin-delivery.md) and [permanent receipt](evidence/origin-delivery-030/delivery-receipt.json) retain independent public hashes, fresh backup, authenticated backend authority, bounded migrations, matching website rollout and credential cleanup. No old source, tag, draft, image or receipt was relabelled. PR #1 remains open; task PR merges still require the person.

The free Brevo account now has completed phone and email verification. After explicit activation approval, all four DNS records were published while preserving the nine existing website A records. Brevo confirms origin.imbored.fun is authenticated and Origin <invites@origin.imbored.fun> is a verified sender. The standard account API key is active until 2027-10-18 and is stored privately outside the repository. Backend email configuration is still pending the next verified delivery; public invitation links remain available for manual sharing. No real recipient email has been sent, and provider acceptance and inbox delivery are not established. See the [sanitized provider setup record](evidence/origin-mail-provider-031.json). Windows packages are unsigned. Mac packages are ad hoc signed and unnotarized with manual updates; interactive macOS installation, signed-updater, real-provider/hardware and cross-machine/TURN acceptance remain separate. The continuing review remains scheduled for 06:00 Europe/Rome.
