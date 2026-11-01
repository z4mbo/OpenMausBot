// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/github/setup/route";
import { GET } from "../app/api/github/setup/callback/route";
import { GET as workspaceGET } from "../app/api/github/workspace/route";
import { createGithubState, githubAppConfig, saveGitHubApp } from "./github-workspace";
import { integrationDb } from "./githubConnection";

const current = vi.hoisted(() => ({ role: "owner", email: "operator@pg3.test", userId: "operator-user", legacy: "", operator: "operator-user" as string | null | Error }));
vi.mock("../convex/lib/auth", async importOriginal => ({ ...await importOriginal<typeof import("../convex/lib/auth")>(), get DEFAULT_OWNER_EMAIL() { return current.legacy; } }));
vi.mock("./integration-bridge", async importOriginal => ({ ...await importOriginal<typeof import("./integration-bridge")>(), integrationBridge: async (operation: string) => {
  if (operation !== "instanceOperator") throw new Error(`unexpected ${operation}`);
  if (current.operator instanceof Error) throw current.operator;
  return current.operator ? { userId: current.operator } : null;
} }));
vi.mock("./localRealtime", () => ({
  localDataDir: () => process.env.ORIGIN_LOCAL_DATA_DIR!,
  limitLocalAction: vi.fn(),
  sessionTokenFromRequest: () => "fixture-session",
  requireLocalUser: async () => ({ _id: current.userId, email: current.email }),
  getConvexClient: () => ({ query: async () => {
    if (current.role === "removed") throw new Error("Workspace access revoked");
    return { role: current.role };
  } }),
  requireLocalWorkspace: async () => {
    if (current.role === "removed") throw new Error("Workspace access revoked");
    return { _id: current.userId, email: current.email, workspaceRole: current.role, slug: "pg3", teamId: "fixture-team" };
  },
}));
const directory = mkdtempSync(path.join(tmpdir(), "origin-pg3-setup-"));
process.env.ORIGIN_LOCAL_DATA_DIR = directory;
afterAll(() => { integrationDb().close(); rmSync(directory, { recursive: true, force: true }); delete process.env.ORIGIN_LOCAL_DATA_DIR; });
afterEach(() => {
  current.role = "owner"; current.email = "operator@pg3.test"; current.userId = "operator-user"; current.legacy = ""; current.operator = "operator-user";
  vi.unstubAllEnvs();
  integrationDb().exec("DELETE FROM github_app; DELETE FROM github_oauth_states");
  vi.unstubAllGlobals();
});
const manifest = () => POST(new Request("http://localhost:3000/api/github/setup?teamId=fixture-team", { method: "POST" }));
function callback() {
  const { state, browser } = createGithubState({ teamId: "fixture-team", userId: current.userId, sessionToken: "fixture-session", slug: "pg3", mode: "setup" });
  return new NextRequest(`http://localhost:3000/api/github/setup/callback?state=${state}&code=fixtureCode`, { headers: { cookie: `origin.github=${browser}` } });
}
const conversion = () => vi.fn(async () => Response.json({ client_id: "fixture-id", client_secret: "fixture-client-secret", slug: "fixture-app", webhook_secret: "fixture-webhook", id: 123, pem: "fixture-pem" }));

const workspaceStatus = async () => (await workspaceGET(new Request("http://localhost:3000/api/github/workspace?teamId=fixture-team"))).json();
const stranger = () => { current.userId = "stranger-user"; current.email = "stranger@evil.test"; };

test("GitHub App setup: on an open-signup instance a stranger who owns their own workspace is refused", async () => {
  stranger();
  for (const role of ["owner", "admin", "member", "viewer"]) {
    current.role = role;
    expect((await manifest()).status).toBe(403);
    expect(await workspaceStatus()).toMatchObject({ configured: false, canSetup: false });
  }
});

