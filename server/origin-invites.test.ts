import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { createOriginInviteRoutes, originErrorMessage, resendInviteMail, type InviteMail, type OriginConvex } from "./origin-invites.ts";
import { dispatchRoutes } from "./routes/table.ts";

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
  const fake = fakeConvex(options.answers ?? {
    "workspaces:createInvite": { token: "a".repeat(64), expiresAt: 1, teamName: "GGs" },
    "auth:me": { name: "Ada", email: "ada@x.dev" },
  });
  const mails: InviteMail[] = [];
  const routes = [createOriginInviteRoutes({
    publicUrl: () => options.publicUrl ?? null,
    convexUrl: () => (options.convexUrl === undefined ? "http://convex.test" : options.convexUrl),
    connect: () => fake.client,
    sendMail: async (mail) => { mails.push(mail); return options.mailOk ?? true; },
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
  return { base, call, invite, calls: fake.calls, mails };
}

describe("Origin invitation routes", () => {
  it("builds the link from the configured public address and emails it", async () => {
    const app = await start({ publicUrl: "https://team.example.org/" });
    const result = await app.invite({ sessionToken: "s", teamId: "team1", role: "member", email: " Bo@X.dev " });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ inviteLink: `https://team.example.org/join/${"a".repeat(64)}`, sent: true });
    expect(app.calls[0]).toEqual({ name: "workspaces:createInvite", args: { sessionToken: "s", teamId: "team1", role: "member", email: "bo@x.dev" } });
    expect(app.mails).toEqual([{ to: "bo@x.dev", teamName: "GGs", inviterName: "Ada", link: `https://team.example.org/join/${"a".repeat(64)}` }]);
  });

  it("falls back to the address the request used and sends nothing for a plain link", async () => {
    const app = await start();
    const result = await app.invite({ sessionToken: "s", teamId: "team1", role: "viewer" });
    expect(result.body.inviteLink).toBe(`${app.base}/join/${"a".repeat(64)}`);
    expect(result.body.sent).toBe(false);
    expect(app.mails).toEqual([]);
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

describe("resendInviteMail", () => {
  it("does nothing without a key", async () => {
    const send = resendInviteMail(async () => { throw new Error("no network"); }, {});
    expect(await send({ to: "a@b.c", teamName: "T", inviterName: "I", link: "https://x/join/t" })).toBe(false);
  });

  it("posts the invitation to Resend", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const send = resendInviteMail(async (url, init) => { requests.push({ url: String(url), init: init! }); return new Response("{}", { status: 200 }); }, { ORIGIN_RESEND_API_KEY: "key", ORIGIN_INVITE_FROM: "Team <t@x.dev>" });
    expect(await send({ to: "a@b.c", teamName: "GGs", inviterName: "Ada", link: "https://x/join/t" })).toBe(true);
    expect(requests[0].url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(requests[0].init.body))).toMatchObject({ from: "Team <t@x.dev>", to: "a@b.c", subject: "Join GGs on Origin" });
  });
});
