import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { defaultBrandKit, normalizeBrandKit, type BrandKit } from "../../shared/brand-kit";
import type { BrandFontId } from "../../shared/brand-fonts";

type Ctx = QueryCtx | MutationCtx;

const kitRow = (ctx: Ctx, projectId: Id<"projects">) =>
  ctx.db.query("brandKits").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).unique();

function kitOf(row: Doc<"brandKits">): BrandKit {
  return {
    name: row.name, tagline: row.tagline, voice: row.voice, colors: row.colors,
    fonts: { heading: row.fonts.heading as BrandFontId, body: row.fonts.body as BrandFontId },
    logoAssetIds: row.logoAssetIds, ...(row.iconAssetId ? { iconAssetId: row.iconAssetId } : {}), imagery: row.imagery,
  };
}

async function assetLink(ctx: Ctx, projectId: Id<"projects">, assetId: Id<"designAssets">) {
  const asset = await ctx.db.get(assetId);
  if (!asset || asset.projectId !== projectId) return null;
  return { assetId, name: asset.name, url: asset.storageId ? await ctx.storage.getUrl(asset.storageId) : asset.url ?? null };
}

export const get = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const row = await kitRow(ctx, args.projectId);
    if (!row) return null;
    const logos = (await Promise.all(row.logoAssetIds.map((id) => assetLink(ctx, args.projectId, id)))).filter((link) => link !== null);
    const icon = row.iconAssetId ? await assetLink(ctx, args.projectId, row.iconAssetId) : null;
    return { _id: row._id, ...kitOf(row), logos, icon, updatedBy: row.updatedBy, ...(row.agentName ? { agentName: row.agentName } : {}), updatedAt: row.updatedAt };
  },
});

const optionalWords = v.optional(v.array(v.string()));

async function imageAsset(ctx: MutationCtx, projectId: Id<"projects">, raw: string): Promise<Id<"designAssets">> {
  const id = ctx.db.normalizeId("designAssets", raw);
  const asset = id ? await ctx.db.get(id) : null;
  if (!id || !asset || asset.projectId !== projectId) throw new Error(`No asset ${raw.slice(0, 64)} in this project`);
  if (!(asset.type === "image" || asset.type === "icon" || asset.contentType?.startsWith("image/"))) throw new Error(`${asset.name} is not an image`);
  return id;
}

/** Changes the fields given and keeps the rest; the first save creates the kit from the project's name. */
export const update = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    kit: v.object({
      name: v.optional(v.string()),
      tagline: v.optional(v.string()),
      voice: v.optional(v.object({ adjectives: optionalWords, do: optionalWords, dont: optionalWords })),
      colors: v.optional(v.object({ primary: v.optional(v.string()), secondary: v.optional(v.string()), neutrals: optionalWords })),
      fonts: v.optional(v.object({ heading: v.optional(v.string()), body: v.optional(v.string()) })),
      logoAssetIds: optionalWords,
      /** An empty string removes the icon. */
      iconAssetId: v.optional(v.string()),
      imagery: optionalWords,
    }),
    agentName: v.optional(v.string()),
  },
  returns: v.id("brandKits"),
  handler: async (ctx, args) => {
    const { member, user, project } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    const row = await kitRow(ctx, args.projectId);
    const { kit, problems } = normalizeBrandKit(args.kit, row ? kitOf(row) : defaultBrandKit(project.name));
    if (problems.length) throw new Error(problems[0]);
    const logoAssetIds = await Promise.all(kit.logoAssetIds.map((id) => imageAsset(ctx, args.projectId, id)));
    const iconAssetId = kit.iconAssetId ? await imageAsset(ctx, args.projectId, kit.iconAssetId) : undefined;
    const fields = {
      name: kit.name, tagline: kit.tagline, voice: kit.voice, colors: kit.colors, fonts: kit.fonts, logoAssetIds, iconAssetId, imagery: kit.imagery,
      updatedBy: user.name || user.email, agentName: args.agentName?.trim().slice(0, 120) || undefined, updatedAt: Date.now(),
    };
    const id = row ? (await ctx.db.patch(row._id, fields), row._id) : await ctx.db.insert("brandKits", { projectId: args.projectId, ...fields });
    await touchProject(ctx, args.projectId);
    return id;
  },
});
