import { createHmac, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { OriginCloudClient } from "../origin-cloud.ts";
import type { GitHubEnv } from "../github/service.ts";
import { parseGitHubEvent, verifyGitHubSignature } from "../github/webhook.ts";
import { createGitHubPublicRoutes, createGitHubRoutes, createGitHubService } from "./github.ts";
import { dispatchRoutes } from "./table.ts";

const SECRET = "fixture-integration-secret-0123456789abcdef";
const WEBHOOK_SECRET = "fixture-webhook-secret";
const NOW = Date.parse("2026-10-17T12:00:00Z");
const CONVEX = "http://127.0.0.1:3210";
const PUBLIC = "http://origin.test";
const OWNER = "owner@origin.test";

const servers: Server[] = [];
const folders: string[] = [];
const stores: { close(): void }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

type Handler = (args: Record<string, any>) => unknown;
type Call = { name: string; args: Record<string, any> };

const USERS: Record<string, { _id: string; email: string }> = { "admin-session": { _id: "u-admin", email: OWNER }, "member-session": { _id: "u-member", email: "member@origin.test" } };
const ROLES: Record<string, string> = { "admin-session": "owner", "member-session": "member" };

function fakeConvex(overrides: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const answers: Record<string, Handler> = {
    "auth:me": ({ sessionToken }) => USERS[sessionToken] ?? null,
    "workspaces:access": ({ sessionToken, teamId }) => {
      if (!ROLES[sessionToken]) throw new Error("Login required");
      return { teamId, role: ROLES[sessionToken], slug: "ggs" };
    },
    "projects:get": ({ sessionToken }) => ({ _id: "p1", teamId: "team1", repoUrl: "https://github.com/acme/widgets", memberRole: ROLES[sessionToken] === "owner" ? "admin" : "member", githubWorkspaceAccess: true }),
    "integrations:status": () => ({ login: "octo", connectedBy: "u-admin", autoCreate: true }),
    "integrations:configure": () => null,
    "projects:listForUser": () => [],
    ...overrides,
  };
  const answer = async (name: string, args: Record<string, any>) => {
    calls.push({ name, args });
    const handler = answers[name];
    if (!handler) throw new Error(`unexpected Convex call ${name}`);
    return handler(args);
  };
  const client: OriginCloudClient = { query: answer, mutation: answer };
  return { client, calls };
}

type Reply = { status?: number; body?: unknown };
type Route = (init: { method: string; body: string; headers: Record<string, string> }) => Reply;

function fakeNetwork(routes: Record<string, Route>, bridge: Record<string, Handler>) {
  const requests: { key: string; body: string; headers: Record<string, string> }[] = [];
  const bridgeCalls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const body = typeof init.body === "string" ? init.body : "";
    if (url === "http://127.0.0.1:3211/integrations") {
      if (headers["x-origin-signature"] !== createHmac("sha256", SECRET).update(body).digest("hex")) return new Response("Unauthorized", { status: 401 });
      const { operation, args } = JSON.parse(body) as { operation: string; args: Record<string, any> };
      bridgeCalls.push({ name: operation, args });
      const handler = bridge[operation];
      if (!handler) return new Response("Unknown operation", { status: 400 });
      return Response.json(await handler(args));
    }
    const key = `${method} ${url.replace(/\?.*$/, "")}`;
    requests.push({ key, body, headers });
    const route = routes[key];
    if (!route) return Response.json({ message: "Not Found" }, { status: 404 });
    const reply = route({ method, body, headers });
    return Response.json(reply.body ?? {}, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetcher, requests, bridgeCalls };
}

async function start(options: { env?: Partial<GitHubEnv>; convex?: Record<string, Handler>; github?: Record<string, Route>; bridge?: Record<string, Handler>; convexUrl?: string } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-github-"));
  folders.push(dataDir);
  const convex = fakeConvex(options.convex);
  const network = fakeNetwork(options.github ?? {}, options.bridge ?? {});
  const env: GitHubEnv = { publicUrl: PUBLIC, integrationSecret: SECRET, legacyOwnerEmail: OWNER, ...options.env };
  const service = createGitHubService({ dataDir, env, sharedConvexUrl: () => ("convexUrl" in options ? options.convexUrl : CONVEX), fetch: network.fetcher, connect: () => convex.client, now: () => NOW });
  stores.push(service().store);
  const work: Promise<void>[] = [];
  const deps = { service, background: (job: Promise<void>) => { work.push(job); } };
  const publicRoutes = [createGitHubPublicRoutes(deps)];
  const routes = [createGitHubRoutes(deps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const ctx = { req, res, url, path: url.pathname, method: req.method ?? "GET", json, readBody };
    if (await dispatchRoutes(publicRoutes, ctx)) return;
    if (await dispatchRoutes(routes, { ...ctx, auth: { kind: "loopback", scopes: ["admin", "client"] } as never })) return;
    json(res, 404, { from: "next" });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit & { session?: string } = {}) => fetch(`${base}${path}`, {
    redirect: "manual", ...init,
    headers: { ...(init.session ? { "x-origin-session": init.session } : {}), ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) },
  });
  return { call, convex, network, dataDir, work, service: service() };
}

const signedTick = (payload: unknown) => {
  const body = JSON.stringify(payload);
  return { method: "POST", body, headers: { "x-origin-signature": createHmac("sha256", SECRET).update(body).digest("hex") } };
};

const githubSignature = (body: string, secret = WEBHOOK_SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const context = (overrides: Record<string, unknown> = {}) => ({
  credentialAllowed: false, legacyOwner: false,
  project: { _id: "p1", teamId: "team1", name: "Widgets", status: "active", repoUrl: "https://github.com/acme/widgets", githubWorkspaceAccess: true },
  connection: { teamId: "team1", login: "octo", connectedBy: "u-admin", autoCreate: true },
  task: null,
  ...overrides,
});

describe("webhook payload checks", () => {
  it("accepts only a well-formed GitHub HMAC over the exact body", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifyGitHubSignature(body, githubSignature(body), WEBHOOK_SECRET)).toBe(true);
    expect(verifyGitHubSignature(`${body} `, githubSignature(body), WEBHOOK_SECRET)).toBe(false);
    expect(verifyGitHubSignature(body, githubSignature(body, "other"), WEBHOOK_SECRET)).toBe(false);
    expect(verifyGitHubSignature(body, "sha1=abc", WEBHOOK_SECRET)).toBe(false);
  });

  it("refuses path tricks, missing numbers and check events without a head SHA", () => {
    expect(() => parseGitHubEvent(JSON.stringify({ repository: { full_name: "../x" }, issue: { number: 1 } }), "issues", "d1")).toThrow("Invalid repository");
    expect(() => parseGitHubEvent(JSON.stringify({ repository: { full_name: "acme/widgets" }, issue: {} }), "issues", "d1")).toThrow("Invalid issue or PR number");
    expect(() => parseGitHubEvent(JSON.stringify({ repository: { full_name: "acme/widgets" }, check_run: { pull_requests: [] } }), "check_run", "d1")).toThrow("Invalid head SHA");
    expect(() => parseGitHubEvent("{}", "issues", "bad id!")).toThrow("Delivery ID required");
    const event = parseGitHubEvent(JSON.stringify({ repository: { full_name: "acme/widgets" }, check_suite: { head_sha: "a".repeat(40), pull_requests: [{ number: 7 }] } }), "check_suite", "d1");
    expect(event).toMatchObject({ repoUrl: "https://github.com/acme/widgets", numbers: [7], headSha: "a".repeat(40) });
  });
});

