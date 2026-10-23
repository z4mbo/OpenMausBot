import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, RuntimeEventListener } from "./contracts.ts";
import { createHostedSidecar, type HostedStartOptions } from "./origin-model-host-sidecar.ts";
import type { HostedTurnInput } from "./origin-model-host-types.ts";
import type { Message, Store, StoreChange, TaskRecord } from "./store.ts";

function fixture(play?: (f: { event(type: string, fields?: object): void; row(message: Partial<Message>): void; options: HostedStartOptions }) => Promise<void>) {
  const events = new Set<RuntimeEventListener>(), rows = new Set<(change: StoreChange) => void>();
  const messages: Message[] = [];
  const selected = { threadId: "direct-B", modelSelection: { instanceId: "private-provider", model: "private-model" }, resumeCursors: { private: "PRIVATE_OWNER_SESSION" } };
  const before = structuredClone(selected);
  let child: TaskRecord;
  const store = {
    createTask: vi.fn((_botId, title, activate, _projectId, _opener, _approval, modelSelection, cwd) => {
      expect(activate).toBe(false);
      child = { threadId: "host-sidecar", title, createdAt: 1, resumeCursors: {}, modelSelection, cwd };
      return child;
    }),
    patchTask: vi.fn((_botId, _threadId, patch) => Object.assign(child, patch)),
    applyRemoteMessage: vi.fn((_threadId, message) => { messages.push({ ...message, id: `context-${messages.length}`, at: 1 } as Message); return message; }),
    onChange: vi.fn(listener => { rows.add(listener); return () => rows.delete(listener); }),
    setTaskClosedBy: vi.fn(),
  } as unknown as Store;
  const event = (type: string, fields = {}) => {
    for (const observer of events) observer({ type, threadId: "host-sidecar", providerInstanceId: "owner-claude", turnId: "turn1", ...fields } as RuntimeEvent);
  };
  const row = (message: Partial<Message>) => {
    const next = { id: `reply-${messages.length}`, at: 2, role: "bot", kind: "text", ...message } as Message;
    messages.push(next);
    for (const observer of rows) observer({ type: "message", threadId: "host-sidecar", message: next } as StoreChange);
  };
  const abort = new AbortController();
  const input = {
    botId: "local-agent", instanceId: "owner-claude", cwd: "C:\\synthetic-project", signal: abort.signal,
    work: { executionId: "exec1", runId: "run1", model: "claude-fixture", requesterName: "Teammate", requesterUserId: "requester1", text: "Canonical requester task" },
    context: [{ seq: 1, role: "user", kind: "text", text: "Canonical project context", status: "final", createdAt: 1, authorName: "Original requester" }],
    beforeDispatch: vi.fn(async () => undefined), activity: vi.fn(), emit: vi.fn(),
  } as unknown as HostedTurnInput;
  const start = vi.fn(async (_botId: string, _text: string, options: HostedStartOptions) => {
    await options.hostedExecution.beforeDispatch();
    event("turn.started");
    if (play) await play({ event, row, options });
    else { event("content.delta", { streamKind: "assistant_text", delta: "Public result" }); row({ text: "Public result" }); event("turn.completed", { ok: true }); options.onTurnSettled(); }
    return { id: "requester-line", role: "user", kind: "text", text: input.work.text, at: 2 } as Message;
  });
  const interrupt = vi.fn(async (): Promise<void> => undefined);
  const sidecar = createHostedSidecar({ store, start, interrupt, observe: listener => { events.add(listener); return () => events.delete(listener); }, redact: text => text.replaceAll("PRIVATE_SECRET", "[redacted]") });
  return { sidecar, input, abort, messages, selected, before, store, start, interrupt, events, rows };
}

