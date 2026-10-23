import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelPairKey } from "../shared/model-selection.ts";
import { createHostedRequests, type HostedRequestStatus, type RequestBackup } from "./origin-hosted-requests.ts";
import type { ModelSelection } from "./contracts.ts";
import type { Store, Message } from "./store.ts";

const remote = (name: string): ModelSelection => ({ instanceId: "origin-remote", model: "sonnet", source: { hostId: `host${name}`, sourceId: `source${name}` } });
const local: ModelSelection = { instanceId: "codex", model: "gpt" };
const closes: Array<() => void> = [];
afterEach(() => { for (const close of closes.splice(0)) close(); });
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "origin-requester-"));
  closes.push(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "requests.json");
  const message = { id: "message", role: "user", kind: "text", text: "Work on this shared project", at: 1, sendId: "send1", queued: true, requestPending: true } as Message;
  const messages: Message[] = [message];
  const bot = { id: "bot", modelSelection: remote("a"), quotaFallback: true, fallbackApiAllowed: false };
  let activity = "idle";
  let found: HostedRequestStatus | null = { runId: "run", runStatus: "running", route: "host", currentExecutionId: "executiona", sourceId: "sourcea", hostId: "hosta", model: "sonnet", provider: "claudeAgent", requestKey: "send:send1", executionStatus: "running" };
  let execution = { sourceId: "sourcea", model: "sonnet", requestKey: "send:send1", status: "running", runStatus: "running", currentExecutionId: "executiona", safeToRetry: false, refusal: undefined as string | undefined };
  const port = {
    query: vi.fn(async (name: string) => name === "modelHosts:requestStatus" ? structuredClone(found) : structuredClone(execution)),
    mutation: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "modelHosts:begin") return { runId: "run", executionId: "executiona" };
      if (name === "agentRuns:cancel") { if (found) found.runStatus = "cancelled"; return null; }
      if (name === "modelHosts:advance") {
        const target = args.target as Record<string, string> | null;
        if (!target) { if (found) found.runStatus = "failed"; return { route: "stopped", executionId: null }; }
        if (target.kind === "sender") found = { runId: "run", runStatus: "running", route: "sender", currentExecutionId: null, previousExecutionId: String(args.previousExecutionId), provider: target.provider!, model: target.model! };
        else {
          found = { runId: "run", runStatus: "running", route: "host", currentExecutionId: "executionb", sourceId: target.sourceId, hostId: "hostb", model: target.model!, provider: "claudeAgent", requestKey: String(args.requestKey), executionStatus: "pending" };
          execution = { ...execution, currentExecutionId: "executionb", sourceId: target.sourceId!, requestKey: String(args.requestKey), safeToRetry: false, status: "pending" };
        }
        return { route: found.route, executionId: found.currentExecutionId };
      }
      return null;
    }),
  };
  const identity = {}, scope = { origin: "http://127.0.0.1:54321", userId: "requester", identity, port };
  let currentScope: typeof scope | null = scope;
  const next = vi.fn<() => Promise<RequestBackup | null>>(async () => null);
  const startSender = vi.fn(async () => undefined), handover = vi.fn(() => true), release = vi.fn();
  const store = {
    bot: () => bot, projectBotForTask: () => bot, taskByThread: () => ({ threadId: "thread" }), messagesFor: () => messages,
    patchMessage: (_thread: string, id: string, patch: Partial<Message>) => { const hit = messages.find(row => row.id === id); if (hit) Object.assign(hit, patch); return hit; },
    appendMessage: (_thread: string, input: Partial<Message>) => { const row = { id: `note${messages.length}`, at: 1, ...input } as Message; messages.push(row); return row; },
    setTaskActivity: (_bot: string, _thread: string, value: string) => { activity = value; },
    switchTaskModel: (_bot: string, _thread: string, selection: ModelSelection) => { bot.modelSelection = structuredClone(selection); },
  } as unknown as Store;
  const deps = { file, store, scope: () => currentScope, next, validate: vi.fn(async () => undefined), startSender, handover, release, redact: (value: string) => value };
  const make = () => createHostedRequests(deps);
  let requests = make(); closes.push(() => requests.stop());
  const begin = () => requests.begin({ botId: "bot", threadId: "thread", cloudThreadId: "cloudthread", teamId: "team", clientId: "send:send1", message, selection: remote("a") });
  const refused = (safe = true) => { execution.status = "refused"; execution.refusal = "quota_exhausted"; execution.safeToRetry = safe; };
  return { file, message, messages, bot, port, next, startSender, handover, release, begin, refused,
    requests: () => requests, activity: () => activity,
    found: () => found, execution: () => execution,
    setFound: (value: HostedRequestStatus | null) => { found = value; },
    logout: () => { currentScope = null; },
    restart: () => { requests.stop(); requests = make(); },
  };
}