describe("POST /api/github/webhook", () => {
  const issueBody = JSON.stringify({ action: "closed", repository: { full_name: "acme/widgets" }, issue: { number: 5 } });
  const deliver = (body: string, signature = githubSignature(body), event = "issues") => ({
    method: "POST", body, headers: { "x-hub-signature-256": signature, "x-github-event": event, "x-github-delivery": "delivery-1" },
  });

  it("is unavailable until the App has a webhook secret", async () => {
    const { call, network } = await start();
    expect((await call("/api/github/webhook", deliver(issueBody))).status).toBe(503);
    expect(network.bridgeCalls).toEqual([]);
  });

  it("does no work for a bad signature or an oversized body", async () => {
    const { call, network } = await start({ env: { clientId: "cid", clientSecret: "csecret", webhookSecret: WEBHOOK_SECRET } });
    expect((await call("/api/github/webhook", deliver(issueBody, githubSignature(issueBody, "wrong")))).status).toBe(401);
    expect((await call("/api/github/webhook", deliver("x".repeat(1_000_001)))).status).toBe(413);
    expect(network.bridgeCalls).toEqual([]);
  });

  it.each([undefined, "closed"])("pulls a signed closed issue event without reopening it (last state %s); a duplicate does nothing", async (githubIssueState) => {
    let lease: number | null = 3;
    const { call, network } = await start({
      env: { clientId: "cid", clientSecret: "csecret", webhookSecret: WEBHOOK_SECRET, legacyToken: "legacy-token" },
      bridge: {
        githubDelivery: () => lease,
        webhookTargets: () => [{ projectId: "p1", taskId: "t1", repoUrl: "https://github.com/acme/widgets", number: 5 }],
        context: () => context({ legacyOwner: true, project: { ...context().project, githubWorkspaceAccess: false }, task: { _id: "t1", title: "Login", done: false, githubIssueNumber: 5, githubIssueUrl: "https://github.com/acme/widgets/issues/5", githubIssueState } }),
        linkIssue: () => null,
      },
      github: { "GET https://api.github.com/repos/acme/widgets/issues/5": () => ({ body: { number: 5, html_url: "https://github.com/acme/widgets/issues/5", state: "closed", updated_at: "2026-10-17T11:00:00Z" } }) },
    });
    const first = await call("/api/github/webhook", deliver(issueBody));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ accepted: true });
    expect(network.bridgeCalls.map((c) => c.name)).toEqual(["githubDelivery", "webhookTargets", "context", "linkIssue", "githubDelivery"]);
    expect(network.bridgeCalls[3].args).toMatchObject({ taskId: "t1", number: 5, state: "closed", issueUrl: "https://github.com/acme/widgets/issues/5" });
    expect(network.bridgeCalls[4].args).toMatchObject({ deliveryId: "delivery-1", finishLease: 3 });
    expect(network.requests.some((request) => request.key.startsWith("PATCH"))).toBe(false);
    lease = null;
    network.bridgeCalls.length = 0;
    expect(await (await call("/api/github/webhook", deliver(issueBody))).json()).toEqual({ accepted: true, duplicate: true });
    expect(network.bridgeCalls.map((c) => c.name)).toEqual(["githubDelivery"]);
  });

  it("answers 503 and leaves the lease open when the sync fails", async () => {
    const { call, network } = await start({
      env: { clientId: "cid", clientSecret: "csecret", webhookSecret: WEBHOOK_SECRET },
      bridge: { githubDelivery: () => 1, webhookTargets: () => [{ projectId: "p1", taskId: "t1", repoUrl: "https://github.com/acme/widgets", number: 5 }], context: () => context({ connection: null }) },
    });
    expect((await call("/api/github/webhook", deliver(issueBody))).status).toBe(503);
    expect(network.bridgeCalls.filter((c) => c.name === "githubDelivery")).toHaveLength(1);
  });
});

describe("POST /api/integrations/tick", () => {
  it("rejects unsigned, mis-signed and stale ticks", async () => {
    const { call, network } = await start();
    expect((await call("/api/integrations/tick", { method: "POST", body: JSON.stringify({ at: NOW }) })).status).toBe(401);
    expect((await call("/api/integrations/tick", { ...signedTick({ at: NOW }), headers: { "x-origin-signature": "0".repeat(64) } })).status).toBe(401);
    expect((await call("/api/integrations/tick", signedTick({ at: NOW - 61_000 }))).status).toBe(401);
    expect((await call("/api/integrations/tick", { method: "POST", body: "x".repeat(100_001) })).status).toBe(413);
    expect(network.bridgeCalls).toEqual([]);
  });

  it("creates a project's repository with the workspace connection", async () => {
    const { call, network, service } = await start({
      bridge: { context: () => context({ project: { ...context().project, repoUrl: undefined } }), repoResult: () => null },
      github: { "POST https://api.github.com/user/repos": ({ body }) => ({ status: 201, body: { id: 9, html_url: "https://github.com/octo/widgets-p1", description: JSON.parse(body).description, owner: { login: "octo" }, private: true } }) },
    });
    service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const response = await call("/api/integrations/tick", signedTick({ at: NOW, projectId: "p1" }));
    expect(await response.json()).toEqual({ ok: true });
    expect(network.requests[0].headers.authorization).toBe("Bearer workspace-token");
    expect(JSON.parse(network.requests[0].body)).toMatchObject({ name: "Widgets", private: true, description: "Origin project: p1" });
    expect(network.bridgeCalls.at(-1)).toEqual({ name: "repoResult", args: { projectId: "p1", state: "ready", repoUrl: "https://github.com/octo/widgets-p1", repoId: 9 } });
  });

  it("runs one background sync at a time and pages issues and PRs", async () => {
    let release = () => {};
    const gate = new Promise<string[]>((resolve) => { release = () => resolve([]); });
    const { call, network, work } = await start({
      bridge: { pending: () => gate, targets: () => ({ rows: [], nextCursor: null }), prTargets: () => ({ rows: [], nextCursor: "next" }), unlinkedTasks: () => ({ rows: [], nextCursor: null }) },
    });
    const first = await call("/api/integrations/tick", signedTick({ at: NOW }));
    expect(first.status).toBe(202);
    expect(await (await call("/api/integrations/tick", signedTick({ at: NOW }))).json()).toEqual({ busy: true });
    release();
    await Promise.all(work);
    expect(network.bridgeCalls.map((c) => c.name).sort()).toEqual(["pending", "prTargets", "targets", "unlinkedTasks"]);
    expect(network.bridgeCalls.find((c) => c.name === "prTargets")?.args).toEqual({ cursor: null, state: "draft" });
    expect((await call("/api/integrations/tick", signedTick({ at: NOW }))).status).toBe(202);
  });
});

