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
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("owner@templates.test");
  const outsider = await user("outsider@templates.test");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner.token, name: "Templates" });
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner.token, teamId, name: "Launch" });
  const asset = (name: string, type: "image" | "video") => t.run((ctx) => ctx.db.insert("designAssets", { projectId, type, name, url: `https://cdn.test/${name}`, createdAt: 1, updatedAt: 1 }));
  return { t, owner, outsider, projectId, asset };
}

describe("Studio templates", () => {
  test("a generation becomes a template with its cover, example inputs and settings", async () => {
    const f = await fixture();
    const character = await f.asset("dancer.png", "image");
    const motion = await f.asset("dance.mp4", "video");
    const cover = await f.asset("result.mp4", "video");
    const generationId = await f.t.run((ctx) => ctx.db.insert("studioGenerations", {
      projectId: f.projectId, mode: "video", model: "fal-ai/kling-video/v3/pro/motion-control", modelLabel: "Kling 3 Pro · motion transfer", kind: "video", prompt: "",
      status: "done", outputs: [{ url: "https://v3.fal.media/out.mp4", kind: "video" }], saved: [{ index: 0, assetId: cover }], broadcast: [],
      createdBy: f.owner.userId, createdByName: "owner", createdAt: 1, updatedAt: 1,
    }));
    const templateId = await f.t.mutation(api.studioTemplates.save, {
      sessionToken: f.owner.token, projectId: f.projectId, name: "  Dance  challenge ", mode: "video", model: "fal-ai/kling-video/v3/pro/motion-control",
      prompt: "[Who: a robot] dancing", params: { duration: "5", seed: 4, junk: "x" }, sourceAssetIds: [character, motion], generationId,
    });
    const [row] = await f.t.query(api.studioTemplates.list, { sessionToken: f.owner.token, projectId: f.projectId });
    expect(row).toMatchObject({
      _id: templateId, name: "Dance challenge", params: { duration: "5" }, cover: { url: "https://cdn.test/result.mp4", kind: "video" },
      sources: [{ assetId: character, kind: "image", name: "dancer.png" }, { assetId: motion, kind: "video", name: "dance.mp4" }],
    });
    await expect(f.t.query(api.studioTemplates.list, { sessionToken: f.outsider.token, projectId: f.projectId })).rejects.toThrow();
    await f.t.mutation(api.studioTemplates.remove, { sessionToken: f.owner.token, projectId: f.projectId, templateId });
    expect(await f.t.query(api.studioTemplates.list, { sessionToken: f.owner.token, projectId: f.projectId })).toEqual([]);
  });

  test("refuses unknown models and inputs of the wrong kind", async () => {
    const f = await fixture();
    const clip = await f.asset("clip.mp4", "video");
    const base = { sessionToken: f.owner.token, projectId: f.projectId, name: "x", prompt: "", params: {} };
    await expect(f.t.mutation(api.studioTemplates.save, { ...base, mode: "image", model: "nope/model", sourceAssetIds: [] })).rejects.toThrow(/Studio's models/);
    await expect(f.t.mutation(api.studioTemplates.save, { ...base, mode: "edit", model: "fal-ai/seedvr/upscale/image", sourceAssetIds: [clip] })).rejects.toThrow(/not an image/);
    await expect(f.t.mutation(api.studioTemplates.save, { ...base, sessionToken: f.outsider.token, mode: "image", model: "fal-ai/flux/schnell", sourceAssetIds: [] })).rejects.toThrow();
  });
});
