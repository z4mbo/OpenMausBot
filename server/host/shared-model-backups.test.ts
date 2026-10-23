import { describe, expect, it, vi } from "vitest";
import type { ProviderInstance } from "../contracts.ts";
import type { HostedRequest } from "../origin-hosted-requests.ts";
import { Store } from "../store.ts";
import { createSharedModelBackups } from "./shared-model-backups.ts";

const local = { instanceId: "my-subscription", model: "sonnet" };
const remote = { instanceId: "origin-remote", model: "sonnet", source: { hostId: "host", sourceId: "source" } };

function fixture(folder: string | undefined, pinned?: string | null) {
  const store = new Store(() => remote);
  const bot = store.createBot({ name: "Researcher", modelSelection: remote });
  store.patchBot(bot.id, { cwd: folder, fallback: [local], approvalMode: "ask" });
  const task = store.createTask(bot.id, "Shared conversation", false)!;
  if (pinned !== undefined) store.patchTask(bot.id, task.threadId, { cwd: pinned });
  const snapshot = vi.fn(async () => ({ state: "available" as const, authenticated: true }));
  const instance = { enabled: true, driverKind: "claudeAgent", snapshot } as unknown as ProviderInstance;
  const backups = createSharedModelBackups({ store, instance: () => instance,
    checkedLocal: selection => ({ ok: true, selection }), providerRefusal: () => undefined,
    validateHosted: vi.fn(async () => ({ provider: "claudeAgent" })), fallbackRefusal: () => undefined,
    start: vi.fn(async () => { throw new Error("Preparation must not execute a request"); }),
  });
  const request: HostedRequest = { id: "receipt", origin: "http://127.0.0.1:54321", userId: "member", botId: bot.id,
    threadId: task.threadId, cloudThreadId: "canonical", teamId: "workspace", clientId: "send:one", messageId: "message",
    selection: remote, stage: "host", runId: "run", executionId: "execution", quota: true, cancelRequested: false,
    visited: [], blockedAccounts: [], createdAt: 1 };
  return { store, bot, task, request, snapshot, next: () => backups.nextHostedBackup(request, () => true) };
}

describe("hosted quota fallback to a local project conversation", () => {
  it("uses the agent project folder when the new conversation has no folder override", async () => {
    const f = fixture("C:\\synthetic-project");
    expect(f.task.cwd).toBeUndefined();
    expect(await f.next()).toEqual({ selection: local, provider: "claudeAgent" });
    expect(f.snapshot).toHaveBeenCalledOnce();
  });

  it("accepts a conversation's pinned folder without an agent default", async () => {
    const f = fixture(undefined, "C:\\synthetic-thread");
    expect(await f.next()).toEqual({ selection: local, provider: "claudeAgent" });
  });

  it("does not replace an explicit no-folder setting with the agent's folder", async () => {
    const f = fixture("C:\\synthetic-project", null);
    expect(await f.next()).toBeNull();
    expect(f.snapshot).not.toHaveBeenCalled();
  });
});
