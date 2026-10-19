# Upstream3074: quota reset and backup engines

Reviewed against frozen Origin `ab0cd72b4c2f004c1015adca034472241569c04b`. [Upstream PR3074](https://github.com/milind-soni/OpenMausBot/pull/3074) merged at2026-10-18T23:22:28Z as `53d9803aea32c11104a5301805089a5d6b40cf8c`. Complete official changed-file metadata/patches are preserved beside this report. This is a focused fit review, not acceptance of every upstream component or an adopted feature.

| Capability | Origin today | Recommendation |
| --- | --- | --- |
| Subscription usage windows | `server/plan-usage.ts` already reads five-hour/weekly availability and reset timestamps. | Reuse that reader; add scoped near-limit notices rather than a second credential reader. |
| Backup engines | Opt-in startup recovery and workspace/bot backup choices already exist in `server/automatic-recovery.ts`, `server/config.ts` and `server/index.ts`. Capability checks preserve tools/workspace access. | Preserve those controls. This PR adds quota-specific refusal and eventual switch-back, not the first backup implementation. |
| Continue after quota reset | Origin's `RoutineSchedule` union in `shared/routines.ts` has cron/once/daily/interval, and the new limit-reset symbols/endpoints are absent. | Useful next capability: a visible one-time continuation in the same conversation, with pause/undo and an honest unknown-reset state. |
| Quota-aware scheduling and calendar | The PR derives reset+60seconds on the server, supports once/every-reset, warns near90percent, moves a routine's next occurrence and marks resets in the calendar. | Adapt in separate stages after reconciling Origin's existing routines and the unported upstream automation/trigger structure. |
| Test credential isolation | Origin's sealed fixture protects PATH/home, but `defaultCredentialReader` still installs the Darwin keychain fallback unconditionally. | A narrowly scoped fixture fix is being prepared and must be proved with a stubbed keychain, never by reading a real keychain. It is not yet in the frozen14 release. |

The focused code review covered `shared/limit-reset.ts`, `server/limit-resets.ts`, `server/limit-failover.ts`, dispatcher/routine integration patches and `src/lib/limit-resets.ts`. Upstream merges a local engine clock, per-thread failover JSON, scheduler changes, new trigger tools, several UI components and locale/catalog changes. Some dependency paths do not exist in Origin and existing integration files have diverged. A whole merge or blind cherry-pick would couple unrelated automation, catalog, branding and file-size changes to Origin's modified dispatcher.

For Origin, a scheduled continuation must remain bound to the initiating member, backend, workspace/project, Chief, conversation and engine configuration. The sender's machine and credentials run it. Reacquire a fresh acknowledged sender-runs lease before dispatch, recheck membership/project access, and make the continuation unique by conversation and reset occurrence. Offline machines must report queued/offline state instead of implying that another member will run with their credentials. A quota reset never approves or merges a task PR.

The upstream UI cache is module-global (`report`, `names`, `loading`). Origin must key or reset it on server/account changes and discard late responses from the previous scope. The server clock likewise needs engine/configuration revision checks when an in-flight usage read completes. Avoid importing a stale-response problem alongside the session fences in14.

Suggested integration sequence:

1. Port the small sealed-fixture keychain guard with synthetic regression coverage as its own change.
2. Add scoped usage/reset data and quiet notices. Test unknown/malformed times, multiple full windows, server/account switches and unavailable providers.
3. Add a person-created one-time continuation, then repeated resets/calendar support. Test offline/restart, idempotency, revocation, clock changes and lease loss.
4. Add opt-in quota failover/switch-back with existing tool/workspace capability checks, permitted configured backups and cost controls. Preserve upstream's rejection of rotating sign-ins of the same subscription engine. Test manual model changes, busy conversations, account changes and unknown reset times before enabling automatic restoration.

No provider account was accessed and no feature was imported by this review. The current14 release remains frozen while its targeted CI retry runs.
