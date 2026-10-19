# Batch A native persisted acceptance ledger

Source: 0745d6ef0317d42b498fecbbfdf5e5e3be6d41ce; frozen release runtime: ab0cd72b4c2f004c1015adca034472241569c04b. Backend Git files are unchanged. All rows are PLANNED, not passing evidence. Root owns backend API51527 / HTTP51528 and the single same-SQLite restart.

## A01 — Public signup/login and same-account second session

- `action auth:signup {email,password,name,workspaceName?,slug?,inviteToken?}`
- `action auth:login {email,password}`
- `query auth:me {sessionToken}`
- `query auth:signupMode {}`

Open signup creates own workspace/session; invite signup validates token but creates no workspace or membership until acceptInvite. Wrong password rejects. Password10–128 chars. Public action path retains rate limits.

Source: backend/convex/auth.ts:115, backend/convex/auth.ts:155, backend/convex/auth.ts:165, backend/convex/lib/auth.ts:102. Existing simulated controls: backend/convex/pg1Parity.test.ts:40.

## A02 — Workspace/project construction and scope

- `mutation workspaces:create {sessionToken,name,slug?}`
- `query workspaces:list {sessionToken}`
- `mutation projects:create {sessionToken,teamId,name,githubRepo:"later"}`
- `query projects:get {sessionToken,projectId}`
- `query projects:listForUser {sessionToken,teamId?}`
- `query teams:listWithProjects {sessionToken}`

Creator is workspace/project owner. Non-member cannot read or write. Workspace member sees only explicitly assigned projects; workspace owner/admin intentionally sees all. Always githubRepo:later and no repoUrl to avoid scheduling repository creation.

Source: backend/convex/workspaces.ts:13, backend/convex/workspaces.ts:43, backend/convex/projects.ts:295, backend/convex/lib/permissions.ts:28, backend/convex/lib/permissions.ts:52. Existing simulated controls: backend/convex/accessMatrix.test.ts:53, backend/convex/accessMatrix.test.ts:87.

## A03 — Current bound workspace/project invite, public account flow, replay

- `mutation workspaces:createInvite {sessionToken,teamId,projectId?,email?,role:"member"|"viewer"|"admin"}`
- `query workspaces:invitePreview {token}`
- `action auth:signup {email,password,name,inviteToken}`
- `mutation workspaces:acceptInvite {sessionToken,token}`
- `query workspaces:access {sessionToken,teamId}`
- `query workspaces:members {sessionToken,teamId}`

Wrong email denies signup/accept; correct signup alone has no access, explicit accept persists membership. Bound invite is consumed/revoked; replay rejects. Project invite cannot grant workspace admin, keeps other projects private. Existing active membership retains its role. Tokens last7days; actual expiry is not accelerated in this native run.

Source: backend/convex/workspaces.ts:102, backend/convex/workspaces.ts:124, backend/convex/workspaces.ts:137, backend/convex/auth.ts:115. Existing simulated controls: backend/convex/pg1Parity.test.ts:40, backend/convex/pg1Parity.test.ts:93.

## A04 — Reusable unbound link and explicit revocation

- `mutation workspaces:createInvite {sessionToken,teamId,projectId?,role:"viewer"}`
- `mutation workspaces:acceptInvite {sessionToken,token}`
- `query workspaces:invitations {sessionToken,teamId}`
- `mutation workspaces:revokeInvite {sessionToken,inviteId}`
- `query workspaces:invitePreview {token}`

Unbound accept is repeatable without duplicate membership. Revoked preview becomes null and future accept rejects. Revoking a link does not remove already accepted members. Query invitations before consuming bound link to obtain inviteId.

Source: backend/convex/workspaces.ts:137, backend/convex/workspaces.ts:164, backend/convex/workspaces.ts:172. Existing simulated controls: backend/convex/pg1Parity.test.ts:93.

## A05 — Project grant, viewer ceiling, live role/removal

- `mutation members:addWorkspaceMember {sessionToken,projectId,email,role:"member"|"viewer"}`
- `mutation members:updateRole {sessionToken,projectId,memberId,role}`
- `mutation teams:updateRole {sessionToken,teamId,memberId,role}`
- `mutation members:remove {sessionToken,projectId,memberId}`
- `mutation teams:removeMember {sessionToken,teamId,memberId}`

