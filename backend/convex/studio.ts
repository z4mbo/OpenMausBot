import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { addStorageScope, admitStorageReference } from "./lib/storage";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { studioKind, studioMode, studioOutput, studioParams, studioStatus } from "./studioTables";
import { STUDIO_ASSET_FOLDER, STUDIO_CHUNK_BYTES, STUDIO_STORED_MAX, studioAssetName } from "../../shared/studio";

type Ctx = QueryCtx | MutationCtx;

const SHOWN = 120;
const PROMPT_MAX = 8_000;
const ERROR_MAX = 600;
const OUTPUTS_MAX = 8;
const PARAMS_MAX = 16;
const CHUNKS_MAX = Math.ceil(STUDIO_STORED_MAX / STUDIO_CHUNK_BYTES);
const MEDIA_TYPE = /^(image|video|audio)\/[a-z0-9.+-]{1,60}$/;

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

function cleanParams(params: Record<string, string | number | boolean> | undefined) {
  if (!params) return undefined;
  const entries = Object.entries(params).slice(0, PARAMS_MAX).map(([key, value]) => [key.slice(0, 40), typeof value === "string" ? value.slice(0, 2_000) : value] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Files one output in Assets under the Studio folder; the app later swaps the link for an uploaded copy. */
async function insertAsset(ctx: MutationCtx, generation: Doc<"studioGenerations">, index: number, file: { name?: string; storageId?: Id<"_storage">; contentType?: string; size?: number } = {}) {
  const output = generation.outputs[index]!;
  const now = Date.now();
  return await ctx.db.insert("designAssets", {
    projectId: generation.projectId, type: output.kind, name: clip(file.name?.trim() || studioAssetName(generation, index, file.contentType), 150),
    url: file.storageId ? undefined : output.url, storageId: file.storageId,
    contentType: file.contentType ?? output.contentType, size: file.size, folder: STUDIO_ASSET_FOLDER,
    studio: { generationId: generation._id, model: generation.model, modelLabel: generation.modelLabel, prompt: clip(generation.prompt, 2_000) },
    notes: clip(`Made in Studio with ${generation.modelLabel}: ${generation.prompt}`, 1_000), createdAt: now, updatedAt: now,
  });
}

export const list = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return await ctx.db.query("studioGenerations").withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId))
      .order("desc").filter((q) => q.neq(q.field("intermediate"), true)).take(SHOWN);
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
    params: v.optional(studioParams),
    parentId: v.optional(v.id("studioGenerations")),
    action: v.optional(v.string()),
    workflowRunId: v.optional(v.id("studioWorkflowRuns")),
    nodeId: v.optional(v.string()),
    intermediate: v.optional(v.boolean()),
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
    if (args.parentId) await generationOf(ctx, args.projectId, args.parentId);
    if (args.workflowRunId) {
      const run = await ctx.db.get(args.workflowRunId);
      if (!run || run.projectId !== args.projectId) throw new Error("Run not found");
    }
    const now = Date.now();
    const id = await ctx.db.insert("studioGenerations", {
      projectId: args.projectId, mode: args.mode, model: args.model.trim(), modelLabel: clip(args.modelLabel.trim(), 200), kind: args.kind,
      prompt: args.prompt.trim(), aspectRatio: args.aspectRatio?.slice(0, 20), duration: args.duration?.slice(0, 20), sourceAssetId: args.sourceAssetId,
      params: cleanParams(args.params), parentId: args.parentId, action: args.action?.slice(0, 40),
      workflowRunId: args.workflowRunId, nodeId: args.nodeId?.slice(0, 40), intermediate: args.intermediate || undefined,
      status: "queued", outputs: [], saved: [], broadcast: [], createdBy: user._id, createdByName: user.name || user.email,
      agentName: args.agentName ? clip(args.agentName.trim(), 120) : undefined, branded: args.branded || undefined, createdAt: now, updatedAt: now,
    });
    await touchProject(ctx, args.projectId);
    return id;
  },
});

/** Records a generation's progress; only its creator's app runs it, so only the creator may. A finished one lands in Assets at once. */
export const update = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    generationId: v.id("studioGenerations"),
    status: studioStatus,
    falRequestId: v.optional(v.string()),
    queuePosition: v.optional(v.number()),
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
    patch.queuePosition = args.status === "queued" && args.queuePosition !== undefined ? Math.max(0, Math.trunc(args.queuePosition)) : undefined;
    if (args.status === "running" && !generation.startedAt) patch.startedAt = now;
    if (args.status === "done" || args.status === "failed" || args.status === "cancelled") patch.finishedAt = now;
    if (args.status === "failed") patch.error = clip(args.error?.trim() || "The generation failed", ERROR_MAX);
    if (args.outputs) patch.outputs = args.outputs;
    if (args.status === "done" && args.outputs?.length && !generation.intermediate) {
      const finished = { ...generation, outputs: args.outputs };
      const saved = [];
      for (let index = 0; index < args.outputs.length; index += 1) saved.push({ index, assetId: await insertAsset(ctx, finished, index) });
      patch.saved = saved;
      await touchProject(ctx, args.projectId);
    }
    await ctx.db.patch(args.generationId, patch);
    return null;
  },
});

