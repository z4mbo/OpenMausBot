# Origin backend access and lifecycle audit

The audit used the `Origin-bugfix` worktree and disposable `convex-test` databases. It did not send mutations to the user's Convex process, production deployment, running app, or real GitHub account. These results prove the exercised Convex handlers and signed HTTP action in the test runtime; they do not prove deployed schema acceptance, real GitHub permissions, audio, Electron packaging, or a human review of a real pull request.

## Verified fixes

| Severity | Real scenario and affected source | Fix and regression evidence | Commit |
| --- | --- | --- | --- |
| P1 | An account with 502 sessions changes its password or signs out other devices. `auth.ts` deleted only the first 500 rows, leaving newer stolen sessions authenticated. | Optional user/session generations invalidate every old session atomically while preserving the caller. Both 502-session regressions failed before the fix; current/new sessions and a second revocation work. `backend/convex/authSessions.test.ts`. | `fe66847e6` |
| P1 | `github.createIssueForTask` accepts a Draft issue and exposes its title/body in a GitHub creation URL; with the legacy token configured it can publish the issue. Legacy repository snapshots also completed a parked Draft after remote closure. | The legacy action refuses Draft before producing a URL or calling GitHub. Snapshots preserve Draft state, and subsequent completion policy requires trusted merge evidence outside Draft. Both Draft regressions failed before the fixes. `backend/convex/draftColumn.test.ts`. | `5ad6039bb`, `ed09492b2` |
| P2 | A project email invitation activates a project member but never creates the required workspace membership. An outsider successfully accepts and then cannot open the project; an invitation for a deleted project was still consumed. | Acceptance validates project/workspace/account, adds only minimum workspace access, preserves an existing workspace role, returns the workspace ID, and cannot grant workspace admin through a project admin invite. Two regressions failed before the fix; existing viewers remain read-only. `backend/convex/projectInvites.test.ts`. | `0540f3997` |
| P1 | Two agents and a project icon reference the same stored image. Replacing one agent's avatar deletes the underlying blob, breaking all other references. | Avatar replacement removes its reference without eagerly deleting the shared blob. The storage reference regression failed before the fix. `backend/convex/storageReferences.test.ts`. | `6adbde17b` |
| P1 | An old-repository GitHub fetch remains pending while the project switches repositories. The old issue/PR snapshot or commit list is then written into the replacement project repository. Commit sync also wrote after sign-out. | Internal writes reauthenticate and compare the original repository atomically. Issue linkage refuses repository drift and an existing different issue. Three race regressions failed before the fix; two unchanged-repository success paths also pass. `backend/convex/githubRaces.test.ts`. | `385b65d58` |
| P1 | An unmirrored Todo or Draft issue in a repository project can be marked done through `tasks.updateTask` or the connector. A task can also be created completed in an existing system Done column, or hidden there by moving/deleting a column. | Repository issues require a matching merged task PR or a trusted merge receipt. New issues cannot start completed in repository projects; open issues cannot be moved into system Done by either route. Local-only complete/reopen remains supported. Four regressions failed before the fix. `backend/convex/issueCompletion.test.ts`, `backend/convex/projectWorkflow.test.ts`. | `ac2f33152` |
| P1 | Closing a GitHub issue manually completes Origin through `integrations.linkIssue` or legacy `github.upsertRepoSnapshot`, without a reviewed/approved merge. | Ordinary issue sync mirrors remote state without claiming completion. The signed server bridge has a separate repository-pinned merge receipt operation, with linkage validation, Draft refusal, idempotent counters, and a single completion event. Both manual-closure regressions failed before the fix. `backend/convex/mergeCompletion.test.ts`. | `ed09492b2` |

## Merge receipt contract

`integrations.completeMergedIssue` is an **internal mutation**, reachable through the existing signed `/integrations` HTTP action with operation `completeMergedIssue`:

```ts
{
  projectId,
  taskId,
  repoUrl,
  issueNumber,
  pullRequest: { number, headSha, mergeSha, mergedAt }
}
```

