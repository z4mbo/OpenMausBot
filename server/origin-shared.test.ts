import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderSnapshot } from "./contracts.ts";
import { resolveSharedModel } from "./default-model-selection.ts";
import { openOutbox } from "./origin-outbox.ts";
import { createRunLease } from "./origin-run-lease.ts";
import { createSharedAgents, remoteBacklogExceedsCaps, sharedThreadMention } from "./origin-shared-agents.ts";
import { clientIdFor, createThreadMirror, fromCloudRow, ownRow, threadLinkFrom, toCloudRow, type CloudRow, type ThreadSnapshot } from "./origin-thread-mirror.ts";
import type { Message, StoreChange } from "./store.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const outboxAt = (now: () => number = Date.now) => {
  const folder = mkdtempSync(join(tmpdir(), "omb-outbox-"));
  folders.push(folder);
  return openOutbox(join(folder, "outbox.sqlite"), now);
};
const redact = (text: string) => text.replace(/sk-[a-z0-9]+/gi, "[redacted]");
const message = (fields: Partial<Message>): Message => ({ id: "m1", at: 1, role: "bot", kind: "text", ...fields });

describe("outbox", () => {
  it("sends in order, coalesces keyed patches and waits out the coalescing window", async () => {
    let clock = 1_000;
    const box = outboxAt(() => clock);
    box.enqueue("append", { clientId: "a", text: "H" });
    box.enqueue("patch", { clientId: "a", text: "He" }, { key: "patch:a", delayMs: 400 });
    box.enqueue("patch", { clientId: "a", status: "final" }, { key: "patch:a", delayMs: 400 });
    box.enqueue("finish", { runId: "r" });
    const sent: Array<[string, Record<string, unknown>]> = [];
    const send = async (name: string, args: Record<string, unknown>) => { sent.push([name, args]); };
    await box.flush(send);
    expect(sent).toEqual([["append", { clientId: "a", text: "H" }]]);
    clock += 400;
    await box.flush(send);
    expect(sent.slice(1)).toEqual([["patch", { clientId: "a", text: "He", status: "final" }], ["finish", { runId: "r" }]]);
    expect(box.pending()).toEqual([]);
    box.close();
  });

  it("keeps a write it could not send and drops one Origin keeps refusing", async () => {
    let clock = 0;
    const box = outboxAt(() => clock);
    box.enqueue("append", { n: 1 });
    await box.flush(async () => { throw new TypeError("fetch failed"); });
    expect(box.pending()).toHaveLength(1);
    const dropped = vi.fn();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      clock += 120_000;
      await box.flush(async () => { throw new Error("[Request ID: x] Server Error Uncaught Error: Only the run's requester"); }, dropped);
    }
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(box.pending()).toEqual([]);
    box.setCursor("t", 5);
    box.setCursor("t", 3);
    expect(box.cursor("t")).toBe(5);
    box.close();
  });
});

describe("thread rows", () => {
  it("keeps secrets, sign-ins and screens on this machine and redacts what leaves", () => {
    expect(toCloudRow(message({ kind: "secret" }), redact)).toEqual({ clientId: "m:m1", role: "bot", kind: "placeholder", text: "A private step" });
    expect(toCloudRow(message({ text: "key sk-abc123" }), redact)).toMatchObject({ kind: "text", text: "key [redacted]" });
    expect(toCloudRow(message({ kind: "activity", tool: { name: "Bash", ok: true, input: `echo sk-zzz ${"x".repeat(5_000)}` } }), redact)?.tool?.input).toMatch(/^echo \[redacted\] x+…$/);
    expect(toCloudRow(message({ remote: { cloudId: "c", name: "A" } }), redact)).toBeNull();
    expect(clientIdFor({ id: "m2", role: "user", sendId: "s1" })).toBe("send:s1");
  });

  it("shows other members' rows with attribution, as cards nobody here can answer", () => {
    const base: CloudRow = { _id: "c1", seq: 1, updSeq: 1, clientId: "send:x", role: "user", kind: "text", text: "Hi", authorUserId: "u1", authorName: "Ada", status: "final", createdAt: 5 };
    expect(fromCloudRow(base, { botId: "b", threadId: "t" })).toMatchObject({ role: "user", text: "Hi", sender: { name: "Ada", id: "origin:u1" }, remote: { cloudId: "c1", name: "Ada" } });
    const card = fromCloudRow({ ...base, _id: "c2", role: "bot", kind: "options", runBy: "Ada", payload: JSON.stringify({ title: "Run rm?", options: ["Allow", "Deny"] }) }, { botId: "b", threadId: "t" });
    expect(card?.card).toMatchObject({ title: "Run rm?", requestId: "remote:c2" });
    expect(fromCloudRow({ ...base, kind: "compaction" }, { botId: "b", threadId: "t" })).toBeNull();
    expect(ownRow({ clientId: "m:m1" }, [message({})])).toBe(true);
    expect(ownRow({ clientId: "m:zz" }, [message({})])).toBe(false);
  });

  it("describes who holds the thread from this member's side", () => {
    const snapshot = { activeRun: { runId: "r", requesterUserId: "u1", requesterName: "Ada", status: "running", engineLabel: "haiku" }, queued: [{ runId: "q", requesterUserId: "me", requesterName: "Me", status: "queued" }] };
    expect(threadLinkFrom("ct", snapshot, "me")).toEqual({ cloudThreadId: "ct", run: { by: "Ada", mine: false, model: "haiku" }, queued: 1, mineQueued: 1 });
  });
});

