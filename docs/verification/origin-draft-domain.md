# Draft defaults and bounded workflow repair

This backend/domain change is locally verified and unpublished. Its final worker runtime is `3b85cb69c0c907a9aa08ba98b664cb5889cbe83a`, based on `0757f71888d2c5aaf41bd877724949a63d815aa2`. No production repair, provider request, deployment, or user-data test ran. Client, server-tool, and browser acceptance belongs to the separately coordinated integration.

[Check report](evidence/origin-draft-domain-031/report.json), [migration descriptors](evidence/origin-draft-domain-031/migration-descriptors.json), and [text hash manifest](evidence/origin-draft-domain-031/manifest.json) bind the source and evidence. Text hashes explicitly normalize CRLF to LF; the ignored raw logs retain their separately recorded hashes. The separately coordinated client/browser gallery uses `origin-draft-defaults-031`; this backend evidence does not replace it.

## Proven scenarios

| Severity | Pre-fix path and scenario | Observed result | Fix |
| --- | --- | --- | --- |
| P2 | Baseline `backend/convex/tasks.ts:256`: create a task without `columnId`. | The registered mutation rejects the missing required field instead of supplying Draft. Explicit Todo is the passing control. | `325e42833`: task creation, connector `create_issue`, and feedback conversion accept omission and resolve it to semantic Draft. |
| P2 | Baseline `tasks.ts:175`: ensure defaults on a nonempty legacy board with no Draft or with an unflagged Idea. | The mutation returns without creating/adopting Draft. | `325e42833`: repair the existing board transactionally, retaining column IDs and existing task placement. |
| P2 | Baseline `tasks.ts:61`, `:143`, `:247`: a renamed flagged Draft has order 99; create/rename Draft at the end; or delete the last Draft while explicitly transferring its task to Todo. | Draft appears after active lanes or disappears. | Shared `5ac262d65` plus `325e42833`: semantic Draft sorts first; column mutations preserve the invariant. A delete keeps the explicitly requested transfer and adds an empty Draft. |
| P2 | Intermediate pre-use case: semantic Draft retains a stale `isDone:true` and is explicitly selected for a new task. | A repository-backed project rejects it with the merged-PR completion error. | `325e42833`: the backend Done predicate gives semantic Draft priority, including stale captured documents. |
| P1 | Baseline-identical `integrations.ts:12–14`: a legacy Idea-only board is queried for a task's publishing context before its repair. | The real internal query returns `draft:false`; the modern server publishing guard consumes that field. The two ordinary-Idea controls pass. No external issue was created in this verification. | `325e42833`: pending legacy Idea stays private while no semantic Draft exists; candidate discovery uses the same rule and checks columns beyond its bounded prefix. |
| P2 | Committed intermediate runtime `325e42833`: an unflagged title-based Draft lies beyond the first 100 columns and task creation omits a lane. | The mutation inserts a new task and another Draft instead of waiting for a complete repair. | `3b85cb69c`: a 101-row prefix detects ambiguity and rejects runtime repair. Only internal phase 3 receives the trusted completed-scan option; public task/repair/connector validators reject attempts to supply it. |

The original eight unchanged-baseline cases produced seven failures and one passing explicit-lane control. Three additional pre-use red captures retain their exact source qualifications in the report. The final backend run passes 215 tests in 23 files, including 31 new cases. Shared ordering and the two source ratchets pass five tests in three files. Backend, app, and server types, touched lint, and `git diff --check` pass.

## Domain behavior

- New normal projects and repository imports seed `Draft`, `Todo`, `In progress`; Draft carries its semantic flag. Existing matched repository projects are repaired only with edit access.
- `tasks:createTask`, connector `create_issue`, and `feedback:convert` omit `columnId` to request Draft. A valid explicit lane is retained. Invalid, deleted, and cross-project IDs reject; they never trigger a silent fallback. Existing assignee, due-date, completion, and access requirements remain enforced.
- A flagged Draft can be renamed and keeps its identity. Explicit `isDraft:false` wins over its display title. Additional existing Drafts stay private; repair does not merge columns or move their tasks.
- When no semantic Draft exists, the earliest legacy unflagged Idea is adopted in place. If no eligible Idea exists, repair creates an empty Draft. Existing semantic Draft always wins. Candidate ties follow order, creation time, then ID.
- Existing imported GitHub/legacy tasks retain their explicit source-status mapping. This change does not apply new-task omission defaults to imported historical tasks. The legacy completed-task-to-Todo mapping retains its completion flag.
- There is no public column-reordering mutation in the inspected backend. Create, rename, delete, initial creation, imports, board/details ordering, and the existing-project repair are covered. Existing column-count and last-column protections remain; this change adds no blanket Draft-deletion prohibition.

## Required three-phase repair

These are separate internal phases after the existing five storage migrations; Draft is not a sixth storage table. No operator executor is included or invoked here. The source-bound descriptors leave `releaseSource:null` until the integration owner freezes and verifies the actual release source.

| Order | Internal mutation | Maximum scanned per page | Actual changes |
| --- | --- | --- | --- |
| 1 | `tasks:flagDraftColumns` | 100 columns | Persist every existing semantic Draft flag and clear contradictory Done flags. |
| 2 | `tasks:selectLegacyDraftCandidates` | 100 columns | Record the lowest board-order unflagged Idea per project only if no semantic Draft exists. `candidateUpdated` counts these metadata writes; `adopted` stays 0. |
| 3 | `tasks:repairProjectDrafts` | 25 projects | Keep the existing Draft, adopt the validated candidate, or create an empty Draft; pin it first and clear candidate metadata. `adopted` and `created` count their actual distinct operations. |

Every call accepts only `{cursor:null|string}` and returns `{phase,scanned,changed,created,candidateUpdated,adopted,cursor,isDone}`. Complete every page of phase 1 before phase 2, then every page of phase 2 before phase 3. A future reviewed executor must enforce a finite page budget, exact source binding, receipt bounds, cursor advancement, completion order, and unknown-outcome reconciliation.

The fixtures cover 28 projects, column and project pagination, 205 out-of-insertion-order columns, an equal-order Idea tie, and stale/wrong-project/renamed/explicit-false/deleted candidates. All existing task and link documents compare equal before and after; a second complete sweep changes nothing. Physical indexed Draft-first ordering is checked independently of display sorting.

Before this ordered repair is complete, a large legacy board whose Draft status cannot be resolved within the bounded prefix rejects runtime repair. Legacy Idea publishing context rejects explicitly and new mirror candidates are held. An already flagged deep Draft is found through the new index; after phase 1 a deep formerly unflagged Draft is found too, and an ordinary Idea remains active. This transitional hold is intentional and is not a production completion claim.

## Verification boundary

All new backend checks use disposable `convex-test` fixtures and synthetic accounts/repositories. No local or hosted Convex deployment was invoked, no generated API file was manually edited, and ports 3210/5199/8799 were untouched. No `control:omb` server fixture or app screenshot is claimed for this backend-only work. The integration owner must perform the coordinated isolated client/server checks, deploy the reviewed schema/code, complete the ordered repair, and record actual receipts before declaring release acceptance.
