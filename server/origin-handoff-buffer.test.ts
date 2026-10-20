import { describe, expect, it, vi } from "vitest";
import { createRunLease } from "./origin-run-lease.ts";
import { createThreadMirror } from "./origin-thread-mirror.ts";
import type { Message, StoreChange } from "./store.ts";

function mirrorFixture() {
  let changed!: (change: StoreChange) => void;
  const enqueue = vi.fn();
  const mirror = createThreadMirror({
    store: { onChange: listener => { changed = listener; return () => undefined; }, messagesFor: () => [], applyRemoteMessage: vi.fn(), patchTask: vi.fn(), taskByThread: () => undefined, botByThread: () => null },
    outbox: { enqueue, cursor: () => 0, setCursor: vi.fn() }, cloud: { mutation: vi.fn(), subscribe: () => () => undefined },
    threads: () => ({ thread: "canonical-thread" }), runFor: () => "run1", me: () => "requester1", kick: vi.fn(), redact: value => value.replaceAll("private-value", "[redacted]"),
  });
  let serial = 0;
  const emit = (patch: Partial<Message> = {}) => {
    const message = { id: `m${++serial}`, at: 1, role: "bot", kind: "activity", tool: { name: "Initial diagnostic", output: "private-value" }, ...patch } as Message;
    changed({ type: "message", threadId: "thread", message }); return message;
  };
  return { mirror, emit, enqueue };
}

describe("safe initial diagnostic handover", () => {
  it("drops only the exact run's held bot diagnostics after confirmed transfer", () => {
    const f = mirrorFixture(); f.mirror.hold("thread", "run1"); f.emit();
    f.mirror.release("thread", false, "wrong-run"); expect(f.enqueue).not.toHaveBeenCalled();
    f.mirror.release("thread", false, "run1"); expect(f.enqueue).not.toHaveBeenCalled();
    f.emit({ kind: "text", text: "Later work" }); expect(f.enqueue).toHaveBeenCalledTimes(1); f.mirror.stop();
  });
  it("publishes frozen redacted diagnostics when work or a non-quota failure disqualifies transfer", () => {
    const f = mirrorFixture(); f.mirror.hold("thread", "run1"); const message = f.emit(); message.tool!.output = "modified-after-enqueue";
    f.mirror.release("thread", true, "run1");
    expect(f.enqueue).toHaveBeenCalledWith("agentRuns:appendMessage", expect.objectContaining({ runId: "run1", tool: expect.objectContaining({ output: "[redacted]" }) })); f.mirror.stop();
  });
  it("never lets an old transfer release the next request's diagnostics", () => {
    const f = mirrorFixture(); f.mirror.hold("thread", "run1"); f.emit(); f.mirror.hold("thread", "run2"); f.emit();
    f.mirror.release("thread", true, "run1"); expect(f.enqueue).not.toHaveBeenCalled();
    f.mirror.release("thread", true, "run2"); expect(f.enqueue).toHaveBeenCalledTimes(1); f.mirror.stop();
  });
  it.each(["rows", "bytes"])("bounds held %s by publishing instead of allowing a false zero-output transfer", limit => {
    const f = mirrorFixture(); f.mirror.hold("thread", "run1");
    if (limit === "rows") for (let i = 0; i < 21; i++) f.emit(); else f.emit({ kind: "text", text: "x".repeat(65 * 1024) });
    expect(f.enqueue.mock.calls.length).toBeGreaterThan(0);
    const before = f.enqueue.mock.calls.length; f.emit(); expect(f.enqueue.mock.calls.length).toBe(before + 1); f.mirror.stop();
  });
  it("continues mirroring a person's own line while holding initial bot diagnostics", () => {
    const f = mirrorFixture(); f.mirror.hold("thread", "run1"); f.emit(); f.emit({ role: "user", kind: "text", text: "User request", sendId: "request1", tool: undefined });
    expect(f.enqueue).toHaveBeenCalledTimes(1); expect(f.enqueue.mock.calls[0]?.[1]).toMatchObject({ role: "user", clientId: "send:request1" }); f.mirror.stop();
  });

  it("hands over only its confirmed matching live lease without finish, grace writes or interrupt", async () => {
    let clock = 0;
    const enqueue = vi.fn(), interrupt = vi.fn(), mutation = vi.fn(async name => name === "agentRuns:begin" ? { runId: "run1", status: "running", messageId: "request1" } : { status: "running" });
    const lease = createRunLease({ mutation, outbox: { enqueue, queuedRuns: () => [], saveQueuedRun: vi.fn(), dropQueuedRun: vi.fn() }, kick: vi.fn(), isBusy: () => true, startQueued: vi.fn(), interrupt, abandoned: vi.fn(), now: () => clock, monotonicNow: () => clock });
    await lease.begin({ botId: "bot", threadId: "thread", cloudThreadId: "ct", teamId: "team", clientId: "send:request1", text: "Request" });
    expect(lease.handover("thread", "wrong-run")).toBe(false); expect(lease.holds("thread")).toBe(true);
    expect(lease.handover("thread", "run1")).toBe(true); expect(lease.holds("thread")).toBe(false); expect(lease.runFor("thread")).toBeUndefined();
    await lease.tick(); expect(enqueue).not.toHaveBeenCalled(); expect(interrupt).not.toHaveBeenCalled(); expect(lease.handover("thread", "run1")).toBe(false);
    await lease.begin({ botId: "bot", threadId: "thread", cloudThreadId: "ct", teamId: "team", clientId: "send:request1", text: "Request" });
    clock = 60_001; expect(lease.handover("thread", "run1")).toBe(false); expect(interrupt).toHaveBeenCalledOnce(); lease.stop();
  });
});
