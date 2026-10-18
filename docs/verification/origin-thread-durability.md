# Thread saves and failed deletions

This recipe qualifies actual filesystem-save failures in the production Store
and its registered HTTP task routes. Every operation uses throwaway data from
the verification launcher or the test setup. It does not access production,
the main checkout's servers, a real provider, or a person's conversations.

## Proven scenarios

| Severity | Input and failure | Before | Fixed behavior |
| --- | --- | --- | --- |
| P1 | Delete a thread with a saved conversation, queued follow-up and event file while replacing `bots.json` fails | SQLite messages and queued work were deleted; the JSON still referenced the thread | The SQLite transaction rolls back, the same task remains active and its conversation, queue and event file remain intact; a successful retry removes them |
| P1 | Change Ask to Full, or add a tool allow-list entry, while saving fails | The route reports failure, but the live task gains the permission | The grant stays at its previously saved setting |
| P2 | Rename, create, select, pin a folder, set opener/closer, or title a thread while saving fails | Unsaved state remains in memory despite the failed operation | The bot, task array and existing task objects regain their prior state without publishing a change |

Approval reductions remain effective in memory even when they cannot be saved.
A mixed edit can reduce Full to Ask while its attempted new allow-list entry
is rejected. Custom policies are not assumed to grant more than Full access.
Inherited allow lists retain removals and reject additions on failure. Origin
sharing unlink and `sharedPrivate: true` remain effective as revocations.
An unrelated unsaved title is rolled back in all these cases.

Engine session cursors and observed message timestamps already describe events
that happened. They remain in memory after a failed save and reach disk on the
next successful save. Existing staged model changes, import receipts,
workspace deletion and bot tool-scope revocation behavior are preserved.

The implementation narrowly adapts the in-place rollback and deletion
transaction approach from [OpenMausBot PR #3004](https://github.com/milind-soni/OpenMausBot/pull/3004),
merged as `9fc015ac3df48b53ce7afe4ba4221e9e57a9465f`, while keeping Origin's
permission and sharing semantics.

## Reproduce

Run with Node 24 or newer from an isolated checkout:

```sh
npx vitest run server/store-durability.test.ts server/store-durability-http.e2e.test.ts
```

The unit cases rename only their owned temporary `bots.json` to a backup and
put a directory at its original path. Production atomic replacement then
fails with the real OS filesystem error. Finally, the fixture restores the
original file and verifies its bytes. No save method or database deletion is
mocked.

The HTTP cases call `launchVerificationServer` from
[`scripts/control-omb.ts`](../../scripts/control-omb.ts), then use the actual
registered create, rename, approval and deletion routes. The deletion case
sends a message through the mapped `control:omb` surface, waits for the fake
engine to settle, compares the complete conversation after the failed delete,
and checks the subsequent successful delete. Error responses identify the
failed operation without exposing the fixture data path. The launcher stops
its child and removes the temporary home after the cases.

## Retained result

The [report](evidence/origin-thread-durability-034/report.json) binds source
`7a5716f745d29932585100b108c89bfd04638b72` and fix
`5e223eb32125b32e5b8e65a9b3ed0750227aadca` to the test payloads.

- On the untouched production baseline, the final 21 new cases produced
  **18 failures and 3 passing controls**. The direct SQLite assertion shows
  the saved conversation becoming an empty array after the failed deletion.
- The fixed production code passes all 21 new cases. The complete selected
  Store, tasks, independent-task, folder API, SQLite and guard run reports
  **250 passing tests and 1 skipped test across 10 files**.
- Server TypeScript, touched-file lint and `git diff --check` pass.
- [Payload hashes](evidence/origin-thread-durability-034/payload-sha256.json)
  cover the retained report and logs. Terminal log copies trim trailing blank
  lines only; the report also records original private log hashes.

This proves recovery from the exercised synchronous save failures. Saving a
JSON file and committing SQLite are separate persistence operations; this is
not a power-loss journal and does not claim atomic recovery if the process
dies or SQLite COMMIT fails after the JSON replacement succeeds. No packaged
desktop, provider account or production acceptance is implied by these tests.