IDs come from members:list/workspaces:members. Viewer workspace role caps stronger project roles. Membership removal denies project/workspace reads without invalidating the user account itself; auth:me remains valid. Workspace removal also deletes project memberships and revokes scoped connector grants. Owner removal/leave is refused.

Source: backend/convex/members.ts:31, backend/convex/members.ts:153, backend/convex/members.ts:170, backend/convex/teams.ts:10, backend/convex/teams.ts:178, backend/convex/teams.ts:191. Existing simulated controls: backend/convex/accessMatrix.test.ts:118, backend/convex/sharedAgents.test.ts:140.

## A06 — Actual WebSocket query invalidation

- `ConvexClient.onUpdate(functionRef,args,onResult,onError)`
- `queries auth:me / workspaces:list / projects:get / agentThreads:messagesSince / agentRuns:pendingForMe`

Two distinct SDK clients receive real native subscription callbacks after join, edit, downgrade/removal and session revocation. Permission loss may deliver query error, not an empty object; capture both callback kinds. A saved renderer value disappearing is an additional UI acceptance step. No setAuth JWT: Origin authenticates explicit opaque sessionToken args.

Source: node_modules/convex/dist/esm-types/browser/simple_client.d.ts:101, src/lib/origin-cloud/hooks.ts:131, backend/convex/lib/auth.ts:118. Existing simulated controls: backend/convex/authSessions.test.ts:27.

## A07 — Draft default and persisted concurrent field edits

- `query tasks:board {sessionToken,projectId}`
- `mutation tasks:createTask {sessionToken,projectId,title,priority:"low"|"medium"|"high",columnId?,description?}`
- `mutation tasks:updateTask {sessionToken,projectId,taskId,title?,description?,priority?,assignedToEmail?,dueDate?,done?}`

Omitted column chooses semantic Draft first; no GitHub mirror from Draft. Distinct field updates issued concurrently must both persist; same-field last-writer behavior must be reported rather than called conflict resolution. Viewer cannot write.

Source: backend/convex/tasks.ts:54, backend/convex/tasks.ts:249, backend/convex/tasks.ts:267, backend/convex/tasks.ts:368. Existing simulated controls: backend/convex/draftDefaults.test.ts:29, backend/convex/draftDefaults.test.ts:149.

## A08 — Shared agent/thread setup and visibility

- `mutation agents:setSharedAgents {sessionToken,teamId,enabled:true}`
- `mutation agents:publishProjectTeam {sessionToken,teamId,projectId,agents:[{roleKey:"chief",kind:"chief",name:"API039 Chief"}]}`
- `mutation agentThreads:create {sessionToken,agentId,title,clientId,private?}`
- `query agents:get {sessionToken,agentId}`
- `query agentThreads:list {sessionToken,agentId}`
- `query agentThreads:messagesSince {sessionToken,threadId,afterSeq:0,limit?}`

Owner enables feature; publication and creator/clientId thread creation are idempotent. Private thread readable only by creator. Viewer can read allowed public thread but cannot create/send. Minimal definition uses no provider/model and starts no engine.

Source: backend/convex/agents.ts:79, backend/convex/agents.ts:134, backend/convex/agentThreads.ts:42, backend/convex/lib/agentAccess.ts:61. Existing simulated controls: backend/convex/sharedAgents.test.ts:41, backend/convex/sharedAgents.test.ts:132.

## A09 — Sender queue, idempotency, message attribution and finish

- `mutation agentRuns:begin {sessionToken,threadId,clientId,text,engineLabel?}`
- `mutation agentRuns:appendMessage {sessionToken,threadId,runId,clientId,role:"bot",kind:"text",text,status:"streaming"|"final"}`
- `mutation agentRuns:patchMessage {sessionToken,threadId,clientId,text,status?}`
- `mutation agentRuns:finish {sessionToken,runId,status:"succeeded"|"failed"}`
- `query agentRuns:pendingForMe {sessionToken,teamId}`

Two senders yield one running/one queued. Same clientId replay has same run/message IDs; other sender cannot reuse/forge it or write its bot reply. Only requester finishes. Finishing holder promotes queued sender. Transcript author/run requester/sequence persist. No actual provider execution proved.

