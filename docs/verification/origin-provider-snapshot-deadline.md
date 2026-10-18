# Bounded provider status reads

Origin's startup model selection and direct-turn preparation await provider
discovery. A live provider whose `snapshot()` never settles previously kept
`ProviderRegistry.describe()` pending, including the results for healthy
providers. Direct callers of `registry.get(id).snapshot()` could also wait
indefinitely.

The registry now bounds each created instance's status read to one minute,
before applying provider decorators. A timed-out read rejects with a plain
status message and `describe()` reports that engine as unavailable. Healthy
engines still appear in the completed result. The original instance, receiver
binding and dynamic model getters are preserved. Every completed read clears
its timer; a late result cannot replace the recorded timeout, and a subsequent
healthy read can recover.

This adopts the registry deadline portion of
[OpenMausBot PR #2970](https://github.com/milind-soni/OpenMausBot/pull/2970),
merged as `33283757891044233aabebc48575483174e50e12`. The separate process-kill
escalation change is deferred: its upstream regression requires a POSIX child
that traps SIGTERM, which this Windows run cannot faithfully prove.
`server/procs.ts` is unchanged. A snapshot deadline bounds the caller's wait;
it does not cancel or prove termination of the underlying CLI process.

## Reproduce

```sh
npx vitest run server/harness/snapshot-deadline.test.ts server/harness/registry.test.ts
```

The new `server/harness/snapshot-deadline.test.ts` cases use the actual
production registry with repository fake provider instances and a virtual
clock. They prove the never-settling sibling and direct-call cases, late
resolve/reject recovery, deadline cleanup after success/rejection/synchronous
failure, live getter and receiver preservation, and the snapshot captured by
a provider decorator. They do not mock the registry or manufacture an
available result for the timed-out provider.

## Retained results

The [report](evidence/origin-provider-snapshot-034/report.json) binds baseline
`ece107dd7b441115f2d4b334e286befac4ae6ec5` to fix
`223f796b61bea9c6852fedd6ebf6ecd3eda8cd6c`.

- Untouched production baseline: **5 failures and 4 passing controls** among
  the final 9 new tests. Assertions observe the still-pending real registry
  after advancing the clock by the promised minute.
- Fixed code: all 9 new tests pass. The related registry, managed desktop,
  cloud credit, hosted-model, quota-switch and guard selection totals
  **137 passing tests and 2 skipped tests across 9 files**.
- Server TypeScript, touched-file lint and `git diff --check` pass.
- A standard disposable launcher fixture separately passes Doctor, reports
  its fake engine as available, sends a synthetic user message, receives the
  fake engine's reply and settles. Its process exits and temporary home is
  removed. The [fixture record](evidence/origin-provider-snapshot-034/fixture.json)
  retains the exact time and cleanup evidence with temporary path prefixes
  redacted.

[Payload hashes](evidence/origin-provider-snapshot-034/payload-sha256.json)
cover the retained report and evidence. Terminal copies trim trailing blank
lines only; original private-log hashes are recorded separately.

The hanging-probe acceptance is a virtual-clock registry test. The healthy
server fixture is an independent integration smoke, not proof of a live
stuck process, a real provider account, packaged desktop behavior or
production acceptance.
