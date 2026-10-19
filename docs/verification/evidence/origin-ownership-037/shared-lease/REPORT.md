# Shared sender-run lease ownership

Commit: `99f2c5672fb358f749bb02a9e899bdfe5dbf7b35`

Base: `ec28ec06e935b10a176f26586348e81831475e80`

Owned branch: `codex/shared-run-lease-deadline-035`, in the isolated `origin-footer-single-row-034/Origin` worktree. Exactly three tracked files changed. Required Codex coauthor is present. No push, CI, build, release, production call, live Convex process, main checkout or parent preview was used.

## Proven failure and change

**P1: a runner could continue executing after cloud ownership passed to another sender.** On the baseline, `server/origin-run-lease.ts` retained an active run indefinitely when `agentRuns:heartbeat` rejected or never settled. `runFor()` and `holds()` continued to return ownership. A busy provider turn could therefore keep using its machine while Origin considered it interrupted and promoted a queued member. The real backend lease is 60 seconds (`backend/convex/lib/agentThreadRows.ts:9`); the existing backend regression advances 61 seconds, expires the old run and verifies the queued sender becomes active (`backend/convex/sharedAgents.test.ts:114`). No backend code changed.

The fix uses a monotonic deadline measured conservatively from the acknowledged request's start, never from its delayed reply. A per-run timer interrupts on expiry even if the regular tick is waiting on an unresolved RPC. Rejected or malformed replies cannot renew authority. One heartbeat is in flight per active run, and responses for removed or expired run objects cannot restore it. Relevant committed source: `server/origin-run-lease.ts:90` (withdrawal), `:100` (expiry), `:124` (heartbeat). Existing explicit cancellation, permission revocation, fresh-renewal and normal completion controls remain exercised.

**Related stale-start cases:** a queued `running` subscription snapshot formerly started local execution immediately. A snapshot may arrive after that grant has ended or access was revoked. A queued turn now obtains a fresh heartbeat acknowledgement before executing (`server/origin-run-lease.ts:220`). It stays unconfirmed while requests fail or never settle, expires without executing, and ignores late acknowledgements. A cached/idempotent `agentRuns:begin` response is also insufficient for a new local runner: the backend's existing-clientId branch returns status without renewing its lease (`backend/convex/agentRuns.ts:29`). New local admissions now confirm that response; an already held local run keeps its existing deadline (`server/origin-run-lease.ts:63`, `:154`). Expiry clears write attribution; a previous run's completion grace cannot become a later expired run's fallback.

**Lifecycle required by the timer:** account/backend replacement must dispose the old lease before allowing a new one. `server/origin-shared-agents.ts:236` now calls `lease.stop()`. The stopped object withdraws old turns, cancels admission and expiry timers, drops unstarted claims and clears attribution (`server/origin-run-lease.ts:264`). Pending begin/heartbeat completions cannot resurrect it, and a stale timer cannot interrupt a replacement turn. The regression drives real `createSharedAgents.beforeSend()` through a synthetic account change (`server/origin-shared.test.ts:582`).

These are related cases of one ownership invariant, not a claimed count of unique independent bugs.

## Verification

- **Exact baseline replay:** 11 selected behavioral regressions fail against the two original production modules read directly from the base Git tree (`red-final-bound.log/json`, `final-source-proof.json`). The final test file's bytes were unchanged and the fixed source was restored exactly. The final real-helper account-change case separately fails against that same baseline (`red-final-account.*`, `red-final-account-source-proof.json`).
- **Final fixed file:** all **33 tests pass** in `server/origin-shared.test.ts` (`green-accepted-final.*`), including outbox/mirror controls, lease cases and the account lifecycle integration. Test counts are cases, not unique bugs. An earlier focused pre-fix lifecycle replay is also retained (`red-lifecycle.*`).
- **Backend comparison:** the existing stale-run/promotion test passes in the synthetic `convex-test` runtime (`backend.*`): one selected test passed; the other 16 were not run. No local or hosted Convex deployment was used.
- **Types/lint/guards:** server TypeScript project passed; touched-file oxlint with `--deny-warnings` passed; file-size and comment-history guards passed; `git diff --check` passed. Exact logs are retained. No frontend, site, native-app or full backend acceptance is implied by those checks.
- **Standard isolated server fixture:** Node 24.21.0 ran the unchanged documented `launchVerificationServer({})` and `runControlOmb` surface. Doctor, explicit-URL bot creation, send, wait and bounded transcript passed against `http://127.0.0.1:21006`, using only the repository fake engine (`fixture-final-*`). After normal `close()`, PID **21640** was absent, the exact port was closed, and the owned fixture data directory was absent. This normal-turn smoke does not simulate a cloud partition; the source-bound lease tests and separate backend test prove the partition/takeover behaviors within their stated synthetic scope.

All test processes used isolated homes/temp/AppData and an explicit environment whitelist. No provider credentials, user accounts or owner application data were used. The final fixture was rerun only because the lifecycle source changed after the first smoke.

## Evidence qualifications and limits

Raw initial diagnostics remain available: `red.log` records a test-harness wait that originally reached 40 seconds; that wait was corrected before accepted baseline replay. `green-lifecycle.log` records a Windows cleanup EPERM caused by synchronously advancing fake timers without draining the fixture flush microtasks. The integration harness now uses async timer advancement; final runs pass and normal cleanup succeeded. Those diagnostics are not accepted green proof and no timeout was increased or test skipped to conceal them.

The final source/test bytes are bound in `final-source-proof.json` and `red-final-account-source-proof.json`. `change.patch` and the Git commit retain the exact tracked change. The manifest records evidence file sizes and SHA256. Git text normalization and checkout CRLF bytes are distinguished in the manifest's source metadata.

Interruption cannot roll back an external action already dispatched. The runtime's existing `interruptDirectThread` revokes local dispatch/capabilities before awaiting adapter interruption and preserves the generation fence for replacement approvals (`server/index.ts:2326`). Provider cooperation and already-running external actions retain that boundary. This patch does not introduce a cross-machine fencing token, guarantee exactly-once external side effects, or prove behavior on two physical machines, real providers, installed apps or production. A stopped initial `begin` HTTP request can still settle remotely; its local completion is rejected and cannot start work. Its cloud record is handled by the existing server lease expiry.

No UI changed in this commit; no screenshots or visual acceptance are claimed for it.
