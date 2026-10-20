/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const SEALING_KEY = "ab".repeat(32);

beforeEach(() => { vi.stubEnv("ORIGIN_SEALING_KEY", SEALING_KEY); });
afterEach(() => { vi.unstubAllEnvs(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const person = (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await person("owner@test.dev");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner.token, name: "Acme" });
  const join = async (email: string, role: "member" | "viewer") => {
    const user = await person(email);
    await t.run((ctx) => ctx.db.insert("teamMembers", { teamId, userId: user.userId, email, name: email, role, status: "active", createdAt: 1, updatedAt: 1 }));
    return user;
  };
  const member = await join("member@test.dev", "member");
  const viewer = await join("viewer@test.dev", "viewer");
  const outsider = await person("outsider@test.dev");
  return { t, teamId, owner, member, viewer, outsider };
}

const fal = { integration: "fal", values: { key: "fal-key-id:fal-secret" }, visible: {} };

describe("integration keys shared with a workspace", () => {
  test("an admin shares a key once and every editor's server can use it, sealed at rest", async () => {
    const f = await fixture();
    await expect(f.t.action(api.sharedKeys.share, { sessionToken: f.member.token, teamId: f.teamId, ...fal })).rejects.toThrow("owner or admin");
    await f.t.action(api.sharedKeys.share, { sessionToken: f.owner.token, teamId: f.teamId, ...fal });
    const stored = await f.t.run((ctx) => ctx.db.query("sharedKeys").first());
    expect(stored?.sealed).not.toContain("fal-secret");
    const resolved = await f.t.action(api.sharedKeys.resolve, { sessionToken: f.member.token });
    expect(resolved).toEqual([expect.objectContaining({ integration: "fal", values: { key: "fal-key-id:fal-secret" }, sharedByName: "owner", projectId: null })]);
    expect(await f.t.action(api.sharedKeys.resolve, { sessionToken: f.viewer.token })).toEqual([]);
    expect(await f.t.action(api.sharedKeys.resolve, { sessionToken: f.outsider.token })).toEqual([]);
    const listed = await f.t.query(api.sharedKeys.list, { sessionToken: f.viewer.token, teamId: f.teamId });
    expect(listed).toEqual([expect.objectContaining({ integration: "fal", sharedByName: "owner", visible: {} })]);
    expect(JSON.stringify(listed)).not.toContain("fal-secret");
  });

  test("a project key reaches only that project's editors, and unsharing removes it", async () => {
    const f = await fixture();
    const projectId = await f.t.mutation(api.projects.create, { sessionToken: f.owner.token, teamId: f.teamId, name: "Sales", githubRepo: "later" });
    const brevo = { integration: "brevo", values: { apiKey: "xkeysib-secret", senderEmail: "hi@acme.test" }, visible: { senderEmail: "hi@acme.test" } };
    await f.t.action(api.sharedKeys.share, { sessionToken: f.owner.token, teamId: f.teamId, projectId, ...brevo });
    expect(await f.t.action(api.sharedKeys.resolve, { sessionToken: f.member.token })).toEqual([]);
    await f.t.run((ctx) => ctx.db.insert("members", { projectId: projectId as Id<"projects">, userId: f.member.userId, email: "member@test.dev", name: "member", role: "member", status: "active", createdAt: 1, updatedAt: 1 }));
    expect((await f.t.action(api.sharedKeys.resolve, { sessionToken: f.member.token }))[0]).toMatchObject({ integration: "brevo", projectName: "Sales", values: brevo.values });
    await expect(f.t.mutation(api.sharedKeys.unshare, { sessionToken: f.member.token, teamId: f.teamId, projectId, integration: "brevo" })).rejects.toThrow("owner or admin");
    await f.t.mutation(api.sharedKeys.unshare, { sessionToken: f.owner.token, teamId: f.teamId, projectId, integration: "brevo" });
    expect(await f.t.action(api.sharedKeys.resolve, { sessionToken: f.member.token })).toEqual([]);
  });

  test("without a sealing key nothing is stored", async () => {
    const f = await fixture();
    vi.stubEnv("ORIGIN_SEALING_KEY", "");
    await expect(f.t.action(api.sharedKeys.share, { sessionToken: f.owner.token, teamId: f.teamId, ...fal })).rejects.toThrow("ORIGIN_SEALING_KEY");
    expect(await f.t.run((ctx) => ctx.db.query("sharedKeys").first())).toBeNull();
  });
});
