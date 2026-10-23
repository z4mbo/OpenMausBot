# Origin account sync and shared thread queue

Worktree: `C:\Users\aless\Documents\Origin-bugfix`, branch `bugfix/scan`.

## Queue handoff (P2)

Scenario: owner has the running thread lease; member queues a request, owner queues another. Before the owner finishes, the member loses project access, becomes a viewer, is disabled, or is deleted. `settleRun` selected the oldest queued row without validating the requester. The member's row became `running` while the owner's next row stayed `queued`. `pendingForMe` hides the unauthorized row, so nobody resumes it and the thread stalls until lease expiry. Archiving the thread, disabling the agent, or switching sharing off produced the same invalid promotion.

The eight new tests in `backend/convex/sharedAgentQueue.test.ts` were run against the original handoff first. All eight failed. For the four requester cases, the observed state was `{ active: deniedRunId, rejected: "running", promoted: "queued" }`, versus the required `{ active: nextRunId, rejected: "interrupted", promoted: "running" }`. Thread-disabled cases retained the rejected lease; the 55-row queue also promoted its first unauthorized request.

The fix revalidates active user and current writable thread access before promotion. Rejected queued rows end as interrupted. Draining is bounded to 50 queued rows per transaction; an internal continuation retains the previous holder as its compare condition so it cannot replace a newer lease. FIFO ordering among eligible rows stays intact.

Logical commit group: `backend/convex/lib/agentThreadRows.ts`, `backend/convex/sharedAgentQueue.test.ts`, the `promoteQueuedRun` import and `promoteQueued` internal mutation in `backend/convex/agentRuns.ts`. Other changes already present in `agentRuns.ts` belong to the preceding access-control review.

## Account sync isolation (P1)

Scenario: account A's workspace request or local bot-creation response is pending. The person signs into account B or changes the backend URL, or the App unmounts during sign-out. The original stable sync callback had no account identity or lifecycle guard, so A's delayed response continued through project reads, local bot creation/linking, and renderer dispatch. Account changes did not start a fresh round until the next poll. Shared-agent cloud calls also read the latest global credentials, permitting a mixed old-project/new-account round.

Four new tests in `src/components/OriginSync.test.ts` failed before the fix: both session/server replacement tests never reached the new account's empty-workspace screen; the unmount test observed a project lookup for `old-team`; the delayed bot response test continued the old round. The fifth test covers selecting the current account's head when the local links also contain another account's head.

The fix gives each effect one URL/token/lifecycle scope, checks that scope before and after every awaited operation, and restarts promptly when identity changes. Local bot responses cannot dispatch or link after cancellation. Shared-agent queries and mutations use the same scoped guard. Account workspace visibility resets until the new round completes, and workspace selection uses only the signed-in account's linked heads.

Logical commit group: `src/components/OriginGate.tsx`, `src/components/OriginSync.test.ts`, and `src/lib/origin-shared-agents.ts`.

An already dispatched local mutation can finish on the isolated/local server after cancellation; the client ignores its result and issues no further stale operations. This change does not claim server-side transactional cancellation of an in-flight HTTP request.

## Validation

- Client targeted suite: 3 files, 12 tests passed (`client-after.log`).
- Full backend suite: 9 files, 81 tests passed (`backend-after.log`).
- `tsc -b` passed (`client-typecheck.log`, empty successful output).
- Backend `tsc -p convex/tsconfig.json` passed (`backend-typecheck.log`, empty successful output).
- Targeted oxlint with denied warnings passed.

These are renderer component tests with synthetic deferred responses and isolated `convex-test` database fixtures. They do not establish live Convex deployment or multi-machine acceptance. No live deployment, production data, main-checkout mutation, live port 5199/8799, or local Convex process was used. No UI styling changed, so these fixes have no visual before/after artifact.

## Additional import finding requiring follow-up

`src/lib/origin-import.ts` creates a project bot, then requests its default team, then links it. A default-team failure (for example the workspace bot cap) leaves an unlinked local bot; the next sync creates another. Linking before staffing alone would make the import skip the incomplete project forever; deleting only the chief after a lost response can leave orphaned role bots. A coordinated idempotent create/link/staff flow or explicit resumable setup state is needed. This wave did not alter import behavior.
