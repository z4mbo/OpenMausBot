import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { createOriginInviteRoutes, originErrorMessage, type OriginConvex } from "./origin-invites.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { ORIGIN_HOSTED_CONVEX_URL } from "../shared/origin-site-address.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

type Call = { name: string; args: Record<string, unknown> };

function fakeConvex(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const answer = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const value = answers[name];
    if (value instanceof Error) throw value;
    return value ?? null;
  };
  const client: OriginConvex = { query: answer, mutation: answer, action: answer };
  return { client, calls };
}

async function start(options: { publicUrl?: string | null; convexUrl?: string | null; answers?: Record<string, unknown>; mailOk?: boolean } = {}) {
  const fake = fakeConvex({
    "workspaces:inviteAddress": { origin: "https://origin.imbored.fun", convexUrl: ORIGIN_HOSTED_CONVEX_URL },
    "workspaces:createInvite": { token: "a".repeat(64), expiresAt: 1, teamName: "GGs" },
    "workspaces:sendEmailInvite": { token: "a".repeat(64), expiresAt: 1, inviteLink: `https://origin.imbored.fun/join/${"a".repeat(64)}`, sent: options.mailOk ?? true, deliveryStatus: options.mailOk === false ? "failed" : "accepted" },
    ...options.answers,
  });
  const routes = [createOriginInviteRoutes({
    publicUrl: () => options.publicUrl ?? null,
    convexUrl: () => (options.convexUrl === undefined ? ORIGIN_HOSTED_CONVEX_URL : options.convexUrl),
    connect: () => fake.client,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["client"] } as never, json, readBody });
    if (!handled) json(res, 404, { from: "next" });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, init);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const invite = (body: unknown) => call("/api/origin/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { base, call, invite, calls: fake.calls };
}

describe("Origin invitation routes", () => {
  it("uses the hosted website ahead of the local app address and delegates email once", async () => {
    const app = await start({ publicUrl: "https://team.example.org/" });
    const result = await app.invite({ sessionToken: "s", teamId: "team1", role: "member", email: " Bo@X.dev " });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ inviteLink: `https://origin.imbored.fun/join/${"a".repeat(64)}`, sent: true, deliveryStatus: "accepted" });
    expect(app.calls.filter(call => call.name !== "workspaces:inviteAddress")).toEqual([{ name: "workspaces:sendEmailInvite", args: { sessionToken: "s", teamId: "team1", role: "member", email: "bo@x.dev" } }]);
  });

  it("never uses the request's localhost address for a plain hosted link", async () => {
    const app = await start();
    const result = await app.invite({ sessionToken: "s", teamId: "team1", role: "viewer" });
    expect(result.body.inviteLink).toBe(`https://origin.imbored.fun/join/${"a".repeat(64)}`);
    expect(result.body.sent).toBe(false);
    expect(result.body.deliveryStatus).toBe("not_requested");
    expect(app.calls.some(call => call.name === "workspaces:sendEmailInvite")).toBe(false);
  });

  it("reports an unsent email", async () => {
    const app = await start({ mailOk: false });
    expect((await app.invite({ sessionToken: "s", teamId: "team1", role: "admin", email: "bo@x.dev" })).body.sent).toBe(false);
  });

  it("refuses bad input before calling Origin", async () => {
    const app = await start();
    expect((await app.invite({ teamId: "team1", role: "member" })).status).toBe(401);
    expect((await app.invite({ sessionToken: "s", teamId: "../x", role: "member" })).status).toBe(400);
    expect((await app.invite({ sessionToken: "s", teamId: "team1", role: "owner" })).status).toBe(400);
    expect((await app.invite({ sessionToken: "s", teamId: "team1", role: "member", email: "nope" })).status).toBe(400);
    expect(app.calls).toEqual([]);
  });

  it("needs a connected Origin deployment", async () => {
    const app = await start({ convexUrl: null });
    expect((await app.invite({ sessionToken: "s", teamId: "team1", role: "member" })).status).toBe(409);
  });

  it("passes Origin's own refusal through", async () => {
    const app = await start({ answers: { "workspaces:createInvite": new Error("[CONVEX M(workspaces:createInvite)] Server Error\nUncaught Error: Admin role required\n    at x") } });
    expect(await app.invite({ sessionToken: "s", teamId: "team1", role: "member" })).toEqual({ status: 400, body: { error: "Admin role required" } });
  });

  it("answers the app's public address", async () => {
    expect((await (await start({ publicUrl: "https://a.example/" })).call("/api/origin/app-address")).body).toEqual({ origin: "https://a.example" });
    expect((await (await start()).call("/api/origin/app-address")).body).toEqual({ origin: null });
  });
});

