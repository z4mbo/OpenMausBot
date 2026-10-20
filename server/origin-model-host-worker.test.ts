import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostedWorker } from "./origin-model-host-worker.ts";
import type { ModelHostAccountState } from "./origin-model-host-state.ts";
import type { HostedPort, HostedTurnInput, HostedTurnOutcome, HostedWork } from "./origin-model-host-types.ts";

const sourceKey = "11111111-1111-4111-8111-111111111111";
const work = (): HostedWork => ({ executionId: "execution1", runId: "run1", threadId: "thread1", agentId: "agent1", teamId: "team1", sourceId: "source1", sourceKey,
  provider: "claudeAgent", model: "claude-fixture", requesterUserId: "requester1", requesterName: "Requester", requestClientId: "send:request1", requestSeq: 2,
  text: "Research this scoped project", definitionVersion: 1, definitionHash: "fixture", definition: { name: "Researcher", title: "Researcher", description: "", soul: "Research", color: "blue" },
  status: "pending", billing: "subscription", allowMetered: false });
const account = (): ModelHostAccountState => ({ origin: "https://fixture.invalid", userId: "owner1", teamId: "team1", hostId: "host1", hostToken: "a".repeat(64),
  sources: { [sourceKey]: { sourceKey, sourceId: "source1", instanceId: "owner-claude", provider: "claudeAgent", label: "Owner Claude", billing: "subscription", models: ["claude-fixture"], enabled: true, projectIds: [], workspaceHead: true, capacity: 1 } } });
const quota = { kind: "quota_exhausted", scope: "account", retry: "safe_initial_refusal" } as const;

function fixture(options: {
  run?: (input: HostedTurnInput) => Promise<HostedTurnOutcome>;
  mutate?: (name: string, args: Record<string, unknown>) => unknown;
  inspect?: () => Promise<{ botId: string; instanceId: string; cwd: string }>;
  current?: () => boolean;
} = {}) {
  const mutation = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const custom = options.mutate?.(name, args);
    if (custom !== undefined) return custom;
    if (name === "modelHosts:claim") return { work: { ...work(), status: "claimed" }, leaseUntil: Date.now() + 60_000 };
    if (name === "modelHosts:context") return { requestSeq: 2, nextSeq: 1, more: false, messages: [{ seq: 1, role: "user", kind: "text", text: "Canonical project history", status: "final", createdAt: 1 }] };
    if (name === "modelHosts:heartbeatExecution") return { leaseUntil: Date.now() + 60_000 };
    return null;
  });
  const port: HostedPort = { mutation, query: vi.fn() };
  const run = vi.fn(options.run ?? (async input => { await input.beforeDispatch(); return { ok: true }; }));
  const worker = createHostedWorker({ account: account(), port, current: options.current ?? (() => true), run,
    inspect: options.inspect ?? (async () => ({ botId: "local-agent", instanceId: "owner-claude", cwd: "C:\\fixture-project" })) });
  return { worker, run, mutation, calls: (name: string) => mutation.mock.calls.filter(([called]) => called === name) };
}

afterEach(() => vi.useRealTimers());

