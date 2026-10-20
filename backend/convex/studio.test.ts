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
    const userId = await ctx.db.insert("users", { name: email.split("@")[0]!, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const owner = await user("owner@studio.test");
  const member = await user("member@studio.test");
  const outsider = await user("outsider@studio.test");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner, name: "Studio" });
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner, teamId, name: "Launch" });
  const invite = await t.mutation(api.workspaces.createInvite, { sessionToken: owner, teamId, role: "member", email: "member@studio.test" });
  await t.mutation(api.workspaces.acceptInvite, { sessionToken: member, token: invite.token });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: owner, projectId, email: "member@studio.test", role: "member" });
  const create = (sessionToken: string, extra: Record<string, unknown> = {}) => t.mutation(api.studio.create, {
    sessionToken, projectId, mode: "image", model: "fal-ai/nano-banana-pro", modelLabel: "Nano Banana Pro", kind: "image", prompt: "launch poster", aspectRatio: "16:9", ...extra,
  });
  return { t, owner, member, outsider, projectId, create };
}

const OUTPUT = { url: "https://v3.fal.media/files/poster.png", kind: "image" as const, contentType: "image/png" };

describe("Studio generations", () => {
  test("the team sees a generation and only its creator records progress", async () => {
    const f = await fixture();
    const generationId = await f.create(f.member, { agentName: "Designer" });
    await expect(f.create(f.outsider)).rejects.toThrow();
    const rows = await f.t.query(api.studio.list, { sessionToken: f.owner, projectId: f.projectId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "queued", createdByName: "member", agentName: "Designer", outputs: [] });
    await expect(f.t.mutation(api.studio.update, { sessionToken: f.owner, projectId: f.projectId, generationId, status: "done", outputs: [OUTPUT] })).rejects.toThrow(/Only the member/);
    await f.t.mutation(api.studio.update, { sessionToken: f.member, projectId: f.projectId, generationId, status: "running", falRequestId: "req1" });
    await expect(f.t.mutation(api.studio.update, { sessionToken: f.member, projectId: f.projectId, generationId, status: "done", outputs: [{ ...OUTPUT, url: "http://127.0.0.1/x" }] })).rejects.toThrow(/https/);
    await f.t.mutation(api.studio.update, { sessionToken: f.member, projectId: f.projectId, generationId, status: "done", outputs: [OUTPUT] });
    await f.t.mutation(api.studio.update, { sessionToken: f.member, projectId: f.projectId, generationId, status: "failed", error: "late" });
    const done = await f.t.query(api.studio.get, { sessionToken: f.owner, projectId: f.projectId, generationId });
    expect(done).toMatchObject({ status: "done", falRequestId: "req1", outputs: [OUTPUT] });
    expect(done.startedAt).toBeTypeOf("number");
    expect(done.error).toBeUndefined();
  });

  test("an output saved as an asset can be picked for Broadcast", async () => {
    const f = await fixture();
    const generationId = await f.create(f.owner);
    await f.t.mutation(api.studio.update, { sessionToken: f.owner, projectId: f.projectId, generationId, status: "done", outputs: [OUTPUT] });
    await expect(f.t.mutation(api.studio.useInBroadcast, { sessionToken: f.owner, projectId: f.projectId, generationId, index: 0, picked: true })).rejects.toThrow(/Save this output/);
    const assetId = await f.t.mutation(api.studio.saveAsset, { sessionToken: f.member, projectId: f.projectId, generationId, index: 0, name: "poster.png" });
    expect(await f.t.mutation(api.studio.saveAsset, { sessionToken: f.owner, projectId: f.projectId, generationId, index: 0, name: "again.png" })).toBe(assetId);
    const design = await f.t.query(api.design.list, { sessionToken: f.owner, projectId: f.projectId });
    expect(design.assets).toEqual([expect.objectContaining({ _id: assetId, type: "image", name: "poster.png", url: OUTPUT.url, contentType: "image/png" })]);
    await f.t.mutation(api.studio.useInBroadcast, { sessionToken: f.member, projectId: f.projectId, generationId, index: 0, picked: true });
    expect(await f.t.query(api.studio.forBroadcast, { sessionToken: f.owner, projectId: f.projectId })).toEqual([
      expect.objectContaining({ generationId, assetId, kind: "image", prompt: "launch poster", url: OUTPUT.url }),
    ]);
    await f.t.mutation(api.studio.useInBroadcast, { sessionToken: f.member, projectId: f.projectId, generationId, index: 0, picked: false });
    expect(await f.t.query(api.studio.forBroadcast, { sessionToken: f.owner, projectId: f.projectId })).toEqual([]);
  });

  test("only the creator or a project admin deletes a generation", async () => {
    const f = await fixture();
    const generationId = await f.create(f.owner);
    await expect(f.t.mutation(api.studio.remove, { sessionToken: f.member, projectId: f.projectId, generationId })).rejects.toThrow(/creator or a project admin/);
    const own = await f.create(f.member);
    await f.t.mutation(api.studio.remove, { sessionToken: f.member, projectId: f.projectId, generationId: own });
    await f.t.mutation(api.studio.remove, { sessionToken: f.owner, projectId: f.projectId, generationId });
    expect(await f.t.query(api.studio.list, { sessionToken: f.owner, projectId: f.projectId })).toEqual([]);
  });

  test("a source asset must belong to the project", async () => {
    const f = await fixture();
    const other = await f.t.mutation(api.projects.create, { sessionToken: f.outsider, teamId: (await f.t.mutation(api.workspaces.create, { sessionToken: f.outsider, name: "Other" })).teamId, name: "Other" });
    const foreign = await f.t.run((ctx) => ctx.db.insert("designAssets", { projectId: other, type: "image", name: "x", url: "https://cdn.test/x.png", createdAt: 1, updatedAt: 1 }));
    await expect(f.create(f.owner, { mode: "edit", sourceAssetId: foreign })).rejects.toThrow(/Source asset not found/);
  });
});