describe("workspace OAuth connection", () => {
  const app = { clientId: "cid", clientSecret: "csecret", slug: "origin-app", webhookSecret: WEBHOOK_SECRET };

  function oauthGitHub(administration = "write") {
    return {
      "POST https://github.com/login/oauth/access_token": ({ body }: { body: string }) => ({ body: JSON.parse(body).code === "good-code" ? { access_token: "user-token", refresh_token: "refresh", expires_in: 28800 } : { error: "bad_verification_code" } }),
      "GET https://api.github.com/user": () => ({ body: { id: 42, login: "octo" } }),
      "GET https://api.github.com/user/installations": () => ({ body: { installations: [{ account: { id: 42 }, app_slug: "origin-app", suspended_at: null, permissions: { administration } }] } }),
    };
  }

  async function begin(harness: Awaited<ReturnType<typeof start>>) {
    const started = await harness.call("/api/github/oauth/start?teamId=team1", { method: "POST", session: "admin-session" });
    expect(started.status).toBe(200);
    const { url } = await started.json() as { url: string };
    expect(url).toMatch(new RegExp(`^${PUBLIC}/api/github/oauth/begin\\?ticket=`));
    const opened = await harness.call(new URL(url).pathname + new URL(url).search);
    expect(opened.status).toBe(302);
    const location = new URL(opened.headers.get("location")!);
    const cookie = opened.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^origin\.github=[\w-]+; Path=\/api\/github; HttpOnly; SameSite=Lax; Max-Age=900$/);
    return { location, cookie: cookie.split(";")[0] };
  }

  it("only a workspace admin may start, and only once the App exists", async () => {
    const harness = await start();
    expect(await (await harness.call("/api/github/oauth/start?teamId=team1", { method: "POST", session: "admin-session" })).json()).toEqual({ error: "The Origin GitHub App has not been configured yet" });
    harness.service.store.saveApp(app);
    expect(await (await harness.call("/api/github/oauth/start?teamId=team1", { method: "POST", session: "member-session" })).json()).toEqual({ error: "Workspace admin access required" });
    expect((await harness.call("/api/github/oauth/start?teamId=team1", { method: "POST" })).status).toBe(400);
  });

  it("binds state to the browser cookie, uses PKCE, saves the connection once and refuses a replay", async () => {
    const harness = await start({ github: oauthGitHub() });
    harness.service.store.saveApp(app);
    const { location, cookie } = await begin(harness);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("redirect_uri")).toBe(`${PUBLIC}/api/github/oauth/callback`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const state = location.searchParams.get("state")!;

    const stranger = await harness.call(`/api/github/oauth/callback?state=${state}&code=good-code`);
    expect(stranger.status).toBe(400);

    const ok = await harness.call(`/api/github/oauth/callback?state=${state}&code=good-code`, { headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("GitHub connected");
    const exchange = harness.network.requests.find((r) => r.key === "POST https://github.com/login/oauth/access_token")!;
    expect(JSON.parse(exchange.body)).toMatchObject({ client_id: "cid", code: "good-code", redirect_uri: `${PUBLIC}/api/github/oauth/callback` });
    expect(JSON.parse(exchange.body).code_verifier).toMatch(/^[\w-]{43}$/);
    expect(harness.convex.calls.find((c) => c.name === "integrations:configure")?.args).toEqual({ sessionToken: "admin-session", teamId: "team1", login: "octo", autoCreate: true });
    expect(harness.service.store.workspaceInfo("team1")).toEqual({ team: "team1", login: "octo", account_id: 42, connected_by: "u-admin" });
    const sqlite = readdirSync(join(harness.dataDir, "origin-github")).map((name) => readFileSync(join(harness.dataDir, "origin-github", name)).toString("latin1")).join("");
    expect(sqlite).not.toContain("user-token");

    const replay = await harness.call(`/api/github/oauth/callback?state=${state}&code=good-code`, { headers: { cookie } });
    expect(replay.status).toBe(400);
  });

  it("sends the person to install the App once when it lacks Administration write", async () => {
    const harness = await start({ github: oauthGitHub("read") });
    harness.service.store.saveApp(app);
    const { location, cookie } = await begin(harness);
    const callback = await harness.call(`/api/github/oauth/callback?state=${location.searchParams.get("state")}&code=good-code`, { headers: { cookie } });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toMatch(/^https:\/\/github\.com\/apps\/origin-app\/installations\/new\?state=/);
    expect(harness.service.store.workspaceInfo("team1")).toBeNull();
  });

  it("an admin disconnects the workspace", async () => {
    const harness = await start();
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "t" });
    expect((await harness.call("/api/github/workspace?teamId=team1", { method: "DELETE", session: "member-session" })).status).toBe(403);
    expect(await (await harness.call("/api/github/workspace?teamId=team1", { method: "DELETE", session: "admin-session" })).json()).toEqual({ ok: true });
    expect(harness.service.store.workspaceInfo("team1")).toBeNull();
  });
});

describe("GitHub App manifest setup", () => {
  it("only the configured owner gets a setup link; the callback saves the App once", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    let conversions = 0;
    const harness = await start({
      github: { "POST https://api.github.com/app-manifests/abc123/conversions": () => { conversions += 1; return { status: 201, body: { id: 7, client_id: "cid", client_secret: "cs", slug: "origin-app", webhook_secret: "wh", pem: privateKey } }; } },
    });
    expect((await harness.call("/api/github/setup?teamId=team1", { method: "POST", session: "member-session" })).status).toBe(403);
    const started = await harness.call("/api/github/setup?teamId=team1", { method: "POST", session: "admin-session" });
    const { url } = await started.json() as { url: string };
    const opened = await harness.call(new URL(url).pathname + new URL(url).search);
    expect(opened.headers.get("content-security-policy")).toContain("form-action https://github.com");
    const html = await opened.text();
    const state = /settings\/apps\/new\?state=([\w-]+)/.exec(html)![1];
    expect(html).toContain("&#34;hook_attributes&#34;");
    expect(html).toContain(`${PUBLIC}/api/github/webhook`);
    const cookie = opened.headers.get("set-cookie")!.split(";")[0];

    const done = await harness.call(`/api/github/setup/callback?state=${state}&code=abc123`, { headers: { cookie } });
    expect(await done.text()).toContain("GitHub App ready");
    expect(conversions).toBe(1);
    const workspace = await (await harness.call("/api/github/workspace?teamId=team1", { session: "admin-session" })).json();
    expect(workspace).toMatchObject({ configured: true, canSetup: true, login: null, installationUrl: "https://github.com/apps/origin-app/installations/new" });
    expect((await harness.call("/api/github/setup?teamId=team1", { method: "POST", session: "admin-session" })).status).toBe(403);
  });
});

