import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSelection } from "./contracts.ts";
import { createHostedRequests, type HostedRequest, type HostedRequestStatus, type RequesterScope } from "./origin-hosted-requests.ts";
import type { HostedPort } from "./origin-model-host-types.ts";
import type { Message } from "./store.ts";

const remote: ModelSelection = { instanceId: "origin-remote", model: "remote-model", source: { hostId: "host1", sourceId: "source1" } };
const local: ModelSelection = { instanceId: "local-codex", model: "local-model" };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });

function request(patch: Partial<HostedRequest> = {}): HostedRequest {
  return { id: "receipt1", origin: "https://fixture.invalid", userId: "user1", botId: "bot1", threadId: "thread1",
    cloudThreadId: "cloud1", teamId: "team1", clientId: "send:message1", messageId: "message1", selection: remote,
    stage: "advance", runId: "run1", executionId: "execution1", previousExecutionId: "execution1", transferKey: "transfer1",
    target: { selection: local, provider: "codex" }, quota: true, cancelRequested: false, visited: [], blockedAccounts: [], createdAt: 1, ...patch };
}

function fixture(initial?: HostedRequest) {
  const home = mkdtempSync(join(tmpdir(), "origin-hosted-requester-review-")), file = join(home, "requests.json");
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  if (initial) writeFileSync(file, JSON.stringify({ version: 1, requests: [initial] }));
  let selection = initial?.selection ?? remote;
  let observed: HostedRequestStatus | null = { runId: "run1", runStatus: "running", route: "sender",
    currentExecutionId: null, previousExecutionId: "execution1", model: local.model, provider: "codex" };
  const message = { id: "message1", role: "user", kind: "text", text: "Canonical request", at: 1 } as Message;
  const query = vi.fn(async (_name: string, _args: Record<string, unknown>) => observed);
  const mutation = vi.fn(async (_name: string, _args: Record<string, unknown>) => null);
  const port: HostedPort = { query, mutation };
  let scope: RequesterScope | null = { origin: "https://fixture.invalid", userId: "user1", identity: {}, port };
  const startSender = vi.fn(async (_row: HostedRequest, _target: unknown, _current: () => boolean) => undefined);
  const switchTaskModel = vi.fn((_botId: string, _threadId: string, next: ModelSelection) => { selection = next; });
  const setTaskActivity = vi.fn();
  const appendMessage = vi.fn(() => ({ ...message, id: "note1" }));
  let locallyRunning = false;
  const deps = {
    file, scope: () => scope, store: {
      bot: () => ({ quotaFallback: true, fallbackApiAllowed: false, modelSelection: selection }),
      projectBotForTask: () => ({ quotaFallback: true, modelSelection: selection }),
      taskByThread: () => ({ threadId: "thread1" }), messagesFor: () => [message], patchMessage: vi.fn(),
      appendMessage, setTaskActivity,
      switchTaskModel,
    } as never,
    next: vi.fn(async () => null), validate: vi.fn(async () => undefined), startSender,
    handover: vi.fn(() => true), release: vi.fn(), redact: (text: string) => text, timeoutMs: 100,
    locallyRunning: () => locallyRunning,
  };
  const manager = createHostedRequests(deps);
  cleanups.push(() => manager.stop());
  return { file, deps, manager, query, mutation, startSender, message, switchTaskModel, setTaskActivity, appendMessage,
    setStatus: (value: HostedRequestStatus | null) => { observed = value; },
    setSelection: (value: ModelSelection) => { selection = value; },
    setLocallyRunning: (value: boolean) => { locallyRunning = value; },
    signOut: () => { scope = null; } };
}

