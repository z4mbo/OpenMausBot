import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { ModelSelection } from "./contracts.ts";
import type { HostedRequest } from "./origin-hosted-requests.ts";
import { createSharedAgents, type CloudConnection } from "./origin-shared-agents.ts";
import type { Message } from "./store.ts";

it.each([false, true])("clears only hosted presentation activity before the confirmed sender launch; physical run=%s", async alreadyRunning => {
  const home = mkdtempSync(join(tmpdir(), "origin-hosted-sender-activity-"));
  const cloud = join(home, "cloud.json"), links = join(home, "links.json"), state = join(home, "state.json");
  writeFileSync(cloud, JSON.stringify({ url: "https://fixture.invalid", sessionToken: "synthetic-token", projects: {} }));
  writeFileSync(links, JSON.stringify({ threads: { thread1: "cloud1" } }));
  const remote: ModelSelection = { instanceId: "origin-remote", model: "remote-model", source: { hostId: "host1", sourceId: "source1" } };
  const local: ModelSelection = { instanceId: "mine", model: "local-model" };
  const pending: HostedRequest = { id: "receipt1", origin: "https://fixture.invalid", userId: "user1", botId: "bot1", threadId: "thread1", cloudThreadId: "cloud1", teamId: "team1",
    clientId: "send:send1", messageId: "message1", selection: remote, stage: "advance", runId: "run1", executionId: "execution1", previousExecutionId: "execution1", transferKey: "transfer1",
    target: { selection: local, provider: "claudeAgent" }, quota: true, cancelRequested: false, visited: [], blockedAccounts: [], createdAt: 1 };
  writeFileSync(join(home, "origin-hosted-requests.json"), JSON.stringify({ version: 1, requests: [pending] }));
  const task = { threadId: "thread1", title: "Shared fixture", createdAt: 5, busy: true, activity: "working" };
  const bot = { id: "bot1", name: "Researcher", shared: { agentId: "agent1", teamId: "team1" }, modelSelection: remote, quotaFallback: true };
  const message = { id: "message1", role: "user", kind: "text", text: "Canonical work", sendId: "send1", at: 1 } as Message;
  let physical = alreadyRunning;
  const launchedFromActivity: string[] = [];
  const setTaskActivity = vi.fn((_bot: string, _thread: string, activity: string) => { task.activity = activity; task.busy = activity !== "idle"; });
  const startHostedSender = vi.fn(async () => { launchedFromActivity.push(task.activity); physical = true; task.busy = true; task.activity = "working"; });
  const mutation = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    if (name === "agentRuns:begin") return { runId: "run1", status: "running", messageId: message.id };
    if (name === "agentRuns:heartbeat") return { status: "running" };
    return null;
  });
  const port: CloudConnection = { query: async name => name === "auth:me" ? { _id: "user1", name: "Requester" } : {
    runId: "run1", runStatus: "running", route: "sender", currentExecutionId: null, previousExecutionId: "execution1", model: local.model, provider: "claudeAgent",
  }, mutation, subscribe: () => () => undefined, close: vi.fn() };
  const manager = createSharedAgents({
    store: { bots: [bot], bot: () => bot, projectBotForTask: () => bot, taskByThread: () => task, messagesFor: () => [message],
      onChange: () => () => undefined, patchMessage: vi.fn(), appendMessage: () => ({ ...message, id: "note1" }), setTaskActivity,
      switchTaskModel: (_bot: string, _thread: string, selection: ModelSelection) => { bot.modelSelection = selection; },
    } as never,
    files: { cloud, links, state, outbox: join(home, "outbox.sqlite"), bots: join(home, "bots.json") },
    connect: () => port, instances: async () => [], isBusy: () => task.busy, locallyRunning: () => physical, startQueued: vi.fn(), interrupt: vi.fn(), redact: text => text,
    validateHostedSelection: vi.fn(async () => undefined), startHostedSender,
  });
  try {
    await manager.tick();
    expect(mutation).toHaveBeenCalledWith("agentRuns:begin", expect.objectContaining({ clientId: "send:send1", threadId: "cloud1" }));
    if (alreadyRunning) {
      expect(startHostedSender).not.toHaveBeenCalled();
      expect(setTaskActivity.mock.calls.some(([, , activity]) => activity === "idle")).toBe(false);
    } else {
      expect(startHostedSender).toHaveBeenCalledTimes(1);
      expect(launchedFromActivity).toEqual(["idle"]);
    }
    expect(task.activity).toBe("working"); expect(task.busy).toBe(true);
  } finally { manager.stop(); rmSync(home, { recursive: true, force: true }); }
});
