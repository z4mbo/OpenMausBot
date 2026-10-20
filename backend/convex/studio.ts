import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { admitStorageReference } from "./lib/storage";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { studioKind, studioMode, studioOutput, studioStatus } from "./studioTables";

type Ctx = QueryCtx | MutationCtx;

const SHOWN = 120;
const PROMPT_MAX = 8_000;
const ERROR_MAX = 600;
const OUTPUTS_MAX = 8;
const ASSET_MAX_BYTES = 15 * 1024 * 1024;

async function editorOf(ctx: Ctx, projectId: Id<"projects">, sessionToken: string) {
  const access = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  return access;
}

async function generationOf(ctx: Ctx, projectId: Id<"projects">, generationId: Id<"studioGenerations">) {
  const generation = await ctx.db.get(generationId);
  if (!generation || generation.projectId !== projectId) throw new Error("Generation not found");
  return generation;
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const httpsUrl = (url: string) => /^https:\/\/\S+$/i.test(url) && url.length <= 4_000;

export const list = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return await ctx.db.query("studioGenerations").withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(SHOWN);
  },
});

export const get = query({
  args: { projectId: v.id("projects"), sessionToken: v.string(), generationId: v.id("studioGenerations") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return await generationOf(ctx, args.projectId, args.generationId);
  },
});

/** The outputs picked for Broadcast, newest first, with each asset's current link. */
export const forBroadcast = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const rows = await ctx.db.query("studioGenerations").withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(SHOWN);
    const picked = [];
    for (const row of rows) {
      for (const entry of row.broadcast) {
        const asset = await ctx.db.get(entry.assetId);
        if (!asset || asset.projectId !== args.projectId) continue;
        const url = asset.storageId ? await ctx.storage.getUrl(asset.storageId) : asset.url ?? null;
        picked.push({ generationId: row._id, assetId: entry.assetId, kind: row.outputs[entry.index]?.kind ?? row.kind, prompt: row.prompt, name: asset.name, url, at: entry.at });
      }
    }
    return picked.sort((a, b) => b.at - a.at);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    mode: studioMode,
    model: v.string(),
    modelLabel: v.string(),
    kind: studioKind,
    prompt: v.string(),
    aspectRatio: v.optional(v.string()),
    duration: v.optional(v.string()),
    sourceAssetId: v.optional(v.id("designAssets")),
    agentName: v.optional(v.string()),
    branded: v.optional(v.boolean()),
  },
  returns: v.id("studioGenerations"),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    if (args.prompt.length > PROMPT_MAX) throw new Error("The prompt is too long");
    if (!args.model.trim() || args.model.length > 200 || args.modelLabel.length > 200) throw new Error("Choose a model");
    if (args.sourceAssetId) {
      const source = await ctx.db.get(args.sourceAssetId);
      if (!source || source.projectId !== args.projectId) throw new Error("Source asset not found");
    }
    const now = Date.now();
    const id = await ctx.db.insert("studioGenerations", {
      projectId: args.projectId, mode: args.mode, model: args.model.trim(), modelLabel: clip(args.modelLabel.trim(), 200), kind: args.kind,
      prompt: args.prompt.trim(), aspectRatio: args.aspectRatio?.slice(0, 20), duration: args.duration?.slice(0, 20), sourceAssetId: args.sourceAssetId,
      status: "queued", outputs: [], saved: [], broadcast: [], createdBy: user._id, createdByName: user.name || user.email,
      agentName: args.agentName ? clip(args.agentName.trim(), 120) : undefined, branded: args.branded || undefined, createdAt: now, updatedAt: now,
    });
    await touchProject(ctx, args.projectId);
    return id;
  },
});