test("GitHub App setup: without ORIGIN_ADMIN_EMAILS only the first workspace's owner, as owner/admin, gets the manifest", async () => {
  for (const role of ["owner", "admin"]) {
    current.role = role;
    const response = await manifest();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await response.json()).toMatchObject({ action: expect.stringContaining("https://github.com/settings/apps/new?state="), manifest: { default_permissions: { contents: "write", pull_requests: "write", checks: "read" }, default_events: expect.arrayContaining(["issues", "pull_request", "check_run"]) } });
    expect(await workspaceStatus()).toMatchObject({ canSetup: true });
  }
  for (const role of ["member", "viewer", "removed"]) {
    current.role = role;
    expect((await manifest()).status).toBe(403);
  }
  current.role = "owner";
  for (const operator of [null, new Error("Integration update failed (503)")]) {
    current.operator = operator;
    expect((await manifest()).status).toBe(403);
  }
});

test("GitHub App setup: ORIGIN_ADMIN_EMAILS names the operators (any role) and replaces the first-workspace rule", async () => {
  vi.stubEnv("ORIGIN_ADMIN_EMAILS", " Ops@PG3.test , second@pg3.test,");
  expect((await manifest()).status).toBe(403);
  current.email = "ops@pg3.test"; current.userId = "ops-user"; current.role = "member";
  expect((await manifest()).status).toBe(200);
  current.email = "SECOND@pg3.test"; current.role = "viewer";
  expect((await manifest()).status).toBe(200);
  current.role = "removed";
  expect((await manifest()).status).toBe(403);
});

test("GitHub App setup: ORIGIN_LEGACY_OWNER_EMAIL is still an operator; nobody can once an App exists", async () => {
  current.legacy = "legacy@pg3.test";
  expect((await manifest()).status).toBe(403);
  current.email = "legacy@pg3.test"; current.userId = "legacy-user"; current.role = "member";
  expect((await manifest()).status).toBe(200);
  current.role = "removed";
  expect((await manifest()).status).toBe(403);
  current.role = "owner";
  saveGitHubApp({ clientId: "existing", clientSecret: "existing-secret" });
  expect((await manifest()).status).toBe(403);
  expect(await workspaceStatus()).toMatchObject({ configured: true, canSetup: false });
});

test("GitHub App setup: the callback re-checks the operator, so a stranger's state cannot save an App", async () => {
  stranger();
  const request = callback(), fetcher = conversion();
  vi.stubGlobal("fetch", fetcher);
  expect((await GET(request)).headers.get("location")).toContain("setup-failed");
  expect(fetcher).not.toHaveBeenCalled();
  expect(githubAppConfig()).toBeNull();
});

test("PG3 O-110: manifest conversion persists encrypted credentials once with cookie and state binding", async () => {
  const request = callback(), fetcher = conversion();
  vi.stubGlobal("fetch", fetcher);
  expect((await GET(new NextRequest(request.url))).headers.get("location")).toContain("setup-failed");
  expect(fetcher).not.toHaveBeenCalled();
  expect((await GET(request)).headers.get("location")).toContain("app-ready");
  expect(githubAppConfig()).toMatchObject({ appId: 123, privateKey: "fixture-pem" });
  expect(JSON.stringify(integrationDb().prepare("SELECT * FROM github_app").all())).not.toMatch(/fixture-client-secret|fixture-pem/);
  expect((await GET(request)).headers.get("location")).toContain("setup-failed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test.each(["viewer", "removed"])("PG3 O-110: setup callback rejects a user whose workspace authority became %s", async role => {
  const request = callback(), fetcher = conversion();
  current.role = role;
  vi.stubGlobal("fetch", fetcher);
  expect((await GET(request)).headers.get("location")).toContain("setup-failed");
  expect(fetcher).not.toHaveBeenCalled();
  expect(githubAppConfig()).toBeNull();
});

test("PG3 O-110: revocation during manifest conversion cannot persist an App", async () => {
  const request = callback();
  vi.stubGlobal("fetch", vi.fn(async () => { current.role = "viewer"; return conversion()(); }));
  expect((await GET(request)).headers.get("location")).toContain("setup-failed");
  expect(githubAppConfig()).toBeNull();
});
