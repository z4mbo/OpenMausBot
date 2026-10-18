# Origin 0.2.10 candidate

Version 0.2.10 is being prepared and is not published. Its working tree carries the invitation/public-link fixes, desktop account/computer layout correction, optional central Brevo transport and cross-drive verification correction from the held 0.2.9 candidate, plus the independently reproduced Activity refresh correction. Public 0.2.7 remains the verified baseline. The final source/tag, fresh CI/native runs, numeric draft, asset hashes, website image and production receipts are not established by this preparation record.

## Activity correction and source-qualified inspection

Fix `f1fa6fdc8` addresses `src/components/ActivityPanel.tsx:59–87`: a completed turn schedules a 400 ms reload, then a normal same-bot update replaces `bot.tasks` and effect cleanup cancels that pending reload. The ledger advances while the visible panel stays stale until manual Reload. A ref preserves pending scheduling across ordinary updates, with cleanup retained for bot changes and unmount.

The unchanged final seven-case regression passes six and fails one on frozen 0.2.9, then passes all seven after correction. Six related suites pass 69 cases; application/server types and touched lint pass. The [Activity report](origin-activity-refresh.md), [exact regression proof](evidence/origin-activity-refresh-030/regression.json) and [four-image manifest](evidence/origin-activity-refresh-030/manifest.json) retain source hashes and verification boundaries. In the real App with an isolated fake-Claude backend, the baseline panel showed one receipt while two were persisted; manual Reload revealed both. After controlled HMR of the exact corrected component, the third tool turn, sent through the visible composer, produced three panel and three backend receipts without manual Reload. The first turn used the mapped fixture command; the second and third used the visible composer after welcome. Captures retain the 0.2.9 fixture footer; they prove the source correction, not a packaged 0.2.10 installation. No real account, provider or production mutation was exercised.

The working canonical changelog has five current notes. It retains eighteen 0.2.7 notes, four desktop-1.0 notes and five 1.0 notes: 32 titles across four release articles. Held 0.2.9 is not presented as published history. Fresh in-app and compiled-site evidence must match the final 0.2.10 source and notes rather than relabel older captures.

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
| Exact-source hosted CI and native Mac/Windows builds | Pending fresh source freeze and completed runs. |
| Fresh draft/assets, website image and private/public acceptance | Pending; no production completion claimed. |

The [sanitized local checkpoint](evidence/origin-candidate-030.json) retains command results and log identities. These local results remain distinct from final frozen-source CI, packaged smoke, browser/source-component checks and public delivery. The 0.2.9 checkpoint and additional failed local shards remain historical evidence, not new 0.2.10 coverage. No test skip, timeout, assertion weakening or OS-permission change waives those failures.

## Held candidates and delivery gates

Held 0.2.8 remains frozen at `63c38a2cf5e22166efafb7e727b562988e5b084c`, tag `origin-v0.2.8`, with successful native run `39122300158` and private draft `416411426`. Its exact-source CI was not established as successful, and no publication/backend/site rollout or deployment key occurred. Its assets remain immutable.

Held 0.2.9 remains frozen at `07666fa2e52b5acef1bfd86d30367c239812e0a6`, tag `origin-v0.2.9`, with successful [CI 39125401665, attempt 2](https://github.com/z4mbo/Origin/actions/runs/39125401665/attempts/2), native run `39125456555` and private draft `416432444`. Actual Activity inspection blocked publication after CI succeeded. No 0.2.9 deployment key was issued and no publication, feed, backend, migration or site promotion occurred. Its [held-candidate record](origin-candidate-029.md) preserves exact outputs and both CI attempts; the two first-attempt failure causes remain unclassified.

A new immutable 0.2.10 source/tag must receive its own completed CI/native results, distinct numeric draft and newly verified artifacts/feeds/site identity. Delivery then requires independent public hashes, a fresh full backup, exact backend authority, bounded migrations, matching website rollout, temporary-key revocation and fresh public acceptance. The [delivery goal](origin-delivery-goal.md) and [release record](origin-delivery.md) preserve those gates. Neither old source, tag, draft, image nor receipt can be relabelled. PR #1 remains open; task PR merges still require the person.

The approved free Brevo account exists, but the user's actual organization mailing address is pending. No address was invented/submitted, provider key created, DNS authenticated, backend mail configured or transactional sending activated; no real recipient mail has been sent. Invitation links retain the manual-share path. Native clipboard, physical Mac/Windows installation, signed updater, real-provider/hardware and cross-machine/TURN acceptance remain separate; Windows is unsigned and Mac packages remain ad hoc signed/unnotarized with manual updates. The continuing review stays at 06:00 Europe/Rome.