describe("native model host claim fencing", () => {
  it("runs the owner's local binding once with canonical history and host-only secrets", async () => {
    const f = fixture({ run: async input => {
      expect(input.instanceId).toBe("owner-claude"); expect(input.botId).toBe("local-agent");
      expect(input.context[0]?.text).toBe("Canonical project history"); expect(input.work.requesterUserId).toBe("requester1");
      await input.beforeDispatch(); input.activity(); input.emit({ clientId: "m:reply", role: "bot", kind: "text", text: "Research result" }, false);
      return { ok: true };
    } });
    f.worker.offer(work()); f.worker.offer(work()); await f.worker.drain();
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.calls("modelHosts:claim")).toHaveLength(1);
    expect(f.calls("modelHosts:started")).toHaveLength(1);
    expect(f.calls("modelHosts:finish")[0]?.[1]).toMatchObject({ outcome: "succeeded" });
    expect(f.calls("modelHosts:appendReply")[0]?.[1]).toMatchObject({ text: "Research result", clientId: "host:execution1:m:reply" });
    for (const [, args] of f.mutation.mock.calls) {
      expect(args).not.toHaveProperty("sessionToken"); expect(args).not.toHaveProperty("apiKey"); expect(args).toMatchObject({ hostId: "host1", hostToken: "a".repeat(64) });
    }
    expect(f.calls("modelHosts:claim")[0]?.[1].leaseToken).toMatch(/^[a-f0-9]{64}$/);
    expect(f.worker.activeCount()).toBe(0);
  });

  it("allows a typed quiesced initial refusal to advance without publishing a fake result", async () => {
    const f = fixture({ run: async input => { await input.beforeDispatch(); return { ok: false, refusal: quota }; } });
    f.worker.offer(work()); await f.worker.drain();
    expect(f.calls("modelHosts:appendReply")).toHaveLength(0);
    expect(f.calls("modelHosts:finish")[0]?.[1]).toMatchObject({ outcome: "quota_exhausted", safeInitialRefusal: true, quiesced: true });
  });

  it.each(["activity", "reply"])('refuses safe replay after any %s even if a driver incorrectly labels quota as initial', async observed => {
    const f = fixture({ run: async input => {
      await input.beforeDispatch();
      if (observed === "activity") input.activity(); else input.emit({ clientId: "m:partial", role: "bot", kind: "text", text: "Partial result" }, false);
      return { ok: false, refusal: quota };
    } });
    f.worker.offer(work()); await f.worker.drain();
    expect(f.calls("modelHosts:finish")[0]?.[1]).toMatchObject({ outcome: "failed" });
    expect(f.calls("modelHosts:finish")[0]?.[1]).not.toHaveProperty("safeInitialRefusal");
  });

  it("never retries a claim whose acknowledgement was lost", async () => {
    const f = fixture({ mutate: name => { if (name === "modelHosts:claim") throw new Error("The server accepted this claim but its response was lost"); } });
    f.worker.offer(work()); await f.worker.drain(); f.worker.offer(work()); await f.worker.drain();
    expect(f.calls("modelHosts:claim")).toHaveLength(1); expect(f.run).not.toHaveBeenCalled(); expect(f.calls("modelHosts:finish")).toHaveLength(0);
  });

  it("declines before acceptance when the local folder, model, cap or agent binding is not ready", async () => {
    const f = fixture({ inspect: async () => { throw new Error("Daily cap denied the owner account"); } });
    f.worker.offer(work()); await f.worker.drain();
    expect(f.calls("modelHosts:decline")[0]?.[1]).toMatchObject({ reason: "configuration" });
    expect(f.calls("modelHosts:claim")).toHaveLength(0); expect(f.run).not.toHaveBeenCalled();
  });

  it("does not dispatch a replaced account after it claims the request", async () => {
    let current = true;
    const f = fixture({ current: () => current, run: async input => { current = false; await input.beforeDispatch(); return { ok: true }; } });
    f.worker.offer(work()); await f.worker.drain();
    expect(f.calls("modelHosts:started")).toHaveLength(0); expect(f.calls("modelHosts:finish")).toHaveLength(0);
  });

  it("does not dispatch context containing a future queued request", async () => {
    const f = fixture({ mutate: name => name === "modelHosts:context" ? { requestSeq: 2, nextSeq: 3, more: false, messages: [{ seq: 3 }] } : undefined });
    f.worker.offer(work()); await f.worker.drain();
    expect(f.run).not.toHaveBeenCalled(); expect(f.calls("modelHosts:finish")[0]?.[1]).toMatchObject({ outcome: "failed" });
  });

  it("does not turn a rejected result write into a successful completion", async () => {
    const f = fixture({ mutate: name => { if (name === "modelHosts:appendReply") throw new Error("Lease revoked"); },
      run: async input => { await input.beforeDispatch(); input.emit({ clientId: "m:reply", role: "bot", kind: "text", text: "Result" }, false); return { ok: true }; } });
    f.worker.offer(work()); await f.worker.drain();
    expect(f.calls("modelHosts:finish")).toHaveLength(0);
  });

  it("interrupts accepted work when the lease cannot be renewed", async () => {
    vi.useFakeTimers();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({ mutate: name => { if (name === "modelHosts:heartbeatExecution") throw new Error("Membership revoked"); },
      run: async input => { await input.beforeDispatch(); entered(); await new Promise<void>(resolve => input.signal.addEventListener("abort", () => resolve(), { once: true })); return { ok: false }; } });
    f.worker.offer(work()); await ready; await vi.advanceTimersByTimeAsync(10_000); await f.worker.drain();
    expect(f.calls("modelHosts:heartbeatExecution")).toHaveLength(1); expect(f.calls("modelHosts:finish")).toHaveLength(0);
    f.worker.offer(work()); expect(f.run).toHaveBeenCalledTimes(1);
  });
});