describe("project token connection", () => {
  const github = {
    "GET https://api.github.com/user": ({ headers }: { headers: Record<string, string> }) => (headers.authorization === "Bearer ghp_valid_token_0123456789" ? { body: { login: "octo" } } : { status: 401 }),
    "GET https://api.github.com/repos/acme/widgets": () => ({ body: { full_name: "acme/widgets" } }),
  };

  it("validates the token with GitHub, stores it sealed and limits attempts", async () => {
    const harness = await start({ github, bridge: { context: () => context({ credentialAllowed: true }) } });
    const post = (session: string, token: string) => harness.call("/api/github/connection?projectId=p1", { method: "POST", session, body: JSON.stringify({ token }) });
    expect(await (await post("member-session", "ghp_valid_token_0123456789")).json()).toEqual({ error: "A project admin must connect GitHub" });
    expect(await (await post("admin-session", "short")).json()).toEqual({ error: "Enter a valid GitHub access token" });
    expect(await (await post("admin-session", "ghp_expired_token_0123456789")).json()).toEqual({ error: "GitHub could not verify this token. Check that it has not expired." });
    const saved = await post("admin-session", "ghp_valid_token_0123456789");
    expect(await saved.json()).toEqual({ connection: { login: "octo", updatedAt: NOW, connectedBy: "u-admin" } });
    expect(harness.service.store.connectionToken("p1", "acme/widgets")).toBe("ghp_valid_token_0123456789");
    const files = readdirSync(join(harness.dataDir, "origin-github")).map((name) => readFileSync(join(harness.dataDir, "origin-github", name)).toString("latin1")).join("");
    expect(files).not.toContain("ghp_valid_token_0123456789");
    const read = await harness.call("/api/github/connection?projectId=p1", { session: "admin-session" });
    expect(await read.json()).toEqual({ connection: { login: "octo", updatedAt: NOW, connectedBy: "u-admin", source: "project" } });
    for (let i = 0; i < 7; i += 1) await post("admin-session", "ghp_valid_token_0123456789");
    expect((await post("admin-session", "ghp_valid_token_0123456789")).status).toBe(429);
  });

  it("refuses a body over the limit", async () => {
    const harness = await start({ github, bridge: { context: () => context() } });
    const big = await harness.call("/api/github/connection?projectId=p1", { method: "POST", session: "admin-session", body: JSON.stringify({ token: "x".repeat(130_000) }) });
    expect(big.status).toBe(413);
  });
});

