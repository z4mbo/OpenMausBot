// @vitest-environment node
import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { appJwt, installationFor, installationToken, projectInstallationToken, withInstallation } from "./github-app";
import { githubAppConfig, githubRequest, workspaceGitHubInfo } from "./github-workspace";
import { integrationBridge } from "./integration-bridge";
vi.mock("./github-workspace", () => ({ githubAppConfig: vi.fn(), githubRequest: vi.fn(), workspaceGitHubInfo: vi.fn() }));
vi.mock("./integration-bridge", () => ({ integrationBridge: vi.fn() }));
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
function config() {
  vi.mocked(githubAppConfig).mockReturnValue({ appId: 1, privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), clientId: "fake", clientSecret: "fake" });
}
function authorizeProject() {
  vi.mocked(integrationBridge).mockResolvedValue({ project: { repoUrl: "https://github.com/test/prs", githubWorkspaceAccess: true }, connection: { teamId: "team-1", login: "test", connectedBy: "user-1" } });
  vi.mocked(workspaceGitHubInfo).mockReturnValue({ team: "team-1", login: "test", account_id: 99, connected_by: "user-1" });
}
test("App JWT uses a bounded lifetime and installation tokens are repo/permission scoped", async () => {
  config();
  const jwt = appJwt(), [header, payload, sig] = jwt.split(".");
  expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  expect(claims.exp - claims.iat).toBe(600);
  vi.mocked(githubRequest).mockResolvedValueOnce({ id: 42, permissions: { contents: "write", pull_requests: "write", checks: "read" } }).mockResolvedValueOnce({ token: "fake-short-lived-push", expires_at: new Date(Date.now() + 3600000).toISOString(), repositories: [{ full_name: "test/prs" }] });
  const result = await installationToken("https://github.com/test/prs", true);
  expect(result.token).toBe("fake-short-lived-push");
  const body = JSON.parse(vi.mocked(githubRequest).mock.calls[1][2]!.body as string);
  expect(body).toEqual({ repositories: ["prs"], permissions: { contents: "write" } });
});
test("old permissions give guided reapproval; missing signing credentials fail without OAuth fallback", async () => {
  config(); vi.mocked(githubRequest).mockResolvedValueOnce({ id: 42, permissions: { contents: "read", issues: "write", pull_requests: "read" } });
  await expect(installationFor("https://github.com/test/prs")).rejects.toThrow("accept the new permissions");
  vi.mocked(githubAppConfig).mockReturnValue({ clientId: "fake", clientSecret: "fake" });
  expect(() => appJwt()).toThrow("GITHUB_APP_PRIVATE_KEY");
});
test("unexpected repository scope rejected and App request tokens revoked on failure", async () => {
  config();
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetch);
  vi.mocked(githubRequest).mockResolvedValueOnce({ id: 42, permissions: { contents: "write", pull_requests: "write", checks: "read" } }).mockResolvedValueOnce({ token: "fake", expires_at: new Date(Date.now() + 3600000).toISOString(), repositories: [{ full_name: "test/other" }] });
  await expect(installationToken("https://github.com/test/prs")).rejects.toThrow("scope");
  authorizeProject();
  vi.mocked(githubRequest).mockResolvedValueOnce({ id: 42, account: { id: 99, login: "test" }, permissions: { contents: "write", pull_requests: "write", checks: "read" } }).mockResolvedValueOnce({ token: "fake", expires_at: new Date(Date.now() + 3600000).toISOString(), repositories: [{ full_name: "test/prs" }] });
  await expect(withInstallation("project-1", "https://github.com/test/prs", async () => { throw new Error("failure"); })).rejects.toThrow("failure");
  expect(fetch).toHaveBeenCalledWith("https://api.github.com/installation/token", expect.objectContaining({ method: "DELETE" }));
});
test("a workspace cannot mint App credentials for another installation or a disconnected account", async () => {
  config(); authorizeProject();
  vi.mocked(githubRequest).mockResolvedValueOnce({ id: 42, account: { id: 100, login: "other-team" }, permissions: { contents: "write", pull_requests: "write", checks: "read" } });
  await expect(projectInstallationToken("project-1", "https://github.com/test/prs", true)).rejects.toThrow("does not belong");
  expect(githubRequest).toHaveBeenCalledTimes(1); // No access token was minted.
  vi.mocked(workspaceGitHubInfo).mockReturnValue(null);
  await expect(projectInstallationToken("project-1", "https://github.com/test/prs", true)).rejects.toThrow("connect GitHub");
});

test("disconnecting GitHub during minting revokes the token before handing it to a host", async () => {
  config(); authorizeProject();
  vi.mocked(integrationBridge).mockResolvedValueOnce({ project: { repoUrl: "https://github.com/test/prs", githubWorkspaceAccess: true }, connection: { teamId: "team-1", login: "test", connectedBy: "user-1" } }).mockResolvedValueOnce({ project: { repoUrl: "https://github.com/test/prs", githubWorkspaceAccess: true }, connection: null });
  vi.mocked(githubRequest).mockResolvedValueOnce({ id: 42, account: { id: 99, login: "test" }, permissions: { contents: "write", pull_requests: "write", checks: "read" } }).mockResolvedValueOnce({ token: "fixture-disconnected", expires_at: new Date(Date.now() + 3600000).toISOString(), repositories: [{ full_name: "test/prs" }] });
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetch);
  await expect(projectInstallationToken("project-1", "https://github.com/test/prs", true)).rejects.toThrow("connect GitHub");
  expect(fetch).toHaveBeenCalledWith("https://api.github.com/installation/token", expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ Authorization: "Bearer fixture-disconnected" }) }));
});
