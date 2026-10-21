import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { redactSecretsInText } from "../shared/redact.ts";
import type { OriginCloudClient } from "./origin-cloud.ts";
import { createVaultAgentSecrets, VAULT_AGENT_ROUTE } from "./origin-vault-agent.ts";
import type { RouteContext } from "./routes/table.ts";

const SESSION = "s".repeat(64);
const VALUE = "sk_test_vault_value_123";

function harness(initialRole = "member") {
  const roles = { current: initialRole };
  const items = [
    { _id: "c1", title: "Stripe test", kind: "api_key", agentUse: true, ciphertext: "CIPHER" },
    { _id: "c2", title: "Admin login", kind: "password", ciphertext: "CIPHER" },
  ];
  const client = {
    query: async (name: string) => (name === "projects:get" ? { memberRole: roles.current } : items),
    mutation: async () => null,
  } as OriginCloudClient;
  const vault = createVaultAgentSecrets({ cloud: () => ({ url: "http://convex.test", sessionToken: SESSION, projects: {} }), connect: () => client });
  const call = async (method: string, query: string, body?: unknown) => {
    let status = 0;
    let payload: unknown;
    const ctx = {
      req: {} as IncomingMessage, res: {} as ServerResponse, url: new URL(`http://127.0.0.1${VAULT_AGENT_ROUTE}${query}`), path: VAULT_AGENT_ROUTE, method,
      auth: { scopes: ["admin"] }, json: (_res: ServerResponse, code: number, value: unknown) => { status = code; payload = value; }, readBody: async () => body,
    } as unknown as RouteContext;
    await vault.routes(ctx);
    return { status, payload };
  };
  const list = async () => (await vault.tools(async () => ({ client, sessionToken: SESSION, projectId: "p1" })).origin_vault_list({}, {})).text;
  return { vault, call, list, roles };
}

describe("vault items agents may use", () => {
  it("holds only items marked for agents, shows their value to the project's agents and masks it everywhere else", async () => {
    const { vault, call, list } = harness();
    try {
      expect((await call("PUT", "", { projectId: "p1", credentialId: "c2", value: "hunter2-password" })).status).toBe(409);
      expect((await call("PUT", "", { projectId: "p1", credentialId: "c1", value: VALUE })).status).toBe(200);
      const text = await list();
      expect(text).toContain(`value: ${VALUE}`);
      expect(text).not.toContain("CIPHER");
      expect(text).not.toContain("hunter2");
      expect(redactSecretsInText(`export STRIPE_KEY=${VALUE}`)).not.toContain(VALUE);
      expect((await call("DELETE", "?projectId=p1")).status).toBe(200);
      expect(await list()).toContain("agents may use it once a member unlocks the vault");
    } finally { vault.close(); }
  });

  it("hides values from a sign-in that lost edit access and refuses secrets too short to mask", async () => {
    const { vault, call, list, roles } = harness();
    try {
      expect((await call("PUT", "", { projectId: "p1", credentialId: "c1", value: "1234" })).status).toBe(400);
      expect((await call("PUT", "", { projectId: "p1", credentialId: "c1", value: VALUE })).status).toBe(200);
      roles.current = "viewer";
      expect(await list()).not.toContain(VALUE);
    } finally { vault.close(); }
  });

  it("refuses a viewer's server", async () => {
    const { vault, call } = harness("viewer");
    try {
      expect((await call("PUT", "", { projectId: "p1", credentialId: "c1", value: VALUE })).status).toBe(403);
    } finally { vault.close(); }
  });
});