/** Swaps an output's Assets link for the copy its app uploaded to project storage. */
export const storeFile = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    generationId: v.id("studioGenerations"),
    index: v.number(),
    storageId: v.id("_storage"),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  returns: v.union(v.id("designAssets"), v.null()),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    const generation = await generationOf(ctx, args.projectId, args.generationId);
    const entry = generation.saved.find((saved) => saved.index === args.index);
    const asset = entry ? await ctx.db.get(entry.assetId) : null;
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size > STUDIO_STORED_MAX) throw new Error("Studio keeps files up to 150 MB in project storage");
    if (!asset || asset.projectId !== args.projectId || asset.storageId) return null;
    await admitStorageReference(ctx, args.storageId, user, { kind: "project", projectId: args.projectId });
    await ctx.db.patch(asset._id, {
      storageId: args.storageId, url: undefined, contentType: args.contentType ?? asset.contentType, size: args.size ?? metadata.size,
      name: asset.name === studioAssetName(generation, args.index) ? clip(studioAssetName(generation, args.index, args.contentType), 150) : asset.name, updatedAt: Date.now(),
    });
    return asset._id;
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
    if (!generation.outputs[args.index]) throw new Error("No such output");
    const existing = generation.saved.find((entry) => entry.index === args.index);
    if (existing && await ctx.db.get(existing.assetId)) return existing.assetId;
    if (args.storageId) {
      const metadata = await ctx.db.system.get(args.storageId);
      if (!metadata || metadata.size > STUDIO_STORED_MAX) throw new Error("Studio keeps files up to 150 MB in project storage");
      await admitStorageReference(ctx, args.storageId, user, { kind: "project", projectId: args.projectId });
    }
    const assetId = await insertAsset(ctx, generation, args.index, { name: args.name, storageId: args.storageId, contentType: args.contentType, size: args.size });
    await ctx.db.patch(args.generationId, { saved: [...generation.saved.filter((entry) => entry.index !== args.index), { index: args.index, assetId }], updatedAt: Date.now() });
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

/**
 * The pieces of one large output this member just uploaded through the project's upload route: each must come from
 * their own unexpired upload of this project and be referenced by nothing yet, so assembling can never read or delete
 * another file.
 */
async function ownChunks(ctx: MutationCtx, projectId: Id<"projects">, sessionToken: string, chunks: readonly Id<"_storage">[]) {
  const { user } = await editorOf(ctx, projectId, sessionToken);
  if (!chunks.length || chunks.length > CHUNKS_MAX || new Set(chunks).size !== chunks.length) throw new Error("Upload the file in up to 13 pieces");
  const intents = await ctx.db.query("storageUploadIntents").withIndex("by_userId_and_expiresAt", (q) => q.eq("userId", user._id).gte("expiresAt", Date.now())).take(100);
  let total = 0;
  for (const chunk of chunks) {
    const intent = intents.find((entry) => entry.storageId === chunk && entry.state === "complete");
    if (!intent || intent.target.kind !== "asset" || intent.target.projectId !== projectId) throw new Error("A piece of the upload expired; upload the file again");
    if (await ctx.db.query("designAssets").withIndex("by_storageId", (q) => q.eq("storageId", chunk)).first()) throw new Error("A piece of the upload is already a file");
    const metadata = await ctx.db.system.get(chunk);
    if (!metadata) throw new Error("A piece of the upload is gone");
    total += metadata.size;
  }
  if (total > STUDIO_STORED_MAX) throw new Error("Studio keeps files up to 150 MB in project storage");
  return { user, intents: intents.filter((entry) => entry.storageId && chunks.includes(entry.storageId)), total };
}

export const claimChunks = internalMutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), chunks: v.array(v.id("_storage")) },
  returns: v.number(),
  handler: async (ctx, args) => (await ownChunks(ctx, args.projectId, args.sessionToken, args.chunks)).total,
});

/** Admits the assembled file to the project and forgets its pieces, which the assembling action then deletes. */
export const finishAssembly = internalMutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), chunks: v.array(v.id("_storage")), storageId: v.id("_storage"), contentType: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { intents, total } = await ownChunks(ctx, args.projectId, args.sessionToken, args.chunks);
    if (!MEDIA_TYPE.test(args.contentType)) throw new Error("Studio stores images, video and audio");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size !== total) throw new Error("The assembled file does not match its pieces");
    await addStorageScope(ctx, args.storageId, { kind: "project", projectId: args.projectId }, args.contentType);
    for (const chunk of args.chunks) {
      for (const admission of await ctx.db.query("storageAdmissions").withIndex("by_storageId_and_scopeKey", (q) => q.eq("storageId", chunk)).take(10)) await ctx.db.delete(admission._id);
    }
    for (const intent of intents) await ctx.db.delete(intent._id);
    return null;
  },
});