/** Records a generation's progress; only its creator's app runs it, so only the creator may. */
export const update = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    generationId: v.id("studioGenerations"),
    status: studioStatus,
    falRequestId: v.optional(v.string()),
    error: v.optional(v.string()),
    outputs: v.optional(v.array(studioOutput)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    const generation = await generationOf(ctx, args.projectId, args.generationId);
    if (generation.createdBy !== user._id) throw new Error("Only the member who started this generation can update it");
    if (generation.status === "done" || generation.status === "failed" || generation.status === "cancelled") return null;
    if (args.outputs && (args.outputs.length > OUTPUTS_MAX || args.outputs.some((output) => !httpsUrl(output.url)))) throw new Error("Outputs must be https links");
    const now = Date.now();
    const patch: Partial<Doc<"studioGenerations">> = { status: args.status, updatedAt: now };
    if (args.falRequestId) patch.falRequestId = args.falRequestId.slice(0, 200);
    if (args.status === "running" && !generation.startedAt) patch.startedAt = now;
    if (args.status === "done" || args.status === "failed" || args.status === "cancelled") patch.finishedAt = now;
    if (args.status === "failed") patch.error = clip(args.error?.trim() || "The generation failed", ERROR_MAX);
    if (args.outputs) patch.outputs = args.outputs;
    await ctx.db.patch(args.generationId, patch);
    return null;
  },
});

/** Saves one output as a project asset: an uploaded file, or a link when it is too large to copy. Returns the asset id. */
export const saveAsset = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    generationId: v.id("studioGenerations"),
    index: v.number(),
    name: v.string(),
    storageId: v.optional(v.id("_storage")),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  returns: v.id("designAssets"),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    const generation = await generationOf(ctx, args.projectId, args.generationId);
    const output = generation.outputs[args.index];
    if (!output) throw new Error("No such output");
    const existing = generation.saved.find((entry) => entry.index === args.index);
    if (existing && await ctx.db.get(existing.assetId)) return existing.assetId;
    if (args.storageId) {
      const metadata = await ctx.db.system.get(args.storageId);
      if (!metadata || metadata.size > ASSET_MAX_BYTES) throw new Error("Choose a file under 15 MB");
      await admitStorageReference(ctx, args.storageId, user, { kind: "project", projectId: args.projectId });
    }
    const now = Date.now();
    const name = clip(args.name.trim() || `${generation.modelLabel} ${output.kind}`, 150);
    const assetId = await ctx.db.insert("designAssets", {
      projectId: args.projectId, type: output.kind, name,
      url: args.storageId ? undefined : output.url, storageId: args.storageId,
      contentType: args.contentType ?? output.contentType, size: args.size,
      notes: clip(`Made in Studio with ${generation.modelLabel}: ${generation.prompt}`, 1_000), createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(args.generationId, { saved: [...generation.saved.filter((entry) => entry.index !== args.index), { index: args.index, assetId }], updatedAt: now });
    await touchProject(ctx, args.projectId);
    return assetId;
  },
});

/** Picks a saved output for Broadcast. */
export const useInBroadcast = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), generationId: v.id("studioGenerations"), index: v.number(), picked: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    const generation = await generationOf(ctx, args.projectId, args.generationId);
    const others = generation.broadcast.filter((entry) => entry.index !== args.index);
    if (!args.picked) {
      await ctx.db.patch(args.generationId, { broadcast: others, updatedAt: Date.now() });
      return null;
    }
    const saved = generation.saved.find((entry) => entry.index === args.index);
    if (!saved || !await ctx.db.get(saved.assetId)) throw new Error("Save this output to Assets first");
    await ctx.db.patch(args.generationId, { broadcast: [...others, { index: args.index, assetId: saved.assetId, at: Date.now() }], updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), generationId: v.id("studioGenerations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, member } = await editorOf(ctx, args.projectId, args.sessionToken);
    const generation = await generationOf(ctx, args.projectId, args.generationId);
    if (generation.createdBy !== user._id && member.role !== "owner" && member.role !== "admin") throw new Error("Only its creator or a project admin can delete this generation");
    await ctx.db.delete(args.generationId);
    return null;
  },
});
