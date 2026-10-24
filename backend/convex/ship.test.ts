/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("owner@test.dev");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner.token, name: "Ship" });
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner.token, teamId, name: "Launch", repoUrl: "https://github.com/acme/launch" });
  const member = async (email: string, role: "member" | "viewer") => {
    const person = await user(email);
    await t.run(async (ctx) => {
      await ctx.db.insert("teamMembers", { teamId, userId: person.userId, email, name: email, role, status: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("members", { projectId, userId: person.userId, email, name: email, role, status: "active", createdAt: 1, updatedAt: 1 });
    });
    return person.token;
  };
  return { t, owner: owner.token, projectId, member };
}

const target = { provider: "vercel" as const, name: "Production", ref: "prj_123", branch: "main" };

describe("ship", () => {
  test("an admin adds targets; a member cannot, and Cloudflare needs its account", async () => {
    const f = await fixture();
    const writer = await f.member("writer@test.dev", "member");
    const targetId = await f.t.mutation(api.ship.saveTarget, { sessionToken: f.owner, projectId: f.projectId, ...target, siteUrl: "https://launch.test/" });
    await expect(f.t.mutation(api.ship.saveTarget, { sessionToken: writer, projectId: f.projectId, ...target })).rejects.toThrow("Admin role required");
    await expect(f.t.mutation(api.ship.saveTarget, { sessionToken: f.owner, projectId: f.projectId, ...target, provider: "cloudflare" })).rejects.toThrow("account ID");
    await expect(f.t.mutation(api.ship.saveTarget, { sessionToken: f.owner, projectId: f.projectId, ...target, siteUrl: "http://plain.test" })).rejects.toThrow("https://");
    const overview = await f.t.query(api.ship.overview, { sessionToken: writer, projectId: f.projectId });
    expect(overview).toMatchObject({ canEdit: true, isAdmin: false, repoUrl: "https://github.com/acme/launch" });
    expect(overview.targets).toEqual([expect.objectContaining({ _id: targetId, provider: "vercel", siteUrl: "https://launch.test" })]);
  });

  test("a release draft is edited, refuses a duplicate tag and publishes once", async () => {
    const f = await fixture();
    const writer = await f.member("writer@test.dev", "member");
    const viewer = await f.member("viewer@test.dev", "viewer");
    const targetId = await f.t.mutation(api.ship.saveTarget, { sessionToken: f.owner, projectId: f.projectId, ...target });
    const pulls = [{ number: 4, title: "feat: dark mode", url: "https://github.com/acme/launch/pull/4", mergedAt: 1, labels: [] }];
    const releaseId = await f.t.mutation(api.ship.saveRelease, {
      sessionToken: writer, projectId: f.projectId, tag: "v1.1.0", notes: "Dark mode.", pulls, baseTag: "v1.0.0", targetId, agent: { botId: "chief", name: "Atlas" },
    });
    await expect(f.t.mutation(api.ship.saveRelease, { sessionToken: viewer, projectId: f.projectId, tag: "v9", notes: "" })).rejects.toThrow("Edit role required");
    await expect(f.t.mutation(api.ship.saveRelease, { sessionToken: writer, projectId: f.projectId, tag: "v1.1.0", notes: "" })).rejects.toThrow("already a release");
    await expect(f.t.mutation(api.ship.saveRelease, { sessionToken: writer, projectId: f.projectId, tag: "bad tag", notes: "" })).rejects.toThrow("Give the tag");
    await f.t.mutation(api.ship.saveRelease, { sessionToken: writer, projectId: f.projectId, releaseId, tag: "v1.1.0", title: "Night shift", notes: "Dark mode everywhere." });

    await expect(f.t.mutation(api.ship.beginPublish, { sessionToken: writer, projectId: f.projectId, releaseId })).rejects.toThrow("Admin role required");
    const plan = await f.t.mutation(api.ship.beginPublish, { sessionToken: f.owner, projectId: f.projectId, releaseId });
    expect(plan).toMatchObject({ tag: "v1.1.0", title: "Night shift", notes: "Dark mode everywhere.", targetId, agentName: "Atlas", repoUrl: "https://github.com/acme/launch" });
    await expect(f.t.mutation(api.ship.beginPublish, { sessionToken: f.owner, projectId: f.projectId, releaseId })).rejects.toThrow("already publishing");
    await expect(f.t.mutation(api.ship.saveRelease, { sessionToken: writer, projectId: f.projectId, releaseId, tag: "v1.1.0", notes: "x" })).rejects.toThrow("already publishing");

    await f.t.mutation(api.ship.finishPublish, { sessionToken: f.owner, projectId: f.projectId, releaseId, releaseUrl: "https://github.com/acme/launch/releases/tag/v1.1.0", deployNote: "Deploying Production" });
    const { releases } = await f.t.query(api.ship.overview, { sessionToken: f.owner, projectId: f.projectId });
    expect(releases[0]).toMatchObject({ status: "published", approvedByName: "owner", releaseUrl: "https://github.com/acme/launch/releases/tag/v1.1.0", deployNote: "Deploying Production" });
    await expect(f.t.mutation(api.ship.removeRelease, { sessionToken: writer, projectId: f.projectId, releaseId })).rejects.toThrow("stays in the history");
  });

  test("a failed publish returns to editable, and removing a target unlinks drafts", async () => {
    const f = await fixture();
    const targetId = await f.t.mutation(api.ship.saveTarget, { sessionToken: f.owner, projectId: f.projectId, ...target });
    const releaseId = await f.t.mutation(api.ship.saveRelease, { sessionToken: f.owner, projectId: f.projectId, tag: "v2.0.0", notes: "Big", targetId });
    await f.t.mutation(api.ship.beginPublish, { sessionToken: f.owner, projectId: f.projectId, releaseId });
    await f.t.mutation(api.ship.finishPublish, { sessionToken: f.owner, projectId: f.projectId, releaseId, error: "GitHub rejected this request" });
    let { releases } = await f.t.query(api.ship.overview, { sessionToken: f.owner, projectId: f.projectId });
    expect(releases[0]).toMatchObject({ status: "failed", error: "GitHub rejected this request", targetId });
    await f.t.mutation(api.ship.removeTarget, { sessionToken: f.owner, projectId: f.projectId, targetId });
    ({ releases } = await f.t.query(api.ship.overview, { sessionToken: f.owner, projectId: f.projectId }));
    expect(releases[0].targetId).toBeUndefined();
    await f.t.mutation(api.ship.removeRelease, { sessionToken: f.owner, projectId: f.projectId, releaseId });
    expect((await f.t.query(api.ship.overview, { sessionToken: f.owner, projectId: f.projectId })).releases).toEqual([]);
  });
});
