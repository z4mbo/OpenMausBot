import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { ModelSelection } from "./contracts.ts";
import { chooseModelBackup } from "./model-backup.ts";
import { createSharedAgents, type CloudConnection } from "./origin-shared-agents.ts";
import type { Message } from "./store.ts";

it.each(["validation-refusal", "unknown-offer"] as const)("distinguishes pre-seed refusal from potentially accepted transfer: %s", async failure => {
  const home = mkdtempSync(join(tmpdir(), "origin-hosted-transfer-review-"));
  const cloud = join(home, "cloud.json"), state = join(home, "state.json"), links = join(home, "links.json");
  writeFileSync(cloud, JSON.stringify({ url: "https://fixture.invalid", sessionToken: "synthetic-token", projects: {} }));
  writeFileSync(links, JSON.stringify({ threads: { thread1: "cloud1" } }));
  const local: ModelSelection = { instanceId: "mine", model: "local-model" };
  const remote: ModelSelection = { instanceId: "origin-remote", model: "remote-model", source: { hostId: "host1", sourceId: "source1" } };
  const task = { threadId: "thread1", title: "Shared fixture", createdAt: 5 };
  const bot = { id: "bot1", name: "Researcher", shared: { agentId: "agent1", teamId: "team1" }, modelSelection: local, quotaFallback: true, fallback: [remote] };
  const message = { id: "message1", role: "user", kind: "text", text: "Canonical work", sendId: "send1", at: 1 } as Message;
  const mutation = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    if (name === "agentRuns:begin") return { runId: "run1", status: "running", messageId: message.id };
    if (name === "agentRuns:heartbeat") return { status: "running" };
    if (name === "modelHosts:offerExisting" && failure === "unknown-offer") throw new Error("The offer acknowledgement was lost");
    return null;
  });
  const port: CloudConnection = { query: async () => ({ _id: "user1", name: "Requester" }), mutation, subscribe: () => () => undefined, close: vi.fn() };
  const validate = vi.fn(async () => ({ provider: "claudeAgent" })).mockResolvedValueOnce({ provider: "claudeAgent" });
  if (failure === "validation-refusal") validate.mockRejectedValueOnce(new Error("Source went offline after the chooser's catalog read"));
  const manager = createSharedAgents({
    store: { bots: [bot], bot: () => bot, projectBotForTask: () => bot, taskByThread: () => task,
      messagesFor: () => [message], patchTask: (_bot: string, _thread: string, patch: object) => Object.assign(task, patch),
      onChange: () => () => undefined, patchMessage: vi.fn(), setTaskActivity: vi.fn(), switchTaskModel: vi.fn(),
      appendMessage: () => ({ ...message, id: "note1" }),
    } as never,
    files: { cloud, links, state, outbox: join(home, "outbox.sqlite"), bots: join(home, "bots.json") },
    connect: () => port, instances: async () => [], isBusy: () => true, startQueued: vi.fn(), interrupt: vi.fn(), redact: text => text,
    validateHostedSelection: validate,
  });
  try {
    expect(await manager.beforeSend({ botId: bot.id, threadId: task.threadId, text: message.text!, sendId: message.sendId })).toMatchObject({ status: "running" });
    const picked = await chooseModelBackup({ chain: [remote], visited: new Set<string>(), blockedAccounts: new Set<string>(), current: () => true,
      prepare: async () => validate() });
    expect(picked?.selection).toEqual(remote);
    await expect(manager.transferToHost({ botId: bot.id, threadId: task.threadId, messageId: message.id, selection: picked!.selection,
      visited: [], blockedAccounts: [], current: () => true })).resolves.toBe(failure === "unknown-offer");
    expect(validate).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls.some(([name]) => name === "modelHosts:offerExisting")).toBe(failure === "unknown-offer");
    expect(existsSync(join(home, "origin-hosted-requests.json"))).toBe(failure === "unknown-offer");
  } finally { manager.stop(); rmSync(home, { recursive: true, force: true }); }
});
