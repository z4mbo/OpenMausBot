import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { createIntegrationKeyRoutes, integrationConfigured, integrationKey, integrationStatuses, saveIntegrationKeys } from "./integration-keys.ts";
import type { RequestAuth } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";

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
    expect(integrationKey("twilio", file)).toBeNull();
    expect(saveIntegrationKeys("twilio", { accountSid: "AC123", authToken: "tok" }, file)).toEqual({ ok: true });
    expect(integrationConfigured("twilio", file)).toBe(false);
    saveIntegrationKeys("twilio", { fromNumber: "+15550001111" }, file);
    expect(integrationKey("twilio", file)).toEqual({ accountSid: "AC123", authToken: "tok", fromNumber: "+15550001111" });
    saveIntegrationKeys("brevo", { apiKey: "xkeysib-1", senderEmail: "a@b.co" }, file);
    expect(integrationKey("brevo", file)).toEqual({ apiKey: "xkeysib-1", senderEmail: "a@b.co" });
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

async function serve(file: string, scopes: string[]) {
  const route = createIntegrationKeyRoutes(() => file);
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
