# Notification and delegation CI repair evidence

This record covers three committed fixes on `codex/shared-agent-conversations`. It is local verification evidence, not a production, native GUI, provider, or Linux acceptance claim. No push, tag, deployment, installation, or publication was performed by this lane.

## Proven bugs and commits

| Severity | Scenario and wrong result | Fix and evidence |
| --- | --- | --- |
| P2 | A Chief first creates an explicitly independent named job on a specialist. A later ordinary delegation from the same parent adopts that fresh job as its canonical child. The existing real thread-aware fixture consequently observes two tasks where three independent contexts are required. Pre-marker jobs with an exact opener thread but no work marker can also be adopted incorrectly. | `c4e278347c31d02138f10a966a525139bcd3ba49`: explicit independent jobs receive `continuity: false`; migration rejects that marker and preserves pre-marker explicitly opened jobs. See `server/delegation-thread.ts:18`, `:19`, `:55`; public persisted contract at `shared/wire.ts:90`. `regression-red.log` and `legacy-fresh-red.log` retain failing scenarios; final `legacy-fresh-green.log` includes 20 delegation-thread tests passing. |
| P2 | With thread tabs hidden, opening a bot requests its main thread. A switch SSE announcement arrives before React commits the navigation state. The event handler reads the stale selected thread and marks the unread reply on `left-behind` as read. The deterministic test uses the real StoreProvider, a React transition, and an immediate switch HTTP/SSE frame; the red run records the unintended read. | `a148f39f44644f8566418bda9ebb54464123e7cb`: record the exact navigation target synchronously, retain it until rendered state confirms the switch, and prefer that target for SSE read decisions. Revision fencing and failure cleanup remain. See `src/state/store.tsx:2298`, `:3040`, `:3147`, `:3368`. `client-race-red.log` fails on `['left-behind']`; `client-race-green.log` passes all 231 selected client tests. |
| P2 | The unconditional child-node start notification makes ordinary bot coordination, actual consultations, outside-origin work, room work, and quiet incident follow-ups generate user notifications. A consultation start can precede its actual question notification, breaking exact-thread question routing and quiet coordination. | `82d7617a80b0d65a53546a1d010c21e0980240f5`: announce saved delegated work only for user-origin Chief work outside rooms/routines/quiet lineage. Preserve transcript requests, deduplication, muted behavior, questions, and approvals. See `server/delegation-notification.ts:21` and root lineage input at `server/index.ts:4364`. Five added negative cases fail in `regression-red.log`; final helper suite passes 31 tests. A new real Chief work/consult fixture verifies one exact-child work notification and no consultation start. |

Every commit carries the required Codex co-author trailer. Changes preserve the index/store file-size and index-route ratchets without raising their pins.

## Verification results

- Portable Node 24.21.0 executed isolated fixture tests on free ports. Tests used synthetic data and fake drivers. Protected live ports 3210/3211/5199/8799 and production data were untouched.
- Final helper run: `server/delegation-thread.test.ts` (20) and `server/delegation-notification.test.ts` (11): **31 passed**, `legacy-fresh-green.log`.
- Client run: `src/state/notification-open.test.ts`, `src/state/agent-thread-navigation.test.ts`, and `src/state/store.test.ts`: **231 passed across 3 files**, `client-race-green.log`.
- Server fixture results combined from the retained targeted runs: notification-routing **10**, thread-aware-bots **14**, incidents **9**, independent-threads-api **14**, long-running-chief **9**: **56 passed and 1 platform skip**. This is a union of targeted completed runs, not a claim that one final five-file run was performed. The first four passed in `real-fixtures-green.log`; thread-aware-bots including its added positive Chief/consult test passed in `real-chief-green.log`; final long-running-chief passed in `real-chief-final.log`.
- `npx tsc -b` and `npx tsc -p tsconfig.server.json` completed successfully; their logs are empty because the commands produced no diagnostic output.
- File-size and index-route ratchet tests: **2 passed**, `guards.log`.
- Focused oxlint with `--deny-warnings` and `git diff --check` passed for the ten touched files. No dedicated oxlint log was retained; these are execution observations rather than independently replayable log evidence.

## Preserved failures and assertion changes

`real-fixtures-green.log` retains three long-running Chief expectation failures after the runtime bugs were fixed. Those scenarios really issue user-origin Chief work: a text label containing CONSULT does not set `consult: true`. The tests now preserve their previous notification sequence exactly while separately requiring the precise new delegation start bot, thread, body, and count.

`real-chief-green.log` also retains a subsequent overly strict total ordering assertion. Child start delivery may race the parent's completed reply. The final assertions retain the old notification order and independently require the exact ordered list of starts, avoiding an invented cross-stream ordering contract. Final long-running Chief coverage is green in `real-chief-final.log`.

`client-routing-before.log` is an earlier nondeterministic green run of existing tests. It did not disprove the Windows CI failure; the subsequently added immediate SSE/React-transition regression reproduces the actual stale-read bug.

## Boundaries and remaining verification

The root agent owns the complete client/shared rerun, final global checks, versioning, release freeze, and publication decision. No new client/shared edits are planned by this lane. These fixes have not yet been rerun on Linux CI, installed Electron, macOS, real providers, or production. No UI styling or before/after screenshots are claimed for these behavior-only fixes. Earlier 0.3.1 build/native preparation evidence remains historical and must not qualify the next candidate.