It returns `true` for a completed issue or its idempotent retry. A valid receipt for an issue that GitHub still reports open is persisted and returns `false`; the later closed observation completes it. Draft returns `false` without saving a new receipt. It requires an active authorized current repository; the exact task/project/issue number and URL; positive integer issue/PR numbers; 40- or 64-character hexadecimal SHAs; and a finite positive merge time no later than one minute in the future. The receipt is stored on `tasks.completionPullRequest` with its repository and issue number. Public task/connector mutation validators do not accept that field. Direct completion cannot use a pending receipt before GitHub reports closed. External or explicit reopening clears the issue-mode receipt. Explicit reopening or leaving Draft sets `githubIssueReopenRequested`, which clears on an observed open issue; a manually closed issue has no reopen intent.

The signed server is responsible for obtaining this evidence after a head-pinned confirmed GitHub merge and authoritative closing-issue lookup. The backend does not infer a Chief review or human approval merely from an issue being closed. Existing `taskPRs` reconciliation remains a separate trusted snapshot path and rejects repository drift. A stale merge from another repository cannot authorize a later direct completion.

## Access matrix evidence

`backend/convex/accessMatrix.test.ts` exercises 120 explicit denial cases through real registered handlers:

- 25 private-project read paths each with an outsider, a same-workspace member lacking project membership, and an invalid session.
- 19 cross-project row substitution attempts, including task IDs, columns, credentials, design tokens/assets, documents, feedback, milestones, and relationships.
- 10 viewer escalation attempts through a stronger project membership.
- 16 workspace enumeration/connector ownership denials.

The tests also assert that private task details, ciphertext, document contents, and the legitimate connector remain unchanged after denied requests. Existing suites cover shared thread visibility, sender ownership, run revocation, queue promotion, mentions, notifications, Draft behavior, project access removal, PR delivery ordering, and repository-scoped webhook targeting.

## Registered function source inventory

All 32 function namespaces were inspected for their authentication helper, resource lookup, row ownership checks, internal/public registration, lifecycle writes, and bounded-query patterns. The final source inventory is 233 query/mutation/action registrations: 192 public and 41 internal, plus HTTP actions. The inventory is source inspection; the matrix above is the narrower runtime evidence.

