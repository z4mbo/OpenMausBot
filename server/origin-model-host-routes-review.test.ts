import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { VisibleSet, pathSubject } from "./bot-visibility.ts";
import { createModelHostRoutes } from "./origin-model-host-routes.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { SessionRecord } from "./sessions.ts";

const member: RequestAuth = { kind: "session", session: { id: "member-session", email: "member@example.test" } as SessionRecord, via: "bearer", scopes: ["client"] };
const admin: RequestAuth = { ...member, scopes: ["client", "admin"] };
const source = { teamId: "team1", instanceId: "owner-claude", label: "Owner Claude", models: ["model1"], enabled: true, projectIds: ["project1"], workspaceHead: false, capacity: 1 };

function fixture() {
  const bots = [{ id: "restricted", threadId: "private-thread", visibility: "admins" }, { id: "public", threadId: "public-thread" }];
  const catalog = vi.fn(async (_botId: string) => [{ ownerName: "Project owner", computerName: "Owner computer", models: ["model1"] }]);
  const deps = { ready: () => true, settings: vi.fn(async () => ({ ready: true })), save: vi.fn(async () => source), revoke: vi.fn(async () => undefined), catalog,
    visible: (auth: RequestAuth, botId: string) => new VisibleSet(bots, [], auth.scopes.includes("admin") ? { kind: "all" } : { kind: "member", email: "member@example.test" }).bot(botId),
  };
  const route = createModelHostRoutes(deps);
  return { deps, async request(path: string, auth = member, method = "GET", body: unknown = {}) {
    let status = 0, result: unknown;
    const url = new URL(path, "https://fixture.invalid");
    await route({ req: {} as IncomingMessage, res: {} as ServerResponse, url, path: url.pathname, method, auth,
      json: (_response, code, value) => { status = code; result = value; }, readBody: async () => body });
    return { status, result };
  } };
}

describe("model host catalog caller visibility", () => {
  it.each(["restricted", "unknown"])("does not query owner-scoped sources for a member's invisible bot: %s", async botId => {
    const f = fixture();
    expect(pathSubject("/api/origin/model-host/catalog")).toBeNull();
    expect(await f.request(`/api/origin/model-host/catalog?botId=${botId}`)).toEqual({ status: 404, result: { error: "no such bot" } });
    expect(f.deps.catalog).not.toHaveBeenCalled();
  });

  it("lets a member list sources only for a visible bot", async () => {
    const f = fixture();
    expect(await f.request("/api/origin/model-host/catalog?botId=public")).toMatchObject({ status: 200, result: { ready: true, sources: [{ ownerName: "Project owner" }] } });
    expect(f.deps.catalog).toHaveBeenCalledExactlyOnceWith("public");
  });

  it.each([
    { path: "/api/origin/model-host", method: "GET", body: {} },
    { path: "/api/origin/model-host/sources", method: "PUT", body: source },
    { path: "/api/origin/model-host/revoke", method: "POST", body: { teamId: "team1" } },
  ])("keeps owner settings and grants admin-only: $method $path", async ({ path, method, body }) => {
    const f = fixture();
    expect((await f.request(path, member, method, body)).status).toBe(403);
    expect(f.deps.settings).not.toHaveBeenCalled(); expect(f.deps.save).not.toHaveBeenCalled(); expect(f.deps.revoke).not.toHaveBeenCalled();
  });

  it("retains admin access to settings and restricted-bot catalog", async () => {
    const f = fixture();
    expect((await f.request("/api/origin/model-host", admin)).status).toBe(200);
    expect((await f.request("/api/origin/model-host/catalog?botId=restricted", admin)).status).toBe(200);
    expect(f.deps.settings).toHaveBeenCalledTimes(1); expect(f.deps.catalog).toHaveBeenCalledExactlyOnceWith("restricted");
  });
});
