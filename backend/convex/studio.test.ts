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

  test("a finished output lands in Assets under Studio at once and can be picked for Broadcast", async () => {
    const f = await fixture();
    const generationId = await f.create(f.owner);
    await f.t.mutation(api.studio.update, { sessionToken: f.owner, projectId: f.projectId, generationId, status: "done", outputs: [OUTPUT] });
    const done = await f.t.query(api.studio.get, { sessionToken: f.owner, projectId: f.projectId, generationId });
    const assetId = done.saved[0]!.assetId;
    expect(await f.t.mutation(api.studio.saveAsset, { sessionToken: f.owner, projectId: f.projectId, generationId, index: 0, name: "again.png" })).toBe(assetId);
    const design = await f.t.query(api.design.list, { sessionToken: f.owner, projectId: f.projectId });
    expect(design.assets).toEqual([expect.objectContaining({
      _id: assetId, type: "image", name: "launch poster.png", url: OUTPUT.url, contentType: "image/png", folder: "Studio",
      studio: { generationId, model: "fal-ai/nano-banana-pro", modelLabel: "Nano Banana Pro", prompt: "launch poster" },
    })]);
    await f.t.mutation(api.studio.useInBroadcast, { sessionToken: f.member, projectId: f.projectId, generationId, index: 0, picked: true });
    expect(await f.t.query(api.studio.forBroadcast, { sessionToken: f.owner, projectId: f.projectId })).toEqual([
      expect.objectContaining({ generationId, assetId, kind: "image", prompt: "launch poster", url: OUTPUT.url }),
    ]);
    await f.t.mutation(api.studio.useInBroadcast, { sessionToken: f.member, projectId: f.projectId, generationId, index: 0, picked: false });
    expect(await f.t.query(api.studio.forBroadcast, { sessionToken: f.owner, projectId: f.projectId })).toEqual([]);
  });

  test("the app swaps an output's link for its uploaded copy", async () => {
    const f = await fixture();
    const generationId = await f.create(f.owner);
    await f.t.mutation(api.studio.update, { sessionToken: f.owner, projectId: f.projectId, generationId, status: "done", outputs: [{ ...OUTPUT, contentType: undefined }] });
    const storageId = await f.t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }));
      await ctx.db.insert("storageAdmissions", { storageId: id, scopeKey: `project:${f.projectId}`, scope: { kind: "project", projectId: f.projectId }, createdAt: 1 });
      return id;
    });
    const assetId = await f.t.mutation(api.studio.storeFile, { sessionToken: f.owner, projectId: f.projectId, generationId, index: 0, storageId, contentType: "image/webp", size: 3 });
    const asset = await f.t.run((ctx) => ctx.db.get(assetId!));
    expect(asset).toMatchObject({ storageId, contentType: "image/webp", size: 3, name: "launch poster.webp", folder: "Studio" });
    expect(asset!.url).toBeUndefined();
  });

  test("a workflow step stays out of the canvas and Assets until an Output saves it", async () => {
    const f = await fixture();
    const runId = await f.t.mutation(api.studioWorkflows.startRun, { sessionToken: f.owner, projectId: f.projectId, name: "Reel", graph: { nodes: [{ id: "m1", type: "model", x: 0, y: 0, params: { model: "fal-ai/flux/schnell" } }], edges: [] } });
    const generationId = await f.create(f.owner, { intermediate: true, workflowRunId: runId, nodeId: "m1" });
    await f.t.mutation(api.studio.update, { sessionToken: f.owner, projectId: f.projectId, generationId, status: "done", outputs: [OUTPUT] });
    expect(await f.t.query(api.studio.list, { sessionToken: f.owner, projectId: f.projectId })).toEqual([]);
    expect((await f.t.query(api.design.list, { sessionToken: f.owner, projectId: f.projectId })).assets).toEqual([]);
    await f.t.mutation(api.studio.saveAsset, { sessionToken: f.owner, projectId: f.projectId, generationId, index: 0, name: "Reel.png" });
    expect((await f.t.query(api.design.list, { sessionToken: f.owner, projectId: f.projectId })).assets).toEqual([expect.objectContaining({ name: "Reel.png", folder: "Studio" })]);
  });

  test("a cancelled generation stays cancelled", async () => {
    const f = await fixture();
    const generationId = await f.create(f.member);
    await f.t.mutation(api.studio.update, { sessionToken: f.member, projectId: f.projectId, generationId, status: "cancelled" });
    await f.t.mutation(api.studio.update, { sessionToken: f.member, projectId: f.projectId, generationId, status: "done", outputs: [OUTPUT] });
    const row = await f.t.query(api.studio.get, { sessionToken: f.owner, projectId: f.projectId, generationId });
    expect(row).toMatchObject({ status: "cancelled", outputs: [] });
    expect(row.finishedAt).toBeTypeOf("number");
  });

  test("video and audio outputs land as assets of their own kind", async () => {
    const f = await fixture();
    for (const kind of ["video", "audio"] as const) {
      const generationId = await f.create(f.owner, { mode: kind, kind });
      await f.t.mutation(api.studio.update, { sessionToken: f.owner, projectId: f.projectId, generationId, status: "done", outputs: [{ url: `https://v3.fal.media/files/out.${kind}`, kind }] });
    }
    const design = await f.t.query(api.design.list, { sessionToken: f.owner, projectId: f.projectId });
    expect(design.assets.map((asset: { type: string }) => asset.type).sort()).toEqual(["audio", "video"]);
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

describe("Studio library", () => {
  test("editors save characters from project images; every member lists them with live links", async () => {
    const f = await fixture();
    const image = await f.t.run((ctx) => ctx.db.insert("designAssets", { projectId: f.projectId, type: "image", name: "Mia.png", url: "https://cdn.test/mia.png", createdAt: 1, updatedAt: 1 }));
    const pdf = await f.t.run((ctx) => ctx.db.insert("designAssets", { projectId: f.projectId, type: "document", name: "Brief.pdf", url: "https://cdn.test/brief.pdf", createdAt: 1, updatedAt: 1 }));
    const save = (sessionToken: string, extra: Record<string, unknown> = {}) => f.t.mutation(api.studioLibrary.save, {
      sessionToken, projectId: f.projectId, name: "  Mia  ", kind: "character", description: "Red bob haircut, green bomber jacket", referenceAssetIds: [image], ...extra,
    });
    await expect(save(f.outsider)).rejects.toThrow();
    await expect(save(f.member, { referenceAssetIds: [] })).rejects.toThrow(/at least one reference/);
    await expect(save(f.member, { referenceAssetIds: [pdf] })).rejects.toThrow(/not an image/);
    const characterId = await save(f.member, { agentName: "Designer" });
    await save(f.owner, { characterId, name: "Mia v2" });
    expect(await f.t.query(api.studioLibrary.list, { sessionToken: f.member, projectId: f.projectId })).toEqual([expect.objectContaining({
      _id: characterId, name: "Mia v2", kind: "character", createdByName: "member", references: [{ assetId: image, url: "https://cdn.test/mia.png" }],
    })]);
    await f.t.mutation(api.studioLibrary.remove, { sessionToken: f.member, projectId: f.projectId, characterId });
    expect(await f.t.query(api.studioLibrary.list, { sessionToken: f.member, projectId: f.projectId })).toEqual([]);
  });
});

describe("Large Studio outputs", () => {
  async function uploaded(f: Awaited<ReturnType<typeof fixture>>, email: string, parts: string[], projectId = f.projectId) {
    return f.t.run(async (ctx) => {
      const user = (await ctx.db.query("users").collect()).find((row) => row.email === email)!;
      const session = (await ctx.db.query("sessions").collect()).find((row) => row.userId === user._id)!;
      const ids = [];
      for (const [index, part] of parts.entries()) {
        const storageId = await ctx.storage.store(new Blob([part], { type: "video/mp4" }));
        await ctx.db.insert("storageUploadIntents", { tokenHash: `hash-${email}-${index}-${part.length}`, sessionId: session._id, userId: user._id, target: { kind: "asset", projectId }, state: "complete", expiresAt: Date.now() + 60_000, storageId });
        await ctx.db.insert("storageAdmissions", { storageId, scopeKey: `project:${projectId}`, scope: { kind: "project", projectId }, contentType: "video/mp4", createdAt: 1 });
        ids.push(storageId);
      }
      return ids;
    });
  }

  test("pieces the member just uploaded join into one project file and the pieces go away", async () => {
    const f = await fixture();
    const chunks = await uploaded(f, "owner@studio.test", ["abc", "defg", "hi"]);
    const storageId = await f.t.action(api.studioUpload.assemble, { sessionToken: f.owner, projectId: f.projectId, chunks, contentType: "video/mp4" });
    const joined = await f.t.run(async (ctx) => ({
      text: await (await ctx.storage.get(storageId))!.text(),
      admitted: await ctx.db.query("storageAdmissions").withIndex("by_storageId_and_scopeKey", (q) => q.eq("storageId", storageId)).collect(),
      pieces: await Promise.all(chunks.map((chunk) => ctx.storage.get(chunk))),
      intents: await ctx.db.query("storageUploadIntents").collect(),
    }));
    expect(joined.text).toBe("abcdefghi");
    expect(joined.admitted).toEqual([expect.objectContaining({ scopeKey: `project:${f.projectId}` })]);
    expect(joined.pieces).toEqual([null, null, null]);
    expect(joined.intents).toEqual([]);
    const generationId = await f.create(f.owner, { mode: "video", kind: "video" });
    await f.t.mutation(api.studio.update, { sessionToken: f.owner, projectId: f.projectId, generationId, status: "done", outputs: [{ url: "https://v3.fal.media/files/reel.mp4", kind: "video" }] });
    expect(await f.t.mutation(api.studio.storeFile, { sessionToken: f.owner, projectId: f.projectId, generationId, index: 0, storageId, contentType: "video/mp4" })).toBeTruthy();
  });

  test("assembling never touches another member's upload or an existing file", async () => {
    const f = await fixture();
    const theirs = await uploaded(f, "member@studio.test", ["one", "two"]);
    await expect(f.t.action(api.studioUpload.assemble, { sessionToken: f.owner, projectId: f.projectId, chunks: theirs, contentType: "video/mp4" })).rejects.toThrow(/expired/);
    const mine = await uploaded(f, "owner@studio.test", ["three", "four"]);
    await f.t.run((ctx) => ctx.db.insert("designAssets", { projectId: f.projectId, type: "video", name: "kept.mp4", storageId: mine[0], createdAt: 1, updatedAt: 1 }));
    await expect(f.t.action(api.studioUpload.assemble, { sessionToken: f.owner, projectId: f.projectId, chunks: mine, contentType: "video/mp4" })).rejects.toThrow(/already a file/);
    await expect(f.t.action(api.studioUpload.assemble, { sessionToken: f.outsider, projectId: f.projectId, chunks: mine, contentType: "video/mp4" })).rejects.toThrow();
    expect(await f.t.run(async (ctx) => (await Promise.all([...theirs, ...mine].map((chunk) => ctx.storage.get(chunk)))).every(Boolean))).toBe(true);
  });
});