| File in `backend/convex/` | Registered entrypoints | Access or lifecycle boundary inspected |
| --- | --- | --- |
| `agentRuns.ts` | begin, heartbeat, appendMessage, patchMessage, finish, cancel, pendingForMe; internal expireStale, promoteQueued | Writable thread, sender/run ownership, lease revocation and promotion. |
| `agents.ts` | teamSettings, setSharedAgents, listForTeam, get, publishProjectTeam, update, avatarUploadUrl, setAvatar, archive, publishHost | Workspace/project visibility, viewer ceiling, creator/admin editing, shared flag, image replacement. |
| `agentThreads.ts` | list, create, rename, archive, messagesSince, markRead | Private threads, creator/editor rights, per-user read markers. |
| `auth.ts` | me, generateAvatarUploadUrl, updateProfile, signupMode, login, signup, revokeOtherSessions, logout, changePassword, acceptInvite; internal loginAccount, signupAccount, reserveAuthAttempt, acceptInviteAccount | Password/session boundaries, public DTO, account status, invitation scope, session revocation. |
| `chat.ts` | listMessages, sendMessage, listVoiceParticipants, joinVoice, updateVoicePresence, leaveVoice, sendVoiceSignal, listVoiceSignals, ackVoiceSignals | Legacy unscoped communication is confined to the configured legacy owner; recipient-specific acknowledgement. |
| `commits.ts` | list, addManual, remove, syncGitHub; internal upsertMany | Project membership/editor checks, row binding, session/repository recheck after fetch. |
| `connectors.ts` | createGrant, verify, listGrants, revoke, read, write | Hashed token, expiry/revocation, current workspace/project roles, personal grant ownership, replay receipts; host/run tokens refused. |
| `credentials.ts` | list, create, update, remove | Project visibility, editor ceiling, credential/project binding; ciphertext is stored separately from editable metadata. |
| `design.ts` | list, generateUploadUrl, createToken, updateToken, removeToken, createAsset, updateAsset, removeAsset | Project visibility/editor checks, token/asset row binding and authorized storage admission. |
| `documents.ts` | list, get, create, open, applyUpdate, rename; internal backfill | Page-derived project access, workspace binding, editor checks, bounded Yjs updates. |
| `feedback.ts` | portals, configure, publicPortal, list, dismiss, convert; internal submit | Public slug read, signed rate-limited submission, project visibility, editor/admin mutation and conversion column binding. |
| `github.ts` | listPullRequests, syncRepo, createIssueForTask; internal linkTaskIssue, upsertRepoSnapshot | Legacy token restriction, Draft privacy, repository drift, current session and row linkage, manual closure policy. |
| `inbox.ts` | list, activity, calendar; internal backfill | Workspace check, per-project filtering, assignee/date bounds and pagination. |
| `integrations.ts` | status, configure, approveRepository, retryRepo; internal context, repoResult, linkIssue, completeMergedIssue, targets, webhookTargets, unlinkedTasks, pending, backfillIssueLinks, kick | Workspace admin credential approval, signed worker boundary, repository/issue links, merge receipts, Draft exclusion and cursors. |
| `issueRelations.ts` | list, labels, connect, disconnect | Both projects authorized for creation, same workspace, filtered visibility, graph size/cycle limits, source editor for deletion. |
| `legacyImport.ts` | internal prepareWorkspace, importProject | Operator-configured destination owner/workspace, source-key retries, cross-workspace conflicts, additive import limits. |
| `memberProfiles.ts` | get, issues | Workspace member lookup and per-project filtering of assignee results. |
| `members.ts` | list, people, addWorkspaceMember, getInvite, invite, sendInvite, updateRole, remove | Project/admin checks, row/project binding, owner protection, invitation token redaction. |
| `meta.ts` | capabilities | Intentionally public protocol/feature names only. |
| `notifications.ts` | summary, list, markRead, snooze, markAll, agentThreadMentions; internal wake, readMore, chatMentions | Recipient-owned rows, current project/thread visibility, mention author checks, bounded batching and snooze deadline. |
| `planning.ts` | milestones, saveMilestone, assignMilestone, removeMilestone, releases, saveRelease, removeRelease | Workspace/editor checks, project visibility, milestone/task/release links and bounded release issue lists. |
| `preferences.ts` | notifications, saveNotifications | User/workspace-owned preferences, workspace-scoped muted project IDs, quiet-hour/timezone validation. |
| `projectPresence.ts` | update, list; internal cleanup | User/client sequence, project visibility of both viewer and subject, bounded TTL cleanup. |
| `projects.ts` | listForUser, get, stats, listChatMessages, sendChatMessage, listCallParticipants, joinCall, updateCallPresence, leaveCall, sendCallSignal, listCallSignals, ackCallSignals, generateIconUploadUrl, create, reorder, importRepos, update, remove | Current project membership, viewer ceiling, row scoping, per-recipient call signals, repository credential reset. |
| `taskPRs.ts` | configure, columns, list; internal humanContext, finalize, targets, eventTargets, backfillRepositories, beginSync, sync, delivery, cleanup | Session/editor checks, repository/branch/task linkage, one lifecycle driver, ordered trusted snapshots, HMAC adapter boundary. |
| `storage.ts` | internal beginUpload, completeUpload, expireUploads, migrateReferences; HTTP upload, uploadOptions | One-use scoped admission, session/role rechecks, bounded bytes/MIME, rejected-blob cleanup and four paginated legacy-reference migrations. |
| `tasks.ts` | board, inbox, assignedToMe, details, createColumn, ensureDefaultColumns, updateColumn, deleteColumn, createTask, updateTask, moveTask, addComment, checkCommentItem, addAsset, deleteTask, authorizeLocalFile | Project/editor checks, row IDs, valid assignees, completion proof, Draft/Done columns, references/mentions, local attachment authorization. |
| `teams.ts` | leave, listWithProjects, create, remove, members, invite, sendInvite, updateRole, removeMember | Current workspace membership, owner protection, project/grant removal, visible project discovery. |
| `wiki.ts` | list, create, update, remove | Project/editor and page/project binding, content/tag/Yjs size limits. |
| `workspaces.ts` | list, create, ensureLegacyWorkspace, access, members, update, createInvite, invitePreview, acceptInvite, invitations, revokeInvite, sendEmailInvite | Session/workspace/admin checks, project invite ceiling, expiry/email/revocation and scoped acceptance. |
| `workspaceSearch.ts` | issues, documents | Workspace-first and per-project visibility, search/pagination bounds. |