describe("owner-local hosted conversation isolation", () => {
  it("uses a detached fresh local session with only canonical shared history and requester attribution", async () => {
    const f = fixture(); expect(await f.sidecar.run(f.input)).toEqual({ ok: true });
    expect(f.selected).toEqual(f.before);
    expect(f.store.createTask).toHaveBeenCalledWith("local-agent", "Shared request · Teammate", false, undefined, undefined, "ask",
      { instanceId: "owner-claude", model: "claude-fixture" }, "C:\\synthetic-project");
    expect(f.store.patchTask).toHaveBeenCalledWith("local-agent", "host-sidecar", { sharedPrivate: true,
      modelSelection: { instanceId: "owner-claude", model: "claude-fixture" },
      hostedRequest: { runId: "run1", executionId: "exec1", requesterUserId: "requester1" } });
    expect(f.start.mock.calls[0]?.[2].sender).toEqual({ name: "Teammate", id: "origin:requester1" });
    expect(JSON.stringify(f.messages)).toContain("Canonical project context");
    expect(JSON.stringify(f.messages)).not.toContain("PRIVATE_OWNER_SESSION");
    expect(f.input.beforeDispatch).toHaveBeenCalledTimes(1);
    expect(f.input.emit).toHaveBeenCalledWith(expect.objectContaining({ text: "Public result", role: "bot" }), false);
    expect(f.sidecar.owns("host-sidecar")).toBe(false); expect(f.events.size).toBe(0); expect(f.rows.size).toBe(0);
  });

  it("buffers quota diagnostics and publishes nothing for a typed zero-work refusal", async () => {
    const refusal = { kind: "quota_exhausted", scope: "account", retry: "safe_initial_refusal" } as const;
    const f = fixture(async ({ row, event, options }) => {
      row({ kind: "activity", tool: { name: "quota diagnostics", ok: false } });
      event("runtime.error", { message: "Quota exhausted" }); event("turn.completed", { ok: false, refusal }); options.onDispatchError("initial quota refusal");
    });
    expect(await f.sidecar.run(f.input)).toEqual({ ok: false, refusal });
    expect(f.input.activity).not.toHaveBeenCalled(); expect(f.input.emit).not.toHaveBeenCalled();
  });

  it("does not mark partial tool work safe to replay", async () => {
    const f = fixture(async ({ row, event, options }) => {
      event("item.started", { itemType: "command_execution" });
      row({ kind: "activity", tool: { name: "Tool action", ok: true } });
      event("turn.completed", { ok: false, refusal: { kind: "quota_exhausted", scope: "account", retry: "safe_initial_refusal" } }); options.onTurnSettled();
    });
    expect(await f.sidecar.run(f.input)).toEqual({ ok: false });
    expect(f.input.activity).toHaveBeenCalledTimes(1); expect(f.input.emit).toHaveBeenCalledTimes(1);
  });

  it("publishes redacted normal failure diagnostics without misclassifying them as quota", async () => {
    const f = fixture(async ({ row, event, options }) => {
      row({ kind: "activity", tool: { name: "Provider failed", output: "PRIVATE_SECRET" } });
      event("turn.completed", { ok: false }); options.onTurnSettled();
    });
    expect(await f.sidecar.run(f.input)).toEqual({ ok: false });
    expect(f.input.emit).toHaveBeenCalledWith(expect.objectContaining({ tool: expect.objectContaining({ output: "[redacted]" }) }), false);
  });

  it("holds ownership until an aborted native turn has actually stopped", async () => {
    let entered!: () => void, quiesced!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const stopped = new Promise<void>(resolve => { quiesced = resolve; });
    const f = fixture(async () => { entered(); }); f.interrupt.mockImplementation(() => stopped);
    const running = f.sidecar.run(f.input); await ready;
    f.abort.abort(); await Promise.resolve();
    expect(f.sidecar.owns("host-sidecar")).toBe(true); expect(f.interrupt).toHaveBeenCalledExactlyOnceWith("local-agent", "host-sidecar");
    quiesced(); expect(await running).toEqual({ ok: false }); expect(f.sidecar.owns("host-sidecar")).toBe(false);
  });
});