describe("originErrorMessage", () => {
  it("hides internals when Origin gave no reason", () => {
    expect(originErrorMessage(new Error("fetch failed"), "fallback")).toBe("fallback");
  });
});

describe("invitation issuing-backend affinity", () => {
  const args = { sessionToken: "s", teamId: "team1", role: "member" };
  it("keeps feedback's app address independent", async () => {
    const app = await start({ publicUrl: "https://app.example" });
    expect((await app.call("/api/origin/app-address")).body).toEqual({ origin: "https://app.example" });
    expect((await app.call("/api/origin/invite-address")).body).toEqual({ origin: "https://origin.imbored.fun", convexUrl: ORIGIN_HOSTED_CONVEX_URL });
  });
  it("rejects a changed renderer connection before calling the backend", async () => {
    const app = await start();
    expect((await app.invite({ ...args, convexUrl: "https://different.convex.cloud" })).status).toBe(409);
    expect(app.calls).toEqual([]);
  });
  it("supports only the authoritative custom site's matching backend", async () => {
    const convexUrl = "https://custom.convex.cloud";
    const app = await start({ convexUrl, answers: { "workspaces:inviteAddress": { convexUrl, origin: "https://team.example/" } } });
    expect((await app.invite(args)).body.inviteLink).toBe(`https://team.example/join/${"a".repeat(64)}`);
  });
  it.each([null, { convexUrl: "https://different.convex.cloud", origin: "https://site.example" }, { convexUrl: "https://custom.convex.cloud", origin: "https://localhost" }, { convexUrl: "https://custom.convex.cloud", origin: "https://user:secret@site.example" }])("rejects unsafe custom site metadata before a mutation", async address => {
    const app = await start({ convexUrl: "https://custom.convex.cloud", answers: { "workspaces:inviteAddress": address } });
    expect((await app.invite(args)).status).toBe(409);
    expect(app.calls).toHaveLength(1);
  });
  it("supports old official backends for plain links while refusing their legacy mail action", async () => {
    const app = await start({ answers: { "workspaces:inviteAddress": new Error("Function not found") } });
    expect((await app.invite(args)).body.inviteLink).toBe(`https://origin.imbored.fun/join/${"a".repeat(64)}`);
    expect((await app.invite({ ...args, email: "a@b.test" })).status).toBe(503);
    expect(app.calls.some(call => call.name === "workspaces:sendEmailInvite")).toBe(false);
  });
  it.each(["not_configured", "failed", "accepted"])("preserves the backend %s delivery result", async deliveryStatus => {
    const app = await start({ answers: { "workspaces:sendEmailInvite": { token: "a".repeat(64), expiresAt: 1, inviteLink: `https://origin.imbored.fun/join/${"a".repeat(64)}`, deliveryStatus, sent: deliveryStatus === "accepted" } } });
    expect((await app.invite({ ...args, email: "a@b.test", projectId: "project1" })).body.deliveryStatus).toBe(deliveryStatus);
    expect(app.calls.at(-1)?.args.projectId).toBe("project1");
  });
  it("rejects an inconsistent email link without retry or duplicate invitation", async () => {
    const app = await start({ answers: { "workspaces:sendEmailInvite": { token: "a".repeat(64), expiresAt: 1, inviteLink: "https://attacker.example", sent: true, deliveryStatus: "accepted" } } });
    expect((await app.invite({ ...args, email: "a@b.test" })).status).toBe(502);
    expect(app.calls.filter(call => call.name === "workspaces:sendEmailInvite")).toHaveLength(1);
    expect(app.calls.some(call => call.name === "workspaces:createInvite")).toBe(false);
  });
});
