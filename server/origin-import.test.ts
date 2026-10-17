import { mkdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "./config.ts";
import { json, readBody } from "./harness/http.ts";
import { closeMessageDb } from "./message-db.ts";
import { readOriginCloud, writeOriginCloud } from "./origin-cloud.ts";
import { readWorkspaceLinks } from "./origin-cloud-sync.ts";
import { createOriginImportRoutes } from "./origin-import.ts";
import { DEFAULT_TEAM_ROLES } from "./origin-teams.ts";
import type { RequestAuth } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { Store, type BotRecord } from "./store.ts";
import type { WireBot } from "../shared/wire.ts";

const selection = { instanceId: "local-fixture", model: "fixture-model", effort: "low" as const };
const LEAD = { title: "Lead", description: "Project lead", soul: "Delegate to the project's specialists." };
const servers: Server[] = [];
const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(options: { limit?: number; auth?: RequestAuth; linksFile?: string; selectionError?: string } = {}) {
  const store = new Store(() => selection);
  const cloudFile = join(DATA_DIR, "origin-cloud.json");
  const linksFile = options.linksFile ?? join(DATA_DIR, "origin-cloud-links.json");
  writeOriginCloud(cloudFile, { url: "http://127.0.0.1:3210", sessionToken: "fixture-owner", projects: {} });
  const query = vi.fn(async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (args.sessionToken !== "fixture-owner") throw new Error("Login required");
    if (name === "workspaces:list") return [{ _id: "team1", name: "Studio" }, { _id: "team2", name: "Second" }];
    if (name === "projects:get" && args.projectId === "project1") return { _id: "project1", teamId: "team1", name: "App" };
    throw new Error("No access");
  });
  const changed = vi.fn();
  const defaultSelection = vi.fn(async () => selection);
  const authorized = vi.fn(() => true);
  const routes = [createOriginImportRoutes({
    store, maxWorkspaceBots: options.limit ?? 1000, cloudFile, linksFile,
    wireBot: (bot) => ({ id: bot.id, name: bot.name, section: bot.section, chiefOfStaff: bot.chiefOfStaff, modelSelection: bot.modelSelection }) as WireBot,
    defaultSelection, authorized, selectionError: () => options.selectionError ?? null, connect: () => ({ query, mutation: async () => { throw new Error("No cloud writes"); } }), changed,
  })];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: options.auth ?? owner, json, readBody })) json(res, 404, {});
    } catch { json(res, 500, { error: "Fixture write failed" }); }
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (kind: "workspace" | "project", body: unknown) => {
    const response = await fetch(`${base}/api/origin/import/${kind}s`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { bot?: WireBot; members?: WireBot[]; replayed?: boolean; error?: string } };
  };
  const workspace = (cloudTeamId = "team1") => call("workspace", { cloudTeamId });
  const project = (workspaceId: string, extra: Record<string, unknown> = {}) => call("project", { cloudProjectId: "project1", cloudTeamId: "team1", workspaceId, ...LEAD, ...extra });
  return { store, cloudFile, linksFile, query, changed, defaultSelection, authorized, call, workspace, project };
}