The associated schema, feature/agent tables, `lib/auth.ts`, `lib/permissions.ts`, `lib/agentAccess.ts`, `lib/agentThreadRows.ts`, `lib/completions.ts`, `lib/features.ts`, `lib/columns.ts`, repository helpers, HTTP HMAC dispatcher, and cron targets were also inspected. Server card ownership was traced through `server/origin-thread-mirror.ts`, `server/routes/bot-messages.ts`, and `server/index.ts`'s `cardAnswerRefusal`/`answeringCardAs`; remote mirrored cards have non-actionable `remote:` IDs. This pass did not replace the separate hosted-workspace trust or real multi-window fixture.

## Checks and remaining limits

The final backend suite, `npm.cmd exec vitest -- run` from `backend/`, passed **17 files / 132 tests**, including all 15 storage-admission regressions. Backend TypeScript passed. New bug regressions were observed failing against the preceding implementation before their fixes. No production deployment or data was needed to obtain this evidence.

- **Storage admission is fixed in `f3a8fbb44`.** A removed member cannot rebind a remembered private blob in another project. All five upload/reference paths enforce persistent scopes; an independent security reviewer found no additional exploit in the bounded review. [Storage admission](origin-storage-admission.md) records rollout, migration, bearer-URL and bounded-source-lookup limits.
- Legacy functions still contain **71 registrations without an explicit return validator**. Their argument validators and relevant access checks were inspected, but this pass did not replace all legacy response contracts.
- Several legacy project-sized reads/deletes still use unbounded `.collect()` (`tasks.board/details/assignedToMe`, credential/design/commit lists, and large deletion paths). The test fixture does not qualify production-sized resource limits or capacity. Proper pagination and batched deletion need UI/API contracts, not silent truncation.
- At this audit checkpoint, the legacy GitHub issue-creation action lacked the main server's durable unknown-outcome reconciliation. Its row guard stopped overwriting an existing different linkage, but could not undo an external duplicate already created by concurrent legacy calls. The [unpublished follow-up](#unpublished-legacy-issue-creation-follow-up) below records the separate retirement of that automatic writer. No real GitHub mutation was performed here.
- Signed merge receipt transport and backend validation are tested in-memory. Live Chief review, human approval, GitHub App repository permissions, and webhook/reconciliation acceptance remain separate server/workflow evidence.

## Unpublished legacy issue-creation follow-up

This follow-up starts from report commit `37a3b2c450e8a47e489284d6abaa232078541cad`, a documentation-only descendant of the published 0.2.10 source. It has not been released or deployed. An isolated worker used disposable `convex-test` databases and a fake GitHub `fetch`; no live GitHub request, Convex request, credential, or user data was used.

The conditional P2 defect was in the public `github.createIssueForTask` action (`backend/convex/github.ts:173` at the baseline): it could still publish with the legacy server token when both `ORIGIN_LEGACY_OWNER_EMAIL` and `GITHUB_TOKEN` were configured and the current actor and project owner matched that legacy email. No current renderer/server caller was found, but the registered public action remained available to older clients. With a non-Draft task already linked to issue #7, its POST at baseline line 212 first created #101, then `linkTaskIssue` rejected its attempt to replace #7. Two concurrent calls for an unlinked task created #101 and #102; one linked successfully and the other rejected, leaving an external duplicate. Both scenarios were observed through the actual registered action with synthetic credentials and fake responses before the fix.

The action now preserves its arguments and four-field result envelope while retiring automatic server-token issue creation. Authorized editors receive an existing link for a linked task, or the existing prefilled manual GitHub URL and an instruction to use Origin's connected repository integration. Invalid sessions, cross-project task IDs, viewers, and Draft tasks retain their denials. The legacy read/snapshot functions and their environment configuration remain intact. Automatic creation in `server/github/sync.ts`, including its scoped host context, durable intent and unknown-outcome reconciliation, is unchanged. Older clients that depended on this legacy automatic action must use the connected repository integration or explicitly open the manual URL; this patch does not add a second creation/reconciliation protocol.

The exact final nine-case `backend/convex/legacyIssueCreation.test.ts` suite produced **2 failures / 7 passes before**, then **9 passes after** the source change. It verifies linked and concurrent calls make no external POST, manual URL contents, ordinary editor access, invalid sessions, cross-project IDs, viewer denial, Draft privacy and invalid repository behavior. The complete backend suite passed **20 files / 184 tests**. Backend TypeScript and the repository's `oxlint --deny-warnings` on both touched Convex files passed. This is handler-level synthetic evidence; real GitHub permissions, deployed backend behavior and old-client interactive acceptance were not exercised.