describe("independent hosted requester safety", () => {
  it("sends Stop to the canonical run while local sender preparation is still pending", async () => {
    const f = fixture(request());
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    f.startSender.mockImplementation(async (_row, _target, current) => { entered(); await pending; expect(current()).toBe(false); });
    const ticking = f.manager.tick();
    await started;
    const stopping = f.manager.cancelThread("bot1", "thread1");
    try {
      await expect.poll(() => f.mutation.mock.calls.filter(([name]) => name === "agentRuns:cancel").length, { timeout: 300 }).toBe(1);
    } finally { release(); await Promise.all([ticking, stopping]); }
  });

  it("does not repeat an unknown initial admission during ticks or process recovery", async () => {
    const f = fixture();
    f.setStatus(null);
    f.mutation.mockImplementation(async name => { if (name === "modelHosts:begin") throw new Error("Admission acknowledgement lost"); return null; });
    await expect(f.manager.begin({ botId: "bot1", threadId: "thread1", cloudThreadId: "cloud1", teamId: "team1",
      clientId: "send:message1", message: f.message, selection: remote })).rejects.toThrow();
    await f.manager.tick(); f.manager.stop();
    const restarted = createHostedRequests(f.deps); cleanups.push(() => restarted.stop());
    await restarted.tick();
    expect(f.mutation.mock.calls.filter(([name]) => name === "modelHosts:begin")).toHaveLength(1);
    expect(f.startSender).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(f.file, "utf8")).requests).toHaveLength(1);
  });

  it("does not replay a sender that might have started before a process restart", async () => {
    const f = fixture(request({ stage: "sender-starting", selection: local, executionId: undefined }));
    await f.manager.tick(); await f.manager.tick();
    expect(f.startSender).not.toHaveBeenCalled();
    expect(f.mutation).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(f.file, "utf8")).requests[0].stage).toBe("sender-starting");
  });

  it("does not apply a queued hosted request's model over another active request", async () => {
    const f = fixture(request({ stage: "begin", target: undefined, transferKey: undefined }));
    f.setSelection(local);
    f.setStatus({ runId: "run1", runStatus: "queued", route: "host", currentExecutionId: "execution1",
      hostId: remote.source!.hostId, sourceId: remote.source!.sourceId, model: remote.model, provider: "claudeAgent" });
    await f.manager.tick();
    expect(f.switchTaskModel).not.toHaveBeenCalled();
  });

  it("does not reset an active conversation's model session when confirming a queued request", async () => {
    const f = fixture(request({ stage: "begin", target: undefined, transferKey: undefined }));
    f.setStatus({ runId: "run1", runStatus: "queued", route: "host", currentExecutionId: "execution1",
      hostId: remote.source!.hostId, sourceId: remote.source!.sourceId, model: remote.model, provider: "claudeAgent" });
    await f.manager.tick();
    expect(f.switchTaskModel).not.toHaveBeenCalled();
  });

  it("applies a queued request's original model when it becomes active after an earlier fallback", async () => {
    const f = fixture(request({ stage: "begin", target: undefined, transferKey: undefined }));
    f.setSelection(local);
    const active: HostedRequestStatus = { runId: "run1", runStatus: "running", route: "host", currentExecutionId: "execution1",
      hostId: remote.source!.hostId, sourceId: remote.source!.sourceId, model: remote.model, provider: "claudeAgent" };
    f.setStatus({ ...active, runStatus: "queued" });
    await f.manager.tick();
    f.setStatus(active);
    await f.manager.tick();
    expect(f.switchTaskModel).toHaveBeenCalledExactlyOnceWith("bot1", "thread1", remote, false, false,
      { resumeCursors: {}, rewound: true });
  });

  it("does not launch a sender after the account changes during status reconciliation", async () => {
    const f = fixture(request());
    let release!: (value: HostedRequestStatus | null) => void;
    f.query.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const ticking = f.manager.tick();
    await expect.poll(() => Boolean(release)).toBe(true);
    f.signOut();
    release({ runId: "run1", runStatus: "running", route: "sender", currentExecutionId: null,
      previousExecutionId: "execution1", model: local.model, provider: "codex" });
    await ticking;
    expect(f.startSender).not.toHaveBeenCalled();
    expect(f.switchTaskModel).not.toHaveBeenCalled();
    expect(f.mutation).not.toHaveBeenCalled();
  });

  it("ends expired hosted activity without replaying work or claiming it never ran", async () => {
    const f = fixture(request({ stage: "host", target: undefined }));
    f.setStatus({ runId: "run1", runStatus: "running", route: "none", currentExecutionId: "execution1", model: remote.model, provider: "claudeAgent" });
    await f.manager.tick(); await f.manager.tick();
    expect(f.startSender).not.toHaveBeenCalled();
    expect(f.mutation).not.toHaveBeenCalled();
    expect(f.setTaskActivity).toHaveBeenLastCalledWith("bot1", "thread1", "idle");
    expect(f.appendMessage).toHaveBeenCalledWith("thread1", expect.objectContaining({ tool: expect.objectContaining({ name: expect.stringContaining("Work may have run") }) }));
    expect(JSON.parse(readFileSync(f.file, "utf8")).requests).toHaveLength(0);
  });

  it("does not clear a still-running local turn when a different queued request becomes terminal", async () => {
    const f = fixture(request({ stage: "host", target: undefined, queued: true }));
    f.setLocallyRunning(true);
    f.setStatus({ runId: "run1", runStatus: "cancelled", route: "none", currentExecutionId: "execution1", model: remote.model, provider: "claudeAgent" });
    await f.manager.tick();
    expect(f.setTaskActivity).not.toHaveBeenCalled();
    expect(f.startSender).not.toHaveBeenCalled();
    expect(f.mutation).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(f.file, "utf8")).requests).toHaveLength(0);
  });
});
