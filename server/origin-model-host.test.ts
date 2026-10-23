import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { definitionHash, definitionOf } from "../shared/origin-shared-agents.ts";
import { createOriginModelHost } from "./origin-model-host.ts";
import type { ProviderInstance } from "./contracts.ts";
import type { HostedSource, HostedWork } from "./origin-model-host-types.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
const saveInput = { teamId: "team1", instanceId: "owner-local-claude", label: "Owner Claude", models: ["claude-fixture"], enabled: true, projectIds: [], workspaceHead: true, capacity: 1 };

function fixture(ready = true, loopbackOnly = false) {
  const folder = mkdtempSync(join(tmpdir(), "origin-model-host-controller-"));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  const cloud = join(folder, "cloud.json"), state = join(folder, "host-state.json");
  const setAccount = (sessionToken = "synthetic-owner-session") => writeFileSync(cloud, JSON.stringify({ url: "https://fixture.invalid", sessionToken, projects: {} }));
  setAccount();
  const bot = { id: "local-agent", name: "Researcher", title: "Researcher", description: "", soul: "Research in this project", color: "blue", cwd: folder,
    shared: { agentId: "agent1", teamId: "team1" } };
  const snapshot = { state: "available", authenticated: true, billing: "subscription" } as { state: "available" | "unavailable"; authenticated: boolean; billing: "subscription" | "metered" };
  const models = { default: "claude-fixture", options: [{ id: "claude-fixture", label: "Claude" }] };
  const local = { instanceId: "owner-local-claude", driverKind: "claudeAgent", enabled: true, models, snapshot: vi.fn(async () => ({ ...snapshot })), adapter: { capabilities: { guestTurns: "confined" } } } as unknown as ProviderInstance;
  let pending: HostedWork[] = [];
  const source: HostedSource = { hostId: "host1", sourceId: "source1", ownerUserId: "owner1", ownerName: "Owner", computerName: "Owner computer", provider: "claudeAgent", label: "Owner Claude", billing: "subscription", models: ["claude-fixture"], heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000, capacity: 1 };
  const calls: Array<{ sessionToken?: string; name: string; args: Record<string, unknown> }> = [];
  const connect = (_origin: string, sessionToken?: string) => ({
    query: async (name: string, args: Record<string, unknown>) => {
      calls.push({ sessionToken, name, args });
      if (name === "auth:me") return { _id: sessionToken === "synthetic-owner-session" ? "owner1" : "owner2", name: "Owner" };
      if (name === "modelHosts:catalog") return [source];
      if (name === "modelHosts:pending") return pending;
      return null;
    },
    mutation: async (name: string, args: Record<string, unknown>) => {
      calls.push({ sessionToken, name, args });
      if (name === "modelHosts:register") return { hostId: "host1", hostToken: "a".repeat(64), created: true };
      if (name === "modelHosts:setSource") return "source1";
      if (name === "modelHosts:claim") return { work: pending.find(work => work.executionId === args.executionId), leaseUntil: Date.now() + 60_000 };
      if (name === "modelHosts:context") return { requestSeq: 1, nextSeq: 0, more: false, messages: [] };
      return null;
    },
  });
  const preflight = vi.fn(async () => undefined);
  const run = vi.fn(async input => { await input.beforeDispatch(); return { ok: true }; });
  const host = createOriginModelHost({ ready, loopbackOnly, store: { bots: [bot], bot: (id: string) => id === bot.id ? bot : null } as never,
    instances: async () => [{ instanceId: local.instanceId, driverKind: local.driverKind, enabled: true, models, snapshot }], instance: id => id === local.instanceId ? local : undefined,
    folder: () => ({ path: folder, state: { kind: "empty" } }), preflight, run, files: { state, cloud }, connect, computerName: "Fixture computer" });
  cleanups.push(() => host.stop());
  const savedAccount = () => Object.values(JSON.parse(readFileSync(state, "utf8")).accounts)[0] as any;
  const queue = (sourceKey: string, patch: Partial<HostedWork> = {}) => {
    const definition = definitionOf(bot);
    pending = [{ executionId: "exec1", runId: "run1", threadId: "thread1", agentId: "agent1", teamId: "team1", sourceId: "source1", sourceKey,
      provider: "claudeAgent", model: "claude-fixture", requesterUserId: "requester1", requesterName: "Requester", requestClientId: "send:request1", requestSeq: 1,
      text: "Canonical task", definitionVersion: 1, definitionHash: definitionHash(definition), definition, status: "pending", billing: "subscription", allowMetered: false, ...patch }];
  };
  return { folder, cloud, state, host, bot, calls, snapshot, models, local, source, preflight, run, savedAccount, queue, setAccount };
}

