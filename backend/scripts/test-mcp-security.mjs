import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

process.loadEnvFile("/tmp/origin-integration-qa.env");
const site = process.env.ORIGIN_PUBLIC_URL;
const backend = process.env.NEXT_PUBLIC_CONVEX_URL;
for (const value of [site, backend]) assert.equal(new URL(value).hostname, "127.0.0.1", "Only isolated localhost is allowed");
const { alex, sam, viewer, workspace, projectId } = JSON.parse(await readFile("/tmp/origin-qa-session.json", "utf8"));
const convex = new ConvexHttpClient(backend, { logger: false });
const query = (name, args) => convex.query(makeFunctionReference(name), args);
const mutate = (name, args) => convex.mutation(makeFunctionReference(name), args);
const resource = `${site}/api/mcp`;
const prefix = `plugin-qa-${Date.now()}`;
const sessions = [];
const jsonPost = (path, body, sessionToken) => fetch(`${site}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) }, body: JSON.stringify(body),
});
const tokenPost = args => fetch(`${site}/oauth/token`, { method: "POST", body: new URLSearchParams(args) });
async function authorize(scope = "origin:read origin:write", who = alex) {
  const registration = await jsonPost("/oauth/register", { client_name: prefix, redirect_uris: ["http://127.0.0.1:8765/callback"], token_endpoint_auth_method: "none" });
  assert.equal(registration.status, 201);
  const client = await registration.json();
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: "code", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource, scope, state: prefix });
  return { client, verifier, params, who };
}
async function consent(auth, extra = {}) {
  return jsonPost("/api/mcp/authorize", { query: auth.params.toString(), teamId: workspace._id, allow: true, ...extra }, auth.who.sessionToken);
}
async function exchange(auth, code, extra = {}) {
  return tokenPost({ grant_type: "authorization_code", code, client_id: auth.client.client_id, redirect_uri: auth.client.redirect_uris[0], code_verifier: auth.verifier, resource, ...extra });
}
async function connect(auth, checkPkce = false) {
  const approval = await consent(auth);
  assert.equal(approval.status, 200);
  const redirect = new URL((await approval.json()).url);
  assert.equal(redirect.searchParams.get("state"), prefix);
  assert.equal(redirect.searchParams.get("iss"), site);
  const code = redirect.searchParams.get("code");
  if (checkPkce) {
    for (const change of [{ code_verifier: randomBytes(32).toString("base64url") }, { resource: `${site}/wrong-resource` }, { redirect_uri: "http://127.0.0.1:8765/wrong" }]) {
      assert.equal((await exchange(auth, code, change)).status, 400);
    }
  }
  const response = await exchange(auth, code);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal((await exchange(auth, code)).status, 400, "Authorization codes are single-use");
  const client = new Client({ name: "Origin plugin QA", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
  const session = { client, tokens, auth };
  sessions.push(session);
  return session;
}
async function call(session, name, args = {}) {
  const result = await session.client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  return JSON.parse(result.content[0].text);
}
async function denied(session, name, args = {}) {
  try {
    const result = await session.client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} must not succeed`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.match(error.message, /not found|Unknown tool|invalid|permission|unauthorized|401/i);
  }
}

