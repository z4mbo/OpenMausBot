import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationCheck } from "../shared/integration-keys.ts";

import { json, readBody } from "./harness/http.ts";
import { createIntegrationKeyRoutes, defaultIntegrationKeysFile, integrationConfigured, integrationKey, integrationStatuses, saveIntegrationKeys } from "./integration-keys.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createSharedKeys, type SharedKey } from "./shared-integration-keys.ts";
import { dispatchRoutes } from "./routes/table.ts";
import * as sharedIntegrationKeys from "./shared-integration-keys.ts";

const folders: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function tempFile() {
  const folder = mkdtempSync(join(tmpdir(), "omb-integration-keys-"));
  folders.push(folder);
  return join(folder, "integration-keys.json");
}

describe("integration keys", () => {
  it("returns values only once every required field is set", () => {
    const file = tempFile();
    expect(integrationKey("linkedin", file)).toBeNull();
    expect(saveIntegrationKeys("linkedin", { accessToken: "tok" }, file)).toEqual({ ok: true });
    expect(integrationConfigured("linkedin", file)).toBe(false);
    saveIntegrationKeys("linkedin", { authorUrn: "urn:li:person:ada" }, file);
    expect(integrationKey("linkedin", file)).toEqual({ accessToken: "tok", authorUrn: "urn:li:person:ada" });
    saveIntegrationKeys("resend", { apiKey: "re_1", senderEmail: "a@b.co" }, file);
    expect(integrationKey("resend", file)).toEqual({ apiKey: "re_1", senderEmail: "a@b.co" });
  });

  it("never shows a secret in the client status, only that it is set", () => {
    const file = tempFile();
    saveIntegrationKeys("bluesky", { handle: "me.bsky.social", appPassword: "aaaa-bbbb" }, file);
    const bluesky = integrationStatuses(file).find((entry) => entry.id === "bluesky")!;
    expect(bluesky.configured).toBe(true);
    expect(JSON.stringify(integrationStatuses(file))).not.toContain("aaaa-bbbb");
    expect(bluesky.fields).toEqual([
      expect.objectContaining({ name: "handle", set: true, value: "me.bsky.social" }),
      expect.objectContaining({ name: "appPassword", set: true, secret: true }),
    ]);
    expect(bluesky.fields[1]).not.toHaveProperty("value");
  });

  it("clears one field with an empty string and the whole integration with null", () => {
    const file = tempFile();
    saveIntegrationKeys("x", { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "u" }, file);
    saveIntegrationKeys("x", { apiKey: "" }, file);
    expect(integrationConfigured("x", file)).toBe(false);
    saveIntegrationKeys("fal", { key: "fal-key" }, file);
    saveIntegrationKeys("x", null, file);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ fal: { key: "fal-key" } });
  });

  it("refuses unknown fields and pasted multi-line values", () => {
    const file = tempFile();
    expect(saveIntegrationKeys("fal", { token: "x" }, file)).toMatchObject({ ok: false });
    expect(saveIntegrationKeys("fal", { key: "a\nb" }, file)).toMatchObject({ ok: false });
    expect(integrationConfigured("fal", file)).toBe(false);
  });
});

