import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import type { OriginCloudClient } from "../origin-cloud.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { providerClients } from "./providers.ts";
import { createShipRoutes } from "./routes.ts";
import type { ShipRuntime } from "./service.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const http = { fetch: (async () => new Response("{}", { status: 500 })) as typeof fetch };
const runtime: ShipRuntime = { http, providers: providerClients(http), github: null, token: () => null, channels: () => [], now: Date.now };

async function serve(scopes: string[], seen: string[]) {
  const client: OriginCloudClient = {
    query: async (name, args) => {
      seen.push(`${name}:${String(args.sessionToken)}`);
      if (args.sessionToken !== "person-session") throw new Error("Uncaught Error: Login required\n at handler");
      return { canEdit: false, isAdmin: false, repoUrl: null, targets: [], releases: [] };
    },
    mutation: async () => null,
  };
  const route = createShipRoutes({ runtime, connect: () => client, cloudUrl: () => "http://127.0.0.1:1" });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const auth = { kind: "loopback", scopes } as unknown as RequestAuth;
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("Ship routes", () => {
  it("need the admin scope, the person's own Origin session and a project", async () => {
    const seen: string[] = [];
    const limited = await serve(["read"], seen);
    expect((await fetch(`${limited}/api/origin/ship/status?projectId=p1`, { headers: { "x-origin-session": "person-session" } })).status).toBe(403);
    const base = await serve(["admin"], seen);
    expect((await fetch(`${base}/api/origin/ship/status?projectId=p1`)).status).toBe(401);
    expect((await fetch(`${base}/api/origin/ship/status?projectId=../x`, { headers: { "x-origin-session": "person-session" } })).status).toBe(400);
    const answered = await fetch(`${base}/api/origin/ship/status?projectId=p1`, { headers: { "x-origin-session": "person-session" } });
    expect(await answered.json()).toEqual({ targets: [], keys: { vercel: false, netlify: false, cloudflare: false } });
    const refused = await fetch(`${base}/api/origin/ship/status?projectId=p1`, { headers: { "x-origin-session": "stale-session" } });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "Login required" });
    expect(seen).toEqual(["ship:overview:person-session", "ship:overview:stale-session"]);
  });

  it("rejects an unknown action and an unknown target", async () => {
    const base = await serve(["admin"], []);
    const denied = await fetch(`${base}/api/origin/ship/act`, {
      method: "POST", headers: { "x-origin-session": "person-session" }, body: JSON.stringify({ projectId: "p1", targetId: "t1", action: "rm -rf" }),
    });
    expect(denied.status).toBe(400);
    const missing = await fetch(`${base}/api/origin/ship/act`, {
      method: "POST", headers: { "x-origin-session": "person-session" }, body: JSON.stringify({ projectId: "p1", targetId: "t1", action: "deploy" }),
    });
    expect(missing.status).toBe(404);
  });
});