describe("thread mirror", () => {
  it("writes bot rows only for a run of mine and applies other members' rows once", () => {
    const listeners: Array<(change: StoreChange) => void> = [];
    const local: Message[] = [];
    const applied: unknown[] = [];
    const store = {
      onChange: (listener: (change: StoreChange) => void) => { listeners.push(listener); return () => undefined; },
      messagesFor: () => local,
      applyRemoteMessage: (_thread: string, row: unknown) => { applied.push(row); return message({}); },
      patchTask: vi.fn(),
      taskByThread: () => ({ threadId: "t" }),
      botByThread: () => ({ id: "b" }),
    };
    const enqueued: Array<[string, Record<string, unknown>]> = [];
    let run: string | undefined;
    let deliver: (value: unknown) => void = () => undefined;
    const mirror = createThreadMirror({
      store: store as never, outbox: { enqueue: (name, args) => { enqueued.push([name, args]); }, cursor: () => 0, setCursor: () => undefined },
      cloud: { mutation: async () => null, subscribe: (_name, _args, onUpdate) => { deliver = onUpdate; return () => undefined; } },
      threads: () => ({ t: "ct" }), runFor: () => run, me: () => "me", redact, kick: () => undefined,
    });
    mirror.sync();
    const emit = (change: StoreChange) => listeners.forEach((listener) => listener(change));
    emit({ type: "message", threadId: "t", message: message({ id: "x", text: "not mine" }) });
    expect(enqueued).toEqual([]);
    run = "r1";
    emit({ type: "message", threadId: "t", message: message({ id: "y", text: "reply" }) });
    emit({ type: "message.patch", threadId: "t", message: message({ id: "y", text: "reply, longer" }) });
    expect(enqueued.map(([name, args]) => [name, args.clientId, args.text])).toEqual([
      ["agentRuns:appendMessage", "m:y", "reply"], ["agentRuns:patchMessage", "m:y", "reply, longer"],
    ]);
    local.push(message({ id: "y" }));
    const snapshot: ThreadSnapshot = {
      seq: 2, title: "T", archived: false, more: false, activeRun: null, queued: [],
      messages: [
        { _id: "c1", seq: 1, updSeq: 1, clientId: "m:y", role: "bot", kind: "text", text: "reply", status: "final", createdAt: 1 },
        { _id: "c2", seq: 2, updSeq: 2, clientId: "m:other", role: "bot", kind: "text", text: "theirs", runBy: "Ada", status: "final", createdAt: 2 },
      ],
    };
    deliver(snapshot);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ text: "theirs", remote: { cloudId: "c2", name: "Ada" } });
  });
});

