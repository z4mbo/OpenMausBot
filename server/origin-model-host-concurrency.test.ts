import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createOriginModelHost } from "./origin-model-host.ts";

it("retains both independent source grants when two windows save against one account", async () => {
  const home = mkdtempSync(join(tmpdir(), "origin-host-grant-race-"));
  const cloud = join(home, "cloud.json");
  writeFileSync(cloud, JSON.stringify({ url: "https://fixture.invalid", sessionToken: "synthetic-session" }));
  const catalog = [{ instanceId: "fixture-account", driverKind: "claudeAgent", enabled: true,
    snapshot: { state: "available", authenticated: true, billing: "subscription" }, models: { default: "fixture-model", options: [] } }];
  const pending: Array<() => void> = [];
  let raced = false, nextSource = 0;
  const host = createOriginModelHost({ ready: true, store: { bots: [] } as never, instances: async () => catalog as never,
    instance: () => ({ adapter: { capabilities: { guestTurns: "confined" } } }) as never,
    folder: () => null, preflight: async () => undefined, run: async () => ({ ok: true }),
    files: { cloud, state: join(home, "host.json") }, connect: () => ({
      query: async name => name === "auth:me" ? { _id: "syntheticowner" } : [],
      mutation: async name => {
        if (name === "modelHosts:register") return { hostId: "synthetichost", hostToken: "a".repeat(64), created: true };
        if (name !== "modelHosts:setSource") return null;
        const sourceId = `source${++nextSource}`;
        if (raced) await new Promise<void>(resolve => pending.push(resolve));
        return sourceId;
      },
    }) });
  const input = { teamId: "syntheticteam", instanceId: "fixture-account", models: ["fixture-model"], enabled: true,
    projectIds: [], workspaceHead: true, capacity: 1 };
  try {
    await host.save({ ...input, label: "Existing account grant" });
    raced = true;
    const saves = [host.save({ ...input, label: "Second window B" }), host.save({ ...input, label: "Third window C" })];
    await expect.poll(() => pending.length).toBe(2);
    for (const release of pending) release();
    await Promise.all(saves);
    const settings = await host.settings();
    expect(settings.hosts).toHaveLength(1);
    expect(settings.hosts[0]?.sources.map(source => source.label).sort()).toEqual([
      "Existing account grant", "Second window B", "Third window C",
    ]);
  } finally { host.stop(); rmSync(home, { recursive: true, force: true }); }
});
