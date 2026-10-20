import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { studioCharacterKind } from "./studioTables";
import { STUDIO_CHARACTER_REFERENCES_MAX } from "../../shared/studio";

const SHOWN = 60;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 600;

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const isImage = (asset: Doc<"designAssets">) => asset.type === "image" || asset.type === "icon" || Boolean(asset.contentType?.startsWith("image/"));

async function withLinks(ctx: QueryCtx, character: Doc<"studioCharacters">) {
  const references = [];
  for (const assetId of character.referenceAssetIds) {
    const asset = await ctx.db.get(assetId);
    if (!asset || asset.projectId !== character.projectId) continue;
    references.push({ assetId, url: asset.storageId ? await ctx.storage.getUrl(asset.storageId) : asset.url ?? null });
  }
  return { ...character, references };
}

async function characterOf(ctx: QueryCtx, projectId: Id<"projects">, characterId: Id<"studioCharacters">) {
  const character = await ctx.db.get(characterId);
  if (!character || character.projectId !== projectId) throw new Error("Library entry not found");
  return character;
}

export const list = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const rows = await ctx.db.query("studioCharacters").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(SHOWN);
    return await Promise.all(rows.map((row) => withLinks(ctx, row)));
  },
});

export const get = query({
  args: { projectId: v.id("projects"), sessionToken: v.string(), characterId: v.id("studioCharacters") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return await withLinks(ctx, await characterOf(ctx, args.projectId, args.characterId));
  },
});

/** Creates a library entry, or replaces one's fields with characterId. */
export const save = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    characterId: v.optional(v.id("studioCharacters")),
    name: v.string(),
    kind: studioCharacterKind,
    description: v.string(),
    referenceAssetIds: v.array(v.id("designAssets")),
    agentName: v.optional(v.string()),
  },
  returns: v.id("studioCharacters"),
  handler: async (ctx, args) => {
    const { user, member } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    const name = clip(args.name.replace(/\s+/g, " ").trim(), NAME_MAX);
    if (!name) throw new Error("Name the library entry");
    const references = [...new Set(args.referenceAssetIds)];
    if (!references.length) throw new Error("Add at least one reference image");
    if (references.length > STUDIO_CHARACTER_REFERENCES_MAX) throw new Error(`A library entry takes up to ${STUDIO_CHARACTER_REFERENCES_MAX} reference images`);
    for (const assetId of references) {
      const asset = await ctx.db.get(assetId);
      if (!asset || asset.projectId !== args.projectId) throw new Error("A reference is not one of this project's assets");
      if (!isImage(asset)) throw new Error(`${asset.name} is not an image`);
    }
    const now = Date.now();
    const fields = {
      name, kind: args.kind, description: clip(args.description.trim(), DESCRIPTION_MAX), referenceAssetIds: references, updatedAt: now,
      agentName: args.agentName?.trim() ? clip(args.agentName.trim(), 120) : undefined,
    };
    let id = args.characterId;
    if (id) await ctx.db.patch((await characterOf(ctx, args.projectId, id))._id, fields);
    else id = await ctx.db.insert("studioCharacters", { projectId: args.projectId, createdBy: user._id, createdByName: user.name || user.email, createdAt: now, ...fields });
    await touchProject(ctx, args.projectId);
    return id;
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), characterId: v.id("studioCharacters") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    await ctx.db.delete((await characterOf(ctx, args.projectId, args.characterId))._id);
    return null;
  },
});
