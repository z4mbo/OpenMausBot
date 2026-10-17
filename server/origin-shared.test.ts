import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderSnapshot } from "./contracts.ts";
import { resolveSharedModel } from "./default-model-selection.ts";
import { openOutbox } from "./origin-outbox.ts";
import { createRunLease } from "./origin-run-lease.ts";
import { remoteBacklogExceedsCaps } from "./origin-shared-agents.ts";
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
    let clock = 0;
    const lease = createRunLease({
      mutation,
      outbox: {
        enqueue: (name, args) => { enqueued.push([name, args]); },
        queuedRuns: () => [...queued.values()], saveQueuedRun: (run) => { queued.set(run.runId, run); }, dropQueuedRun: (id) => { queued.delete(id); },
      },
      kick: () => undefined, isBusy: () => busy.value, startQueued: async (run) => { started.push(run.runId); },
      interrupt: vi.fn(), abandoned: (run) => { abandoned.push(run.runId); }, now: () => clock,
    });
    return { lease, enqueued, started, abandoned, advance: (ms: number) => { clock += ms; } };
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
    const { lease, started, abandoned, advance } = leaseWith(async () => ({ runId: "r2", status: "queued", messageId: "m" }), { value: false });
    const begun = await lease.begin(input);
    expect(begun.status).toBe("queued");
    lease.remember({ runId: "r2", botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", messageId: "m", text: "hi" });
    lease.remember({ runId: "r3", botId: "b", threadId: "t2", cloudThreadId: "ct2", teamId: "team", messageId: "m2", text: "yo" });
    lease.pending("team", [{ runId: "r2", status: "queued" }]);
    expect(started).toEqual([]);
    expect(abandoned).toEqual([]);
    advance(31_000);
    lease.pending("team", [{ runId: "r2", status: "running" }]);
    await Promise.resolve();
    expect(started).toEqual(["r2"]);
    expect(abandoned).toEqual(["r3"]);
  });

  it("stops the local turn when the run was cancelled elsewhere", async () => {
    const busy = { value: true };
    const interrupt = vi.fn();
    const lease = createRunLease({
      mutation: async (name) => (name === "agentRuns:begin" ? { runId: "r", status: "running", messageId: "m" } : { status: "cancelled" }),
      outbox: { enqueue: vi.fn(), queuedRuns: () => [], saveQueuedRun: vi.fn(), dropQueuedRun: vi.fn() },
      kick: vi.fn(), isBusy: () => busy.value, startQueued: vi.fn(), interrupt, abandoned: vi.fn(),
    });
    await lease.begin(input);
    lease.observe("b");
    await lease.tick();
    expect(interrupt).toHaveBeenCalledWith("b", "t");
    expect(lease.holds("t")).toBe(false);
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
