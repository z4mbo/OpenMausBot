import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { json, readBody } from "./harness/http.ts";
import type { OriginCloudClient } from "./origin-cloud.ts";
import { answerMcpMessage, createOriginMcpRoutes, openMcpOAuth, type McpOAuth } from "./origin-mcp.ts";
import { dispatchRoutes } from "./routes/table.ts";

const TEAM = "team0000000001";
const CONNECTOR = "connector-token-0001";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const servers: Server[] = [];
const folders: string[] = [];
const stores: McpOAuth[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

type Call = { name: string; args: Record<string, unknown> };
const body = (response: Response): Promise<any> => response.json();

function fakeConvex(options: { write: boolean }) {
  const calls: Call[] = [];
  const answer = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, args });
    if (name === "auth:me") return args.sessionToken === "tok-ana" ? { _id: "user000000000a", email: "ana@x.dev" } : null;
    if (name === "connectors:createGrant") return { token: CONNECTOR, grantId: "grant1", expiresAt: Date.now() + 86_400_000 };
    if (name === "connectors:verify") {
      if (args.token !== CONNECTOR) throw new Error("Uncaught Error: Invalid connector");
      return { write: options.write, teamId: TEAM, expiresAt: Date.now() + 86_400_000 };
    }
    if (name === "connectors:read") return `read ${String(args.kind)}`;
    if (name === "connectors:write") return `wrote ${String((args.change as { kind: string }).kind)}`;
    throw new Error(`unexpected ${name}`);
  };
  const client: OriginCloudClient = { query: answer, mutation: answer };
  return { client, calls };
}

async function start(options: { write?: boolean } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "omb-origin-mcp-"));
  folders.push(folder);
  const server = createServer();
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const oauth = openMcpOAuth({ file: join(folder, "mcp.sqlite"), keyFile: join(folder, "mcp.key") });
  stores.push(oauth);
  const convex = fakeConvex({ write: options.write ?? true });
  const route = createOriginMcpRoutes({ publicUrl: () => base, convex: () => convex.client, convexUrl: () => "http://127.0.0.1:3210", oauth });
  server.on("request", async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    if (!(await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", json, readBody }))) json(res, 404, { error: "no route" });
  });
  return { base, convex };
}

