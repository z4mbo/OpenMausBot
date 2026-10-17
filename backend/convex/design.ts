import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { assetTypeValidator, tokenTypeValidator } from "./lib/validators";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function requireEditor(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">, sessionToken: string) {
  const { member } = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(member)) throw new Error("Edit role required");
}

export const list = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const [tokens, assets] = await Promise.all([
      ctx.db.query("designTokens").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect(),
      ctx.db.query("designAssets").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect(),
    ]);
    const assetsWithUrls = await Promise.all(
      assets.map(async (asset) => ({
        ...asset,
        fileUrl: asset.storageId ? await ctx.storage.getUrl(asset.storageId) : asset.url,
      })),
    );
    return {
      tokens: tokens.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)),
      assets: assetsWithUrls.sort((a, b) => b.updatedAt - a.updatedAt),
    };
  },
});

export const generateUploadUrl = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createToken = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    type: tokenTypeValidator,
    name: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const now = Date.now();
    await ctx.db.insert("designTokens", {
      projectId: args.projectId,
      type: args.type,
      name: args.name.trim(),
      value: args.value.trim(),
      description: args.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    await touchProject(ctx, args.projectId);
  },
});

export const updateToken = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    tokenId: v.id("designTokens"),
    type: v.optional(tokenTypeValidator),
    name: v.optional(v.string()),
    value: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.projectId !== args.projectId) throw new Error("Token not found");
    const patch: Partial<{
      type: "color" | "typography" | "spacing" | "component" | "motion" | "other";
      name: string;
      value: string;
      description: string | undefined;
      updatedAt: number;
    }> = { updatedAt: Date.now() };
    if (args.type !== undefined) patch.type = args.type;
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.value !== undefined) patch.value = args.value.trim();
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    await ctx.db.patch(args.tokenId, patch);
    await touchProject(ctx, args.projectId);
  },
});

export const removeToken = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), tokenId: v.id("designTokens") },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.projectId !== args.projectId) throw new Error("Token not found");
    await ctx.db.delete(args.tokenId);
    await touchProject(ctx, args.projectId);
  },
});

export const createAsset = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    type: assetTypeValidator,
    name: v.string(),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    if (!args.url && !args.storageId) throw new Error("Asset file or URL required");
    if (args.url && !/^https?:\/\//i.test(args.url)) throw new Error("Use an http or https link");
    if (!args.name.trim() || args.name.length > 150) throw new Error("Enter an asset name under 150 characters");
    if (args.storageId) {
      const metadata = await ctx.db.system.get(args.storageId);
      if (!metadata || metadata.size > 15 * 1024 * 1024) throw new Error("Choose a file under 15 MB");
    }
    const now = Date.now();
    await ctx.db.insert("designAssets", {
      projectId: args.projectId,
      type: args.type,
      name: args.name.trim(),
      url: args.url?.trim() || undefined,
      storageId: args.storageId,
      contentType: args.contentType,
      size: args.size,
      notes: args.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    await touchProject(ctx, args.projectId);
  },
});

export const updateAsset = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    assetId: v.id("designAssets"),
    type: v.optional(assetTypeValidator),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.projectId !== args.projectId) throw new Error("Asset not found");
    const patch: Partial<{
      type: "figma" | "image" | "icon" | "font" | "document" | "apk" | "other";
      name: string;
      url: string | undefined;
      notes: string | undefined;
      updatedAt: number;
    }> = { updatedAt: Date.now() };
    if (args.type !== undefined) patch.type = args.type;
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.url !== undefined) patch.url = args.url.trim() || undefined;
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;
    await ctx.db.patch(args.assetId, patch);
    await touchProject(ctx, args.projectId);
  },
});

export const removeAsset = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), assetId: v.id("designAssets") },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.projectId !== args.projectId) throw new Error("Asset not found");
    await ctx.db.delete(args.assetId);
    await touchProject(ctx, args.projectId);
  },
});
