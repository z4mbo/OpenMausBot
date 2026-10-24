import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSelection } from "./contracts.ts";
import { createSharedAgents, type CloudConnection } from "./origin-shared-agents.ts";
import type { Message } from "./store.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });

describe("hosted admission Stop boundary", () => {
  it.each([
    { phase: "thread-create", action: "Stop" }, { phase: "host-validation", action: "Stop" },
    { phase: "receipt-validation", action: "Stop" }, { phase: "thread-create", action: "account replacement" },
  ] as const)("does not admit a hosted run after $action during $phase", async ({ phase, action }) => {
    const home = mkdtempSync(join(tmpdir(), "origin-hosted-admission-review-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const cloud = join(home, "cloud.json"), state = join(home, "state.json"), links = join(home, "links.json");
    writeFileSync(cloud, JSON.stringify({ url: "https://fixture.invalid", sessionToken: "synthetic-token", projects: {} }));
    writeFileSync(state, JSON.stringify({ bots: { bot1: { agentId: "agent1", teamId: "team1", boundAt: 1, version: 1, hash: "synthetic" } }, defaults: {} }));
    const modelSelection: ModelSelection = { instanceId: "origin-remote", model: "remote-model", source: { hostId: "host1", sourceId: "source1" } };
    const task = { threadId: "thread1", title: "Shared fixture", createdAt: 5 };
    const bot = { id: "bot1", name: "Researcher", shared: { agentId: "agent1", teamId: "team1" }, modelSelection };
    const messages: Message[] = [];
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const pause = async () => { entered(); await pending; };
    let validations = 0;
    const mutation = vi.fn(async (name: string, _args: Record<string, unknown>) => {
      if (name === "agentThreads:create") { if (phase === "thread-create") await pause(); return "cloud1"; }
      if (name === "modelHosts:begin") return { runId: "run1", executionId: "execution1" };
      return null;
    });
    const port: CloudConnection = {
      query: async name => name === "auth:me" ? { _id: "user1", name: "Requester" } : null,
      mutation, subscribe: (name, _args, update) => { if (name === "agentThreads:messagesSince") void Promise.resolve().then(() => update({ seq: 0, title: "Thread", archived: false, more: false, messages: [], activeRun: null, queued: [] })); return () => undefined; }, close: vi.fn(),
    };
    const manager = createSharedAgents({
      store: { bots: [bot], bot: () => bot, botByThread: () => bot, projectBotForTask: () => bot, taskByThread: () => task,
        messagesFor: () => messages, patchTask: (_bot: string, _thread: string, patch: object) => Object.assign(task, patch),
        onChange: () => () => undefined, appendMessage: (_thread: string, input: object) => {
          const message = { id: `message${messages.length + 1}`, at: 1, ...input } as Message;
          messages.push(message); return message;
        }, patchMessage: vi.fn(), setTaskActivity: vi.fn(), switchTaskModel: vi.fn(),
      } as never,
      files: { cloud, links, state, outbox: join(home, "outbox.sqlite"), bots: join(home, "bots.json") },
      connect: (_url, token) => ({ ...port, query: async name => name === "auth:me" ? { _id: token === "synthetic-token" ? "user1" : "user2", name: "Requester" } : null }),
      instances: async () => [], isBusy: () => false, startQueued: vi.fn(), interrupt: vi.fn(), redact: text => text,
      validateHostedSelection: vi.fn(async () => {
        validations += 1;
        if (phase === "host-validation" && validations === 1 || phase === "receipt-validation" && validations === 2) await pause();
      }),
    });
    cleanups.push(() => manager.stop());
    const sending = manager.beforeSend({ botId: bot.id, threadId: task.threadId, text: "Do not execute after Stop", sendId: "admission1" })
      .then(value => ({ value }), error => ({ error }));
    await waiting;
    try {
      if (action === "Stop") await manager.cancelHosted(bot.id, task.threadId);
      else {
        writeFileSync(cloud, JSON.stringify({ url: "https://fixture.invalid", sessionToken: "replacement-token", projects: {} }));
        await manager.tick();
      }
    } finally { release(); }
    await sending;
    expect(mutation.mock.calls.filter(([name]) => name === "modelHosts:begin")).toHaveLength(0);
  });
});