describe("run lease", () => {
  const leaseWith = (mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>, busy: { value: boolean }) => {
    const queued = new Map<string, Parameters<ReturnType<typeof openOutbox>["saveQueuedRun"]>[0]>();
    const enqueued: Array<[string, Record<string, unknown>]> = [];
    const started: string[] = [];
    const abandoned: string[] = [];
    const interrupt = vi.fn();
    let clock = 0;
    const lease = createRunLease({
      mutation,
      outbox: {
        enqueue: (name, args) => { enqueued.push([name, args]); },
        queuedRuns: () => [...queued.values()], saveQueuedRun: (run) => { queued.set(run.runId, run); }, dropQueuedRun: (id) => { queued.delete(id); },
      },
      kick: () => undefined, isBusy: () => busy.value, startQueued: async (run) => { started.push(run.runId); },
      interrupt, abandoned: (run) => { abandoned.push(run.runId); }, now: () => clock, monotonicNow: () => clock,
    });
    return { lease, enqueued, started, abandoned, interrupt, advance: (ms: number) => { clock += ms; } };
  };
  const input = { botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", text: "hi", clientId: "send:s" };

  it("finishes my run when the local turn goes from busy to idle", async () => {
    const busy = { value: false };
    const { lease, enqueued } = leaseWith(async () => ({ runId: "r1", status: "running", messageId: "m" }), busy);
    expect((await lease.begin(input)).status).toBe("running");
    expect(lease.runFor("t")).toBe("r1");
    busy.value = true;
    lease.observe("b");
    busy.value = false;
    lease.observe("b");
    expect(enqueued).toEqual([["agentRuns:finish", { runId: "r1", status: "succeeded" }]]);
    expect(lease.runFor("t")).toBe("r1");
  });

  it("starts a queued run of mine once Origin hands it the thread, and drops one that was cancelled", async () => {
    const { lease, started, abandoned, advance } = leaseWith(async (name) => name === "agentRuns:begin"
      ? { runId: "r2", status: "queued", messageId: "m" } : { status: "running" }, { value: false });
    const begun = await lease.begin(input);
    expect(begun.status).toBe("queued");
    lease.remember({ runId: "r2", botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", messageId: "m", text: "hi" });
    lease.remember({ runId: "r3", botId: "b", threadId: "t2", cloudThreadId: "ct2", teamId: "team", messageId: "m2", text: "yo" });
    lease.pending("team", [{ runId: "r2", status: "queued" }]);
    expect(started).toEqual([]);
    expect(abandoned).toEqual([]);
    advance(31_000);
    lease.pending("team", [{ runId: "r2", status: "running" }]);
    await expect.poll(() => started).toEqual(["r2"]);
    expect(abandoned).toEqual(["r3"]);
  });

  it("stops the local turn when the run was cancelled elsewhere", async () => {
    const busy = { value: true };
    const interrupt = vi.fn();
    let heartbeats = 0;
    const lease = createRunLease({
      mutation: async (name) => (name === "agentRuns:begin" ? { runId: "r", status: "running", messageId: "m" } : { status: ++heartbeats === 1 ? "running" : "cancelled" }),
      outbox: { enqueue: vi.fn(), queuedRuns: () => [], saveQueuedRun: vi.fn(), dropQueuedRun: vi.fn() },
      kick: vi.fn(), isBusy: () => busy.value, startQueued: vi.fn(), interrupt, abandoned: vi.fn(),
    });
    await lease.begin(input);
    lease.observe("b");
    await lease.tick();
    expect(interrupt).toHaveBeenCalledWith("b", "t");
    expect(lease.holds("t")).toBe(false);
  });

  it("stops after the last acknowledged lease expires when heartbeat requests fail", async () => {
    let heartbeats = 0;
    const { lease, advance, interrupt, enqueued } = leaseWith(async (name) => {
      if (name === "agentRuns:begin") return { runId: "r", status: "running", messageId: "m" };
      if (++heartbeats === 1) return { status: "running" };
      throw new TypeError("fetch failed");
    }, { value: true });
    await lease.begin(input);
    lease.observe("b");
    advance(59_999);
    await lease.tick();
    expect(lease.holds("t")).toBe(true);
    expect(interrupt).not.toHaveBeenCalled();
    advance(1);
    await lease.tick();
    await lease.tick();
    expect(lease.holds("t")).toBe(false);
    expect(lease.runFor("t")).toBeUndefined();
    expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
    expect(enqueued).not.toContainEqual(["agentRuns:finish", { runId: "r", status: "succeeded" }]);
  });

  it("bounds a nonsettling heartbeat without overlap or resurrection by its late response", async () => {
    let resolveHeartbeat!: (value: unknown) => void;
    const heartbeat = new Promise((resolve) => { resolveHeartbeat = resolve; });
    const heartbeatCalls = vi.fn(() => heartbeat);
    let heartbeats = 0;
    const { lease, advance, interrupt } = leaseWith(async (name) => name === "agentRuns:begin"
      ? { runId: "r", status: "running", messageId: "m" } : ++heartbeats === 1 ? { status: "running" } : heartbeatCalls(), { value: true });
    await lease.begin(input);
    lease.observe("b");
    advance(15_000);
    const first = lease.tick();
    advance(15_000);
    const second = lease.tick();
    advance(30_000);
    const expired = lease.tick();
    try {
      expect(heartbeatCalls).toHaveBeenCalledTimes(1);
      expect(lease.holds("t")).toBe(false);
      expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
    } finally {
      resolveHeartbeat({ status: "running" });
      await Promise.allSettled([first, second, expired]);
    }
    expect(lease.holds("t")).toBe(false);
    expect(lease.runFor("t")).toBeUndefined();
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  it("a fresh heartbeat renews ownership, but a later outage cannot extend it", async () => {
    let heartbeatCount = 0;
    const { lease, advance, interrupt } = leaseWith(async (name) => {
      if (name === "agentRuns:begin") return { runId: "r", status: "running", messageId: "m" };
      if (++heartbeatCount <= 2) return { status: "running" };
      throw new TypeError("fetch failed");
    }, { value: true });
    await lease.begin(input);
    lease.observe("b");
    advance(45_000);
    await lease.tick();
    advance(30_000);
    await lease.tick();
    expect(lease.holds("t")).toBe(true);
    expect(interrupt).not.toHaveBeenCalled();
    advance(30_000);
    await lease.tick();
    expect(lease.holds("t")).toBe(false);
    expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
    expect(heartbeatCount).toBe(3);
  });

  it("a permission revocation stops the local turn before its acknowledged lease expires", async () => {
    let heartbeats = 0;
    const { lease, interrupt } = leaseWith(async (name) => name === "agentRuns:begin"
      ? { runId: "r", status: "running", messageId: "m" } : { status: ++heartbeats === 1 ? "running" : "interrupted" }, { value: true });
    await lease.begin(input);
    lease.observe("b");
    await lease.tick();
    expect(lease.holds("t")).toBe(false);
    expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
  });

  it("uses elapsed monotonic time even when the wall clock moves backwards", async () => {
    let elapsed = 0;
    let wall = 100_000;
    const interrupt = vi.fn();
    let heartbeats = 0;
    const lease = createRunLease({
      mutation: async (name) => {
        if (name === "agentRuns:begin") return { runId: "r", status: "running", messageId: "m" };
        if (++heartbeats === 1) return { status: "running" };
        throw new TypeError("fetch failed");
      },
      outbox: { enqueue: vi.fn(), queuedRuns: () => [], saveQueuedRun: vi.fn(), dropQueuedRun: vi.fn() },
      kick: vi.fn(), isBusy: () => true, startQueued: vi.fn(), interrupt, abandoned: vi.fn(),
      now: () => wall, monotonicNow: () => elapsed,
    });
    await lease.begin(input);
    lease.observe("b");
    wall = -100_000;
    elapsed = 60_000;
    await lease.tick();
    expect(lease.holds("t")).toBe(false);
    expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
  });

  it("does not admit a begin response after its conservative lease deadline", async () => {
    let resolveBegin!: (value: unknown) => void;
    const begin = new Promise((resolve) => { resolveBegin = resolve; });
    const { lease, advance } = leaseWith(() => begin, { value: true });
    const begun = lease.begin(input);
    advance(60_000);
    resolveBegin({ runId: "r", status: "running", messageId: "m" });
    await expect(begun).rejects.toThrow(/lease/i);
    expect(lease.holds("t")).toBe(false);
  });

  it("confirms an idempotent begin result before giving a new local runner authority", async () => {
    const calls: string[] = [];
    const { lease } = leaseWith(async (name) => {
      calls.push(name);
      return name === "agentRuns:begin" ? { runId: "cached", status: "running", messageId: "m" } : { status: "interrupted" };
    }, { value: true });
    await expect(lease.begin(input)).rejects.toThrow(/lease/i);
    expect(calls).toEqual(["agentRuns:begin", "agentRuns:heartbeat"]);
    expect(lease.holds("t")).toBe(false);
    expect(lease.runFor("t")).toBeUndefined();
  });

  it("bounds a nonsettling begin confirmation and ignores its late reply", async () => {
    vi.useFakeTimers();
    try {
      let resolveHeartbeat!: (value: unknown) => void;
      const pending = new Promise(resolve => { resolveHeartbeat = resolve; });
      const { lease, advance } = leaseWith(async name => name === "agentRuns:begin"
        ? { runId: "cached", status: "running", messageId: "m" } : pending, { value: true });
      const begun = lease.begin(input);
      const rejected = expect(begun).rejects.toThrow(/lease/i);
      await Promise.resolve();
      advance(60_000);
      vi.advanceTimersByTime(60_000);
      try {
        await rejected;
        expect(lease.holds("t")).toBe(false);
      } finally {
        resolveHeartbeat({ status: "running" });
        await Promise.resolve();
      }
      expect(lease.runFor("t")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not renew an existing local grant from an idempotent begin response", async () => {
    const { lease, advance, interrupt } = leaseWith(async name => name === "agentRuns:begin"
      ? { runId: "r", status: "running", messageId: "m" } : { status: "running" }, { value: true });
    await lease.begin(input);
    lease.observe("b");
    advance(45_000);
    await lease.begin(input);
    advance(15_000);
    lease.failed("t");
    expect(lease.holds("t")).toBe(false);
    expect(lease.runFor("t")).toBeUndefined();
    expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
  });

  it("expires the local turn on its timer even while the regular tick is blocked", async () => {
    vi.useFakeTimers();
    try {
      let heartbeats = 0;
      let resolveHeartbeat!: (value: unknown) => void;
      const pending = new Promise(resolve => { resolveHeartbeat = resolve; });
      const { lease, advance, interrupt } = leaseWith(async name => name === "agentRuns:begin"
        ? { runId: "r", status: "running", messageId: "m" } : ++heartbeats === 1 ? { status: "running" } : pending, { value: true });
      await lease.begin(input);
      lease.observe("b");
      advance(15_000);
      vi.advanceTimersByTime(15_000);
      const blocked = lease.tick();
      advance(45_000);
      vi.advanceTimersByTime(45_000);
      try {
        expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
        expect(lease.holds("t")).toBe(false);
      } finally {
        resolveHeartbeat({ status: "running" });
        await blocked;
      }
      expect(lease.runFor("t")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a lease once and ignores its heartbeat and timer after a replacement turn starts", async () => {
    vi.useFakeTimers();
    try {
      let resolveHeartbeat!: (value: unknown) => void;
      const pending = new Promise(resolve => { resolveHeartbeat = resolve; });
      let heartbeats = 0;
      const { lease, advance, interrupt } = leaseWith(async name => name === "agentRuns:begin"
        ? { runId: "old", status: "running", messageId: "m" } : ++heartbeats === 1 ? { status: "running" } : pending, { value: true });
      await lease.begin(input);
      lease.observe("b");
      advance(15_000);
      vi.advanceTimersByTime(15_000);
      const blocked = lease.tick();
      try {
        lease.stop();
        lease.stop();
        expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
      } finally {
        resolveHeartbeat({ status: "running" });
        await blocked;
      }
      advance(60_000);
      vi.advanceTimersByTime(60_000);
      expect(interrupt).toHaveBeenCalledTimes(1);
      expect(lease.holds("t")).toBe(false);
      expect(lease.runFor("t")).toBeUndefined();
      await expect(lease.begin(input)).rejects.toThrow(/lease/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["begin", "heartbeat"])("cannot acquire a lease from a late %s response after stop", async phase => {
    let resolvePending!: (value: unknown) => void;
    const pending = new Promise(resolve => { resolvePending = resolve; });
    const mutation = vi.fn(async name => name === `agentRuns:${phase}`
      ? pending : { runId: "old", status: "running", messageId: "m" });
    const { lease, interrupt } = leaseWith(mutation, { value: true });
    const begun = lease.begin(input);
    const rejected = expect(begun).rejects.toThrow(/lease/i);
    if (phase === "heartbeat") await expect.poll(() => mutation.mock.calls.some(([name]) => name === "agentRuns:heartbeat")).toBe(true);
    try {
      lease.stop();
      if (phase === "heartbeat") await rejected;
    } finally {
      resolvePending({ runId: "old", status: "running", messageId: "m" });
      await Promise.allSettled([rejected]);
    }
    await rejected;
    expect(lease.holds("t")).toBe(false);
    expect(lease.runFor("t")).toBeUndefined();
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("never starts a queued promotion whose confirmation completes after stop", async () => {
    let resolveHeartbeat!: (value: unknown) => void;
    const pending = new Promise(resolve => { resolveHeartbeat = resolve; });
    const { lease, started, abandoned, interrupt } = leaseWith(async name => name === "agentRuns:begin"
      ? { runId: "r", status: "queued", messageId: "m" } : pending, { value: false });
    await lease.begin(input);
    lease.remember({ runId: "r", botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", messageId: "m", text: "hi" });
    lease.pending("team", [{ runId: "r", status: "running" }]);
    lease.stop();
    resolveHeartbeat({ status: "running" });
    await Promise.resolve();
    await Promise.resolve();
    lease.pending("team", [{ runId: "r", status: "running" }]);
    expect(started).toEqual([]);
    expect(abandoned).toEqual(["r"]);
    expect(interrupt).not.toHaveBeenCalled();
    expect(lease.holds("t")).toBe(false);
  });

  it("confirms a queued promotion before starting and rejects authority already revoked", async () => {
    const { lease, started, abandoned } = leaseWith(async (name) => name === "agentRuns:begin"
      ? { runId: "r", status: "queued", messageId: "m" } : { status: "interrupted" }, { value: false });
    await lease.begin(input);
    lease.remember({ runId: "r", botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", messageId: "m", text: "hi" });
    lease.pending("team", [{ runId: "r", status: "running" }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([]);
    expect(abandoned).toEqual(["r"]);
    expect(lease.holds("t")).toBe(false);
  });

  it("never executes a queued promotion while confirmation fails or never settles", async () => {
    let resolveHeartbeat!: (value: unknown) => void;
    const pendingHeartbeat = new Promise(resolve => { resolveHeartbeat = resolve; });
    const heartbeat = vi.fn(() => pendingHeartbeat);
    const { lease, advance, started, abandoned } = leaseWith(async (name) => name === "agentRuns:begin"
      ? { runId: "r", status: "queued", messageId: "m" } : heartbeat(), { value: false });
    await lease.begin(input);
    lease.remember({ runId: "r", botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", messageId: "m", text: "hi" });
    lease.pending("team", [{ runId: "r", status: "running" }]);
    advance(60_000);
    const expired = lease.tick();
    try {
      expect(started).toEqual([]);
      expect(abandoned).toEqual(["r"]);
      expect(lease.holds("t")).toBe(false);
      expect(heartbeat).toHaveBeenCalledTimes(1);
    } finally {
      resolveHeartbeat({ status: "running" });
      await expired;
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(started).toEqual([]);
  });

  it("keeps a rejected queued confirmation from executing before the claim expires", async () => {
    const { lease, advance, started, abandoned } = leaseWith(async (name) => {
      if (name === "agentRuns:begin") return { runId: "r", status: "queued", messageId: "m" };
      throw new TypeError("fetch failed");
    }, { value: false });
    await lease.begin(input);
    lease.remember({ runId: "r", botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", messageId: "m", text: "hi" });
    lease.pending("team", [{ runId: "r", status: "running" }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([]);
    expect(lease.holds("t")).toBe(false);
    advance(60_000);
    await lease.tick();
    expect(abandoned).toEqual(["r"]);
    expect(started).toEqual([]);
  });

  it("does not reuse an earlier finished run's write grace after a later run loses ownership", async () => {
    let runId = "first";
    let heartbeats = 0;
    const busy = { value: true };
    const { lease } = leaseWith(async name => name === "agentRuns:begin"
      ? { runId, status: "running", messageId: "m" } : { status: ++heartbeats <= 2 ? "running" : "interrupted" }, busy);
    await lease.begin(input);
    lease.observe("b");
    busy.value = false;
    lease.observe("b");
    expect(lease.runFor("t")).toBe("first");
    runId = "second";
    busy.value = true;
    await lease.begin({ ...input, clientId: "send:second" });
    lease.observe("b");
    await lease.tick();
    expect(lease.holds("t")).toBe(false);
    expect(lease.runFor("t")).toBeUndefined();
  });

  it("keeps heartbeating a confirmed queued turn while its start promise remains pending", async () => {
    let finishStart!: () => void;
    const start = new Promise<void>(resolve => { finishStart = resolve; });
    let clock = 0;
    let queued: Parameters<ReturnType<typeof openOutbox>["saveQueuedRun"]>[0] | undefined;
    const heartbeat = vi.fn(async () => ({ status: "running" }));
    const startQueued = vi.fn(() => start);
    const interrupt = vi.fn();
    const lease = createRunLease({
      mutation: async name => name === "agentRuns:begin"
        ? { runId: "r", status: "queued", messageId: "m" } : heartbeat(),
      outbox: { enqueue: vi.fn(), queuedRuns: () => queued ? [queued] : [], saveQueuedRun: run => { queued = run; }, dropQueuedRun: () => { queued = undefined; } },
      kick: vi.fn(), isBusy: () => true, startQueued, interrupt, abandoned: vi.fn(),
      now: () => clock, monotonicNow: () => clock,
    });
    await lease.begin(input);
    lease.remember({ runId: "r", botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", messageId: "m", text: "hi" });
    lease.pending("team", [{ runId: "r", status: "running" }]);
    await expect.poll(() => startQueued.mock.calls.length).toBe(1);
    try {
      clock = 45_000;
      await lease.tick();
      clock = 75_000;
      await lease.tick();
      expect(lease.holds("t")).toBe(true);
      expect(interrupt).not.toHaveBeenCalled();
      expect(heartbeat).toHaveBeenCalledTimes(3);
    } finally {
      finishStart();
      lease.failed("t");
    }
  });
});

describe("shared runner lifecycle", () => {
  it("stops the old account's lease before its replacement can run", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const monotonic = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const folder = mkdtempSync(join(tmpdir(), "omb-shared-account-"));
    folders.push(folder);
    const cloudFile = join(folder, "cloud.json");
    const setAccount = (sessionToken: string) => writeFileSync(cloudFile, JSON.stringify({ url: "https://fixture.invalid", sessionToken, projects: {} }));
    const links = join(folder, "links.json");
    writeFileSync(links, JSON.stringify({ threads: { t: "ct" } }));
    const task = { threadId: "t", title: "Thread", createdAt: 0, modelSelection: { instanceId: "fixture", model: "fixture" } };
    const bot = { id: "b", name: "Bot", shared: { agentId: "agent", teamId: "team" }, modelSelection: task.modelSelection };
    const interrupt = vi.fn();
    const shared = createSharedAgents({
      store: { bots: [bot], projectBotForTask: () => undefined, bot: () => bot, taskByThread: () => task,
        messagesFor: () => [], patchTask: (_bot: string, _thread: string, patch: object) => Object.assign(task, patch), onChange: () => () => undefined } as never,
      files: { cloud: cloudFile, links, state: join(folder, "state.json"), outbox: join(folder, "outbox.sqlite"), bots: join(folder, "bots.json") },
      connect: (_url, token) => ({ query: async () => ({ _id: token, name: token }),
        mutation: async name => name === "agentRuns:begin" ? { runId: token, status: "running", messageId: "m" } : { status: "running" },
        subscribe: () => () => undefined, close: vi.fn() }),
      instances: async () => [], isBusy: () => true, startQueued: vi.fn(), interrupt, redact: text => text,
    });
    try {
      setAccount("old");
      expect(await shared.beforeSend({ botId: "b", threadId: "t", text: "Old", sendId: "first" })).toMatchObject({ status: "running" });
      clock = 45_000;
      await vi.advanceTimersByTimeAsync(45_000);
      setAccount("replacement");
      expect(await shared.beforeSend({ botId: "b", threadId: "t", text: "New", sendId: "second" })).toMatchObject({ status: "running" });
      expect(interrupt).toHaveBeenCalledExactlyOnceWith("b", "t");
      clock = 60_000;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(interrupt).toHaveBeenCalledTimes(1);
    } finally {
      shared.stop();
      monotonic.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("where this computer runs shared agents", () => {
  it("tells Origin whose plan answers each agent, then follows only the runs sent to this host", async () => {
    const folder = mkdtempSync(join(tmpdir(), "omb-shared-host-"));
    folders.push(folder);
    const cloudFile = join(folder, "cloud.json");
    writeFileSync(cloudFile, JSON.stringify({ url: "https://fixture.invalid", sessionToken: "ada", projects: {} }));
    const links = join(folder, "links.json");
    writeFileSync(links, JSON.stringify({ threads: {} }));
    const bot = { id: "b", name: "Bot", shared: { agentId: "agent", teamId: "team" }, modelSelection: { instanceId: "claude", model: "opus" } };
    const mutation = vi.fn(async (name: string) => name === "agents:publishHost" ? "host1" : null);
    const subscribe = vi.fn((_name: string, _args: Record<string, unknown>, _onUpdate: (value: unknown) => void) => () => undefined);
    const shared = createSharedAgents({
      store: { bots: [bot], projectBotForTask: () => undefined, bot: () => bot, taskByThread: () => undefined, messagesFor: () => [], onChange: () => () => undefined } as never,
      files: { cloud: cloudFile, links, state: join(folder, "state.json"), outbox: join(folder, "outbox.sqlite"), bots: join(folder, "bots.json") },
      connect: () => ({ query: async () => ({ _id: "ada", name: "Ada" }), mutation, subscribe, close: vi.fn() }),
      subscriptions: async () => ({ claude: { provider: "claude", plan: "max" } }),
      instances: async () => [], isBusy: () => false, startQueued: vi.fn(), interrupt: vi.fn(), redact: text => text,
    });
    try {
      shared.start();
      await expect.poll(() => subscribe.mock.calls.find(([name]) => name === "agentRuns:pendingForMe")?.[1]).toEqual({ teamId: "team", hostId: "host1" });
      expect(mutation).toHaveBeenCalledWith("agents:publishHost", expect.objectContaining({ teamId: "team", plans: [{ agentId: "agent", provider: "claude", plan: "max" }] }));
      expect(subscribe.mock.calls.filter(([name]) => name === "agentRuns:pendingForMe")).toHaveLength(1);
    } finally {
      shared.stop();
    }
  });
});

describe("shared model resolution", () => {
  const ready = { state: "available", authenticated: true } satisfies ProviderSnapshot;
  const claude = { instanceId: "claude", driverKind: "claudeAgent", snapshot: ready, models: { default: "claude-sonnet", options: [{ id: "claude-sonnet", label: "Sonnet" }, { id: "claude-haiku-5-5", label: "Haiku" }] } };
  const codex = { instanceId: "codex", driverKind: "codex", snapshot: ready, models: { default: "gpt-luna", options: [{ id: "gpt-luna", label: "Luna" }] } };

  it("runs the bot's own model here when it can, then my default for that provider, then any ready engine", () => {
    expect(resolveSharedModel([claude, codex], { provider: "claudeAgent", model: "claude-haiku-5-5" })).toEqual({ selection: { instanceId: "claude", model: "claude-haiku-5-5" }, via: "intent" });
    expect(resolveSharedModel([claude, codex], { provider: "claudeAgent", model: "claude-opus" }, { claudeAgent: { instanceId: "claude", model: "claude-sonnet" } }))
      .toEqual({ selection: { instanceId: "claude", model: "claude-sonnet" }, via: "default" });
    expect(resolveSharedModel([codex], { provider: "claudeAgent", model: "claude-haiku-5-5" })).toEqual({ selection: { instanceId: "codex", model: "gpt-luna" }, via: "fallback" });
    expect(resolveSharedModel([{ ...codex, snapshot: { state: "available", authenticated: false } }], null).via).toBe("none");
  });
});

describe("cross-machine context", () => {
  it("replays when other members wrote more than a resumed session would be handed", () => {
    const remote = (text: string): Pick<Message, "role" | "kind" | "text" | "remote"> => ({ role: "user", kind: "text", text, remote: { cloudId: text, name: "Ada" } });
    expect(remoteBacklogExceedsCaps([{ role: "bot", kind: "text", text: "mine" }, remote("a"), remote("b")])).toBe(false);
    expect(remoteBacklogExceedsCaps([{ role: "bot", kind: "text", text: "mine" }, remote("x".repeat(5_000))])).toBe(true);
    expect(remoteBacklogExceedsCaps(Array.from({ length: 13 }, (_, index) => remote(`m${index}`)))).toBe(true);
  });
});

describe("tagging teammates in a shared thread", () => {
  const lines = [
    message({ id: "mine", role: "user", sendId: "s1", text: "@ada look" }),
    message({ id: "theirs", role: "user", sendId: "s2", text: "@ada look", remote: { cloudId: "c2", name: "Bo", status: "final" } }),
  ];
  const store = { taskByThread: (_bot: string, thread: string) => (thread === "t" || thread === "local" ? { threadId: thread } : undefined), messagesFor: () => lines } as never;
  const ask = (body: Record<string, unknown>) => sharedThreadMention(store, { t: "cloudthread1" }, "b", { threadId: "t", sendId: "s1", userIds: ["user1"], ...body });

  it("names the cloud row of this person's own line", () => {
    expect(ask({})).toEqual({ threadId: "cloudthread1", clientId: "send:s1", userIds: ["user1"] });
    expect(ask({ userIds: ["user1", "user1", "user2"] })).toMatchObject({ userIds: ["user1", "user2"] });
  });

  it("refuses another member's line, an unshared thread and malformed people", () => {
    expect(ask({ sendId: "s2" })).toMatchObject({ status: 404 });
    expect(ask({ threadId: "local" })).toMatchObject({ status: 409 });
    expect(ask({ threadId: "gone" })).toMatchObject({ status: 404 });
    expect(ask({ userIds: [] })).toMatchObject({ status: 400 });
    expect(ask({ userIds: ["Robert'); DROP"] })).toMatchObject({ status: 400 });
    expect(ask({ userIds: Array.from({ length: 11 }, (_, i) => `user${i}`) })).toMatchObject({ status: 400 });
  });
});
