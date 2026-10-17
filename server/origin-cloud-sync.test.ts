import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { readOriginCloud, writeOriginCloud } from "./origin-cloud.ts";
import { applyLinkPatch, createCloudLinkRoutes, liveLinks, readWorkspaceLinks, writeWorkspaceLinks } from "./origin-cloud-sync.ts";
import type { RequestAuth } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";
import type { BotRecord } from "./store.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function tempFolder() {
  const folder = mkdtempSync(join(tmpdir(), "omb-cloud-links-"));
  folders.push(folder);
  return folder;
}

const bots = () => [
  { id: "head", name: "GGs", section: "Workspace: GGs", chiefOfStaff: true },
  { id: "head2", name: "weeh", section: "Workspace: weeh", chiefOfStaff: true },
  { id: "kai", name: "Kai", section: "Kai", chiefOfStaff: true },
  { id: "dev", name: "Developer", section: "Kai" },
] as unknown as BotRecord[];

describe("cloud link store", () => {
  it("round-trips workspace links and reads a missing or corrupt file as empty", () => {
    const file = join(tempFolder(), "links.json");
    expect(readWorkspaceLinks(file)).toEqual({});
    writeWorkspaceLinks(file, { head: "team1" });
    expect(readWorkspaceLinks(file)).toEqual({ head: "team1" });
    writeWorkspaceLinks(file, { head: 3 as unknown as string });
    expect(readWorkspaceLinks(file)).toEqual({});
  });

  it("drops links of deleted bots and workspace links of bots that no longer head a workspace", () => {
    const live = liveLinks(bots(), { workspaces: { head: "t1", kai: "t2", gone: "t3" }, projects: { kai: "p1", gone: "p2" } });
    expect(live).toEqual({ workspaces: { head: "t1" }, projects: { kai: "p1" } });
  });

  it("applies a patch, unlinks on null, keeps a cloud workspace on one head, and rejects bad input", () => {
    const start = { workspaces: { head: "t1" }, projects: {} };
    expect(applyLinkPatch(bots(), start, { workspaces: { head2: "t1" }, projects: { kai: "p1" } }))
      .toEqual({ workspaces: { head2: "t1" }, projects: { kai: "p1" } });
    expect(applyLinkPatch(bots(), { workspaces: {}, projects: { kai: "p1" } }, { projects: { kai: null } })).toEqual({ workspaces: {}, projects: {} });
    expect(applyLinkPatch(bots(), start, { workspaces: { kai: "t2" } })).toBe("kai is not a workspace head");
    expect(applyLinkPatch(bots(), start, { projects: { nobody: "p1" } })).toBe("No such bot: nobody");
    expect(applyLinkPatch(bots(), start, { projects: { kai: "../x" } })).toBe("projects.kai must be an Origin id or null");
  });
});

async function serve(auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] }) {
  const folder = tempFolder();
  const linksFile = join(folder, "origin-cloud-links.json");
  const cloudFile = join(folder, "origin-cloud.json");
  const store = { bots: bots() };
  const routes = [createCloudLinkRoutes({ store, linksFile, cloudFile })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "next" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, body?: unknown) => {
    const response = await fetch(`${base}/api/origin/cloud-links`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return [response.status, await response.json()] as const;
  };
  return { call, store, linksFile, cloudFile };
}

describe("cloud link routes", () => {
  it("stores workspace links on their own and project links beside the Origin session", async () => {
    const { call, linksFile, cloudFile } = await serve();
    writeOriginCloud(cloudFile, { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: {} });
    expect(await call("GET")).toEqual([200, { workspaces: {}, projects: {} }]);
    expect(existsSync(linksFile)).toBe(false);
    expect(await call("PUT", { workspaces: { head: "t1" }, projects: { kai: "p1" } })).toEqual([200, { workspaces: { head: "t1" }, projects: { kai: "p1" } }]);
    expect(readWorkspaceLinks(linksFile)).toEqual({ head: "t1" });
    expect(readOriginCloud(cloudFile)).toEqual({ url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { kai: "p1" } });
    expect((await call("PUT", { workspaces: { kai: "t2" } }))[0]).toBe(400);
  });

  it("prunes links of deleted bots from both files on read", async () => {
    const { call, store, linksFile, cloudFile } = await serve();
    await call("PUT", { workspaces: { head: "t1" }, projects: { kai: "p1", dev: "p2" } });
    store.bots = store.bots.filter((bot) => bot.id !== "kai" && bot.id !== "head");
    expect(await call("GET")).toEqual([200, { workspaces: {}, projects: { dev: "p2" } }]);
    expect(readWorkspaceLinks(linksFile)).toEqual({});
    expect(readOriginCloud(cloudFile).projects).toEqual({ dev: "p2" });
  });

  it("needs the admin scope to change links", async () => {
    const { call } = await serve({ kind: "loopback", scopes: ["client"] });
    expect((await call("GET"))[0]).toBe(200);
    expect((await call("PUT", { projects: { kai: "p1" } }))[0]).toBe(403);
  });
});
