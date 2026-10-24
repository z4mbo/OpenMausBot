# Shared agent conversations

Applies to workspace heads, project Chiefs and project agents bound through the
existing shared-agent workspace setting. The runner selection remains owned by
the existing agents/model-host routing; this change adds no picker or layout.

## Existing system and changes

At base `6c82f7b217356ce471195b29fc2cb02d08ba95a5`, project/workspace records,
team chat, agent definitions, shared thread rows and the shared-run queue already
lived in Convex. Each harness still owned its provider session and local SQLite
transcript. `6052f5907` added the selected-member runner path. The mirror already
supported bounded message changes and private-step placeholders, but only newly
sent empty conversations qualified for automatic binding, discovery stopped at
200 threads, change arrival order became local display order, and runtime text
deltas were absent from shared transcripts.

The harness now automatically binds and imports existing eligible conversations,
including empty/default and workspace-head threads. Import is idempotent,
creator-only, sanitized, batched, and never starts a turn. Newly created threads
are picked up by a debounced store listener. Each discovery page subscribes to a
stable creation index, so older threads beyond the first 200 remain reachable.

## Sync contract

- Convex `agentThreads`, `agentThreadMessages` and `workspaceAgentRuns` are the
  canonical shared transcript and execution queue. `seq` is immutable message
  order; `updSeq` advances on edits/streaming patches. Both own echoes and remote
  rows carry their cloud position into SQLite and the renderer. Arrival order,
  device clocks, and local parent chains do not change shared transcript order.
- A thread/client send ID identifies one user message and one run. A changed
  payload with the same ID is refused. Convex serializes a thread's turns; its
  existing runner policy selects the executor. An atomic heartbeat claim fences
  different current harness processes belonging to the same member. An expired
  claim cannot resurrect its turn. Requester and runner project access are
  checked before queued work is promoted and while it runs.
- Each writer owns its message patches. Convex transaction order resolves
  competing accepted patches and thread renames. Remote replicas only apply
  rows; they never dispatch engines. A runner waits for the pending turn's
  cloud sequence before consuming its local transcript.
- Runtime assistant deltas use one cloud row through final completion. Patches
  coalesce for 400 ms, including changes that arrive while an earlier patch is
  in flight. Unfinished credential-shaped tokens and sensitive preambles stay
  withheld until the completed row can be redacted. Reasoning is not mirrored.
  The model-host sidecar and worker also retain streaming/final status on that
  same row when a member lends a model account.
- Thread discovery pages contain at most 50 rows; message change pages at most
  20. Import batches contain at most 20 rows/128,000 serialized characters
  (the harness sends at most 10/100,000). Existing text/tool/payload caps remain.
  A reconnect resumes from durable change cursors and drains pages, rather than
  repeatedly loading full history. New shared sends fail closed while cloud
  admission or initial transcript catch-up cannot be confirmed.
- Harness SQLite retains the full local transcript, provider cursors and local
  files. The account/deployment-scoped outbox retains sanitized pending writes,
  queue receipts and cursors, without a session token. Convex holds the bounded,
  redacted shared representation and attribution. Sign-in/secret/screen steps
  become placeholders; mirrored cards retain no local approval authority.
  Backend membership and project checks apply to discovery and every transcript
  operation. Revocation blocks new reads/writes and does not fall back to a
  private local run of the shared conversation.

## Isolated verification

Read [README](README.md), [trust](shared-workspace-trust.md), and
[governance](shared-workspace-governance.md). No deployment is needed:

```powershell
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd test:backend
pnpm.cmd --filter @origin/backend typecheck
pnpm.cmd exec vitest run server/origin-chat-sync.test.ts server/origin-shared.test.ts server/origin-handoff-buffer.test.ts server/origin-hosted-admission-review.test.ts server/origin-hosted-transfer-review.test.ts server/origin-hosted-sender-activity-review.test.ts server/origin-model-host-sidecar.test.ts server/origin-model-host-worker.test.ts server/message-db.test.ts server/store.test.ts src/state/store.test.ts
node --experimental-strip-types scripts/verify-origin-shared-chats.ts
```

The last command launches two owned fake-engine harnesses on free ports in
27010–27080 and 27110–27180, with separate temporary homes/data, against one
in-memory `convex-test`. The fixture adapter supplies the Convex subscription
wire and maps test-only IDs to opaque wire IDs. It executes the real backend,
real `ConvexClient`, harness routes, mirror, queue and fake provider adapters.
It never uses a native Convex deployment, production data or a paid model.

The receipt in `.omb-scratch/shared-chats/report.json` records pre-binding
history arriving at B, streaming before completion, retry deduplication,
canonical order, B sending work to A's engine, transport disconnect/catch-up,
workspace-head discovery, project revocation, and cleanup. Engine counters
verify that retries do not execute again and a watching member does not run.
The retained [fixture receipt](evidence/origin-shared-chats/report.json) names
the exact isolated URLs and log files used for this verification.

Observed on Windows, 2026-10-24: root typecheck, lint and backend typecheck
passed; backend tests passed 351/351 in 46 files; the command above passed 463
tests in 11 files, with the existing POSIX file-mode case skipped on Windows.
The two-harness recipe passed all nine checks, including cleanup.

## Boundaries and remaining work

- Existing explicit private conversations, hosted executor sidecars, unbound
  personal agents and workspaces with shared agents disabled remain private.
  Thus this does not remove the product's privacy opt-outs to force literally
  every local conversation into cloud storage.
- Text/tool payload caps produce bounded shared previews. Attachment bytes,
  provider sessions, screens and local files are not uploaded or portable to
  another computer. This is not end-to-end encrypted storage.
- Shared archive/delete lifecycle and cloud retention are separate existing
  mechanisms; this work synchronizes transcript content and thread titles.
- A process crash after execution admission is interrupted, not automatically
  replayed. Arbitrary external tool side effects cannot have an exactly-once
  guarantee. Legacy clients without executor claims were not qualified for a
  mixed-version rollout; existing unscoped outbox files are retained rather
  than replayed under an unverified account identity.
- Access removal cannot erase material a member already received in a local
  cache. No production deployment, packaged Electron window, real cloud runner,
  real provider account, load test or multi-device installation was exercised.