describe("resumable Origin imports through HTTP", () => {
  it("atomically creates a complete project, links it, and replays concurrent or lost-response retries after reload", async () => {
    const f = await fixture();
    const head = (await f.workspace()).body.bot!;
    const answers = await Promise.all([f.project(head.id), f.project(head.id), f.project(head.id)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(answers.map((answer) => answer.body.bot!.id)).size).toBe(1);
    const chief = answers[0].body.bot!;
    expect(f.store.bots).toHaveLength(8);
    expect(answers[0].body.members?.map((member) => member.name)).toEqual(DEFAULT_TEAM_ROLES.map((role) => role.name));
    expect(f.store.bot(head.id)?.managedSections).toEqual([chief.section]);
    for (const bot of f.store.bots) expect(bot.modelSelection).toEqual(selection);
    expect(readWorkspaceLinks(f.linksFile)).toEqual({ [head.id]: "team1" });
    expect(readOriginCloud(f.cloudFile).projects).toEqual({ [chief.id]: "project1" });
    const loaded = new Store(() => selection);
    expect(loaded.bots).toHaveLength(8);
    expect(loaded.bot(chief.id)?.originImport).toMatchObject({ deployment: "http://127.0.0.1:3210", kind: "project", cloudId: "project1", workspaceId: head.id, memberIds: expect.any(Array) });
    f.store.bots = loaded.bots;
    expect(await f.project(head.id)).toMatchObject({ status: 200, body: { bot: { id: chief.id }, replayed: true } });
    expect(f.store.bots).toHaveLength(8);
    expect(f.changed).toHaveBeenCalledOnce();
  });

  it("rejects repeated full-team capacity failures without creating orphan Chiefs or changing the workspace", async () => {
    const f = await fixture({ limit: 7 });
    const head = (await f.workspace()).body.bot!;
    for (let round = 0; round < 3; round++) expect(await f.project(head.id)).toMatchObject({ status: 409, body: { error: "this workspace is limited to 7 bots" } });
    expect(f.store.bots.map((bot) => bot.id)).toEqual([head.id]);
    expect(f.store.bot(head.id)?.managedSections).toBeUndefined();
    expect(readOriginCloud(f.cloudFile).projects).toEqual({});
  });

  it.each(["Workspace: Billing", "Agents"])("keeps the project name %s out of reserved workspace and standalone sections", async (name) => {
    const f = await fixture();
    const head = (await f.workspace()).body.bot!;
    f.query.mockResolvedValueOnce({ _id: "project1", teamId: "team1", name });
    const answer = await f.project(head.id);
    expect(answer.status).toBe(201);
    expect(answer.body.bot).toMatchObject({ name, section: `Project: ${name}`, chiefOfStaff: true });
    expect(f.store.bot(head.id)?.managedSections).toEqual([`Project: ${name}`]);
    expect((await f.project(head.id)).status).toBe(200);
  });

  it("does not publish any part of a project or grant if the atomic bot write fails", async () => {
    const f = await fixture();
    const head = (await f.workspace()).body.bot!;
    const save = vi.spyOn(f.store as unknown as { saveBots(bots?: BotRecord[]): void }, "saveBots").mockImplementationOnce(() => { throw new Error("disk full"); });
    expect((await f.project(head.id)).status).toBe(500);
    save.mockRestore();
    expect(f.store.bots.map((bot) => bot.id)).toEqual([head.id]);
    expect(f.store.bot(head.id)?.managedSections).toBeUndefined();
    expect(new Store(() => selection).bots.map((bot) => bot.id)).toEqual([head.id]);
    expect(readOriginCloud(f.cloudFile).projects).toEqual({});
    expect((await f.project(head.id)).status).toBe(201);
    expect(f.store.bots).toHaveLength(8);
  });

  it("reconnects a saved workspace after a failed link write without recreating its head", async () => {
    const linksFile = join(DATA_DIR, "missing-parent", "links.json");
    const f = await fixture({ linksFile });
    expect((await f.workspace()).status).toBe(503);
    const head = f.store.bots[0];
    expect(f.store.bots).toHaveLength(1);
    mkdirSync(join(DATA_DIR, "missing-parent"));
    f.store.bots = new Store(() => selection).bots;
    expect(await f.workspace()).toMatchObject({ status: 200, body: { bot: { id: head.id }, replayed: true } });
    expect(f.store.bots).toHaveLength(1);
    expect(readWorkspaceLinks(linksFile)).toEqual({ [head.id]: "team1" });
  });

  it("reconnects a complete project after a failed link write without recreating its Chief or specialists", async () => {
    const f = await fixture();
    const head = (await f.workspace()).body.bot!;
    const blocked = `${f.cloudFile}.${process.pid}.tmp`;
    mkdirSync(blocked);
    expect((await f.project(head.id)).status).toBe(503);
    expect(f.store.bots).toHaveLength(8);
    const chief = f.store.bots.find((bot) => bot.originImport?.kind === "project")!;
    expect(readOriginCloud(f.cloudFile).projects).toEqual({});
    rmdirSync(blocked);
    f.store.bots = new Store(() => selection).bots;
    expect(await f.project(head.id)).toMatchObject({ status: 200, body: { bot: { id: chief.id }, members: expect.any(Array), replayed: true } });
    expect(f.store.bots).toHaveLength(8);
    expect(readOriginCloud(f.cloudFile).projects).toEqual({ [chief.id]: "project1" });
  });

  it("does not import inaccessible cloud ids, a project under the wrong workspace, or a non-admin request", async () => {
    const f = await fixture();
    expect((await f.workspace("foreign")).status).toBe(403);
    const other = (await f.workspace("team2")).body.bot!;
    expect((await f.project(other.id, { cloudTeamId: "team2" })).status).toBe(403);
    expect((await f.project(other.id)).status).toBe(409);
    expect(f.store.bots).toHaveLength(1);
    const denied = await fixture({ auth: { kind: "loopback", scopes: ["client"] } });
    expect((await denied.workspace()).status).toBe(403);
    expect(denied.query).not.toHaveBeenCalled();
    expect(denied.store.bots).toHaveLength(1);
  });

  it("rejects an account switch while access verification is pending", async () => {
    const f = await fixture();
    const gate = deferred<unknown>();
    f.query.mockReturnValueOnce(gate.promise);
    const request = f.workspace();
    await vi.waitFor(() => expect(f.query).toHaveBeenCalledOnce());
    writeOriginCloud(f.cloudFile, { url: "http://127.0.0.1:3210", sessionToken: "other-account", projects: {} });
    gate.resolve([{ _id: "team1", name: "Studio" }]);
    expect(await request).toMatchObject({ status: 409, body: { error: "The Origin account changed during import. Try again." } });
    expect(f.store.bots).toHaveLength(0);
  });

  it("rejects an account switch while choosing the default model", async () => {
    const f = await fixture();
    const gate = deferred<typeof selection>();
    f.defaultSelection.mockReturnValueOnce(gate.promise);
    const request = f.workspace();
    await vi.waitFor(() => expect(f.defaultSelection).toHaveBeenCalledOnce());
    writeOriginCloud(f.cloudFile, { url: "http://127.0.0.1:4321", sessionToken: "fixture-owner", projects: {} });
    gate.resolve(selection);
    expect((await request).status).toBe(409);
    expect(f.store.bots).toHaveLength(0);
  });

  it("rechecks cloud access before replaying a saved import", async () => {
    const f = await fixture();
    expect((await f.workspace()).status).toBe(201);
    f.query.mockRejectedValueOnce(new Error("Membership revoked"));
    expect((await f.workspace()).status).toBe(403);
    expect(f.store.bots).toHaveLength(1);
  });

  it("does not allocate a team after the local admin session is revoked during model selection", async () => {
    const f = await fixture();
    const gate = deferred<typeof selection>();
    f.defaultSelection.mockReturnValueOnce(gate.promise);
    const request = f.workspace();
    await vi.waitFor(() => expect(f.defaultSelection).toHaveBeenCalledOnce());
    f.authorized.mockReturnValue(false);
    gate.resolve(selection);
    expect(await request).toMatchObject({ status: 403, body: { error: "The local admin session is no longer available" } });
    expect(f.store.bots).toHaveLength(0);
  });

  it("honors hosted model restrictions before allocating any imported bots", async () => {
    const f = await fixture({ selectionError: "No company models are assigned" });
    expect(await f.workspace()).toMatchObject({ status: 400, body: { error: "No company models are assigned" } });
    expect(f.store.bots).toHaveLength(0);
  });

  it("scopes durable import identities to the deployment and refuses to replay a locally changed team", async () => {
    const f = await fixture();
    const first = (await f.workspace()).body.bot!;
    writeOriginCloud(f.cloudFile, { url: "http://127.0.0.1:4321", sessionToken: "fixture-owner", projects: {} });
    const second = (await f.workspace()).body.bot!;
    expect(second.id).not.toBe(first.id);
    expect(f.store.bots).toHaveLength(2);
    f.store.patchBot(second.id, { chiefOfStaff: false });
    expect((await f.workspace()).status).toBe(409);
    expect(f.store.bots).toHaveLength(2);
    expect(readFileSync(join(DATA_DIR, "bots.json"), "utf8")).toContain("originImport");
  });
});