try {
  const metadata = await (await fetch(`${site}/.well-known/oauth-authorization-server`)).json();
  assert.equal(metadata.issuer, site);
  assert.ok(metadata.code_challenge_methods_supported.includes("S256"));
  const unauthenticated = await fetch(resource);
  assert.equal(unauthenticated.status, 401);
  assert.ok(unauthenticated.headers.get("www-authenticate").includes("oauth-protected-resource"));
  assert.equal((await jsonPost("/oauth/register", { redirect_uris: ["http://evil.example/callback"] })).status, 400);
  const deniedAuth = await authorize();
  const refusal = await consent(deniedAuth, { allow: false });
  assert.equal(new URL((await refusal.json()).url).searchParams.get("error"), "access_denied");
  assert.equal((await consent(await authorize("origin:read origin:write", viewer))).status, 400);
  const admin = await connect(await authorize(), true);
  const tools = (await admin.client.listTools()).tools;
  assert.equal(tools.length, 11);
  for (const tool of tools) for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"]) assert.equal(typeof tool.annotations[hint], "boolean");
  console.log("PASS SDK initialization, 11 tool descriptors, OAuth discovery, PKCE, resource binding, code replay and viewer consent denial");

  const projects = await call(admin, "list_projects");
  assert.ok(projects.projects.some(project => project.id === projectId));
  assert.ok((await call(admin, "list_members", { projectId })).members.some(member => member.email === alex.user.email));
  assert.ok(Array.isArray((await call(admin, "get_inbox", { view: "notifications" })).notifications));
  const createArgs = { name: "Disposable MCP plugin QA", description: "Synthetic localhost-only project", requestId: `${prefix}-project` };
  const created = await call(admin, "create_project", createArgs);
  assert.deepEqual(await call(admin, "create_project", createArgs), created);
  await call(admin, "update_project", { projectId: created.id, name: "Updated MCP plugin QA", requestId: `${prefix}-rename` });
  const project = await call(admin, "get_project", { projectId: created.id });
  assert.equal(project.name, "Updated MCP plugin QA");
  const taskArgs = { projectId: created.id, columnId: project.columns[0].id, requestId: `${prefix}-issue`, title: "Disposable SDK issue", priority: "high", assignedToEmail: alex.user.email, dueDate: "2026-10-01" };
  const issue = await call(admin, "create_issue", taskArgs);
  assert.deepEqual(await call(admin, "create_issue", taskArgs), issue);
  await denied(admin, "create_issue", { ...taskArgs, title: "A different operation with the same ID" });
  assert.equal((await call(admin, "list_issues", { projectId: created.id })).issues.length, 1);
  assert.ok((await call(admin, "get_inbox")).issues.some(item => item.id === issue.id));
  for (const done of [true, false]) {
    await call(admin, "update_issue", { projectId: created.id, taskId: issue.id, done, requestId: `${prefix}-${done}` });
    assert.equal((await call(admin, "get_issue", { projectId: created.id, taskId: issue.id })).done, done);
  }
  await denied(admin, "create_issue", { ...taskArgs, requestId: `${prefix}-assignee`, assignedToEmail: "outsider@example.test" });
  const foreign = (await query("workspaces:list", { sessionToken: sam.sessionToken })).find(team => team._id !== workspace._id);
  const foreignProjects = await query("projects:listForUser", { sessionToken: sam.sessionToken, teamId: foreign._id });
  assert.ok(foreignProjects.length > 0, "Fixture must contain another workspace project");
  await denied(admin, "get_project", { projectId: foreignProjects[0]._id });
  await denied(admin, "update_project", { projectId: foreignProjects[0]._id, name: "Not permitted", requestId: `${prefix}-cross-workspace` });
  const readOnly = await connect(await authorize("origin:read"));
  assert.equal((await readOnly.client.listTools()).tools.length, 6);
  await denied(readOnly, "delete_issue", { projectId: created.id, taskId: issue.id, requestId: `${prefix}-forbidden-delete` });
  const deletion = { projectId: created.id, taskId: issue.id, requestId: `${prefix}-delete` };
  await call(admin, "delete_issue", deletion);
  await call(admin, "delete_issue", deletion);
  await denied(admin, "get_issue", { projectId: created.id, taskId: issue.id });
  console.log("PASS every MCP tool, project/issue lifecycle, completion/restore, duplicate-write protection, assignee validation and workspace/read-only isolation");

  const refreshArgs = { grant_type: "refresh_token", refresh_token: readOnly.tokens.refresh_token, client_id: readOnly.auth.client.client_id, resource };
  const refresh = await tokenPost(refreshArgs);
  assert.equal(refresh.status, 200);
  const rotated = await refresh.json();
  assert.notEqual(rotated.refresh_token, readOnly.tokens.refresh_token);
  assert.equal((await tokenPost(refreshArgs)).status, 400);
  assert.equal((await fetch(resource, { headers: { Authorization: `Bearer ${rotated.access_token}` } })).status, 401, "Refresh replay revokes the whole grant");
  assert.equal((await fetch(resource, { method: "POST", headers: { Authorization: `Bearer ${admin.tokens.access_token}`, Origin: "https://evil.example" }, body: "{}" })).status, 403);
  const revocation = await fetch(`${site}/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: admin.tokens.access_token, client_id: admin.auth.client.client_id }) });
  assert.equal(revocation.status, 200);
  assert.equal((await fetch(resource, { headers: { Authorization: `Bearer ${admin.tokens.access_token}` } })).status, 401);
  console.log("PASS refresh rotation, replay revocation, invalid Origin rejection and explicit token revocation");
} finally {
  for (const session of sessions) await session.client.close();
  const grants = await query("connectors:listGrants", { sessionToken: alex.sessionToken, teamId: workspace._id });
  for (const grant of grants.filter(item => item.name.startsWith(prefix) && !item.revoked)) {
    await mutate("connectors:revoke", { sessionToken: alex.sessionToken, teamId: workspace._id, grantId: grant._id });
  }
}
