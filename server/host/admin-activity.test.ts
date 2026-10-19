import { mkdtempSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flushAdminActivity, readAdminActivityRange } from "../admin-activity.ts";
import { json } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord, Store } from "../store.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { createAdminActivityHost } from "./admin-activity.ts";

const dirs: string[] = [];
const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const service: RequestAuth = { kind: "loopback", trust: "service", scopes: ["client"] };
const before = { features: { browser: true } };
const after = { features: { browser: false } };

function fixture(options: { desktopManaged?: boolean; hostedWorkspace?: boolean; shared?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-admin-host-"));
  dirs.push(dataDir);
  let currentStore: Pick<Store, "bot" | "group"> | undefined;
  const host = createAdminActivityHost({
    dataDir, desktopManaged: options.desktopManaged ?? false, hostedWorkspace: options.hostedWorkspace ?? true,
    sessions: { list: () => [], openPairings: () => [] },
    signInAllowList: () => ({ admins: ["owner@example.test"], members: options.shared ? ["member@example.test"] : [] }),
    lendingEnabled: () => false,
    store: () => {
      if (!currentStore) throw new Error("store not initialized");
      return currentStore;
    },
    webhooks: () => ({ list: () => [] }),
  });
  return {
    host,
    initializeStore: (bots: BotRecord[] = []) => { currentStore = { bot: (id) => bots.find((bot) => bot.id === id) ?? null, group: () => undefined }; },
    rows: async () => {
      await flushAdminActivity(dataDir);
      return readAdminActivityRange(dataDir, { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) });
    },
  };
}

function request() {
  const req = new IncomingMessage(new Socket());
  return { req, res: new ServerResponse(req) };
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

describe("admin activity host", () => {
  it("binds the store after construction and records only a successful response", async () => {
    const { host, initializeStore, rows } = fixture();
    initializeStore();
    const successful = request();
    host.beginAdminAudit(successful.req, successful.res, "POST", "/api/instances/claude/install", owner);
    expect(await rows()).toEqual([]);
    successful.res.statusCode = 200;
    successful.res.emit("finish");
    const failed = request();
    host.beginAdminAudit(failed.req, failed.res, "POST", "/api/instances/claude/auth/complete", owner);
    failed.res.statusCode = 403;
    failed.res.emit("finish");
    expect(await rows()).toMatchObject([
      { category: "engine", action: "engine.install", target: { id: "claude" }, actor: { kind: "loopback" } },
    ]);
    expect(await rows()).toHaveLength(1);
  });

  it("keeps config attribution in its host and restores it after an automatic save", async () => {
    const first = fixture();
    const second = fixture();
    first.initializeStore();
    second.initializeStore();
    const { req, res } = request();
    req.headers["x-openmausbot-cli"] = "1";
    first.host.beginAdminAudit(req, res, "PUT", "/api/config", owner);
    first.host.withoutAdminActor(() => first.host.configSaved(before, after));
    second.host.configSaved(before, after);
    expect(await first.rows()).toEqual([]);
    expect(await second.rows()).toEqual([]);
    first.host.configSaved(before, after);
    expect(await first.rows()).toMatchObject([
      { category: "config", changed: ["features.browser"], actor: { kind: "cli" },
        before: { "features.browser": true }, after: { "features.browser": false } },
    ]);
    const next = request();
    first.host.beginAdminAudit(next.req, next.res, "GET", "/api/config", owner);
    first.host.configSaved(after, before);
    expect(await first.rows()).toHaveLength(1);
  });

  it("does not let a service caller claim CLI attribution", async () => {
    const { host, initializeStore, rows } = fixture();
    initializeStore();
    const { req, res } = request();
    req.headers["x-openmausbot-cli-owner"] = "spoofed";
    host.beginAdminAudit(req, res, "POST", "/api/instances/claude/install", service);
    res.emit("finish");
    expect(await rows()).toMatchObject([{ action: "engine.install", actor: { kind: "worker" } }]);
  });

  it("records each imported bot once and does not record an Origin import replay", async () => {
    const { host, initializeStore, rows } = fixture();
    initializeStore(["chief", "developer"].map((id) => ({
      id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true, color: "red",
      unread: false, modelSelection: { instanceId: "claude", model: "test" }, createdAt: Date.now(), resumeCursors: {},
    })));
    const { req, res } = request();
    host.beginAdminAudit(req, res, "POST", "/api/origin/import/projects", owner);
    json(res, 200, { replayed: true, bot: { id: "chief" }, members: [{ id: "developer" }] });
    res.emit("finish");
    expect(await rows()).toEqual([]);
    const fresh = request();
    host.beginAdminAudit(fresh.req, fresh.res, "POST", "/api/origin/import/projects", owner);
    json(fresh.res, 200, { bot: { id: "chief" }, bots: [{ id: "chief" }], members: [{ id: "developer" }] });
    fresh.res.emit("finish");
    expect((await rows()).map((row) => [row.action, row.target?.id])).toEqual([
      ["bot.create", "chief"], ["bot.create", "developer"],
    ]);
  });

  it("records hosted and shared servers while keeping desktop and private servers quiet", async () => {
    for (const options of [
      { hostedWorkspace: true, expected: true },
      { hostedWorkspace: false, shared: true, expected: true },
      { hostedWorkspace: false, expected: false },
      { desktopManaged: true, shared: true, expected: false },
    ]) {
      const { host, initializeStore, rows } = fixture(options);
      initializeStore();
      expect(host.adminActivityRecording()).toBe(options.expected);
      const { req, res } = request();
      host.beginAdminAudit(req, res, "PUT", "/api/config", owner);
      host.configSaved(before, after);
      expect(await rows()).toHaveLength(options.expected ? 1 : 0);
    }
  });
});