async function serve(file: string, scopes: string[], deps: { fetch?: typeof fetch } = {}) {
  const route = createIntegrationKeyRoutes(() => file, deps);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const auth = { kind: "loopback", scopes } as unknown as RequestAuth;
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("integration key routes", () => {
  it("saves write-only keys for an admin and reports configured flags", async () => {
    const file = tempFile();
    const base = await serve(file, ["admin"]);
    const saved = await fetch(`${base}/api/integrations/fal`, { method: "PUT", body: JSON.stringify({ fields: { key: "fal-secret" } }) });
    expect(saved.status).toBe(200);
    const listed = await (await fetch(`${base}/api/integrations`)).text();
    expect(listed).not.toContain("fal-secret");
    expect(JSON.parse(listed).integrations[0]).toMatchObject({ id: "fal", configured: true });
    expect((await fetch(`${base}/api/integrations/fal`, { method: "DELETE" })).status).toBe(200);
    expect(integrationConfigured("fal", file)).toBe(false);
  });

  it("refuses changes without the admin scope", async () => {
    const file = tempFile();
    const base = await serve(file, ["chat"]);
    const response = await fetch(`${base}/api/integrations/fal`, { method: "PUT", body: JSON.stringify({ fields: { key: "x" } }) });
    expect(response.status).toBe(403);
    expect(integrationConfigured("fal", file)).toBe(false);
  });
});

describe("integration check route", () => {
  it("refuses checks without the admin scope before calling the provider", async () => {
    const request = vi.fn<typeof fetch>();
    const base = await serve(tempFile(), ["chat"], { fetch: request });
    const response = await fetch(`${base}/api/integrations/fal/check`, { method: "POST", body: JSON.stringify({ fields: { key: "draft-secret" } }) });
    expect(response.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });

  it("merges trimmed draft fields over stored values without saving them", async () => {
    const file = tempFile();
    saveIntegrationKeys("linkedin", { accessToken: "stored-secret", authorUrn: "urn:li:person:ada" }, file);
    const stored = readFileSync(file, "utf8");
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: "Ada Lovelace" }));
    const base = await serve(file, ["admin"], { fetch: request });
    const before = Date.now();
    const response = await fetch(`${base}/api/integrations/linkedin/check`, {
      method: "POST", body: JSON.stringify({ fields: { authorUrn: "   ", accessToken: "  draft-secret  " } }),
    });
    expect(response.status).toBe(200);
    const { check } = await response.json() as { check: IntegrationCheck };
    expect(check).toEqual({ ok: true, account: "Ada Lovelace", detail: "LinkedIn accepted the key", checkedAt: expect.any(Number) });
    expect(check.checkedAt).toBeGreaterThanOrEqual(before);
    expect(check.checkedAt).toBeLessThanOrEqual(Date.now());
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://api.linkedin.com/v2/userinfo");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer draft-secret");
    expect(readFileSync(file, "utf8")).toBe(stored);
  });

  it("checks a complete stored key without draft fields and returns rejections as checks", async () => {
    const file = tempFile();
    saveIntegrationKeys("openai", { apiKey: "stored-secret" }, file);
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "Invalid stored-secret" } }, { status: 401 }));
    const base = await serve(file, ["admin"], { fetch: request });
    const response = await fetch(`${base}/api/integrations/openai/check`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ check: { ok: false, detail: "OpenAI rejected the key: Invalid [...]", checkedAt: expect.any(Number) } });
    expect(new Headers(request.mock.calls[0]![1]?.headers).get("Authorization")).toBe("Bearer stored-secret");
  });

  it("completes an incomplete own key from the draft", async () => {
    const file = tempFile();
    saveIntegrationKeys("resend", { senderEmail: "ada@example.test" }, file);
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    const base = await serve(file, ["admin"], { fetch: request });
    const response = await fetch(`${base}/api/integrations/resend/check`, { method: "POST", body: JSON.stringify({ fields: { apiKey: "draft-secret" } }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ check: { ok: true, detail: "Resend accepted the key" } });
    expect(new Headers(request.mock.calls[0]![1]?.headers).get("Authorization")).toBe("Bearer draft-secret");
    expect(integrationConfigured("resend", file)).toBe(false);
  });

  it("checks shared values only without a complete own key or draft fields", async () => {
    const file = defaultIntegrationKeysFile();
    mkdirSync(dirname(file), { recursive: true });
    const cache = createSharedKeys({
      cloud: () => ({ url: "http://convex.test", sessionToken: "fixture-session", projects: {} }),
      resolve: async () => [{ integration: "resend", teamId: "team1", projectId: null, projectName: null, sharedByName: "Ada",
        values: { apiKey: "shared-secret", senderEmail: "shared@example.test" }, updatedAt: 1 }],
    });
    await cache.current();
    const shared = vi.spyOn(sharedIntegrationKeys, "sharedKeys").mockReturnValue(cache);
    try {
      saveIntegrationKeys("resend", { senderEmail: "own@example.test" }, file);
      const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] }));
      const base = await serve(file, ["admin"], { fetch: request });
      const response = await fetch(`${base}/api/integrations/resend/check`, { method: "POST", body: "{}" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ check: { ok: true } });
      expect(new Headers(request.mock.calls[0]![1]?.headers).get("Authorization")).toBe("Bearer shared-secret");
      saveIntegrationKeys("resend", null, file);
      const draft = await fetch(`${base}/api/integrations/resend/check`, {
        method: "POST", body: JSON.stringify({ fields: { apiKey: "draft-secret" } }),
      });
      expect(await draft.json()).toMatchObject({ check: { ok: false, detail: "Fill in Sender email first" } });
      expect(request).toHaveBeenCalledTimes(1);
      saveIntegrationKeys("resend", { apiKey: "own-secret", senderEmail: "own@example.test" }, file);
      const own = await fetch(`${base}/api/integrations/resend/check`, { method: "POST", body: "{}" });
      expect(await own.json()).toMatchObject({ check: { ok: true } });
      expect(new Headers(request.mock.calls[1]![1]?.headers).get("Authorization")).toBe("Bearer own-secret");
    } finally { shared.mockRestore(); cache.close(); }
  });

  it("checks the key shared with the workspace or project the request names", async () => {
    const file = defaultIntegrationKeysFile();
    mkdirSync(dirname(file), { recursive: true });
    saveIntegrationKeys("resend", null, file);
    const share = (teamId: string, projectId: string | null, apiKey: string) => ({ integration: "resend", teamId, projectId, projectName: projectId, sharedByName: "Ada",
      values: { apiKey, senderEmail: "shared@example.test" }, updatedAt: 1 });
    const cache = createSharedKeys({
      cloud: () => ({ url: "http://convex.test", sessionToken: "fixture-session", projects: {} }),
      resolve: async () => [share("team1", null, "team1-secret"), share("team2", null, "team2-secret"), share("team1", "p1", "p1-secret")],
    });
    await cache.current();
    const shared = vi.spyOn(sharedIntegrationKeys, "sharedKeys").mockReturnValue(cache);
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] }));
      const base = await serve(file, ["admin"], { fetch: request });
      const used = async (query: string) => {
        request.mockClear();
        await fetch(`${base}/api/integrations/resend/check${query}`, { method: "POST", body: "{}" });
        return request.mock.calls[0] ? new Headers(request.mock.calls[0][1]?.headers).get("Authorization") : null;
      };
      expect(await used("")).toBeNull();
      expect(await used("?teamId=team2")).toBe("Bearer team2-secret");
      expect(await used("?teamId=team1&projectId=p1")).toBe("Bearer p1-secret");
      expect(await used("?teamId=team1&projectId=p2")).toBe("Bearer team1-secret");
    } finally { shared.mockRestore(); cache.close(); }
  });

  it.each([
    null, [], { fields: null }, { fields: [] }, { fields: "secret" }, { fields: { unknown: "secret" } },
    { fields: { key: 42 } }, { fields: { key: "line\nbreak" } }, { fields: { key: "a".repeat(4097) } },
  ])("rejects invalid draft fields: %j", async (body) => {
    const request = vi.fn<typeof fetch>();
    const base = await serve(tempFile(), ["admin"], { fetch: request });
    const response = await fetch(`${base}/api/integrations/fal/check`, { method: "POST", body: JSON.stringify(body) });
    expect(response.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns missing fields as a check without calling the provider", async () => {
    const request = vi.fn<typeof fetch>();
    const base = await serve(tempFile(), ["admin"], { fetch: request });
    const response = await fetch(`${base}/api/integrations/fal/check`, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ check: { ok: false, detail: "Fill in API key first", checkedAt: expect.any(Number) } });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects unknown integrations", async () => {
    const request = vi.fn<typeof fetch>();
    const base = await serve(tempFile(), ["admin"], { fetch: request });
    expect((await fetch(`${base}/api/integrations/unknown/check`, { method: "POST", body: "{}" })).status).toBe(404);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("keys shared with a workspace or one project", () => {
  const shared = (keys: SharedKey[]) => createSharedKeys({ cloud: () => ({ url: "http://convex.test", sessionToken: "s".repeat(64), projects: {} }), resolve: async () => keys });
  const fal = (projectId: string | null, secret: string): SharedKey => ({
    integration: "fal", teamId: "team1", projectId, projectName: projectId ? "Launch" : null, sharedByName: "Ada", values: { key: secret }, updatedAt: 1,
  });

  it("uses a project's key only for that project and names every share of the workspace", async () => {
    const cache = shared([fal("p1", "project-fal-secret")]);
    try {
      await cache.current();
      const file = tempFile();
      const status = (scope: { teamId?: string; projectId?: string }) => integrationStatuses(file, scope, cache).find((entry) => entry.id === "fal")!;
      expect(status({ teamId: "team1", projectId: "p1" })).toMatchObject({ configured: true, source: "shared", shared: { by: "Ada", projectId: "p1", projectName: "Launch" } });
      expect(status({ teamId: "team1", projectId: "p2" })).toMatchObject({ configured: false, source: null, shared: null });
      expect(status({ teamId: "team1" })).toMatchObject({ configured: false, shared: null, shares: [{ by: "Ada", projectId: "p1", projectName: "Launch" }] });
      expect(status({ teamId: "team2" }).shares).toEqual([]);
      expect(JSON.stringify(integrationStatuses(file, { teamId: "team1", projectId: "p1" }, cache))).not.toContain("project-fal-secret");
    } finally { cache.close(); }
  });

  it("prefers the project's key over the workspace's, and a member's own over both", async () => {
    const cache = shared([fal(null, "workspace-fal-secret"), fal("p1", "project-fal-secret")]);
    try {
      await cache.current();
      const file = tempFile();
      expect(integrationStatuses(file, { teamId: "team1", projectId: "p1" }, cache).find((entry) => entry.id === "fal")!.shared).toMatchObject({ projectId: "p1" });
      expect(integrationStatuses(file, { teamId: "team1", projectId: "p2" }, cache).find((entry) => entry.id === "fal")!.shared).toMatchObject({ projectId: null });
      saveIntegrationKeys("fal", { key: "my-own-fal" }, file);
      expect(integrationStatuses(file, { teamId: "team1", projectId: "p1" }, cache).find((entry) => entry.id === "fal")!.source).toBe("yours");
    } finally { cache.close(); }
  });
});
