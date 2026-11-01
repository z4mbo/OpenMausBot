// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { issueMcpCode, registerMcpClient, validateMcpAuthorization } from "./mcp-oauth";
import { integrationDb } from "./githubConnection";
import { signIntegration } from "./integration-bridge";
import { POST as tick } from "../app/api/integrations/tick/route";

const pending = vi.hoisted(() => [] as Promise<unknown>[]);
const mutation = vi.hoisted(() => vi.fn<(reference: unknown, args: { token: string }) => Promise<null>>(async () => null));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: (task: () => Promise<unknown>) => { pending.push(task()); } }));
vi.mock("./localRealtime", () => ({ localDataDir: () => process.env.ORIGIN_LOCAL_DATA_DIR!, getConvexClient: () => ({ mutation }), flushChatNotifications: vi.fn() }));
vi.mock("./github-workspace", () => ({ lockGitHubJob: () => false, saveGitHubJob: vi.fn() }));
vi.mock("./github-sync", () => ({ createProjectRepository: vi.fn(), syncGitHubPage: vi.fn() }));
vi.mock("./github-prs", () => ({ syncPRPage: vi.fn() }));

const directory = mkdtempSync(path.join(tmpdir(), "origin-mcp-tick-"));
process.env.ORIGIN_LOCAL_DATA_DIR = directory;
afterAll(() => { integrationDb().close(); rmSync(directory, { recursive: true, force: true }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); pending.length = 0; mutation.mockClear(); });

function consent(connectorToken: string) {
  const redirect = "http://127.0.0.1:9/callback";
  const client = registerMcpClient({ client_name: "Abandoned CLI", redirect_uris: [redirect], token_endpoint_auth_method: "none" }).client_id;
  const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
  const params = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
  issueMcpCode(validateMcpAuthorization(params), connectorToken, Date.now() + 86400000, true);
}
async function signedTick() {
  const body = JSON.stringify({ at: Date.now() });
  const response = await tick(new Request("http://origin.test/api/integrations/tick", { method: "POST", body, headers: { "x-origin-signature": signIntegration(body) } }));
  await Promise.all(pending.splice(0));
  return response;
}

test("the signed integration tick revokes abandoned OAuth consents in Convex, even while GitHub sync is busy", async () => {
  vi.stubEnv("ORIGIN_PUBLIC_URL", "http://origin.test");
  vi.stubEnv("ORIGIN_INTEGRATION_SECRET", "fixture-secret-".repeat(4));
  consent("origin_oauth_abandoned");
  expect((await signedTick()).status).toBe(200);
  expect(mutation).not.toHaveBeenCalled();

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 6 * 60000);
  await signedTick();
  expect(mutation.mock.calls.map(call => call[1])).toEqual([{ token: "origin_oauth_abandoned" }]);
  expect(integrationDb().prepare("SELECT COUNT(*) AS n FROM mcp_revocations").get()).toEqual({ n: 0 });
  await signedTick();
  expect(mutation).toHaveBeenCalledTimes(1);
});

test("an unsigned tick does no OAuth maintenance", async () => {
  vi.stubEnv("ORIGIN_INTEGRATION_SECRET", "fixture-secret-".repeat(4));
  const response = await tick(new Request("http://origin.test/api/integrations/tick", { method: "POST", body: JSON.stringify({ at: Date.now() }) }));
  expect(response.status).toBe(401);
  expect(pending).toHaveLength(0);
});