Source: backend/convex/agentRuns.ts:18, backend/convex/agentRuns.ts:79, backend/convex/agentRuns.ts:110, backend/convex/agentRuns.ts:136, backend/convex/agentRuns.ts:168. Existing simulated controls: backend/convex/sharedAgents.test.ts:83.

## A10 — Real elapsed lease takeover and authority downgrade

- `mutation agentRuns:heartbeat {sessionToken,runId,engineLabel?}`
- `mutation agentRuns:cancel {sessionToken,runId}`
- `fresh begin after >60000ms without holder heartbeat`

Use a fresh thread: A begins; stop A heartbeat; after >60s B begins a new clientId. Either real cron or begin settles stale A; B runs, A heartbeat reports interrupted and cannot revive it. Active-role downgrade/removal filters pending and settles on heartbeat. Same-requester bot-write grace is120s after terminal settlement; do not invent immediate rejection of all old bot rows. Expiry cron ticks every minute.

Source: backend/convex/lib/agentThreadRows.ts:9, backend/convex/agentRuns.ts:33, backend/convex/agentRuns.ts:57, backend/convex/agentRuns.ts:193, backend/convex/lib/agentAccess.ts:93, backend/convex/crons.ts:11. Existing simulated controls: backend/convex/sharedAgents.test.ts:114, backend/convex/sharedAgents.test.ts:140, backend/convex/sharedAgentQueue.test.ts:35.

## A11 — Session revocation/password/logout through live subscriptions

- `action auth:login {email,password}`
- `mutation auth:revokeOtherSessions {sessionToken}`
- `mutation auth:changePassword {sessionToken,currentPassword,newPassword}`
- `mutation auth:logout {sessionToken}`

A1/A2 must be sessions of the same synthetic account. Revoke/change-password retains initiating session, other auth:me subscription becomes null and protected queries error. New login after password change requires new password. Logout is idempotent and its auth:me becomes null.30-day expiry/beyond500sessions remain existing simulated controls unless independently exercised.

Source: backend/convex/auth.ts:174, backend/convex/auth.ts:184, backend/convex/auth.ts:193, backend/convex/lib/auth.ts:132. Existing simulated controls: backend/convex/authSessions.test.ts:27, backend/convex/pg1Parity.test.ts:66.

## A12 — Root-controlled same-SQLite backend restart

- `close client connections; root stops/restarts exact owned backend51527/51528 with same data directory; reconnect clients with saved synthetic tokens; query same public resources`

Before restart persist token privately and only sanitized expected IDs/counts publicly. Root exclusively controls restart. After explicit confirmation, same accounts/memberships/task fields/transcripts/terminal run IDs survive; no duplicate resources from reconnect/idempotent retry. Active-run crash recovery is a separate scenario if added.

Source: backend/convex/schema.ts:1, backend/convex/lib/auth.ts:118, backend/convex/agentThreads.ts:86. Existing simulated controls: No existing native restart proof.

## Boundaries

- Only the root-owned disposable backend/SQLite may be mutated; no existing3210/3211 or main5199/8799 service, production, external provider/GitHub or mail.
- Use synthetic api039-random accounts distinct from root browser accounts. Keep all session/invite tokens and passwords private; no raw action results in public logs.
- Current workspaceInvites flow differs from legacy members/teams inviteToken→auth:acceptInvite. Do not substitute internal mutations or seed fake users for public-flow proof.
- Local backend returns no valid public invitation site address under current policy; direct own-fixture join route is separately qualified and does not prove copied public-domain link behavior. Do not point local invites at production origin.
- projects:create must pass githubRepo:later; all mail/provider/GitHub/integration credential environment is absent. integrations:kick returns early without its configured secret+origin.
- projects:remove only soft-marks inactive; teams:remove rejects any retained project rows. This ledger does not claim physical project/workspace deletion.
- Actual backend API/WS results do not close full-App Chief sync, renderer private-cache eviction, installed GUI or all BatchA external/offline acceptance.

Post-documentation CI single snapshot: both39198107118 and39198106982 completed SUCCESS on exact0745; raw responses are in this folder. No additional polling planned.

A07 qualification: tasks:createTask human requests require assignedToEmail and valid dueDate despite optional validators; the native case supplies both and omits only columnId.