describe("GET /api/github/repo", () => {
  it("lists issues without PRs, PR states and commits through the workspace token", async () => {
    const harness = await start({
      github: {
        "GET https://api.github.com/repos/acme/widgets/issues": () => ({ body: [
          { number: 1, title: "Bug", state: "open", html_url: "https://github.com/acme/widgets/issues/1", updated_at: "2026-10-16T00:00:00Z", user: { login: "ana" } },
          { number: 2, title: "A PR", state: "open", pull_request: {} },
        ] }),
        "GET https://api.github.com/repos/acme/widgets/pulls": () => ({ body: [{ number: 2, title: "A PR", state: "closed", merged_at: "2026-10-16T00:00:00Z", head: { ref: "feature" }, updated_at: "2026-10-16T00:00:00Z" }] }),
        "GET https://api.github.com/repos/acme/widgets/commits": () => ({ body: [{ sha: "abc", html_url: "https://github.com/acme/widgets/commit/abc", commit: { message: "Fix\n\nbody", author: { name: "Ana", date: "2026-10-15T00:00:00Z" } } }] }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const response = await harness.call("/api/github/repo?projectId=p1", { session: "member-session" });
    const body = await response.json();
    expect(body).toMatchObject({
      repo: "acme/widgets", tokenConfigured: true, commitsError: "",
      issues: [{ number: 1, title: "Bug", state: "open", author: "ana" }],
      pullRequests: [{ number: 2, state: "merged", branch: "feature" }],
      commits: [{ sha: "abc", message: "Fix", author: "Ana" }],
    });
    expect(harness.network.requests.every((r) => r.headers.authorization === "Bearer workspace-token")).toBe(true);
  });

  it("answers without crashing when no Origin backend is configured", async () => {
    const harness = await start({ convexUrl: undefined });
    expect(await (await harness.call("/api/github/workspace?teamId=team1")).json()).toEqual({ error: "Workspace access required" });
    expect(await (await harness.call("/api/github/repo?projectId=p1", { session: "admin-session" })).json()).toEqual({ error: "Sign in to Origin first: this server has no Origin backend address" });
    expect((await harness.call("/api/github/oauth/callback?state=x&code=y")).status).toBe(400);
  });

  it("needs the caller's Origin session", async () => {
    const harness = await start();
    expect(await (await harness.call("/api/github/repo?projectId=p1")).json()).toEqual({ error: "Login required" });
  });
});

const sha40 = (char: string) => char.repeat(40);
const pull = (overrides: Record<string, unknown> = {}) => ({
  number: 8, title: "Add login", html_url: "https://github.com/acme/widgets/pull/8", state: "open", draft: false, merged_at: null,
  updated_at: "2026-10-16T00:00:00Z", body: "Closes #5", user: { login: "dev-bot" }, head: { ref: "feature", sha: sha40("a") }, base: { ref: "main" },
  mergeable: true, additions: 12, deletions: 3, node_id: "PR_8", ...overrides,
});
const closingReferences = (numbers: number[], repo = "acme/widgets", hasNextPage = false, endCursor: string | null = null) => ({
  data: { repository: { pullRequest: { closingIssuesReferences: { nodes: numbers.map((number) => ({ number, repository: { nameWithOwner: repo } })), pageInfo: { hasNextPage, endCursor } } } } },
});
const prRoutes = (overrides: { pr?: Record<string, unknown>; conclusion?: string; reviews?: unknown[]; closes?: number[] } = {}): Record<string, Route> => ({
  "GET https://api.github.com/repos/acme/widgets/pulls/8": () => ({ body: pull(overrides.pr) }),
  "GET https://api.github.com/repos/acme/widgets": () => ({ body: { default_branch: "main" } }),
  "GET https://api.github.com/repos/acme/widgets/pulls/8/files": () => ({ body: [{ filename: "src/login.ts", status: "modified", additions: 12, deletions: 3 }] }),
  [`GET https://api.github.com/repos/acme/widgets/commits/${sha40("a")}/check-runs`]: () => ({ body: { total_count: 1, check_runs: [{ name: "ci", status: "completed", conclusion: overrides.conclusion ?? "success" }] } }),
  "GET https://api.github.com/repos/acme/widgets/pulls/8/reviews": () => ({ body: overrides.reviews ?? [] }),
  "POST https://api.github.com/graphql": () => ({ body: closingReferences(overrides.closes ?? [5]) }),
});

describe("issue mirroring and two-way state", () => {
  const linked = (task: Record<string, unknown>) => context({ task: { _id: "t1", title: "Login", done: false, githubIssueNumber: 5, githubIssueUrl: "https://github.com/acme/widgets/issues/5", ...task } });
  const tickWith = async (task: Record<string, unknown>, remote: "open" | "closed") => {
    const harness = await start({
      bridge: {
        pending: () => [], prTargets: () => ({ rows: [], nextCursor: null }), unlinkedTasks: () => ({ rows: [], nextCursor: null }),
        targets: () => ({ rows: [{ projectId: "p1", taskId: "t1", repoUrl: "https://github.com/acme/widgets", number: 5 }], nextCursor: null }),
        context: () => linked(task), linkIssue: () => null, unlinkIssue: () => null,
      },
      github: {
        "GET https://api.github.com/repos/acme/widgets/issues/5": () => ({ body: { number: 5, node_id: "I_5", html_url: "https://github.com/acme/widgets/issues/5", state: remote, updated_at: "2026-10-16T00:00:00Z", body: "<!-- origin-task:t1 -->" } }),
        "POST https://api.github.com/graphql": () => ({ body: { data: { deleteIssue: { clientMutationId: null } } } }),
        "PATCH https://api.github.com/repos/acme/widgets/issues/5": ({ body }) => ({ body: { number: 5, html_url: "https://github.com/acme/widgets/issues/5", state: JSON.parse(body).state, updated_at: "2026-10-17T00:00:00Z" } }),
        "POST https://api.github.com/repos/acme/widgets/issues/5/comments": () => ({ status: 201, body: {} }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    await harness.call("/api/integrations/tick", signedTick({ at: NOW }));
    await Promise.all(harness.work);
    return harness;
  };

  it("closes the GitHub issue as completed and keeps the link when Origin completed the issue since the last sync", async () => {
    const { network } = await tickWith({ done: true, githubIssueState: "open" }, "open");
    expect(JSON.parse(network.requests.find((r) => r.key.startsWith("PATCH"))!.body)).toEqual({ state: "closed", state_reason: "completed" });
    expect(network.requests.some((r) => r.key.endsWith("/graphql"))).toBe(false);
    expect(network.bridgeCalls.some((c) => c.name === "unlinkIssue")).toBe(false);
    expect(network.bridgeCalls.find((c) => c.name === "linkIssue")?.args).toMatchObject({ taskId: "t1", number: 5 });
  });

  it("reopens on GitHub after Origin reopened, and lets a change on GitHub win", async () => {
    const reopened = await tickWith({ done: false, githubIssueState: "closed", githubIssueReopenRequested: true }, "closed");
    expect(JSON.parse(reopened.network.requests.find((r) => r.key.startsWith("PATCH"))!.body)).toEqual({ state: "open" });
    const closedOnGitHub = await tickWith({ done: false, githubIssueState: "open" }, "closed");
    expect(closedOnGitHub.network.requests.some((r) => r.key.startsWith("PATCH"))).toBe(false);
    expect(closedOnGitHub.network.bridgeCalls.find((c) => c.name === "linkIssue")?.args).toMatchObject({ state: "closed" });
  });

  it("deletes the GitHub issue of an issue moved back to Draft, even an already closed one", async () => {
    const parked = await tickWith({ done: false, draft: true, githubIssueState: "open" }, "open");
    expect(parked.network.requests.some((r) => r.key.endsWith("/graphql"))).toBe(true);
    expect(parked.network.bridgeCalls.find((c) => c.name === "unlinkIssue")?.args).toEqual({ projectId: "p1", taskId: "t1", number: 5 });
    const closedParked = await tickWith({ done: false, draft: true, githubIssueState: "closed" }, "closed");
    expect(closedParked.network.requests.some((r) => r.key.endsWith("/graphql"))).toBe(true);
    expect(closedParked.network.bridgeCalls.find((c) => c.name === "unlinkIssue")?.args).toEqual({ projectId: "p1", taskId: "t1", number: 5 });
    const left = await tickWith({ done: false, draft: false, githubIssueState: "closed", githubIssueReopenRequested: true }, "closed");
    expect(JSON.parse(left.network.requests.find((r) => r.key.startsWith("PATCH"))!.body)).toEqual({ state: "open" });
  });

  it("leaves GitHub alone when the Origin backend does not report drafts", async () => {
    const { network } = await tickWith({ done: false, githubIssueState: "open" }, "open");
    expect(network.requests.some((r) => r.key.startsWith("PATCH"))).toBe(false);
  });

  it("preserves a manual GitHub closure unless Origin explicitly requested a reopen", async () => {
    const { network } = await tickWith({ done: false, githubIssueState: "closed" }, "closed");
    expect(network.requests.some((request) => request.key.startsWith("PATCH"))).toBe(false);
    expect(network.bridgeCalls.find((call) => call.name === "linkIssue")?.args).toMatchObject({ state: "closed" });
  });

  it.each([
    { name: "repository changed", repoUrl: "https://github.com/acme/replacement", issueNumber: 5 },
    { name: "task relinked", repoUrl: "https://github.com/acme/widgets", issueNumber: 6 },
  ])("does not apply a scheduled target after its $name", async ({ repoUrl, issueNumber }) => {
    const remote = `${repoUrl}/issues/5`;
    const harness = await start({
      bridge: {
        pending: () => [], prTargets: () => ({ rows: [], nextCursor: null }), unlinkedTasks: () => ({ rows: [], nextCursor: null }),
        targets: () => ({ rows: [{ projectId: "p1", taskId: "t1", repoUrl: "https://github.com/acme/widgets", number: 5 }], nextCursor: null }),
        context: () => context({
          project: { ...context().project, repoUrl },
          task: { _id: "t1", title: "Login", done: true, githubIssueNumber: issueNumber, githubIssueUrl: `${repoUrl}/issues/${issueNumber}`, githubIssueState: "open" },
        }),
        linkIssue: () => null,
      },
      github: {
        [`GET ${remote.replace("https://github.com/", "https://api.github.com/repos/")}`]: () => ({ body: { number: 5, html_url: remote, state: "open", updated_at: "2026-10-16T00:00:00Z" } }),
        [`PATCH ${remote.replace("https://github.com/", "https://api.github.com/repos/")}`]: () => ({ body: { number: 5, html_url: remote, state: "closed", updated_at: "2026-10-17T00:00:00Z" } }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    await harness.call("/api/integrations/tick", signedTick({ at: NOW }));
    await Promise.all(harness.work);
    expect(harness.network.requests.some((request) => request.key.includes("/issues/"))).toBe(false);
    expect(harness.network.bridgeCalls.some((call) => call.name === "linkIssue")).toBe(false);
  });

  it("never creates a GitHub issue for a draft, even when an older backend lists it as unlinked", async () => {
    const created: unknown[] = [];
    const harness = await start({
      bridge: {
        pending: () => [], prTargets: () => ({ rows: [], nextCursor: null }), targets: () => ({ rows: [], nextCursor: null }),
        unlinkedTasks: () => ({ rows: [{ projectId: "p1", taskId: "t1" }], nextCursor: null }),
        context: () => context({ task: { _id: "t1", title: "Idea", done: false, draft: true } }), linkIssue: () => null,
      },
      github: { "POST https://api.github.com/repos/acme/widgets/issues": ({ body }) => { created.push(JSON.parse(body)); return { status: 201, body: {} }; } },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    await harness.call("/api/integrations/tick", signedTick({ at: NOW }));
    await Promise.all(harness.work);
    expect(created).toEqual([]);
  });

  it("mirrors only issues outside Draft on request, says why a draft has none, and syncs linked issues it is asked about", async () => {
    const created: { title: string }[] = [];
    const parkedTask = { githubIssueNumber: 5, githubIssueUrl: "https://github.com/acme/widgets/issues/5", githubIssueState: "open", draft: true };
    const harness = await start({
      bridge: {
        context: (args) => context({ task: { _id: args.taskId, title: String(args.taskId), done: false, ...(args.taskId === "t3" ? parkedTask : {}) } }),
        linkIssue: () => null, unlinkIssue: () => null,
      },
      github: {
        "POST https://api.github.com/repos/acme/widgets/issues": ({ body }) => {
          created.push(JSON.parse(body));
          return { status: 201, body: { number: 11, html_url: "https://github.com/acme/widgets/issues/11", state: "open", updated_at: "2026-10-17T00:00:00Z" } };
        },
        "GET https://api.github.com/repos/acme/widgets/issues/5": () => ({ body: { number: 5, html_url: "https://github.com/acme/widgets/issues/5", state: "open", updated_at: "2026-10-16T00:00:00Z" } }),
        "PATCH https://api.github.com/repos/acme/widgets/issues/5": ({ body }) => ({ body: { number: 5, html_url: "https://github.com/acme/widgets/issues/5", state: JSON.parse(body).state, updated_at: "2026-10-17T00:00:00Z" } }),
        "POST https://api.github.com/repos/acme/widgets/issues/5/comments": () => ({ status: 201, body: {} }),
      },
      convex: {
        "tasks:board": () => ({
          columns: [{ _id: "draft", title: "Draft", isDraft: true }, { _id: "todo", title: "Todo" }],
          tasks: [{ _id: "t1", columnId: "todo", done: false }, { _id: "t2", columnId: "draft", done: false }, { _id: "t3", columnId: "draft", done: false, githubIssueNumber: 5 }],
        }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const all = await harness.call("/api/github/mirror", { method: "POST", session: "member-session", body: JSON.stringify({ projectId: "p1" }) });
    expect(await all.json()).toEqual({ results: [{ taskId: "t1", issueNumber: 11 }] });
    expect(created.map((issue) => issue.title)).toEqual(["t1"]);
    const asked = await harness.call("/api/github/mirror", { method: "POST", session: "member-session", body: JSON.stringify({ projectId: "p1", taskIds: ["t2", "t3"] }) });
    expect(await asked.json()).toEqual({ results: [
      { taskId: "t2", error: expect.stringContaining("Draft") },
      { taskId: "t3", issueNumber: 5 },
    ] });
    expect(JSON.parse(harness.network.requests.find((r) => r.key.startsWith("PATCH"))!.body)).toEqual({ state: "closed", state_reason: "not_planned" });
    expect(JSON.parse(harness.network.requests.find((r) => r.key.endsWith("/issues/5/comments"))!.body).body).toContain("Moved back to Draft in Origin");
    expect(harness.network.bridgeCalls.find((c) => c.name === "unlinkIssue")?.args).toEqual({ projectId: "p1", taskId: "t3", number: 5 });
  });

  it("mirrors open issues without a GitHub issue on the tick, and on request for a project", async () => {
    const created: unknown[] = [];
    const harness = await start({
      bridge: {
        pending: () => [], prTargets: () => ({ rows: [], nextCursor: null }), targets: () => ({ rows: [], nextCursor: null }),
        unlinkedTasks: () => ({ rows: [{ projectId: "p1", taskId: "t1" }], nextCursor: null }),
        context: () => context({ task: { _id: "t1", title: "Login", description: "Build it", done: false } }), linkIssue: () => null,
      },
      github: {
        "POST https://api.github.com/repos/acme/widgets/issues": ({ body }) => {
          created.push(JSON.parse(body));
          return { status: 201, body: { number: 11, html_url: "https://github.com/acme/widgets/issues/11", state: "open", updated_at: "2026-10-17T00:00:00Z" } };
        },
      },
      convex: { "tasks:board": () => ({ columns: [], tasks: [{ _id: "t1", done: false }, { _id: "t2", done: true }, { _id: "t3", done: false, githubIssueNumber: 4 }] }) },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    await harness.call("/api/integrations/tick", signedTick({ at: NOW }));
    await Promise.all(harness.work);
    expect(created).toEqual([{ title: "Login", body: "Build it\n\n<!-- origin-task:t1 -->" }]);
    expect(harness.network.bridgeCalls.find((c) => c.name === "linkIssue")?.args).toMatchObject({ taskId: "t1", number: 11 });
    const mirrored = await harness.call("/api/github/mirror", { method: "POST", session: "member-session", body: JSON.stringify({ projectId: "p1" }) });
    expect(await mirrored.json()).toEqual({ results: [{ taskId: "t1", issueNumber: 11 }] });
  });

  it("tolerates an Origin backend that does not list unlinked issues yet", async () => {
    const harness = await start({ bridge: { pending: () => [], prTargets: () => ({ rows: [], nextCursor: null }), targets: () => ({ rows: [], nextCursor: null }) } });
    await harness.call("/api/integrations/tick", signedTick({ at: NOW }));
    await expect(Promise.all(harness.work)).resolves.toBeDefined();
  });
});

describe("POST /api/github/pull-requests/review", () => {
  const review = (session: string, payload: Record<string, unknown>) => ({ method: "POST", session, body: JSON.stringify({ projectId: "p1", number: 8, ...payload }) });

  it("only a project admin approves or merges", async () => {
    const harness = await start({ bridge: { context: () => context() }, github: prRoutes() });
    const refused = await harness.call("/api/github/pull-requests/review", review("member-session", { action: "merge" }));
    expect(refused.status).toBe(403);
    expect(harness.network.requests.some((r) => r.key.startsWith("PUT"))).toBe(false);
  });

  it("merges into the default branch with the project's connection once checks pass, pinned to the checked head", async () => {
    const merges: { authorization: string; body: string }[] = [];
    const harness = await start({
      bridge: { context: () => context() },
      github: { ...prRoutes(), "PUT https://api.github.com/repos/acme/widgets/pulls/8/merge": ({ body, headers }) => { merges.push({ authorization: headers.authorization, body }); return { body: { sha: sha40("c"), merged: true } }; } },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const merged = await harness.call("/api/github/pull-requests/review", review("admin-session", { action: "merge" }));
    expect(await merged.json()).toEqual({ merged: true, sha: sha40("c"), completed: [] });
    expect(merges).toHaveLength(1);
    expect(merges[0].authorization).toBe("Bearer workspace-token");
    expect(JSON.parse(merges[0].body)).toMatchObject({ sha: sha40("a"), merge_method: "squash" });
  });

  it("syncs GitHub's actual closed issues after merging without issuing an extra close", async () => {
    const issue = (state: string) => ({ number: 5, html_url: "https://github.com/acme/widgets/issues/5", state, updated_at: "2026-10-17T11:00:00Z" });
    const closed: unknown[] = [];
    const harness = await start({
      bridge: {
        context: ({ projectId, taskId }) => context({ project: { ...context().project, _id: projectId }, task: { _id: taskId, title: "Login", done: false, githubIssueNumber: 5, githubIssueUrl: "https://github.com/acme/widgets/issues/5", githubIssueState: "open" } }),
        prEventTargets: () => [],
        webhookTargets: () => [
          { projectId: "p1", taskId: "t1", repoUrl: "https://github.com/acme/widgets", number: 5 },
          { projectId: "another-project", taskId: "another-task", repoUrl: "https://github.com/acme/widgets", number: 5 },
        ],
        linkIssue: () => null,
        completeMergedIssue: () => true,
      },
      github: {
        ...prRoutes(),
        "PUT https://api.github.com/repos/acme/widgets/pulls/8/merge": () => ({ body: { sha: sha40("c"), merged: true } }),
        "PATCH https://api.github.com/repos/acme/widgets/issues/5": ({ body }) => { closed.push(JSON.parse(body)); return { body: issue("closed") }; },
        "GET https://api.github.com/repos/acme/widgets/issues/5": () => ({ body: issue("closed") }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const merged = await harness.call("/api/github/pull-requests/review", review("admin-session", { action: "merge" }));
    expect(await merged.json()).toEqual({ merged: true, sha: sha40("c"), completed: [5] });
    expect(closed).toEqual([]);
    expect(harness.network.bridgeCalls.find((c) => c.name === "linkIssue")?.args).toMatchObject({ taskId: "t1", number: 5, state: "closed" });
    expect(harness.network.bridgeCalls.filter((c) => c.name === "completeMergedIssue").map((c) => c.args)).toEqual([{
      projectId: "p1", taskId: "t1", repoUrl: "https://github.com/acme/widgets", issueNumber: 5,
      pullRequest: { number: 8, headSha: sha40("a"), mergeSha: sha40("c"), mergedAt: NOW },
    }]);
  });

  it("does not report a parked issue completed when its merge receipt is rejected", async () => {
    const harness = await start({
      bridge: {
        context: () => context({ task: { _id: "t1", title: "Parked", done: false, draft: true, githubIssueNumber: 5, githubIssueState: "closed" } }),
        prEventTargets: () => [],
        webhookTargets: () => [{ projectId: "p1", taskId: "t1", repoUrl: "https://github.com/acme/widgets", number: 5 }],
        linkIssue: () => null,
        completeMergedIssue: () => false,
      },
      github: {
        ...prRoutes(),
        "PUT https://api.github.com/repos/acme/widgets/pulls/8/merge": () => ({ body: { sha: sha40("c"), merged: true } }),
        "GET https://api.github.com/repos/acme/widgets/issues/5": () => ({ body: { number: 5, state: "closed", updated_at: "2026-10-17T11:00:00Z" } }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const merged = await harness.call("/api/github/pull-requests/review", review("admin-session", { action: "merge" }));
    expect(await merged.json()).toEqual({ merged: true, sha: sha40("c"), completed: [] });
    expect(harness.network.bridgeCalls.filter((c) => c.name === "completeMergedIssue")).toHaveLength(1);
  });

  it("does not close an unrelated issue mentioned in a PR example when GitHub links another issue", async () => {
    const harness = await start({
      bridge: { context: () => context(), prEventTargets: () => [], webhookTargets: () => [] },
      github: {
        ...prRoutes({ pr: { body: "Example: `Closes #5`\n\nFixes acme/other#5" }, closes: [] }),
        "PUT https://api.github.com/repos/acme/widgets/pulls/8/merge": () => ({ body: { sha: sha40("c"), merged: true } }),
        "PATCH https://api.github.com/repos/acme/widgets/issues/5": () => ({ body: {} }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const merged = await harness.call("/api/github/pull-requests/review", review("admin-session", { action: "merge" }));
    expect(await merged.json()).toEqual({ merged: true, sha: sha40("c"), completed: [] });
    expect(harness.network.requests.some((request) => request.key.includes("/issues/"))).toBe(false);
  });

  it("waits for GitHub to close a linked issue instead of reporting it completed while still open", async () => {
    const harness = await start({
      bridge: {
        context: () => context({ task: { _id: "t1", title: "Login", done: false, githubIssueNumber: 5, githubIssueState: "open" } }),
        prEventTargets: () => [],
        webhookTargets: () => [{ projectId: "p1", taskId: "t1", repoUrl: "https://github.com/acme/widgets", number: 5 }],
        linkIssue: () => null,
        completeMergedIssue: () => false,
      },
      github: {
        ...prRoutes(),
        "PUT https://api.github.com/repos/acme/widgets/pulls/8/merge": () => ({ body: { sha: sha40("c"), merged: true } }),
        "GET https://api.github.com/repos/acme/widgets/issues/5": () => ({ body: { number: 5, state: "open", updated_at: "2026-10-17T11:00:00Z" } }),
        "PATCH https://api.github.com/repos/acme/widgets/issues/5": () => ({ body: {} }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const merged = await harness.call("/api/github/pull-requests/review", review("admin-session", { action: "merge" }));
    expect(await merged.json()).toEqual({ merged: true, sha: sha40("c"), completed: [] });
    expect(harness.network.requests.some((request) => request.key.startsWith("PATCH"))).toBe(false);
    expect(harness.network.bridgeCalls.find((call) => call.name === "completeMergedIssue")?.args).toMatchObject({
      taskId: "t1", issueNumber: 5, pullRequest: { number: 8, headSha: sha40("a"), mergeSha: sha40("c") },
    });
  });

  it("refuses a merge when GitHub cannot resolve the PR's closing references", async () => {
    const harness = await start({
      bridge: { context: () => context() },
      github: { ...prRoutes(), "POST https://api.github.com/graphql": () => ({ body: { errors: [{ message: "Forbidden" }] } }) },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const refused = await harness.call("/api/github/pull-requests/review", review("admin-session", { action: "merge" }));
    expect(await refused.json()).toEqual({ error: "GitHub closing issue references are unavailable; retry before merging" });
    expect(harness.network.requests.some((request) => request.key.startsWith("PUT"))).toBe(false);
  });

  it("refuses to merge while checks fail and never uses the legacy owner token", async () => {
    const harness = await start({ env: { legacyToken: "legacy-token" }, bridge: { context: () => context({ legacyOwner: true }) }, github: prRoutes({ conclusion: "failure" }) });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const refused = await harness.call("/api/github/pull-requests/review", review("admin-session", { action: "merge" }));
    expect(await refused.json()).toEqual({ error: "checks on #8 are failure; merge once they pass" });
    expect(harness.network.requests.every((r) => r.headers.authorization !== "Bearer legacy-token")).toBe(true);
  });

  it("falls back to a comment when GitHub refuses an approval from the pull request's own author", async () => {
    const events: string[] = [];
    const harness = await start({
      bridge: { context: () => context() },
      github: { "POST https://api.github.com/repos/acme/widgets/pulls/8/reviews": ({ body }) => { const event = JSON.parse(body).event as string; events.push(event); return event === "APPROVE" ? { status: 422 } : { body: {} }; } },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    const approved = await harness.call("/api/github/pull-requests/review", review("admin-session", { action: "approve", body: "Looks right." }));
    expect(await approved.json()).toEqual({ approved: false });
    expect(events).toEqual(["APPROVE", "COMMENT"]);
  });
});

describe("POST /api/github/issues/delete", () => {
  const ISSUE = "https://api.github.com/repos/acme/widgets/issues/5";
  const remote = (body = "Build it\n\n<!-- origin-task:t1 -->") => ({ number: 5, node_id: "I_5", html_url: "https://github.com/acme/widgets/issues/5", state: "open", updated_at: "2026-10-16T00:00:00Z", body });
  const remove = (session = "member-session") => ({ method: "POST", session, body: JSON.stringify({ projectId: "p1", taskId: "t1" }) });
  const setup = async (github: Record<string, Route>, convex: Record<string, Handler> = {}) => {
    const harness = await start({
      bridge: { context: () => context() },
      convex: {
        "tasks:details": () => ({ task: { _id: "t1", githubIssueNumber: 5, githubIssueUrl: "https://github.com/acme/widgets/issues/5" } }),
        "tasks:deleteTask": () => null,
        ...convex,
      },
      github: { "GET https://api.github.com/repos/acme/widgets": () => ({ body: { default_branch: "main" } }), ...github },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    return harness;
  };
  const deletedInOrigin = (harness: Awaited<ReturnType<typeof setup>>) => harness.convex.calls.some((call) => call.name === "tasks:deleteTask");

  it("deletes the GitHub issue Origin created, then the Origin issue", async () => {
    const mutations: unknown[] = [];
    const harness = await setup({
      [`GET ${ISSUE}`]: () => ({ body: remote() }),
      "POST https://api.github.com/graphql": ({ body }) => { mutations.push(JSON.parse(body)); return { body: { data: { deleteIssue: { clientMutationId: null } } } }; },
    });
    const response = await harness.call("/api/github/issues/delete", remove());
    expect(await response.json()).toEqual({ github: { outcome: "deleted", number: 5 }, message: "Deleted the issue; GitHub issue #5 was deleted too." });
    expect(mutations).toEqual([{ query: expect.stringContaining("deleteIssue"), variables: { id: "I_5" } }]);
    expect(harness.network.requests.every((request) => request.headers.authorization === "Bearer workspace-token")).toBe(true);
    expect(deletedInOrigin(harness)).toBe(true);
  });

  it("closes it as not planned with a note when the connection may not delete issues", async () => {
    const writes: { key: string; body: unknown }[] = [];
    const record: Route = ({ method, body }) => { writes.push({ key: method, body: JSON.parse(body) }); return { body: remote() }; };
    const harness = await setup({
      [`GET ${ISSUE}`]: () => ({ body: remote() }),
      "POST https://api.github.com/graphql": () => ({ body: { data: { deleteIssue: null }, errors: [{ type: "FORBIDDEN", message: "octo does not have the correct permissions to execute `DeleteIssue`" }] } }),
      [`PATCH ${ISSUE}`]: record,
      [`POST ${ISSUE}/comments`]: record,
    });
    const result = await (await harness.call("/api/github/issues/delete", remove())).json() as { github: unknown; message: string };
    expect(result.github).toEqual({ outcome: "closed", number: 5, reason: "Origin's GitHub connection is not an admin of this repository" });
    expect(result.message).toContain("closed as not planned");
    expect(writes).toEqual([
      { key: "PATCH", body: { state: "closed", state_reason: "not_planned" } },
      { key: "POST", body: { body: expect.stringContaining("Deleted in Origin (ORI-T1)") } },
    ]);
    expect(deletedInOrigin(harness)).toBe(true);
  });

  it("only closes an issue Origin did not create", async () => {
    const harness = await setup({
      [`GET ${ISSUE}`]: () => ({ body: remote("Reported by a customer") }),
      [`PATCH ${ISSUE}`]: () => ({ body: remote() }),
      [`POST ${ISSUE}/comments`]: () => ({ body: {} }),
    });
    const result = await (await harness.call("/api/github/issues/delete", remove())).json() as { github: unknown; message: string };
    expect(result.github).toMatchObject({ outcome: "closed", reason: "it was not created by Origin" });
    expect(harness.network.requests.some((request) => request.key.endsWith("/graphql"))).toBe(false);
  });

  it("treats an issue already gone from GitHub as removed", async () => {
    const harness = await setup({ [`GET ${ISSUE}`]: () => ({ status: 410 }) });
    expect(await (await harness.call("/api/github/issues/delete", remove())).json()).toMatchObject({ github: { outcome: "missing", number: 5 } });
    expect(deletedInOrigin(harness)).toBe(true);
  });

  it("keeps the Origin issue when GitHub fails, and says so when Origin fails after GitHub", async () => {
    const down = await setup({ [`GET ${ISSUE}`]: () => ({ status: 502 }) });
    const failed = await down.call("/api/github/issues/delete", remove());
    expect(failed.status).toBe(400);
    expect(deletedInOrigin(down)).toBe(false);
    const rejected = await setup({
      [`GET ${ISSUE}`]: () => ({ body: remote() }),
      "POST https://api.github.com/graphql": () => ({ body: { data: { deleteIssue: { clientMutationId: null } } } }),
    }, { "tasks:deleteTask": () => { throw new Error("Task not found"); } });
    const partial = await rejected.call("/api/github/issues/delete", remove());
    expect(partial.status).toBe(502);
    expect(await partial.json()).toEqual({ error: "GitHub issue #5 was deleted too, but Origin could not delete the issue: Task not found", github: { outcome: "deleted", number: 5 } });
  });

  it("refuses a viewer before touching GitHub", async () => {
    const harness = await setup({}, { "projects:get": () => ({ _id: "p1", teamId: "team1", repoUrl: "https://github.com/acme/widgets", memberRole: "viewer", githubWorkspaceAccess: true }) });
    expect((await harness.call("/api/github/issues/delete", remove())).status).toBe(400);
    expect(harness.network.requests).toEqual([]);
    expect(deletedInOrigin(harness)).toBe(false);
  });
});

describe("project repositories", () => {
  it("creates the repository under the requested name and lists the workspace connection's repositories", async () => {
    const names: string[] = [];
    const harness = await start({
      convex: { "projects:get": () => ({ _id: "p1", teamId: "team1", memberRole: "admin" }) },
      bridge: { context: () => context({ project: { ...context().project, repoUrl: undefined } }), repoResult: () => null },
      github: {
        "POST https://api.github.com/user/repos": ({ body }) => {
          names.push(JSON.parse(body).name as string);
          return { status: 201, body: { id: 9, html_url: "https://github.com/octo/My-App", description: JSON.parse(body).description, owner: { login: "octo" }, private: true } };
        },
        "GET https://api.github.com/user/repos": () => ({ body: [{ full_name: "octo/site", html_url: "https://github.com/octo/site", private: false }] }),
      },
    });
    harness.service.store.saveWorkspace("team1", "octo", 42, "u-admin", { access_token: "workspace-token" });
    expect((await harness.call("/api/github/repo?teamId=team1&projectId=p1", { method: "POST", session: "admin-session", body: JSON.stringify({ name: "bad name" }) })).status).toBe(400);
    const created = await harness.call("/api/github/repo?teamId=team1&projectId=p1", { method: "POST", session: "admin-session", body: JSON.stringify({ name: "My-App" }) });
    expect(await created.json()).toEqual({ state: "ready", repoUrl: "https://github.com/octo/My-App" });
    expect(names).toEqual(["My-App"]);
    expect(await (await harness.call("/api/github/repos?teamId=team1", { session: "admin-session" })).json()).toEqual({ login: "octo", repositories: [{ fullName: "octo/site", url: "https://github.com/octo/site", private: false }] });
    expect((await harness.call("/api/github/repos?teamId=team1", { session: "member-session" })).status).toBe(403);
  });
});
