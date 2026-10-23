import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { studioMode, studioParams } from "./studioTables";
import { studioModel, type StudioMediaKind } from "../../shared/studio";
import { STUDIO_TEMPLATE_DESCRIPTION_MAX, STUDIO_TEMPLATE_NAME_MAX, TEMPLATE_SETTINGS } from "../../shared/studio-templates";

type Ctx = QueryCtx | MutationCtx;

const SHOWN = 80;
const PROMPT_MAX = 8_000;

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const kindOf = (asset: Doc<"designAssets">): StudioMediaKind | undefined => {
  const type = asset.contentType?.split("/")[0] ?? asset.type;
  if (type === "image" || asset.type === "icon") return "image";
  return type === "video" || type === "audio" ? type : undefined;
};

async function assetLink(ctx: QueryCtx, asset: Doc<"designAssets">) {
  return asset.storageId ? await ctx.storage.getUrl(asset.storageId) : asset.url ?? null;
}

async function withLinks(ctx: QueryCtx, template: Doc<"studioTemplates">) {
  const sources = [];
  for (const assetId of template.sourceAssetIds) {
    const asset = await ctx.db.get(assetId);
    const kind = asset && asset.projectId === template.projectId ? kindOf(asset) : undefined;
    if (asset && kind) sources.push({ assetId, kind, url: await assetLink(ctx, asset), name: asset.name });
  }
  const coverAsset = template.coverAssetId ? await ctx.db.get(template.coverAssetId) : null;
  const coverUrl = coverAsset && coverAsset.projectId === template.projectId ? await assetLink(ctx, coverAsset) : template.coverUrl;
  const cover = coverUrl && template.coverKind ? { url: coverUrl, kind: template.coverKind } : undefined;
  return { ...template, sources, cover };
}

async function templateOf(ctx: Ctx, projectId: Id<"projects">, templateId: Id<"studioTemplates">) {
  const template = await ctx.db.get(templateId);
  if (!template || template.projectId !== projectId) throw new Error("Template not found");
  return template;
}

export const list = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const rows = await ctx.db.query("studioTemplates").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(SHOWN);
    return await Promise.all(rows.map((row) => withLinks(ctx, row)));
  },
});

export const get = query({
  args: { projectId: v.id("projects"), sessionToken: v.string(), templateId: v.id("studioTemplates") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return await withLinks(ctx, await templateOf(ctx, args.projectId, args.templateId));
  },
});

/** Creates a template, or replaces one's fields with templateId; a generation gives it its cover. */
export const save = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    templateId: v.optional(v.id("studioTemplates")),
    name: v.string(),
    description: v.optional(v.string()),
    mode: studioMode,
    model: v.string(),
    prompt: v.string(),
    params: studioParams,
    sourceAssetIds: v.array(v.id("designAssets")),
    generationId: v.optional(v.id("studioGenerations")),
    agentName: v.optional(v.string()),
  },
  returns: v.id("studioTemplates"),
  handler: async (ctx, args) => {
    const { user, member } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    const name = clip(args.name.replace(/\s+/g, " ").trim(), STUDIO_TEMPLATE_NAME_MAX);
    if (!name) throw new Error("Name the template");
    const model = studioModel(args.model);
    if (!model || model.mode !== args.mode) throw new Error("Choose one of Studio's models");
    if (args.prompt.length > PROMPT_MAX) throw new Error("The prompt is too long");
    if (args.sourceAssetIds.length > model.needs.length) throw new Error(`${model.label} starts from ${model.needs.length} file(s)`);
    for (const [index, assetId] of args.sourceAssetIds.entries()) {
      const asset = await ctx.db.get(assetId);
      if (!asset || asset.projectId !== args.projectId) throw new Error("An example input is not one of this project's assets");
      if (kindOf(asset) !== model.needs[index]) throw new Error(`${asset.name} is not ${model.needs[index] === "image" ? "an image" : `a ${model.needs[index]} file`}`);
    }
    const params = Object.fromEntries(TEMPLATE_SETTINGS.flatMap((key) => {
      const value = args.params[key];
      return value === undefined || value === "" ? [] : [[key, typeof value === "string" ? value.slice(0, 2_000) : value]];
    }));
    let cover: Partial<Pick<Doc<"studioTemplates">, "coverAssetId" | "coverUrl" | "coverKind">> = {};
    if (args.generationId) {
      const generation = await ctx.db.get(args.generationId);
      if (!generation || generation.projectId !== args.projectId) throw new Error("Generation not found");
      const output = generation.outputs[0];
      const saved = generation.saved.find((entry) => entry.index === 0);
      if (output) cover = { coverKind: output.kind, ...(saved ? { coverAssetId: saved.assetId } : { coverUrl: output.url }) };
    }
    const now = Date.now();
    const fields = {
      name, description: clip(args.description?.trim() ?? "", STUDIO_TEMPLATE_DESCRIPTION_MAX), mode: args.mode, model: model.id, prompt: args.prompt.trim(), params,
      sourceAssetIds: args.sourceAssetIds, updatedAt: now, agentName: args.agentName?.trim() ? clip(args.agentName.trim(), 120) : undefined,
      ...(args.generationId ? { generationId: args.generationId, ...cover } : {}),
    };
    let id = args.templateId;
    if (id) await ctx.db.patch((await templateOf(ctx, args.projectId, id))._id, fields);
    else id = await ctx.db.insert("studioTemplates", { projectId: args.projectId, createdBy: user._id, createdByName: user.name || user.email, createdAt: now, ...fields });
    await touchProject(ctx, args.projectId);
    return id;
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), templateId: v.id("studioTemplates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    await ctx.db.delete((await templateOf(ctx, args.projectId, args.templateId))._id);
    return null;
  },
});
