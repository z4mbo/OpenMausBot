# Batch A: bounded native Convex acceptance

Source: 0745d6ef0317d42b498fecbbfdf5e5e3be6d41ce; real isolated API http://127.0.0.1:51527, root-owned HTTP51528. Both phases used the identical script SHA256 7628f6c95ab1506d58c6b4a3a8c53c9d9b3297efca0e5d9afcba4550573c773f. Node v24.21.0, Convex SDK 1.47.0.

**14 named scenario groups passed; zero failures.** These are groups of checks, not unique feature or bug counts. Both phases used two real ConvexClient WebSocket connections (2 opened/2 closed per phase); all calls/subscriptions used the native backend, with no convex-test or mocked server response.

- public-signup-login-and-invalid-password: PASS (initial).
- workspace-project-bound-invitation-and-scoped-denials: PASS (initial).
- two-native-websocket-clients: PASS (initial).
- reusable-invitation-revoke-and-existing-role-control: PASS (initial).
- draft-default-concurrent-persisted-fields: PASS (initial).
- shared-definition-thread-idempotency-private-read: PASS (initial).
- concurrent-senders-requester-idempotency-queue-handoff: PASS (initial).
- real-elapsed-lease-takeover: PASS (initial).
- same-sqlite-restart-public-persistence: PASS (resume).
- viewer-ceiling-live-update-and-denials: PASS (resume).
- project-removal-live-query-revocation-and-regrant: PASS (resume).
- workspace-removal-run-interruption-queue-promotion-rejoin: PASS (resume).
- session-revocation-and-password-change-live-updates: PASS (resume).
- logout-native-null-protected-denial-and-repeat: PASS (resume).

The initial phase proves public signup/login, wrong-password refusal, bound email invitation signup and explicit acceptance, wrong-recipient/pre-join/private-project read/write denials, consumed-link replay denial, unbound-link idempotency/revocation and preservation of existing active roles. Human task creation supplies an active assignee and valid UTC due date while omitting columnId; semantic Draft is first, task remains unmirrored, and simultaneous updates of distinct title/description fields both persist and arrive over native WS.

Shared-definition and thread creation are idempotent; private threads are hidden from the second member. Concurrent senders produce exactly one running and one queued run; another requester cannot reuse the user message clientId, append a fresh bot reply, heartbeat or finish the holder. Completion promotes the queued sender; both subscribers see the same four unique request/reply rows with requester attribution.

A fresh thread ran one real no-heartbeat wait of 65053 ms. A fresh second sender acquired the lease; the old holder could not revive via heartbeat, and its partial row became interrupted. Public begin or real cron supplied expiry; this run does not distinguish which. The intentional120s same-requester terminal bot-write grace is not claimed removed.

At the checkpoint both clients disconnected and the initial process exited0. Root alone verified/stopped nativePID36780, observed51527/51528 closed, and resumed the SAME SQLite/storage/source as PID28028/TTY57999 without code push/new environment. The separate restart confirmation is explicitly a root attestation. After root confirmation, the resumed public calls independently verify the same tokens/account IDs, same membership ID without duplicates, scoped project grant/denial, Draft task and both changed fields, exact transcript IDs/seq, completed run IDs and replay idempotency.

The resumed live subscriptions observe a workspace viewer ceiling over a stronger project role, write/send refusal, project removal errors without logging the account out, explicit regrant recovery, workspace removal and account survival. A removed active requester is interrupted on heartbeat; the queued authorized owner advances. Scoped rejoin creates one fresh membership and never resumes the old run. Same-account revokeOtherSessions/password change produce native auth:me=null for other sessions while the initiating session and different account remain valid. Old password is refused; new password works. Logout produces native null/protected-query refusal and is idempotent, while another new session stays valid.

The worker made no HTTP fetches; SDK action/mutation/query traffic used the two native WS clients. Its process-local network guard only permits51527, with zero blocked outside-target attempts. No email, GitHub, model/provider, admin or deployment-key function was called; projects explicitly use githubRepo:later. Root owns backend lifecycle and backend-side credential/environment isolation.

## Evidence and remaining boundary

- native-initial-proof.json preserves the pre-restart checkpoint byte-for-byte; native-api-proof.json contains all14 results. Logs expose only named groups, booleans/counts and timing. Exact synthetic IDs, email/password/session/invite values remain exclusively in ignored credentials-private.json, which MUST NOT be archived or copied into the report.
- Source/argument/expected-result ledger is read-only source mapping; its PLANNED labels remain historical rather than being rewritten as synthetic pass claims. Actual outcomes are exclusively in the native proofs.
- The earlier CI snapshot is a single read: postdocsCI39198107118 and backend/site39198106982 succeeded on0745 attempt1. It is separate from these native runtime outcomes.
- This closes only the named real-backend/public-protocol/WS/restart cases. Full-App Chief/local-bot sync, private renderer cache eviction, browser/native OS session stores, continuous partition/crash behavior, approval/real GitHub flow, external effects, hardware/email and all Batch A are not claimed complete.
- No product files were modified and no real defect was found in these named cases. No production or protected services were accessed.
