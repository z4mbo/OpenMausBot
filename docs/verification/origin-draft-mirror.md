# Legacy Idea privacy during Draft repair

The Issues page starts automatic mirroring and board repair in separate effects.
On an old board with unflagged Idea and Todo columns, the backend adopts Idea
as Draft in place. Before that repair completes, the previous mirror effect
considers Idea ordinary and queues its unlinked tasks for GitHub.

The client now holds the first unflagged legacy Idea only while no semantic
Draft exists. This matches the backend's adoption rule. Todo still mirrors;
Idea remains ordinary when a semantic Draft already exists or when Idea is
explicitly flagged `isDraft: false`. No task is moved or deleted. The backend
also needs its corresponding integration/query guard because older clients
and background mirroring do not use this client effect.

The exact regression test `src/components/origin-pages/issue-draft-mirror.test.ts` has SHA-256
`f531ba7ee3f3f83a8610d04dd658bc5c1ca9fb154cad6cd3a84dac361ba4786b`.
Against commit `6d31c2e5278042d0bf3ef25fe3f1fb501ba9822d`, it reports
one failure and two passes. The same bytes pass all three after the guard.
The related composer, issue editor and repository tests pass 18 cases.

```powershell
node --experimental-strip-types scripts/verify-origin-draft.ts --privacy
```

The launcher prints separate frozen before/after URLs. Open each with
`?screen=issues&columns=legacy&theme=dark`. Synthetic cloud repair adopts Idea
in place; a recording GitHub facade captures mirror requests without sending
them. [Eight browser cases](evidence/origin-draft-mirror-031/report.json) cover
before/after, 375/1280 px, and light/dark. Before repair the old source queues
both tasks; the fixed source queues Todo only. Both settle to the same repaired
board, so the screenshots intentionally look the same. There are no page errors,
external requests or document overflow in these cases.

The [earlier Draft-default matrix](origin-draft-defaults.md) remains byte-for-byte
preserved. Its 32 screenshots describe that earlier verified source; this narrow
effect-only follow-up has its own source hashes, requests, tests and evidence.
The new fixture facade and optional `--privacy` mode do not alter product APIs.
No packaged application, production Convex, real GitHub issue or deployment
was used for this verification.