async function connect(base: string, scope: string) {
  const registered = await fetch(`${base}/oauth/register`, { method: "POST", body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }) }).then(body);
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: registered.client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource: `${base}/api/mcp`, scope, state: "xyz",
  }).toString();
  const info = await fetch(`${base}/api/mcp/authorize?${query}`).then(body);
  const consent = await fetch(`${base}/api/mcp/authorize`, { method: "POST", headers: { "content-type": "application/json", "x-origin-session": "tok-ana" }, body: JSON.stringify({ query, teamId: TEAM, allow: true }) }).then(body);
  const redirect = new URL(consent.url);
  const tokens = await fetch(`${base}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: redirect.searchParams.get("code") ?? "", redirect_uri: REDIRECT, client_id: registered.client_id, code_verifier: verifier, resource: `${base}/api/mcp` }),
  }).then(body);
  return { registered, info, redirect, tokens };
}

const rpc = (base: string, accessToken: string, body: unknown) => fetch(`${base}/api/mcp`, {
  method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body),
});

describe("origin MCP OAuth", () => {
  it("publishes discovery metadata for this app's origin", async () => {
    const { base } = await start();
    const server = await fetch(`${base}/.well-known/oauth-authorization-server`).then(body);
    expect(server).toMatchObject({ issuer: base, token_endpoint: `${base}/oauth/token`, code_challenge_methods_supported: ["S256"] });
    expect(await fetch(`${base}/.well-known/oauth-protected-resource/api/mcp`).then(body)).toMatchObject({ resource: `${base}/api/mcp`, authorization_servers: [base] });
  });

  it("names the loopback address it was reached on when no public address is set", async () => {
    const folder = mkdtempSync(join(tmpdir(), "omb-origin-mcp-"));
    folders.push(folder);
    const oauth = openMcpOAuth({ file: join(folder, "mcp.sqlite"), keyFile: join(folder, "mcp.key") });
    stores.push(oauth);
    const route = createOriginMcpRoutes({ convex: () => null, oauth });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!(await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", json, readBody }))) json(res, 404, { error: "no route" });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/.well-known/oauth-protected-resource`).then(body)).resource).toBe(`${base}/api/mcp`);
    expect((await fetch(`${base}/api/elsewhere`)).status).toBe(404);
  });

  it("refuses non-loopback http redirects", async () => {
    const { base } = await start();
    const refused = await fetch(`${base}/oauth/register`, { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) });
    expect(refused.status).toBe(400);
  });

  it("runs the PKCE code flow, serves tools, rotates refresh tokens and revokes on reuse", async () => {
    const { base, convex } = await start();
    const { registered, info, redirect, tokens } = await connect(base, "origin:read origin:write");
    expect(info).toEqual({ name: "Claude", domain: "claude.ai", write: true, convexUrl: "http://127.0.0.1:3210" });
    expect(redirect.searchParams.get("state")).toBe("xyz");
    expect(redirect.searchParams.get("iss")).toBe(base);
    expect(tokens).toMatchObject({ token_type: "Bearer", scope: "origin:read origin:write" });
    expect(convex.calls.find((call) => call.name === "connectors:createGrant")?.args).toMatchObject({ teamId: TEAM, write: true, name: "Claude (claude.ai)" });

    const init = await rpc(base, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }).then(body);
    expect(init.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "Origin" } });
    expect((await rpc(base, tokens.access_token, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await rpc(base, tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" }).then(body);
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toContain("create_issue");
    expect(list.result.tools.find((tool: { name: string }) => tool.name === "get_issue").inputSchema).toMatchObject({ type: "object", required: ["projectId", "taskId"] });
    const read = await rpc(base, tokens.access_token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_projects", arguments: {} } }).then(body);
    expect(read.result).toEqual({ content: [{ type: "text", text: "read projects" }] });
    const wrote = await rpc(base, tokens.access_token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_project", arguments: { requestId: "req-00001", name: "New" } } }).then(body);
    expect(wrote.result.content[0].text).toBe("wrote create_project");
    expect(convex.calls.at(-1)?.args).toEqual({ token: CONNECTOR, requestId: "req-00001", change: { kind: "create_project", name: "New" } });
    const invalid = await rpc(base, tokens.access_token, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_issue", arguments: { projectId: "x" } } }).then(body);
    expect(invalid.result.isError).toBe(true);

    const refresh = (token: string) => fetch(`${base}/oauth/token`, {
      method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: registered.client_id, resource: `${base}/api/mcp` }),
    });
    const rotated = await refresh(tokens.refresh_token).then(body);
    expect(rotated.access_token).not.toBe(tokens.access_token);
    expect((await refresh(tokens.refresh_token)).status).toBe(400);
    expect((await rpc(base, rotated.access_token, { jsonrpc: "2.0", id: 6, method: "ping" })).status).toBe(401);
  });

  it("hides write tools from a read-only grant and answers 401 with resource metadata without a token", async () => {
    const { base } = await start({ write: false });
    const unauthorized = await rpc(base, "nope", { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain(`${base}/.well-known/oauth-protected-resource`);
    const { tokens } = await connect(base, "origin:read origin:write");
    const list = await rpc(base, tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" }).then(body);
    expect(list.result.tools.some((tool: { name: string }) => tool.name === "create_issue")).toBe(false);
    const write = await rpc(base, tokens.access_token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "delete_issue", arguments: {} } }).then(body);
    expect(write.error.code).toBe(-32602);
  });

  it("refuses a consent from another site and a revoked token", async () => {
    const { base } = await start();
    const { registered, tokens } = await connect(base, "origin:read");
    const forged = await fetch(`${base}/api/mcp/authorize`, { method: "POST", headers: { origin: "https://evil.example", "x-origin-session": "tok-ana" }, body: JSON.stringify({ query: "", allow: true }) });
    expect(forged.status).toBe(400);
    await fetch(`${base}/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: tokens.access_token, client_id: registered.client_id }) });
    expect((await rpc(base, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
  });
});

describe("create_issue", () => {
  it.each([undefined, "column000001"])("forwards the person's optional destination %s without inventing a column", async (columnId) => {
    const { client, calls } = fakeConvex({ write: true });
    const args = { requestId: "request-0001", projectId: "project000001", title: "Private idea", priority: "medium", assignedToEmail: "me@example.test", dueDate: "2026-11-01", ...(columnId ? { columnId } : {}) };
    const reply = await answerMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_issue", arguments: args } }, { connectorToken: CONNECTOR, write: true, grantId: "grant1" }, client);
    expect(reply?.result).toMatchObject({ content: [{ type: "text", text: "wrote create_issue" }] });
    const { requestId, ...change } = args;
    expect(calls.at(-1)).toEqual({ name: "connectors:write", args: { token: CONNECTOR, requestId, change: { kind: "create_issue", ...change } } });
  });
});

describe("delete_issue", () => {
  const ISSUE_URL = "https://github.com/acme/widgets/issues/5";
  const auth = { connectorToken: CONNECTOR, write: true, grantId: "grant1" };
  const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_issue", arguments: { requestId: "request-0001", projectId: "project000001", taskId: "task0000000001" } } };
  const convex = (linked: boolean) => {
    const order: string[] = [];
    const client: OriginCloudClient = {
      query: async (name) => { order.push(name); return JSON.stringify({ id: "task0000000001", ...(linked ? { githubIssueUrl: ISSUE_URL } : {}) }); },
      mutation: async (name) => { order.push(name); return JSON.stringify({ id: "task0000000001" }); },
    };
    return { client, order };
  };
  const text = (reply: Record<string, any> | null) => reply?.result.content[0].text as string;

  it("removes the linked GitHub issue after Origin deleted the issue, and reports what happened", async () => {
    const { client, order } = convex(true);
    const removed: string[][] = [];
    const reply = await answerMcpMessage(call, auth, client, async (projectId, taskId, issueUrl) => {
      order.push("github");
      removed.push([projectId, taskId, issueUrl]);
      return "GitHub issue #5 was deleted too";
    });
    expect(order).toEqual(["connectors:read", "connectors:write", "github"]);
    expect(removed).toEqual([["project000001", "task0000000001", ISSUE_URL]]);
    expect(text(reply)).toBe('{"id":"task0000000001"}\nGitHub issue #5 was deleted too.');
  });

  it("says the GitHub issue is still there when removing it fails, and leaves unlinked issues alone", async () => {
    const failing = await answerMcpMessage(call, auth, convex(true).client, async () => { throw new Error("Reconnect GitHub in workspace settings"); });
    expect(text(failing)).toContain(`Its GitHub issue ${ISSUE_URL} is still there: Reconnect GitHub in workspace settings.`);
    let asked = false;
    const unlinked = await answerMcpMessage(call, auth, convex(false).client, async () => { asked = true; return ""; });
    expect(text(unlinked)).toBe('{"id":"task0000000001"}');
    expect(asked).toBe(false);
  });
});
