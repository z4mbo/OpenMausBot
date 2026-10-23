/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const sealed = { ciphertext: "ciphertext", iv: "iv", salt: "salt", iterations: 210000, kdf: "PBKDF2-SHA256/AES-256-GCM" };

async function people() {
  const t = convexTest(schema, modules);
  const [ada, bob] = await t.run(async (ctx) => {
    const tokens = [];
    for (const name of ["ada", "bob"]) {
      const id = await ctx.db.insert("users", { name, email: `${name}@vault.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
      tokens.push(await createSession(ctx, id));
    }
    return tokens;
  });
  return { t, ada: ada!, bob: bob! };
}

describe("personal vault", () => {
  test("lists, changes and deletes only its owner's items", async () => {
    const { t, ada, bob } = await people();
    const credentialId = await t.mutation(api.personalCredentials.create, { sessionToken: ada, kind: "service", service: "vercel", title: "Vercel", ...sealed });
    expect((await t.query(api.personalCredentials.list, { sessionToken: ada })).map((row) => row.title)).toEqual(["Vercel"]);
    expect(await t.query(api.personalCredentials.list, { sessionToken: bob })).toEqual([]);
    for (const attempt of [
      () => t.mutation(api.personalCredentials.update, { sessionToken: bob, credentialId, title: "Mine now" }),
      () => t.mutation(api.personalCredentials.setAgentUse, { sessionToken: bob, credentialId, agentUse: true }),
      () => t.mutation(api.personalCredentials.remove, { sessionToken: bob, credentialId }),
    ]) await expect(attempt()).rejects.toThrow("Credential not found");
    await t.mutation(api.personalCredentials.setAgentUse, { sessionToken: ada, credentialId, agentUse: true });
    expect((await t.query(api.personalCredentials.list, { sessionToken: ada }))[0]?.agentUse).toBe(true);
    await t.mutation(api.personalCredentials.remove, { sessionToken: ada, credentialId });
    expect(await t.query(api.personalCredentials.list, { sessionToken: ada })).toEqual([]);
  });

  test("a service sign-in names a known service, and other kinds carry none", async () => {
    const { t, ada } = await people();
    await expect(t.mutation(api.personalCredentials.create, { sessionToken: ada, kind: "service", service: "nowhere", title: "?", ...sealed })).rejects.toThrow("Choose the service");
    const id = await t.mutation(api.personalCredentials.create, { sessionToken: ada, kind: "api_key", service: "vercel", title: "Key", ...sealed });
    expect((await t.query(api.personalCredentials.list, { sessionToken: ada })).find((row) => row._id === id)?.service).toBeUndefined();
    await expect(t.mutation(api.personalCredentials.update, { sessionToken: ada, credentialId: id, ciphertext: "partial" })).rejects.toThrow("whole encrypted value");
  });
});