describe("owner-controlled native model hosting", () => {
  it("refuses a non-loopback backend in sealed verification mode before any cloud call", async () => {
    const f = fixture(true, true);
    await expect(f.host.save(saveInput)).rejects.toThrow("isolated loopback backend");
    expect(f.calls).toEqual([]);
    expect(existsSync(f.state)).toBe(false);
    expect(f.run).not.toHaveBeenCalled();
  });

  it("holds every unfinished remote path without registration, provider reads, execution or local rerouting", async () => {
    const f = fixture(false);
    expect(await f.host.settings()).toMatchObject({ ready: false, hosts: [], instances: [], teams: [] });
    expect(await f.host.catalog(f.bot.id)).toEqual([]);
    await expect(f.host.save(saveInput)).rejects.toMatchObject({ code: "model_host_not_ready", status: 503 });
    await expect(f.host.validateSelection(f.bot.id, { instanceId: "origin-remote", model: "claude-fixture", source: { hostId: "host1", sourceId: "source1" } }, true)).rejects.toMatchObject({ code: "model_host_not_ready" });
    await expect(f.host.revoke("team1")).rejects.toMatchObject({ code: "model_host_not_ready" });
    f.host.start(); await f.host.tick();
    expect(f.calls).toEqual([]); expect(f.local.snapshot).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled(); expect(existsSync(f.state)).toBe(false);
  });
  it("never registers or enables an account merely by opening settings or listing eligible models", async () => {
    const f = fixture(); const settings = await f.host.settings(); await f.host.catalog(f.bot.id);
    expect(settings.hosts).toEqual([]); expect(existsSync(f.state)).toBe(false);
    expect(f.calls.some(call => call.name === "modelHosts:register" || call.name === "modelHosts:setSource")).toBe(false);
  });

  it("publishes only an explicit source grant and never exposes the private host token in settings", async () => {
    const f = fixture(); const source = await f.host.save(saveInput);
    expect(source).toMatchObject({ instanceId: "owner-local-claude", sourceId: "source1", billing: "subscription", enabled: true });
    expect(f.calls.find(call => call.name === "modelHosts:setSource")?.args).toMatchObject({ hostId: "host1", provider: "claudeAgent", models: ["claude-fixture"], workspaceHead: true });
    const settings = await f.host.settings();
    expect(JSON.stringify(settings)).not.toContain("a".repeat(64)); expect(JSON.stringify(settings)).not.toContain("synthetic-owner-session");
    expect(f.savedAccount().hostToken).toBe("a".repeat(64));
  });

  it("does not allow a catalog or model choice outside the shared agent's scoped project", async () => {
    const f = fixture();
    writeFileSync(f.cloud, JSON.stringify({ url: "https://fixture.invalid", sessionToken: "synthetic-owner-session", projects: { [f.bot.id]: "project1" } }));
    await f.host.catalog(f.bot.id);
    expect(f.calls.find(call => call.name === "modelHosts:catalog")?.args).toMatchObject({ teamId: "team1", projectId: "project1" });
    await expect(f.host.validateSelection(f.bot.id, { instanceId: "origin-remote", model: "claude-fixture", source: { hostId: "another-host", sourceId: "source1" } }, true)).rejects.toThrow("offline or no longer shared");
  });

  it("requires paid consent separately from being present in the catalog", async () => {
    const f = fixture(); f.source.billing = "metered";
    const choice = { instanceId: "origin-remote", model: "claude-fixture", source: { hostId: "host1", sourceId: "source1" } };
    await expect(f.host.validateSelection(f.bot.id, choice)).rejects.toThrow("explicit permission");
    await expect(f.host.validateSelection(f.bot.id, choice, true)).resolves.toMatchObject({ sourceId: "source1" });
  });

  it("allows disabling a stale account even after its former models disappear", async () => {
    const f = fixture(); const source = await f.host.save(saveInput);
    f.models.default = "different-model"; f.models.options = []; f.snapshot.state = "unavailable";
    expect(await f.host.save({ ...saveInput, sourceKey: source.sourceKey, enabled: false })).toMatchObject({ enabled: false });
  });

  it("executes only a matching local agent with its own project folder, account and budget admission", async () => {
    const f = fixture(); const source = await f.host.save(saveInput); f.queue(source.sourceKey);
    await f.host.tick(); await expect.poll(() => f.calls.filter(call => call.name === "modelHosts:finish").length).toBe(1);
    expect(f.preflight).toHaveBeenCalledWith(f.bot.id, f.local, "claude-fixture"); expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.run.mock.calls[0]?.[0]).toMatchObject({ botId: f.bot.id, instanceId: "owner-local-claude", cwd: f.folder, work: { requesterUserId: "requester1" } });
    for (const call of f.calls.filter(call => ["modelHosts:claim", "modelHosts:context", "modelHosts:started", "modelHosts:finish"].includes(call.name))) expect(call.sessionToken).toBeUndefined();
  });

  it.each(["definition", "project", "billing", "budget"])("declines an offered request before acceptance if its %s changed", async changed => {
    const f = fixture(); const source = await f.host.save(saveInput); f.queue(source.sourceKey);
    if (changed === "definition") f.bot.soul = "Owner edited instructions pending review";
    if (changed === "project") writeFileSync(f.cloud, JSON.stringify({ url: "https://fixture.invalid", sessionToken: "synthetic-owner-session", projects: { [f.bot.id]: "different-project" } }));
    if (changed === "billing") f.snapshot.billing = "metered";
    if (changed === "budget") f.preflight.mockRejectedValue(new Error("Daily cap reached"));
    await f.host.tick(); await expect.poll(() => f.calls.some(call => call.name === "modelHosts:decline")).toBe(true);
    expect(f.run).not.toHaveBeenCalled(); expect(f.calls.some(call => call.name === "modelHosts:claim")).toBe(false);
  });

  it("does not publish the previous person's source settings after the Origin account changes", async () => {
    const f = fixture(); await f.host.save(saveInput); f.setAccount("synthetic-new-account");
    expect((await f.host.settings()).hosts).toEqual([]);
  });
});