describe("durable shared request coordination", () => {
  it("records one primary request and follows its canonical completion", async () => {
    const f = fixture(); await f.begin();
    expect(f.port.mutation.mock.calls.filter(([name]) => name === "modelHosts:begin")).toHaveLength(1);
    expect(f.message.queued).toBeUndefined(); expect(f.activity()).toBe("working");
    const saved = readFileSync(f.file, "utf8"); expect(saved).not.toContain("sessionToken"); expect(saved).not.toContain(f.message.text);
    f.found()!.runStatus = "succeeded"; await f.requests().tick();
    expect(f.message.requestPending).toBe(false); expect(f.activity()).toBe("idle");
  });

  it("reconciles a lost begin response across restart without resending work", async () => {
    const f = fixture(); f.setFound(null);
    f.port.mutation.mockImplementationOnce(async () => { throw new Error("Response lost"); });
    await expect(f.begin()).rejects.toThrow("Response lost");
    expect(f.message.requestPending).toBe(true); expect(f.message.queued).toBe(true);
    f.restart(); await f.requests().tick();
    expect(f.port.mutation).toHaveBeenCalledTimes(1);
    f.setFound({ runId: "run", runStatus: "running", route: "host", currentExecutionId: "executiona", sourceId: "sourcea", hostId: "hosta", model: "sonnet", provider: "claudeAgent" });
    await f.requests().tick(); expect(f.message.queued).toBeUndefined(); expect(f.port.mutation).toHaveBeenCalledTimes(1);
  });

  it("does not turn accepted or uncertain work into an automatic retry", async () => {
    const f = fixture(); await f.begin(); f.refused(false); await f.requests().tick();
    expect(f.next).not.toHaveBeenCalled(); expect(f.port.mutation).toHaveBeenCalledTimes(1);
  });

  it("does not infer quota from an unavailable shared primary", async () => {
    const f = fixture(); await f.begin(); f.refused(); f.execution().refusal = "unavailable";
    await f.requests().tick(); expect(f.next).not.toHaveBeenCalled(); expect(f.startSender).not.toHaveBeenCalled();
  });

  it("advances a proved initial quota refusal to the exact ranked remote source", async () => {
    const f = fixture(); await f.begin(); f.refused(); f.next.mockResolvedValue({ selection: remote("b"), provider: "claudeAgent" });
    await f.requests().tick();
    expect(f.port.mutation).toHaveBeenCalledWith("modelHosts:advance", expect.objectContaining({ previousExecutionId: "executiona", target: { sourceId: "sourceb", model: "sonnet", allowMetered: false } }));
    expect(f.bot.modelSelection).toEqual(remote("b"));
    const row = JSON.parse(readFileSync(f.file, "utf8")).requests[0]; expect(row.visited).toContain(modelPairKey(remote("b")));
  });

  it("launches a confirmed sender transfer once, including after repeated snapshots", async () => {
    const f = fixture(); await f.begin(); f.refused(); f.next.mockResolvedValue({ selection: local, provider: "codex" });
    await f.requests().tick(); await f.requests().tick();
    expect(f.startSender).toHaveBeenCalledTimes(1); expect(f.bot.modelSelection).toEqual(local);
    f.restart(); await f.requests().tick(); expect(f.startSender).toHaveBeenCalledTimes(1);
  });

  it("does not advance after the person chooses another model", async () => {
    const f = fixture(); await f.begin(); f.refused(); f.bot.modelSelection = local;
    await f.requests().tick(); expect(f.next).not.toHaveBeenCalled();
  });

  it("keeps Stop pending when acceptance is unknown, then cancels the exact reconciled run", async () => {
    const f = fixture(); f.setFound(null); f.port.mutation.mockRejectedValueOnce(new Error("Response lost"));
    await expect(f.begin()).rejects.toThrow(); await expect(f.requests().cancelThread("bot", "thread")).rejects.toThrow("Stop is not confirmed");
    f.setFound({ runId: "run", runStatus: "running", route: "host", currentExecutionId: "executiona", sourceId: "sourcea", hostId: "hosta", model: "sonnet", provider: "claudeAgent" });
    await f.requests().tick(); expect(f.port.mutation).toHaveBeenCalledWith("agentRuns:cancel", { runId: "run" });
    expect(f.message.requestCancelled).toBe(true); expect(f.startSender).not.toHaveBeenCalled();
  });

  it("ignores an old account's pending response after logout", async () => {
    const f = fixture(); let resolve!: (value: { runId: string; executionId: string }) => void;
    f.port.mutation.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.begin(); await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    f.logout(); resolve({ runId: "run", executionId: "executiona" }); await pending;
    expect(f.port.query).not.toHaveBeenCalled(); expect(f.next).not.toHaveBeenCalled(); expect(f.message.queued).toBe(true);
  });
});
